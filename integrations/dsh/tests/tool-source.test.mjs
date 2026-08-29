import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/tool-source.js'

test('source Chat surface exposes only configured-source discovery', async () => {
  const tools = new Map()
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    prismSources: {
      list: () => [{ id: 'rss:news', name: 'News', description: 'Configured', requiresAgent: false }],
      async fetch() { throw new Error('raw source preview must not be exposed to Chat') },
    },
  }
  apply(ctx)
  assert.deepEqual([...tools.keys()], ['prismflow_sources'])
  const value = await tools.get('prismflow_sources').execute({})
  assert.equal(value[0].id, 'rss:news')
  assert.match(tools.get('prismflow_sources').output.render({}, value)[0].text, /rss:news/u)
})
