import { createHash } from 'node:crypto'
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import Schema from '@deepseek-ai/schemastery'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import {
  buildR2ApiEndpoint,
  buildR2ObjectKey,
  buildR2PublicObjectUrl,
  validateR2ObjectKey,
  normalizeR2AccountId,
  normalizeR2PublicUrlPrefix,
  validateR2BucketName,
  validateR2PathPrefix,
} from './shared/r2-publisher.js'
import { renderMarkdownFileName } from './shared/markdown-publisher.js'
import { normalizePublisherConfig, publisherConfigRevision } from './shared/publisher-profile.js'

export const name = 'prismflow-publisher-r2-markdown'
export const inject = ['credentials', 'prismPublishers']

const DestinationConfig = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  accountId: Schema.string().required(),
  bucket: Schema.string().required(),
  pathPrefix: Schema.string().default('daily'),
  fileNamePattern: Schema.string().default('{date}.md'),
  artifactFileNamePattern: Schema.string().default('draft-{date}.md'),
  title: Schema.string().default('PrismFlow Content'),
  overwrite: Schema.union(['never', 'if-changed']).default('if-changed'),
  accessKeyIdCredential: Schema.string().role('credential-ref').default('R2_ACCESS_KEY_ID'),
  secretAccessKeyCredential: Schema.string().role('credential-ref').default('R2_SECRET_ACCESS_KEY'),
  publicUrlPrefix: Schema.string().default(''),
  maxItems: Schema.number().step(1).min(1).max(100).default(50),
  maxDescriptionChars: Schema.number().step(1).min(1).max(10_000).default(1_000),
  maxBytes: Schema.number().step(1).min(1_024).max(1_000_000).default(900_000),
})

export const Config = Schema.object({
  destinations: Schema.array(DestinationConfig).default([]),
})

function mediaConfigurationError(message) { const error = new Error(message); error.code = 'PRISMFLOW_R2_MEDIA_CONFIGURATION'; return error }

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error('R2 publication aborted')
}

function awaitWithAbort(operation, signal) {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(new Error('R2 publication aborted'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('R2 publication aborted'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(operation).then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

function validateCredentialRef(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error('R2 credential fields must contain valid credential references')
  }
  return value
}

function safeEtag(value) {
  return typeof value === 'string' && /^"[A-Fa-f0-9]{32}(?:-\d+)?"$/.test(value) ? value : undefined
}

function safeVersionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{1,256}$/.test(value) ? value : undefined
}

function safeRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : undefined
}

function statusCode(error) {
  const status = error?.$metadata?.httpStatusCode
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
}

function isMissing(error) {
  return statusCode(error) === 404
}

function isConflict(error) {
  const status = statusCode(error)
  return status === 409 || status === 412
}

function r2ApiError(error, signal) {
  throwIfAborted(signal)
  const status = statusCode(error)
  const requestId = safeRequestId(error?.$metadata?.requestId)
  const details = requestId ? `: request ${requestId}` : ''
  return new Error(status ? `R2 API ${status}${details}` : 'R2 API request failed')
}

async function observeR2Object(client, destination, key, signal) {
  throwIfAborted(signal)
  try {
    const result = await client.send(new HeadObjectCommand({
      Bucket: destination.bucket,
      Key: key,
    }), { abortSignal: signal })
    const etag = safeEtag(result.ETag)
    if (!etag) throw new Error('R2 API returned an invalid object observation receipt')
    const sha256 = result.Metadata?.['prismflow-sha256']
    return {
      etag,
      sha256: typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : undefined,
      bytes: Number.isSafeInteger(result.ContentLength) && result.ContentLength >= 0 ? result.ContentLength : undefined,
      versionId: safeVersionId(result.VersionId),
    }
  } catch (error) {
    if (isMissing(error)) return undefined
    if (error instanceof Error && error.message === 'R2 API returned an invalid object observation receipt') throw error
    throw r2ApiError(error, signal)
  }
}

async function writeR2Object(client, destination, key, content, sha256, existing, signal) {
  throwIfAborted(signal)
  try {
    const result = await client.send(new PutObjectCommand({
      Bucket: destination.bucket,
      Key: key,
      Body: Buffer.from(content, 'utf8'),
      ContentType: 'text/markdown; charset=utf-8',
      Metadata: { 'prismflow-sha256': sha256 },
      ...(existing ? { IfMatch: existing.etag } : { IfNoneMatch: '*' }),
    }), { abortSignal: signal })
    const etag = safeEtag(result.ETag)
    return {
      etag,
      versionId: safeVersionId(result.VersionId),
      verification: etag ? 'verified' : 'unverified',
    }
  } catch (error) {
    throw error
  }
}

async function publishR2Object(client, destination, key, content, sha256, signal) {
  const bytes = Buffer.byteLength(content, 'utf8')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal)
    const existing = await observeR2Object(client, destination, key, signal)
    if (existing && destination.overwrite === 'never') {
      return { status: 'skipped', etag: existing.etag, versionId: existing.versionId }
    }
    if (existing?.sha256 === sha256 && existing.bytes === bytes) {
      return { status: 'unchanged', etag: existing.etag, versionId: existing.versionId }
    }
    try {
      const written = await writeR2Object(client, destination, key, content, sha256, existing, signal)
      return {
        status: existing ? 'updated' : 'created',
        etag: written.etag,
        versionId: written.versionId,
        verification: written.verification,
      }
    } catch (error) {
      if (attempt === 0 && isConflict(error)) continue
      throw r2ApiError(error, signal)
    }
  }
  throw new Error('R2 publication could not stabilize its configured target')
}

export function applyWithClientFactory(ctx, config, createClient) {
  const normalizedConfig = normalizePublisherConfig('r2-markdown', config)
  const configRevision = publisherConfigRevision('r2-markdown', normalizedConfig)
  if (typeof ctx.prismPublishers.registerChannel === 'function') ctx.effect(() => ctx.prismPublishers.registerChannel('r2-markdown', configRevision), 'prismflow-publisher-r2-markdown:channel')

  for (const destination of normalizedConfig.destinations) {

    let operationTail = Promise.resolve()
    const shutdownController = new AbortController()
    const publisherId = `r2-markdown:${destination.id}`
    const enqueue = operation => {
      const result = operationTail.then(operation)
      operationTail = result.then(() => {}, () => {})
      return result
    }
    const publishContent = async (records, content, pattern, execution, artifact, truncated = 0) => {
      throwIfAborted(execution.signal)
      if (!records.length) throw new Error(`R2 publisher ${publisherId} received no content`)
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > destination.maxBytes) throw new Error(`R2 publication exceeds maxBytes (${bytes} > ${destination.maxBytes})`)
      let accessKeyId
      let secretAccessKey
      try {
        [accessKeyId, secretAccessKey] = await awaitWithAbort(
          Promise.all([ctx.credentials.resolve(destination.accessKeyIdCredential), ctx.credentials.resolve(destination.secretAccessKeyCredential)]),
          execution.signal,
        )
      } catch {
        throwIfAborted(execution.signal)
        throw new Error(`R2 credential resolution failed for destination: ${destination.id}`)
      }
      if (!accessKeyId?.value || !secretAccessKey?.value) throw new Error(`R2 credentials are not configured for destination: ${destination.id}`)
      const publishedAt = new Date()
      const fileName = renderMarkdownFileName(pattern, publishedAt.toISOString().slice(0, 10))
      const key = buildR2ObjectKey(destination.pathPrefix, fileName)
      const sha256 = createHash('sha256').update(content).digest('hex')
      const client = createClient(destination, { accessKeyId: accessKeyId.value, secretAccessKey: secretAccessKey.value })
      let write
      try { write = await publishR2Object(client, destination, key, content, sha256, execution.signal) } finally { client.destroy?.() }
      const publicUrl = buildR2PublicObjectUrl(destination.publicUrlPrefix, key)
      return {
        publisherId, fileName, key, bucket: destination.bucket, status: write.status,
        itemCount: records.length, truncated, bytes, sha256, contentStoreIds: records.map(record => record.storeId),
        verification: write.verification ?? 'verified', ...(write.etag === undefined ? {} : { etag: write.etag }),
        ...(write.versionId === undefined ? {} : { versionId: write.versionId }), ...(publicUrl === undefined ? {} : { publicUrl }),
        ...(artifact ? { draftId: artifact.draftId, draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256,
          ...(artifact.artifactBindingSha256 ? { artifactBindingSha256: artifact.artifactBindingSha256 } : {}) } : {}),
        publishedAt: publishedAt.toISOString(),
      }
    }
    const uploadMedia = async (value, mime, execution = {}) => {
      throwIfAborted(execution.signal)
      const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value) : undefined
      const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
      const extension = extensions[mime]
      if (!bytes?.length || bytes.length > 32 * 1024 * 1024 || !extension) throw new Error('R2 media upload value or MIME is invalid')
      if (!destination.publicUrlPrefix) throw mediaConfigurationError(`R2 publicUrlPrefix is required for media destination: ${destination.id}`)
      let accessKeyId; let secretAccessKey
      try { [accessKeyId, secretAccessKey] = await awaitWithAbort(Promise.all([ctx.credentials.resolve(destination.accessKeyIdCredential), ctx.credentials.resolve(destination.secretAccessKeyCredential)]), execution.signal) }
      catch { throwIfAborted(execution.signal); throw mediaConfigurationError(`R2 credential resolution failed for destination: ${destination.id}`) }
      if (!accessKeyId?.value || !secretAccessKey?.value) throw mediaConfigurationError(`R2 credentials are not configured for destination: ${destination.id}`)
      const sha256 = createHash('sha256').update(bytes).digest('hex'); const key = validateR2ObjectKey(`media/${sha256}.${extension}`)
      const publicUrl = buildR2PublicObjectUrl(destination.publicUrlPrefix, key); if (!publicUrl) throw new Error(`R2 public URL is unavailable for destination: ${destination.id}`)
      const client = createClient(destination, { accessKeyId: accessKeyId.value, secretAccessKey: secretAccessKey.value })
      try {
        const existing = await observeR2Object(client, destination, key, execution.signal)
        if (existing) {
          if (existing.sha256 !== sha256 || existing.bytes !== bytes.length) throw new Error('R2 content-addressed media key is occupied by different bytes')
          return { publicUrl, key, sha256, bytes: bytes.length, mime, status: 'unchanged' }
        }
        try {
          await client.send(new PutObjectCommand({ Bucket: destination.bucket, Key: key, Body: bytes, ContentType: mime, Metadata: { 'prismflow-sha256': sha256 }, IfNoneMatch: '*' }), { abortSignal: execution.signal })
        } catch (error) {
          if (!isConflict(error)) throw r2ApiError(error, execution.signal)
          const raced = await observeR2Object(client, destination, key, execution.signal)
          if (!raced || raced.sha256 !== sha256 || raced.bytes !== bytes.length) throw new Error('R2 media upload conflict could not be verified')
        }
        return { publicUrl, key, sha256, bytes: bytes.length, mime, status: 'created' }
      } finally { client.destroy?.() }
    }
    const provider = {
      id: publisherId, name: destination.name, kind: 'r2-markdown', configRevision,
      description: `Publish an approved PrismFlow draft Artifact to a configured Cloudflare R2 Markdown object.`,
      ownsMediaUrl(value) {
        if (typeof value !== 'string' || !destination.publicUrlPrefix) return false
        try { const prefix = new URL(destination.publicUrlPrefix.endsWith('/') ? destination.publicUrlPrefix : `${destination.publicUrlPrefix}/`); const url = new URL(value); return url.origin === prefix.origin && url.pathname.startsWith(`${prefix.pathname}media/`) && !url.username && !url.password } catch { return false }
      },
      uploadMedia(value, mime, execution = {}) {
        const signals = [execution.signal, shutdownController.signal].filter(Boolean)
        const scoped = { ...execution, signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }
        return enqueue(() => uploadMedia(value, mime, scoped))
      },
      publishArtifact(artifact, records, execution = {}) {
        const signals = [execution.signal, shutdownController.signal].filter(Boolean)
        const scoped = { ...execution, signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }
        return enqueue(() => publishContent(records, artifact.markdown, destination.artifactFileNamePattern, scoped, artifact))
      },
    }

    ctx.effect(() => {
      const unregister = ctx.prismPublishers.register(provider)
      return async () => {
        unregister()
        shutdownController.abort(new Error(`PrismFlow publisher is stopping: ${publisherId}`))
        await operationTail
      }
    }, `prismflow-publisher-r2-markdown:${destination.id}`)
  }
}

export function createR2Client(destination, credentials, requestHandler) {
  return new S3Client({
    endpoint: buildR2ApiEndpoint(destination.accountId),
    region: 'auto',
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials,
    requestHandler: requestHandler ?? new NodeHttpHandler({
      connectionTimeout: 10_000,
      requestTimeout: 60_000,
      throwOnRequestTimeout: true,
    }),
  })
}

export function apply(ctx, config) {
  return applyWithClientFactory(ctx, config, createR2Client)
}
