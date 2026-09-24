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
  assert.deepEqual([...tools.keys()], ['prismflow_content', 'prismflow_sync_source', 'prismflow_content_hot_keywords'])
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

test('prismflow_content_hot_keywords extracts top keywords from recent AI summaries via subagent', async () => {
  const tools = new Map()
  const subagentCalls = []
  const now = new Date()
  const within24Hours = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const olderThan24Hours = new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString()

  const records = [
    {
      storeId: '1'.repeat(64),
      sourceId: 'rss:tech',
      item: {
        title: 'DeepSeek发布新架构',
        published_date: within24Hours,
        category: 'tech',
        metadata: { ai_summary: '**DeepSeek发布开源新模型。** 性能大幅提升。' },
      },
    },
    {
      storeId: '2'.repeat(64),
      sourceId: 'rss:tech',
      fetchedAt: within24Hours,
      item: {
        title: 'OpenAI发布新功能',
        published_date: olderThan24Hours,
        category: 'tech',
      },
    },
    {
      storeId: '3'.repeat(64),
      sourceId: 'rss:old',
      fetchedAt: olderThan24Hours,
      item: {
        title: '超期新闻',
        published_date: olderThan24Hours,
        metadata: { ai_summary: '旧闻' },
      },
    },
  ]

  const reviews = new Map([
    ['2'.repeat(64), {
      aiSummary: '**OpenAI发布GPT-5更新。** 算力与推理大幅优化。',
      reviewedAt: within24Hours,
    }],
  ])

  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    prismSources: {},
    prismContentStore: {
      records(filter) {
        return records.filter(r => !filter || filter(r))
      },
    },
    prismContentSelections: {
      getReview(storeId) { return reviews.get(storeId) },
    },
    subagents: {
      async start(provider, options) {
        subagentCalls.push({ provider, options })
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            structured: {
              keywords: [
                { keyword: 'DeepSeek', weight: 10, summaryCount: 1, sampleSummaries: ['**DeepSeek发布开源新模型。** 性能大幅提升。'] },
                { keyword: 'OpenAI', weight: 8, summaryCount: 1, sampleSummaries: ['**OpenAI发布GPT-5更新。** 算力与推理大幅优化。'] },
              ],
            },
          }),
          async dispose() {},
        }
      },
    },
  }

  apply(ctx)
  const hotTool = tools.get('prismflow_content_hot_keywords')
  assert.ok(hotTool)

  const exec = { signal: new AbortController().signal, agent: { id: 'test-agent' } }
  const result = await hotTool.execute({ hours: 24, top: 10 }, exec)

  assert.equal(result.totalSummariesAnalyzed, 2)
  assert.equal(result.timeWindowHours, 24)
  assert.equal(result.keywords.length, 2)
  assert.equal(result.keywords[0].keyword, 'DeepSeek')
  assert.equal(result.keywords[0].weight, 10)
  assert.equal(result.keywords[1].keyword, 'OpenAI')
  assert.equal(subagentCalls.length, 1)
  assert.match(subagentCalls[0].options.prompt[0].text, /DeepSeek/u)
  assert.match(subagentCalls[0].options.prompt[0].text, /OpenAI/u)
  assert.doesNotMatch(subagentCalls[0].options.prompt[0].text, /旧闻/u)

  // Test empty summaries window
  const emptyResult = await hotTool.execute({ hours: 1, category: 'non-existent' }, exec)
  assert.equal(emptyResult.totalSummariesAnalyzed, 0)
  assert.deepEqual(emptyResult.keywords, [])
})

test('prismflow_content_hot_keywords partitions large batches and handles map-reduce', async () => {
  const tools = new Map()
  const subagentCalls = []
  const now = new Date()
  const recent = new Date(now.getTime() - 1000 * 60).toISOString()

  // Generate 125 items so it splits into 2 batches (max 120 per batch)
  const records = Array.from({ length: 125 }, (_, i) => ({
    storeId: `${i}`.padStart(64, '0'),
    sourceId: 'rss:test',
    fetchedAt: recent,
    item: {
      title: `新闻标题 ${i}`,
      published_date: recent,
      metadata: { ai_summary: `**第${i}条AI摘要。** 提到大模型和算力发展。` },
    },
  }))

  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    prismSources: {},
    prismContentStore: {
      records(filter) { return records.filter(r => !filter || filter(r)) },
    },
    prismContentSelections: {
      getReview() { return undefined },
    },
    subagents: {
      async start(provider, options) {
        subagentCalls.push({ provider, options })
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            structured: {
              keywords: [
                { keyword: '大模型', weight: 5, summaryCount: 15, sampleSummaries: ['摘要大模型样本'] },
                { keyword: '算力', weight: 3, summaryCount: 10, sampleSummaries: ['摘要算力样本'] },
              ],
            },
          }),
          async dispose() {},
        }
      },
    },
  }

  apply(ctx)
  const hotTool = tools.get('prismflow_content_hot_keywords')
  const exec = { signal: new AbortController().signal, agent: { id: 'test-agent' } }
  const result = await hotTool.execute({ hours: 24, top: 10 }, exec)

  assert.equal(result.totalSummariesAnalyzed, 125)
  // 125 items partitioned by 120 => 2 map calls
  assert.equal(subagentCalls.length, 2)
  assert.equal(result.keywords.length, 2)
  assert.equal(result.keywords[0].keyword, '大模型')
  // Aggregated weights: 5 + 5 = 10
  assert.equal(result.keywords[0].weight, 10)
  assert.equal(result.keywords[0].summaryCount, 30)
})

test('prismflow_content_hot_keywords binary splits failing batch to recover keywords', async () => {
  const tools = new Map()
  const calls = []
  const now = new Date()
  const recent = new Date(now.getTime() - 1000 * 60).toISOString()

  // 10 items in 1 batch, but first attempt on whole batch fails repeatedly
  const records = Array.from({ length: 10 }, (_, i) => ({
    storeId: `${i}`.padStart(64, '0'),
    sourceId: 'rss:test',
    fetchedAt: recent,
    item: {
      title: `测试新闻 ${i}`,
      published_date: recent,
      metadata: { ai_summary: `**第${i}条摘要。** 涉及量子计算与超导。` },
    },
  }))

  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    prismSources: {},
    prismContentStore: {
      records(filter) { return records.filter(r => !filter || filter(r)) },
    },
    prismContentSelections: {
      getReview() { return undefined },
    },
    subagents: {
      async start(provider, options) {
        calls.push(options)
        const promptText = options.prompt[0].text
        // If the prompt contains 10 items (whole batch), simulate failure
        if (promptText.includes('[10]')) {
          return {
            result: Promise.resolve({
              stopReason: 'completed',
              structured: { keywords: [] }, // fails validation and triggers split
            }),
            async dispose() {},
          }
        }
        // Sub-batches succeed
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            structured: {
              keywords: [
                { keyword: '量子计算', weight: 4, summaryCount: 3, sampleSummaries: ['量子计算突破'] },
              ],
            },
          }),
          async dispose() {},
        }
      },
    },
  }

  apply(ctx)
  const hotTool = tools.get('prismflow_content_hot_keywords')
  const exec = { signal: new AbortController().signal, agent: { id: 'test-agent' } }
  const result = await hotTool.execute({ hours: 24, top: 10 }, exec)

  assert.equal(result.totalSummariesAnalyzed, 10)
  // Failed 3 times on root batch (split:0), then split into 2 sub-batches (split:1, 5 items each)
  assert.ok(calls.length >= 5)
  assert.equal(result.keywords.length, 1)
  assert.equal(result.keywords[0].keyword, '量子计算')
  // 4 + 4 = 8
  assert.equal(result.keywords[0].weight, 8)
})
