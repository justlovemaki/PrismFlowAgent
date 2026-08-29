import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismContentSelectionStore } from '../lib/store-content-selection.js'
import { selectionSha256 } from '../lib/shared/ai-content-selection.js'

class Table {
  constructor(hooks = {}) { this.map = new Map(); this.hooks = hooks }
  get(id) { return this.map.get(id) }
  entries() { return this.map.entries() }
  async put(id, value) { this.map.set(id, structuredClone(value)); await this.hooks.afterPut?.(id, value); return value }
  async delete(id) { this.map.delete(id) }
}
function claim(id, verdict = 'matched-ai', title = `DeepSeek model ${id}`, sourceId = `rss:${id}`) {
  const storeId = id.padStart(64, '0'); const contentHash = id.repeat(64).slice(0, 64)
  const assessment = { verdict, topics: verdict === 'unmatched' ? [] : ['foundation-models'], reasonCodes: [], evidence: [], scannedChars: 10, truncated: false }
  const record = { storeId, sourceId, firstSeenAt: '2026-08-20T00:00:00.000Z', item: { title, url: `https://example.test/${id}`, description: `${title} factual body `.repeat(100), source: sourceId, category: 'news', published_date: '2026-08-20T00:00:00.000Z' } }
  return { record, assessment, contentHash, effectiveTimestamp: Date.parse('2026-08-20T00:00:00.000Z'), card: { storeId, title, evidence: [] } }
}
function fixture({ matched = [claim('1')], ambiguous = [], unmatched = [], revalidate = () => true, config = {} } = {}) {
  const ctx = new Context(); const providers = new Map()
  Object.defineProperty(ctx, 'prismContentRelevance', { value: {
    async snapshotCurrent() { return { asOf: '2026-08-20T12:00:00.000Z', since: '2026-08-18T12:00:00.000Z', hours: 48, classifierVersion: 'v1', relevanceProfileFingerprint: 'a'.repeat(64), candidateCount: matched.length + ambiguous.length + unmatched.length, matched, ambiguous, unmatched } },
    revalidateClaims: revalidate,
  } })
  Object.defineProperty(ctx, 'prismContentStore', { value: { get(id) { return [...matched, ...ambiguous, ...unmatched].find(item => item.record.storeId === id)?.record } } })
  Object.defineProperty(ctx, 'prismProduction', { value: { registerMaterialProvider(provider) { providers.set(provider.id, provider); return () => providers.delete(provider.id) } } })
  const service = new PrismContentSelectionStore(ctx, { maxMaterialChars: 20000, maxInputTokens: 20000, defaultMaxInputTokens: 10000, ...config })
  service.reviews = new Table(); service.selections = new Table()
  return { service, providers, records: [...matched, ...ambiguous, ...unmatched] }
}
function rehashSelection(raw) {
  const payload = structuredClone(raw)
  delete payload.selectionSha256
  raw.selectionSha256 = selectionSha256(payload)
}
function rehashMaterial(material) {
  const payload = structuredClone(material)
  delete payload.materialChars; delete payload.estimatedTokens; delete payload.materialSha256
  const encoded = JSON.stringify(payload)
  material.materialChars = encoded.length
  material.materialSha256 = createHash('sha256').update(encoded).digest('hex')
}

test('creates immutable hash-bound selection, reviews only ambiguity, caches review and resolves bounded material', async () => {
  const ambiguous = [claim('2', 'ambiguous', 'AI stock and model business')]
  const { service } = fixture({ ambiguous })
  const batches = []
  service.registerReviewer({ id: 'reviewer', fingerprint: 'b'.repeat(64), batchSize: 10, maxCards: 20, maxCardChars: 800, unmatchedAuditPercent: 0,
    async reviewBatch(cards) { batches.push(cards); return cards.map(card => ({ storeId: card.storeId, decision: 'relevant', topics: ['foundation-models'], reasonCode: 'substantive-ai' })) } })
  const first = await service.create({ maxItems: 2 }, { agent: {}, signal: new AbortController().signal })
  assert.equal(first.selectedCount, 2)
  assert.ok(Array.isArray(first.sourceIds) && first.sourceIds.length > 0)
  assert.equal(batches.length, 1)
  assert.equal(JSON.stringify(first).includes('excerpts'), false)
  const second = await service.create({ maxItems: 2 }, { agent: {}, signal: new AbortController().signal })
  assert.notEqual(second.selectionId, first.selectionId)
  assert.equal(batches.length, 1)
  const resolved = service.resolveMaterial(first.selectionId)
  assert.equal(resolved.packedMaterials.length, 2)
  assert.ok(resolved.packedMaterials.every(item => JSON.stringify(item).length < 5000))
  assert.throws(() => { const raw = service.selections.map.get(first.selectionId); raw.items[0].material.title = 'tampered'; service.resolveMaterial(first.selectionId) }, /corrupt/)
})

test('fails closed on unavailable reviewer, content race, clustering overflow, overlap and shutdown', async () => {
  const ambiguous = [claim('2', 'ambiguous')]
  await assert.rejects(fixture({ ambiguous }).service.create({}, { agent: {} }), /reviewer is unavailable/)
  const raced = fixture()
  raced.service.revalidateSelectionClaims = () => { throw new Error('changed during selection') }
  await assert.rejects(raced.service.create({}, { agent: {} }), /changed during selection/)
  assert.equal(raced.service.selections.map.size, 0)

  let release; let enteredResolve
  const blocked = fixture({ ambiguous })
  blocked.service.registerReviewer({ id: 'r', fingerprint: 'c'.repeat(64), batchSize: 10, maxCards: 20, maxCardChars: 800, unmatchedAuditPercent: 0,
    reviewBatch(cards) { enteredResolve(); return new Promise(resolve => { release = () => resolve(cards.map(card => ({ storeId: card.storeId, decision: 'irrelevant', topics: [], reasonCode: 'no' }))) }) } })
  const entered = new Promise(resolve => { enteredResolve = resolve })
  const active = blocked.service.create({}, { agent: {} })
  await entered
  await assert.rejects(blocked.service.create({}, { agent: {} }), /already running/)
  const stopped = blocked.service.shutdown(); release()
  await assert.rejects(active)
  await stopped
})

test('handles 2000 local matches within bounded deterministic clustering and material selection', async () => {
  const matched = Array.from({ length: 2000 }, (_, index) => claim(String(index + 1), 'matched-ai', `DeepSeek model event ${index % 100}`))
  const { service } = fixture({ matched, config: { maxPairComparisons: 200000, maxBucketSize: 200 } })
  const result = await service.create({ maxItems: 30, maxInputTokens: 10000 }, {})
  assert.ok(result.selectedCount > 0 && result.selectedCount <= 30)
  assert.ok(result.totalMaterialChars <= 20000)
  assert.ok(result.estimatedTokens <= 10000)
})

test('fails closed unless the configured source quota survives relevance, ranking, and material packing', async () => {
  const github = ['alphaengine', 'bravostack', 'charliekit', 'deltaflow', 'echolab', 'foxtrotai']
    .map((name, index) => claim(`g${index}`, 'matched-ai', `GitHub AI project ${name}`, 'github-trending:daily'))
  const other = Array.from({ length: 8 }, (_, index) => claim(`r${index}`, 'matched-ai', `RSS AI event ${index}`, `rss:${index}`))
  const config = { sourceQuotaId: 'github-trending:daily', sourceQuotaMinItems: 3, sourceQuotaMaxItems: 5 }
  const { service } = fixture({ matched: [...github, ...other], config })
  const result = await service.create({}, {})
  assert.ok(result.sourceIds.includes('github-trending:daily'))
  const stored = service.selections.map.get(result.selectionId)
  const githubCount = stored.items.filter(item => item.sourceId === 'github-trending:daily').length
  assert.ok(githubCount >= 3 && githubCount <= 5)

  const insufficient = fixture({ matched: [...github.slice(0, 2), ...other], config })
  await assert.rejects(insufficient.service.create({}, {}), /source quota cannot be satisfied/u)
  assert.equal(insufficient.service.selections.map.size, 0)
})

test('reviews every unmatched quota-source row instead of relying on the global audit sample', async () => {
  const quotaRows = ['alphaengine', 'bravostack', 'charliekit']
    .map((name, index) => claim(`u${index}`, 'unmatched', `GitHub project ${name}`, 'github-trending:daily'))
  const config = { sourceQuotaId: 'github-trending:daily', sourceQuotaMinItems: 3, sourceQuotaMaxItems: 5 }
  const { service } = fixture({ matched: [claim('1')], unmatched: quotaRows, config })
  const reviewed = []
  service.registerReviewer({ id: 'quota-reviewer', fingerprint: 'd'.repeat(64), batchSize: 24, maxCards: 500, maxCardChars: 800, unmatchedAuditPercent: 0,
    async reviewBatch(cards) { reviewed.push(...cards); return cards.map(card => ({ storeId: card.storeId, decision: 'relevant', topics: ['frameworks-deployment'], reasonCode: 'ai-project' })) } })
  const result = await service.create({}, { agent: {} })
  assert.equal(reviewed.length, 3)
  const stored = service.selections.map.get(result.selectionId)
  assert.equal(stored.items.filter(item => item.sourceId === 'github-trending:daily').length, 3)
})

test('pins and revalidates every selected cluster member full claim', async () => {
  const matched = [claim('1', 'matched-ai', 'Shared DeepSeek event'), claim('2', 'matched-ai', 'Shared DeepSeek event')]
  const { service, records } = fixture({ matched })
  const first = await service.create({ maxItems: 1 }, {})
  const stored = service.selections.map.get(first.selectionId)
  assert.equal(stored.items[0].memberClaims.length, 2)
  const nonRepresentative = records.find(value => value.record.storeId !== stored.items[0].storeId)
  nonRepresentative.record.item.url = 'https://changed.test/event'
  assert.throws(() => service.resolveMaterial(first.selectionId), /changed or disappeared/)

  nonRepresentative.record.item.url = 'https://example.test/2'
  const second = await service.create({ maxItems: 1 }, {})
  nonRepresentative.record.item.metadata = { ai_summary: 'new summary after selection' }
  assert.throws(() => service.resolveMaterial(second.selectionId), /changed or disappeared/)
})

test('persists and revalidates explicit metadata.content_html media without projecting the full HTML', async () => {
  const mediaClaim = claim('1')
  const image = 'https://cdn.example.test/model.jpg'
  const video = 'https://cdn.example.test/demo.mp4'
  const poster = 'https://cdn.example.test/poster.webp'
  const originalContentHtml = `<article data-private="must-not-project"><img src="${image}"></article><video src="${video}" poster="${poster}"></video>`
  mediaClaim.record.item.metadata = { content_html: originalContentHtml, ignored: '<img src="https://ignored.example.test/arbitrary.jpg">' }
  const { service } = fixture({ matched: [mediaClaim] })
  const created = await service.create({}, {})
  const resolved = service.resolveMaterial(created.selectionId)
  assert.deepEqual(resolved.packedMaterials[0].media, [{ kind: 'video', url: video }])
  assert.doesNotMatch(JSON.stringify(resolved.packedMaterials[0]), /must-not-project|ignored\.example/u)

  mediaClaim.record.item.metadata.content_html = `<img src="https://cdn.example.test/changed.jpg">`
  assert.throws(() => service.resolveMaterial(created.selectionId), /changed or disappeared|media no longer matches/)
  mediaClaim.record.item.metadata.content_html = originalContentHtml

  const legacyV1 = structuredClone(service.selections.map.get(created.selectionId))
  legacyV1.strategyVersion = 'ai-selection-v1'
  rehashSelection(legacyV1)
  service.selections.map.set(created.selectionId, legacyV1)
  assert.throws(() => service.resolveMaterial(created.selectionId), /corrupt/)

  const current = await service.create({}, {})
  const old = structuredClone(service.selections.map.get(current.selectionId))
  delete old.items[0].material.media
  rehashMaterial(old.items[0].material)
  old.totalMaterialChars = JSON.stringify(old.items.map(item => item.material)).length
  rehashSelection(old)
  service.selections.map.set(current.selectionId, old)
  assert.equal(Object.hasOwn(service.resolveMaterial(current.selectionId).packedMaterials[0], 'media'), false)

  const over = claim('9')
  over.record.item.description += ' https://cdn.example.test/one.jpg https://cdn.example.test/two.jpg'
  const boundedFixture = fixture({ matched: [over], config: { maxMediaPerItem: 1 } })
  const bounded = await boundedFixture.service.create({}, {})
  assert.equal(boundedFixture.service.resolveMaterial(bounded.selectionId).packedMaterials[0].media.length, 1)
})

test('rejects hidden persisted fields at every selection material boundary', async () => {
  const { service } = fixture()
  const created = await service.create({}, {})
  const clean = service.selections.map.get(created.selectionId)
  const variants = [
    raw => { raw.hidden = 'x' },
    raw => { raw.counts.hidden = 1 },
    raw => { raw.items[0].hidden = 'x' },
    raw => { raw.items[0].signals.hidden = 1 },
    raw => { raw.items[0].memberClaims[0].hidden = 'x' },
    raw => { raw.items[0].material.hidden = 'x' },
    raw => { raw.items[0].material.excerpts[0].hidden = 'x' },
    raw => { raw.items[0].material.media[0] = { kind: 'image', url: 'https://cdn.example.test/a.jpg', hidden: 'x' } },
  ]
  clean.items[0].material.media = [{ kind: 'image', url: 'https://cdn.example.test/a.jpg' }]
  rehashMaterial(clean.items[0].material)
  clean.totalMaterialChars = JSON.stringify(clean.items.map(item => item.material)).length
  rehashSelection(clean)
  for (const mutate of variants) {
    const raw = structuredClone(clean)
    mutate(raw); rehashSelection(raw); service.selections.map.set(created.selectionId, raw)
    assert.throws(() => service.resolveMaterial(created.selectionId), /corrupt/)
  }
  const malformed = structuredClone(clean)
  malformed.items[0].material.media[0].url = 'file:///secret.png'
  rehashMaterial(malformed.items[0].material)
  malformed.totalMaterialChars = JSON.stringify(malformed.items.map(item => item.material)).length
  rehashSelection(malformed)
  service.selections.map.set(created.selectionId, malformed)
  assert.throws(() => service.resolveMaterial(created.selectionId), /corrupt/)
})

test('uses richer head-middle-tail content in bounded reviewer cards', async () => {
  const ambiguous = claim('2', 'ambiguous', 'Ambiguous AI business')
  ambiguous.record.item.description = 'Read more'
  ambiguous.record.item.content = `HEAD-${'x'.repeat(350)}-MIDDLE-${'y'.repeat(350)}-TAIL`
  const { service } = fixture({ matched: [], ambiguous: [ambiguous] })
  let observed
  service.registerReviewer({ id: 'reviewer', fingerprint: 'b'.repeat(64), batchSize: 10, maxCards: 20, maxCardChars: 800, unmatchedAuditPercent: 0,
    async reviewBatch(cards) { observed = cards[0]; return [{ storeId: cards[0].storeId, decision: 'relevant', topics: ['foundation-models'], reasonCode: 'substantive-ai' }] } })
  await service.create({}, { agent: {} })
  assert.match(observed.context, /HEAD-/)
  assert.match(observed.context, /MIDDLE/)
  assert.match(observed.context, /-TAIL/)
  assert.ok(JSON.stringify(observed).length <= 800)
})

test('rolls back a selection persisted concurrently with cancellation', async () => {
  const { service } = fixture()
  const controller = new AbortController()
  let release; let entered
  const blocked = new Promise(resolve => { entered = resolve })
  service.selections = new Table({ afterPut: async () => { entered(); await new Promise(resolve => { release = resolve }) } })
  const active = service.create({}, { signal: controller.signal })
  await blocked
  controller.abort(new Error('cancel during put'))
  release()
  await assert.rejects(active, /cancel during put/)
  assert.equal(service.selections.map.size, 0)
})

test('accounts exact material array characters and rejects authoritative excerpt mutation', async () => {
  const { service, records } = fixture()
  const created = await service.create({}, {})
  const raw = service.selections.map.get(created.selectionId)
  assert.equal(raw.totalMaterialChars, JSON.stringify(raw.items.map(item => item.material)).length)
  service.revalidateSelectionClaims = () => true
  records[0].record.item.description = `X${records[0].record.item.description.slice(1)}`
  assert.throws(() => service.resolveMaterial(created.selectionId), /excerpt no longer matches/)
})
