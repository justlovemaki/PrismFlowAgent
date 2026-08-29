import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismProductionService } from '../lib/store-production.js'
import { createDeploymentExecutionProfile } from '../lib/store-generator-workflows.js'
import { generatorWorkflowSha256 } from '../lib/shared/content-production.js'

class Table {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { this.map.set(key, structuredClone(value)); return value }
  async delete(key) { this.map.delete(key) }
}
const STORE_ID = 'a'.repeat(64)
const record = { storeId: STORE_ID, item: { title: 'Source', url: '', description: 'Evidence', source: 'fixture', category: 'news', published_date: '' } }
function setup() {
  const profile = createDeploymentExecutionProfile({ format: 'spawn-profile-v1', id: 'builder', version: 1,
    runnerPolicyVersion: 'serial-workflow-v2', providerRef: 'spawn', toolPolicy: { allow: [] },
    ceilings: { maxSteps: 8, maxInputChars: 10000, maxCombinedInputChars: 20000, maxIntermediateOutputChars: 10000, maxFinalOutputChars: 10000, maxPromptAggregateChars: 32000 } })
  const snapshot = { format: 'workflow-v1', generatorId: 'dashboard', generatorName: 'Dashboard', description: '', enabled: true,
    steps: [{ id: 'draft', name: 'Draft', persona: 'Writer', processPrompt: '' }], executionProfile: profile }
  let current = { ...snapshot, version: 51, sha256: generatorWorkflowSha256(snapshot), updatedAt: new Date().toISOString(), actor: 'dashboard-admin', action: 'update', sourceVersion: 50 }
  const workflows = { currentSync(id) { return id === current?.generatorId ? current : undefined }, listCurrent() { return current ? [current] : [] } }
  const ctx = new Context()
  Object.defineProperty(ctx, 'get', { value(key) { return key === 'prismGeneratorWorkflows' ? workflows : undefined } })
  Object.defineProperty(ctx, 'prismContentStore', { value: { get(id) { return id === STORE_ID ? record : undefined } } })
  const service = new PrismProductionService(ctx); service.requests = new Table(); service.drafts = new Table(); service.releaseWriterLock = async () => {}
  return { service, profile, snapshot, workflows, setCurrent(value) { current = value } }
}

test('workflow requests embed exact snapshots and execute after history/current changes', async () => {
  const { service, profile, setCurrent } = setup()
  let observed
  service.registerWorkflowRunner(profile, { async generate(snapshot, request) { observed = { snapshot, request }; return { title: 'Final', markdown: '# Final' } } })
  const request = await service.createRequest('dashboard', [STORE_ID])
  assert.equal(request.executionKind, 'workflow-v1'); assert.equal(request.generatorWorkflowVersion, 51)
  assert.equal(generatorWorkflowSha256(request.generatorWorkflowSnapshot), request.generatorWorkflowSha256)
  setCurrent(undefined)
  const draft = await service.generate(request.requestId, { agent: {} })
  assert.equal(draft.executionKind, 'workflow-v1'); assert.equal(draft.generatorWorkflowVersion, 51)
  assert.equal(observed.snapshot.steps[0].processPrompt, '')
  assert.equal(observed.request.generatorWorkflowSnapshot.executionProfile.runnerPolicyVersion, 'serial-workflow-v2')
  assert.equal(service.listGenerators().length, 0)
})

test('running cancellation aborts the exact attempt and stale completion cannot persist a Draft', async () => {
  const { service, profile } = setup()
  let started
  const didStart = new Promise(resolve => { started = resolve })
  service.registerWorkflowRunner(profile, { async generate(_snapshot, _request, _records, execution) {
    started()
    await new Promise(resolve => execution.signal.addEventListener('abort', resolve, { once: true }))
    return { title: 'Too late', markdown: '# Must not persist' }
  } })
  const request = await service.createRequest('dashboard', [STORE_ID])
  const generation = service.generate(request.requestId, { agent: {} })
  await didStart
  const cancelled = await service.cancel(request.requestId)
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.attempt, 1)
  await assert.rejects(generation)
  assert.equal(service.getRequest(request.requestId).status, 'cancelled')
  assert.equal(service.listDrafts().length, 0)
  const retried = await service.retry(request.requestId)
  assert.equal(retried.status, 'pending'); assert.equal(retried.generatorWorkflowSha256, request.generatorWorkflowSha256)
})

test('disabled workflow disappears for new requests while its pinned pending request remains runnable', async () => {
  const { service, profile, snapshot, setCurrent } = setup()
  service.registerWorkflowRunner(profile, { async generate() { return { title: 'Pinned', markdown: '# Pinned' } } })
  const request = await service.createRequest('dashboard', [STORE_ID])
  const disabledSnapshot = { ...snapshot, enabled: false }
  setCurrent({ ...disabledSnapshot, version: 52, sha256: generatorWorkflowSha256(disabledSnapshot), updatedAt: new Date().toISOString(), actor: 'dashboard-admin', action: 'disable', sourceVersion: 51 })
  assert.equal(service.listGenerators().length, 0)
  await assert.rejects(service.createRequest('dashboard', [STORE_ID]), /disabled/)
  const draft = await service.generate(request.requestId, { agent: {} })
  assert.equal(draft.title, 'Pinned')
})

test('workflows without the exact current runtime are neither advertised nor accepted for new requests', async () => {
  const { service, profile } = setup()
  assert.deepEqual(service.listGenerators(), [])
  await assert.rejects(service.createRequest('dashboard', [STORE_ID]), /execution profile is unavailable/)
  const unregister = service.registerWorkflowRunner(profile, { async generate() { return { title: 'Pinned', markdown: '# Pinned' } } })
  assert.equal(service.listGenerators().length, 1)
  const pinned = await service.createRequest('dashboard', [STORE_ID])
  unregister()
  assert.deepEqual(service.listGenerators(), [])
  await assert.rejects(service.generate(pinned.requestId, { agent: {} }), /Pinned workflow execution profile is unavailable/)
  assert.equal(service.getRequest(pinned.requestId).status, 'failed')
})

test('production retirement serializes blockers, tombstones, exact replay, legacy suppression, and pinned retry runtime', async () => {
  const { service, profile, snapshot, workflows, setCurrent } = setup()
  const unregister = service.registerWorkflowRunner(profile, { async generate() { return { title: 'Retained', markdown: '# Retained' } } })
  service.registerGenerator({ id: 'dashboard', name: 'Legacy collision', async pinPrompt() { return { version: 1, sha256: 'f'.repeat(64) } },
    async resolvePrompt() {}, async generate() { throw new Error('legacy fallback must not run') } })
  const request = await service.createRequest('dashboard', [STORE_ID])
  const archivedSnapshot = { ...snapshot, enabled: false }
  let current = { ...archivedSnapshot, version: 52, sha256: generatorWorkflowSha256(archivedSnapshot), updatedAt: new Date().toISOString(),
    actor: 'dashboard-admin', action: 'disable', sourceVersion: 51 }
  setCurrent(current)
  workflows.previewDelete = async input => ({ record: current, replay: false })
  workflows.deletionReplaySync = input => current.action === 'delete' && current.sourceVersion === input.expected.version
    && current.sha256 === input.expected.sha256 ? current : undefined
  workflows.delete = async input => {
    const replay = workflows.deletionReplaySync(input)
    if (replay) return replay
    current = { ...current, version: current.version + 1, updatedAt: new Date().toISOString(), action: 'delete', sourceVersion: current.version }
    setCurrent(current)
    return current
  }
  const input = { generatorId: 'dashboard', expected: { kind: 'workflow-v1', version: 52, sha256: current.sha256 } }
  const preview = await service.previewGeneratorWorkflowDeletion(input)
  assert.deepEqual(preview.blockers, { pending: 1, running: 0 }); assert.equal(preview.canDelete, false)
  await assert.rejects(service.deleteGeneratorWorkflow(input), error => error.code === 'workflow_active_requests')
  await service.cancel(request.requestId)
  const deleted = await service.deleteGeneratorWorkflow(input)
  assert.equal(deleted.record.action, 'delete'); assert.equal(service.listGenerators().length, 0)
  await assert.rejects(service.createRequest('dashboard', [STORE_ID]), error => error.code === 'workflow_deleted')
  unregister()
  await service.retry(request.requestId)
  const replay = await service.deleteGeneratorWorkflow(input)
  assert.equal(replay.replay, true)
  const draft = await service.generate(request.requestId, { agent: {} })
  assert.equal(draft.title, 'Retained')
})

test('recovery rejects unknown fields at every nested workflow snapshot level without writes', async () => {
  for (const seam of ['snapshot', 'step', 'profile', 'toolPolicy', 'ceilings']) {
    const { service, profile } = setup()
    service.registerWorkflowRunner(profile, { async generate() { return { title: 'Pinned', markdown: '# Pinned' } } })
    const request = await service.createRequest('dashboard', [STORE_ID])
    const raw = structuredClone(service.getRequest(request.requestId))
    raw.status = 'running'
    if (seam === 'snapshot') raw.generatorWorkflowSnapshot.hidden = true
    if (seam === 'step') raw.generatorWorkflowSnapshot.steps[0].hidden = true
    if (seam === 'profile') raw.generatorWorkflowSnapshot.executionProfile.hidden = true
    if (seam === 'toolPolicy') raw.generatorWorkflowSnapshot.executionProfile.toolPolicy.hidden = true
    if (seam === 'ceilings') raw.generatorWorkflowSnapshot.executionProfile.ceilings.hidden = true
    service.requests.map.set(request.requestId, raw)
    let writes = 0
    const put = service.requests.put.bind(service.requests)
    service.requests.put = async (...args) => { writes += 1; return put(...args) }
    await assert.rejects(service.recoverInterrupted(), /malformed key or row/)
    assert.equal(writes, 0)
    assert.equal(service.requests.map.get(request.requestId).status, 'running')
  }
})
