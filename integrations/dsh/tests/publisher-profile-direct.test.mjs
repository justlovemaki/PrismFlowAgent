import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { configureDashboardRow, deriveDashboardProfileBinding } from '../lib/dashboard-install.js'
import { apply } from '../lib/ui.js'
import {
  beginPublisherProfileOperationDrain, cancelPendingPublisherProfileOperation, commitPublisherProfileOperation,
  configurePublisherProfileRows, exportPublisherProfile, getPendingPublisherProfileOperation, getPublisherProfileOperation,
  importPublisherChangePlan, preparePublisherProfileOperation,
} from '../lib/publisher-profile-cli.js'
import { documentFingerprint, normalizePublisherConfig, publisherConfigRevision } from '../lib/shared/publisher-profile.js'

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'prismflow-direct-profile-'))
  const profileDir = join(home, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), '{}\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return { home, profileDir, cleanup: () => rm(home, { recursive: true, force: true }) }
}
test('configuration backup restore maps foreign absolute local paths into the target DSH home', () => {
  const rows = [
    { rowId: 'prismflow-publisher-local-markdown', channelKind: 'local-markdown', disabled: false,
      config: { destinations: [{ id: 'archive', name: 'Archive', root: 'C:\\Users\\source\\publications' }] } },
    { rowId: 'prismflow-publisher-github-markdown', channelKind: 'github-markdown', disabled: true, config: { destinations: [] } },
    { rowId: 'prismflow-publisher-r2-markdown', channelKind: 'r2-markdown', disabled: true, config: { destinations: [] } },
    { rowId: 'prismflow-publisher-wechat-draft', channelKind: 'wechat-draft', disabled: true, config: { destinations: [] } },
  ]
  assert.equal(normalizePublisherConfig('local-markdown', rows[0].config, { allowPortableAbsolutePaths: true }).destinations[0].root, 'C:\\Users\\source\\publications')
  const patch = configurePublisherProfileRows('[]\n', rows, { destinationHome: '/srv/dsh', platform: 'linux' })
  assert.match(patch, /root: \/srv\/dsh\/publications\/archive/u)
  assert.doesNotMatch(patch, /C:\\Users/u)
})

function changePlan(document, disabled = false) {
  const row = document.rows[0]
  const config = { destinations: [] }
  const body = { kind: 'PrismFlowPublisherChangePlan/v2', profile: document.profile,
    expectedProfileHash: document.profileHash, expectedDocumentRevision: document.documentRevision,
    createdAt: '2026-08-24T00:00:00.000Z', changes: [{ rowId: row.rowId, expectedRowRevision: row.rowRevision,
      disabled, config, configRevision: publisherConfigRevision(row.channelKind, config) }] }
  return { ...body, fingerprint: documentFingerprint(body) }
}

await test('v2 Profile documents bind stable document/row CAS and reject stale row baselines', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  assert.equal(document.kind, 'PrismFlowPublisherProfileDocument/v2')
  assert.match(document.documentRevision, /^[a-f0-9]{64}$/u)
  assert.ok(document.rows.every(row => /^[a-f0-9]{64}$/u.test(row.rowRevision)))
  const stale = changePlan(document)
  stale.changes[0].expectedRowRevision = '0'.repeat(64)
  stale.fingerprint = documentFingerprint(stale)
  assert.throws(() => preparePublisherProfileOperation('web', '77777777-7777-4777-8777-777777777777', stale, { home: value.home }), /stale row revision/u)
  assert.equal(existsSync(join(value.profileDir, '.prismflow-publisher-profile-operations.json')), false)
})

await test('durable direct operation replays after response loss and blocks imports while unresolved', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const plan = changePlan(document)
  const operationId = '88888888-8888-4888-8888-888888888888'
  assert.equal(preparePublisherProfileOperation('web', operationId, plan, { home: value.home }).pending, true)
  assert.throws(() => importPublisherChangePlan('web', plan, { home: value.home }), /pending recovery/u)
  beginPublisherProfileOperationDrain('web', operationId, { home: value.home })
  assert.throws(() => commitPublisherProfileOperation('web', operationId, plan, { home: value.home,
    onPowerLossPoint(point) { if (point === 'patch-rename-directory-fsynced-before-operation-completion') throw new Error('lost response') },
  }), /lost response/u)
  const recovered = preparePublisherProfileOperation('web', operationId, plan, { home: value.home })
  assert.equal(recovered.replayed, true); assert.equal(recovered.result.status, 'completed')
  assert.deepEqual(getPublisherProfileOperation('web', operationId, { home: value.home }), { ...recovered.result, replayed: false })
  const operationState = JSON.parse(readFileSync(join(value.profileDir, '.prismflow-publisher-profile-operations.json'), 'utf8'))
  assert.deepEqual(operationState.operations[operationId].request.plan, plan, 'the exact normalized strict-v2 request survives response loss')
  assert.deepEqual(operationState.operations[operationId].preconditions.overlays.map(item => [item.candidate, item.presence]), [
    ['dsh-home-patch', 'absent'], ['dsh-home-config', 'absent'], ['profile-config', 'absent'],
  ])
  assert.equal(operationState.operations[operationId].preconditions.state.presence, 'absent')
  assert.match(operationState.operations[operationId].preconditions.state.fingerprint, /^[a-f0-9]{64}$/u)
  assert.equal(JSON.stringify(operationState).includes('credentialValue'), false)
  const other = structuredClone(plan); other.createdAt = '2026-08-24T00:00:01.000Z'; other.fingerprint = documentFingerprint(other)
  assert.throws(() => preparePublisherProfileOperation('web', operationId, other, { home: value.home }), /different Publisher Profile request/u)
})

await test('pending recovery is discoverable without browser state and cancellation is strictly pre-drain', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const plan = changePlan(document)
  const operationId = '89898989-8989-4989-8989-898989898989'
  preparePublisherProfileOperation('web', operationId, plan, { home: value.home })
  const pending = getPendingPublisherProfileOperation('web', { home: value.home })
  assert.equal(pending.operationId, operationId); assert.equal(pending.recoveryState, 'old-hash-pre-drain')
  assert.equal(pending.canCancel, true); assert.equal(pending.canResume, true)
  assert.equal(cancelPendingPublisherProfileOperation('web', { home: value.home }).status, 'cancelled')
  assert.equal(getPendingPublisherProfileOperation('web', { home: value.home }), undefined)

  const secondId = '90909090-9090-4090-8090-909090909090'
  preparePublisherProfileOperation('web', secondId, plan, { home: value.home })
  beginPublisherProfileOperationDrain('web', secondId, { home: value.home })
  const draining = getPendingPublisherProfileOperation('web', { home: value.home })
  assert.equal(draining.recoveryState, 'old-hash-after-drain-started'); assert.equal(draining.canCancel, false)
  assert.throws(() => cancelPendingPublisherProfileOperation('web', { home: value.home }), /only while definitively pre-drain/u)
})

await test('drain start CAS-revalidates patch, Profile directory, overlays, and tombstones while conflicts remain cancellable', async t => {
  const mutations = [
    ['patch identity', value => {
      const patchPath = join(value.profileDir, 'cordis.patch.yml')
      const candidate = join(value.profileDir, 'replacement.patch.yml')
      writeFileSync(candidate, readFileSync(patchPath, 'utf8')); renameSync(candidate, patchPath)
    }],
    ['Profile directory identity', value => {
      const replacement = `${value.profileDir}-replacement`
      mkdirSync(replacement)
      for (const name of ['package.json', 'cordis.patch.yml', '.prismflow-publisher-profile-operations.json']) {
        writeFileSync(join(replacement, name), readFileSync(join(value.profileDir, name)))
      }
      renameSync(value.profileDir, `${value.profileDir}-original`); renameSync(replacement, value.profileDir)
    }],
    ['higher-precedence overlay', value => { writeFileSync(join(value.home, 'cordis.yml'), '- id: unrelated\n  disabled: true\n') }],
    ['tombstone state', value => {
      const body = { kind: 'PrismFlowPublisherProfileState/v1', destinations: {} }
      writeFileSync(join(value.profileDir, '.prismflow-publisher-profile-state.json'), `${JSON.stringify({ ...body, fingerprint: documentFingerprint(body) })}\n`)
    }],
  ]
  const operationIds = [
    'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2',
    'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3', 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4',
  ]
  for (let index = 0; index < mutations.length; index += 1) {
    const [label, mutate] = mutations[index]
    await t.test(label, async nested => {
      const value = await fixture(); nested.after(value.cleanup)
      const plan = changePlan(exportPublisherProfile('web', { home: value.home }))
      const operationId = operationIds[index]
      preparePublisherProfileOperation('web', operationId, plan, { home: value.home })
      mutate(value)
      assert.throws(() => beginPublisherProfileOperationDrain('web', operationId, { home: value.home }), /stale/u)
      const pending = getPendingPublisherProfileOperation('web', { home: value.home })
      assert.equal(pending.phase, 'prepared'); assert.equal(pending.canCancel, true)
      assert.equal(cancelPendingPublisherProfileOperation('web', operationId, { home: value.home }).status, 'cancelled')
    })
  }
})

await test('commit after drain rejects same-content patch and Profile directory identity replacement', async t => {
  const mutations = [
    ['patch', value => {
      const patchPath = join(value.profileDir, 'cordis.patch.yml')
      const replacement = join(value.profileDir, 'same-content-replacement.yml')
      writeFileSync(replacement, readFileSync(patchPath))
      renameSync(replacement, patchPath)
    }, /patch identity or hash became stale/u],
    ['Profile directory', value => {
      const replacement = `${value.profileDir}-replacement`
      mkdirSync(replacement)
      for (const name of ['package.json', 'cordis.patch.yml', '.prismflow-publisher-profile-operations.json']) {
        writeFileSync(join(replacement, name), readFileSync(join(value.profileDir, name)))
      }
      renameSync(value.profileDir, `${value.profileDir}-prepared`)
      renameSync(replacement, value.profileDir)
    }, /directory identity became stale/u],
  ]
  for (const [index, [label, mutate, message]] of mutations.entries()) {
    await t.test(label, async nested => {
      const value = await fixture(); nested.after(value.cleanup)
      const patchPath = join(value.profileDir, 'cordis.patch.yml')
      const plan = changePlan(exportPublisherProfile('web', { home: value.home }))
      const operationId = ['b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'][index]
      preparePublisherProfileOperation('web', operationId, plan, { home: value.home })
      beginPublisherProfileOperationDrain('web', operationId, { home: value.home })
      const original = readFileSync(patchPath, 'utf8')
      mutate(value)
      assert.throws(() => commitPublisherProfileOperation('web', operationId, plan, { home: value.home }), message)
      assert.equal(readFileSync(patchPath, 'utf8'), original)
      assert.equal(getPendingPublisherProfileOperation('web', { home: value.home }).phase, 'draining')
    })
  }
})

await test('state created or changed after preparation fails exact CAS without replacing the patch', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const patchPath = join(value.profileDir, 'cordis.patch.yml')
  const original = readFileSync(patchPath, 'utf8')
  const document = exportPublisherProfile('web', { home: value.home })
  const plan = changePlan(document)
  const operationId = '91929292-9292-4292-8292-929292929292'
  preparePublisherProfileOperation('web', operationId, plan, { home: value.home })
  beginPublisherProfileOperationDrain('web', operationId, { home: value.home })
  const stateBody = { kind: 'PrismFlowPublisherProfileState/v1', destinations: { 'unrelated:divergent': 'f'.repeat(64) } }
  writeFileSync(join(value.profileDir, '.prismflow-publisher-profile-state.json'), `${JSON.stringify({ ...stateBody, fingerprint: documentFingerprint(stateBody) }, null, 2)}\n`)
  assert.throws(() => commitPublisherProfileOperation('web', operationId, plan, { home: value.home }), /managed state became stale/u)
  assert.equal(readFileSync(patchPath, 'utf8'), original)
  assert.equal(getPendingPublisherProfileOperation('web', { home: value.home }).phase, 'draining')
})

await test('restart resumes the exact state-only commit boundary once and rejects divergent state', async t => {
  await t.test('durable state rename survives process exit and response replay', async nested => {
    const value = await fixture(); nested.after(value.cleanup)
    const plan = changePlan(exportPublisherProfile('web', { home: value.home }))
    const operationId = 'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3'
    preparePublisherProfileOperation('web', operationId, plan, { home: value.home })
    const operationPath = join(value.profileDir, '.prismflow-publisher-profile-operations.json')
    const prepared = JSON.parse(readFileSync(operationPath, 'utf8')).operations[operationId]
    assert.match(prepared.preconditions.nextState.fingerprint, /^[a-f0-9]{64}$/u)
    assert.match(prepared.preconditions.nextState.sha256, /^[a-f0-9]{64}$/u)
    beginPublisherProfileOperationDrain('web', operationId, { home: value.home })

    const moduleUrl = new URL('../lib/publisher-profile-cli.js', import.meta.url).href
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const api = await import(process.env.PROFILE_MODULE_URL)
      const plan = JSON.parse(process.env.PROFILE_PLAN)
      api.commitPublisherProfileOperation('web', process.env.PROFILE_OPERATION_ID, plan, {
        home: process.env.PROFILE_HOME,
        onPowerLossPoint(point) { if (point === 'state-rename-directory-fsynced-before-patch-rename') process.exit(86) },
      })
    `], { env: { ...process.env, PROFILE_MODULE_URL: moduleUrl, PROFILE_PLAN: JSON.stringify(plan),
      PROFILE_OPERATION_ID: operationId, PROFILE_HOME: value.home }, encoding: 'utf8' })
    assert.equal(child.status, 86, child.stderr)
    assert.equal(readFileSync(join(value.profileDir, 'cordis.patch.yml'), 'utf8'), '[]\n')
    const pending = getPendingPublisherProfileOperation('web', { home: value.home })
    assert.equal(pending.recoveryState, 'old-hash-after-drain-started')
    assert.equal(pending.canResume, true)
    assert.equal(pending.canCancel, false)

    beginPublisherProfileOperationDrain('web', operationId, { home: value.home })
    const completed = commitPublisherProfileOperation('web', operationId, plan, { home: value.home })
    assert.equal(completed.status, 'completed'); assert.equal(completed.replayed, false)
    const replay = commitPublisherProfileOperation('web', operationId, plan, { home: value.home })
    assert.equal(replay.status, 'completed'); assert.equal(replay.replayed, true)
    assert.equal(exportPublisherProfile('web', { home: value.home }).profileHash, completed.profileHash)
  })

  await t.test('a different valid state at the intermediate boundary remains blocked', async nested => {
    const value = await fixture(); nested.after(value.cleanup)
    const plan = changePlan(exportPublisherProfile('web', { home: value.home }))
    const operationId = 'b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4'
    preparePublisherProfileOperation('web', operationId, plan, { home: value.home })
    beginPublisherProfileOperationDrain('web', operationId, { home: value.home })
    assert.throws(() => commitPublisherProfileOperation('web', operationId, plan, { home: value.home,
      onPowerLossPoint(point) { if (point === 'state-rename-directory-fsynced-before-patch-rename') throw new Error('crash') },
    }), /crash/u)
    const divergentBody = { kind: 'PrismFlowPublisherProfileState/v1', destinations: { 'other:identity': 'e'.repeat(64) } }
    writeFileSync(join(value.profileDir, '.prismflow-publisher-profile-state.json'),
      `${JSON.stringify({ ...divergentBody, fingerprint: documentFingerprint(divergentBody) }, null, 2)}\n`)
    assert.equal(getPendingPublisherProfileOperation('web', { home: value.home }).canResume, false)
    assert.throws(() => beginPublisherProfileOperationDrain('web', operationId, { home: value.home }), /state became stale/u)
    assert.throws(() => commitPublisherProfileOperation('web', operationId, plan, { home: value.home }), /state became stale/u)
    assert.throws(() => cancelPendingPublisherProfileOperation('web', operationId, { home: value.home }), /only while definitively pre-drain/u)
  })
})

await test('pending recovery exposes an ambiguous hash without guessing or permitting resume/cancel', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const plan = changePlan(document)
  const operationId = '92929292-9292-4292-8292-929292929292'
  preparePublisherProfileOperation('web', operationId, plan, { home: value.home })
  writeFileSync(join(value.profileDir, 'cordis.patch.yml'), '- id: unrelated\n  disabled: true\n')
  const pending = getPendingPublisherProfileOperation('web', { home: value.home })
  assert.equal(pending.recoveryState, 'ambiguous-hash'); assert.equal(pending.canResume, false); assert.equal(pending.canCancel, false)
  assert.throws(() => beginPublisherProfileOperationDrain('web', operationId, { home: value.home }), /ambiguous Profile outcome/u)
  assert.throws(() => cancelPendingPublisherProfileOperation('web', { home: value.home }), /only while definitively pre-drain/u)
})

await test('installer derives one canonical binding and YAML-migrates only the unique exact Dashboard row', async t => {
  const value = await fixture(); t.after(value.cleanup)
  assert.deepEqual(deriveDashboardProfileBinding(value.profileDir), { dshHome: value.home, profileName: 'web' })
  const patch = "- insert:\n    - id: unrelated\n      name: example\n    - id: prismflow-dashboard\n      name: '@prismflow/dsh-dashboard'\n"
  const output = configureDashboardRow(patch, { dshHome: value.home, profileName: 'web' })
  assert.match(output, /name: '@prismflow\/dsh\/ui'/u)
  assert.doesNotMatch(output, /@prismflow\/dsh-dashboard/u)
  assert.match(output, /config:\s*\n\s+dshHome:/u); assert.match(output, /profileName: web/u)
  assert.throws(() => configureDashboardRow(`${patch}${patch}`, { dshHome: value.home, profileName: 'web' }), /duplicated/u)
  assert.throws(() => configureDashboardRow("- id: prismflow-dashboard\n  name: '@prismflow/dsh-dashboard'\n", { dshHome: value.home, profileName: 'web' }), /unsupported shape/u)
  assert.throws(() => configureDashboardRow('- remove: prismflow-dashboard\n', { dshHome: value.home, profileName: 'web' }), /unsupported shape/u)
})

async function dashboard(value, options = {}) {
  let route, drains = 0
  const credentialValues = options.credentialValues ?? new Map()
  const maintenance = { draining: false, active: 0 }
  const publishers = {
    inventory: () => [], list: () => [],
    async beginMaintenanceDrain() { drains += 1; maintenance.draining = true; maintenance.active = options.blockDrain ? 1 : 0; options.onDrain?.() },
    maintenanceStatus() { return { ...maintenance, restartAllowed: maintenance.draining && maintenance.active === 0 } },
  }
  const credentials = {
    async describe(ref) { return { configured: credentialValues.has(ref), ...(credentialValues.has(ref) ? { source: 'file' } : {}), writable: true } },
    async set(ref, secret) { credentialValues.set(ref, secret) }, async unset(ref) { credentialValues.delete(ref) },
  }
  const ctx = { get: key => key === 'prismPublishers' ? publishers : key === 'credentials' ? credentials : undefined,
    webServer: { register(next) { route = next } }, effect(factory) { factory() }, logger: { warn() {} } }
  apply(ctx, { dshHome: value.home, profileName: 'web' })
  const server = createServer((req, res) => void route.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  async function post(path, body, headers = { origin }) {
    const response = await fetch(`${origin}/api/prismflow${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { status: response.status, value: await response.json() }
  }
  async function get(path) {
    const response = await fetch(`${origin}/api/prismflow${path}`)
    return { status: response.status, value: await response.json() }
  }
  return { origin, post, get, credentialValues, get drains() { return drains }, close: () => new Promise(resolve => server.close(resolve)) }
}

await test('Dashboard publisher credential fields are write-only, Profile-bound, same-origin, and immediately rotatable', async t => {
  const value = await fixture(); t.after(value.cleanup)
  writeFileSync(join(value.profileDir, 'cordis.patch.yml'), `- id: prismflow-publisher-github-markdown\n  disabled: false\n  config:\n    destinations:\n      - id: archive\n        name: GitHub Archive\n        repository: owner/repo\n        branch: main\n        pathPrefix: daily\n        artifactFileNamePattern: "{date}.md"\n        overwrite: if-changed\n        artifactCommitMessage: "publish {date}"\n        apiBaseUrl: https://api.github.com\n        tokenCredential: PRISMFLOW_GITHUB_TOKEN\n        maxBytes: 900000\n`)
  const app = await dashboard(value); t.after(app.close)
  const read = await app.post('/publisher-profile/read', {})
  const slot = read.value.credentialSlots.find(item => item.destinationId === 'archive' && item.field === 'tokenCredential')
  assert.deepEqual(slot, { rowId: 'prismflow-publisher-github-markdown', channelKind: 'github-markdown', destinationId: 'archive',
    destinationName: 'GitHub Archive', field: 'tokenCredential', label: 'GitHub Token', configRevision: slot.configRevision,
    configured: false, writable: true })
  assert.equal(Object.hasOwn(slot, 'credentialRef'), false)
  const authority = { rowId: slot.rowId, destinationId: slot.destinationId, field: slot.field, expectedConfigRevision: slot.configRevision }
  assert.equal((await app.post('/publisher-profile/credential/set', { ...authority, value: 'write-only-secret', extra: true })).status, 400)
  assert.equal((await app.post('/publisher-profile/credential/set', { ...authority, value: 'write-only-secret' }, {})).status, 403)
  assert.equal((await app.post('/publisher-profile/credential/set', { ...authority, expectedConfigRevision: '0'.repeat(64), value: 'write-only-secret' })).status, 409)
  const stored = await app.post('/publisher-profile/credential/set', { ...authority, value: 'write-only-secret' })
  assert.deepEqual(stored.value, { updated: true }); assert.equal(JSON.stringify(stored.value).includes('write-only-secret'), false)
  assert.equal(app.credentialValues.get('PRISMFLOW_GITHUB_TOKEN'), 'write-only-secret')
  const refreshed = await app.get('/publisher-profile/credentials')
  assert.equal(refreshed.value.slots[0].configured, true); assert.equal(JSON.stringify(refreshed.value).includes('write-only-secret'), false)
  assert.deepEqual((await app.post('/publisher-profile/credential/unset', authority)).value, { removed: true })
  assert.equal(app.credentialValues.has('PRISMFLOW_GITHUB_TOKEN'), false)
})

await test('Dashboard/server restart discovers and resumes a post-drain-start pending operation with its displayed exact ID', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const first = await dashboard(value, { blockDrain: true })
  const read = await first.post('/publisher-profile/read', {})
  const plan = changePlan(read.value.document)
  const operationId = '91919191-9191-4191-8191-919191919191'
  const response = await first.post('/publisher-profile/apply', { operationId, confirmPauseUntilRestart: true, plan })
  assert.equal(response.status, 202); assert.equal(response.value.operation.phase, 'draining')
  await first.close()

  const restarted = await dashboard(value); t.after(restarted.close)
  const pending = await restarted.get('/publisher-profile/pending-operation')
  assert.equal(pending.status, 200); assert.equal(pending.value.operation.operationId, operationId)
  assert.equal(pending.value.operation.canCancel, false); assert.equal(pending.value.operation.canResume, true)
  const resumed = await restarted.post('/publisher-profile/pending-operation', { action: 'resume', operationId })
  assert.equal(resumed.status, 200); assert.equal(resumed.value.operation.status, 'completed')
  assert.equal((await restarted.get('/publisher-profile/pending-operation')).value.operation, null)
})

await test('pending reconciliation DTO is strict and rejects stale tabs after a newer operation appears', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const app = await dashboard(value); t.after(app.close)
  const plan = changePlan((await app.post('/publisher-profile/read', {})).value.document)
  const oldId = 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5'
  const newId = 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6'
  preparePublisherProfileOperation('web', oldId, plan, { home: value.home })
  assert.equal((await app.post('/publisher-profile/pending-operation', { action: 'cancel' })).status, 400)
  assert.equal((await app.post('/publisher-profile/pending-operation', { action: 'cancel', operationId: oldId, extra: true })).status, 400)
  assert.equal((await app.post('/publisher-profile/pending-operation', { action: 'cancel', operationId: oldId.toUpperCase() })).status, 400)
  assert.equal((await app.post('/publisher-profile/pending-operation', { action: 'cancel', operationId: oldId })).status, 200)
  preparePublisherProfileOperation('web', newId, plan, { home: value.home })

  assert.equal((await app.post('/publisher-profile/pending-operation', { action: 'cancel', operationId: oldId })).status, 409)
  assert.equal((await app.post('/publisher-profile/pending-operation', { action: 'resume', operationId: oldId })).status, 409)
  assert.equal(app.drains, 0, 'a stale tab must never pause admission')
  const current = (await app.get('/publisher-profile/pending-operation')).value.operation
  assert.equal(current.operationId, newId); assert.equal(current.phase, 'prepared'); assert.equal(current.canCancel, true)
})

await test('preparation rejects tombstone identity conflicts before maintenance drain or operation reservation', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const stateBody = { kind: 'PrismFlowPublisherProfileState/v1', destinations: {
    'prismflow-publisher-local-markdown:retired': 'f'.repeat(64),
  } }
  writeFileSync(join(value.profileDir, '.prismflow-publisher-profile-state.json'), `${JSON.stringify({ ...stateBody, fingerprint: documentFingerprint(stateBody) })}\n`)
  const app = await dashboard(value); t.after(app.close)
  const document = (await app.post('/publisher-profile/read', {})).value.document
  const row = document.rows[0]
  const config = normalizePublisherConfig(row.channelKind, { destinations: [{ id: 'retired', name: 'Conflicting identity', root: value.home }] })
  const body = { kind: 'PrismFlowPublisherChangePlan/v2', profile: document.profile,
    expectedProfileHash: document.profileHash, expectedDocumentRevision: document.documentRevision,
    createdAt: '2026-08-24T00:00:00.000Z', changes: [{ rowId: row.rowId, expectedRowRevision: row.rowRevision,
      disabled: true, config, configRevision: publisherConfigRevision(row.channelKind, config) }] }
  const response = await app.post('/publisher-profile/apply', { operationId: '93939393-9393-4393-8393-939393939393',
    confirmPauseUntilRestart: true, plan: { ...body, fingerprint: documentFingerprint(body) } })
  assert.equal(response.status, 409, JSON.stringify(response.value))
  assert.equal(app.drains, 0)
  assert.equal(existsSync(join(value.profileDir, '.prismflow-publisher-profile-operations.json')), false)
})

await test('an overlay created during drain fails closed without replacing the patch and remains restart-required', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const original = readFileSync(join(value.profileDir, 'cordis.patch.yml'), 'utf8')
  const overlayPath = join(value.home, 'cordis.yml')
  const app = await dashboard(value, { onDrain() { writeFileSync(overlayPath, '- id: unrelated-overlay\n  disabled: true\n') } }); t.after(app.close)
  const document = (await app.post('/publisher-profile/read', {})).value.document
  const response = await app.post('/publisher-profile/apply', { operationId: '94949494-9494-4494-8494-949494949494',
    confirmPauseUntilRestart: true, plan: changePlan(document) })
  assert.equal(response.status, 409)
  assert.equal(response.value.maintenance, true)
  assert.equal(response.value.restartRequired, true)
  assert.equal(readFileSync(join(value.profileDir, 'cordis.patch.yml'), 'utf8'), original)
  const pending = getPendingPublisherProfileOperation('web', { home: value.home })
  assert.equal(pending.phase, 'draining')
  assert.equal(pending.canCancel, false)
})

await test('direct Profile HTTP read/apply is same-origin, bounded, drained once, and durably replayable', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const app = await dashboard(value); t.after(app.close)
  assert.equal((await app.post('/publisher-profile/read', {}, {})).status, 403)
  const read = await app.post('/publisher-profile/read', {})
  assert.equal(read.status, 200); assert.equal(read.value.document.kind, 'PrismFlowPublisherProfileDocument/v2')
  assert.equal(JSON.stringify(read.value).includes(value.home), false)
  const plan = changePlan(read.value.document)
  const body = { operationId: '99999999-9999-4999-8999-999999999999', confirmPauseUntilRestart: true, plan }
  const applied = await app.post('/publisher-profile/apply', body)
  assert.equal(applied.status, 200); assert.equal(applied.value.operation.restartRequired, true); assert.equal(app.drains, 1)
  const replay = await app.post('/publisher-profile/apply', body)
  assert.equal(replay.status, 200); assert.equal(replay.value.operation.replayed, true); assert.equal(app.drains, 1)
  assert.equal((await app.post('/publisher-profile/operation', { operationId: body.operationId })).value.operation.status, 'completed')
  const oversized = await app.post('/publisher-profile/read', { padding: 'x'.repeat(33 * 1024) })
  assert.equal(oversized.status, 413)
})
