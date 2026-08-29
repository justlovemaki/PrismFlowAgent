import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply } from '../lib/tool-content-selection.js'

const summary = { selectionId: 's', selectionSha256: 'a'.repeat(64), createdAt: '2026-08-20T00:00:00.000Z', asOf: '2026-08-20T00:00:00.000Z', since: '2026-08-18T00:00:00.000Z', hours: 48, counts: {}, selectedCount: 1, totalMaterialChars: 1000, estimatedTokens: 300, contentStoreIds: ['x'], sourceIds: ['follow:News'] }
function harness() {
  const tools = new Map(); const calls = []; const listeners = new Map()
  const ctx = { on(name, listener) { listeners.set(name, listener) }, tools: { register(tool) { tools.set(tool.name, tool) } }, prismContentSelections: {
    async create(query, execution) { calls.push({ query, execution }); return summary },
  } }
  apply(ctx); return { tools, calls, listeners }
}

test('selection tools expose only bounded policy-lowering inputs and never output bodies/material/providers', async () => {
  const { tools, calls, listeners } = harness()
  assert.deepEqual([...tools.keys()], ['prismflow_create_ai_selection', 'prismflow_create_ai_selection_from_explicit_source'])
  const create = tools.get('prismflow_create_ai_selection')
  const names = Object.keys(create.parameters.properties)
  assert.deepEqual(names.sort(), ['asOf', 'category', 'hours', 'topic'])
  assert.equal(names.includes('sourceId'), false)
  const restricted = tools.get('prismflow_create_ai_selection_from_explicit_source')
  assert.equal(restricted.parameters.properties.sourceId.required, undefined)
  assert.ok(restricted.parameters.required.includes('sourceId'))
  const gate = listeners.get('tools/pre-execute')
  assert.deepEqual(await gate({ name: 'prismflow_create_ai_selection', arguments: { hours: 48 } }, async () => ({ kind: 'allow' })), { kind: 'allow' })
  assert.equal((await gate({ name: 'prismflow_create_ai_selection', arguments: { hours: 3 } }, async () => ({ kind: 'allow' }))).kind, 'ask')
  assert.equal((await gate({ name: 'prismflow_create_ai_selection', arguments: { topic: 'foundation-models' } }, async () => ({ kind: 'allow' }))).kind, 'ask')
  const restrictedDecision = await gate({ name: 'prismflow_create_ai_selection_from_explicit_source' }, async () => ({ kind: 'allow' }))
  assert.equal(restrictedDecision.kind, 'ask')
  for (const forbidden of ['body', 'content', 'material', 'prompt', 'provider', 'tool', 'weights', 'threshold']) assert.equal(names.includes(forbidden), false)
  const exec = { signal: new AbortController().signal, agent: { id: 'agent' } }
  const value = await create.execute({ hours: 48 }, exec)
  assert.equal(calls[0].execution.agent, exec.agent)
  assert.equal(JSON.stringify(value).includes('excerpts'), false)
  assert.equal(JSON.stringify(value).includes('material'), false)
  assert.deepEqual(value.sourceIds, ['follow:News'])
})

test('package exports selection plugins and bundle keeps every new row disabled by default', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(packageJson.version, '0.19.23')
  for (const subpath of ['./store-content-selection', './reviewer-ai-relevance-subagent', './tool-content-selection']) assert.ok(packageJson.exports[subpath])
  for (const id of ['prismflow-store-content-selection', 'prismflow-reviewer-ai-relevance-subagent', 'prismflow-tool-content-selection']) assert.match(patch, new RegExp(`id: ${id}[\\s\\S]*?disabled: true`))
})
