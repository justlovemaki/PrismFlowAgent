import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import AdmZip from 'adm-zip'
import YAML from 'yaml'
import { decryptPrismFlowDataBackup, parsePrismFlowDataBackup, PRISMFLOW_DATA_UNITS } from '../lib/data-backup.js'
import { apply } from '../lib/ui.js'
import { PublicationReconciliationError } from '../lib/store-production.js'
import { PublisherOutcomeError } from '../lib/shared/publisher-outcome.js'

const PACKAGE_VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version

async function dashboard(services = {}, listenHost = '127.0.0.1', requestHost = listenHost, config) {
  let route
  const warnings = []
  const ctx = {
    get: key => services[key],
    webServer: { register(value) { route = value; return () => {} } },
    effect(factory) { factory() },
    logger: { warn(message) { warnings.push(message) } },
  }
  apply(ctx, config)
  assert.equal(route.path, '/api/prismflow')
  assert.equal(route.kind, 'prefix')
  const server = createServer((req, res) => void route.handler(req, res))
  await new Promise(resolve => server.listen(0, listenHost, resolve))
  const origin = `http://${requestHost}:${server.address().port}`
  return { origin, warnings, async close() { await new Promise(resolve => server.close(resolve)) } }
}

async function request(origin, path, body, headers = {}, method) {
  const response = await fetch(`${origin}/api/prismflow${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? headers : { 'content-type': 'application/json', origin, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, value: await response.json() }
}

async function requestZip(origin, path, buffer) {
  const response = await fetch(`${origin}/api/prismflow${path}`, { method: 'POST', headers: { 'content-type': 'application/zip', origin }, body: buffer })
  return { status: response.status, value: await response.json() }
}

async function requestBackupExport(origin, password) {
  const response = await fetch(`${origin}/api/prismflow/configuration-backup/export`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ password }) })
  return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) }
}

async function requestBytes(origin, path, headers = {}) {
  const response = await fetch(`${origin}/api/prismflow${path}`, { headers })
  return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) }
}

async function requestWithHost(origin, path, host) {
  const target = new URL(`/api/prismflow${path}`, origin)
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(target, { method: 'GET', headers: { host } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}

function createBackupDatabase(path, marker) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA user_version = 1; CREATE TABLE units (name TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT; CREATE TABLE unit_globals (unit TEXT PRIMARY KEY REFERENCES units(name), value TEXT NOT NULL) STRICT')
  for (const unit of PRISMFLOW_DATA_UNITS) {
    db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run(unit.name, unit.version)
    for (const table of unit.tables) {
      const physical = `u_${unit.name}_${table}`
      db.exec(`CREATE TABLE "${physical}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
      db.prepare(`INSERT INTO "${physical}" (key, value) VALUES (?, ?)`).run(`${unit.name}:${table}`, JSON.stringify({ marker }))
    }
  }
  db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run('prismflow_content', 1)
  db.exec('CREATE TABLE u_prismflow_content_items (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
  db.prepare('INSERT INTO u_prismflow_content_items (key, value) VALUES (?, ?)').run('fetched-content', JSON.stringify({ marker: 'fetched' }))
  db.close()
}

function services() {
  const markdown = `# Brief\n${'x'.repeat(210_000)}`
  let deletedDraft = false
  let draft = {
    draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', generatorPromptVersion: 1, generatorPromptSha256: 'd'.repeat(64), title: 'Brief', markdown,
    sha256: 'c'.repeat(64), version: 1, status: 'draft', sourceContentStoreIds: ['a'.repeat(64)],
    publishedPublisherIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const rssOutput = { outputId: '9'.repeat(64), draftId: 'draft-1', draftVersion: 1, artifactSha256: 'c'.repeat(64), title: 'Brief',
    markdown: '# Brief', htmlContent: '<h1>Brief</h1>', xml: '<?xml version="1.0"?><rss><channel/></rss>', xmlSha256: '8'.repeat(64),
    itemUrl: 'https://example.com/docs/draft-1/', generatedAt: '2026-01-01T00:00:02.000Z' }
  let prompt = { generatorId: 'brief', generatorName: 'Brief', persona: 'Writer', instruction: 'Write.', reviewPersona: 'Reviewer', reviewInstruction: 'Review.', version: 1, sha256: 'd'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z', actor: 'deployment', action: 'bootstrap', sourceVersion: 0 }
  const promptHistory = [structuredClone(prompt)]
  let imageSettings = { id: 'current', version: 1, sha256: '7'.repeat(64), imageApiUrl: 'https://images.example/v1/images/generations', imageApiProtocol: 'auto', imageModel: 'image-model', imageSize: '1024x1024', avifQuality: 70, avifEffort: 5, ffmpegPath: '', updatedAt: '2026-01-01T00:00:00.000Z' }
  let imageCredentialConfigured = false
  return {
    markdown,
    prismSources: { list: () => [{ id: 'rss:news' }] },
    prismSourceSettings: {
      list: () => [{ settingsId: 'rss:news', type: 'rss', id: 'news', name: 'News', category: 'news', enabled: true, limit: 20, url: 'https://example.com/feed.xml', updatedAt: '2026-01-01T00:00:00.000Z' }],
      adapterStates: () => ['github-trending', 'rss', 'ai-search', 'follow'].map(type => ({ type, enabled: true })),
      describeCredentialSlots: async () => [{ id: 'follow', name: 'Follow Login', usage: 'follow-cookie', configured: false, writable: true, allowDashboardWrite: true }],
      setAdapterEnabled: async (type, enabled) => ({ type, enabled }),
      save: async (value, options) => {
        const settingsId = `${value.type}:${value.id}`
        if (options.mode === 'update' && options.expectedSettingsId !== settingsId) {
          const error = new Error('Source identity cannot change while editing')
          error.name = 'ManagedSourceValidationError'
          throw error
        }
        return { settingsId, ...value, updatedAt: '2026-01-01T00:00:01.000Z' }
      },
      delete: async () => ({}),
      setCredential: async () => ({}),
      unsetCredential: async () => ({}),
    },
    prismContentStore: {
      count: () => 1,
      categoryCounts: () => [{ category: 'news', count: 1 }],
      list: () => [{ storeId: 'a'.repeat(64), sourceId: 'rss:news', externalId: 'entry-1', firstSeenAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:02.000Z', fetchedAt: '2026-01-01T00:00:02.000Z', status: 'unread', item: { title: 'AI News', description: 'Summary', url: 'https://example.com/entry-1', published_date: '2026-01-01T00:00:00.000Z', source: 'News', category: 'news', author: 'Author', metadata: { ai_summary: 'Source AI summary', secret: 'must-not-project' } } }],
    },
    prismContentSelections: {
      getReview: storeId => storeId === 'a'.repeat(64) ? { aiSummary: 'Reviewer AI summary', aiScore: 85, reason: 'Weighted review reason', reviewedAt: '2026-01-01T00:00:03.000Z', hidden: 'must-not-project-review' } : undefined,
    },
    prismImageGenerationSettings: {
      get: () => structuredClone(imageSettings),
      async update(settings, expected) { if (expected.version !== imageSettings.version || expected.sha256 !== imageSettings.sha256) { const error = new Error('Image generation settings changed; reload before saving'); error.name = 'ImageGenerationSettingsError'; error.code = 'conflict'; throw error } imageSettings = { id: 'current', ...settings, version: imageSettings.version + 1, sha256: '6'.repeat(64), updatedAt: '2026-01-01T00:00:01.000Z' }; return structuredClone(imageSettings) },
      async describeCredential() { return { configured: imageCredentialConfigured, writable: true, allowDashboardWrite: true, ...(imageCredentialConfigured ? { source: 'file' } : {}) } },
      async describeFfmpeg() { return { available: true, mode: imageSettings.ffmpegPath ? 'configured' : 'auto', platform: 'win32', resolvedPath: imageSettings.ffmpegPath || 'C:\\ffmpeg\\bin\\ffmpeg.exe' } },
      async setCredential() { imageCredentialConfigured = true; return this.describeCredential() }, async unsetCredential() { imageCredentialConfigured = false; return this.describeCredential() },
    },
    prismRssOutputs: { list: ({ draftId } = {}) => !draftId || draftId === rssOutput.draftId ? [structuredClone(rssOutput)] : [], get: outputId => outputId === rssOutput.outputId ? structuredClone(rssOutput) : undefined },
    prismPublishers: {
      list: () => [{ id: 'local-markdown:daily', name: 'Daily', description: '' }],
      inventory: () => [
        { kind: 'local-markdown', name: 'Local Markdown', configured: true, destinations: [{ id: 'local-markdown:daily', name: 'Daily' }], configRevision: 'a'.repeat(64) },
        { kind: 'github-markdown', name: 'GitHub Markdown', configured: false, destinations: [] },
        { kind: 'r2-markdown', name: 'Cloudflare R2 Markdown', configured: false, destinations: [] },
        { kind: 'wechat-draft', name: 'WeChat Draft', configured: false, destinations: [] },
      ],
    },
    prismPublicationReceipts: { list: () => [{ receiptId: 'receipt', publisherId: 'local-markdown:daily', status: 'created', itemCount: 1, trigger: 'manual', draftId: 'draft-1', draftVersion: 1, artifactSha256: 'c'.repeat(64) }] },
    prismGeneratorPrompts: {
      list: async () => [structuredClone(prompt)], snapshot: async () => structuredClone(prompt),
      history: async (_id, limit, beforeVersion) => promptHistory.toReversed().filter(item => beforeVersion === undefined || item.version < beforeVersion).slice(0, limit).map(item => structuredClone(item)),
    },
    prismGeneratorWorkflows: (() => {
      let workflow = { format: 'workflow-v1', generatorId: 'builder', generatorName: 'Builder', description: 'Workflow', enabled: true,
        steps: [{ id: 'step-1', name: 'Draft', persona: 'Writer', processPrompt: 'Write.' }], executionProfile: { id: 'builder-profile', version: 1, sha256: 'a'.repeat(64), runnerPolicyVersion: 'serial-workflow-v1', toolPolicy: { allow: [] }, ceilings: { maxSteps: 8 } },
        version: 1, sha256: 'b'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z', actor: 'dashboard-admin', action: 'create', sourceVersion: 0 }
      return { list: async () => [{ kind: 'workflow-v1', ...workflow }], snapshot: async () => workflow, history: async () => [workflow],
        create: async value => ({ ...workflow, ...value }), save: async value => { workflow = { ...workflow, ...value, version: workflow.version + 1, sha256: 'c'.repeat(64), action: 'update', sourceVersion: workflow.version }; return workflow },
        rollback: async () => workflow, disable: async () => (workflow = { ...workflow, enabled: false, version: workflow.version + 1, sha256: 'd'.repeat(64), action: 'disable' }),
        enable: async () => (workflow = { ...workflow, enabled: true, version: workflow.version + 1, sha256: 'e'.repeat(64), action: 'enable' }) }
    })(),
    prismMediaFetch: async (url, options) => ({
      ok: true, status: 200,
      headers: { get(name) { return String(name).toLowerCase() === 'content-type' ? (options.kind === 'image' ? 'image/png' : 'video/mp4') : null } },
      async arrayBuffer() { return Buffer.from(url) },
    }),
    prismProduction: {
      listGenerators: () => [{ id: 'brief' }],
      listRequests: () => [{ requestId: 'request-1', generatorId: 'brief', contentStoreIds: ['a'], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      getRequest: requestId => requestId === 'request-1' ? { requestId, generatorId: 'brief', contentStoreIds: ['a'], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } : undefined,
      cancel: async requestId => ({ requestId, generatorId: 'brief', contentStoreIds: ['a'], status: 'cancelled', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' }),
      retry: async requestId => ({ requestId, generatorId: 'brief', contentStoreIds: ['a'], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:02.000Z' }),
      listDrafts: () => deletedDraft ? [] : [draft],
      getDraft: draftId => !deletedDraft && draftId === draft.draftId ? draft : undefined,
      resolveDraftMedia(draftId, kind, url) {
        if (draftId !== draft.draftId || kind !== 'image' || url !== 'https://media.example/admitted.png') {
          const error = new Error('Draft media is not available'); error.name = 'DraftMediaAdmissionError'; throw error
        }
        return { kind, url }
      },
      reviseDraft: async (draftId, expectedVersion, expectedSha256, title, revisedMarkdown) => {
        if (draftId !== draft.draftId) { const error = new Error('Unknown draft'); error.name = 'DraftRevisionValidationError'; throw error }
        if (expectedVersion !== draft.version || expectedSha256 !== draft.sha256) { const error = new Error('Draft version or hash changed before revision'); error.name = 'DraftRevisionConflictError'; throw error }
        draft = { ...draft, title, markdown: revisedMarkdown, version: draft.version + 1, sha256: 'e'.repeat(64), status: 'draft', updatedAt: '2026-01-01T00:00:01.000Z' }
        return draft
      },
      deleteDraft: async (draftId, expectedVersion, expectedSha256) => {
        if (deletedDraft && draftId === draft.draftId && expectedVersion === draft.version && expectedSha256 === draft.sha256) {
          return { draftId, requestId: draft.requestId, version: draft.version, sha256: draft.sha256, deletedAt: '2026-01-01T00:00:03.000Z', replay: true }
        }
        if (draftId !== draft.draftId || expectedVersion !== draft.version || expectedSha256 !== draft.sha256) {
          const error = new Error('Draft version or hash changed before deletion'); error.name = 'DraftRevisionConflictError'; throw error
        }
        deletedDraft = true
        return { draftId, requestId: draft.requestId, version: draft.version, sha256: draft.sha256, deletedAt: '2026-01-01T00:00:03.000Z', replay: false }
      },
      review: async (draftId, decision, version, sha256) => {
        if (draftId !== draft.draftId || version !== draft.version || sha256 !== draft.sha256 || draft.status !== 'draft') {
          const error = new Error('Draft version, hash, or status changed before review'); error.name = 'DraftReviewConflictError'; throw error
        }
        draft = { ...draft, status: decision === 'approve' ? 'approved' : 'rejected' }
        return draft
      },
      publish: async (draftId, publisherId) => ({ publisherId, status: 'created', draftId, draftVersion: 1, artifactSha256: 'c'.repeat(64) }),
    },
  }
}

const REMOVED_ROUTES = [
  ['GET', '/sources'],
  ['POST', '/fetch'],
  ['POST', '/sync'],
  ['POST', '/content/query'],
  ['POST', '/content/status'],
  ['POST', '/publish'],
  ['GET', '/production/generators'],
  ['POST', '/production/request'],
]

test('dashboard exports Follow and other operator configuration while preserving fetched content on restore', async () => {
  const home = await mkdtemp(join(tmpdir(), 'prismflow-ui-backup-'))
  let app
  try {
    const profile = join(home, 'profiles', 'web'); const storage = join(home, 'storages')
    await mkdir(profile, { recursive: true }); await mkdir(storage, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{}\n'); await writeFile(join(profile, 'cordis.patch.yml'), '- id: prismflow-store-source-settings\n  disabled: false\n  config:\n    credentialSlots:\n      - id: follow-cookie\n        name: Follow Cookie\n        usage: follow-cookie\n        credentialRef: PRISMFLOW_FOLLOW_COOKIE\n        allowDashboardWrite: true\n- id: prismflow-publisher-github-markdown\n  disabled: false\n  config:\n    destinations:\n      - id: archive\n        name: GitHub Archive\n        repository: owner/repository\n        tokenCredential: GITHUB_TOKEN\n')
    const databasePath = join(storage, 'domain.sqlite'); createBackupDatabase(databasePath, 'exported')
    const maintenanceService = { async beginMaintenanceDrain() {}, maintenanceStatus() { return { active: 0, restartAllowed: true } } }
    const credentialValues = new Map([['GITHUB_TOKEN', 'github-token-secret'], ['PRISMFLOW_FOLLOW_COOKIE', 'follow-cookie-secret'], ['OPENAI_IMAGE_API_KEY', 'image-api-secret']])
    const credentials = { async resolve(ref) { const value = credentialValues.get(ref); return value === undefined ? undefined : { value, source: 'file' } }, async describe() { return { configured: true, writable: true, source: 'file' } }, async set(ref, value) { credentialValues.set(ref, value) }, async unset(ref) { credentialValues.delete(ref) } }
    app = await dashboard({ prismPublishers: maintenanceService, prismProduction: maintenanceService, credentials }, '127.0.0.1', '127.0.0.1', { dshHome: home, profileName: 'web' })

    const password = 'correct horse battery staple'
    const exported = await requestBackupExport(app.origin, password)
    assert.equal(exported.status, 200); assert.equal(exported.headers.get('content-type'), 'application/vnd.prismflow.configuration-backup+json')
    assert.match(exported.headers.get('content-disposition'), /^attachment; filename="prismflow-configuration-backup-\d{4}-\d{2}-\d{2}\.pfbackup"$/u)
    assert.equal(exported.body.includes('follow-cookie-secret'), false); assert.equal(exported.body.includes('image-api-secret'), false); assert.equal(exported.body.includes('github-token-secret'), false)
    const parsed = parsePrismFlowDataBackup(decryptPrismFlowDataBackup(exported.body, password))
    assert.equal(parsed.payload.kind, 'PrismFlowConfigurationBackup/v4'); assert.equal(parsed.payload.sourceCredentialSlots[0].id, 'follow-cookie')
    assert.equal(parsed.payload.publisherRows[1].disabled, false); assert.equal(parsed.payload.publisherRows[1].config.destinations[0].repository, 'owner/repository')
    assert.equal(parsed.payload.units.some(unit => unit.name === 'prismflow_content'), false)
    assert.equal(Number(exported.headers.get('x-prismflow-record-count')), parsed.recordCount)
    assert.equal(Number(exported.headers.get('x-prismflow-workflow-history-count')), 1); assert.equal(Number(exported.headers.get('x-prismflow-workflow-id-count')), 0)
    assert.equal(Number(exported.headers.get('x-prismflow-workflow-historical-id-count')), 0); assert.equal(Number(exported.headers.get('x-prismflow-deleted-workflow-id-count')), 0)
    assert.equal(exported.headers.get('x-prismflow-fingerprint'), parsed.fingerprint)
    assert.deepEqual(parsed.payload.credentials, [{ ref: 'GITHUB_TOKEN', value: 'github-token-secret' }, { ref: 'OPENAI_IMAGE_API_KEY', value: 'image-api-secret' }, { ref: 'PRISMFLOW_FOLLOW_COOKIE', value: 'follow-cookie-secret' }])
    assert.equal((await request(app.origin, '/configuration-backup/import', { password: 'wrong password value', document: JSON.parse(exported.body) })).status, 400)

    credentialValues.set('PRISMFLOW_FOLLOW_COOKIE', 'changed-cookie'); credentialValues.delete('OPENAI_IMAGE_API_KEY'); credentialValues.set('GITHUB_TOKEN', 'changed-github-token')
    const db = new DatabaseSync(databasePath)
    db.prepare('UPDATE u_prismflow_source_settings_sources SET value = ?').run(JSON.stringify({ marker: 'changed-config' }))
    db.prepare('UPDATE u_prismflow_content_items SET value = ?').run(JSON.stringify({ marker: 'changed-fetched-content' }))
    db.close()
    const restored = await request(app.origin, '/configuration-backup/import', { password, document: JSON.parse(exported.body) })
    assert.equal(restored.status, 200); assert.equal(restored.value.restored, true); assert.equal(restored.value.restartRequired, true)
    assert.equal(restored.value.recordCount, parsed.recordCount); assert.equal(restored.value.credentialCount, 3); assert.equal(restored.value.publisherDestinationCount, 1); assert.equal(restored.value.maintenance, true)
    assert.equal(restored.value.workflowHistoryCount, 1); assert.equal(restored.value.workflowIdCount, 0)
    assert.equal(restored.value.workflowHistoricalIdCount, 0); assert.equal(restored.value.deletedWorkflowIdCount, 0)
    assert.equal(credentialValues.get('PRISMFLOW_FOLLOW_COOKIE'), 'follow-cookie-secret'); assert.equal(credentialValues.get('OPENAI_IMAGE_API_KEY'), 'image-api-secret'); assert.equal(credentialValues.get('GITHUB_TOKEN'), 'github-token-secret')
    assert.equal(YAML.parse(await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).find(row => row.id === 'prismflow-publisher-github-markdown').config.destinations[0].repository, 'owner/repository')
    const verified = new DatabaseSync(databasePath, { readOnly: true })
    assert.deepEqual(JSON.parse(verified.prepare('SELECT value FROM u_prismflow_source_settings_sources').get().value), { marker: 'exported' })
    assert.deepEqual(JSON.parse(verified.prepare('SELECT value FROM u_prismflow_content_items').get().value), { marker: 'changed-fetched-content' })
    verified.close()
  } finally { if (app) await app.close(); await rm(home, { recursive: true, force: true }) }
})

test('dashboard toolset API projects trusted plugin Manifests and accepts plugin-bound CAS selections', async () => {
  const configured = services(); let savedInput; let savedPrompts
  const promptRow = { items: [{ id: 'one', text: '候选文案', enabled: true }], version: 2, sha256: 'd'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' }
  const row = { mode: 'custom', enabledPlugins: ['prismflow-system-sources'], enabledTools: ['prismflow_sources'], enabledSkills: [], version: 4, sha256: 'a'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' }
  configured.prismToolsets = {
    getToolset: () => structuredClone(row),
    getPromptSuggestions: () => structuredClone(promptRow),
    async savePromptSuggestions(input) { savedPrompts = structuredClone(input); return { ...promptRow, items: input.items, version: 3, sha256: 'e'.repeat(64) } },
    listPlugins: () => [{ pluginId: 'prismflow-system-sources', name: '数据源同步', description: 'Sources', origin: 'system', version: 1, configurable: false, tools: ['prismflow_sources'], skills: ['prismflow-source-ingestion'] }],
    listSkills: () => [{ skillId: 'prismflow-personal', name: 'Personal', description: 'Personal', whenToUse: '', enabled: false, lifecycle: 'disabled', origin: 'personal-custom', removable: true, version: 2, sha256: 'b'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z', action: 'update', sourceVersion: 1 }],
    async saveToolset(input) { savedInput = structuredClone(input); return { ...row, enabledPlugins: input.enabledPlugins, enabledTools: input.enabledTools, version: 5, sha256: 'c'.repeat(64) } },
    async installPersonalPlugin(files) { assert.equal(files.some(file => file.path === 'index.mjs'), true); return { pluginId: 'prismflow-personal-upload', name: 'Upload', description: 'Uploaded', origin: 'personal', version: '1.0.0', configurable: false, uploaded: true, removable: true, tools: ['prismflow_upload'], skills: [], directory: 'SECRET' } },
    async deletePersonalPlugin(input) { return { pluginId: input.pluginId, version: '1.0.0', tools: ['prismflow_upload'], deletedAt: '2026-01-01T00:00:00.000Z', manifestSha256: 'd'.repeat(64) } },
  }
  const app = await dashboard(configured)
  try {
    const catalog = await request(app.origin, '/toolsets')
    assert.equal(catalog.status, 200); assert.equal(catalog.value.plugins[0].origin, 'system')
    assert.deepEqual(catalog.value.toolset.enabledPlugins, ['prismflow-system-sources'])
    assert.equal(catalog.value.skills[0].removable, true)
    const prompts = await request(app.origin, '/prompt-suggestions')
    assert.equal(prompts.status, 200); assert.equal(prompts.value.suggestions.items[0].text, '候选文案')
    const promptBody = { items: [{ id: 'one', text: '已修改', enabled: false }], expected: { version: 2, sha256: 'd'.repeat(64) } }
    const promptsSaved = await request(app.origin, '/prompt-suggestions', promptBody)
    assert.equal(promptsSaved.status, 200); assert.deepEqual(savedPrompts, promptBody); assert.equal(promptsSaved.value.suggestions.version, 3)
    assert.equal((await request(app.origin, '/toolsets/configuration/export')).status, 404)
    assert.equal((await request(app.origin, '/toolsets/configuration/import', { document: {}, expected: {} })).status, 404)
    const body = { mode: 'custom', enabledPlugins: ['prismflow-system-sources'], enabledTools: ['prismflow_sources'], enabledSkills: [], expected: { version: 4, sha256: 'a'.repeat(64) } }
    const saved = await request(app.origin, '/toolsets', body)
    assert.equal(saved.status, 200); assert.deepEqual(savedInput, body); assert.equal(saved.value.toolset.version, 5)
    const zip = new AdmZip(); zip.addFile('prismflow-plugin.json', Buffer.from(JSON.stringify({ format: 'prismflow-personal-plugin/v1', pluginId: 'prismflow-personal-upload', name: 'Upload', description: 'Uploaded', version: '1.0.0', entry: 'index.mjs', tools: ['prismflow_upload'] }))); zip.addFile('index.mjs', Buffer.from('export default () => {}'))
    const uploaded = await requestZip(app.origin, '/toolsets/plugin/import-zip', zip.toBuffer())
    assert.equal(uploaded.status, 201); assert.equal(uploaded.value.plugin.uploaded, true); assert.equal(JSON.stringify(uploaded.value).includes('SECRET'), false)
    const removed = await request(app.origin, '/toolsets/plugin/delete', { pluginId: 'prismflow-personal-upload', expected: { version: 4, sha256: 'a'.repeat(64) } })
    assert.equal(removed.status, 200); assert.equal(removed.value.deleted.pluginId, 'prismflow-personal-upload'); assert.equal(removed.value.restartRequired, false)
  } finally { await app.close() }
})

test('dashboard API exposes only configuration, immutable draft review/publication, and receipts', async () => {
  const configured = services()
  const app = await dashboard(configured)
  try {
    const status = await request(app.origin, '/status')
    assert.equal(status.status, 200)
    assert.equal(status.value.pluginVersion, PACKAGE_VERSION)
    assert.deepEqual(status.value.services, { sources: true, sourceSettings: true, contentStore: true, publishers: true, receipts: true, production: true, generatorWorkflows: true, toolsets: false, imageGenerationSettings: true, rssOutputs: true })
    assert.deepEqual(status.value.counts, { sources: 1, sourceSettings: 1, contents: 1, publishers: 1, generators: 1, generatorWorkflows: 1, rssOutputs: 1 })

    const image = await request(app.origin, '/image-generation/settings')
    assert.equal(image.value.settings.imageModel, 'image-model'); assert.equal(image.value.settings.ffmpegPath, ''); assert.equal(image.value.credential.configured, false)
    assert.deepEqual(image.value.ffmpeg, { available: true, mode: 'auto', platform: 'win32', resolvedPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe' })
    const imageSaved = await request(app.origin, '/image-generation/settings', { settings: { imageApiUrl: 'https://new.example/v1/chat/completions', imageApiProtocol: 'chat-completions', imageModel: 'new-image', imageSize: '1536x1024', avifQuality: 75, avifEffort: 6, ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe' }, expected: { version: 1, sha256: '7'.repeat(64) } })
    assert.equal(imageSaved.value.settings.version, 2); assert.equal(imageSaved.value.settings.imageModel, 'new-image'); assert.equal(imageSaved.value.ffmpeg.mode, 'configured')
    const imageCredential = await request(app.origin, '/image-generation/credential/set', { value: 'write-only-secret' })
    assert.equal(imageCredential.value.credential.configured, true); assert.equal(JSON.stringify(imageCredential.value).includes('write-only-secret'), false)
    assert.equal((await request(app.origin, '/image-generation/credential/unset', {})).value.credential.configured, false)
    assert.equal((await request(app.origin, '/image-generation/settings', { settings: { imageApiUrl: 'https://new.example/v1/chat/completions', imageApiProtocol: 'chat-completions', imageModel: 'new-image', imageSize: '1536x1024', avifQuality: 75, avifEffort: 6, ffmpegPath: 'C:\\ffmpeg\\bin\\ffmpeg.exe' }, expected: { version: 1, sha256: '7'.repeat(64) } })).status, 409)
    assert.equal((await request(app.origin, '/image-generation/settings', { settings: { imageApiUrl: 'http://unsafe.example/v1/images/generations', imageApiProtocol: 'auto', imageModel: 'x', imageSize: '1024x1024', avifQuality: 70, avifEffort: 5, ffmpegPath: '' }, expected: { version: 2, sha256: '6'.repeat(64) }, apiKey: 'forbidden' })).status, 400)
    assert.equal((await request(app.origin, '/image-generation/credential/set', { value: 'bad\nkey' })).status, 400)

    const content = await request(app.origin, '/content?search=AI&category=news&status=unread&sortBy=title&sortOrder=asc&limit=20&offset=0')
    assert.equal(content.status, 200); assert.equal(content.value.total, 1); assert.equal(content.value.records[0].title, 'AI News')
    assert.deepEqual(content.value.records[0], { storeId: 'a'.repeat(64), sourceId: 'rss:news', externalId: 'entry-1', status: 'unread',
      firstSeenAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:02.000Z', fetchedAt: '2026-01-01T00:00:02.000Z',
      title: 'AI News', description: 'Summary', url: 'https://example.com/entry-1', publishedAt: '2026-01-01T00:00:00.000Z', source: 'News', category: 'news', author: 'Author',
      sourceAiSummary: 'Source AI summary', aiSummary: 'Reviewer AI summary', aiScore: 85, aiReason: 'Weighted review reason', aiReviewedAt: '2026-01-01T00:00:03.000Z' })
    assert.deepEqual(content.value.categories, [{ category: 'news', count: 1 }]); assert.equal(JSON.stringify(content.value).includes('must-not-project'), false)
    assert.equal((await request(app.origin, '/content?sortBy=secret')).status, 400)
    assert.equal((await request(app.origin, '/content?limit=20&limit=30')).status, 400)
    assert.equal((await request(app.origin, '/content?unknown=1')).status, 400)

    const settings = await request(app.origin, '/source-settings')
    assert.equal(settings.value.sources[0].settingsId, 'rss:news')
    assert.deepEqual(settings.value.credentialSlots, [{ id: 'follow', name: 'Follow Login', usage: 'follow-cookie', configured: false, writable: true, allowDashboardWrite: true }])
    assert.deepEqual(settings.value.adapters, ['github-trending', 'rss', 'ai-search', 'follow'].map(type => ({ type, enabled: true })))
    assert.equal(settings.value.sources[0].updatedAt, '2026-01-01T00:00:00.000Z')
    assert.deepEqual((await request(app.origin, '/source-settings/adapter', { type: 'rss', enabled: false })).value.adapter, { type: 'rss', enabled: false })
    const saved = await request(app.origin, '/source-settings/save', { mode: 'create', source: { type: 'github-trending', id: 'weekly', name: 'Weekly', category: 'githubTrending', enabled: true, limit: 25, since: 'weekly', spokenLanguageCode: '' } })
    assert.equal(saved.value.source.settingsId, 'github-trending:weekly')
    const maxRss = await request(app.origin, '/source-settings/save', { mode: 'create', source: { type: 'rss', id: 'bulk-rss', name: 'Bulk RSS', category: 'rss', enabled: true, limit: 1000, url: 'https://example.com/bulk.xml' } })
    assert.equal(maxRss.status, 200); assert.equal(maxRss.value.source.limit, 1000)
    const maxFollow = await request(app.origin, '/source-settings/save', { mode: 'create', source: { type: 'follow', id: 'bulk-follow', name: 'Bulk Follow', category: 'paper', enabled: true, limit: 2000, listId: 'list-1', fetchDays: 3, fetchPages: 1, view: 0, pageDelayMs: 1500, detailDelayMs: 400 } })
    assert.equal(maxFollow.status, 200); assert.equal(maxFollow.value.source.limit, 2000)
    assert.equal((await request(app.origin, '/source-settings/save', { source: { type: 'rss', id: 'x', name: 'X', url: 'https://example.com/x' } })).status, 400)
    assert.equal((await request(app.origin, '/source-settings/save', { mode: 'update', source: { type: 'rss', id: 'news', name: 'News', url: 'https://example.com/feed.xml' } })).status, 400)
    const credentialSet = await request(app.origin, '/source-settings/credential/set', { slotId: 'follow', value: 'session=secret' })
    assert.deepEqual(credentialSet.value, { updated: true, slotId: 'follow' })
    assert.equal(JSON.stringify(credentialSet.value).includes('session=secret'), false)
    assert.deepEqual((await request(app.origin, '/source-settings/credential/unset', { slotId: 'follow' })).value, { removed: true, slotId: 'follow' })
    assert.equal((await request(app.origin, '/source-settings/delete', { settingsId: 'rss:news' })).value.deleted, true)

    assert.equal((await request(app.origin, '/publishers')).value[0].id, 'local-markdown:daily')
    const channels = (await request(app.origin, '/publisher-channels')).value.channels
    assert.equal(channels.length, 4); assert.equal(channels[0].configRevision, 'a'.repeat(64))
    assert.equal(JSON.stringify(channels).includes('root'), false)
    const rssOutputs = await request(app.origin, '/production/rss-outputs', { draftId: 'draft-1', limit: 20 })
    assert.equal(rssOutputs.status, 200); assert.equal(rssOutputs.value.records[0].outputId, '9'.repeat(64)); assert.equal(rssOutputs.value.records[0].xml, undefined)
    const rssDetail = await request(app.origin, `/production/rss-output?outputId=${'9'.repeat(64)}`)
    assert.equal(rssDetail.status, 200); assert.equal(rssDetail.value.record.xml, '<?xml version="1.0"?><rss><channel/></rss>')
    const drafts = await request(app.origin, '/production/drafts', { limit: 20 })
    assert.equal(drafts.status, 200)
    assert.equal(drafts.value.records[0].markdown, configured.markdown)
    assert.equal(drafts.value.records[0].markdown.length, configured.markdown.length)

    const reviewed = await request(app.origin, '/production/review', { draftId: 'draft-1', decision: 'approve', version: 1, sha256: 'c'.repeat(64) })
    assert.equal(reviewed.value.draft.status, 'approved')
    const published = await request(app.origin, '/production/publish', { draftId: 'draft-1', publisherId: 'local-markdown:daily' })
    assert.equal(published.value.receipt.artifactSha256, 'c'.repeat(64))
    const receipt = (await request(app.origin, '/receipts/query', { limit: 20 })).value.records[0]
    assert.equal(receipt.receiptId, 'receipt')
    assert.deepEqual({ draftId: receipt.draftId, draftVersion: receipt.draftVersion, artifactSha256: receipt.artifactSha256 }, { draftId: 'draft-1', draftVersion: 1, artifactSha256: 'c'.repeat(64) })
  } finally { await app.close() }
})

test('dashboard repeat DTO requires a canonical lowercase UUID intent and preserves it across sequential, concurrent, and new-token POSTs', async () => {
  const configured = services()
  const attempts = new Map()
  let publisherInvocations = 0
  configured.prismProduction.republishExact = async (draftId, publisherId, expectedVersion, expectedSha256, intentId, execution) => {
    assert.deepEqual({ draftId, publisherId, expectedVersion, expectedSha256, surface: execution.surface }, {
      draftId: 'draft-1', publisherId: 'local-markdown:daily', expectedVersion: 1, expectedSha256: 'c'.repeat(64), surface: 'dashboard',
    })
    if (!attempts.has(intentId)) {
      publisherInvocations += 1
      attempts.set(intentId, { status: 'unchanged', draftId, publisherId, receiptId: `receipt-${publisherInvocations}`,
        publicationAttemptId: `attempt-${publisherInvocations}`, publicationAttemptNumber: publisherInvocations + 1, publicationIntent: 'repeat' })
    }
    return attempts.get(intentId)
  }
  const app = await dashboard(configured)
  const intentId = 'a8888888-8888-4888-8888-888888888888'
  const body = { draftId: 'draft-1', publisherId: 'local-markdown:daily', expectedVersion: 1, expectedSha256: 'c'.repeat(64), intentId }
  try {
    const first = await request(app.origin, '/production/republish', body)
    const replay = await request(app.origin, '/production/republish', body)
    assert.equal(first.status, 200); assert.deepEqual(replay.value, first.value); assert.equal(publisherInvocations, 1)
    const concurrent = await Promise.all([request(app.origin, '/production/republish', body), request(app.origin, '/production/republish', body)])
    assert.deepEqual(concurrent[0].value, concurrent[1].value); assert.equal(publisherInvocations, 1)
    const fresh = await request(app.origin, '/production/republish', { ...body, intentId: '99999999-9999-4999-8999-999999999999' })
    assert.notEqual(fresh.value.receipt.publicationAttemptId, first.value.receipt.publicationAttemptId); assert.equal(publisherInvocations, 2)
    assert.equal((await request(app.origin, '/production/republish', { ...body, intentId: 'not-a-uuid' })).status, 400)
    assert.equal((await request(app.origin, '/production/republish', { ...body, intentId: intentId.toUpperCase() })).status, 400)
    assert.equal(publisherInvocations, 2)
    assert.equal((await request(app.origin, '/production/republish', { ...body, extra: true })).status, 400)
  } finally { await app.close() }
})

test('dashboard records exact operator-confirmed WeChat success only through the committed reconciliation seam', async () => {
  const configured = services(); const calls = []
  configured.prismProduction.confirmCommittedPublication = async (...args) => {
    calls.push(args)
    return { draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', title: 'Brief', markdown: '# Brief', sha256: 'c'.repeat(64),
      version: 1, status: 'published', sourceContentStoreIds: ['a'.repeat(64)], publishedPublisherIds: ['wechat-draft:account'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' }
  }
  const app = await dashboard(configured)
  const body = { draftId: 'draft-1', publisherId: 'wechat-draft:account', attemptId: 'attempt-1', confirmation: 'external-destination-checked-committed' }
  try {
    assert.equal((await request(app.origin, '/production/reconcile-committed', { ...body, confirmation: 'unchecked' })).status, 400)
    assert.equal((await request(app.origin, '/production/reconcile-committed', { ...body, publisherId: 'github-markdown:account' })).status, 400)
    assert.equal((await request(app.origin, '/production/reconcile-committed', { ...body, extra: true })).status, 400)
    const result = await request(app.origin, '/production/reconcile-committed', body)
    assert.equal(result.status, 200); assert.equal(result.value.draft.status, 'published')
    assert.deepEqual(calls, [['draft-1', 'wechat-draft:account', 'attempt-1']])
  } finally { await app.close() }
})

test('dashboard permits only exact confirmed-absent WeChat reconciliation through the privileged service seam', async () => {
  const configured = services(); const calls = []
  configured.prismProduction.reconcilePublication = async (...args) => {
    calls.push(args)
    return { draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', title: 'Brief', markdown: '# Brief', sha256: 'c'.repeat(64),
      version: 1, status: 'approved', sourceContentStoreIds: ['a'.repeat(64)], publishedPublisherIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' }
  }
  const app = await dashboard(configured)
  const body = { draftId: 'draft-1', publisherId: 'wechat-draft:account', attemptId: 'attempt-1', confirmation: 'external-destination-checked-absent' }
  try {
    assert.equal((await request(app.origin, '/production/reconcile-not-committed', { ...body, confirmation: 'unchecked' })).status, 400)
    assert.equal((await request(app.origin, '/production/reconcile-not-committed', { ...body, publisherId: 'github-markdown:account' })).status, 400)
    const result = await request(app.origin, '/production/reconcile-not-committed', body)
    assert.equal(result.status, 200); assert.equal(result.value.draft.status, 'approved')
    assert.deepEqual(calls, [['draft-1', 'wechat-draft:account', 'attempt-1', 'not-committed']])
  } finally { await app.close() }
})

test('dashboard duplicate-risk seam unblocks only an exact confirmed unknown WeChat attempt', async () => {
  const configured = services(); const calls = []
  configured.prismProduction.allowUnknownPublicationRetry = async (...args) => {
    calls.push(args)
    return { draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', title: 'Brief', markdown: '# Brief', sha256: 'c'.repeat(64),
      version: 1, status: 'approved', sourceContentStoreIds: ['a'.repeat(64)], publishedPublisherIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' }
  }
  const app = await dashboard(configured)
  const body = { draftId: 'draft-1', publisherId: 'wechat-draft:account', attemptId: 'attempt-unknown', confirmation: 'accept-possible-duplicate-draft' }
  try {
    assert.equal((await request(app.origin, '/production/allow-unknown-retry', { ...body, confirmation: 'unchecked' })).status, 400)
    const result = await request(app.origin, '/production/allow-unknown-retry', body)
    assert.equal(result.status, 200); assert.equal(result.value.draft.status, 'approved')
    assert.deepEqual(calls, [['draft-1', 'wechat-draft:account', 'attempt-unknown']])
  } finally { await app.close() }
})

test('dashboard repeat replay of a durable not-committed outcome remains an HTTP failure', async () => {
  const configured = services()
  let calls = 0
  configured.prismProduction.republishExact = async () => {
    calls += 1
    const error = new PublisherOutcomeError('not-committed', 'draft-create', 'safe publication failure')
    error.errcode = 40003; error.rid = 'safe-request-id'; throw error
  }
  const app = await dashboard(configured)
  const body = { draftId: 'draft-1', publisherId: 'local-markdown:daily', expectedVersion: 1,
    expectedSha256: 'c'.repeat(64), intentId: '87777777-7777-4777-8777-777777777777' }
  try {
    const first = await request(app.origin, '/production/republish', body)
    const replay = await request(app.origin, '/production/republish', body)
    assert.equal(first.status, 422)
    assert.equal(replay.status, 422)
    assert.deepEqual(first.value, { error: 'safe publication failure', outcome: 'not-committed', operation: 'draft-create', code: 40003, requestId: 'safe-request-id' })
    assert.deepEqual(replay.value, first.value)
    assert.equal(calls, 2)
  } finally { await app.close() }
})

test('dashboard publication returns a non-error 202 reconciliation result without retrying or leaking secrets', async () => {
  const configured = services()
  let attempts = 0
  configured.prismProduction.publish = async (draftId, publisherId) => {
    attempts += 1
    throw new PublicationReconciliationError({
      status: 'created', draftId, publisherId, draftVersion: 1, artifactSha256: 'c'.repeat(64),
      receiptPersistence: 'failed', publicationCommitted: true, articleType: 'news', wechatDraftMediaId: 'safe-media-id',
      operation: 'draft.add', verification: 'verified', access_token: 'must-not-project', errmsg: 'must-not-project',
    })
  }
  const app = await dashboard(configured)
  try {
    const response = await request(app.origin, '/production/publish', { draftId: 'draft-1', publisherId: 'local-markdown:daily' })
    assert.equal(response.status, 202)
    assert.equal(response.value.warning, 'Publication outcome requires operator reconciliation before any retry.')
    assert.deepEqual(response.value.receipt, {
      success: false, status: 'reconciliation-required', receiptPersistence: 'failed', publicationCommitted: true,
      publisherId: 'local-markdown:daily', draftId: 'draft-1', draftVersion: 1, artifactSha256: 'c'.repeat(64), publicationStatus: 'created',
      articleType: 'news', wechatDraftMediaId: 'safe-media-id', operation: 'draft.add', verification: 'verified',
    })
    assert.equal(JSON.stringify(response.value).includes('must-not-project'), false)
    assert.equal(attempts, 1)
  } finally { await app.close() }
})

test('dashboard draft revision API is exact, bounded, same-origin, and reports optimistic conflicts', async () => {
  const configured = services()
  const app = await dashboard(configured)
  try {
    const current = await request(app.origin, `/production/draft?draftId=${encodeURIComponent('draft-1')}`)
    assert.equal(current.status, 200); assert.equal(current.value.draft.version, 1)
    const body = { draftId: 'draft-1', expectedVersion: 1, expectedSha256: 'c'.repeat(64), title: 'Edited', markdown: '# Edited\n' }
    const revised = await request(app.origin, '/production/revise', body, {}, 'PUT')
    assert.equal(revised.status, 200); assert.equal(revised.value.draft.version, 2); assert.equal(revised.value.draft.markdown, '# Edited\n')
    const conflict = await request(app.origin, '/production/revise', body, {}, 'PUT')
    assert.equal(conflict.status, 409); assert.match(conflict.value.error, /version or hash changed/)
    const reviewConflict = await request(app.origin, '/production/review', { draftId: 'draft-1', decision: 'approve', version: 1, sha256: 'c'.repeat(64) })
    assert.equal(reviewConflict.status, 409); assert.match(reviewConflict.value.error, /changed before review/)
    const refreshed = await request(app.origin, '/production/draft?draftId=draft-1')
    assert.equal(refreshed.value.draft.version, 2); assert.equal(refreshed.value.draft.sha256, 'e'.repeat(64))
    assert.equal((await request(app.origin, '/production/revise', { ...body, expectedVersion: 2, expectedSha256: 'e'.repeat(64), provider: 'evil' }, {}, 'PUT')).status, 400)
    assert.equal((await request(app.origin, '/production/revise', { ...body, expectedVersion: 2, expectedSha256: 'e'.repeat(64), title: 'bad\n' }, {}, 'PUT')).status, 400)
    assert.equal((await request(app.origin, '/production/revise', { ...body, expectedVersion: 2, expectedSha256: 'e'.repeat(64), markdown: '# bad\u0001' }, {}, 'PUT')).status, 400)
    assert.equal((await request(app.origin, '/production/revise', { ...body, expectedVersion: 2, expectedSha256: 'e'.repeat(64), markdown: 'x'.repeat(100001) }, {}, 'PUT')).status, 400)
    assert.equal((await request(app.origin, '/production/revise', { ...body, expectedVersion: 2, expectedSha256: 'e'.repeat(64) }, { origin: 'https://evil.example' }, 'PUT')).status, 403)
  } finally { await app.close() }
})

test('dashboard deletes an exact Draft tombstone through a strict same-origin DTO', async () => {
  const app = await dashboard(services())
  try {
    const body = { draftId: 'draft-1', expectedVersion: 1, expectedSha256: 'c'.repeat(64) }
    assert.equal((await request(app.origin, '/production/delete-draft', { ...body, extra: true })).status, 400)
    assert.equal((await request(app.origin, '/production/delete-draft', body, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await request(app.origin, '/production/delete-draft', { ...body, expectedVersion: 2 })).status, 409)
    const deleted = await request(app.origin, '/production/delete-draft', body)
    assert.equal(deleted.status, 200); assert.equal(deleted.value.deletion.draftId, 'draft-1'); assert.equal(deleted.value.deletion.replay, false)
    assert.equal((await request(app.origin, '/production/draft?draftId=draft-1')).status, 404)
    const replay = await request(app.origin, '/production/delete-draft', body)
    assert.equal(replay.status, 200); assert.equal(replay.value.deletion.replay, true)
  } finally { await app.close() }
})

test('dashboard media proxy admits only exact persisted draft media and returns bounded same-origin-safe headers', async () => {
  const app = await dashboard(services())
  const mediaPath = (draftId, kind, url) => `/production/media?draftId=${encodeURIComponent(draftId)}&kind=${encodeURIComponent(kind)}&url=${encodeURIComponent(url)}`
  try {
    const admittedUrl = 'https://media.example/admitted.png'
    const admitted = await requestBytes(app.origin, mediaPath('draft-1', 'image', admittedUrl))
    assert.equal(admitted.status, 200)
    assert.equal(admitted.headers.get('content-type'), 'image/png')
    assert.equal(admitted.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(admitted.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(admitted.headers.get('cache-control'), 'private, no-store')
    assert.equal(admitted.body.toString(), admittedUrl)

    for (const path of [
      mediaPath('draft-1', 'image', 'https://media.example/unknown.png'),
      mediaPath('draft-1', 'video', admittedUrl),
      mediaPath('unknown-draft', 'image', admittedUrl),
    ]) {
      const rejected = await request(app.origin, path)
      assert.equal(rejected.status, 404)
      assert.deepEqual(rejected.value, { error: 'Draft media is not available' })
    }
    assert.equal((await request(app.origin, mediaPath('draft-1', 'image', 'https://user:secret@media.example/admitted.png'))).status, 400)
    assert.equal((await request(app.origin, `${mediaPath('draft-1', 'image', admittedUrl)}&kind=image`)).status, 400)
    assert.equal((await request(app.origin, `/production/media?draftId=${'x'.repeat(9000)}`)).status, 414)
  } finally { await app.close() }
})

test('every Dashboard API request requires a literal loopback Host on the listener port even without Origin', async () => {
  const app = await dashboard(services())
  try {
    const port = new URL(app.origin).port
    for (const path of ['/status', '/source-settings', '/production/draft?draftId=draft-1']) {
      const rebound = await requestWithHost(app.origin, path, `attacker.example:${port}`)
      assert.equal(rebound.status, 403, path)
    }
    assert.equal((await requestWithHost(app.origin, '/status', `127.0.0.2:${port}`)).status, 403)
    assert.equal((await requestWithHost(app.origin, '/status', '127.0.0.1:1')).status, 403)
    assert.equal((await requestWithHost(app.origin, '/status', `localhost:${port}`)).status, 200)
    assert.equal((await requestWithHost(app.origin, '/status', `[::1]:${port}`)).status, 200)
  } finally { await app.close() }
})

test('every Dashboard API GET and write is restricted to a loopback peer', async t => {
  const address = Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address
  if (!address) return t.skip('no non-loopback IPv4 interface is available')
  const app = await dashboard(services(), '0.0.0.0', address)
  try {
    assert.equal((await request(app.origin, '/status')).status, 403)
    assert.equal((await request(app.origin, '/production/drafts', { limit: 1 })).status, 403)
    assert.equal((await request(app.origin, '/source-settings/delete', { settingsId: 'rss:news' })).status, 403)
  } finally { await app.close() }
})

test('dashboard prompt-management routes are absent and cannot reach the compatibility store', async () => {
  const configured = services()
  let promptStoreCalls = 0
  configured.prismGeneratorPrompts = new Proxy({}, { get() { promptStoreCalls += 1; throw new Error('prompt store HTTP seam must not exist') } })
  const app = await dashboard(configured)
  try {
    for (const [method, path, body] of [
      ['GET', '/generator-prompts'],
      ['GET', '/generator-prompts/current?generatorId=brief'],
      ['GET', '/generator-prompts/history?generatorId=brief&limit=20'],
      ['PUT', '/generator-prompts', { generatorId: 'brief', expectedVersion: 1, persona: 'changed', reviewPersona: 'changed' }],
      ['POST', '/generator-prompts/rollback', { generatorId: 'brief', expectedVersion: 2, targetVersion: 1 }],
    ]) {
      const response = method === 'GET' ? await request(app.origin, path) : await request(app.origin, path, body, {}, method)
      assert.equal(response.status, 404, `${method} ${path}: ${JSON.stringify(response.value)}`)
      assert.equal(response.value.error, 'Unknown PrismFlow dashboard endpoint')
    }
    assert.equal(promptStoreCalls, 0)
  } finally { await app.close() }
})

test('dashboard workflow builder and request administration routes use strict secret-free DTOs', async () => {
  const app = await dashboard(services())
  try {
    const list = await request(app.origin, '/generator-workflows')
    assert.equal(list.status, 200); assert.equal(list.value.records[0].steps[0].id, 'step-1')
    assert.equal(Object.hasOwn(list.value.records[0].deploymentPolicy, 'providerRef'), false)
    const create = { generatorId: 'new-brief', generatorName: 'New brief', description: '', steps: [{ id: 'draft', name: 'Draft', persona: 'Writer', processPrompt: '' }] }
    const created = await request(app.origin, '/generator-workflows', create)
    assert.equal(created.status, 201); assert.equal(created.value.record.steps[0].processPrompt, '')
    assert.equal((await request(app.origin, '/generator-workflows', { ...create, generatorId: 'whitespace', steps: [{ ...create.steps[0], processPrompt: '  ' }] })).status, 400)
    assert.equal((await request(app.origin, '/generator-workflows', { ...create, generatorId: 'no-persona', steps: [{ ...create.steps[0], persona: '' }] })).status, 400)
    assert.equal((await request(app.origin, '/generator-workflows', { ...create, generatorId: 'missing-prompt', steps: [{ id: 'draft', name: 'Draft', persona: 'Writer' }] })).status, 400)
    for (const forbidden of ['providerRef', 'modelRef', 'toolPolicy', 'maxInputChars']) {
      assert.equal((await request(app.origin, '/generator-workflows', { ...create, [forbidden]: 'unsafe' })).status, 400)
    }
    assert.equal((await request(app.origin, '/generator-workflows', { ...create, steps: Array.from({ length: 9 }, (_, index) => ({ ...create.steps[0], id: `s-${index}` })) })).status, 400)
    const requests = await request(app.origin, '/production/requests', { status: 'pending', limit: 10 })
    assert.equal(requests.status, 200); assert.equal(Object.hasOwn(requests.value.records[0], 'contentStoreIds'), false)
    assert.equal((await request(app.origin, '/production/request/cancel', { requestId: 'request-1' })).value.request.status, 'cancelled')
    assert.equal((await request(app.origin, '/production/request/retry', { requestId: 'request-1' })).value.request.status, 'pending')
  } finally { await app.close() }
})

test('workflow deletion preview and commit use strict CAS DTOs and return prompt-free audit metadata', async () => {
  const configured = services(); const calls = []
  const archived = { format: 'workflow-v1', generatorId: 'builder', generatorName: 'Builder', description: 'Workflow', enabled: false,
    steps: [{ id: 'step-1', name: 'Draft', persona: 'SECRET PERSONA', processPrompt: 'SECRET PROMPT' }], executionProfile: { id: 'builder-profile', version: 1, sha256: 'a'.repeat(64), runnerPolicyVersion: 'serial-workflow-v1', toolPolicy: { allow: [] }, ceilings: { maxSteps: 8 } },
    version: 2, sha256: 'b'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z', actor: 'dashboard-admin', action: 'disable', sourceVersion: 1 }
  configured.prismProduction.previewGeneratorWorkflowDeletion = async input => { calls.push(['preview', input]); return { record: archived, replay: false, blockers: { pending: 0, running: 0 }, canDelete: true } }
  configured.prismProduction.deleteGeneratorWorkflow = async input => { calls.push(['delete', input]); return { record: { ...archived, version: 3, action: 'delete', sourceVersion: 2 }, replay: false, blockers: { pending: 0, running: 0 } } }
  const app = await dashboard(configured)
  const body = { generatorId: 'builder', expected: { kind: 'workflow-v1', version: 2, sha256: 'b'.repeat(64) } }
  try {
    const preview = await request(app.origin, '/generator-workflows/delete/preview', body)
    assert.equal(preview.status, 200); assert.equal(preview.value.canDelete, true)
    assert.equal(Object.hasOwn(preview.value.record, 'steps'), false)
    assert.equal(JSON.stringify(preview.value).includes('SECRET'), false)
    const deleted = await request(app.origin, '/generator-workflows/delete', body)
    assert.equal(deleted.status, 200); assert.equal(deleted.value.record.lifecycle, 'deleted')
    assert.deepEqual(calls.map(item => item[0]), ['preview', 'delete'])
    assert.deepEqual(calls[0][1], body)
    assert.equal((await request(app.origin, '/generator-workflows/delete', { ...body, extra: true })).status, 400)
    assert.equal((await request(app.origin, '/generator-workflows?includeDeleted=maybe')).status, 400)
  } finally { await app.close() }

  const unavailable = services(); delete unavailable.prismProduction
  const unavailableApp = await dashboard(unavailable)
  try {
    const response = await request(unavailableApp.origin, '/generator-workflows/delete', body)
    assert.equal(response.status, 503); assert.equal(response.value.code, 'production_reference_check_unavailable')
  } finally { await unavailableApp.close() }
})

test('dashboard data-plane and generation invocation routes are absent and return 404', async () => {
  const app = await dashboard(services())
  try {
    for (const [method, path] of REMOVED_ROUTES) {
      const response = method === 'GET' ? await request(app.origin, path) : await request(app.origin, path, {})
      assert.equal(response.status, 404, `${method} ${path}: ${JSON.stringify(response.value)}`)
      assert.equal(response.value.error, 'Unknown PrismFlow dashboard endpoint')
    }
  } finally { await app.close() }
})

test('dashboard control plane keeps origin checks and strict secret-free DTOs', async () => {
  let publishArgs; let draftQueryOptions
  const configured = services()
  configured.prismSourceSettings.list = () => [{ settingsId: 'follow:papers', type: 'follow', id: 'papers', name: 'Papers', category: 'paper', enabled: true, limit: 20, listId: '123', credentialSlotId: 'follow', credentialRef: 'SOURCE_SETTINGS_SECRET', cookie: 'COOKIE_SECRET' }]
  configured.prismSourceSettings.describeCredentialSlots = async () => [{ id: 'follow', name: 'Follow Login', usage: 'follow-cookie', configured: true, source: 'file', writable: true, allowDashboardWrite: true, credentialRef: 'SLOT_SECRET', value: 'COOKIE_SECRET' }]
  configured.prismPublishers.list = () => [{ id: 'local-markdown:daily', name: 'Daily', description: '', token: 'PUBLISHER_LIST_SECRET' }]
  configured.prismPublicationReceipts.list = () => [{ receiptId: 'receipt', publisherId: 'local-markdown:daily', status: 'created', publicUrl: 'javascript:alert(1)', receiptSecret: 'RECEIPT_SECRET' }]
  configured.prismProduction.listDrafts = () => [{
    draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', generatorPromptVersion: 1, generatorPromptSha256: 'd'.repeat(64), title: 'Brief', markdown: configured.markdown,
    sha256: 'c'.repeat(64), version: 1, status: 'approved', sourceContentStoreIds: ['a'.repeat(64)], publishedPublisherIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', credentialRef: 'DRAFT_SECRET',
  }]
  configured.prismProduction.queryDrafts = options => { draftQueryOptions = options; const records = configured.prismProduction.listDrafts(); return { records, total: 37, statusCounts: { approved: 37 } } }
  configured.prismProduction.publish = async (...args) => { publishArgs = args; return { status: 'created', publisherId: args[1], draftId: args[0], providerSecret: 'PUBLISH_SECRET' } }
  const app = await dashboard(configured)
  try {
    const settings = await request(app.origin, '/source-settings')
    assert.deepEqual(settings.value.credentialSlots, [{ id: 'follow', name: 'Follow Login', usage: 'follow-cookie', configured: true, source: 'file', writable: true, allowDashboardWrite: true }])
    assert.equal(JSON.stringify(settings.value).includes('SECRET'), false)
    assert.equal(JSON.stringify((await request(app.origin, '/publishers')).value).includes('SECRET'), false)
    const drafts = await request(app.origin, '/production/drafts', { status: 'approved', query: 'Brief', offset: 20, limit: 10 })
    assert.deepEqual(draftQueryOptions, { status: 'approved', query: 'Brief', offset: 20, limit: 10 })
    assert.equal(drafts.value.total, 37); assert.deepEqual(drafts.value.statusCounts, { approved: 37 })
    assert.equal(drafts.value.records[0].markdown, configured.markdown)
    assert.equal(JSON.stringify(drafts.value).includes('DRAFT_SECRET'), false)
    const receipts = await request(app.origin, '/receipts/query', { limit: 20 })
    assert.equal(receipts.value.records[0].publicUrl, undefined)
    assert.equal(JSON.stringify(receipts.value).includes('RECEIPT_SECRET'), false)

    const forbiddenReview = await request(app.origin, '/production/review', { draftId: 'draft-1', decision: 'approve', version: 1, sha256: 'c'.repeat(64), markdown: '# replaced' })
    assert.equal(forbiddenReview.status, 400)
    assert.match(forbiddenReview.value.error, /Unsupported request field/)
    const forbiddenPublish = await request(app.origin, '/production/publish', { draftId: 'draft-1', publisherId: 'local-markdown:daily', path: 'elsewhere' })
    assert.equal(forbiddenPublish.status, 400)
    assert.equal(publishArgs, undefined)
    const published = await request(app.origin, '/production/publish', { draftId: 'draft-1', publisherId: 'local-markdown:daily' })
    assert.equal(published.status, 200)
    assert.deepEqual(publishArgs.slice(0, 2), ['draft-1', 'local-markdown:daily'])
    assert.equal(JSON.stringify(published.value).includes('PUBLISH_SECRET'), false)

    const badOrigin = await request(app.origin, '/source-settings/delete', { settingsId: 'follow:papers' }, { origin: 'https://evil.example' })
    assert.equal(badOrigin.status, 403)
    const port = new URL(app.origin).port
    const reboundOrigin = `http://attacker.example:${port}`
    const rebound = await request(app.origin, '/source-settings/delete', { settingsId: 'follow:papers' }, { host: `attacker.example:${port}`, origin: reboundOrigin })
    assert.equal(rebound.status, 403)

    const identityChanged = await request(app.origin, '/source-settings/save', { mode: 'update', expectedSettingsId: 'rss:old', expectedUpdatedAt: '2026-01-01T00:00:00.000Z', source: { type: 'rss', id: 'new', name: 'New', enabled: true, limit: 20, url: 'https://example.com/feed' } })
    assert.equal(identityChanged.status, 400)
    configured.prismSourceSettings.setCredential = async () => { throw new Error('backend leaked COOKIE_SECRET') }
    const credentialFailure = await request(app.origin, '/source-settings/credential/set', { slotId: 'follow', value: 'super-secret-cookie' })
    assert.equal(credentialFailure.status, 500)
    assert.equal(JSON.stringify(credentialFailure.value).includes('secret'), false)
    assert.equal(app.warnings.some(message => String(message).includes('COOKIE_SECRET') || String(message).includes('super-secret-cookie')), false)
    const credentialWithExtra = await request(app.origin, '/source-settings/credential/set', { slotId: 'follow', value: 'secret', credentialRef: 'NOPE' })
    assert.equal(credentialWithExtra.status, 400)
    const credentialControl = await request(app.origin, '/source-settings/credential/set', { slotId: 'follow', value: 'bad\nsecret' })
    assert.equal(credentialControl.status, 400)
    const badCredentialOrigin = await request(app.origin, '/source-settings/credential/unset', { slotId: 'follow' }, { origin: 'https://evil.example' })
    assert.equal(badCredentialOrigin.status, 403)

    const unknownCases = [
      ['/receipts/query', { limit: 20, credentialRef: 'secret-ref' }],
      ['/source-settings/save', { mode: 'create', source: { type: 'rss', id: 'bad', name: 'Bad', category: 'rss', enabled: true, limit: 10, url: 'https://example.com/feed', credentialRef: 'secret-ref' } }],
      ['/source-settings/save', { mode: 'create', source: { type: 'follow', id: 'bad', name: 'Bad', category: 'follow', enabled: true, limit: 10, listId: '1', apiUrl: 'https://evil.example', fetchDays: 3, fetchPages: 1, view: 0, pageDelayMs: 0, detailDelayMs: 0 } }],
      ['/source-settings/save', { mode: 'create', source: { type: 'ai-search', id: 'bad', name: 'Bad', category: 'news', enabled: true, limit: 10, keyword: 'AI', subagentProvider: 'evil' } }],
    ]
    for (const [path, body] of unknownCases) {
      const response = await request(app.origin, path, body)
      assert.equal(response.status, 400)
      assert.match(response.value.error, /Unsupported request field/)
    }
    const oversized = await request(app.origin, '/source-settings/credential/set', { slotId: 'follow', value: 'x'.repeat(33 * 1024) })
    assert.equal(oversized.status, 413)
  } finally { await app.close() }
})

test('loopback same-origin maintenance action has an exact bounded DTO and confirms both admission drains', async () => {
  const configured = services()
  let publisherDrain = 0, productionDrain = 0
  configured.prismPublishers.beginMaintenanceDrain = async () => { publisherDrain += 1 }
  configured.prismPublishers.maintenanceStatus = () => ({ draining: true, active: 0, restartAllowed: true })
  configured.prismProduction.beginMaintenanceDrain = async () => { productionDrain += 1 }
  configured.prismProduction.maintenanceStatus = () => ({ draining: true, active: 0, restartAllowed: true })
  const app = await dashboard(configured)
  try {
    assert.equal((await request(app.origin, '/maintenance/drain', {})).status, 400)
    assert.deepEqual([publisherDrain, productionDrain], [0, 0], 'missing destructive confirmation must not invoke either drain')
    const drained = await request(app.origin, '/maintenance/drain', { confirmPauseUntilRestart: true })
    assert.equal(drained.status, 200)
    assert.deepEqual(drained.value, { maintenance: true, drained: true, timedOut: false, activeAttempts: 0, restartAllowed: true })
    assert.deepEqual([publisherDrain, productionDrain], [1, 1])
    assert.equal((await request(app.origin, '/maintenance/drain', { timeoutMs: null, confirmPauseUntilRestart: true })).status, 400)
    assert.equal((await request(app.origin, '/maintenance/drain', { timeoutMs: 30000, confirmPauseUntilRestart: true, extra: true })).status, 400)
    assert.equal((await request(app.origin, '/maintenance/drain', { confirmPauseUntilRestart: true }, { origin: 'https://evil.example' })).status, 403)
  } finally { await app.close() }
})

test('maintenance timeout preserves draining state and returns only bounded status', async () => {
  const configured = services()
  configured.prismPublishers.beginMaintenanceDrain = () => new Promise(() => {})
  configured.prismPublishers.maintenanceStatus = () => ({ draining: true, active: 1, restartAllowed: false, detail: 'must-not-project' })
  configured.prismProduction.beginMaintenanceDrain = async () => {}
  configured.prismProduction.maintenanceStatus = () => ({ draining: true, active: 0, restartAllowed: true })
  const app = await dashboard(configured)
  try {
    const timedOut = await request(app.origin, '/maintenance/drain', { timeoutMs: 100, confirmPauseUntilRestart: true })
    assert.equal(timedOut.status, 202)
    assert.deepEqual(timedOut.value, { maintenance: true, drained: false, timedOut: true, activeAttempts: 1, restartAllowed: false })
    assert.equal(JSON.stringify(timedOut.value).includes('must-not-project'), false)
  } finally { await app.close() }
})
