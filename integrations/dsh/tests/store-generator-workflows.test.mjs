import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  GeneratorWorkflowConflictError,
  PrismGeneratorWorkflowStore,
  WORKFLOW_HISTORY_LIMIT,
  acquireWorkflowWriterLock,
  createDeploymentExecutionProfile,
} from '../lib/store-generator-workflows.js'
import { generatorWorkflowSha256 } from '../lib/shared/content-production.js'

class Table {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { this.map.set(key, structuredClone(value)); return value }
  async delete(key) { this.map.delete(key) }
}
function profile(id = 'builder', version = 1, runnerPolicyVersion = 'serial-workflow-v2') {
  return createDeploymentExecutionProfile({
    format: 'spawn-profile-v1', id, version, runnerPolicyVersion, providerRef: 'spawn',
    toolPolicy: { allow: [] }, ceilings: { maxSteps: 8, maxInputChars: 10000, maxCombinedInputChars: 20000,
      maxIntermediateOutputChars: 10000, maxFinalOutputChars: 10000, maxPromptAggregateChars: 32000 },
  })
}
function definition(suffix = '') {
  return { generatorId: 'dashboard-brief', generatorName: `Dashboard brief${suffix}`, description: 'Configured in Dashboard',
    steps: [{ id: 'draft', name: 'Draft', persona: `Writer${suffix}`, processPrompt: 'Create a factual draft.' }] }
}
function fixture() {
  const store = new PrismGeneratorWorkflowStore(new Context())
  store.historyTable = new Table(); store.releaseWriterLock = async () => {}; store.registerExecutionProfile(profile(), { builderDefault: true })
  return store
}

test('workflow store creates exact hash-bound rows without accepting deployment policy', async () => {
  const store = fixture()
  const first = await store.create(definition())
  assert.equal(first.version, 1); assert.equal(first.action, 'create'); assert.equal(first.enabled, true)
  assert.equal(first.sha256, generatorWorkflowSha256({ format: first.format, generatorId: first.generatorId, generatorName: first.generatorName, description: first.description, enabled: first.enabled, steps: first.steps, executionProfile: first.executionProfile }))
  await assert.rejects(store.create({ ...definition('x'), generatorId: 'other', executionProfile: profile() }), /mutation fields/)
  await assert.rejects(store.save({ ...definition('x'), expected: { kind: 'workflow-v1', version: 1, sha256: first.sha256 }, providerRef: 'unsafe' }), /mutation fields/)
  const second = await store.save({ ...definition(' updated'), expected: { kind: 'workflow-v1', version: 1, sha256: first.sha256 } })
  assert.equal(second.version, 2); assert.equal(second.steps[0].id, first.steps[0].id)
  await assert.rejects(store.save({ ...definition(' stale'), expected: { kind: 'workflow-v1', version: 1, sha256: first.sha256 } }), GeneratorWorkflowConflictError)
})

test('saveAsDraft is version-bound, defaults to enabled for historical rows and survives updates and rollback', async () => {
  const store = fixture()
  const first = await store.create(definition())
  assert.equal(Object.hasOwn(first, 'saveAsDraft'), false)
  const ref = row => ({ kind: 'workflow-v1', version: row.version, sha256: row.sha256 })
  const disabled = await store.save({ ...definition(), saveAsDraft: false, expected: ref(first) })
  assert.equal(disabled.saveAsDraft, false); assert.notEqual(disabled.sha256, first.sha256)
  assert.equal((await store.snapshot(first.generatorId)).saveAsDraft, false)
  const unchanged = await store.save({ ...definition(), expected: ref(disabled) })
  assert.equal(unchanged.saveAsDraft, false)
  const enabled = await store.save({ ...definition(), saveAsDraft: true, expected: ref(unchanged) })
  assert.equal(enabled.saveAsDraft, true)
  await assert.rejects(store.save({ ...definition(), saveAsDraft: 'false', expected: ref(enabled) }), /boolean/)
  const rolled = await store.rollback({ generatorId: first.generatorId, targetVersion: first.version, expected: ref(enabled) })
  assert.equal(Object.hasOwn(rolled, 'saveAsDraft'), false); assert.equal(rolled.sha256, first.sha256)
  store.scanHistory()
  assert.equal((await store.history(first.generatorId)).length, 5)
})

test('archived workflow deletion appends an irreversible exact-CAS tombstone and reserves its id', async () => {
  const store = fixture()
  const created = await store.create(definition())
  await assert.rejects(store.delete({ generatorId: created.generatorId,
    expected: { kind: 'workflow-v1', version: created.version, sha256: created.sha256 } }), /archived/)
  const archived = await store.disable({ generatorId: created.generatorId,
    expected: { kind: 'workflow-v1', version: created.version, sha256: created.sha256 } })
  const expected = { kind: 'workflow-v1', version: archived.version, sha256: archived.sha256 }
  const deleted = await store.delete({ generatorId: archived.generatorId, expected })
  assert.equal(deleted.action, 'delete'); assert.equal(deleted.lifecycle, 'deleted')
  assert.equal(deleted.version, archived.version + 1); assert.equal(deleted.sourceVersion, archived.version)
  assert.equal(deleted.sha256, archived.sha256); assert.deepEqual(deleted.deletion.deletedFrom, { version: archived.version, sha256: archived.sha256 })
  assert.equal((await store.list()).some(row => row.generatorId === archived.generatorId), false)
  assert.equal((await store.list({ includeDeleted: true }))[0].lifecycle, 'deleted')
  assert.equal(store.hasCurrent(archived.generatorId), true)
  assert.equal((await store.delete({ generatorId: archived.generatorId, expected })).version, deleted.version)
  await assert.rejects(store.delete({ generatorId: archived.generatorId,
    expected: { kind: 'workflow-v1', version: created.version, sha256: created.sha256 } }), /permanently deleted/)
  await assert.rejects(store.enable({ generatorId: archived.generatorId,
    expected: { kind: 'workflow-v1', version: deleted.version, sha256: deleted.sha256 } }), /permanently deleted/)
  await assert.rejects(store.create(definition()), /already in use/)
})

test('legacy workflow deletion requires explicit adoption and never invokes the adoption callback', async () => {
  const store = fixture(); let adopts = 0
  store.registerLegacyProjection({ id: 'legacy-delete', async read() { throw new Error('delete must not read legacy projection') },
    async adopt() { adopts += 1 } })
  await assert.rejects(store.delete({ generatorId: 'legacy-delete',
    expected: { kind: 'legacy-v1', version: 1, sha256: 'a'.repeat(64) } }), error => error.code === 'legacy_adoption_required')
  assert.equal(adopts, 0)
})

test('empty Process Prompt survives save, reorder, history and rollback with distinct hashes', async () => {
  const store = fixture()
  const empty = { ...definition(), steps: [
    { id: 'draft', name: 'Draft', persona: 'Writer', processPrompt: '' },
    { id: 'review', name: 'Review', persona: 'Reviewer', processPrompt: 'Review exactly.' },
  ] }
  const first = await store.create(empty)
  assert.equal(first.steps[0].processPrompt, '')
  const reordered = await store.save({ ...definition(' reordered'), steps: [first.steps[1], first.steps[0]],
    expected: { kind: 'workflow-v1', version: first.version, sha256: first.sha256 } })
  assert.equal(reordered.steps[1].processPrompt, '')
  assert.notEqual(reordered.sha256, first.sha256)
  const history = await store.history(first.generatorId)
  assert.equal(history.find(row => row.version === 1).steps[0].processPrompt, '')
  const rolled = await store.rollback({ generatorId: first.generatorId,
    expected: { kind: 'workflow-v1', version: reordered.version, sha256: reordered.sha256 }, targetVersion: first.version })
  assert.equal(rolled.steps[0].processPrompt, '')
  assert.equal(rolled.sha256, first.sha256)
  await assert.rejects(store.save({ ...definition(' whitespace'), steps: [{ ...first.steps[0], processPrompt: '  ' }],
    expected: { kind: 'workflow-v1', version: rolled.version, sha256: rolled.sha256 } }), /processPrompt/)
})

test('workflow history retains a contiguous latest-50 circular window and rollback reproduces content hash', async () => {
  const store = fixture(); let current = await store.create(definition())
  const originalSha = current.sha256
  for (let version = 2; version <= 55; version += 1) {
    current = await store.save({ ...definition(` ${version}`), expected: { kind: 'workflow-v1', version: current.version, sha256: current.sha256 } })
  }
  const rows = await store.history('dashboard-brief')
  assert.equal(rows.length, WORKFLOW_HISTORY_LIMIT)
  assert.deepEqual(rows.map(row => row.version), Array.from({ length: 50 }, (_, index) => 55 - index))
  await assert.rejects(store.rollback({ generatorId: 'dashboard-brief', expected: { kind: 'workflow-v1', version: 55, sha256: current.sha256 }, targetVersion: 1 }), /evicted/)
  const target = rows.at(-1)
  const rolled = await store.rollback({ generatorId: 'dashboard-brief', expected: { kind: 'workflow-v1', version: 55, sha256: current.sha256 }, targetVersion: target.version })
  assert.equal(rolled.version, 56); assert.equal(rolled.sourceVersion, target.version); assert.equal(rolled.sha256, target.sha256)
  assert.notEqual(rolled.sha256, originalSha)
})

test('deletion at version 51 keeps one contiguous terminal latest-50 window and converges after restart', async () => {
  const store = fixture(); let current = await store.create(definition())
  for (let version = 2; version <= 49; version += 1) {
    current = await store.save({ ...definition(` ${version}`), expected: { kind: 'workflow-v1', version: current.version, sha256: current.sha256 } })
  }
  const archived = await store.disable({ generatorId: current.generatorId,
    expected: { kind: 'workflow-v1', version: current.version, sha256: current.sha256 } })
  assert.equal(archived.version, 50)
  const expected = { kind: 'workflow-v1', version: archived.version, sha256: archived.sha256 }
  const deleted = await store.delete({ generatorId: archived.generatorId, expected })
  assert.equal(deleted.version, 51); assert.equal(deleted.action, 'delete')
  const retained = [...store.historyTable.map.values()].sort((a, b) => a.version - b.version)
  assert.deepEqual(retained.map(row => row.version), Array.from({ length: 50 }, (_, index) => index + 2))
  assert.equal(store.historyTable.get('dashboard-brief:0000000001').version, 51)
  assert.equal((await store.delete({ generatorId: archived.generatorId, expected })).version, 51)

  const reopened = new PrismGeneratorWorkflowStore(new Context())
  reopened.historyTable = store.historyTable; reopened.releaseWriterLock = async () => {}
  reopened.registerExecutionProfile(profile(), { builderDefault: true })
  assert.equal(reopened.currentSync(archived.generatorId).action, 'delete')
  assert.equal((await reopened.list()).length, 0)
  assert.equal((await reopened.list({ includeDeleted: true }))[0].version, 51)
})

test('delete wins its queue race against enable and terminal state rejects every later mutation', async () => {
  const store = fixture(); const created = await store.create(definition())
  const archived = await store.disable({ generatorId: created.generatorId,
    expected: { kind: 'workflow-v1', version: created.version, sha256: created.sha256 } })
  const expected = { kind: 'workflow-v1', version: archived.version, sha256: archived.sha256 }
  const deleting = store.delete({ generatorId: archived.generatorId, expected })
  const enabling = store.enable({ generatorId: archived.generatorId, expected })
  const [deleted, enableResult] = await Promise.allSettled([deleting, enabling])
  assert.equal(deleted.status, 'fulfilled'); assert.equal(deleted.value.action, 'delete')
  assert.equal(enableResult.status, 'rejected'); assert.match(enableResult.reason.message, /permanently deleted/)
  assert.equal(store.currentSync(archived.generatorId).action, 'delete')
})

test('legacy adoption uses exact legacy version/hash CAS and archive is versioned', async () => {
  const store = fixture(); const legacyProfile = profile('legacy')
  const legacySnapshot = { format: 'workflow-v1', generatorId: 'legacy', generatorName: 'Legacy', description: 'Legacy generator', enabled: true,
    steps: [{ id: 'legacy-stage-1', name: 'Stage 1', persona: 'Writer', processPrompt: 'Write.' }], executionProfile: legacyProfile }
  let reference = { kind: 'legacy-v1', version: 3, sha256: 'a'.repeat(64) }
  store.registerLegacyProjection({ id: 'legacy', async read() { return { reference, snapshot: legacySnapshot } } })
  assert.equal((await store.list()).find(item => item.generatorId === 'legacy').kind, 'legacy-v1')
  reference = { ...reference, version: 4, sha256: 'b'.repeat(64) }
  await assert.rejects(store.save({ generatorId: 'legacy', generatorName: 'Adopted', description: '', steps: legacySnapshot.steps,
    expected: { kind: 'legacy-v1', version: 3, sha256: 'a'.repeat(64) } }), GeneratorWorkflowConflictError)
  const adopted = await store.save({ generatorId: 'legacy', generatorName: 'Adopted', description: '', steps: legacySnapshot.steps, expected: reference })
  assert.equal(adopted.action, 'adopt'); assert.equal((await store.list()).find(item => item.generatorId === 'legacy').kind, 'workflow-v1')
  const disabled = await store.disable({ generatorId: 'legacy', expected: { kind: 'workflow-v1', version: adopted.version, sha256: adopted.sha256 } })
  assert.equal(disabled.enabled, false); assert.equal(store.listEnabled().some(item => item.generatorId === 'legacy'), false)
})

test('legacy adoption reads reference and steps from one exact callback snapshot', async () => {
  const store = fixture(); const legacyProfile = profile('legacy-exact')
  let reads = 0
  store.registerLegacyProjection({ id: 'legacy-exact', async read() {
    reads += 1
    return { reference: { kind: 'legacy-v1', version: 7, sha256: '7'.repeat(64) }, snapshot: {
      format: 'workflow-v1', generatorId: 'legacy-exact', generatorName: 'Legacy exact', description: '', enabled: true,
      steps: [{ id: 'one', name: 'One', persona: 'Snapshot persona', processPrompt: 'Snapshot prompt' }], executionProfile: legacyProfile,
    } }
  } })
  const adopted = await store.save({ generatorId: 'legacy-exact', generatorName: 'Adopted', description: '',
    steps: [{ id: 'one', name: 'One', persona: 'Edited persona', processPrompt: 'Edited prompt' }],
    expected: { kind: 'legacy-v1', version: 7, sha256: '7'.repeat(64) } })
  assert.equal(reads, 1)
  assert.equal(adopted.steps[0].persona, 'Edited persona')
})

test('legacy adoption uses its mutation-boundary callback without a pre-adoption projection read', async () => {
  const store = fixture(); const legacyProfile = profile('legacy-boundary'); let reads = 0; let adopts = 0
  const legacyRead = { reference: { kind: 'legacy-v1', version: 9, sha256: '9'.repeat(64) }, snapshot: {
    format: 'workflow-v1', generatorId: 'legacy-boundary', generatorName: 'Legacy boundary', description: '', enabled: true,
    steps: [{ id: 'one', name: 'One', persona: 'Writer', processPrompt: 'Write' }], executionProfile: legacyProfile,
  } }
  store.registerLegacyProjection({ id: 'legacy-boundary', async read() { reads += 1; return legacyRead },
    async adopt(expected, operation) { adopts += 1; assert.deepEqual(expected, legacyRead.reference); return operation(legacyRead) } })
  const adopted = await store.save({ generatorId: 'legacy-boundary', generatorName: 'Adopted', description: '', steps: legacyRead.snapshot.steps,
    expected: legacyRead.reference })
  assert.equal(adopted.action, 'adopt'); assert.equal(adopts, 1); assert.equal(reads, 0)
})

test('rollback preserves the current deployment profile and profile contract rejects modelRef', async () => {
  const store = fixture(); const first = await store.create(definition())
  const nextProfile = profile('builder-next')
  store.registerExecutionProfile(nextProfile)
  const rebound = await store.deploymentRebind(first.generatorId, { kind: 'workflow-v1', version: first.version, sha256: first.sha256 }, nextProfile)
  const rolled = await store.rollback({ generatorId: first.generatorId,
    expected: { kind: 'workflow-v1', version: rebound.version, sha256: rebound.sha256 }, targetVersion: first.version })
  assert.equal(rolled.executionProfile.sha256, nextProfile.sha256)
  assert.throws(() => createDeploymentExecutionProfile({ ...nextProfile, modelRef: 'unbound-model' }), /fields are invalid/)
})

test('startup profile reconciliation creates a deployment-owned rebind to the only newly deployed runtime', async () => {
  const store = new PrismGeneratorWorkflowStore(new Context())
  store.historyTable = new Table(); store.releaseWriterLock = async () => {}
  const unregisterOld = store.registerExecutionProfile(profile('builder', 1, 'serial-workflow-v1'), { builderDefault: true })
  const created = await store.create(definition())
  unregisterOld()
  const currentProfile = profile('builder', 1, 'serial-workflow-v2')
  store.registerExecutionProfile(currentProfile, { builderDefault: true })
  await store.reconcileExecutionProfiles()
  const rebound = store.currentSync(created.generatorId)
  assert.equal(rebound.version, created.version + 1)
  assert.equal(rebound.action, 'deployment-rebind')
  assert.equal(rebound.actor, 'deployment')
  assert.equal(rebound.executionProfile.sha256, currentProfile.sha256)
})

test('profile reconciliation prevalidates all generators, includes disabled rows, and converges after a partial write failure', async () => {
  const store = new PrismGeneratorWorkflowStore(new Context()); store.historyTable = new Table(); store.releaseWriterLock = async () => {}
  const oldA = profile('runtime-a', 1); const oldB = profile('runtime-b', 1)
  const rowA = store.makeRow({ format: 'workflow-v1', ...definition(), generatorId: 'alpha', enabled: false, executionProfile: oldA }, 1, 'dashboard-admin', 'create', 0)
  const rowB = store.makeRow({ format: 'workflow-v1', ...definition(), generatorId: 'beta', enabled: false, executionProfile: oldB }, 1, 'dashboard-admin', 'create', 0)
  await store.putRolling(rowA); await store.putRolling(rowB)
  const nextA = profile('runtime-a', 2); const nextB = profile('runtime-b', 2)
  store.registerExecutionProfile(nextA)
  await assert.rejects(store.reconcileExecutionProfiles(), /ambiguous or unavailable: runtime-b/)
  assert.equal(store.currentSync('alpha').version, 1)

  store.registerExecutionProfile(nextB)
  const originalPut = store.historyTable.put.bind(store.historyTable); let failBeta = true
  store.historyTable.put = async (storedKey, value) => {
    if (failBeta && value.generatorId === 'beta' && value.action === 'deployment-rebind') { failBeta = false; throw new Error('simulated second rebind crash') }
    return originalPut(storedKey, value)
  }
  await assert.rejects(store.reconcileExecutionProfiles(), /simulated second rebind crash/)
  assert.equal(store.currentSync('alpha').version, 2); assert.equal(store.currentSync('beta').version, 1)
  await store.reconcileExecutionProfiles()
  for (const id of ['alpha', 'beta']) {
    const current = store.currentSync(id)
    assert.equal(current.version, 2); assert.equal(current.enabled, false); assert.equal(current.action, 'deployment-rebind')
  }
  await store.reconcileExecutionProfiles()
  assert.deepEqual(store.listCurrent().map(item => item.version), [2, 2])
})

test('every malformed or unknown workflow history key fails closed', () => {
  for (const storedKey of ['', 'unknown', ':0000000001', 'valid:0000000000', 'valid:0000000051']) {
    const store = fixture(); store.historyTable.map.set(storedKey, { hidden: true })
    assert.throws(() => store.listCurrent(), /unknown key|malformed key/)
  }
})

async function writeLockOwner(path, owner) {
  await writeFile(path, `${JSON.stringify(owner)}\n`)
}
function deadOwner(overrides = {}) {
  return { hostname: hostname(), pid: 2_000_000_000, nonce: '00000000-0000-4000-8000-000000000000',
    createdAt: new Date(Date.now() - 60_000).toISOString(), ...overrides }
}

test('lease writer lock excludes a subprocess owner, reclaims bounded same-host dead leases, and releases only its owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prismflow-workflow-lock-'))
  const lockPath = join(directory, 'writer.lock')
  try {
    const moduleUrl = new URL('../lib/store-generator-workflows.js', import.meta.url).href
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireWorkflowWriterLock } from ${JSON.stringify(moduleUrl)}; const release = await acquireWorkflowWriterLock(${JSON.stringify(lockPath)}); console.log('ready'); process.stdin.resume(); process.stdin.on('end', async () => { await release(); process.exit(0) })`], { stdio: ['pipe', 'pipe', 'inherit'] })
    let output = ''
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk })
    while (!output.includes('ready')) await new Promise(resolve => setTimeout(resolve, 5))
    await assert.rejects(acquireWorkflowWriterLock(lockPath), /held by PID/)
    child.stdin.end(); await once(child, 'exit')

    const release = await acquireWorkflowWriterLock(lockPath)
    const ownerPath = lockPath
    const owner = JSON.parse(await readFile(ownerPath, 'utf8'))
    const replacement = { ...owner, nonce: '11111111-1111-4111-8111-111111111111' }
    await writeFile(ownerPath, `${JSON.stringify(replacement)}\n`)
    await release()
    assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).nonce, replacement.nonce)
    await rm(lockPath)

    await writeLockOwner(lockPath, deadOwner())
    const releaseRecovered = await acquireWorkflowWriterLock(lockPath, { staleAgeMs: 1 })
    await releaseRecovered()
    await assert.rejects(readFile(ownerPath), error => error.code === 'ENOENT')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('lease writer lock safely reclaims an abandoned lock after the container reuses the current PID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prismflow-workflow-lock-pid-reuse-'))
  const lockPath = join(directory, 'writer.lock')
  try {
    await writeLockOwner(lockPath, deadOwner({
      pid: process.pid,
      createdAt: new Date(Math.floor(performance.timeOrigin) - 1).toISOString(),
    }))
    const release = await acquireWorkflowWriterLock(lockPath, { staleAgeMs: 24 * 60 * 60 * 1000 })
    const owner = JSON.parse(await readFile(lockPath, 'utf8'))
    assert.equal(owner.pid, process.pid)
    assert.ok(Date.parse(owner.createdAt) >= Math.floor(performance.timeOrigin))
    await assert.rejects(acquireWorkflowWriterLock(lockPath), /held by PID/)
    await release()
    await assert.rejects(readFile(lockPath), error => error.code === 'ENOENT')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('lease writer lock creates a missing parent directory before publishing its owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prismflow-workflow-lock-parent-'))
  const lockPath = join(directory, 'nested', 'locks', 'writer.lock')
  try {
    const release = await acquireWorkflowWriterLock(lockPath)
    const owner = JSON.parse(await readFile(lockPath, 'utf8'))
    assert.equal(owner.pid, process.pid)
    await release()
    await assert.rejects(readFile(lockPath), error => error.code === 'ENOENT')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('lease locks never steal foreign-host, empty, malformed, or fresh dead-owner files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prismflow-workflow-lock-invalid-'))
  try {
    for (const [name, setup, pattern] of [
      ['foreign', path => writeLockOwner(path, deadOwner({ hostname: 'other-host.example' })), /another hostname/],
      ['empty', path => writeFile(path, ''), /missing, malformed, or unreadable/],
      ['malformed', path => writeFile(path, '{'), /missing, malformed, or unreadable/],
      ['fresh', path => writeLockOwner(path, deadOwner({ createdAt: new Date().toISOString() })), /bounded stale age/],
    ]) {
      const lockPath = join(directory, name); await setup(lockPath)
      await assert.rejects(acquireWorkflowWriterLock(lockPath, { staleAgeMs: 30_000 }), pattern)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('a crash-mid-recovery lease is itself reclaimed only after same-host dead-owner staleness', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prismflow-workflow-recovery-'))
  const lockPath = join(directory, 'writer.lock')
  try {
    await writeLockOwner(lockPath, deadOwner())
    await writeLockOwner(`${lockPath}.recovery`, deadOwner({ nonce: '22222222-2222-4222-8222-222222222222' }))
    const release = await acquireWorkflowWriterLock(lockPath, { staleAgeMs: 1 })
    await release()
    await assert.rejects(readFile(lockPath), error => error.code === 'ENOENT')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('workflow-store init failure releases its writer lock and closes an opened corrupt domain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prismflow-workflow-init-'))
  const lockPath = join(directory, 'writer.lock')
  try {
    let closed = 0
    const store = new PrismGeneratorWorkflowStore(new Context(), { writerLockPath: lockPath })
    const table = new Table(); table.map.set('malformed', { hidden: true })
    store.ctx = { storageDomain: { async open() { return { table() { return table }, async close() { closed += 1 } } } }, effect() {} }
    await assert.rejects(store[Service.init](), /unknown key/)
    assert.equal(closed, 1)
    await assert.rejects(readFile(lockPath), error => error.code === 'ENOENT')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('workflow writes fail closed without a deployment writer lock', async () => {
  const store = new PrismGeneratorWorkflowStore(new Context())
  store.historyTable = new Table(); store.registerExecutionProfile(profile(), { builderDefault: true })
  await assert.rejects(store.create(definition()), /writerLockPath/)
})

test('workflow-store shutdown releases its writer lease even when domain close fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prismflow-workflow-shutdown-'))
  const lockPath = join(directory, 'writer.lock')
  try {
    let cleanup
    const store = new PrismGeneratorWorkflowStore(new Context(), { writerLockPath: lockPath })
    store.ctx = {
      storageDomain: { async open() { return {
        table() { return new Table() },
        async close() { throw new Error('domain close failed') },
      } } },
      effect(setup) { cleanup = setup() },
    }
    await store[Service.init]()
    assert.equal(typeof cleanup, 'function')
    await assert.rejects(cleanup(), /domain close failed/)
    await assert.rejects(readFile(lockPath), error => error.code === 'ENOENT')
    assert.equal(store.releaseWriterLock, undefined)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
