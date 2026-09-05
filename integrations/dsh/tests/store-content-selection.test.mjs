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
function editorialResult(card, aiScore = 85, topics = ['foundation-models']) {
  const media = card.media?.[0]
  const mediaText = media?.kind === 'video'
    ? `<br/><video src="${media.url}" controls="controls" width="100%"></video><br/>`
    : media ? `<br/>![AI资讯：人工智能模型资讯画面](${media.url})<br/>` : ''
  const seo = '最新模型资讯说明'
  return {
    storeId: card.storeId,
    aiSummary: `**人工智能模型迎来重要发布。** 行业主体公布核心技术进展。 [${seo}](${card.articleUrl})正在受到关注。 生态应用范围正在持续扩大。 用户落地速度正在逐步加快。${mediaText}`,
    aiScore,
    reason: `AI相关性(40%):${aiScore}分，核心模型；新闻新鲜度(20%):${aiScore}分，及时；炸裂程度(20%):${aiScore}分，较高；影响力(20%):${aiScore}分，广泛。因此综合评分为${aiScore}分。`,
    topics,
  }
}
async function clusterCards(cards) {
  const groups = new Map()
  for (const card of cards) { const values = groups.get(card.title) ?? []; values.push(card.storeId); groups.set(card.title, values) }
  return [...groups.values()]
}
function defaultReviewer(service) {
  service.registerReviewer({
    id: 'editorial-reviewer', fingerprint: 'e'.repeat(64), batchSize: 24, maxCards: 5000,
    maxCardChars: 6000, minimumAiScore: 60, clusterAll: clusterCards,
    async reviewBatch(cards) { return cards.map(card => editorialResult(card)) },
  })
}
function fixture({ matched = [claim('1')], ambiguous = [], unmatched = [], revalidate = () => true, config = {}, reviewer = true } = {}) {
  const ctx = new Context(); const providers = new Map()
  Object.defineProperty(ctx, 'prismContentRelevance', { value: {
    async snapshotCurrent() { return { asOf: '2026-08-20T12:00:00.000Z', since: '2026-08-18T12:00:00.000Z', hours: 48, classifierVersion: 'v1', relevanceProfileFingerprint: 'a'.repeat(64), candidateCount: matched.length + ambiguous.length + unmatched.length, matched, ambiguous, unmatched } },
    currentContentClaim(storeId) { const value = [...matched, ...ambiguous, ...unmatched].find(item => item.record.storeId === storeId); return value ? { contentHash: value.contentHash, relevanceProfileFingerprint: 'a'.repeat(64) } : undefined },
    revalidateClaims: revalidate,
  } })
  Object.defineProperty(ctx, 'prismContentStore', { value: { get(id) { return [...matched, ...ambiguous, ...unmatched].find(item => item.record.storeId === id)?.record } } })
  Object.defineProperty(ctx, 'prismProduction', { value: { registerMaterialProvider(provider) { providers.set(provider.id, provider); return () => providers.delete(provider.id) } } })
  const service = new PrismContentSelectionStore(ctx, { maxMaterialChars: 20000, maxInputTokens: 20000, defaultMaxInputTokens: 10000, ...config })
  service.reviews = new Table(); service.selections = new Table()
  if (reviewer) defaultReviewer(service)
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

test('creates immutable hash-bound selection, AI-reviews every candidate, caches reviews and resolves scored material', async () => {
  const ambiguous = [claim('2', 'ambiguous', 'AI stock and model business')]
  const { service } = fixture({ ambiguous, reviewer: false })
  const batches = []; const clusterCalls = []
  service.registerReviewer({ id: 'reviewer', fingerprint: 'b'.repeat(64), batchSize: 10, maxCards: 20, maxCardChars: 6000, minimumAiScore: 60,
    async clusterAll(cards) { clusterCalls.push(cards); return clusterCards(cards) },
    async reviewBatch(cards) { batches.push(cards); return cards.map(card => editorialResult(card)) } })
  const first = await service.create({ maxItems: 2 }, { agent: {}, signal: new AbortController().signal })
  assert.equal(first.selectedCount, 2)
  assert.ok(Array.isArray(first.sourceIds) && first.sourceIds.length > 0)
  assert.equal(batches.flat().length, 2)
  assert.equal(clusterCalls.length, 1)
  assert.equal(clusterCalls[0].length, 2)
  const projectedReview = service.getReview('1'.padStart(64, '0'))
  assert.deepEqual(Object.keys(projectedReview).sort(), ['aiScore', 'aiSummary', 'reason', 'reviewedAt'])
  assert.equal(projectedReview.aiScore, 85)
  assert.equal(service.getReview('missing'), undefined)
  assert.deepEqual(Object.keys(clusterCalls[0][0]).sort(), ['storeId', 'summary', 'title'])
  assert.equal(JSON.stringify(first).includes('excerpts'), false)
  const second = await service.create({ maxItems: 2 }, { agent: {}, signal: new AbortController().signal })
  assert.notEqual(second.selectionId, first.selectionId)
  assert.equal(batches.flat().length, 2)
  assert.equal(clusterCalls.length, 2)
  const resolved = service.resolveMaterial(first.selectionId)
  assert.equal(resolved.packedMaterials.length, 2)
  assert.ok(resolved.packedMaterials.every(item => JSON.stringify(item).length < 5000))
  assert.throws(() => { const raw = service.selections.map.get(first.selectionId); raw.items[0].material.title = 'tampered'; service.resolveMaterial(first.selectionId) }, /corrupt/)
})

test('fails closed on unavailable reviewer, content race, overlapping creation and shutdown', async () => {
  const ambiguous = [claim('2', 'ambiguous')]
  await assert.rejects(fixture({ ambiguous, reviewer: false }).service.create({}, { agent: {} }), /reviewer is unavailable/)
  const raced = fixture()
  raced.service.revalidateSelectionClaims = () => { throw new Error('changed during selection') }
  await assert.rejects(raced.service.create({}, { agent: {} }), /changed during selection/)
  assert.equal(raced.service.selections.map.size, 0)

  let release; let enteredResolve
  const blocked = fixture({ ambiguous, reviewer: false })
  blocked.service.registerReviewer({ id: 'r', fingerprint: 'c'.repeat(64), batchSize: 10, maxCards: 20, maxCardChars: 6000, minimumAiScore: 60, clusterAll: clusterCards,
    reviewBatch(cards) { enteredResolve(); return new Promise(resolve => { release = () => resolve(cards.map(card => editorialResult(card, 20, []))) }) } })
  const entered = new Promise(resolve => { enteredResolve = resolve })
  const active = blocked.service.create({}, { agent: {} })
  await entered
  await assert.rejects(blocked.service.create({}, { agent: {} }), /already running/)
  const stopped = blocked.service.shutdown(); release()
  await assert.rejects(active)
  await stopped
})

test('minimum AI score admits 70 and rejects 69', async () => {
  const matched = [claim('1'), claim('2')]
  const { service } = fixture({ matched, reviewer: false })
  service.registerReviewer({
    id: 'threshold-reviewer', fingerprint: '9'.repeat(64), batchSize: 2, maxCards: 2,
    maxCardChars: 6000, minimumAiScore: 70, clusterAll: clusterCards,
    async reviewBatch(cards) { return cards.map((card, index) => editorialResult(card, index === 0 ? 69 : 70)) },
  })
  const result = await service.create({ maxItems: 2 }, { agent: {} })
  assert.equal(result.selectedCount, 1)
  assert.deepEqual(result.contentStoreIds, [matched[1].record.storeId])
})

test('editorial review may exceed one clustering-call card ceiling', async () => {
  const matched = [claim('1'), claim('2'), claim('3')]
  const { service } = fixture({ matched, reviewer: false })
  let clustered = 0
  service.registerReviewer({
    id: 'partitioning-reviewer', fingerprint: 'f'.repeat(64), batchSize: 2, maxCards: 2,
    maxCardChars: 6000, minimumAiScore: 60,
    async reviewBatch(cards) { return cards.map(card => editorialResult(card)) },
    async clusterAll(cards) { clustered = cards.length; return clusterCards(cards) },
  })
  const result = await service.create({ maxItems: 3 }, { agent: {} })
  assert.equal(result.selectedCount, 3)
  assert.equal(clustered, 3)
})

test('handles 2000 scored candidates within one complete AI-decided grouping and bounded material selection', async () => {
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
  const { service } = fixture({ matched: [claim('1')], unmatched: quotaRows, config, reviewer: false })
  const reviewed = []
  service.registerReviewer({ id: 'quota-reviewer', fingerprint: 'd'.repeat(64), batchSize: 24, maxCards: 500, maxCardChars: 6000, minimumAiScore: 60, clusterAll: clusterCards,
    async reviewBatch(cards) { reviewed.push(...cards); return cards.map(card => editorialResult(card, 85, ['frameworks-deployment'])) } })
  const result = await service.create({}, { agent: {} })
  assert.equal(reviewed.length, 4)
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

  for (const strategyVersion of ['ai-selection-v2', 'ai-selection-v3']) {
    const current = await service.create({}, {})
    const old = structuredClone(service.selections.map.get(current.selectionId))
    old.strategyVersion = strategyVersion
    rehashSelection(old)
    service.selections.map.set(current.selectionId, old)
    assert.throws(() => service.resolveMaterial(current.selectionId), /corrupt/)
  }

  const over = claim('9')
  over.record.item.description += ' https://cdn.example.test/one.jpg https://cdn.example.test/two.jpg'
  const boundedFixture = fixture({ matched: [over], config: { maxMediaPerItem: 1 } })
  const bounded = await boundedFixture.service.create({}, {})
  assert.equal(boundedFixture.service.resolveMaterial(bounded.selectionId).packedMaterials[0].media.length, 1)
})

test('physically purges v1-v3 selections and pre-editorial review cache rows', async () => {
  const { service } = fixture()
  const current = await service.create({}, {})
  for (const strategyVersion of ['ai-selection-v1', 'ai-selection-v2', 'ai-selection-v3']) {
    service.selections.map.set(strategyVersion, { strategyVersion })
  }
  service.selections.map.set('unknown', { strategyVersion: 'unknown-version' })
  service.reviews.map.set('legacy', { decision: 'relevant' })
  service.reviews.map.set('current', { version: 2 })
  await service.purgeLegacyState()
  assert.equal(service.selections.map.has(current.selectionId), true)
  assert.equal(service.selections.map.has('ai-selection-v1'), false)
  assert.equal(service.selections.map.has('ai-selection-v2'), false)
  assert.equal(service.selections.map.has('ai-selection-v3'), false)
  assert.equal(service.selections.map.has('unknown'), true)
  assert.equal(service.reviews.map.has('legacy'), false)
  assert.equal(service.reviews.map.has('current'), true)
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
  const { service } = fixture({ matched: [], ambiguous: [ambiguous], reviewer: false })
  let observed
  service.registerReviewer({ id: 'reviewer', fingerprint: 'b'.repeat(64), batchSize: 10, maxCards: 20, maxCardChars: 6000, minimumAiScore: 60, clusterAll: clusterCards,
    async reviewBatch(cards) { observed = cards[0]; return [editorialResult(cards[0])] } })
  await service.create({}, { agent: {} })
  assert.match(observed.rawMarkdown, /HEAD-/)
  assert.match(observed.rawMarkdown, /MIDDLE/)
  assert.match(observed.rawMarkdown, /-TAIL/)
  assert.ok(JSON.stringify(observed).length <= 6000)
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
