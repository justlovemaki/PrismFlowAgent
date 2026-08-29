import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { PrismSourceSettings, assertSafeRssUrl, managedSourceSchema, normalizeManagedSource, prismSourceSettingsDomain } from '../lib/store-source-settings.js'

class Table {
  constructor(entries = []) { this.map = new Map(entries); this.failPut = false; this.failDelete = false; this.putCount = 0; this.failPutAt = undefined }
  get(id) { return this.map.get(id) }
  entries() { return this.map.entries() }
  async put(id, value) { this.putCount += 1; if (this.failPut || this.putCount === this.failPutAt) throw new Error('put failed'); this.map.set(id, structuredClone(value)); return value }
  async delete(id) { if (this.failDelete) throw new Error('delete failed'); return this.map.delete(id) }
}
class Registry {
  constructor() { this.providers = new Map() }
  register(provider) {
    if (this.providers.has(provider.id)) throw new Error(`duplicate ${provider.id}`)
    this.providers.set(provider.id, provider)
    return () => { if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id) }
  }
  list() { return [...this.providers.values()].map(provider => ({ id: provider.id, name: provider.name })) }
}
function fixture(options = {}) {
  const ctx = new Context()
  const registry = new Registry()
  const credentialCalls = []
  const credentialWrites = []
  const starts = []
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'credentials', { value: {
    async resolve(ref) { credentialCalls.push(ref); return options.resolveCredential ? options.resolveCredential(ref) : { value: 'session=secret' } },
    async describe(ref) { credentialCalls.push(`describe:${ref}`); return options.describeCredential ? options.describeCredential(ref) : { configured: true, source: 'file', writable: true } },
    async set(ref, value) { credentialWrites.push({ operation: 'set', ref, value }); if (options.failCredentialWrite) throw new Error('secret backend') },
    async unset(ref) { credentialWrites.push({ operation: 'unset', ref }); if (options.failCredentialWrite) throw new Error('secret backend') },
  } })
  Object.defineProperty(ctx, 'subagents', { value: { async start(provider, request) { starts.push({ provider, request }); return { result: Promise.resolve({ stopReason: 'completed', structured: { items: [{ title: 'One', url: 'https://example.com', description: 'D', content: 'C' }] }, output: [] }), async dispose() { options.onDispose?.() } } } } })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [{ id: 'follow', name: 'Follow login', usage: 'follow-cookie', credentialRef: 'FOLLOW_SECRET', allowDashboardWrite: true }], bootstrap: [] })
  service.sources = new Table()
  return { service, registry, credentialCalls, credentialWrites, starts }
}
const rss = { type: 'rss', id: 'news', name: 'News', category: 'news', enabled: true, limit: 20, url: 'https://example.com/feed.xml' }

test('managed source CRUD registers immediately and rolls back registry and persistence failures', async () => {
  const { service, registry } = fixture()
  const created = await service.save(rss, { mode: 'create' })
  assert.equal(created.settingsId, 'rss:news')
  assert.ok(registry.providers.has('rss:news'))

  const disabled = await service.save({ ...rss, enabled: false, name: 'News off' }, { mode: 'update', expectedSettingsId: created.settingsId, expectedUpdatedAt: created.updatedAt })
  assert.equal(registry.providers.has('rss:news'), false)
  assert.equal(service.list()[0].name, 'News off')

  const enabled = await service.save({ ...rss, enabled: true }, { mode: 'update', expectedSettingsId: disabled.settingsId, expectedUpdatedAt: disabled.updatedAt })
  service.sources.failPut = true
  await assert.rejects(service.save({ ...rss, name: 'Replacement' }, { mode: 'update', expectedSettingsId: enabled.settingsId, expectedUpdatedAt: enabled.updatedAt }), /put failed/)
  assert.equal(registry.providers.get('rss:news').name, 'News')
  assert.equal(service.list()[0].name, 'News')
  service.sources.failPut = false

  registry.register({ id: 'rss:static', fetch() {} })
  await assert.rejects(service.save({ ...rss, id: 'static' }, { mode: 'create' }), /duplicate/)
  assert.equal(service.sources.get('rss:static'), undefined)
  assert.equal(registry.providers.get('rss:static').id, 'rss:static')

  service.sources.failDelete = true
  await assert.rejects(service.delete('rss:news'), /delete failed/)
  assert.ok(registry.providers.has('rss:news'))
  service.sources.failDelete = false
  await service.delete('rss:news')
  assert.equal(registry.providers.has('rss:news'), false)
})

test('update and delete abort and drain in-flight managed fetches', async () => {
  const { service } = fixture()
  const record = await service.save(rss, { mode: 'create' })
  let observedAbort = false
  const active = service.trackFetch(record.settingsId, (_request, execution) => new Promise((resolve, reject) => {
    execution.signal.addEventListener('abort', () => { observedAbort = true; reject(execution.signal.reason) }, { once: true })
  }), {}, {})
  const deleting = service.delete(record.settingsId)
  await assert.rejects(active, /configuration changed/)
  await deleting
  assert.equal(observedAbort, true)
})

test('RSS URL validation rejects obvious local and private targets', () => {
  for (const url of [
    'file:///tmp/feed', 'http://user:pass@example.com/feed', 'http://localhost/feed', 'http://foo.local/feed',
    'http://127.0.0.1/feed', 'http://10.0.0.1/feed', 'http://100.64.0.1/feed', 'http://169.254.169.254/latest',
    'http://192.0.2.1/feed', 'http://192.168.1.2/feed', 'http://198.51.100.1/feed', 'http://224.0.0.1/feed',
    'http://[::1]/feed', 'http://[fd00::1]/feed', 'http://[fe80::1]/feed', 'http://[2001:db8::1]/feed',
  ]) assert.throws(() => assertSafeRssUrl(url), /RSS URL|url/)
  assert.equal(assertSafeRssUrl('https://example.com/feed').startsWith('https://example.com/feed'), true)
})

test('Follow resolves an opaque configured credential slot for every fetch without projecting its reference or value', async t => {
  const { service, registry, credentialCalls } = fixture()
  const record = await service.save({ type: 'follow', id: 'papers', name: 'Papers', category: 'paper', enabled: true, limit: 20, listId: '123', fetchDays: 3, fetchPages: 1, view: 0, pageDelayMs: 0, detailDelayMs: 0, credentialSlotId: 'follow' }, { mode: 'create' })
  assert.deepEqual(await service.describeCredentialSlots(), [{ id: 'follow', name: 'Follow login', usage: 'follow-cookie', configured: true, source: 'file', writable: true, allowDashboardWrite: true }])
  assert.equal(JSON.stringify(service.list()).includes('FOLLOW_SECRET'), false)
  assert.equal(JSON.stringify(service.list()).includes('session=secret'), false)
  const originalFetch = globalThis.fetch
  const headers = []
  const urls = []
  globalThis.fetch = async (url, init) => { urls.push(String(url)); headers.push(init.headers); return { ok: true, async json() { return { data: [] } } } }
  t.after(() => { globalThis.fetch = originalFetch })
  const provider = registry.providers.get(record.settingsId)
  await provider.fetch({}, {})
  await provider.fetch({}, {})
  assert.deepEqual(credentialCalls, ['describe:FOLLOW_SECRET', 'FOLLOW_SECRET', 'FOLLOW_SECRET'])
  assert.deepEqual(urls, ['https://api.folo.is/entries', 'https://api.folo.is/entries'])
  assert.equal(headers.every(value => value.Cookie === 'session=secret'), true)
  assert.equal(headers.every(value => value['X-App-Version'] === '1.12.0'), true)
})

test('Follow fails closed with a sanitized source error when a selected credential is absent or empty', async () => {
  for (const missing of [undefined, { value: '' }, { value: '   ' }]) {
    const { service, registry } = fixture({ resolveCredential() { return missing } })
    const record = await service.save({ type: 'follow', id: 'papers', name: 'Papers', category: 'paper', enabled: true, limit: 20, listId: '123', fetchDays: 3, fetchPages: 1, view: 0, pageDelayMs: 0, detailDelayMs: 0, credentialSlotId: 'follow' }, { mode: 'create' })
    const provider = registry.providers.get(record.settingsId)
    await assert.rejects(provider.fetch({}, {}), error => {
      assert.equal(error.message, 'Follow credential could not be resolved for source: follow:papers')
      assert.equal(error.message.includes('FOLLOW_SECRET'), false)
      return true
    })
  }
})

test('credential slots are opaque, dashboard-write-gated, redacted, and resolved without caching', async () => {
  const writable = fixture()
  const slots = await writable.service.describeCredentialSlots()
  assert.deepEqual(slots, [{ id: 'follow', name: 'Follow login', usage: 'follow-cookie', configured: true, source: 'file', writable: true, allowDashboardWrite: true }])
  assert.equal(JSON.stringify(slots).includes('FOLLOW_SECRET'), false)
  assert.equal(JSON.stringify(slots).includes('session=secret'), false)
  await writable.service.setCredential('follow', 'session=rotated')
  await writable.service.unsetCredential('follow')
  assert.deepEqual(writable.credentialWrites, [
    { operation: 'set', ref: 'FOLLOW_SECRET', value: 'session=rotated' },
    { operation: 'unset', ref: 'FOLLOW_SECRET' },
  ])
  for (const value of ['', 'bad\nvalue', 'bad\rvalue', `x${String.fromCharCode(0)}y`, 'x'.repeat(16 * 1024 + 1)]) {
    await assert.rejects(writable.service.setCredential('follow', value), /Credential value is invalid/)
  }

  const ctx = new Context()
  Object.defineProperty(ctx, 'prismSources', { value: new Registry() })
  Object.defineProperty(ctx, 'credentials', { value: { async describe() { return { configured: true, source: 'env', writable: false } }, async set() { throw new Error('must not run') }, async unset() { throw new Error('must not run') } } })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  const readOnly = new PrismSourceSettings(ctx, { credentialSlots: [{ id: 'follow', name: 'Follow', usage: 'follow-cookie', credentialRef: 'FOLLOW_SECRET', allowDashboardWrite: false }], bootstrap: [] })
  readOnly.sources = new Table()
  assert.equal((await readOnly.describeCredentialSlots())[0].allowDashboardWrite, false)
  await assert.rejects(readOnly.setCredential('follow', 'secret'), /read-only/)
  await assert.rejects(readOnly.unsetCredential('follow'), /read-only/)
})

test('credential configuration validates usage and POSIX references and sanitizes backend failures', async () => {
  for (const slot of [
    { id: 'x', name: 'X', usage: 'unknown', credentialRef: 'GOOD_REF', allowDashboardWrite: true },
    { id: 'x', name: 'X', usage: 'follow-cookie', credentialRef: 'not-a-ref', allowDashboardWrite: true },
  ]) {
    const ctx = new Context()
    Object.defineProperty(ctx, 'prismSources', { value: new Registry() })
    Object.defineProperty(ctx, 'credentials', { value: {} })
    Object.defineProperty(ctx, 'subagents', { value: {} })
    assert.throws(() => new PrismSourceSettings(ctx, { credentialSlots: [slot], bootstrap: [] }), /Invalid managed source credential slot/)
  }

  const failing = fixture({ failCredentialWrite: true })
  await assert.rejects(failing.service.setCredential('follow', 'super-secret'), error => {
    assert.equal(error.message, 'Credential could not be stored for slot: follow')
    assert.equal(error.message.includes('super-secret'), false)
    assert.equal(error.message.includes('FOLLOW_SECRET'), false)
    return true
  })
})

test('managed source type defaults and edit identity match original Adapter Items', async () => {
  assert.equal(normalizeManagedSource({ type: 'github-trending', id: 'daily', name: 'Daily' }).limit, 25)
  assert.equal(normalizeManagedSource({ type: 'rss', id: 'rss-example', name: 'RSS', url: 'https://example.com/feed.xml' }).limit, 20)
  const ai = normalizeManagedSource({ type: 'ai-search', id: 'ai-news', name: 'AI', keyword: 'AI news' })
  const follow = normalizeManagedSource({ type: 'follow', id: 'papers', name: 'Papers', listId: '1' })
  assert.equal(ai.limit, 10)
  assert.equal(ai.category, 'news')
  assert.equal(follow.limit, 50)
  assert.equal(follow.category, 'paper')
  const { service } = fixture()
  const created = await service.save(rss, { mode: 'create' })
  await assert.rejects(service.save({ ...rss, id: 'renamed' }, { mode: 'update', expectedSettingsId: 'rss:news', expectedUpdatedAt: created.updatedAt }), /identity cannot change/)
  assert.equal(service.sources.get('rss:renamed'), undefined)
  await service.save({ ...rss, name: 'Updated' }, { mode: 'update', expectedSettingsId: 'rss:news', expectedUpdatedAt: created.updatedAt })
  assert.equal(service.sources.get('rss:news').name, 'Updated')
})

test('adapter state persists independently, drains active fetches, survives restart, and rolls back failures', async () => {
  const { service, registry } = fixture()
  const enabled = await service.save(rss, { mode: 'create' })
  await service.save({ ...rss, id: 'off', name: 'Off', enabled: false }, { mode: 'create' })
  let aborted = false
  const active = service.trackFetch(enabled.settingsId, (_request, execution) => new Promise((resolve, reject) => {
    execution.signal.addEventListener('abort', () => { aborted = true; reject(execution.signal.reason) }, { once: true })
  }), {}, {})
  const disabling = service.setAdapterEnabled('rss', false)
  await assert.rejects(active, /configuration changed/)
  await disabling
  assert.equal(aborted, true)
  assert.deepEqual(service.adapterStates().find(state => state.type === 'rss'), { type: 'rss', enabled: false })
  assert.equal(service.list().find(item => item.settingsId === 'rss:news').enabled, true)
  assert.equal(service.list().find(item => item.settingsId === 'rss:off').enabled, false)
  assert.equal(registry.providers.has('rss:news'), false)
  assert.deepEqual(service.sources.get('@adapter:rss'), { kind: 'adapter-state', type: 'rss', enabled: false, updatedAt: service.sources.get('@adapter:rss').updatedAt })

  await service.setAdapterEnabled('rss', true)
  assert.equal(registry.providers.has('rss:news'), true)
  assert.equal(registry.providers.has('rss:off'), false)

  service.sources.failPut = true
  await assert.rejects(service.setAdapterEnabled('rss', false), /put failed/)
  assert.equal(service.adapterStates().find(state => state.type === 'rss').enabled, true)
  assert.equal(registry.providers.has('rss:news'), true)
  service.sources.failPut = false

  await service.setAdapterEnabled('rss', false)
  registry.register({ id: 'rss:news', name: 'Conflict', fetch() {} })
  await assert.rejects(service.setAdapterEnabled('rss', true), /duplicate/)
  assert.equal(service.adapterStates().find(state => state.type === 'rss').enabled, false)
  assert.equal(service.list().find(item => item.settingsId === 'rss:news').enabled, true)

  const table = service.sources
  const restartCtx = new Context()
  const restartRegistry = new Registry()
  Object.defineProperty(restartCtx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
  Object.defineProperty(restartCtx, 'prismSources', { value: restartRegistry })
  Object.defineProperty(restartCtx, 'subagents', { value: {} })
  Object.defineProperty(restartCtx, 'credentials', { value: {} })
  const restarted = new PrismSourceSettings(restartCtx, { credentialSlots: [], bootstrap: [] })
  await restarted[Service.init]()
  assert.equal(restarted.adapterStates().find(state => state.type === 'rss').enabled, false)
  assert.equal(restarted.list().find(item => item.settingsId === 'rss:news').enabled, true)
  assert.equal(restartRegistry.providers.size, 0)
})

test('source create/update mode rejects duplicates, missing preconditions, and stale edits', async () => {
  const { service } = fixture()
  const created = await service.save(rss, { mode: 'create' })
  await assert.rejects(service.save(rss, { mode: 'create' }), /already exists/)
  await assert.rejects(service.save({ ...rss, name: 'No condition' }, { mode: 'update' }), /precondition/)
  const updated = await service.save({ ...rss, name: 'Fresh' }, { mode: 'update', expectedSettingsId: created.settingsId, expectedUpdatedAt: created.updatedAt })
  assert.notEqual(updated.updatedAt, created.updatedAt)
  await assert.rejects(service.save({ ...rss, name: 'Stale' }, { mode: 'update', expectedSettingsId: created.settingsId, expectedUpdatedAt: created.updatedAt }), /another editor/)
  assert.equal(service.sources.get(created.settingsId).name, 'Fresh')
})

test('managed providers reject invalid requested limits before any external operation', async () => {
  const { service, starts } = fixture()
  const records = [
    normalizeManagedSource(rss),
    normalizeManagedSource({ type: 'github-trending', id: 'daily', name: 'Daily' }),
    normalizeManagedSource({ type: 'follow', id: 'papers', name: 'Papers', listId: '1' }),
    normalizeManagedSource({ type: 'ai-search', id: 'ai', name: 'AI', keyword: 'news' }),
  ]
  for (const record of records) {
    const provider = service.provider(record)
    for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      await assert.rejects(provider.fetch({ limit }, { agent: {}, signal: new AbortController().signal }), /positive integer/)
    }
  }
  assert.equal(starts.length, 0)
})

test('managed AI Search requires an Agent and fixes provider/tool while disposing each run', async () => {
  let disposals = 0
  const { service, registry, starts } = fixture({ onDispose() { disposals += 1 } })
  const record = await service.save({ type: 'ai-search', id: 'ai-news', name: 'AI News', category: 'news', enabled: true, limit: 10, keyword: 'AI news' }, { mode: 'create' })
  const provider = registry.providers.get(record.settingsId)
  await assert.rejects(provider.fetch({}, {}), /requires a model-driven DSH tool call/)
  const result = await provider.fetch({}, { agent: { id: 'parent' } })
  assert.equal(result.length, 1)
  assert.equal(starts[0].provider, 'spawn')
  assert.deepEqual(starts[0].request.toolFilter, { allow: ['web_search'] })
  assert.equal(disposals, 1)
})

test('permissive domain schema opens primitive corrupt records and the service isolates them', async () => {
  const values = [null, 'corrupt', ['corrupt'], 42, rss]
  for (const value of values) {
    assert.equal(managedSourceSchema.safeParse(value).success, true)
    assert.equal(prismSourceSettingsDomain.tables.sources.valueSchema.safeParse(value).success, true)
  }
  const table = new Table([
    ['corrupt:null', null], ['corrupt:string', 'corrupt'], ['corrupt:array', ['corrupt']], ['corrupt:number', 42], ['rss:news', rss],
  ])
  const ctx = new Context()
  const registry = new Registry()
  Object.defineProperty(ctx, 'storageDomain', { value: { async open(spec) {
    for (const value of table.map.values()) spec.tables.sources.valueSchema.parse(value)
    return { table() { return table }, async close() {} }
  } } })
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  Object.defineProperty(ctx, 'credentials', { value: {} })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [] })
  await service[Service.init]()
  assert.deepEqual(service.list().map(record => record.settingsId), ['rss:news'])
  assert.equal(registry.providers.has('rss:news'), true)
})

test('bootstrap applies only to an empty domain and malformed records are isolated', async () => {
  const table = new Table()
  const ctx = new Context()
  const registry = new Registry()
  const warnings = []
  Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  Object.defineProperty(ctx, 'credentials', { value: {} })
  Object.defineProperty(ctx, 'logger', { value: { warn(message) { warnings.push(message) } } })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [rss, { ...rss, id: 'bad', url: 'http://127.0.0.1/feed' }] })
  await service[Service.init]()
  assert.equal(service.list().length, 1)
  assert.ok(registry.providers.has('rss:news'))
  assert.equal(warnings.length, 1)

  const bad = { type: 'rss', id: 'corrupt', name: '', enabled: true, secret: 'must-not-project' }
  table.map.set('rss:corrupt', bad)
  assert.equal(service.list().some(item => item.settingsId === 'rss:corrupt'), false)
})

test('bootstrap skips duplicate and static collisions before persistence', async () => {
  const table = new Table()
  const ctx = new Context()
  const registry = new Registry()
  registry.register({ id: 'rss:static', name: 'Static', fetch() {} })
  Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  Object.defineProperty(ctx, 'credentials', { value: {} })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [
    { ...rss, id: 'static' }, rss, { ...rss, name: 'Duplicate' },
  ] })
  await service[Service.init]()
  assert.equal(table.get('rss:static'), undefined)
  assert.equal(table.putCount, 1)
  assert.equal(service.list()[0].settingsId, 'rss:news')
  assert.equal(registry.providers.get('rss:static').name, 'Static')
  assert.ok(registry.providers.has('rss:news'))
})

test('bootstrap write failure rolls back registrations and all attempted writes so restart retries', async () => {
  const table = new Table()
  table.failPutAt = 2
  const make = () => {
    const ctx = new Context()
    const registry = new Registry()
    Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
    Object.defineProperty(ctx, 'prismSources', { value: registry })
    Object.defineProperty(ctx, 'subagents', { value: {} })
    Object.defineProperty(ctx, 'credentials', { value: {} })
    return { service: new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [rss, { ...rss, id: 'other', name: 'Other' }] }), registry }
  }
  const first = make()
  await assert.rejects(first.service[Service.init](), /put failed/)
  assert.equal(table.map.size, 0)
  assert.equal(first.registry.providers.size, 0)

  table.failPutAt = undefined
  table.putCount = 0
  const second = make()
  await second.service[Service.init]()
  assert.deepEqual([...table.map.keys()].sort(), ['rss:news', 'rss:other'])
  assert.deepEqual([...second.registry.providers.keys()].sort(), ['rss:news', 'rss:other'])
})

test('bootstrap surfaces aggregate failure when best-effort rollback also fails', async () => {
  const table = new Table()
  table.failPutAt = 2
  table.failDelete = true
  const ctx = new Context()
  const registry = new Registry()
  Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table() { return table }, async close() {} } } } })
  Object.defineProperty(ctx, 'prismSources', { value: registry })
  Object.defineProperty(ctx, 'subagents', { value: {} })
  Object.defineProperty(ctx, 'credentials', { value: {} })
  const service = new PrismSourceSettings(ctx, { credentialSlots: [], bootstrap: [rss, { ...rss, id: 'other', name: 'Other' }] })
  await assert.rejects(service[Service.init](), error => {
    assert.equal(error instanceof AggregateError, true)
    assert.match(error.message, /bootstrap and rollback failed/)
    return true
  })
})

test('normalization keeps disabled managed records visible with stable full ids', () => {
  const record = normalizeManagedSource({ ...rss, enabled: false })
  assert.equal(record.settingsId, 'rss:news')
  assert.equal(record.enabled, false)
})

test('bundle keeps visual source settings disabled for headless profiles without storage', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /id: prismflow-store-source-settings\s+name: '@prismflow\/dsh\/store-source-settings'\s+disabled: true/)
})
