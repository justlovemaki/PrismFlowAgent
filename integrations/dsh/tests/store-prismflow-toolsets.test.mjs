import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PRISMFLOW_CORE_TOOL_NAMES, PRISMFLOW_PERSONAL_CUSTOM_TOOL_NAMES, PRISMFLOW_PERSONAL_PLUGIN_IDS, PRISMFLOW_PLUGIN_MANIFESTS, PRISMFLOW_SYSTEM_PLUGIN_IDS, PRISMFLOW_TOOL_NAMES, PrismToolsetConflictError, PrismToolsetStore, prismFlowToolOrigin, registerPrismFlowTool } from '../lib/store-prismflow-toolsets.js'
import { apply as applySkillProvider } from '../lib/prismflow-skill-provider.js'

class Table {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { this.map.set(key, structuredClone(value)); return value }
}
async function fixture() { const store = new PrismToolsetStore(new Context(), { writerLockPath: 'fixture', skillRoot: 'fixture' }); store.table = new Table(); store.releaseWriterLock = async () => {}; store.materializeSkill = async () => {}; await store.bootstrap(); await store.bootstrapPromptSuggestions(); return store }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex') }

test('Chat tool origins distinguish personal-plugin tools from system defaults', () => {
  assert.deepEqual(PRISMFLOW_PERSONAL_CUSTOM_TOOL_NAMES, [
    'prismflow_create_ai_selection',
    'prismflow_create_ai_selection_from_explicit_source',
    'prismflow_process_markdown_media',
    'prismflow_trigger_insight_daily_build',
    'prismflow_image_generation',
    'prismflow_generate_cover_asset_from_draft',
    'prismflow_generate_rss_content',
    'prismflow_github_push',
  ])
  assert.equal(prismFlowToolOrigin('prismflow_image_generation'), 'personal-custom')
  assert.equal(prismFlowToolOrigin('prismflow_create_ai_selection'), 'personal-custom')
  assert.equal(prismFlowToolOrigin('prismflow_sources'), 'system-default')
  assert.equal(PRISMFLOW_CORE_TOOL_NAMES.length, 19)
  assert.equal(PRISMFLOW_CORE_TOOL_NAMES.every(name => prismFlowToolOrigin(name) === 'system-default'), true)
  assert.equal(PRISMFLOW_SYSTEM_PLUGIN_IDS.length, 5)
  assert.equal(PRISMFLOW_PERSONAL_PLUGIN_IDS.length, 7)
  assert.deepEqual([...new Set(PRISMFLOW_PLUGIN_MANIFESTS.flatMap(plugin => plugin.tools))].sort(), [...PRISMFLOW_TOOL_NAMES].sort())
})

test('fresh toolset bootstraps only system Skills and system plugins', async () => {
  const store = await fixture(); const toolset = store.getToolset()
  const skills = store.listSkills()
  assert.equal(skills.length, 2)
  assert.deepEqual(Object.fromEntries(skills.map(skill => [skill.skillId, { origin: skill.origin, removable: skill.removable }])), {
    'prismflow-draft-revision': { origin: 'system-default', removable: false },
    'prismflow-source-ingestion': { origin: 'system-default', removable: false },
  })
  assert.deepEqual(toolset.enabledPlugins, [...PRISMFLOW_SYSTEM_PLUGIN_IDS].sort())
  assert.deepEqual(toolset.enabledTools, [...PRISMFLOW_CORE_TOOL_NAMES].sort())
  assert.deepEqual(toolset.enabledSkills, ['prismflow-draft-revision', 'prismflow-source-ingestion'])
  assert.equal(store.listPlugins().some(plugin => plugin.origin === 'personal'), false)
  assert.equal(toolset.version, 1)
})

test('Chat prompt suggestions bootstrap in SQLite and save with exact version/SHA CAS', async () => {
  const store = await fixture()
  const current = store.getPromptSuggestions()
  assert.equal(current.items.length, 8)
  assert.equal(current.items[0].text, '获取 PrismFlow 已配置的所有数据源数据。')
  assert.match(current.items[1].text, /不重新同步任何数据源/u)
  assert.match(current.items[7].text, /prismflow_generate_cover_asset_from_draft/u); assert.match(current.items[7].text, /不得创建封面中间 Draft/u); assert.match(current.items[7].text, /排除最后两张图片/u)
  const saved = await store.savePromptSuggestions({ items: current.items.map((item, index) => ({ ...item, enabled: index !== 1 })),
    expected: { version: current.version, sha256: current.sha256 } })
  assert.equal(saved.version, 2); assert.equal(saved.items[1].enabled, false)
  assert.deepEqual(store.getPromptSuggestions(), saved)
  await assert.rejects(store.savePromptSuggestions({ items: saved.items, expected: { version: current.version, sha256: current.sha256 } }), /version conflict/)
})

test('cover prompt migration preserves customized source wording while replacing the Draft-producing cover path', async () => {
  const store = await fixture(); const current = store.getPromptSuggestions()
  const items = current.items.map(item => item.id === 'generate-short-daily-with-images' ? { ...item,
    text: '根据最新的已审批草稿，选择其中最具媒体传播效果的一个段落。\n使用 生成封面图片生成器，传入主标题和副标题， 生成一张 2:3 比例的封面图。\n保留我的其它要求。' } : item)
  const snapshot = { items, version: 9 }
  await store.table.put('@prompt-suggestions:active', { ...snapshot, sha256: digest(snapshot), updatedAt: '2026-01-01T00:00:00.000Z' })
  await store.bootstrapPromptSuggestions()
  const migrated = store.getPromptSuggestions(); const cover = migrated.items.find(item => item.id === 'generate-short-daily-with-images')
  assert.equal(migrated.version, 10); assert.match(cover.text, /最新的已审批草稿/u); assert.match(cover.text, /prismflow_generate_cover_asset_from_draft/u)
  assert.match(cover.text, /不得创建封面中间 Draft/u); assert.match(cover.text, /保留我的其它要求/u)
})

test('core preset checks every system-default tool and Skill while excluding personal customization', async () => {
  const store = await fixture()
  const personal = await store.createSkill({ skillId: 'prismflow-personal-core-test', name: 'Personal', description: 'Personal Skill', whenToUse: '', content: '# Personal', enabled: true })
  const current = store.getToolset()
  const saved = await store.saveToolset({ mode: 'core', enabledTools: current.enabledTools, enabledSkills: [personal.skillId], expected: { version: current.version, sha256: current.sha256 } })
  assert.deepEqual(saved.enabledPlugins, [...PRISMFLOW_SYSTEM_PLUGIN_IDS].sort())
  assert.deepEqual(saved.enabledTools, [...PRISMFLOW_CORE_TOOL_NAMES].sort())
  assert.equal(saved.enabledTools.every(name => prismFlowToolOrigin(name) === 'system-default'), true)
  assert.deepEqual(saved.enabledSkills, ['prismflow-draft-revision', 'prismflow-source-ingestion'])
})

test('fresh startup never materializes optional personal Skill bundles', async t => {
  const root = await mkdtemp(join(tmpdir(), 'prismflow-no-personal-skill-seed-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = await fixture(); store.skillRoot = join(root, 'skills'); await mkdir(store.skillRoot, { recursive: true })
  await assert.rejects(access(join(store.skillRoot, 'prismflow-ai-selection')), { code: 'ENOENT' })
  await assert.rejects(access(join(store.skillRoot, 'prismflow-daily-production')), { code: 'ENOENT' })
  const system = store.getSkill('prismflow-source-ingestion')
  await assert.rejects(store.deleteSkill({ skillId: system.skillId, expected: { version: system.version, sha256: system.sha256 } }), /System-default/u)
})

test('editing a protected system Skill never changes its system identity or removability', async () => {
  const store = await fixture(); const current = store.getSkill('prismflow-source-ingestion')
  const updated = await store.updateSkill({ skillId: current.skillId, name: current.name, description: `${current.description} Personal`, whenToUse: current.whenToUse, content: current.content, enabled: current.enabled, expected: { version: current.version, sha256: current.sha256 } })
  assert.equal(updated.origin, 'system-default')
  assert.equal(updated.removable, false)
  assert.equal(store.getSkill(current.skillId).origin, 'system-default')
})

test('toolset migrates every legacy unprefixed compatibility name to its prismflow_ primary name', async () => {
  const store = await fixture(); const current = store.getToolset()
  const inverse = new Map([
    ['prismflow_process_markdown_media', 'process_markdown_media'],
    ['prismflow_trigger_insight_daily_build', 'trigger_insight_daily_build'],
    ['prismflow_image_generation', 'image_generation'],
    ['prismflow_generate_rss_content', 'generate_rss_content'],
    ['prismflow_github_push', 'github_push'],
  ])
  const enabledTools = PRISMFLOW_TOOL_NAMES.map(name => inverse.get(name) ?? name).sort()
  const snapshot = { mode: 'complete', enabledTools, enabledSkills: current.enabledSkills, version: 7 }
  await store.table.put('@toolset:active', { ...snapshot, sha256: digest(snapshot), updatedAt: '2026-01-01T00:00:00.000Z' })
  await store.bootstrap()
  const migrated = store.getToolset()
  assert.equal(migrated.version, 8)
  assert.deepEqual(migrated.enabledPlugins, [...PRISMFLOW_SYSTEM_PLUGIN_IDS].sort())
  assert.deepEqual(migrated.enabledTools, [...PRISMFLOW_CORE_TOOL_NAMES].sort())
  assert.equal(migrated.enabledTools.every(name => name.startsWith('prismflow_')), true)
})

test('toolset migration removes unavailable formerly bundled personal plugins until manual import', async () => {
  const store = await fixture(); const current = store.getToolset()
  const enabledPlugins = PRISMFLOW_PLUGIN_MANIFESTS.map(plugin => plugin.pluginId === 'prismflow-personal-selection' ? 'prismflow-system-selection' : plugin.pluginId).sort()
  const snapshot = { mode: 'complete', enabledPlugins, enabledTools: [...PRISMFLOW_TOOL_NAMES, 'prismflow_create_cover_generation_request_from_draft'].sort(), enabledSkills: current.enabledSkills, version: 7 }
  await store.table.put('@toolset:active', { ...snapshot, sha256: digest(snapshot), updatedAt: '2026-01-01T00:00:00.000Z' })
  await store.bootstrap()
  const migrated = store.getToolset()
  assert.equal(migrated.version, 8)
  assert.deepEqual(migrated.enabledPlugins, [...PRISMFLOW_SYSTEM_PLUGIN_IDS].sort())
  assert.deepEqual(migrated.enabledTools, [...PRISMFLOW_CORE_TOOL_NAMES].sort())
  assert.equal(migrated.enabledTools.includes('prismflow_create_cover_generation_request_from_draft'), false)
})

test('custom plugin activation owns its tool boundary and rejects tools from disabled plugins', async () => {
  const store = await fixture(); const current = store.getToolset()
  await assert.rejects(store.saveToolset({ mode: 'custom', enabledPlugins: ['prismflow-system-sources'], enabledTools: ['prismflow_image_generation'], enabledSkills: [], expected: { version: current.version, sha256: current.sha256 } }), /enabledTools is invalid/u)
  const saved = await store.saveToolset({ mode: 'custom', enabledPlugins: ['prismflow-system-sources'], enabledTools: ['prismflow_sources'], enabledSkills: [], expected: { version: current.version, sha256: current.sha256 } })
  assert.deepEqual(saved.enabledPlugins, ['prismflow-system-sources'])
  assert.deepEqual(saved.enabledTools, ['prismflow_sources'])
})

test('Skill CRUD is version/SHA bound, rollback creates history, and personal deletion is direct', async () => {
  const store = await fixture()
  const created = await store.createSkill({ skillId: 'prismflow-custom-review', name: 'Review', description: 'Review drafts', whenToUse: '', content: '# Review', enabled: true })
  assert.equal(created.origin, 'personal-custom'); assert.equal(created.removable, true)
  const orderedOrigins = store.listSkills().map(skill => skill.origin)
  assert.equal(orderedOrigins.join(','), 'system-default,system-default,personal-custom')
  await assert.rejects(store.updateSkill({ skillId: created.skillId, name: 'X', description: 'X', whenToUse: '', content: 'X', enabled: true, expected: { version: 1, sha256: '0'.repeat(64) } }), PrismToolsetConflictError)
  const updated = await store.updateSkill({ skillId: created.skillId, name: 'Review 2', description: 'Review drafts', whenToUse: 'When asked', content: '# Review 2', enabled: false, expected: { version: created.version, sha256: created.sha256 } })
  const rolled = await store.rollbackSkill({ skillId: created.skillId, targetVersion: 1, expected: { version: updated.version, sha256: updated.sha256 } })
  assert.equal(rolled.version, 3); assert.equal(rolled.name, 'Review'); assert.equal(store.history(created.skillId).length, 3)
  const disabled = await store.updateSkill({ skillId: rolled.skillId, name: rolled.name, description: rolled.description, whenToUse: rolled.whenToUse, content: rolled.content, enabled: false, expected: { version: rolled.version, sha256: rolled.sha256 } })
  const deleted = await store.deleteSkill({ skillId: disabled.skillId, expected: { version: disabled.version, sha256: disabled.sha256 } })
  assert.equal(deleted.lifecycle, 'deleted'); assert.equal(store.listSkills().some(row => row.skillId === deleted.skillId), false)
  await assert.rejects(store.createSkill({ skillId: deleted.skillId, name: 'Again', description: 'Again', whenToUse: '', content: 'Again', enabled: true }), PrismToolsetConflictError)
})

test('deleting an enabled personal Skill removes its materialized Bundle while retaining the SQLite tombstone', async t => {
  const root = await mkdtemp(join(tmpdir(), 'prismflow-personal-skill-delete-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = await fixture(); store.skillRoot = join(root, 'skills')
  const created = await store.createSkill({ skillId: 'prismflow-removable', name: 'Removable', description: 'Delete me', whenToUse: '', content: '# Remove', enabled: true })
  const bundle = join(store.skillRoot, created.skillId); await mkdir(bundle, { recursive: true }); await writeFile(join(bundle, 'SKILL.md'), '# Remove')
  const deleted = await store.deleteSkill({ skillId: created.skillId, expected: { version: created.version, sha256: created.sha256 } })
  assert.equal(deleted.lifecycle, 'deleted'); assert.equal(store.history(created.skillId)[0].action, 'delete')
  await assert.rejects(access(bundle), { code: 'ENOENT' })
})

test('optional native personal plugin appears only after its ZIP contents are manually imported', async t => {
  const root = await mkdtemp(join(tmpdir(), 'prismflow-optional-personal-plugin-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = await fixture(); store.pluginRoot = join(root, 'plugins', 'prismflow-personal'); await mkdir(store.pluginRoot, { recursive: true })
  assert.equal(store.listPlugins().some(plugin => plugin.origin === 'personal'), false)
  const source = join(import.meta.dirname, '..', 'manual-import-src', 'plugins', 'prismflow-personal-rss')
  const installed = await store.installPersonalPlugin([
    { path: 'prismflow-plugin.json', data: await readFile(join(source, 'prismflow-plugin.json')) },
    { path: 'index.mjs', data: await readFile(join(source, 'index.mjs')) },
  ])
  assert.equal(installed.pluginId, 'prismflow-personal-rss'); assert.equal(installed.uploaded, false); assert.equal(installed.bundled, false)
  await store.bootstrap()
  assert.equal(store.getToolset().enabledPlugins.includes(installed.pluginId), true)
  let nativeDisposed = false; store.trackNativeTool('prismflow_generate_rss_content', () => { nativeDisposed = true })
  const current = store.getToolset()
  const saved = await store.saveToolset({ mode: 'custom', enabledPlugins: current.enabledPlugins.filter(id => id !== installed.pluginId), enabledTools: current.enabledTools.filter(name => name !== 'prismflow_generate_rss_content'), enabledSkills: current.enabledSkills, expected: { version: current.version, sha256: current.sha256 } })
  const removed = await store.deletePersonalPlugin({ pluginId: installed.pluginId, expected: { version: saved.version, sha256: saved.sha256 } })
  assert.equal(removed.bundled, false); assert.equal(nativeDisposed, true); assert.equal(store.listPlugins().some(plugin => plugin.pluginId === installed.pluginId), false)
  await assert.rejects(access(join(store.pluginRoot, installed.pluginId)), { code: 'ENOENT' })
  await assert.rejects(store.deletePersonalPlugin({ pluginId: 'prismflow-system-sources', expected: { version: saved.version, sha256: saved.sha256 } }), /Unknown removable/u)
})

test('executable personal plugin Bundles install in the separate root, activate after restart, and delete with a tombstone', async t => {
  const root = await mkdtemp(join(tmpdir(), 'prismflow-personal-plugin-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = await fixture(); store.pluginRoot = join(root, 'plugins', 'prismflow-personal'); await mkdir(store.pluginRoot, { recursive: true })
  const manifest = { format: 'prismflow-personal-plugin/v1', pluginId: 'prismflow-personal-fixture', name: 'Fixture', description: 'Executable fixture', version: '1.0.0', entry: 'index.mjs', tools: ['prismflow_fixture'] }
  const installed = await store.installPersonalPlugin([
    { path: 'prismflow-plugin.json', data: Buffer.from(JSON.stringify(manifest)) },
    { path: 'index.mjs', data: Buffer.from("export default api => { api.registerTool({ name: 'prismflow_fixture', description: 'fixture', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute() { return 'ok' } }) }") },
  ])
  assert.equal(installed.uploaded, true); assert.equal(store.listPlugins().at(-1).entryPath, undefined)
  await store.bootstrap()
  assert.equal(store.getToolset().enabledPlugins.includes(manifest.pluginId), true)
  const registrations = []; let disposed = false
  store.ctx.tools = { register(definition) { registrations.push(definition.name); return () => { disposed = true } } }
  await store.activatePersonalPlugins(); assert.deepEqual(registrations, ['prismflow_fixture'])
  const current = store.getToolset()
  const saved = await store.saveToolset({ mode: 'custom', enabledPlugins: current.enabledPlugins.filter(id => id !== manifest.pluginId), enabledTools: current.enabledTools.filter(name => name !== 'prismflow_fixture'), enabledSkills: current.enabledSkills, expected: { version: current.version, sha256: current.sha256 } })
  const deleted = await store.deletePersonalPlugin({ pluginId: manifest.pluginId, expected: { version: saved.version, sha256: saved.sha256 } })
  assert.equal(disposed, true); assert.equal(deleted.pluginId, manifest.pluginId)
  assert.equal(store.listPlugins().some(plugin => plugin.pluginId === manifest.pluginId), false)
  assert.equal(store.table.get(`@plugin-tombstone:${manifest.pluginId}`).manifestSha256.length, 64)
  await assert.rejects(access(join(store.pluginRoot, manifest.pluginId)), { code: 'ENOENT' })
})

test('custom toolset gates PrismFlow tool registration while Skill provider refreshes enabled selections', async () => {
  const store = await fixture(); const current = store.getToolset()
  await store.saveToolset({ mode: 'custom', enabledTools: ['prismflow_sources'], enabledSkills: ['prismflow-source-ingestion'], expected: { version: current.version, sha256: current.sha256 } })
  const registered = []
  const ctx = { get: key => key === 'prismToolsets' ? store : undefined, tools: { register(definition) { registered.push(definition.name); return () => {} } } }
  registerPrismFlowTool(ctx, { name: 'prismflow_sources' }); registerPrismFlowTool(ctx, { name: 'prismflow_sync_source' })
  assert.deepEqual(registered, ['prismflow_sources'])
  let provider
  const skillRegistry = { registerProvider(factory) { provider = factory({ signal: new AbortController().signal, invalidate() {} }); return () => {} } }
  const skillCtx = { get: key => key === 'prismToolsets' ? store : key === 'skills' ? skillRegistry : undefined, effect() {} }
  applySkillProvider(skillCtx, { skillRoot: 'Z:/definitely-missing-prismflow-skills' })
  const catalog = await provider.list({})
  assert.deepEqual(catalog.map(skill => skill.name), ['prismflow-source-ingestion'])
})
