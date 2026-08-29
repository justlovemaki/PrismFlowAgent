import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { hostname, tmpdir } from 'node:os'
import test from 'node:test'
import {
  beginPublisherProfileOperationDrain, commitPublisherProfileOperation, exportPublisherProfile, importPublisherChangePlan,
  preflightPublisherChangePlan, preparePublisherProfileOperation, validatePublisherChangePlan, validatePublisherDocument,
} from '../lib/publisher-profile-cli.js'
import { canonicalJson, documentFingerprint, normalizePublisherConfig, PUBLISHER_ROWS, publisherConfigRevision } from '../lib/shared/publisher-profile.js'

const managedPublisherChannels = PUBLISHER_ROWS.map(row => ({ ...row, moduleName: `@prismflow/dsh/publisher-${row.kind}` }))
const patchTemplate = readFileSync(new URL('./fixtures/web-profile-cordis.patch.yml', import.meta.url), 'utf8')
function fixturePatch(home) {
  const yamlPath = value => value.replaceAll('\\', '/')
  return patchTemplate.replace('__SQLITE_PATH__', yamlPath(join(home, 'storages', 'domain.sqlite')))
    .replace('__LOCAL_ROOT__', yamlPath(home))
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'prismflow-profile-'))
  const profile = join(home, 'profiles', 'web')
  const source = fixturePatch(home)
  mkdirSync(profile, { recursive: true }); writeFileSync(join(profile, 'package.json'), '{}\n'); writeFileSync(join(profile, 'cordis.patch.yml'), source)
  return { home, profile, source, cleanup: () => rm(home, { recursive: true, force: true }) }
}
function plan(document, changes) {
  const body = { kind: 'PrismFlowPublisherChangePlan/v1', profile: 'web', expectedProfileHash: document.profileHash,
    createdAt: '2026-08-24T00:00:00.000Z', changes }
  return { ...body, fingerprint: documentFingerprint(body) }
}
function directPlan(document, row = document.rows[1]) {
  const body = { kind: 'PrismFlowPublisherChangePlan/v2', profile: 'web', expectedProfileHash: document.profileHash,
    expectedDocumentRevision: document.documentRevision, createdAt: '2026-08-24T00:00:00.000Z',
    changes: [{ rowId: row.rowId, expectedRowRevision: row.rowRevision, disabled: !row.disabled,
      config: row.config, configRevision: row.configRevision }] }
  return { ...body, fingerprint: documentFingerprint(body) }
}
function ledgerRecord(operationId, overrides = {}) {
  const revisions = Object.fromEntries(PUBLISHER_ROWS.map((row, index) => [row.rowId, {
    oldRowRevision: String(index + 1).repeat(64), rowRevision: String(index + 2).repeat(64), configRevision: String(index + 3).repeat(64),
  }]))
  return { operationId, digest: 'a'.repeat(64), profile: 'web', oldProfileHash: 'b'.repeat(64), newProfileHash: 'c'.repeat(64),
    oldDocumentRevision: 'd'.repeat(64), newDocumentRevision: 'e'.repeat(64), revisions, status: 'completed',
    createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', ...overrides }
}
function ledgerId(index) { return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}` }
function writeLedger(profileDir, operations) {
  const body = { kind: 'PrismFlowPublisherProfileOperations/v1', operations }
  writeFileSync(join(profileDir, '.prismflow-publisher-profile-operations.json'), `${JSON.stringify({ ...body, fingerprint: documentFingerprint(body) })}\n`)
}

await test('fixed-scope export and atomic import preserve unrelated rows and require immutable operational destination ids', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home, now: new Date('2026-08-24T00:00:00.000Z') })
  assert.equal(document.rows.length, 4); assert.equal(document.fingerprint, documentFingerprint(document))
  assert.equal(document.rows.find(row => row.channelKind === 'local-markdown').disabled, false)
  for (const row of document.rows.filter(row => row.channelKind !== 'local-markdown')) assert.deepEqual({ disabled: row.disabled, config: row.config }, { disabled: true, config: { destinations: [] } })
  assert.equal(readFileSync(join(value.profile, 'cordis.patch.yml'), 'utf8'), value.source, 'export does not materialize missing bundle-default overrides')
  const local = { id: 'daily', name: 'Daily', root: value.home, artifactFileNamePattern: 'draft-{date}.md', overwrite: 'if-changed', maxBytes: 100000 }
  const config = { destinations: [local] }
  const change = { rowId: 'prismflow-publisher-local-markdown', disabled: false, config,
    configRevision: publisherConfigRevision('local-markdown', config) }
  const result = importPublisherChangePlan('web', plan(document, [change]), { home: value.home, now: new Date('2026-08-24T00:00:00.000Z') })
  assert.equal(result.restartRequired, true)
  const after = readFileSync(join(value.profile, 'cordis.patch.yml'), 'utf8')
  assert.match(after, /Keep an unrelated override[\s\S]*id: storage-domain/u); assert.match(after, /id: daily/u)
  for (const rowId of ['prismflow-publisher-local-markdown', 'prismflow-publisher-github-markdown', 'prismflow-publisher-r2-markdown', 'prismflow-publisher-wechat-draft']) {
    assert.equal(after.match(new RegExp(`^\\s*- id: ${rowId}$`, 'gmu'))?.length, 1, `${rowId} has one top-level override`)
  }

  const current = exportPublisherProfile('web', { home: value.home })
  const changedConfig = { destinations: [{ ...local, root: tmpdir() }] }
  const illegal = { ...change, config: changedConfig, configRevision: publisherConfigRevision('local-markdown', changedConfig) }
  assert.throws(() => validatePublisherChangePlan(plan(current, [illegal]), current), /new immutable destination id/u)
})

await test('partial top-level overrides merge over the fixed disabled-empty bundle default', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const partial = `# partial managed override\n- insert:\n    - id: prismflow-dashboard\n      name: '@prismflow/dsh-dashboard'\n\n- id: prismflow-publisher-local-markdown\n`
  writeFileSync(join(value.profile, 'cordis.patch.yml'), partial)
  const exported = exportPublisherProfile('web', { home: value.home })
  for (const row of exported.rows) assert.deepEqual({ disabled: row.disabled, config: row.config }, { disabled: true, config: { destinations: [] } })
})

await test('export to visual-normalized plan validates, preflights, imports, and re-exports all effective overrides', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const exported = exportPublisherProfile('web', { home: value.home, now: new Date('2026-08-24T00:00:00.000Z') })
  const desired = {
    'local-markdown': { disabled: true, config: { destinations: [] } },
    'github-markdown': { disabled: false, config: { destinations: [{
      id: 'github-daily', name: 'GitHub Daily', repository: 'owner/repository', branch: 'main', pathPrefix: 'daily',
      artifactFileNamePattern: 'brief-{date}.md', overwrite: 'if-changed', artifactCommitMessage: 'publish {date}',
      apiBaseUrl: 'https://api.github.com', tokenCredential: 'GITHUB_TOKEN', maxBytes: 900000,
    }] } },
    'r2-markdown': { disabled: false, config: { destinations: [{
      id: 'r2-daily', name: 'R2 Daily', accountId: '0123456789abcdef0123456789abcdef', bucket: 'daily-archive', pathPrefix: 'briefs',
      artifactFileNamePattern: 'brief-{date}.md', overwrite: 'if-changed', publicUrlPrefix: '',
      accessKeyIdCredential: 'R2_ACCESS_KEY_ID', secretAccessKeyCredential: 'R2_SECRET_ACCESS_KEY', maxBytes: 900000,
    }] } },
    'wechat-draft': { disabled: true, config: { destinations: [{
      id: 'wechat-daily', name: 'WeChat Daily', appId: 'wx123', appSecretCredential: 'WECHAT_APP_SECRET', articleType: 'news', limits: {},
    }] } },
  }
  const changes = exported.rows.map(row => {
    // Dashboard/client parity tests prove this canonical normalization is identical to visual normalization.
    const config = normalizePublisherConfig(row.channelKind, desired[row.channelKind].config)
    return { rowId: row.rowId, disabled: desired[row.channelKind].disabled, config,
      configRevision: publisherConfigRevision(row.channelKind, config) }
  })
  const changePlan = plan(exported, changes)
  assert.deepEqual(validatePublisherChangePlan(changePlan, exported).changes, changes)
  const preflight = preflightPublisherChangePlan(changePlan, exported)
  assert.deepEqual({ networkRequests: preflight.networkRequests, destinationWrites: preflight.destinationWrites }, { networkRequests: 0, destinationWrites: 0 })
  importPublisherChangePlan('web', changePlan, { home: value.home })

  const output = readFileSync(join(value.profile, 'cordis.patch.yml'), 'utf8')
  assert.match(output, /# Keep an unrelated override and its position\/comment intact\.[\s\S]*- id: storage-domain/u)
  assert.ok(output.indexOf('- id: storage-domain') < output.indexOf('- id: prismflow-publisher-local-markdown'))
  for (const rowId of changes.map(change => change.rowId)) assert.equal(output.match(new RegExp(`^\\s*- id: ${rowId}$`, 'gmu'))?.length, 1)
  const reexported = exportPublisherProfile('web', { home: value.home })
  for (const change of changes) {
    const row = reexported.rows.find(item => item.rowId === change.rowId)
    assert.deepEqual({ rowId: row.rowId, disabled: row.disabled, config: row.config, configRevision: row.configRevision }, change)
  }
})

test('authoritative channel forms enforce semantic boundaries, duplicate ids, traversal, and normalized WeChat credential references', () => {
  assert.throws(() => normalizePublisherConfig('local-markdown', { destinations: [
    { id: 'same', name: 'One', root: '/', artifactFileNamePattern: '../x-{date}.md', overwrite: 'never', maxBytes: 10000 },
  ] }), /filename|basename|path|unsafe/i)
  assert.throws(() => normalizePublisherConfig('github-markdown', { destinations: [
    { id: 'same', name: 'One', repository: 'owner/repo', branch: 'main', pathPrefix: '../escape', artifactFileNamePattern: '{date}.md', overwrite: 'never', artifactCommitMessage: 'publish {date}', apiBaseUrl: 'https://api.github.com', tokenCredential: 'TOKEN', maxBytes: 10000 },
  ] }), /pathPrefix|traversal|normalized/i)
  const r2 = { id: 'same', name: 'One', accountId: 'a'.repeat(32), bucket: 'valid-bucket', pathPrefix: 'daily', artifactFileNamePattern: '{date}.md', overwrite: 'never', publicUrlPrefix: '', accessKeyIdCredential: 'R2_ACCESS', secretAccessKeyCredential: 'R2_SECRET', maxBytes: 10000 }
  assert.throws(() => normalizePublisherConfig('r2-markdown', { destinations: [r2, r2] }), /Duplicate/u)
  const legacyWechat = { destinations: [{ id: 'wx', name: 'WeChat', appId: 'wx123', appSecretCredential: 'legacy-ref:value', articleType: 'news', limits: {} }] }
  assert.throws(() => normalizePublisherConfig('wechat-draft', legacyWechat), /credential reference/u)
  assert.equal(normalizePublisherConfig('wechat-draft', legacyWechat, { allowLegacyCredentialRefs: true }).destinations[0].appSecretCredential, 'legacy-ref:value')
  const wechat = normalizePublisherConfig('wechat-draft', { destinations: [{ id: 'wx', name: 'WeChat', appId: 'wx123', appSecretCredential: 'WECHAT_SECRET', articleType: 'news', limits: {} }] })
  assert.equal(wechat.destinations[0].appSecretCredential, 'WECHAT_SECRET')
  assert.equal(Object.hasOwn(wechat.destinations[0], 'allowInsecureHttp'), false, 'safe default must remain omitted so historical Profile and operation revisions stay valid')
  assert.equal(Object.hasOwn(wechat.destinations[0], 'ffmpegPath'), false, 'new operational defaults must not rewrite historical Profile operation revisions')
  const ffmpegWechat = normalizePublisherConfig('wechat-draft', { destinations: [{ ...wechat.destinations[0], ffmpegPath: 'D:/tools/ffmpeg.exe' }] })
  assert.equal(ffmpegWechat.destinations[0].ffmpegPath, 'D:/tools/ffmpeg.exe')
  const gatewayWechat = normalizePublisherConfig('wechat-draft', { destinations: [{ ...wechat.destinations[0], apiOrigin: 'https://wechat-gateway.example.test/v1/' }] })
  assert.equal(gatewayWechat.destinations[0].apiOrigin, 'https://wechat-gateway.example.test/v1')
  assert.throws(() => normalizePublisherConfig('wechat-draft', { destinations: [{ ...wechat.destinations[0], apiOrigin: 'http://wechat.example.test' }] }), /HTTP requires allowInsecureHttp=1/u)
  const insecureWechat = normalizePublisherConfig('wechat-draft', { destinations: [{ ...wechat.destinations[0], apiOrigin: 'http://h3.justlikemaki.vip:3000/https/api.weixin.qq.com/', allowInsecureHttp: 1 }] })
  assert.equal(insecureWechat.destinations[0].apiOrigin, 'http://h3.justlikemaki.vip:3000/https/api.weixin.qq.com')
  assert.equal(insecureWechat.destinations[0].allowInsecureHttp, 1)
  for (const apiOrigin of ['https://user:pass@wechat.example.test', 'https://wechat.example.test?token=x', 'https://wechat.example.test#fragment']) {
    assert.throws(() => normalizePublisherConfig('wechat-draft', { destinations: [{ ...wechat.destinations[0], apiOrigin }] }), /HTTP\(S\) base URL/u)
  }
  assert.equal(wechat.destinations[0].limits.concurrency, 1)
})

await test('v2 plans tolerate unrelated Profile/document changes but reject stale changed-row revisions and unsafe fields', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const config = { destinations: [{ id: 'daily', name: 'Daily', root: value.home, artifactFileNamePattern: 'draft-{date}.md', overwrite: 'never', maxBytes: 100000 }] }
  const change = { rowId: 'prismflow-publisher-local-markdown', disabled: false, config,
    configRevision: publisherConfigRevision('local-markdown', config) }
  const checked = preflightPublisherChangePlan(plan(document, [change]), document)
  assert.deepEqual({ networkRequests: checked.networkRequests, destinationWrites: checked.destinationWrites }, { networkRequests: 0, destinationWrites: 0 })
  const v2Row = { ...document.rows.find(row => row.rowId === change.rowId), config, configRevision: change.configRevision }
  const unrelatedProfileChange = directPlan(document, v2Row); unrelatedProfileChange.expectedProfileHash = '0'.repeat(64); unrelatedProfileChange.fingerprint = documentFingerprint(unrelatedProfileChange)
  assert.doesNotThrow(() => validatePublisherChangePlan(unrelatedProfileChange, document))
  const unrelatedDocumentChange = directPlan(document, v2Row); unrelatedDocumentChange.expectedDocumentRevision = '0'.repeat(64); unrelatedDocumentChange.fingerprint = documentFingerprint(unrelatedDocumentChange)
  assert.doesNotThrow(() => validatePublisherChangePlan(unrelatedDocumentChange, document))
  const staleRow = directPlan(document, v2Row); staleRow.changes[0].expectedRowRevision = '0'.repeat(64); staleRow.fingerprint = documentFingerprint(staleRow)
  assert.throws(() => validatePublisherChangePlan(staleRow, document), /stale row revision/u)
  const staleLegacy = plan(document, [change]); staleLegacy.expectedProfileHash = '0'.repeat(64); staleLegacy.fingerprint = documentFingerprint(staleLegacy)
  assert.throws(() => validatePublisherChangePlan(staleLegacy, document), /stale Profile hash/u)
  const unsafeConfig = { destinations: [{ ...config.destinations[0], secret: 'do-not-log-this' }] }
  assert.throws(() => publisherConfigRevision('local-markdown', unsafeConfig), /unsupported property: secret/u)
  writeFileSync(join(value.home, 'cordis.patch.yml'), '- insert:\n    - id: prismflow-publisher-local-markdown\n')
  assert.throws(() => exportPublisherProfile('web', { home: value.home }), /higher-precedence overlay/u)
})

await test('managed destination tombstones allow exact restoration and reject retired-id identity reuse', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const local = { id: 'durable-id', name: 'Daily', root: value.home, artifactFileNamePattern: 'draft-{date}.md', overwrite: 'if-changed', maxBytes: 100000 }
  let document = exportPublisherProfile('web', { home: value.home })
  let config = { destinations: [local] }
  importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-local-markdown', disabled: true, config,
    configRevision: publisherConfigRevision('local-markdown', config) }]), { home: value.home })
  document = exportPublisherProfile('web', { home: value.home })
  config = { destinations: [] }
  importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-local-markdown', disabled: true, config,
    configRevision: publisherConfigRevision('local-markdown', config) }]), { home: value.home })

  document = exportPublisherProfile('web', { home: value.home })
  const restored = { destinations: [local] }
  assert.equal(importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-local-markdown', disabled: true, config: restored,
    configRevision: publisherConfigRevision('local-markdown', restored) }]), { home: value.home }).imported, true)

  document = exportPublisherProfile('web', { home: value.home })
  const empty = { destinations: [] }
  importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-local-markdown', disabled: true, config: empty,
    configRevision: publisherConfigRevision('local-markdown', empty) }]), { home: value.home })
  document = exportPublisherProfile('web', { home: value.home })
  const reused = { destinations: [{ ...local, root: tmpdir() }] }
  assert.throws(() => importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-local-markdown', disabled: true, config: reused,
    configRevision: publisherConfigRevision('local-markdown', reused) }]), { home: value.home }), /cannot be reused|previously used/u)
})

await test('existing WeChat destination keeps its id when only API Base URL changes while other identity changes remain blocked', async t => {
  const value = await fixture(); t.after(value.cleanup)
  let document = exportPublisherProfile('web', { home: value.home })
  const original = normalizePublisherConfig('wechat-draft', { destinations: [{ id: 'wechat-main', name: 'WeChat', appId: 'wx123', appSecretCredential: 'WECHAT_SECRET', articleType: 'news', apiOrigin: 'https://api.weixin.qq.com', limits: {} }] })
  importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-wechat-draft', disabled: false, config: original,
    configRevision: publisherConfigRevision('wechat-draft', original) }]), { home: value.home })
  const statePath = join(value.profile, '.prismflow-publisher-profile-state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  const { name: _name, allowInsecureHttp: _allowInsecureHttp, ...legacyIdentity } = original.destinations[0]
  state.destinations['prismflow-publisher-wechat-draft:wechat-main'] = createHash('sha256').update(canonicalJson(legacyIdentity)).digest('hex')
  const { fingerprint: _fingerprint, ...stateBody } = state
  writeFileSync(statePath, `${JSON.stringify({ ...stateBody, fingerprint: documentFingerprint(stateBody) }, null, 2)}\n`)
  document = exportPublisherProfile('web', { home: value.home })
  const gateway = normalizePublisherConfig('wechat-draft', { destinations: [{ ...original.destinations[0], apiOrigin: 'http://h3.justlikemaki.vip:3000/https/api.weixin.qq.com', allowInsecureHttp: 1 }] })
  assert.equal(importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-wechat-draft', disabled: false, config: gateway,
    configRevision: publisherConfigRevision('wechat-draft', gateway) }]), { home: value.home }).imported, true)
  document = exportPublisherProfile('web', { home: value.home })
  const changedIdentity = normalizePublisherConfig('wechat-draft', { destinations: [{ ...gateway.destinations[0], appId: 'wx456' }] })
  assert.throws(() => importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-wechat-draft', disabled: false, config: changedIdentity,
    configRevision: publisherConfigRevision('wechat-draft', changedIdentity) }]), { home: value.home }), /require a new immutable destination id/u)
})

await test('legacy WeChat references export only a migration marker and require replacement before import', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const legacySecret = 'legacy-secret:value-that-must-not-export'
  const source = `${value.source}\n- id: prismflow-publisher-wechat-draft\n  disabled: true\n  config:\n    destinations:\n      - id: old-wechat\n        name: Old WeChat\n        appId: wx123\n        appSecretCredential: ${legacySecret}\n        articleType: news\n        limits: {}\n`
  writeFileSync(join(value.profile, 'cordis.patch.yml'), source)
  const document = exportPublisherProfile('web', { home: value.home })
  const wechat = document.rows.find(row => row.channelKind === 'wechat-draft')
  assert.equal(wechat.migrationRequired, true)
  assert.equal(JSON.stringify(document).includes(legacySecret), false)
  const unchanged = { rowId: wechat.rowId, disabled: true, config: wechat.config, configRevision: wechat.configRevision }
  assert.throws(() => validatePublisherChangePlan(plan(document, [unchanged]), document), /must (?:be )?replace/u)
})

await test('literal GitHub tokens in legacy Profile rows are never exported and require a new destination id', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const literal = 'ghp_literalValueThatMustNeverReachTheBrowser'
  writeFileSync(join(value.profile, 'cordis.patch.yml'), `${value.source}\n- id: prismflow-publisher-github-markdown\n  disabled: false\n  config:\n    destinations:\n      - id: unsafe-github\n        name: Unsafe GitHub\n        repository: owner/repo\n        branch: main\n        pathPrefix: daily\n        artifactFileNamePattern: "{date}.md"\n        overwrite: if-changed\n        artifactCommitMessage: "publish {date}"\n        apiBaseUrl: https://api.github.com\n        tokenCredential: ${literal}\n        maxBytes: 900000\n`)
  const document = exportPublisherProfile('web', { home: value.home })
  const github = document.rows.find(row => row.channelKind === 'github-markdown')
  assert.equal(github.migrationRequired, true); assert.equal(github.config.destinations[0].tokenCredential, 'MIGRATION_REQUIRED')
  assert.equal(JSON.stringify(document).includes(literal), false)
  assert.throws(() => validatePublisherChangePlan(plan(document, [{ rowId: github.rowId, disabled: false, config: github.config,
    configRevision: github.configRevision }]), document), /must (?:be )?replace/u)
})

await test('Profile patch symlinks are rejected and CRLF remains CRLF after managed import', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const patchPath = join(value.profile, 'cordis.patch.yml')
  writeFileSync(patchPath, value.source.replaceAll('\n', '\r\n'))
  let document = exportPublisherProfile('web', { home: value.home })
  const config = { destinations: [] }
  importPublisherChangePlan('web', plan(document, [{ rowId: 'prismflow-publisher-local-markdown', disabled: false, config,
    configRevision: publisherConfigRevision('local-markdown', config) }]), { home: value.home })
  const output = readFileSync(patchPath, 'utf8')
  assert.equal(/(^|[^\r])\n/u.test(output), false)

  const real = join(value.profile, 'real-patch.yml')
  renameSync(patchPath, real)
  try { symlinkSync(real, patchPath, 'file') } catch (error) { return t.skip(`symlinks unavailable: ${error.code}`) }
  assert.throws(() => exportPublisherProfile('web', { home: value.home }), /symlink|reparse/u)
})

await test('inserted, duplicate, remove, and ambiguous publisher operations fail before import edits', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const local = document.rows.find(row => row.channelKind === 'local-markdown')
  const changePlan = plan(document, [{ rowId: local.rowId, disabled: true, config: { destinations: [] },
    configRevision: publisherConfigRevision('local-markdown', { destinations: [] }) }])
  const variants = [
    `${value.source}\n- id: prismflow-publisher-local-markdown\n  disabled: false\n`,
    `${value.source}\n- remove:\n    - prismflow-publisher-local-markdown\n`,
    `${value.source}\n- insert:\n    - id: prismflow-publisher-github-markdown\n      name: '@prismflow/dsh/publisher-github-markdown'\n`,
    `${value.source}\n- before: prismflow-publisher-r2-markdown\n  insert: []\n`,
  ]
  const messages = [/duplicate top-level publisher override/u, /remove or ambiguous\/unsupported publisher operation/u,
    /publisher row inside local insert/u, /remove or ambiguous\/unsupported publisher operation/u]
  for (const [index, source] of variants.entries()) {
    writeFileSync(join(value.profile, 'cordis.patch.yml'), source)
    assert.throws(() => exportPublisherProfile('web', { home: value.home }), messages[index])
  }
  const shadowed = variants[0]
  writeFileSync(join(value.profile, 'cordis.patch.yml'), shadowed)
  assert.throws(() => importPublisherChangePlan('web', changePlan, { home: value.home }), /duplicate top-level publisher override/u)
  assert.equal(readFileSync(join(value.profile, 'cordis.patch.yml'), 'utf8'), shadowed, 'conflicting patch remains byte-for-byte unchanged')
})

await test('all managed publisher module aliases fail closed in rows, inserts, nested inserts, removes, and higher-precedence overlays', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const patchPath = join(value.profile, 'cordis.patch.yml')
  const document = exportPublisherProfile('web', { home: value.home })
  const local = document.rows.find(row => row.channelKind === 'local-markdown')
  const noOpPlan = plan(document, [{ rowId: local.rowId, disabled: local.disabled, config: local.config, configRevision: local.configRevision }])
  for (const channel of managedPublisherChannels) {
    const aliasId = `unmanaged-${channel.kind}`
    const variants = [
      `${value.source}\n- id: ${aliasId}\n  name: '${channel.moduleName}'\n`,
      `${value.source}\n- insert:\n    - id: ${aliasId}\n      name: '${channel.moduleName}'\n`,
      `${value.source}\n- insert:\n    - id: unrelated-container\n      config:\n        nested:\n          - insert:\n              - id: ${aliasId}\n                name: '${channel.moduleName}'\n`,
      `${value.source}\n- remove:\n    - id: ${aliasId}\n      name: '${channel.moduleName}'\n`,
      `${value.source}\n- remove:\n    - '${channel.moduleName}'\n`,
    ]
    for (const source of variants) {
      writeFileSync(patchPath, source)
      assert.throws(() => exportPublisherProfile('web', { home: value.home }), /publisher row inside local insert|publisher operation/u,
        `${channel.moduleName} must not create or address an unmanaged publisher instance`)
    }
    const aliasSource = variants[0]
    writeFileSync(patchPath, aliasSource)
    assert.throws(() => importPublisherChangePlan('web', noOpPlan, { home: value.home }), /publisher operation/u)
    assert.equal(readFileSync(patchPath, 'utf8'), aliasSource, 'import must reject an unmanaged duplicate without editing the patch')
  }

  for (const [index, overlayPath] of [join(value.home, 'cordis.patch.yml'), join(value.home, 'cordis.yml'), join(value.profile, 'cordis.yml')].entries()) {
    for (const channel of managedPublisherChannels) {
      writeFileSync(patchPath, value.source)
      writeFileSync(overlayPath, `root:\n  nested:\n    insert:\n      - id: overlay-alias-${index}\n        name: '${channel.moduleName}'\n`)
      assert.throws(() => exportPublisherProfile('web', { home: value.home }), /higher-precedence overlay/u,
        `${channel.moduleName} must be detected in ${overlayPath}`)
      await rm(overlayPath, { force: true })
    }
  }
})

await test('mixed managed IDs and module names never permit a duplicate publisher instance, while near-match names remain unmanaged', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const patchPath = join(value.profile, 'cordis.patch.yml')
  for (const idChannel of managedPublisherChannels) {
    for (const nameChannel of managedPublisherChannels) {
      const source = `${value.source}\n- insert:\n    - id: ${idChannel.rowId}\n      name: '${nameChannel.moduleName}'\n`
      writeFileSync(patchPath, source)
      assert.throws(() => exportPublisherProfile('web', { home: value.home }), /publisher row inside local insert/u,
        `${idChannel.rowId} with ${nameChannel.moduleName} must be rejected`)
    }
  }
  for (const nameChannel of managedPublisherChannels) {
    const source = `${value.source}\n- id: alias-${nameChannel.kind}\n  name: '${nameChannel.moduleName}'\n- id: second-alias-${nameChannel.kind}\n  name: '${nameChannel.moduleName}'\n`
    writeFileSync(patchPath, source)
    assert.throws(() => exportPublisherProfile('web', { home: value.home }), /publisher operation/u,
      `${nameChannel.moduleName} aliases must not become duplicate unmanaged instances`)
  }

  writeFileSync(patchPath, `${value.source}\n- id: third-party-publisher\n  name: '@prismflow/dsh/publisher-local-markdown-fork'\n`)
  assert.equal(exportPublisherProfile('web', { home: value.home }).rows.length, 4)
  writeFileSync(join(value.home, 'cordis.yml'), "plugin:\n  id: prismflow-publisher-local-markdown-fork\n  name: '@prismflow/dsh/publisher-local-markdown-fork'\n")
  assert.equal(exportPublisherProfile('web', { home: value.home }).rows.length, 4, 'only exact managed IDs and module names are reserved')
})

await test('tombstone state rename is directory-durable before patch rename and interruption remains fail-closed', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const config = { destinations: [{ id: 'power-loss-id', name: 'Durable', root: value.home }] }
  const change = { rowId: 'prismflow-publisher-local-markdown', disabled: true, config,
    configRevision: publisherConfigRevision('local-markdown', config) }
  const changePlan = plan(document, [change])
  assert.throws(() => importPublisherChangePlan('web', changePlan, { home: value.home,
    onPowerLossPoint(point) { assert.equal(point, 'state-rename-directory-fsynced-before-patch-rename'); throw new Error('simulated power loss') },
  }), /simulated power loss/u)
  assert.equal(readFileSync(join(value.profile, 'cordis.patch.yml'), 'utf8'), value.source, 'patch rename must not precede durable state')
  const state = JSON.parse(readFileSync(join(value.profile, '.prismflow-publisher-profile-state.json'), 'utf8'))
  assert.ok(state.destinations['prismflow-publisher-local-markdown:power-loss-id'], 'the interrupted id remains durably reserved')
  assert.equal(importPublisherChangePlan('web', changePlan, { home: value.home }).imported, true, 'exact retry after interruption is safe')
})

await test('publisher state count and byte ceilings fail closed without pruning tombstones', async t => {
  const countFixture = await fixture(); t.after(countFixture.cleanup)
  const countDocument = exportPublisherProfile('web', { home: countFixture.home })
  const row = countDocument.rows[0]
  const noopPlan = plan(countDocument, [{ rowId: row.rowId, disabled: row.disabled, config: row.config, configRevision: row.configRevision }])
  const counted = Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`row:id-${index}`, 'a'.repeat(64)]))
  const countBody = { kind: 'PrismFlowPublisherProfileState/v1', destinations: counted }
  writeFileSync(join(countFixture.profile, '.prismflow-publisher-profile-state.json'), `${JSON.stringify({ ...countBody, fingerprint: documentFingerprint(countBody) })}\n`)
  assert.throws(() => importPublisherChangePlan('web', noopPlan, { home: countFixture.home }), /exceeds 10000 retained destination tombstones/u)
  assert.equal(Object.keys(JSON.parse(readFileSync(join(countFixture.profile, '.prismflow-publisher-profile-state.json'), 'utf8')).destinations).length, 10_001)

  const sizeFixture = await fixture(); t.after(sizeFixture.cleanup)
  const sizeDocument = exportPublisherProfile('web', { home: sizeFixture.home })
  const sizeRow = sizeDocument.rows[0]
  const sizePlan = plan(sizeDocument, [{ rowId: sizeRow.rowId, disabled: sizeRow.disabled, config: sizeRow.config, configRevision: sizeRow.configRevision }])
  const oversized = Object.fromEntries(Array.from({ length: 9_000 }, (_, index) => [`row:${String(index).padStart(5, '0')}:${'x'.repeat(245)}`, 'b'.repeat(64)]))
  const sizeBody = { kind: 'PrismFlowPublisherProfileState/v1', destinations: oversized }
  const sizeSource = `${JSON.stringify({ ...sizeBody, fingerprint: documentFingerprint(sizeBody) }, null, 2)}\n`
  assert.ok(Buffer.byteLength(sizeSource) > 2 * 1024 * 1024)
  writeFileSync(join(sizeFixture.profile, '.prismflow-publisher-profile-state.json'), sizeSource)
  assert.throws(() => importPublisherChangePlan('web', sizePlan, { home: sizeFixture.home }), /exceeds the 2 MiB/u)
})

await test('Profile import retains only five regular recent backups for patch and state', async t => {
  const value = await fixture(); t.after(value.cleanup)
  for (let index = 0; index < 8; index += 1) {
    const document = exportPublisherProfile('web', { home: value.home })
    const row = document.rows[0]
    importPublisherChangePlan('web', plan(document, [{ rowId: row.rowId, disabled: index % 2 === 0, config: row.config, configRevision: row.configRevision }]), { home: value.home })
  }
  const names = readdirSync(value.profile)
  assert.equal(names.filter(name => name.startsWith('cordis.patch.yml.backup-')).length, 5)
  assert.equal(names.filter(name => name.startsWith('.prismflow-publisher-profile-state.json.backup-')).length, 5)
})

function processStartIdentity(pid) {
  if (process.platform !== 'linux') return 'unverifiable-active-child'
  const source = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const fields = source.slice(source.lastIndexOf(') ') + 2).trim().split(/\s+/u)
  return `linux-proc-start-ticks:${fields[19]}`
}
function lockOwner(pid, identity) {
  return { hostname: hostname(), pid, processStartIdentity: identity, nonce: '11111111-1111-4111-8111-111111111111', createdAt: '2026-08-24T00:00:00.000Z' }
}

await test('operation ledger prunes the oldest completed record at the 512 boundary while preserving pending recovery', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const operations = Object.fromEntries(Array.from({ length: 512 }, (_, index) => {
    const id = ledgerId(index + 1)
    return [id, ledgerRecord(id)]
  }))
  writeLedger(value.profile, operations)
  const document = exportPublisherProfile('web', { home: value.home })
  const changePlan = directPlan(document)
  const operationId = ledgerId(900)
  preparePublisherProfileOperation('web', operationId, changePlan, { home: value.home })
  let ledger = JSON.parse(readFileSync(join(value.profile, '.prismflow-publisher-profile-operations.json'), 'utf8'))
  assert.equal(Object.keys(ledger.operations).length, 512); assert.equal(ledger.operations[operationId].status, 'pending')
  beginPublisherProfileOperationDrain('web', operationId, { home: value.home })
  commitPublisherProfileOperation('web', operationId, changePlan, { home: value.home })
  ledger = JSON.parse(readFileSync(join(value.profile, '.prismflow-publisher-profile-operations.json'), 'utf8'))
  assert.equal(Object.keys(ledger.operations).length, 512); assert.equal(ledger.operations[operationId].status, 'completed')
})

await test('operation ledger iteratively prunes completed byte headroom before pending publication and recovery completion', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const local = document.rows[0]
  const root = join(value.home, 'x'.repeat(Math.max(1, 3900 - value.home.length)))
  const config = normalizePublisherConfig('local-markdown', { destinations: [{ id: 'large', name: 'Large', root }] })
  const planBody = { kind: 'PrismFlowPublisherChangePlan/v2', profile: 'web', expectedProfileHash: document.profileHash,
    expectedDocumentRevision: document.documentRevision, createdAt: '2026-08-24T00:00:00.000Z', changes: [{ rowId: local.rowId,
      expectedRowRevision: local.rowRevision, disabled: true, config, configRevision: publisherConfigRevision('local-markdown', config) }] }
  const largePlan = { ...planBody, fingerprint: documentFingerprint(planBody) }
  const request = { confirmPauseUntilRestart: true, plan: largePlan }
  const digest = createHash('sha256').update(canonicalJson(request)).digest('hex')
  const operations = {}
  for (let index = 1; index <= 512; index += 1) {
    const id = ledgerId(1000 + index)
    const candidate = { ...operations, [id]: ledgerRecord(id, { digest, phase: 'draining', request }) }
    const body = { kind: 'PrismFlowPublisherProfileOperations/v1', operations: candidate }
    const bytes = Buffer.byteLength(`${JSON.stringify({ ...body, fingerprint: documentFingerprint(body) })}\n`)
    if (bytes >= 1024 * 1024) break
    operations[id] = candidate[id]
  }
  writeLedger(value.profile, operations)
  const before = readFileSync(join(value.profile, '.prismflow-publisher-profile-operations.json'))
  assert.ok(before.length > 900_000 && before.length < 1024 * 1024)
  const operationId = ledgerId(2000)
  const nextConfig = normalizePublisherConfig('local-markdown', { destinations: Array.from({ length: 30 }, (_, index) => ({
    id: `headroom-${index}`, name: `Headroom ${index} ${'n'.repeat(480)}`, root: value.home,
  })) })
  const changeBody = { kind: 'PrismFlowPublisherChangePlan/v2', profile: 'web', expectedProfileHash: document.profileHash,
    expectedDocumentRevision: document.documentRevision, createdAt: '2026-08-24T00:00:00.000Z', changes: [{ rowId: local.rowId,
      expectedRowRevision: local.rowRevision, disabled: local.disabled, config: nextConfig,
      configRevision: publisherConfigRevision('local-markdown', nextConfig) }] }
  const changePlan = { ...changeBody, fingerprint: documentFingerprint(changeBody) }
  preparePublisherProfileOperation('web', operationId, changePlan, { home: value.home })
  let ledger = JSON.parse(readFileSync(join(value.profile, '.prismflow-publisher-profile-operations.json'), 'utf8'))
  assert.ok(Buffer.byteLength(JSON.stringify(ledger)) < 1024 * 1024)
  assert.equal(ledger.operations[operationId].status, 'pending')
  assert.ok(Object.keys(ledger.operations).length < Object.keys(operations).length + 1, 'completed rows were iteratively pruned for headroom')
  beginPublisherProfileOperationDrain('web', operationId, { home: value.home })
  commitPublisherProfileOperation('web', operationId, changePlan, { home: value.home })
  ledger = JSON.parse(readFileSync(join(value.profile, '.prismflow-publisher-profile-operations.json'), 'utf8'))
  assert.equal(ledger.operations[operationId].status, 'completed')
})

await test('Profile directory replacement fails closed and the parent coordination lock excludes a second manager', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const row = document.rows[0]
  const changePlan = plan(document, [{ rowId: row.rowId, disabled: !row.disabled, config: row.config, configRevision: row.configRevision }])
  const moved = `${value.profile}-moved`
  let concurrentError
  assert.throws(() => importPublisherChangePlan('web', changePlan, { home: value.home,
    onPowerLossPoint(point) {
      if (point !== 'state-rename-directory-fsynced-before-patch-rename') return
      renameSync(value.profile, moved)
      mkdirSync(value.profile)
      writeFileSync(join(value.profile, 'package.json'), '{}\n')
      writeFileSync(join(value.profile, 'cordis.patch.yml'), '[]\n')
      const replacement = exportPublisherProfile('web', { home: value.home })
      const replacementRow = replacement.rows[0]
      try {
        importPublisherChangePlan('web', plan(replacement, [{ rowId: replacementRow.rowId, disabled: replacementRow.disabled,
          config: replacementRow.config, configRevision: replacementRow.configRevision }]), { home: value.home })
      } catch (error) { concurrentError = error }
    },
  }), /identity changed|lock ownership changed/u)
  assert.match(concurrentError?.message ?? '', /coordination is locked by active or unverifiable PID/u)
  assert.equal(readFileSync(join(value.profile, 'cordis.patch.yml'), 'utf8'), '[]\n', 'replacement Profile is never written by the first manager')
  assert.equal(readFileSync(join(moved, 'cordis.patch.yml'), 'utf8'), value.source, 'old directory patch is not replaced after the swap')
})

await test('Profile lock never steals an active owner, recovers its crash, and detects Linux PID reuse identity', async t => {
  const value = await fixture(); t.after(value.cleanup)
  const document = exportPublisherProfile('web', { home: value.home })
  const row = document.rows[0]
  const changePlan = plan(document, [{ rowId: row.rowId, disabled: false, config: row.config, configRevision: row.configRevision }])
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  t.after(() => { if (child.exitCode === null) child.kill() })
  await once(child, 'spawn')
  const lockPath = join(value.profile, '.prismflow-publisher-profile.lock')
  const owner = lockOwner(child.pid, processStartIdentity(child.pid))
  writeFileSync(lockPath, `${JSON.stringify(owner)}\n`)
  assert.throws(() => importPublisherChangePlan('web', changePlan, { home: value.home }), /locked by active or unverifiable PID/u)
  process.kill(child.pid, 0)
  child.kill(); await once(child, 'exit')
  assert.equal(importPublisherChangePlan('web', changePlan, { home: value.home }).imported, true, 'abandoned lock is recovered only after process absence')
  assert.equal(existsSync(lockPath), false)

  if (process.platform === 'linux') {
    const current = exportPublisherProfile('web', { home: value.home })
    const currentRow = current.rows[0]
    writeFileSync(lockPath, `${JSON.stringify(lockOwner(process.pid, 'linux-proc-start-ticks:0'))}\n`)
    assert.equal(importPublisherChangePlan('web', plan(current, [{ rowId: currentRow.rowId, disabled: true, config: currentRow.config,
      configRevision: currentRow.configRevision }]), { home: value.home }).imported, true, 'live reused PID with mismatched start identity is not treated as the old owner')
  }
})

test('native publisher Profile CLI retains its 2 MiB typed-input ceiling', () => {
  const script = join(import.meta.dirname, '..', 'scripts', 'publisher-profile.mjs')
  const result = spawnSync(process.execPath, [script, 'validate', '--profile', 'web'], {
    encoding: 'utf8', input: JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }),
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Typed input exceeds 2 MiB/u)
})

test('publisher documents reject non-canonical or unbounded timestamps', async () => {
  const value = await fixture()
  try {
    const document = exportPublisherProfile('web', { home: value.home })
    for (const exportedAt of ['2026-08-24T00:00:00Z', '2026-8-24T00:00:00.000Z', '2026-08-24T00:00:00.000+00:00']) {
      const body = { ...document, exportedAt }; body.fingerprint = documentFingerprint(body)
      assert.throws(() => validatePublisherDocument(body), /canonical ISO/u)
    }
  } finally { await value.cleanup() }
})
