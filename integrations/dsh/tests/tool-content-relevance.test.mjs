import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { assessAIRelevance, buildAIRelevanceCard } from '../lib/shared/ai-relevance.js'
import { apply } from '../lib/tool-content-relevance.js'

function harness() {
  const tools = new Map()
  const calls = { prepare: [], coverage: [], query: [] }
  const service = {
    async prepare(query, execution) { calls.prepare.push({ query, execution }); return { asOf: '2026-08-20T00:00:00.000Z', since: '2026-08-18T00:00:00.000Z', hours: 48, candidateCount: 5, assessed: 2, cached: 3, matchedAi: 1, ambiguous: 1, unmatched: 3, failed: 0, incomplete: 0, malformed: 0, complete: true } },
    coverage(query) { calls.coverage.push(query); return { asOf: '2026-08-20T00:00:00.000Z', since: '2026-08-18T00:00:00.000Z', hours: 48, candidateCount: 5, currentAssessments: 5, matchedAi: 1, ambiguous: 1, unmatched: 3, missing: 0, stale: 0, failed: 0, malformed: 0, complete: true } },
    query(query) { calls.query.push(query); return { asOf: '2026-08-20T00:00:00.000Z', since: '2026-08-18T00:00:00.000Z', total: 1, missing: 0, stale: 0, failed: 0, malformed: 0, items: [{ storeId: 'a'.repeat(64), sourceId: 'rss:test', title: 'AI', url: '', source: 'Fixture', category: 'news', publishedAt: '2026-08-20T00:00:00.000Z', verdict: 'ambiguous', topics: [], reasonCodes: ['ambiguous-ai-terms-only'], evidence: [], timestampBasis: 'published_date' }] } },
  }
  apply({ tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, prismContentRelevance: service })
  return { tools, calls }
}

test('relevance tools expose only bounded fixed filters and compact results', async () => {
  const { tools, calls } = harness()
  assert.deepEqual([...tools.keys()], ['prismflow_prepare_ai_relevance', 'prismflow_count_ai_relevance', 'prismflow_query_ai_content'])
  for (const tool of tools.values()) {
    const names = Object.keys(tool.parameters.properties)
    for (const forbidden of ['description', 'content', 'body', 'taxonomy', 'regex', 'provider', 'tool', 'prompt']) assert.equal(names.includes(forbidden), false)
  }
  const signal = new AbortController().signal
  await tools.get('prismflow_prepare_ai_relevance').execute({ hours: 48 }, { signal })
  assert.equal(calls.prepare[0].execution.signal, signal)
  assert.deepEqual(await tools.get('prismflow_count_ai_relevance').execute({ hours: 48 }), {
    asOf: '2026-08-20T00:00:00.000Z', since: '2026-08-18T00:00:00.000Z', hours: 48,
    candidateCount: 5, currentAssessments: 5, matchedAi: 1, ambiguous: 1, unmatched: 3, missing: 0, stale: 0, failed: 0, malformed: 0, complete: true,
  })
  const result = await tools.get('prismflow_query_ai_content').execute({ verdict: 'matched-ai', limit: 20 })
  assert.equal(JSON.stringify(result).includes('description'), false)
  assert.equal(JSON.stringify(result).includes('content'), false)
  assert.deepEqual(calls.query, [{ verdict: 'matched-ai', limit: 20 }])
})

test('package exports relevance plugins and bundle keeps them disabled by default', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(packageJson.version, '0.19.23')
  assert.equal(packageJson.exports['./store-content-relevance'], './lib/store-content-relevance.js')
  assert.equal(packageJson.exports['./tool-content-relevance'], './lib/tool-content-relevance.js')
  assert.match(patch, /id: prismflow-store-content-relevance[\s\S]*?disabled: true/)
  assert.match(patch, /id: prismflow-tool-content-relevance[\s\S]*?disabled: true/)
})

test('weak ambiguous cards are lossless JSON and pass DSH output-schema validation', async () => {
  const { tools } = harness()
  const record = {
    storeId: 'b'.repeat(64), sourceId: 'rss:test', firstSeenAt: '2026-08-20T00:00:00.000Z',
    item: { title: 'AI stock rises', description: 'Markets report', url: '', source: 'Fixture', category: 'news', published_date: '2026-08-20T00:00:00.000Z' },
  }
  const assessment = assessAIRelevance(record)
  const card = { ...buildAIRelevanceCard(record, assessment, 2_000), timestampBasis: 'published_date' }
  assert.equal(Object.hasOwn(card.evidence[0], 'topic'), false)
  const value = {
    asOf: '2026-08-20T00:00:00.000Z', since: '2026-08-18T00:00:00.000Z',
    total: 1, missing: 0, stale: 0, failed: 0, malformed: 0, items: [card],
  }
  const tool = tools.get('prismflow_query_ai_content')
  assert.deepEqual(validateJsonSchemaValue(tool.output.schema, structuredClone(value), 'value'), [])
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
})

test('tools validate and reuse a canonical frozen asOf across calls and pages', async () => {
  const { tools, calls } = harness()
  const asOf = '2026-08-20T00:00:00.000Z'
  await tools.get('prismflow_prepare_ai_relevance').execute({ hours: 48, asOf }, { signal: new AbortController().signal })
  await tools.get('prismflow_count_ai_relevance').execute({ hours: 48, asOf })
  await tools.get('prismflow_query_ai_content').execute({ hours: 48, asOf, offset: 20, limit: 20 })
  assert.equal(calls.prepare.at(-1).query.asOf.toISOString(), asOf)
  assert.equal(calls.coverage.at(-1).asOf.toISOString(), asOf)
  assert.equal(calls.query.at(-1).asOf.toISOString(), asOf)
  for (const invalid of ['2026-08-20', 'not-a-date', `2026-08-20T00:00:00.000Z\n`]) {
    await assert.rejects(tools.get('prismflow_count_ai_relevance').execute({ asOf: invalid }), /asOf/)
  }
})
