import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../lib/tool-content.js'

test('content Chat surface exposes only durable source synchronization', async () => {
  const tools = new Map(); const calls = []
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    prismSources: { async fetch(sourceId, request, execution) { calls.push({ sourceId, request, execution }); return [{ id: 'one' }] } },
    prismContentStore: { async putBatch(sourceId, items, options) { calls.push({ sourceId, items, options }); return { inserted: 1, updated: 0, skipped: 0, total: 1 } } },
  }
  apply(ctx)
  assert.deepEqual([...tools.keys()], ['prismflow_sync_source'])
  const exec = { signal: new AbortController().signal, agent: { id: 'agent' } }
  const result = await tools.get('prismflow_sync_source').execute({ sourceId: 'follow:news', limit: 10, overwrite: false }, exec)
  assert.deepEqual(result, { fetched: 1, inserted: 1, updated: 0, skipped: 0, total: 1 })
  assert.deepEqual(calls[0], { sourceId: 'follow:news', request: { limit: 10 }, execution: exec })
  assert.equal(calls[1].sourceId, 'follow:news'); assert.deepEqual(calls[1].items, [{ id: 'one' }])
  assert.equal(calls[1].options.signal, exec.signal)
})
