import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismContentStore } from '../lib/store-content.js'

class Table {
  constructor() { this.map = new Map(); this.fail = false }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { if (this.fail) throw new Error('storage unavailable'); this.map.set(key, structuredClone(value)) }
}
function item(id, description = `content-${id}`) {
  return { id, title: `Title ${id}`, url: `https://example.test/${id}`, description, published_date: '2026-01-01T00:00:00.000Z', source: 'Fixture', category: 'test' }
}

test('content batch skips malformed and empty individual rows while persisting later valid rows', async () => {
  const store = new PrismContentStore(new Context()); store.items = new Table()
  const circular = item('circular'); circular.metadata = {}; circular.metadata.self = circular.metadata
  const summary = await store.putBatch('rss:fixture', [item('one'), null, item('empty', '   '), circular, item('two')], { now: new Date('2026-01-02T00:00:00.000Z') })
  assert.deepEqual(summary, { inserted: 2, updated: 0, skipped: 3, total: 5 })
  assert.deepEqual([...store.items.map.values()].map(record => record.externalId), ['one', 'two'])
})

test('content batch still fails closed for storage errors and cancellation', async () => {
  const store = new PrismContentStore(new Context()); store.items = new Table(); store.items.fail = true
  await assert.rejects(store.putBatch('rss:fixture', [item('one')]), /storage unavailable/u)
  store.items.fail = false
  const controller = new AbortController(); controller.abort('cancelled')
  await assert.rejects(store.putBatch('rss:fixture', [item('two')], { signal: controller.signal }), /persistence aborted/u)
})

test('content listing supports deterministic sorting, paging, searching, and category facets', async () => {
  const store = new PrismContentStore(new Context()); store.items = new Table()
  const rows = [
    { ...item('zeta'), title: 'Zeta', category: 'news', published_date: '2026-01-03T00:00:00.000Z' },
    { ...item('alpha'), title: 'Alpha', category: 'paper', published_date: '2026-01-01T00:00:00.000Z' },
    { ...item('beta'), title: 'Beta', category: 'news', published_date: '2026-01-02T00:00:00.000Z' },
  ]
  await store.putBatch('rss:fixture', rows, { now: new Date('2026-01-04T00:00:00.000Z') })
  assert.deepEqual(store.list({ sortBy: 'title', sortOrder: 'asc', limit: 2, offset: 0 }).map(record => record.item.title), ['Alpha', 'Beta'])
  assert.deepEqual(store.list({ sortBy: 'publishedAt', sortOrder: 'asc', limit: 2, offset: 1 }).map(record => record.item.title), ['Beta', 'Zeta'])
  assert.deepEqual(store.list({ category: 'news', search: 'beta', limit: 20 }).map(record => record.item.title), ['Beta'])
  assert.deepEqual(store.categoryCounts(), [{ category: 'news', count: 2 }, { category: 'paper', count: 1 }])
  const aiProcessed = record => record.externalId === 'beta'
  assert.deepEqual(store.list({ limit: 20 }, aiProcessed).map(record => record.item.title), ['Beta'])
  assert.equal(store.count({}, aiProcessed), 1)
  assert.deepEqual(store.categoryCounts(aiProcessed), [{ category: 'news', count: 1 }])
  assert.throws(() => store.list({}, 'invalid'), /filter must be a function/u)
  assert.throws(() => store.list({ sortBy: 'invalid' }), /sortBy is invalid/u)
})
