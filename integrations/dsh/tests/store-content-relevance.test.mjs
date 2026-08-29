import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismContentRelevanceStore } from '../lib/store-content-relevance.js'

class Table {
  constructor(entries = []) { this.map = new Map(entries); this.beforePut = undefined }
  get(id) { return this.map.get(id) }
  entries() { return this.map.entries() }
  async put(id, value) { if (this.beforePut) await this.beforePut(); this.map.set(id, structuredClone(value)); return value }
}

function content(id, { title = 'DeepSeek large language model release', description = 'machine learning model details', published = '2026-08-20T00:00:00.000Z', firstSeen = '2026-08-20T00:00:00.000Z', sourceId = 'rss:test', category = 'news' } = {}) {
  return {
    storeId: id.toString().padStart(64, '0'), sourceId, firstSeenAt: firstSeen, updatedAt: firstSeen,
    item: { id: String(id), title, description, source: 'Fixture', category, published_date: published },
  }
}

function fixture(records, config = {}, assessments = new Table()) {
  const ctx = new Context()
  Object.defineProperty(ctx, 'prismContentStore', { value: {
    snapshot(maxRecords = 100_000) {
      if (records.length > maxRecords) throw new Error(`Content snapshot exceeds the configured ${maxRecords}-record limit`)
      return records
    },
    get(storeId) { return records.find(record => record?.storeId === storeId) },
  } })
  const service = new PrismContentRelevanceStore(ctx, config)
  service.assessments = assessments
  return service
}

const AS_OF = new Date('2026-08-20T12:00:00.000Z')

test('prepares a frozen 48-hour window, uses firstSeen fallback, caches exact hashes, and reports stale rows', async () => {
  const records = [
    content(1),
    content(2, { title: 'Cooking recipes', description: 'A complete guide to dinner', published: '', firstSeen: '2026-08-19T00:00:00.000Z' }),
    content(3, { published: '2026-08-17T00:00:00.000Z', firstSeen: '2026-08-17T00:00:00.000Z' }),
  ]
  const service = fixture(records)
  const first = await service.prepare({ hours: 48, asOf: AS_OF })
  assert.deepEqual({ candidates: first.candidateCount, assessed: first.assessed, matched: first.matchedAi, unmatched: first.unmatched }, { candidates: 2, assessed: 2, matched: 1, unmatched: 1 })
  const second = await service.prepare({ hours: 48, asOf: AS_OF })
  assert.equal(second.cached, 2)
  assert.equal(second.assessed, 0)
  const coverage = await service.coverage({ hours: 48, asOf: AS_OF })
  assert.equal(coverage.complete, true)
  records[0] = content(1, { title: 'Changed ordinary story', description: 'No recognized topic here' })
  const stale = await service.coverage({ hours: 48, asOf: AS_OF })
  assert.equal(stale.stale, 1)
  assert.equal(stale.currentAssessments, 1)
  await service.prepare({ hours: 48, asOf: AS_OF })
  assert.equal((await service.coverage({ hours: 48, asOf: AS_OF })).complete, true)
})

test('isolates corrupt cached rows and malformed records while compact query never returns bodies', async () => {
  const malformed = { storeId: 'b'.repeat(64), sourceId: 'bad', firstSeenAt: '2026-08-20T00:00:00.000Z', updatedAt: '', item: null }
  const records = [content(1), malformed]
  const service = fixture(records)
  service.assessments.map.set('corrupt', 'not-an-assessment')
  const summary = await service.prepare({ asOf: AS_OF })
  assert.equal(summary.failed, 0)
  assert.equal(summary.malformed, 1)
  assert.equal(summary.complete, false)
  assert.equal(summary.matchedAi, 1)
  const result = await service.query({ asOf: AS_OF, verdict: 'matched-ai' })
  assert.equal(result.total, 1)
  const encoded = JSON.stringify(result)
  assert.ok(encoded.length < 4000)
  assert.equal(Object.hasOwn(result.items[0], 'description'), false)
  assert.equal(Object.hasOwn(result.items[0], 'content'), false)
})

test('rejects overlap, propagates cancellation, leaves resumable cache, and shutdown drains', async () => {
  const service = fixture([content(1), content(2)])
  let release
  let enteredResolve
  const entered = new Promise(resolve => { enteredResolve = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  let first = true
  service.assessments.beforePut = async () => { if (first) { first = false; enteredResolve(); await blocked } }
  const controller = new AbortController()
  const active = service.prepare({ asOf: AS_OF }, { signal: controller.signal })
  await entered
  await assert.rejects(service.prepare({ asOf: AS_OF }), /already running/)
  controller.abort(new Error('caller cancelled'))
  release()
  await assert.rejects(active, /caller cancelled/)
  service.assessments.beforePut = undefined
  const resumed = await service.prepare({ asOf: AS_OF })
  assert.equal(resumed.cached, 1)
  assert.equal(resumed.assessed, 1)

  const stopping = fixture([content(3)])
  let stopRelease
  let stopEnteredResolve
  const stopEntered = new Promise(resolve => { stopEnteredResolve = resolve })
  stopping.assessments.beforePut = () => new Promise(resolve => { stopRelease = resolve; stopEnteredResolve() })
  const running = stopping.prepare({ asOf: AS_OF })
  await stopEntered
  const shutdown = stopping.shutdown()
  stopRelease()
  await assert.rejects(running, /stopping/)
  await shutdown
  await assert.rejects(stopping.prepare({ asOf: AS_OF }), /stopping/)
})

test('handles 2000 synthetic records with bounded persisted assessments and aggregate truncation', async () => {
  const records = Array.from({ length: 2000 }, (_, index) => content(index + 1, {
    title: index % 2 ? 'Ordinary local report' : 'Machine learning research',
    description: index % 2 ? 'Weather and community information' : 'A neural network study',
  }))
  const service = fixture(records, { maxScanCharsPerRecord: 4096, maxAggregateScanChars: 20_000_000, maxEvidence: 2, maxEvidenceChars: 80, maxCardChars: 1000 })
  const summary = await service.prepare({ asOf: AS_OF })
  assert.equal(summary.candidateCount, 2000)
  assert.equal(summary.assessed, 2000)
  assert.equal(summary.failed, 0)
  assert.equal(service.assessments.map.size, 2000)
  assert.equal((await service.coverage({ asOf: AS_OF })).complete, true)

  const limitedRecords = [
    content(3001, { title: 'Ordinary report', description: 'x'.repeat(600_000) }),
    content(3002, { title: 'Ordinary report', description: `${'y'.repeat(599_900)} machine learning` }),
  ]
  const limitedTable = new Table()
  const limitedConfig = {
    maxHashCharsPerRecord: 700_000, maxAggregateHashChars: 2_000_000,
    maxScanCharsPerRecord: 600_000, maxAggregateScanChars: 1_048_576,
  }
  const limited = fixture(limitedRecords, limitedConfig, limitedTable)
  const partial = await limited.prepare({ asOf: AS_OF })
  assert.equal(partial.complete, false)
  assert.equal(partial.incomplete, 1)
  assert.equal(limitedTable.map.size, 1)
  const retry = fixture([limitedRecords[1]], { ...limitedConfig, maxAggregateScanChars: 2_000_000 }, limitedTable)
  const retried = await retry.prepare({ asOf: AS_OF })
  assert.equal(retried.assessed, 1)
  assert.equal(retried.ambiguous, 1)
  assert.equal(limitedTable.map.size, 2)
})

test('profile changes invalidate and overwrite one current assessment row per store', async () => {
  const records = [content(4001, { title: 'Ordinary report', description: 'AI stock commentary' })]
  const table = new Table()
  const first = fixture(records, { maxEvidence: 2 }, table)
  await first.prepare({ asOf: AS_OF })
  assert.equal(table.map.size, 1)
  assert.equal((await first.coverage({ asOf: AS_OF })).complete, true)

  const changed = fixture(records, { maxEvidence: 3 }, table)
  const stale = await changed.coverage({ asOf: AS_OF })
  assert.equal(stale.stale, 1)
  assert.equal(stale.currentAssessments, 0)
  const refreshed = await changed.prepare({ asOf: AS_OF })
  assert.equal(refreshed.assessed, 1)
  assert.equal(table.map.size, 1)
  assert.equal((await changed.coverage({ asOf: AS_OF })).complete, true)
})

test('deeply rejects corrupt nested rows and wrong-key payloads without crashing queries', async () => {
  const records = [content(5001), content(5002)]
  const table = new Table()
  const service = fixture(records, {}, table)
  await service.prepare({ asOf: AS_OF })
  const firstKey = records[0].storeId
  const secondKey = records[1].storeId
  table.map.set(firstKey, { ...table.map.get(firstKey), evidence: [null] })
  table.map.set(secondKey, { ...table.map.get(secondKey), storeId: firstKey })
  const coverage = await service.coverage({ asOf: AS_OF })
  assert.equal(coverage.failed, 2)
  assert.equal(coverage.currentAssessments, 0)
  const result = await service.query({ asOf: AS_OF })
  assert.equal(result.failed, 2)
  assert.deepEqual(result.items, [])
})

test('malformed category and sort fields are isolated before filtering and sorting', async () => {
  const malformed = [
    { storeId: 'm'.repeat(64), sourceId: 'rss:test', firstSeenAt: AS_OF.toISOString(), updatedAt: 42, item: null },
    { storeId: 'n'.repeat(64), sourceId: 'rss:test', firstSeenAt: AS_OF.toISOString(), updatedAt: null, item: { category: 'news' } },
  ]
  const service = fixture([content(6001), ...malformed])
  const prepared = await service.prepare({ asOf: AS_OF, category: 'news' })
  assert.equal(prepared.candidateCount, 2)
  assert.equal(prepared.malformed, 1)
  assert.equal(prepared.failed, 0)
  await assert.doesNotReject(service.query({ asOf: AS_OF, category: 'news' }))
})

test('per-record and aggregate hash budgets skip oversized work safely', async () => {
  const oversized = content(7001, { title: 'DeepSeek', description: 'x'.repeat(1_100_000) })
  const normal = content(7002)
  const service = fixture([oversized, normal], {
    maxHashCharsPerRecord: 1_000_000,
    maxAggregateHashChars: 1_048_576,
    maxScanCharsPerRecord: 4096,
    maxAggregateScanChars: 1_048_576,
  })
  const result = await service.prepare({ asOf: AS_OF })
  assert.equal(result.incomplete, 1)
  assert.equal(result.assessed, 1)
  assert.equal(result.complete, false)
})

test('query pagination reuses one frozen asOf while later records stay outside the snapshot', async () => {
  const records = [
    content(8001, { published: '2026-08-20T11:00:00.000Z' }),
    content(8002, { published: '2026-08-20T10:00:00.000Z' }),
    content(8003, { published: '2026-08-20T13:00:00.000Z' }),
  ]
  const service = fixture(records)
  const prepared = await service.prepare({ asOf: AS_OF })
  assert.equal(prepared.candidateCount, 2)
  const first = await service.query({ asOf: AS_OF, limit: 1, offset: 0 })
  const second = await service.query({ asOf: AS_OF, limit: 1, offset: 1 })
  assert.equal(first.asOf, AS_OF.toISOString())
  assert.equal(second.asOf, first.asOf)
  assert.equal(first.total, 2)
  assert.notEqual(first.items[0].storeId, second.items[0].storeId)
  assert.equal([first, second].some(page => page.items.some(item => item.storeId === records[2].storeId)), false)
})

test('record ceilings reject high-cardinality snapshots before unbounded classification or query accumulation', async () => {
  const records = [content(10_001), content(10_002), content(10_003)]
  const candidateLimited = fixture(records, { maxCandidateRecords: 2 })
  await assert.rejects(candidateLimited.prepare({ asOf: AS_OF }), /2-candidate limit/)
  await assert.rejects(candidateLimited.query({ asOf: AS_OF }), /2-candidate limit/)

  const snapshotLimited = fixture(records, { maxSnapshotRecords: 2 })
  await assert.rejects(snapshotLimited.prepare({ asOf: AS_OF }), /2-record limit/)
  await assert.rejects(snapshotLimited.coverage({ asOf: AS_OF }), /2-record limit/)
})

test('internal frozen snapshot returns current claims without tool paging and revalidates later mutations', async () => {
  const records = [content(20_001), content(20_002, { title: 'AI stock', description: 'model business' })]
  const service = fixture(records)
  const snapshot = await service.snapshotCurrent({ asOf: AS_OF }, { signal: new AbortController().signal })
  assert.equal(snapshot.matched.length, 1)
  assert.equal(snapshot.ambiguous.length, 1)
  assert.equal(snapshot.unmatched.length, 0)
  assert.equal(snapshot.asOf, AS_OF.toISOString())
  const claim = { storeId: snapshot.matched[0].record.storeId, contentHash: snapshot.matched[0].contentHash }
  assert.equal(service.revalidateClaims([claim]), true)
  records[0] = content(20_001, { title: 'Changed title', description: 'Changed body' })
  assert.throws(() => service.revalidateClaims([claim]), /changed during selection/)
})

test('coverage and compact query propagate caller cancellation', async () => {
  const service = fixture(Array.from({ length: 100 }, (_, index) => content(9000 + index)))
  await service.prepare({ asOf: AS_OF })
  const controller = new AbortController()
  controller.abort(new Error('read cancelled'))
  await assert.rejects(service.coverage({ asOf: AS_OF }, { signal: controller.signal }), /read cancelled/)
  await assert.rejects(service.query({ asOf: AS_OF }, { signal: controller.signal }), /read cancelled/)
})
