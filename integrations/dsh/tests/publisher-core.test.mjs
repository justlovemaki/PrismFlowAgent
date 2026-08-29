import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismPublisherRegistry } from '../lib/publisher-core.js'

const STORE_ID = 'a'.repeat(64)
const RECORDS = [{ storeId: STORE_ID }]
const MARKDOWN = '# Approved\n'
const ARTIFACT = {
  draftId: 'draft-1', draftVersion: 1,
  artifactSha256: createHash('sha256').update(MARKDOWN).digest('hex'),
  title: 'Approved', markdown: MARKDOWN, sourceContentStoreIds: [STORE_ID],
}

function rawReceipt(extra = {}) {
  return {
    publisherId: 'fixture', status: 'created', itemCount: 1, truncated: 0,
    bytes: Buffer.byteLength(MARKDOWN), sha256: ARTIFACT.artifactSha256,
    contentStoreIds: [STORE_ID], fileName: 'fixture.md',
    draftId: ARTIFACT.draftId, draftVersion: ARTIFACT.draftVersion,
    artifactSha256: ARTIFACT.artifactSha256,
    publishedAt: '2025-01-01T00:00:00.000Z', ...extra,
  }
}

function trustedRegistry(assertion = (publisherId, artifact) => {
  assert.equal(publisherId, 'fixture')
  assert.deepEqual(artifact, ARTIFACT)
}) {
  const ctx = new Context()
  Object.defineProperty(ctx, 'prismProduction', { value: { assertPublicationArtifact: assertion } })
  return { ctx, registry: new PrismPublisherRegistry(ctx) }
}

function provider(publishArtifact = async () => rawReceipt()) {
  return { id: 'fixture', name: 'Fixture', publishArtifact }
}

test('registry projects only bounded WeChat readiness capability without deployment asset identity', () => {
  const { registry } = trustedRegistry()
  registry.register({ ...provider(), id: 'wechat-draft:news', kind: 'wechat-draft', articleType: 'news', hasDeploymentDefaultCover: true,
    defaultCoverAssetRef: 'must-not-be-projected', secret: 'must-not-be-projected' })
  assert.deepEqual(registry.list()[0], { id: 'wechat-draft:news', name: 'Fixture', description: '', kind: 'wechat-draft', articleType: 'news', hasDeploymentDefaultCover: true })
})

test('registry runs optional publisher-local Artifact representation validation without creating a publication', async () => {
  const { registry } = trustedRegistry()
  let observed
  registry.register({ ...provider(), validateArtifact(artifact) { observed = artifact; throw new Error('cannot represent') } })
  await assert.rejects(registry.validateArtifact('fixture', ARTIFACT), /cannot represent/u)
  assert.equal(observed, ARTIFACT)
  await assert.rejects(registry.validateArtifact('missing', ARTIFACT), /Unknown PrismFlow publisher/u)
})

test('registry exposes only claim-authorized Artifact publication and rejects raw or forged bypasses', async () => {
  const { registry } = trustedRegistry()
  assert.equal(typeof registry.publish, 'undefined')
  assert.throws(() => registry.register({ id: 'raw', async publish() {} }), /publishArtifact/)
  let calls = 0
  registry.register(provider(async () => { calls += 1; return rawReceipt() }))
  const forged = { ...ARTIFACT, markdown: '# Forged\n', artifactSha256: createHash('sha256').update('# Forged\n').digest('hex') }
  await assert.rejects(registry.publishArtifact('fixture', forged, RECORDS, {}), /active approved-draft claim/)
  assert.equal(calls, 0)
  await registry.publishArtifact('fixture', ARTIFACT, RECORDS, {})
  assert.equal(calls, 1)
})

test('normalizes an exact claimed Artifact result and durably enriches it through one receipt sink', async () => {
  const { registry } = trustedRegistry()
  registry.register(provider(async artifact => rawReceipt({ secret: 'drop-me', omittedMedia: 1, bytes: Buffer.byteLength(artifact.markdown) })))
  let observed
  registry.registerReceiptSink(async (receipt, context) => {
    observed = { receipt, context }
    return { ...receipt, receiptId: 'receipt-1', recordedAt: '2025-01-01T00:00:01.000Z' }
  })
  const result = await registry.publishArtifact('fixture', ARTIFACT, RECORDS, {
    trigger: 'manual', signal: new AbortController().signal,
  })
  assert.equal(result.receiptId, 'receipt-1')
  assert.equal(result.omittedMedia, 1)
  assert.equal('secret' in result, false)
  assert.equal('markdown' in result, false)
  assert.equal(observed.context.trigger, 'manual')
})

test('rejects Artifact providers whose receipts do not prove exact approved body and provenance', async () => {
  const valid = {
    bytes: Buffer.byteLength(MARKDOWN), sha256: ARTIFACT.artifactSha256,
    draftId: ARTIFACT.draftId, draftVersion: 1, artifactSha256: ARTIFACT.artifactSha256,
  }
  for (const mutation of [
    { sha256: 'c'.repeat(64) }, { bytes: valid.bytes + 1 }, { itemCount: 0 },
    { truncated: 1 }, { contentStoreIds: ['d'.repeat(64)] },
  ]) {
    const { registry } = trustedRegistry()
    registry.register(provider(async () => rawReceipt({ ...valid, ...mutation })))
    await assert.rejects(registry.publishArtifact('fixture', ARTIFACT, RECORDS, {}), /artifact|Receipt failed trusted normalization/i)
  }
})

test('closes the receipt sink behind an admission barrier', async () => {
  const { registry } = trustedRegistry()
  registry.register(provider())
  let release
  const blocker = new Promise(resolve => { release = resolve })
  const sink = async receipt => { await blocker; return receipt }
  registry.registerReceiptSink(sink)
  const active = registry.publishArtifact('fixture', ARTIFACT, RECORDS, {})
  await Promise.resolve()
  const closing = registry.closeReceiptSink(sink)
  await assert.rejects(registry.publishArtifact('fixture', ARTIFACT, RECORDS, {}), /receipt store is stopping/)
  release()
  await active
  await closing
  const withoutSink = await registry.publishArtifact('fixture', ARTIFACT, RECORDS, {})
  assert.equal('receiptId' in withoutSink, false)
})

test('runtime inventory projects only safe channel identity and maintenance drain rejects new attempts while waiting', async () => {
  const { registry } = trustedRegistry()
  let release; let started
  const began = new Promise(resolve => { started = resolve })
  registry.register({ ...provider(async () => { started(); await new Promise(resolve => { release = resolve }); return rawReceipt() }),
    kind: 'local-markdown', configRevision: 'a'.repeat(64) })
  assert.deepEqual(registry.inventory().find(channel => channel.kind === 'local-markdown'), {
    kind: 'local-markdown', name: 'Local Markdown', active: true, disabled: false, configured: true,
    destinations: [{ id: 'fixture', name: 'Fixture' }], configRevision: 'a'.repeat(64),
  })
  assert.equal(JSON.stringify(registry.inventory()).includes('root'), false)
  const active = registry.publishArtifact('fixture', ARTIFACT, RECORDS, {})
  await began
  let drained = false
  const drain = registry.beginMaintenanceDrain().then(() => { drained = true })
  await Promise.resolve(); assert.equal(drained, false)
  await assert.rejects(registry.publishArtifact('fixture', ARTIFACT, RECORDS, {}), /maintenance drain/u)
  release(); await active; await drain
  assert.deepEqual(registry.maintenanceStatus(), { draining: true, active: 0, restartAllowed: true })
})

test('reports committed publication truthfully when receipt persistence fails', async () => {
  const { registry } = trustedRegistry()
  registry.register(provider(async () => rawReceipt({ articleType: 'news', wechatDraftMediaId: 'safe-draft-media-id',
    operation: 'draft.add', verification: 'verified', access_token: 'must-not-survive', errmsg: 'must-not-survive' })))
  registry.registerReceiptSink(async () => { throw new Error('backend secret details') })
  const result = await registry.publishArtifact('fixture', ARTIFACT, RECORDS, {})
  assert.equal(result.status, 'created')
  assert.equal(result.publicationCommitted, true)
  assert.equal(result.receiptPersistence, 'failed')
  assert.deepEqual({ articleType: result.articleType, wechatDraftMediaId: result.wechatDraftMediaId,
    operation: result.operation, verification: result.verification },
  { articleType: 'news', wechatDraftMediaId: 'safe-draft-media-id', operation: 'draft.add', verification: 'verified' })
  assert.ok(!JSON.stringify(result).includes('backend secret details'))
  assert.ok(!JSON.stringify(result).includes('must-not-survive'))

  const skippedFixture = trustedRegistry()
  skippedFixture.registry.register(provider(async () => rawReceipt({ status: 'skipped' })))
  skippedFixture.registry.registerReceiptSink(async () => { throw new Error('backend failure') })
  const skipped = await skippedFixture.registry.publishArtifact('fixture', ARTIFACT, RECORDS, {})
  assert.equal(skipped.publicationCommitted, false)
  assert.equal(skipped.receiptPersistence, 'failed')
})
