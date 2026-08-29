import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Readable } from 'node:stream'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Context } from '@deepseek-ai/cordis'
import { PrismPublisherRegistry } from '../lib/publisher-core.js'
import { productionArtifactBindingSha256 } from '../lib/shared/content-production.js'
import { applyWithClientFactory, createR2Client } from '../lib/publisher-r2-markdown.js'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const ETAG_ONE = `"${'1'.repeat(32)}"`
const ETAG_TWO = `"${'2'.repeat(32)}"`

function destination(id, overwrite = 'if-changed', credentials = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  return {
    id,
    name: `R2 ${id}`,
    accountId: ACCOUNT_ID,
    bucket: 'prismflow-archive',
    pathPrefix: 'daily',
    fileNamePattern: 'latest.md',
    title: 'R2 Archive',
    overwrite,
    accessKeyIdCredential: credentials[0],
    secretAccessKeyCredential: credentials[1],
    publicUrlPrefix: 'https://content.example.test',
    maxItems: 50,
    maxDescriptionChars: 1_000,
    maxBytes: 900_000,
  }
}

function artifactFor(records, markdown, draftId = 'draft-test') {
  return {
    draftId, draftVersion: 1, artifactSha256: createHash('sha256').update(markdown).digest('hex'),
    title: 'Approved', markdown, sourceContentStoreIds: records.map(record => record.storeId),
  }
}

function contentRecord(description, updatedAt) {
  return {
    id: 'stored-1',
    sourceId: 'fake:r2',
    itemId: '1',
    item: {
      id: '1',
      title: 'R2 fixture',
      url: 'https://example.test/1',
      description,
      published_date: '2025-01-01',
      source: 'Smoke',
      category: 'test',
    },
    status: { read: false, archived: false },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt,
  }
}

function createContext(resolveCredential) {
  const providers = new Map()
  const cleanups = []
  const logs = []
  return {
    providers,
    cleanups,
    logs,
    credentials: { resolve: resolveCredential },
    prismPublishers: {
      register(provider) {
        providers.set(provider.id, provider)
        return () => providers.delete(provider.id)
      },
    },
    logger: { info(message) { logs.push(message) } },
    effect(callback) { cleanups.push(callback()) },
  }
}

function metadataError(status, requestId = 'REQ_123') {
  const error = new Error('provider body must not escape')
  error.$metadata = { httpStatusCode: status, requestId }
  return error
}

test('publishes R2 Markdown with conditional create, unchanged, skip, and conflict-safe update', async () => {
  let generation = 1
  const resolvedRefs = []
  const ctx = createContext(async ref => {
    resolvedRefs.push(ref)
    if (ref === 'R2_ACCESS_KEY_ID') return { value: `access-${generation}`, source: 'test' }
    if (ref === 'R2_SECRET_ACCESS_KEY') return { value: `secret-${generation}`, source: 'test' }
    return undefined
  })

  let object
  let conflictNextUpdate = true
  let putCount = 0
  const clients = []
  const createClient = (configured, credentials) => {
    clients.push({ configured, credentials, destroyed: false })
    return {
      async send(command, options) {
        assert.equal(options.abortSignal?.aborted, false)
        if (command instanceof HeadObjectCommand) {
          if (!object) throw metadataError(404)
          return {
            ETag: object.etag,
            ContentLength: Buffer.byteLength(object.content, 'utf8'),
            Metadata: { 'prismflow-sha256': object.sha256 },
          }
        }
        assert.ok(command instanceof PutObjectCommand)
        putCount += 1
        assert.equal(command.input.Bucket, 'prismflow-archive')
        assert.match(command.input.Key, /^daily\/draft-\d{4}-\d{2}-\d{2}\.md$/)
        assert.equal(command.input.ContentType, 'text/markdown; charset=utf-8')
        assert.equal(typeof command.input.Metadata?.['prismflow-sha256'], 'string')
        if (!object) {
          assert.equal(command.input.IfNoneMatch, '*')
          assert.equal(command.input.IfMatch, undefined)
        } else {
          assert.equal(command.input.IfMatch, object.etag)
          assert.equal(command.input.IfNoneMatch, undefined)
          if (conflictNextUpdate) {
            conflictNextUpdate = false
            throw metadataError(412)
          }
        }
        const content = Buffer.from(command.input.Body).toString('utf8')
        object = {
          content,
          sha256: command.input.Metadata['prismflow-sha256'],
          etag: object ? ETAG_TWO : ETAG_ONE,
        }
        return { ETag: object.etag }
      },
      destroy() { clients.at(-1).destroyed = true },
    }
  }

  applyWithClientFactory(ctx, {
    destinations: [
      destination('archive'),
      destination('never', 'never'),
      destination('missing', 'if-changed', ['MISSING_ACCESS', 'MISSING_SECRET']),
    ],
  }, createClient)

  const archive = ctx.providers.get('r2-markdown:archive')
  assert.equal(typeof archive.publish, 'undefined')
  const records = [contentRecord('first', '2025-01-02T00:00:00.000Z')]
  records[0].storeId = 'a'.repeat(64)
  const firstArtifact = artifactFor(records, '# First\n')
  const created = await archive.publishArtifact(firstArtifact, records, {})
  assert.equal(created.status, 'created')
  assert.equal(created.etag, ETAG_ONE)
  assert.match(created.publicUrl, /https:\/\/content\.example\.test\/daily\/draft-\d{4}-\d{2}-\d{2}\.md$/)
  assert.equal(putCount, 1)

  generation = 2
  const unchanged = await archive.publishArtifact(firstArtifact, records, {})
  assert.equal(unchanged.status, 'unchanged')
  assert.equal(putCount, 1)

  const neverRecords = [{ ...contentRecord('changed but forbidden', '2025-01-03T00:00:00.000Z'), storeId: 'a'.repeat(64) }]
  const never = await ctx.providers.get('r2-markdown:never').publishArtifact(
    artifactFor(neverRecords, '# Forbidden change\n', 'draft-never'), neverRecords, {},
  )
  assert.equal(never.status, 'skipped')
  assert.equal(putCount, 1)

  const updatedRecords = [{ ...contentRecord('updated', '2025-01-03T00:00:00.000Z'), storeId: 'a'.repeat(64) }]
  const updated = await archive.publishArtifact(
    artifactFor(updatedRecords, '# Updated\n', 'draft-updated'), updatedRecords, {},
  )
  assert.equal(updated.status, 'updated')
  assert.equal(updated.etag, ETAG_TWO)
  assert.equal(putCount, 3)
  assert.equal(object.content, '# Updated\n')
  assert.ok(clients.every(client => client.destroyed))
  assert.deepEqual(clients.at(-1).credentials, { accessKeyId: 'access-2', secretAccessKey: 'secret-2' })
  assert.ok(resolvedRefs.length >= 8)

  await assert.rejects(
    ctx.providers.get('r2-markdown:missing').publishArtifact(firstArtifact, records, {}),
    error => error.message.includes('destination: missing')
      && !error.message.includes('MISSING_ACCESS')
      && !error.message.includes('MISSING_SECRET'),
  )
  const controller = new AbortController()
  controller.abort('do not reflect this reason')
  await assert.rejects(archive.publishArtifact(firstArtifact, records, { signal: controller.signal }), /^Error: R2 publication aborted$/)
  assert.ok(!JSON.stringify({ created, unchanged, never, updated, logs: ctx.logs }).includes('secret-'))

  for (const cleanup of ctx.cleanups) await cleanup()
  assert.equal(ctx.providers.size, 0)
})

test('uploads content-addressed non-Markdown media under the fixed R2 media prefix', async () => {
  const ctx = createContext(async ref => ({ value: ref.includes('SECRET') ? 'secret' : 'access', source: 'test' }))
  let put
  applyWithClientFactory(ctx, { destinations: [destination('media')] }, () => ({
    async send(command) {
      if (command instanceof HeadObjectCommand) throw metadataError(404)
      assert.ok(command instanceof PutObjectCommand); put = command.input
      return { ETag: ETAG_ONE }
    },
    destroy() {},
  }))
  const bytes = Buffer.from('synthetic-avif-bytes')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const result = await ctx.providers.get('r2-markdown:media').uploadMedia(bytes, 'image/avif', {})
  assert.equal(put.Key, `media/${sha256}.avif`)
  assert.equal(put.ContentType, 'image/avif')
  assert.equal(put.Metadata['prismflow-sha256'], sha256)
  assert.equal(result.publicUrl, `https://content.example.test/media/${sha256}.avif`)
  assert.equal(result.status, 'created')
  for (const cleanup of ctx.cleanups) await cleanup()
})

test('publishes the exact approved artifact to the configured R2 artifact path', async () => {
  const ctx = createContext(async ref => ({ value: ref.includes('SECRET') ? 'secret' : 'access', source: 'test' }))
  let put
  applyWithClientFactory(ctx, { destinations: [{ ...destination('artifact'), artifactFileNamePattern: 'approved-{date}.md' }] }, () => ({
    async send(command) {
      if (command instanceof HeadObjectCommand) throw metadataError(404)
      put = command.input
      return { ETag: ETAG_ONE }
    },
    destroy() {},
  }))
  const markdown = '# Approved R2\n\nExact.\n'
  const artifactSha256 = (await import('node:crypto')).createHash('sha256').update(markdown).digest('hex')
  const records = [{ ...contentRecord('ignored snapshot material', '2025-01-02T00:00:00.000Z'), storeId: 'a'.repeat(64) }]
  const artifact = { draftId: 'draft-r2', draftVersion: 1, artifactSha256, title: 'Approved', markdown, sourceContentStoreIds: [records[0].storeId],
    artifactBindingSha256: '', mediaAssets: [], destinationPresentations: [] }
  artifact.artifactBindingSha256 = productionArtifactBindingSha256(artifact)
  const registryCtx = new Context()
  Object.defineProperty(registryCtx, 'prismProduction', { value: { assertPublicationArtifact() {} } })
  const registry = new PrismPublisherRegistry(registryCtx)
  registry.register(ctx.providers.get('r2-markdown:artifact'))
  const receipt = await registry.publishArtifact('r2-markdown:artifact', artifact, records, {})
  assert.match(put.Key, /^daily\/approved-\d{4}-\d{2}-\d{2}\.md$/)
  assert.equal(Buffer.from(put.Body).toString('utf8'), markdown)
  assert.equal(receipt.sha256, artifactSha256)
  assert.equal(receipt.artifactSha256, artifactSha256)
  assert.equal(receipt.artifactBindingSha256, artifact.artifactBindingSha256)
  assert.equal(receipt.draftId, 'draft-r2')
})

test('R2 publisher cleanup aborts and drains an active Artifact request', async () => {
  const ctx = createContext(async ref => ({ value: ref.includes('SECRET') ? 'secret' : 'access', source: 'test' }))
  let observedSignal
  applyWithClientFactory(ctx, { destinations: [destination('shutdown')] }, () => ({
    send(_command, options) {
      observedSignal = options.abortSignal
      return new Promise((resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    },
    destroy() {},
  }))
  const records = [{ ...contentRecord('content', '2025-01-02T00:00:00.000Z'), storeId: 'a'.repeat(64) }]
  const caller = new AbortController()
  const active = ctx.providers.get('r2-markdown:shutdown').publishArtifact(artifactFor(records, '# Shutdown\n', 'draft-shutdown'), records, { signal: caller.signal })
  while (!observedSignal) await Promise.resolve()
  assert.notEqual(observedSignal, caller.signal)
  const stopping = ctx.cleanups[0]()
  await assert.rejects(active, /R2 publication aborted/)
  await stopping
  assert.equal(observedSignal.aborted, true)
  assert.equal(caller.signal.aborted, false)
})

test('serializes and signs fixed-origin conditional R2 requests through the AWS SDK', async () => {
  const captured = []
  const requestHandler = {
    async handle(request) {
      captured.push(request)
      if (request.method === 'HEAD') {
        return {
          response: {
            statusCode: 404,
            headers: { 'content-type': 'application/xml', 'x-amz-request-id': 'WIRE_HEAD' },
            body: Readable.from(['<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>']),
          },
        }
      }
      return {
        response: {
          statusCode: 200,
          headers: { etag: ETAG_ONE, 'x-amz-request-id': 'WIRE_PUT' },
          body: Readable.from([]),
        },
      }
    },
  }
  const ctx = createContext(async ref => ({
    value: ref === 'R2_ACCESS_KEY_ID' ? 'wire-access-key' : 'wire-secret-key',
    source: 'test',
  }))
  applyWithClientFactory(ctx, { destinations: [destination('wire')] }, (configured, credentials) => (
    createR2Client(configured, credentials, requestHandler)
  ))
  const wireRecords = [{ ...contentRecord('wire content', '2025-01-02T00:00:00.000Z'), storeId: 'a'.repeat(64) }]
  const receipt = await ctx.providers.get('r2-markdown:wire').publishArtifact(
    artifactFor(wireRecords, '# Wire content\n', 'draft-wire'), wireRecords, {},
  )
  assert.equal(receipt.status, 'created')
  assert.equal(captured.length, 2)
  const [head, put] = captured
  assert.equal(head.protocol, 'https:')
  assert.equal(head.hostname, `${ACCOUNT_ID}.r2.cloudflarestorage.com`)
  assert.match(head.path, /^\/prismflow-archive\/daily\/draft-\d{4}-\d{2}-\d{2}\.md$/)
  assert.match(head.headers.authorization, /^AWS4-HMAC-SHA256 Credential=wire-access-key\//)
  assert.ok(!head.headers.authorization.includes('wire-secret-key'))
  assert.equal(put.headers['if-none-match'], '*')
  assert.equal(put.headers['x-amz-meta-prismflow-sha256'], receipt.sha256)
  assert.equal(put.headers['content-type'], 'text/markdown; charset=utf-8')
  assert.equal(put.headers['x-amz-sdk-checksum-algorithm'], undefined)
})

test('sanitizes credential and R2 API failures while marking malformed success receipts unverified', async () => {
  const rejectingContext = createContext(async () => {
    throw new Error('credential backend leaked-secret-text')
  })
  applyWithClientFactory(rejectingContext, { destinations: [destination('credential-error')] }, () => {
    throw new Error('client must not be created')
  })
  await assert.rejects(
    rejectingContext.providers.get('r2-markdown:credential-error').publishArtifact(
      artifactFor([{ storeId: 'a'.repeat(64) }], '# Content\n', 'draft-credential'),
      [{ ...contentRecord('content', '2025-01-02T00:00:00.000Z'), storeId: 'a'.repeat(64) }],
      {},
    ),
    error => error.message === 'R2 credential resolution failed for destination: credential-error'
      && !error.message.includes('leaked-secret-text'),
  )

  const ctx = createContext(async ref => ({ value: ref.includes('SECRET') ? 'top-secret' : 'access-id', source: 'test' }))
  let mode = 'forbidden'
  applyWithClientFactory(ctx, { destinations: [destination('errors')] }, () => ({
    async send(command) {
      if (command instanceof HeadObjectCommand) {
        if (mode === 'forbidden') throw metadataError(403, 'SAFE_REQUEST')
        throw metadataError(404)
      }
      return { ETag: 'malformed provider top-secret' }
    },
    destroy() {},
  }))
  const provider = ctx.providers.get('r2-markdown:errors')
  const records = [{ ...contentRecord('content', '2025-01-02T00:00:00.000Z'), storeId: 'a'.repeat(64) }]
  const artifact = artifactFor(records, '# Content\n', 'draft-errors')
  await assert.rejects(
    provider.publishArtifact(artifact, records, {}),
    error => error.message === 'R2 API 403: request SAFE_REQUEST' && !error.message.includes('top-secret'),
  )
  mode = 'bad-receipt'
  const unverified = await provider.publishArtifact(artifact, records, {})
  assert.equal(unverified.status, 'created')
  assert.equal(unverified.verification, 'unverified')
  assert.equal('etag' in unverified, false)
  assert.ok(!JSON.stringify(unverified).includes('top-secret'))
})
