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
