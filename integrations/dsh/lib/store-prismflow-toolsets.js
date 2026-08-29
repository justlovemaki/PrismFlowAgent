import { createHash } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { acquireWriterLease } from './writer-lease-lock.js'

export const name = 'prismflow-store-toolsets'
export const inject = ['storageDomain']
export const PRISMFLOW_TOOL_NAMES = Object.freeze([
  'prismflow_sources', 'prismflow_sync_source', 'prismflow_create_ai_selection',
  'prismflow_create_ai_selection_from_explicit_source', 'prismflow_generators',
  'prismflow_create_generation_request_from_ai_selection',
  'prismflow_create_generation_request_from_explicit_content_ids', 'prismflow_generation_request',
  'prismflow_generate_draft', 'prismflow_drafts', 'prismflow_edit_draft',
  'prismflow_process_markdown_media', 'prismflow_trigger_insight_daily_build', 'prismflow_image_generation', 'prismflow_generate_rss_content', 'prismflow_github_push',
  'prismflow_publishers', 'prismflow_publish',
  'prismflow_ingest_production_image', 'prismflow_create_approved_draft_image_revision', 'prismflow_set_draft_presentation',
  'prismflow_create_draft_image_revision',
  'prismflow_get_production_image_claim',
])
export const PRISMFLOW_PERSONAL_CUSTOM_TOOL_NAMES = Object.freeze([
  'prismflow_process_markdown_media',
  'prismflow_trigger_insight_daily_build',
  'prismflow_image_generation',
  'prismflow_generate_rss_content',
  'prismflow_github_push',
])
const PERSONAL_CUSTOM_TOOL_NAMES = new Set(PRISMFLOW_PERSONAL_CUSTOM_TOOL_NAMES)
export function prismFlowToolOrigin(name) { return PERSONAL_CUSTOM_TOOL_NAMES.has(name) ? 'personal-custom' : 'system-default' }
export const PRISMFLOW_CORE_TOOL_NAMES = Object.freeze(PRISMFLOW_TOOL_NAMES.filter(name => prismFlowToolOrigin(name) === 'system-default'))
const CORE_TOOLS = PRISMFLOW_CORE_TOOL_NAMES
const LEGACY_TOOL_NAMES = Object.freeze({
  process_markdown_media: 'prismflow_process_markdown_media',
  trigger_insight_daily_build: 'prismflow_trigger_insight_daily_build',
  image_generation: 'prismflow_image_generation',
  generate_rss_content: 'prismflow_generate_rss_content',
  github_push: 'prismflow_github_push',
})
const LEGACY_PRISMFLOW_TOOL_NAMES = Object.freeze(PRISMFLOW_TOOL_NAMES.map(name => Object.entries(LEGACY_TOOL_NAMES).find(([, current]) => current === name)?.[0] ?? name))
const STORED_TOOL_NAMES = new Set([...PRISMFLOW_TOOL_NAMES, ...Object.keys(LEGACY_TOOL_NAMES)])
const SKILL_ID = /^prismflow-[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SHA = /^[a-f0-9]{64}$/u
const HISTORY_LIMIT = 50
const TABLE = 'records'
const TOOLSET_KEY = '@toolset:active'
const TOOLSET_HISTORY_PREFIX = '@toolset-history:'
const BUILTIN_SKILLS = Object.freeze([
  { skillId: 'prismflow-source-ingestion', name: 'PrismFlow 来源同步', description: '发现已配置来源并将指定来源同步到 PrismFlow Content Store。', whenToUse: '需要刷新或补充 PrismFlow 原始材料时使用。', content: '# PrismFlow 来源同步\n\n先调用 `prismflow_sources` 获取配置 ID，再逐个调用 `prismflow_sync_source`。不得编造来源 ID，不得把抓取结果当作已生成稿件。' },
  { skillId: 'prismflow-ai-selection', name: 'PrismFlow AI Selection', description: '使用全来源不可变 Selection 冻结生成材料。', whenToUse: '用户要求从近期材料选择、排序并准备生成时使用。', content: '# PrismFlow AI Selection\n\n默认调用 `prismflow_create_ai_selection`，不得自行缩小为单一来源。只有用户明确指定来源并确认时，才使用受限单来源入口。Selection ID 必须原样传给 Generation Request。' },
  { skillId: 'prismflow-daily-production', name: 'PrismFlow 内容生成', description: '按 Selection → Generation Request → Draft 的可信链路生成内容。', whenToUse: '用户要求基于 PrismFlow 材料生成日报、简报或其他稿件时使用。', content: '# PrismFlow 内容生成\n\n依次发现生成器、从 Selection 创建 Generation Request，再调用 `prismflow_generate_draft`。不得绕过持久化 Selection，不得在 Chat 中审批、删除或发布。' },
  { skillId: 'prismflow-draft-revision', name: 'PrismFlow 草稿修订', description: '按版本和 SHA-256 修订未审批 Draft，或从已审批 Draft 派生图片修订稿。', whenToUse: '用户要求查看、修改草稿，或为已审批稿补充图片时使用。', content: '# PrismFlow 草稿修订\n\n未审批正文使用 `prismflow_edit_draft` inspect/save。为已审批或已发布稿补图时，先通过 `prismflow_image_generation`、`prismflow_ingest_production_image`，或针对已有 assetId 调用 `prismflow_get_production_image_claim` 获得完整 Claim，再调用 `prismflow_create_draft_image_revision`；它只创建新的未审批派生 Draft，不得改变源 Draft。`prismflow_set_draft_presentation` 只用于 draft/rejected；approved/published 必须派生。未审批图片稿正文保存必须保留 Media Claim 和 Presentation，并重新计算 Artifact Binding。所有保存和派生都必须带当前版本与 SHA-256，并在 Dashboard 重新审批。Chat 不得审批或删除。' },
])
const BUILTIN_SKILL_IDS = new Set(BUILTIN_SKILLS.map(skill => skill.skillId))

export const prismToolsetsDomain = defineDomain({ name: 'prismflow_toolsets', version: 1, tables: { [TABLE]: domainTable(z.unknown()) } })
export const Config = Schema.object({ writerLockPath: Schema.string().default(''), skillRoot: Schema.string().default('') })

export class PrismToolsetValidationError extends Error { constructor(message) { super(message); this.name = 'PrismToolsetValidationError' } }
export class PrismToolsetConflictError extends Error { constructor(message) { super(message); this.name = 'PrismToolsetConflictError' } }
export class PrismToolsetDeletedError extends Error { constructor(message = 'PrismFlow Skill is permanently deleted') { super(message); this.name = 'PrismToolsetDeletedError' } }

function invalid(message) { throw new PrismToolsetValidationError(message) }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex') }
function text(value, field, max, required = true) {
  if (typeof value !== 'string' || value.length > max || /\u0000/u.test(value)) invalid(`${field} is invalid`)
  const result = value.trim()
  if (required && !result) invalid(`${field} is required`)
  return result
}
function exact(value, fields) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)) }
function expected(value) {
  if (!exact(value, ['version', 'sha256']) || !Number.isInteger(value.version) || value.version < 1 || !SHA.test(value.sha256 ?? '')) invalid('expected version/SHA-256 is invalid')
  return value
}
function skillSnapshot(input) {
  if (!exact(input, ['skillId', 'name', 'description', 'whenToUse', 'content', 'enabled'])) invalid('Skill fields are invalid')
  const skillId = text(input.skillId, 'skillId', 64)
  if (!SKILL_ID.test(skillId)) invalid('skillId must be prismflow-* kebab-case')
  if (typeof input.enabled !== 'boolean') invalid('enabled is invalid')
  return { skillId, name: text(input.name, 'name', 128), description: text(input.description, 'description', 500), whenToUse: text(input.whenToUse, 'whenToUse', 1000, false), content: text(input.content, 'content', 32000), enabled: input.enabled }
}
function skillKey(id, version) { return `skill:${id}:${String(((version - 1) % HISTORY_LIMIT) + 1).padStart(2, '0')}` }
function validSkillRow(row) {
  try {
    if (!exact(row, ['skillId', 'name', 'description', 'whenToUse', 'content', 'enabled', 'version', 'sha256', 'updatedAt', 'action', 'sourceVersion'])
      || !Number.isInteger(row.version) || row.version < 1 || !SHA.test(row.sha256 ?? '')
      || !['bootstrap', 'create', 'update', 'rollback', 'delete'].includes(row.action)
      || !Number.isInteger(row.sourceVersion) || row.sourceVersion < 0 || row.sourceVersion > row.version) return false
    const snapshot = skillSnapshot({ skillId: row.skillId, name: row.name, description: row.description, whenToUse: row.whenToUse, content: row.content, enabled: row.enabled })
    return digest({ ...snapshot, version: row.version }) === row.sha256
  } catch { return false }
}
function toolsetHistoryKey(version) { return `${TOOLSET_HISTORY_PREFIX}${String(((version - 1) % HISTORY_LIMIT) + 1).padStart(2, '0')}` }
function skillRow(snapshot, version, action, sourceVersion) {
  const hashInput = { ...snapshot, version }
  return { ...hashInput, sha256: digest(hashInput), updatedAt: new Date().toISOString(), action, sourceVersion }
}
function projectSkill(row) {
  const origin = BUILTIN_SKILL_IDS.has(row.skillId) && row.version === 1 && row.action === 'bootstrap' ? 'system-default' : 'personal-custom'
  return { ...structuredClone(row), lifecycle: row.action === 'delete' ? 'deleted' : row.enabled ? 'active' : 'disabled', origin }
}
function sortedUnique(values, allowed, field) {
  if (!Array.isArray(values) || values.length > allowed.size || values.some(value => typeof value !== 'string' || !allowed.has(value))) invalid(`${field} is invalid`)
  if (new Set(values).size !== values.length) invalid(`${field} contains duplicates`)
  return [...values].sort()
}

export class PrismToolsetStore extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismToolsets')
    this.writerLockPath = config.writerLockPath ?? ''
    this.skillRoot = config.skillRoot ?? ''
    this.releaseWriterLock = undefined
    this.domain = undefined
    this.table = undefined
    this.tail = Promise.resolve()
    this.listeners = new Set()
  }
  async [Service.init]() {
    if (!this.writerLockPath || !this.skillRoot) throw new PrismToolsetValidationError('PrismFlow Toolset writes require writerLockPath and skillRoot')
    try {
      this.releaseWriterLock = await acquireWriterLease(this.writerLockPath)
      this.domain = await this.ctx.storageDomain.open(prismToolsetsDomain)
      this.table = this.domain.table(TABLE)
      await this.bootstrap()
      this.ctx.effect(() => async () => {
        await this.tail.catch(() => {})
        const domain = this.domain; const release = this.releaseWriterLock
        this.table = undefined; this.domain = undefined; this.releaseWriterLock = undefined
        const results = await Promise.allSettled([domain?.close(), release?.()])
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'PrismFlow Toolset close failed')
      }, 'prismflow-toolsets.close')
    } catch (error) {
      this.table = undefined
      await this.domain?.close().catch(() => {}); this.domain = undefined
      await this.releaseWriterLock?.().catch(() => {}); this.releaseWriterLock = undefined
      throw error
    }
  }
  requireTable() { if (!this.table) throw new Error('PrismFlow Toolset Store is not initialized'); return this.table }
  mutate(work) { const run = this.tail.catch(() => {}).then(work); this.tail = run.catch(() => {}); return run }
  notify() { for (const listener of this.listeners) { try { listener() } catch {} } }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  skillRows(skillId) {
    const rows = []
    for (const [key, row] of this.requireTable().entries()) if (String(key).startsWith(`skill:${skillId}:`)) {
      if (!validSkillRow(row) || row.skillId !== skillId || key !== skillKey(skillId, row.version)) throw new Error(`PrismFlow Skill history is corrupt: ${skillId}`)
      rows.push(row)
    }
    return rows.sort((a, b) => a.version - b.version)
  }
  skillIds() {
    const ids = new Set()
    for (const [key, row] of this.requireTable().entries()) if (String(key).startsWith('skill:')) {
      if (!validSkillRow(row) || key !== skillKey(row.skillId, row.version)) throw new Error('PrismFlow Skill history is corrupt')
      ids.add(row.skillId)
    }
    return [...ids].sort()
  }
  currentSkill(skillId) { return this.skillRows(skillId).at(-1) }
  async putSkill(row) { await this.requireTable().put(skillKey(row.skillId, row.version), row) }
  async materializeSkill(row) {
    const directory = join(this.skillRoot, row.skillId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const frontmatter = ['---', `name: ${row.skillId}`, `description: ${JSON.stringify(row.description)}`, 'license: GPL-3.0-only', 'compatibility: Requires @prismflow/dsh', 'metadata:', '  owner: prismflow', `  version: ${JSON.stringify(String(row.version))}`, `  sha256: ${JSON.stringify(row.sha256)}`, ...(row.enabled ? [] : ['disable-model-invocation: true']), '---', '', row.content, ''].join('\n')
    const temporary = join(directory, `.SKILL.md.${process.pid}.${Date.now()}.tmp`)
    await writeFile(temporary, frontmatter, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, join(directory, 'SKILL.md'))
  }
  async bootstrap() {
    if (!this.skillIds().length) for (const skill of BUILTIN_SKILLS) await this.putSkill(skillRow({ ...skill, enabled: true }, 1, 'bootstrap', 0))
    if (!this.requireTable().get(TOOLSET_KEY)) {
      const skills = this.skillIds().filter(id => this.currentSkill(id)?.enabled)
      const snapshot = { enabledTools: [...PRISMFLOW_TOOL_NAMES].sort(), enabledSkills: skills.sort(), mode: 'complete', version: 1 }
      const row = { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() }
      await this.requireTable().put(TOOLSET_KEY, row); await this.requireTable().put(toolsetHistoryKey(1), row)
    } else {
      const current = this.getToolset()
      const renamedTools = [...new Set(current.enabledTools.map(tool => LEGACY_TOOL_NAMES[tool] ?? tool))].sort()
      const expectedComplete = [...PRISMFLOW_TOOL_NAMES].sort()
      const hasLegacyNames = current.enabledTools.some(tool => LEGACY_TOOL_NAMES[tool] !== undefined)
      let nextTools
      if (current.mode === 'complete' && JSON.stringify(current.enabledTools) !== JSON.stringify(expectedComplete)) {
        const supportedPrevious = [11, 16, 18, 21, 22].flatMap(length => [
          JSON.stringify([...PRISMFLOW_TOOL_NAMES.slice(0, length)].sort()),
          JSON.stringify([...LEGACY_PRISMFLOW_TOOL_NAMES.slice(0, length)].sort()),
        ])
        if (JSON.stringify(renamedTools) !== JSON.stringify(expectedComplete)
          && !supportedPrevious.includes(JSON.stringify(current.enabledTools))) {
          throw new Error('Complete PrismFlow Toolset does not match a supported schema revision')
        }
        nextTools = expectedComplete
      } else if (hasLegacyNames) {
        if (renamedTools.some(tool => !PRISMFLOW_TOOL_NAMES.includes(tool))) throw new Error('PrismFlow Toolset contains an unsupported legacy tool')
        nextTools = renamedTools
      }
      if (nextTools) {
        const snapshot = { mode: current.mode, enabledTools: nextTools, enabledSkills: current.enabledSkills, version: current.version + 1 }
        const row = { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() }
        await this.requireTable().put(TOOLSET_KEY, row); await this.requireTable().put(toolsetHistoryKey(row.version), row)
      }
    }
  }
  listSkills({ includeDeleted = false } = {}) {
    return this.skillIds().map(id => this.currentSkill(id)).filter(row => row && (includeDeleted || row.action !== 'delete')).map(projectSkill)
      .sort((left, right) => {
        const originOrder = Number(left.origin !== 'system-default') - Number(right.origin !== 'system-default')
        if (originOrder) return originOrder
        return left.skillId < right.skillId ? -1 : left.skillId > right.skillId ? 1 : 0
      })
  }
  getSkill(skillId) { const row = this.currentSkill(skillId); if (!row || row.action === 'delete') invalid('Unknown PrismFlow Skill'); return projectSkill(row) }
  history(skillId) { return this.skillRows(skillId).toReversed().map(projectSkill) }
  createSkill(input) { return this.mutate(async () => { const snapshot = skillSnapshot(input); if (this.currentSkill(snapshot.skillId)) throw new PrismToolsetConflictError('Skill ID is already or permanently reserved'); const row = skillRow(snapshot, 1, 'create', 0); await this.putSkill(row); await this.materializeSkill(row); this.notify(); return projectSkill(row) }) }
  importSkillBundle(input, files) { return this.mutate(async () => {
    const snapshot = skillSnapshot(input)
    if (this.currentSkill(snapshot.skillId)) throw new PrismToolsetConflictError('Skill ID is already or permanently reserved')
    if (!Array.isArray(files) || files.length < 1 || files.length > 32) invalid('Skill Bundle files are invalid')
    const seen = new Set(); let total = 0
    for (const file of files) {
      if (!file || typeof file.path !== 'string' || !Buffer.isBuffer(file.data) || file.path.length > 240 || file.path.startsWith('/') || file.path.includes('\\')) invalid('Skill Bundle path is invalid')
      const parts = file.path.split('/'); if (parts.some(part => !part || part === '.' || part === '..')) invalid('Skill Bundle path is invalid')
      const folded = file.path.toLowerCase(); if (seen.has(folded)) invalid('Skill Bundle contains duplicate paths'); seen.add(folded)
      total += file.data.length; if (file.data.length > 64 * 1024 || total > 128 * 1024) invalid('Skill Bundle is too large')
    }
    if (!seen.has('skill.md')) invalid('Skill Bundle must contain SKILL.md')
    const row = skillRow(snapshot, 1, 'create', 0)
    await mkdir(this.skillRoot, { recursive: true, mode: 0o700 })
    const target = join(this.skillRoot, row.skillId); const stage = join(this.skillRoot, `.${row.skillId}.${process.pid}.${Date.now()}.tmp`)
    try {
      await mkdir(stage, { mode: 0o700 })
      for (const file of files) { const output = join(stage, ...file.path.split('/')); await mkdir(dirname(output), { recursive: true, mode: 0o700 }); await writeFile(output, file.data, { mode: 0o600 }) }
      await rename(stage, target)
      try { await this.putSkill(row) } catch (error) { await rm(target, { recursive: true, force: true }); throw error }
    } catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
    this.notify(); return projectSkill(row)
  }) }
  updateSkill(input) { return this.mutate(async () => {
    if (!exact(input, ['skillId', 'name', 'description', 'whenToUse', 'content', 'enabled', 'expected'])) invalid('Skill update fields are invalid')
    const current = this.currentSkill(input.skillId); if (!current) invalid('Unknown PrismFlow Skill'); if (current.action === 'delete') throw new PrismToolsetDeletedError()
    const ref = expected(input.expected); if (ref.version !== current.version || ref.sha256 !== current.sha256) throw new PrismToolsetConflictError('Skill version conflict')
    const snapshot = skillSnapshot({ skillId: input.skillId, name: input.name, description: input.description, whenToUse: input.whenToUse, content: input.content, enabled: input.enabled })
    const row = skillRow(snapshot, current.version + 1, 'update', current.version); await this.putSkill(row); await this.materializeSkill(row); this.notify(); return projectSkill(row)
  }) }
  rollbackSkill(input) { return this.mutate(async () => {
    if (!exact(input, ['skillId', 'targetVersion', 'expected'])) invalid('Skill rollback fields are invalid')
    const current = this.currentSkill(input.skillId); if (!current || current.action === 'delete') throw new PrismToolsetDeletedError(); const ref = expected(input.expected)
    if (ref.version !== current.version || ref.sha256 !== current.sha256) throw new PrismToolsetConflictError('Skill version conflict')
    const target = this.skillRows(input.skillId).find(row => row.version === input.targetVersion && row.action !== 'delete'); if (!target || target.version >= current.version) invalid('Rollback target is invalid')
    const row = skillRow(skillSnapshot({ skillId: target.skillId, name: target.name, description: target.description, whenToUse: target.whenToUse, content: target.content, enabled: target.enabled }), current.version + 1, 'rollback', target.version)
    await this.putSkill(row); await this.materializeSkill(row); this.notify(); return projectSkill(row)
  }) }
  deleteSkill(input) { return this.mutate(async () => {
    if (!exact(input, ['skillId', 'expected'])) invalid('Skill delete fields are invalid'); const current = this.currentSkill(input.skillId); const ref = expected(input.expected)
    if (!current) invalid('Unknown PrismFlow Skill'); if (current.action === 'delete') return projectSkill(current)
    if (BUILTIN_SKILL_IDS.has(input.skillId)) throw new PrismToolsetConflictError('Bundled PrismFlow Skills always exist and cannot be deleted')
    if (ref.version !== current.version || ref.sha256 !== current.sha256) throw new PrismToolsetConflictError('Skill version conflict')
    if (current.enabled) throw new PrismToolsetConflictError('Disable the Skill before deletion')
    const row = skillRow(skillSnapshot({ skillId: current.skillId, name: current.name, description: current.description, whenToUse: current.whenToUse, content: current.content, enabled: false }), current.version + 1, 'delete', current.version)
    await this.putSkill(row); await this.materializeSkill(row); this.notify(); return projectSkill(row)
  }) }
  getToolset() {
    const row = this.requireTable().get(TOOLSET_KEY)
    if (!row || !exact(row, ['mode', 'enabledTools', 'enabledSkills', 'version', 'sha256', 'updatedAt']) || !['core', 'complete', 'custom'].includes(row.mode)
      || !Number.isInteger(row.version) || row.version < 1 || !SHA.test(row.sha256 ?? '')
      || digest({ mode: row.mode, enabledTools: row.enabledTools, enabledSkills: row.enabledSkills, version: row.version }) !== row.sha256) throw new Error('PrismFlow Toolset is missing or corrupt')
    sortedUnique(row.enabledTools, STORED_TOOL_NAMES, 'enabledTools')
    if (!Array.isArray(row.enabledSkills) || row.enabledSkills.length > 256 || new Set(row.enabledSkills).size !== row.enabledSkills.length || row.enabledSkills.some(id => !SKILL_ID.test(id))) throw new Error('PrismFlow Toolset is corrupt')
    return structuredClone(row)
  }
  isToolEnabled(name) { return this.getToolset().enabledTools.includes(name) }
  activeSkills() { const selected = new Set(this.getToolset().enabledSkills); return this.listSkills().filter(skill => skill.enabled && selected.has(skill.skillId)) }
  saveToolset(input) { return this.mutate(async () => {
    if (!exact(input, ['mode', 'enabledTools', 'enabledSkills', 'expected'])) invalid('Toolset fields are invalid')
    const current = this.getToolset(); const ref = expected(input.expected); if (ref.version !== current.version || ref.sha256 !== current.sha256) throw new PrismToolsetConflictError('Toolset version conflict')
    if (!['core', 'complete', 'custom'].includes(input.mode)) invalid('mode is invalid')
    const requestedTools = sortedUnique(input.enabledTools, new Set(PRISMFLOW_TOOL_NAMES), 'enabledTools')
    const enabledTools = input.mode === 'core' ? [...CORE_TOOLS].sort() : input.mode === 'complete' ? [...PRISMFLOW_TOOL_NAMES].sort() : requestedTools
    const skills = this.listSkills()
    const availableSkills = new Set(skills.map(skill => skill.skillId))
    const requestedSkills = sortedUnique(input.enabledSkills, availableSkills, 'enabledSkills')
    const enabledSkills = input.mode === 'core'
      ? skills.filter(skill => skill.enabled && skill.origin === 'system-default').map(skill => skill.skillId).sort()
      : input.mode === 'complete'
        ? skills.filter(skill => skill.enabled).map(skill => skill.skillId).sort()
        : requestedSkills
    const snapshot = { mode: input.mode, enabledTools, enabledSkills, version: current.version + 1 }
    const row = { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() }
    await this.requireTable().put(TOOLSET_KEY, row); await this.requireTable().put(toolsetHistoryKey(row.version), row); this.notify(); return structuredClone(row)
  }) }
}

export function registerPrismFlowTool(ctx, definition) {
  const manager = ctx.get?.('prismToolsets')
  if (manager && !manager.isToolEnabled(definition.name)) return () => {}
  return ctx.tools.register(definition)
}

export default PrismToolsetStore
