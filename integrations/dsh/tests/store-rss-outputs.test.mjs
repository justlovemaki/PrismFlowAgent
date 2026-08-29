import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismRssOutputStore } from '../lib/store-rss-outputs.js'

class Table {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { this.map.set(key, structuredClone(value)) }
}
function output(overrides = {}) {
  return { draftId: 'draft-1', draftVersion: 2, artifactSha256: 'a'.repeat(64), title: 'RSS Daily', markdown: '# Daily',
    htmlContent: '<h1>Daily</h1>', xml: '<?xml version="1.0"?><rss><channel/></rss>', itemUrl: 'https://example.com/docs/draft-1/', ...overrides }
}

test('RSS outputs persist exact XML locally, deduplicate exact generation, and retain provenance', async () => {
  const store = new PrismRssOutputStore(new Context(), { maxOutputs: 10, maxXmlBytes: 100_000 }); store.outputs = new Table()
  const first = await store.save(output())
  const replay = await store.save(output())
  assert.equal(first.outputId, replay.outputId); assert.equal(store.outputs.map.size, 1)
  assert.equal(store.get(first.outputId).xml, output().xml)
  assert.deepEqual(store.list({ draftId: 'draft-1', limit: 10 }).map(item => item.outputId), [first.outputId])
  const changed = await store.save(output({ xml: '<?xml version="1.0"?><rss><channel><title>Changed</title></channel></rss>' }))
  assert.notEqual(changed.outputId, first.outputId); assert.equal(store.outputs.map.size, 2)
})

test('RSS output persistence enforces bounds and fails closed on corruption', async () => {
  const store = new PrismRssOutputStore(new Context(), { maxOutputs: 1, maxXmlBytes: 1_024 }); store.outputs = new Table()
  const saved = await store.save(output())
  await assert.rejects(store.save(output({ draftId: 'draft-2', xml: '<rss>different</rss>' })), /limit is reached/u)
  await assert.rejects(new PrismRssOutputStore(new Context(), { maxOutputs: 10, maxXmlBytes: 1_024 }).save(output()), /unavailable/u)
  store.outputs.map.set(saved.outputId, { ...store.outputs.map.get(saved.outputId), xml: '<rss>tampered</rss>' })
  assert.throws(() => store.get(saved.outputId), /corrupt/u)
})
