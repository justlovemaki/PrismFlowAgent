import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismPublicationReceiptStore } from '../lib/store-publication-receipts.js'

class Table {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { this.map.set(key, structuredClone(value)) }
}

const markdown = '# Durable\n'
const artifact = {
  draftId: 'draft-1', draftVersion: 2, artifactSha256: 'a'.repeat(64), title: 'Durable', markdown,
  sourceContentStoreIds: ['b'.repeat(64)],
}
function receipt(overrides = {}) {
  return {
    receiptId: '00000000-0000-4000-8000-000000000000', publisherId: 'local-markdown:daily', status: 'created',
    itemCount: 1, truncated: 0, bytes: Buffer.byteLength(markdown), sha256: artifact.artifactSha256,
    publishedAt: '2026-01-01T00:00:00.000Z', recordedAt: '2026-01-01T00:00:01.000Z', trigger: 'manual',
    contentStoreIds: artifact.sourceContentStoreIds, draftId: artifact.draftId, draftVersion: artifact.draftVersion,
    artifactSha256: artifact.artifactSha256, ...overrides,
  }
}

test('publication recovery inspection requires the exact durable publisher and Artifact receipt', () => {
  const store = new PrismPublicationReceiptStore(new Context()); store.receipts = new Table()
  const committed = receipt(); store.receipts.map.set(committed.receiptId, committed)
  assert.equal(store.inspectArtifactPublication(committed.publisherId, artifact).outcome, 'committed')
  assert.equal(store.inspectArtifactPublication('github-markdown:daily', artifact).outcome, 'none')

  store.receipts.map.clear()
  const skipped = receipt({ status: 'skipped' }); store.receipts.map.set(skipped.receiptId, skipped)
  assert.equal(store.inspectArtifactPublication(skipped.publisherId, artifact).outcome, 'not-committed')

  store.receipts.map.clear()
  const mismatch = receipt({ draftVersion: 1 }); store.receipts.map.set(mismatch.receiptId, mismatch)
  assert.equal(store.inspectArtifactPublication(mismatch.publisherId, artifact).outcome, 'ambiguous')
  store.receipts.map.set('wrong-key', mismatch)
  assert.throws(() => store.inspectArtifactPublication(mismatch.publisherId, artifact), /malformed key/)

  store.receipts.map.clear()
  const unknown = receipt({ hidden: { nested: true } }); store.receipts.map.set(unknown.receiptId, unknown)
  assert.throws(() => store.inspectArtifactPublication(unknown.publisherId, artifact), /malformed key or row/)
})

test('attempt recovery and persistence require the exact preallocated immutable attempt Receipt', async () => {
  const store = new PrismPublicationReceiptStore(new Context()); store.receipts = new Table()
  const attempt = { attemptId: '10000000-0000-4000-8000-000000000000', receiptId: '20000000-0000-4000-8000-000000000000',
    attemptNumber: 2, intent: 'repeat', publisherId: 'local-markdown:daily' }
  const candidate = { publisherId: attempt.publisherId, status: 'unchanged', itemCount: 1, truncated: 0, omittedMedia: 2,
    bytes: Buffer.byteLength(markdown), sha256: artifact.artifactSha256, publishedAt: '2026-01-01T00:00:00.000Z',
    contentStoreIds: artifact.sourceContentStoreIds, draftId: artifact.draftId, draftVersion: artifact.draftVersion,
    artifactSha256: artifact.artifactSha256 }
  const context = { receiptId: attempt.receiptId, publicationAttemptId: attempt.attemptId,
    publicationAttemptNumber: attempt.attemptNumber, publicationIntent: attempt.intent, trigger: 'manual' }
  const stored = await store.append(candidate, context)
  assert.equal(stored.omittedMedia, 2)
  assert.equal(store.inspectAttemptPublication(attempt, artifact).outcome, 'committed')
  assert.equal(store.inspectAttemptPublication({ ...attempt, attemptId: '30000000-0000-4000-8000-000000000000' }, artifact).outcome, 'ambiguous')
  assert.deepEqual(await store.append(candidate, context), stored)
  await assert.rejects(store.append({ ...candidate, status: 'created' }, context), /conflicting content/)
})
