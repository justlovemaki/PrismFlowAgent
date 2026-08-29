import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { relative, resolve } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismPublisherRegistry } from '../lib/publisher-core.js'
import { productionArtifactBindingSha256 } from '../lib/shared/content-production.js'
import { apply } from '../lib/publisher-local-markdown.js'

const STORE_ID = 'a'.repeat(64)

test('local Markdown publisher writes the exact approved artifact and binds its receipt', async () => {
  let provider
  let written
  const cleanups = []
  const root = resolve('/safe')
  const ctx = {
    fs: {
      async lstat(path, options) {
        if (options?.cwd) return undefined
        return { type: 'directory' }
      },
      async resolve(path, options = {}) { return options.cwd ? resolve(options.cwd, path) : resolve(path) },
      async stat(path) { return path === root ? { type: 'directory' } : undefined },
      contains(parent, child) { const value = relative(parent, child); return value === '' || (!value.startsWith('..') && !value.includes(':')) },
      async readText() { throw new Error('not expected') },
      async writeText(path, content, expected) {
        written = { path, content, expected }
        return { operation: 'create' }
      },
    },
    prismPublishers: { register(value) { provider = value; return () => {} } },
    logger: { info() {} },
    effect(factory) { cleanups.push(factory()) },
  }
  await apply(ctx, { destinations: [{
    id: 'approved', name: 'Approved', root, fileNamePattern: 'snapshot-{date}.md',
    artifactFileNamePattern: 'approved-{date}.md', title: 'Snapshot', overwrite: 'if-changed',
    maxItems: 50, maxDescriptionChars: 1000, maxBytes: 1_000_000,
  }] })
  const markdown = '# Reviewed\n\nExact body.\n'
  const sha256 = createHash('sha256').update(markdown).digest('hex')
  const artifact = { draftId: 'draft-1', draftVersion: 1, artifactSha256: sha256, title: 'Reviewed', markdown, sourceContentStoreIds: [STORE_ID],
    artifactBindingSha256: '', mediaAssets: [], destinationPresentations: [] }
  artifact.artifactBindingSha256 = productionArtifactBindingSha256(artifact)
  const registryCtx = new Context()
  Object.defineProperty(registryCtx, 'prismProduction', { value: { assertPublicationArtifact() {} } })
  const registry = new PrismPublisherRegistry(registryCtx)
  registry.register(provider)
  const receipt = await registry.publishArtifact(provider.id, artifact, [{ storeId: STORE_ID }], {})
  assert.equal(written.content, markdown)
  assert.match(written.path, /approved-\d{4}-\d{2}-\d{2}\.md$/)
  assert.deepEqual(written.expected, { kind: 'createIfAbsent' })
  assert.equal(receipt.sha256, sha256)
  assert.equal(receipt.artifactBindingSha256, artifact.artifactBindingSha256)
  assert.equal(receipt.bytes, Buffer.byteLength(markdown))
  assert.equal(receipt.draftId, 'draft-1')
  assert.equal(receipt.draftVersion, 1)
  assert.equal(receipt.artifactSha256, sha256)
  assert.deepEqual(receipt.contentStoreIds, [STORE_ID])
  assert.equal(typeof provider.publish, 'undefined')
  for (const cleanup of cleanups) await cleanup
})

test('local publisher cleanup aborts and drains an active Artifact write', async () => {
  let provider
  let observedSignal
  const cleanups = []
  const root = resolve('/safe')
  const ctx = {
    fs: {
      async lstat(path, options) { if (options?.cwd) return undefined; return { type: 'directory' } },
      async resolve(path, options = {}) { return options.cwd ? resolve(options.cwd, path) : resolve(path) },
      async stat(path) { return path === root ? { type: 'directory' } : undefined },
      contains() { return true },
      async readText() { throw new Error('not expected') },
      async writeText(_path, _content, _expected, signal) {
        observedSignal = signal
        return new Promise((resolveWrite, reject) => signal.addEventListener('abort', () => reject(new Error('write aborted')), { once: true }))
      },
    },
    prismPublishers: { register(value) { provider = value; return () => {} } },
    logger: { info() {} },
    effect(factory) { cleanups.push(factory()) },
  }
  await apply(ctx, { destinations: [{ id: 'approved', name: 'Approved', root, artifactFileNamePattern: 'approved-{date}.md', overwrite: 'if-changed', maxBytes: 1_000_000 }] })
  const markdown = '# Reviewed\n'
  const artifact = { draftId: 'draft-1', draftVersion: 1, artifactSha256: createHash('sha256').update(markdown).digest('hex'), title: 'Reviewed', markdown, sourceContentStoreIds: [STORE_ID] }
  const caller = new AbortController()
  const active = provider.publishArtifact(artifact, [{ storeId: STORE_ID }], { signal: caller.signal })
  while (!observedSignal) await Promise.resolve()
  assert.notEqual(observedSignal, caller.signal)
  const stopping = cleanups[0]()
  await assert.rejects(active, /write aborted/)
  await stopping
  assert.equal(observedSignal.aborted, true)
  assert.equal(caller.signal.aborted, false)
})
