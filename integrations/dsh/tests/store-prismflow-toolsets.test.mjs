import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PRISMFLOW_CORE_TOOL_NAMES, PRISMFLOW_PERSONAL_CUSTOM_TOOL_NAMES, PRISMFLOW_TOOL_NAMES, PrismToolsetConflictError, PrismToolsetStore, prismFlowToolOrigin, registerPrismFlowTool } from '../lib/store-prismflow-toolsets.js'
import { apply as applySkillProvider } from '../lib/prismflow-skill-provider.js'

class Table {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { this.map.set(key, structuredClone(value)); return value }
}
async function fixture() { const store = new PrismToolsetStore(new Context(), { writerLockPath: 'fixture', skillRoot: 'fixture' }); store.table = new Table(); store.releaseWriterLock = async () => {}; store.materializeSkill = async () => {}; await store.bootstrap(); return store }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex') }

test('Chat tool origins distinguish the five deployment-specific tools from system defaults', () => {
  assert.deepEqual(PRISMFLOW_PERSONAL_CUSTOM_TOOL_NAMES, [
    'prismflow_process_markdown_media',
    'prismflow_trigger_insight_daily_build',
    'prismflow_image_generation',
    'prismflow_generate_rss_content',
    'prismflow_github_push',
  ])
  assert.equal(prismFlowToolOrigin('prismflow_image_generation'), 'personal-custom')
  assert.equal(prismFlowToolOrigin('prismflow_sources'), 'system-default')
  assert.equal(PRISMFLOW_CORE_TOOL_NAMES.length, 18)
  assert.equal(PRISMFLOW_CORE_TOOL_NAMES.every(name => prismFlowToolOrigin(name) === 'system-default'), true)
})

test('toolset bootstraps four editable PrismFlow Skills and the exact 23-tool complete mode', async () => {
  const store = await fixture(); const toolset = store.getToolset()
  const skills = store.listSkills()
  assert.equal(skills.length, 4); assert.equal(skills.every(skill => skill.origin === 'system-default'), true)
  assert.deepEqual(toolset.enabledTools, [...PRISMFLOW_TOOL_NAMES].sort())
  assert.equal(toolset.enabledSkills.length, 4); assert.equal(toolset.version, 1)
})

test('core preset checks every system-default tool and Skill while excluding personal customization', async () => {
  const store = await fixture()
  const personal = await store.createSkill({ skillId: 'prismflow-personal-core-test', name: 'Personal', description: 'Personal Skill', whenToUse: '', content: '# Personal', enabled: true })
  const current = store.getToolset()
  const saved = await store.saveToolset({ mode: 'core', enabledTools: [...PRISMFLOW_TOOL_NAMES], enabledSkills: [personal.skillId], expected: { version: current.version, sha256: current.sha256 } })
  assert.deepEqual(saved.enabledTools, [...PRISMFLOW_CORE_TOOL_NAMES].sort())
  assert.equal(saved.enabledTools.every(name => prismFlowToolOrigin(name) === 'system-default'), true)
  assert.deepEqual(saved.enabledSkills, ['prismflow-ai-selection', 'prismflow-daily-production', 'prismflow-draft-revision', 'prismflow-source-ingestion'])
})

test('editing a bundled Skill marks its current configuration as personal customization', async () => {
  const store = await fixture(); const current = store.getSkill('prismflow-source-ingestion')
  const updated = await store.updateSkill({ skillId: current.skillId, name: current.name, description: `${current.description} Personal`, whenToUse: current.whenToUse, content: current.content, enabled: current.enabled, expected: { version: current.version, sha256: current.sha256 } })
  assert.equal(updated.origin, 'personal-custom')
  assert.equal(store.getSkill(current.skillId).origin, 'personal-custom')
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
  const enabledTools = current.enabledTools.map(name => inverse.get(name) ?? name).sort()
  const snapshot = { mode: 'complete', enabledTools, enabledSkills: current.enabledSkills, version: 7 }
  await store.table.put('@toolset:active', { ...snapshot, sha256: digest(snapshot), updatedAt: '2026-01-01T00:00:00.000Z' })
  await store.bootstrap()
  const migrated = store.getToolset()
  assert.equal(migrated.version, 8)
  assert.deepEqual(migrated.enabledTools, [...PRISMFLOW_TOOL_NAMES].sort())
  assert.equal(migrated.enabledTools.every(name => name.startsWith('prismflow_')), true)
})

test('Skill CRUD is version/SHA bound, rollback creates history, and deletion requires disabled state', async () => {
  const store = await fixture()
  const created = await store.createSkill({ skillId: 'prismflow-custom-review', name: 'Review', description: 'Review drafts', whenToUse: '', content: '# Review', enabled: true })
  assert.equal(created.origin, 'personal-custom')
  const orderedOrigins = store.listSkills().map(skill => skill.origin)
  assert.equal(orderedOrigins.join(','), 'system-default,system-default,system-default,system-default,personal-custom')
  await assert.rejects(store.updateSkill({ skillId: created.skillId, name: 'X', description: 'X', whenToUse: '', content: 'X', enabled: true, expected: { version: 1, sha256: '0'.repeat(64) } }), PrismToolsetConflictError)
  const updated = await store.updateSkill({ skillId: created.skillId, name: 'Review 2', description: 'Review drafts', whenToUse: 'When asked', content: '# Review 2', enabled: false, expected: { version: created.version, sha256: created.sha256 } })
  const rolled = await store.rollbackSkill({ skillId: created.skillId, targetVersion: 1, expected: { version: updated.version, sha256: updated.sha256 } })
  assert.equal(rolled.version, 3); assert.equal(rolled.name, 'Review'); assert.equal(store.history(created.skillId).length, 3)
  const disabled = await store.updateSkill({ skillId: rolled.skillId, name: rolled.name, description: rolled.description, whenToUse: rolled.whenToUse, content: rolled.content, enabled: false, expected: { version: rolled.version, sha256: rolled.sha256 } })
  const deleted = await store.deleteSkill({ skillId: disabled.skillId, expected: { version: disabled.version, sha256: disabled.sha256 } })
  assert.equal(deleted.lifecycle, 'deleted'); assert.equal(store.listSkills().some(row => row.skillId === deleted.skillId), false)
  await assert.rejects(store.createSkill({ skillId: deleted.skillId, name: 'Again', description: 'Again', whenToUse: '', content: 'Again', enabled: true }), PrismToolsetConflictError)
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
