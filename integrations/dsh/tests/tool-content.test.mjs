import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../lib/tool-content.js'

test('content Chat surface reads bounded persisted records and keeps source synchronization explicit', async () => {
  const tools = new Map(); const calls = []
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    prismSources: { async fetch(sourceId, request, execution) { calls.push({ sourceId, request, execution }); return [{ id: 'one' }] } },
    prismContentStore: {
      count(query) { calls.push({ operation: 'count', query }); return 1 },
      list(query) { calls.push({ operation: 'list', query }); return [{
        storeId: 'a'.repeat(64), sourceId: 'follow:news', externalId: 'one', status: 'unread',
        fetchedAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
        item: { title: 'AI News', url: 'https://example.test/news', description: 'Summary', content: `Body ${'x'.repeat(7000)}`,
          published_date: '2026-01-01T00:00:00.000Z', source: 'Fixture', category: 'news', author: 'Author', metadata: { ai_summary: 'AI summary' } },
      }] },
      async putBatch(sourceId, items, options) { calls.push({ sourceId, items, options }); return { inserted: 1, updated: 0, skipped: 0, total: 1 } },
    },
  }
  apply(ctx)
  assert.deepEqual([...tools.keys()], ['prismflow_content', 'prismflow_sync_source'])
  const contentTool = tools.get('prismflow_content')
  const content = await contentTool.execute({ sourceId: 'follow:news', search: 'AI', limit: 5, offset: 0 })
  assert.equal(content.total, 1); assert.equal(content.items[0].summary, 'AI summary')
  assert.equal(content.items[0].text.length, 6000); assert.equal(content.items[0].truncated, true)
  assert.equal(JSON.stringify(content).includes('metadata'), false)
  assert.deepEqual(calls.slice(0, 2), [
    { operation: 'count', query: { sourceId: 'follow:news', search: 'AI', limit: 5, offset: 0 } },
    { operation: 'list', query: { sourceId: 'follow:news', search: 'AI', limit: 5, offset: 0 } },
  ])
  await assert.rejects(contentTool.execute({ limit: 11 }), /limit must be an integer/u)

  const exec = { signal: new AbortController().signal, agent: { id: 'agent' } }
  const result = await tools.get('prismflow_sync_source').execute({ sourceId: 'follow:news', limit: 10, overwrite: false }, exec)
  assert.deepEqual(result, { fetched: 1, inserted: 1, updated: 0, skipped: 0, total: 1 })
  assert.deepEqual(calls[2], { sourceId: 'follow:news', request: { limit: 10 }, execution: exec })
  assert.equal(calls[3].sourceId, 'follow:news'); assert.deepEqual(calls[3].items, [{ id: 'one' }])
  assert.equal(calls[3].options.signal, exec.signal)
})
