import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { apply } from '../lib/tool-production.js'

function harness({ draftStatus = 'approved' } = {}) {
  const tools = new Map()
  const listeners = new Map()
  const calls = { create: [], selection: [], generate: [], cancel: [], retry: [], review: 0 }
  const request = { requestId: 'request-1', generatorId: 'brief', generatorPromptVersion: 4, generatorPromptSha256: 'd'.repeat(64), contentStoreIds: ['b', 'a'], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' }
  const draft = {
    draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', generatorPromptVersion: 4, generatorPromptSha256: 'd'.repeat(64), title: 'Brief', markdown: '# MUST NOT LEAK',
    version: 1, sha256: 'c'.repeat(64), status: draftStatus, createdAt: '2026-01-01T01:00:00.000Z', publishedPublisherIds: [],
  }
  const ctx = {
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    prismProduction: {
      listGenerators: () => [{ id: 'brief', name: 'Brief', description: 'Configured' }],
      async createRequest(generatorId, contentStoreIds) { calls.create.push({ generatorId, contentStoreIds: [...contentStoreIds] }); return { ...request, generatorId, contentStoreIds } },
      async createRequestFromAISelection(generatorId, selectionId) { calls.selection.push({ generatorId, selectionId }); return { ...request, generatorId, selectionId } },
      listRequests: () => [request],
      async cancel(requestId) { calls.cancel.push(requestId); return { ...request, requestId, status: 'cancelled' } },
      async retry(requestId) { calls.retry.push(requestId); return { ...request, requestId, status: 'pending' } },
      async generate(requestId, options) { calls.generate.push({ requestId, options }); return draft },
      listDrafts: () => [draft],
      getDraft(draftId) { return draftId === draft.draftId ? structuredClone(draft) : undefined },
      async reviseDraft(draftId, expectedVersion, expectedSha256, title, markdown, options) {
        calls.revise = { draftId, expectedVersion, expectedSha256, title, markdown, options }
        return { ...draft, draftId, title, markdown, version: expectedVersion + 1, sha256: 'e'.repeat(64), status: 'draft' }
      },
      async review() { calls.review += 1; throw new Error('Chat must never approve') },
    },
  }
  apply(ctx)
  return { tools, listeners, calls, ctx }
}

const execution = () => ({ signal: new AbortController().signal, agent: { id: 'calling-agent' } })

test('production Chat tools own ordered request creation and immutable draft generation', async () => {
  const { tools, calls } = harness()
  assert.deepEqual([...tools.keys()], [
    'prismflow_generators',
    'prismflow_create_generation_request_from_explicit_content_ids',
    'prismflow_create_generation_request_from_ai_selection',
    'prismflow_generation_request',
    'prismflow_generate_draft',
    'prismflow_drafts',
    'prismflow_edit_draft',
  ])
  assert.equal(tools.has('prismflow_publish_content'), false)

  const generators = await tools.get('prismflow_generators').execute({}, execution())
  assert.equal(generators[0].id, 'brief')
  const direct = tools.get('prismflow_create_generation_request_from_explicit_content_ids')
  const intent = 'explicit-user-ordered-content-ids'
  assert.equal(tools.has('prismflow_create_generation_request'), false)
  await assert.rejects(direct.execute({ generatorId: 'brief', contentStoreIds: [] }, execution()), /selectionIntent|arguments failed validation/)
  await assert.rejects(direct.execute({ generatorId: 'brief', contentStoreIds: [], selectionIntent: intent }, execution()), /1 to 100/)
  await assert.rejects(direct.execute({ generatorId: 'brief', contentStoreIds: Array(101).fill('a'), selectionIntent: intent }, execution()), /1 to 100/)
  const created = await direct.execute({ generatorId: 'brief', contentStoreIds: ['b', 'a'], selectionIntent: intent }, execution())
  assert.deepEqual(calls.create, [{ generatorId: 'brief', contentStoreIds: ['b', 'a'] }])
  assert.equal(created.itemCount, 2)
  assert.deepEqual({ generatorPromptVersion: created.generatorPromptVersion, generatorPromptSha256: created.generatorPromptSha256 }, { generatorPromptVersion: 4, generatorPromptSha256: 'd'.repeat(64) })
  const fromSelection = await tools.get('prismflow_create_generation_request_from_ai_selection').execute({ generatorId: 'brief', selectionId: 'selection-1' }, execution())
  assert.equal(fromSelection.selectionId, 'selection-1')
  assert.deepEqual(calls.selection, [{ generatorId: 'brief', selectionId: 'selection-1' }])
  assert.deepEqual(Object.keys(tools.get('prismflow_create_generation_request_from_ai_selection').parameters.properties).sort(), ['generatorId', 'selectionId'])
  const generated = await tools.get('prismflow_generate_draft').execute({ requestId: 'request-1' }, execution())
  assert.equal(generated.draftId, 'draft-1')
  assert.equal(generated.generatorPromptVersion, 4); assert.equal(generated.generatorPromptSha256, 'd'.repeat(64))
  assert.equal(Object.hasOwn(generated, 'markdown'), false)
  assert.equal(calls.generate[0].requestId, 'request-1')
})

test('one Generation Request operations tool lists, cancels, and retries with strict action fields', async () => {
  const { tools, calls } = harness()
  const tool = tools.get('prismflow_generation_request')
  const listed = await tool.execute({ action: 'list', status: 'pending', limit: 20 }, execution())
  assert.equal(listed[0].requestId, 'request-1')
  assert.equal((await tool.execute({ action: 'cancel', requestId: 'request-1' }, execution())).status, 'cancelled')
  assert.equal((await tool.execute({ action: 'retry', requestId: 'request-1' }, execution())).status, 'pending')
  assert.deepEqual(calls.cancel, ['request-1']); assert.deepEqual(calls.retry, ['request-1'])
  await assert.rejects(tool.execute({ action: 'cancel', requestId: 'request-1', limit: 1 }, execution()), /mutation fields/)
  await assert.rejects(tool.execute({ action: 'list', requestId: 'request-1' }, execution()), /list fields/)
})

test('explicit ordered-ID request path is one-shot approval gated while AI Selection remains the default', async () => {
  const { tools, listeners } = harness()
  const gate = listeners.get('tools/pre-execute')
  assert.equal(typeof gate, 'function')
  let delegated = 0
  const allow = async () => { delegated += 1; return { kind: 'allow' } }
  const aiDecision = await gate({ name: 'prismflow_create_generation_request_from_ai_selection' }, allow)
  assert.deepEqual(aiDecision, { kind: 'allow' })
  const directDecision = await gate({ name: 'prismflow_create_generation_request_from_explicit_content_ids' }, allow)
  assert.equal(directDecision.kind, 'ask')
  assert.match(directDecision.reason, /exact user-specified content IDs/u)
  assert.equal(delegated, 2)
  const denied = await gate({ name: 'prismflow_create_generation_request_from_explicit_content_ids' }, async () => ({ kind: 'deny', reason: 'policy' }))
  assert.deepEqual(denied, { kind: 'deny', reason: 'policy' })
  assert.match(tools.get('prismflow_create_generation_request_from_ai_selection').description, /default/iu)
  assert.match(tools.get('prismflow_create_generation_request_from_explicit_content_ids').description, /one-shot user approval/u)
})

test('Chat draft editor inspects one untrusted draft and CAS-saves additions, rewrites, and media removal', async () => {
  const { tools, calls } = harness({ draftStatus: 'draft' })
  const editor = tools.get('prismflow_edit_draft')
  const inspected = await editor.execute({ action: 'inspect', draftId: 'draft-1' }, execution())
  assert.equal(inspected.markdown, '# MUST NOT LEAK')
  assert.equal(inspected.version, 1); assert.equal(inspected.sha256, 'c'.repeat(64))
  await assert.rejects(editor.execute({ action: 'inspect', draftId: 'draft-1', markdown: 'extra' }, execution()), /inspect fields/)
  await assert.rejects(editor.execute({ action: 'save', draftId: 'draft-1', expectedVersion: 1,
    expectedSha256: 'c'.repeat(64), title: 'Changed', markdown: '# Added', mediaPolicy: 'wrong' }, execution()), /invalid arguments|save fields/)
  const saved = await editor.execute({ action: 'save', draftId: 'draft-1', expectedVersion: 1,
    expectedSha256: 'c'.repeat(64), title: 'Expanded Brief', markdown: '# MUST NOT LEAK\n\nNew paragraph', mediaPolicy: 'editor-controlled' }, execution())
  assert.equal(saved.action, 'saved'); assert.equal(saved.version, 2)
  assert.deepEqual(calls.revise.options, { allowSourceMediaRemoval: true })
  assert.equal(calls.revise.title, 'Expanded Brief'); assert.equal(calls.revise.markdown, '# MUST NOT LEAK\n\nNew paragraph')

  const approved = harness().tools.get('prismflow_edit_draft')
  await assert.rejects(approved.execute({ action: 'inspect', draftId: 'draft-1' }, execution()), /immutable/)
})

test('Chat draft listing excludes markdown and exposes no approval, publisher, or publication tools', async () => {
  const { tools, calls } = harness()
  await assert.rejects(tools.get('prismflow_drafts').execute({ limit: 0 }, execution()), /integer from 1 to 100/)
  await assert.rejects(tools.get('prismflow_drafts').execute({ limit: 101 }, execution()), /integer from 1 to 100/)
  const drafts = await tools.get('prismflow_drafts').execute({ status: 'approved', limit: 20 }, execution())
  assert.equal(drafts.length, 1); assert.equal(drafts[0].draftId, 'draft-1')
  assert.equal(Object.hasOwn(drafts[0], 'markdown'), false)
  assert.equal(JSON.stringify(drafts).includes('MUST NOT LEAK'), false)
  for (const name of ['prismflow_publishers', 'prismflow_publish_draft', 'prismflow_republish_draft']) assert.equal(tools.has(name), false)
  assert.equal(calls.review, 0)
})

test('Chat draft listing explicitly warns for persisted unknown external outcomes', async () => {
  const { tools, ctx } = harness()
  ctx.prismProduction.listDrafts = () => [{
    draftId: 'draft-unknown', requestId: 'request-1', generatorId: 'daily', title: 'Unknown', version: 2,
    sha256: 'a'.repeat(64), status: 'publishing', createdAt: '2026-01-01T00:00:00.000Z', publishedPublisherIds: [],
    publishingPhase: 'reconciliation-required', publishingOutcome: 'unknown',
  }]
  const tool = tools.get('prismflow_drafts')
  const result = await tool.execute({}, execution())
  assert.equal(result[0].reconciliationRequired, true)
  assert.equal(result[0].externalOutcome, 'unknown')
  assert.match(tool.output.render({}, result)[0].text, /ERROR:.*unknown.*do not retry/is)
})

test('bundled two-stage daily brief prompts require materially longer entries', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /每条副标题约8-18个中文字符/)
  assert.match(patch, /每条副标题控制在 \*\*8-18 个中文字符\*\*/)
  assert.equal((patch.match(/4-6句话|4-6 句话/gu) ?? []).length, 2)
  assert.equal((patch.match(/120-220/gu) ?? []).length, 2)
  assert.doesNotMatch(patch, /3-4\s*句话/gu)
  assert.doesNotMatch(patch, /每句\s*\*\*?10-15|每句10-15字/gu)
})

test('bundle exports no scheduler or generic raw-content publication plugin beyond the fixed prismflow_github_push compatibility tool', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  for (const subpath of ['./scheduler-ingestion', './scheduler-publication', './tool-publisher']) {
    assert.equal(Object.hasOwn(packageJson.exports, subpath), false)
  }
  assert.doesNotMatch(patch, /scheduler-ingestion|scheduler-publication|tool-publisher/)
  for (const file of ['../lib/scheduler-ingestion.js', '../lib/scheduler-publication.js', '../lib/tool-publisher.js']) {
    await assert.rejects(access(new URL(file, import.meta.url)), error => error?.code === 'ENOENT')
  }
})
