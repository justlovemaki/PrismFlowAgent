import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { acquireWriterLease } from './writer-lease-lock.js'

export const name = 'prismflow-store-toolsets'
export const inject = ['storageDomain', 'tools']
export const PRISMFLOW_TOOL_NAMES = Object.freeze([
  'prismflow_sources', 'prismflow_sync_source', 'prismflow_create_ai_selection',
  'prismflow_create_ai_selection_from_explicit_source', 'prismflow_generators',
  'prismflow_create_generation_request_from_ai_selection',
  'prismflow_create_generation_request_from_direct_input',
  'prismflow_create_generation_request_from_explicit_content_ids', 'prismflow_generation_request',
  'prismflow_generate_draft', 'prismflow_drafts', 'prismflow_edit_draft',
  'prismflow_process_markdown_media', 'prismflow_trigger_insight_daily_build', 'prismflow_image_generation', 'prismflow_generate_rss_content', 'prismflow_github_push',
  'prismflow_publishers', 'prismflow_publish',
  'prismflow_ingest_production_image', 'prismflow_create_approved_draft_image_revision', 'prismflow_set_draft_presentation',
  'prismflow_create_draft_image_revision',
  'prismflow_get_production_image_claim',
  'prismflow_inherit_draft_images',
])
export const PRISMFLOW_PLUGIN_MANIFESTS = Object.freeze([
  { pluginId: 'prismflow-system-sources', name: '数据源同步', description: '发现 Profile 中的数据源并将可信材料同步到 Content Store。', origin: 'system', version: 1, configurable: false, tools: ['prismflow_sources', 'prismflow_sync_source'], skills: ['prismflow-source-ingestion'] },
  { pluginId: 'prismflow-personal-selection', name: 'AI Selection', description: '跨全部来源创建不可变 Selection，并保留选择证据与来源配额。', origin: 'personal', version: 1, configurable: false, tools: ['prismflow_create_ai_selection', 'prismflow_create_ai_selection_from_explicit_source'], skills: ['prismflow-ai-selection'] },
  { pluginId: 'prismflow-system-generation', name: '内容生成', description: '发现生成器，创建精确绑定的 Generation Request 并执行多阶段生成。', origin: 'system', version: 1, configurable: false, tools: ['prismflow_generators', 'prismflow_create_generation_request_from_ai_selection', 'prismflow_create_generation_request_from_direct_input', 'prismflow_create_generation_request_from_explicit_content_ids', 'prismflow_generation_request', 'prismflow_generate_draft'], skills: [] },
  { pluginId: 'prismflow-system-drafts', name: '草稿管理', description: '查询、检查并按版本与 SHA-256 修订未审批草稿。', origin: 'system', version: 1, configurable: false, tools: ['prismflow_drafts', 'prismflow_edit_draft'], skills: ['prismflow-draft-revision'] },
  { pluginId: 'prismflow-system-publication', name: '受控发布', description: '发现 Profile 发布目标，并发布精确审批的 Artifact。', origin: 'system', version: 1, configurable: false, tools: ['prismflow_publishers', 'prismflow_publish'], skills: [] },
  { pluginId: 'prismflow-system-production-media', name: 'Production Media', description: '持久化图片、验证 Claim，并为草稿创建精确绑定的图片修订。', origin: 'system', version: 1, configurable: false, tools: ['prismflow_ingest_production_image', 'prismflow_create_approved_draft_image_revision', 'prismflow_set_draft_presentation', 'prismflow_create_draft_image_revision', 'prismflow_get_production_image_claim', 'prismflow_inherit_draft_images'], skills: [] },
  { pluginId: 'prismflow-personal-markdown-media', name: 'Markdown 媒体处理', description: '按当前部署的媒体、R2 与 FFmpeg 规则处理 Markdown 媒体。', origin: 'personal', version: 1, configurable: false, tools: ['prismflow_process_markdown_media'], skills: [] },
  { pluginId: 'prismflow-personal-insight-daily', name: 'Insight Daily Build', description: '触发当前部署专属的日报自动化工作流。', origin: 'personal', version: 1, configurable: false, tools: ['prismflow_trigger_insight_daily_build'], skills: [] },
  { pluginId: 'prismflow-personal-image-generation', name: '图片生成', description: '调用 Profile 配置的兼容接口，并将结果持久化为 Production Media。', origin: 'personal', version: 1, configurable: true, tools: ['prismflow_image_generation'], skills: [] },
  { pluginId: 'prismflow-personal-rss', name: 'RSS 生成', description: '生成并持久化完整 RSS XML、HTML 与 provenance。', origin: 'personal', version: 1, configurable: false, tools: ['prismflow_generate_rss_content'], skills: [] },
  { pluginId: 'prismflow-personal-github-push', name: 'GitHub Push', description: '按 Profile 授权将 Markdown 或原始文件推送到 GitHub。', origin: 'personal', version: 1, configurable: false, tools: ['prismflow_github_push'], skills: [] },
].map(manifest => Object.freeze({ ...manifest, tools: Object.freeze([...manifest.tools]), skills: Object.freeze([...manifest.skills]) })))
const PACKAGE_PERSONAL_PLUGIN_MANIFESTS = Object.freeze(PRISMFLOW_PLUGIN_MANIFESTS.filter(plugin => plugin.origin === 'personal').map(plugin => Object.freeze({
  ...plugin, format: 'prismflow-personal-plugin/v1', version: String(plugin.version), entry: 'index.mjs', uploaded: false, bundled: true, removable: true,
})))
const PACKAGE_PERSONAL_BY_ID = new Map(PACKAGE_PERSONAL_PLUGIN_MANIFESTS.map(plugin => [plugin.pluginId, plugin]))
const PLUGIN_BY_TOOL = new Map(PRISMFLOW_PLUGIN_MANIFESTS.flatMap(plugin => plugin.tools.map(tool => [tool, plugin])))
export const PRISMFLOW_SYSTEM_PLUGIN_IDS = Object.freeze(PRISMFLOW_PLUGIN_MANIFESTS.filter(plugin => plugin.origin === 'system').map(plugin => plugin.pluginId))
export const PRISMFLOW_PERSONAL_PLUGIN_IDS = Object.freeze(PRISMFLOW_PLUGIN_MANIFESTS.filter(plugin => plugin.origin === 'personal').map(plugin => plugin.pluginId))
export const PRISMFLOW_PERSONAL_CUSTOM_TOOL_NAMES = Object.freeze(PRISMFLOW_PLUGIN_MANIFESTS.filter(plugin => plugin.origin === 'personal').flatMap(plugin => plugin.tools))
export function prismFlowToolOrigin(name) { return PLUGIN_BY_TOOL.get(name)?.origin === 'personal' ? 'personal-custom' : 'system-default' }
export const PRISMFLOW_CORE_TOOL_NAMES = Object.freeze(PRISMFLOW_PLUGIN_MANIFESTS.filter(plugin => plugin.origin === 'system').flatMap(plugin => plugin.tools))
const CORE_TOOLS = PRISMFLOW_CORE_TOOL_NAMES
const ALL_PLUGIN_IDS = Object.freeze(PRISMFLOW_PLUGIN_MANIFESTS.map(plugin => plugin.pluginId))
const LEGACY_PLUGIN_IDS = Object.freeze({ 'prismflow-system-selection': 'prismflow-personal-selection' })
const MANIFEST_TOOL_NAMES = PRISMFLOW_PLUGIN_MANIFESTS.flatMap(plugin => plugin.tools)
if (new Set(ALL_PLUGIN_IDS).size !== ALL_PLUGIN_IDS.length || new Set(MANIFEST_TOOL_NAMES).size !== MANIFEST_TOOL_NAMES.length
  || JSON.stringify([...MANIFEST_TOOL_NAMES].sort()) !== JSON.stringify([...PRISMFLOW_TOOL_NAMES].sort())) throw new Error('PrismFlow plugin catalog is invalid')
const SYSTEM_PLUGIN_SKILL_IDS = new Set(PRISMFLOW_PLUGIN_MANIFESTS.filter(plugin => plugin.origin === 'system').flatMap(plugin => plugin.skills))
const LEGACY_TOOL_NAMES = Object.freeze({
  process_markdown_media: 'prismflow_process_markdown_media',
  trigger_insight_daily_build: 'prismflow_trigger_insight_daily_build',
  image_generation: 'prismflow_image_generation',
  generate_rss_content: 'prismflow_generate_rss_content',
  github_push: 'prismflow_github_push',
})
const LEGACY_PRISMFLOW_TOOL_NAMES = Object.freeze(PRISMFLOW_TOOL_NAMES.map(name => Object.entries(LEGACY_TOOL_NAMES).find(([, current]) => current === name)?.[0] ?? name))
const SKILL_ID = /^prismflow-[a-z0-9]+(?:-[a-z0-9]+)*$/u
const PERSONAL_PLUGIN_ID = /^prismflow-personal-[a-z0-9]+(?:-[a-z0-9]+)*$/u
const TOOL_NAME = /^prismflow_[a-z0-9]+(?:_[a-z0-9]+)*$/u
const PERSONAL_PLUGIN_FORMAT = 'prismflow-personal-plugin/v1'
const SHA = /^[a-f0-9]{64}$/u
const HISTORY_LIMIT = 50
const TABLE = 'records'
const TOOLSET_KEY = '@toolset:active'
const TOOLSET_HISTORY_PREFIX = '@toolset-history:'
const PROMPT_SUGGESTIONS_KEY = '@prompt-suggestions:active'
const LEGACY_DEFAULT_PROMPT_SUGGESTIONS_SHA256 = 'e6bf93acaac6e4b014db055d71ca44779a7bb35489962cdd019ba6ae5bdd4a1f'
const DEFAULT_PROMPT_SUGGESTIONS = Object.freeze([
  { id: 'sync-all-sources', enabled: true, text: '获取 PrismFlow 已配置的所有数据源数据。' },
  { id: 'select-two-days-and-generate', enabled: true, text: '仅使用 PrismFlow Content Store 中已抓取的最近两天数据，不重新同步任何数据源；执行 AI 筛选并生成 AI 日报。' },
  { id: 'process-latest-draft-media', enabled: true, text: '使用 prismflow_process_markdown_media 处理最新草稿，\n处理完成后替换该草稿。' },
  { id: 'publish-approved-github', enabled: true, text: '我已审批通过草稿，\n请将最新已审批草稿发布到 GitHub。' },
  { id: 'generate-and-push-rss', enabled: true, text: '使用当前草稿生成 RSS，\n然后推送这个 RSS。' },
  { id: 'trigger-insight-build', enabled: true, text: '使用 prismflow_trigger_insight_daily_build\n触发 GitHub 构建。' },
  { id: 'generate-short-daily', enabled: true, text: '根据最新的已发布草稿，\n生成一个短版 AI 日报。' },
  { id: 'generate-short-daily-with-images', enabled: true, text: '根据最新的已发布草稿，选择其中最具媒体传播效果的一个段落，生成主标题和副标题。\n\n使用 prismflow_image_generation 生成一张 2:3 比例的封面图。\n继承原草稿的正文图片，但排除最后两张图片。\n将封面图和剩余正文图片都绑定到短版 AI 日报草稿。' },
])
const BUILTIN_SKILLS = Object.freeze([
  { skillId: 'prismflow-source-ingestion', name: 'PrismFlow 来源同步', description: '仅在用户明确要求时发现并同步来源到 PrismFlow Content Store。', whenToUse: '用户明确要求同步、刷新、重新抓取或获取最新来源时使用；筛选已抓取数据时禁止使用。', content: '# PrismFlow 来源同步\n\n只有用户明确要求同步、刷新、重新抓取或获取最新来源时才执行；“筛选最近两天已抓取数据”不是同步授权。先调用 `prismflow_sources` 获取配置 ID，再逐个调用 `prismflow_sync_source`。不得编造来源 ID，不得把抓取结果当作已生成稿件。' },
  { skillId: 'prismflow-draft-revision', name: 'PrismFlow 草稿修订', description: '按版本和 SHA-256 修订未审批 Draft，或从已审批 Draft 派生图片修订稿。', whenToUse: '用户要求查看、修改草稿，或为已审批稿补充图片时使用。', content: '# PrismFlow 草稿修订\n\n未审批正文使用 `prismflow_edit_draft` inspect/save。当用户要求“继承/复制某 Draft 的封面和其它图片”或“把某 Draft 图片加入微信图片列表”时，必须使用 `prismflow_inherit_draft_images`，由服务端读取源 Presentation 和 Markdown 图片；每张正文图片最多重试三次，任何遗漏都必须整体失败且不得创建部分图片稿；不得只在回复中声称已继承。为已审批或已发布稿补充新图时，先通过 `prismflow_image_generation`、`prismflow_ingest_production_image`，或针对已有 assetId 调用 `prismflow_get_production_image_claim` 获得完整 Claim，再调用 `prismflow_create_draft_image_revision`；它只创建新的未审批派生 Draft，不得改变源 Draft。`prismflow_set_draft_presentation` 只用于 draft/rejected；approved/published 必须派生。未审批图片稿正文保存必须保留 Media Claim 和 Presentation，并重新计算 Artifact Binding。所有保存和派生都必须带当前版本与 SHA-256，并在 Dashboard 重新审批。Chat 不得审批或删除。' },
])
const PROTECTED_BUILTIN_SKILL_IDS = new Set(['prismflow-source-ingestion', 'prismflow-draft-revision'])

export const prismToolsetsDomain = defineDomain({ name: 'prismflow_toolsets', version: 1, tables: { [TABLE]: domainTable(z.unknown()) } })
export const Config = Schema.object({ writerLockPath: Schema.string().default(''), skillRoot: Schema.string().default(''), pluginRoot: Schema.string().default('') })

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
function personalPluginManifest(input) {
  if (!exact(input, ['format', 'pluginId', 'name', 'description', 'version', 'entry', 'tools'])) invalid('Personal plugin Manifest fields are invalid')
  if (input.format !== PERSONAL_PLUGIN_FORMAT) invalid('Personal plugin format is invalid')
  const pluginId = text(input.pluginId, 'pluginId', 96)
  if (!PERSONAL_PLUGIN_ID.test(pluginId)) invalid('Personal pluginId must be prismflow-personal-* kebab-case')
  const entry = text(input.entry, 'entry', 128)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:js|mjs)$/u.test(entry)) invalid('Personal plugin entry must be one root JavaScript file')
  if (!Array.isArray(input.tools) || input.tools.length < 1 || input.tools.length > 16 || new Set(input.tools).size !== input.tools.length
    || input.tools.some(tool => typeof tool !== 'string' || tool.length > 96 || !TOOL_NAME.test(tool))) invalid('Personal plugin tools are invalid')
  const version = text(input.version, 'version', 64)
  return { format: PERSONAL_PLUGIN_FORMAT, pluginId, name: text(input.name, 'name', 128), description: text(input.description, 'description', 500), version,
    entry, tools: [...input.tools].sort(), skills: [], origin: 'personal', configurable: false, uploaded: true, removable: true }
}
function expected(value) {
  if (!exact(value, ['version', 'sha256']) || !Number.isInteger(value.version) || value.version < 1 || !SHA.test(value.sha256 ?? '')) invalid('expected version/SHA-256 is invalid')
  return value
}
function promptSuggestionsSnapshot(input) {
  if (!Array.isArray(input) || input.length > 20) invalid('Prompt suggestions must contain at most 20 items')
  const ids = new Set(); let total = 0
  const items = input.map((item, index) => {
    if (!exact(item, ['id', 'text', 'enabled']) || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(item.id)
      || ids.has(item.id) || typeof item.text !== 'string' || item.text.length < 1 || item.text.length > 4000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(item.text) || typeof item.enabled !== 'boolean') {
      invalid(`Prompt suggestion ${index + 1} is invalid`)
    }
    ids.add(item.id); total += item.text.length
    if (total > 24000) invalid('Prompt suggestions exceed the total text limit')
    return { id: item.id, text: item.text.trim(), enabled: item.enabled }
  })
  if (items.some(item => !item.text)) invalid('Prompt suggestion text is required')
  return items
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
  const protectedBuiltin = PROTECTED_BUILTIN_SKILL_IDS.has(row.skillId)
  const origin = protectedBuiltin ? 'system-default' : 'personal-custom'
  return { ...structuredClone(row), lifecycle: row.action === 'delete' ? 'deleted' : row.enabled ? 'active' : 'disabled', origin, removable: !protectedBuiltin }
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
    this.pluginRoot = config.pluginRoot || (this.skillRoot ? join(dirname(this.skillRoot), 'plugins', 'prismflow-personal') : '')
    this.personalPluginManifests = new Map()
    this.removedBundledPluginIds = new Set()
    this.personalPluginDisposers = new Map()
    this.nativeToolDisposers = new Map()
    this.releaseWriterLock = undefined
    this.domain = undefined
    this.table = undefined
    this.tail = Promise.resolve()
    this.listeners = new Set()
  }
  async [Service.init]() {
    if (!this.writerLockPath || !this.skillRoot || !this.pluginRoot) throw new PrismToolsetValidationError('PrismFlow Toolset writes require writerLockPath, skillRoot, and pluginRoot')
    try {
      this.releaseWriterLock = await acquireWriterLease(this.writerLockPath)
      await mkdir(this.pluginRoot, { recursive: true, mode: 0o700 })
      await mkdir(this.skillRoot, { recursive: true, mode: 0o700 })
      this.domain = await this.ctx.storageDomain.open(prismToolsetsDomain)
      this.table = this.domain.table(TABLE)
      for (const [key, value] of this.table.entries()) if (String(key).startsWith('@plugin-tombstone:') && value?.bundled === true && typeof value.pluginId === 'string') this.removedBundledPluginIds.add(value.pluginId)
      await this.scanPersonalPlugins()
      await this.bootstrap()
      await this.bootstrapPromptSuggestions()
      await this.activatePersonalPlugins()
      this.ctx.effect(() => async () => {
        await this.tail.catch(() => {})
        const domain = this.domain; const release = this.releaseWriterLock
        this.table = undefined; this.domain = undefined; this.releaseWriterLock = undefined
        const disposers = [...this.personalPluginDisposers.values()].flat(); this.personalPluginDisposers.clear()
        const results = await Promise.allSettled([...disposers.map(dispose => Promise.resolve().then(dispose)), domain?.close(), release?.()])
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
  trackNativeTool(name, dispose) {
    if (typeof dispose !== 'function') return dispose
    let active = true
    const tracked = async () => { if (!active) return; active = false; if (this.nativeToolDisposers.get(name) === tracked) this.nativeToolDisposers.delete(name); await dispose() }
    this.nativeToolDisposers.set(name, tracked); return tracked
  }
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
  pluginCatalog() {
    return [...PRISMFLOW_PLUGIN_MANIFESTS.filter(plugin => plugin.origin === 'system').map(plugin => ({ ...plugin, tools: [...plugin.tools], skills: [...plugin.skills], uploaded: false, bundled: true, removable: false })),
      ...[...this.personalPluginManifests.values()].filter(plugin => !plugin.bundled || !this.removedBundledPluginIds.has(plugin.pluginId)).map(plugin => structuredClone(plugin))]
  }
  pluginIds() { return this.pluginCatalog().map(plugin => plugin.pluginId) }
  toolNames() { return this.pluginCatalog().flatMap(plugin => plugin.tools) }
  pluginsForTools(tools) { const selected = new Set(tools); return this.pluginCatalog().filter(plugin => plugin.tools.some(tool => selected.has(tool))).map(plugin => plugin.pluginId).sort() }
  toolsForPlugins(pluginIds) { const selected = new Set(pluginIds); return this.pluginCatalog().filter(plugin => selected.has(plugin.pluginId)).flatMap(plugin => plugin.tools).sort() }
  async readPersonalPluginDirectory(directoryName) {
    if (!PERSONAL_PLUGIN_ID.test(directoryName)) throw new Error(`Unsafe personal plugin directory: ${directoryName}`)
    const directory = join(this.pluginRoot, directoryName)
    const directoryStat = await lstat(directory); if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error(`Personal plugin directory is not a real directory: ${directoryName}`)
    const manifestPath = join(directory, 'prismflow-plugin.json'); const manifestStat = await lstat(manifestPath)
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size < 2 || manifestStat.size > 32 * 1024) throw new Error(`Personal plugin Manifest is invalid: ${directoryName}`)
    let input; try { input = JSON.parse(await readFile(manifestPath, 'utf8')) } catch { throw new Error(`Personal plugin Manifest is invalid JSON: ${directoryName}`) }
    let manifest = personalPluginManifest(input)
    if (manifest.pluginId !== directoryName) throw new Error('Personal plugin directory must match pluginId')
    const packaged = PACKAGE_PERSONAL_BY_ID.get(manifest.pluginId)
    if (packaged) {
      const fields = ['format', 'pluginId', 'name', 'description', 'version', 'entry']
      if (fields.some(field => manifest[field] !== packaged[field]) || JSON.stringify(manifest.tools) !== JSON.stringify([...packaged.tools].sort())) throw new Error(`Bundled personal plugin Manifest differs from its package definition: ${directoryName}`)
      manifest = { ...manifest, skills: [...packaged.skills], configurable: packaged.configurable, uploaded: false, bundled: false, removable: true }
    } else manifest = { ...manifest, bundled: false }
    
    const entryPath = join(directory, manifest.entry); const entryStat = await lstat(entryPath)
    if (!entryStat.isFile() || entryStat.isSymbolicLink() || entryStat.size < 1 || entryStat.size > 256 * 1024) throw new Error(`Personal plugin entry is invalid: ${directoryName}`)
    return { ...manifest, directory, entryPath, entryMtimeMs: entryStat.mtimeMs }
  }
  assertPluginCollision(manifest, ignoredPluginId) {
    const catalog = [...PRISMFLOW_PLUGIN_MANIFESTS.filter(plugin => plugin.origin === 'system').map(plugin => ({ ...plugin, tools: [...plugin.tools] })), ...[...this.personalPluginManifests.values()]].filter(plugin => plugin.pluginId !== ignoredPluginId)
    if (catalog.some(plugin => plugin.pluginId === manifest.pluginId)) throw new PrismToolsetConflictError('Personal plugin ID already exists')
    const claimed = new Set(catalog.flatMap(plugin => plugin.tools))
    if (manifest.tools.some(tool => claimed.has(tool))) throw new PrismToolsetConflictError('Personal plugin tool name already exists')
  }
  async scanPersonalPlugins() {
    const entries = await readdir(this.pluginRoot, { withFileTypes: true }); this.personalPluginManifests.clear()
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Personal plugin root contains an unsupported entry: ${entry.name}`)
      const manifest = await this.readPersonalPluginDirectory(entry.name)
      if (!manifest.bundled) this.assertPluginCollision(manifest)
      else if (this.removedBundledPluginIds.has(manifest.pluginId)) throw new Error(`Deleted bundled personal plugin directory was restored outside the controlled installer: ${manifest.pluginId}`)
      this.personalPluginManifests.set(manifest.pluginId, manifest)
    }
  }
  async activatePersonalPlugins() {
    const enabled = new Set(this.getToolset().enabledPlugins ?? [])
    for (const manifest of this.personalPluginManifests.values()) {
      if (!manifest.uploaded || !enabled.has(manifest.pluginId)) continue
      const disposers = []; const registered = new Set()
      const api = Object.freeze({
        pluginId: manifest.pluginId,
        getService: name => this.ctx.get?.(name),
        registerTool: definition => {
          if (!definition || typeof definition !== 'object' || !manifest.tools.includes(definition.name) || registered.has(definition.name)) throw new Error(`Personal plugin registered an undeclared or duplicate tool: ${manifest.pluginId}`)
          const dispose = this.ctx.tools.register(defineTool(definition)); if (typeof dispose === 'function') disposers.push(dispose); registered.add(definition.name)
        },
      })
      try {
        const module = await import(`${pathToFileURL(manifest.entryPath).href}?v=${encodeURIComponent(String(manifest.entryMtimeMs))}`)
        if (typeof module.default !== 'function') throw new Error('Personal plugin entry must default-export activate(api)')
        const returned = await module.default(api); if (typeof returned === 'function') disposers.push(returned)
        if (registered.size !== manifest.tools.length) throw new Error(`Personal plugin did not register every declared tool: ${manifest.pluginId}`)
        this.personalPluginDisposers.set(manifest.pluginId, disposers)
      } catch (error) {
        await Promise.allSettled(disposers.map(dispose => Promise.resolve().then(dispose)))
        throw new Error(`Failed to activate personal plugin ${manifest.pluginId}: ${error?.message ?? error}`, { cause: error })
      }
    }
  }
  installPersonalPlugin(files) { return this.mutate(async () => {
    if (!Array.isArray(files) || files.length < 2 || files.length > 32) invalid('Personal plugin Bundle files are invalid')
    const seen = new Set(); let total = 0
    for (const file of files) {
      if (!file || typeof file.path !== 'string' || !Buffer.isBuffer(file.data) || file.path.length > 240 || file.path.startsWith('/') || file.path.includes('\\')) invalid('Personal plugin Bundle path is invalid')
      const parts = file.path.split('/'); if (parts.some(part => !part || part === '.' || part === '..') || parts.length > 8) invalid('Personal plugin Bundle path is invalid')
      const folded = file.path.toLowerCase(); if (seen.has(folded)) invalid('Personal plugin Bundle contains duplicate paths'); seen.add(folded)
      total += file.data.length; if (file.data.length > 256 * 1024 || total > 512 * 1024) invalid('Personal plugin Bundle is too large')
    }
    const manifestFile = files.find(file => file.path.toLowerCase() === 'prismflow-plugin.json')
    if (!manifestFile || !Buffer.isBuffer(manifestFile.data)) invalid('Personal plugin Bundle must contain prismflow-plugin.json')
    let input; try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestFile.data)) } catch { invalid('Personal plugin Manifest must be UTF-8 JSON') }
    const manifest = personalPluginManifest(input); this.assertPluginCollision(manifest)
    if (!files.some(file => file.path === manifest.entry)) invalid('Personal plugin entry is missing from Bundle')
    const target = join(this.pluginRoot, manifest.pluginId); const stage = join(this.pluginRoot, `.${manifest.pluginId}.${process.pid}.${Date.now()}.tmp`)
    try {
      await mkdir(stage, { mode: 0o700 })
      for (const file of files) { const output = join(stage, ...file.path.split('/')); await mkdir(dirname(output), { recursive: true, mode: 0o700 }); await writeFile(output, file.data, { mode: 0o600 }) }
      await rename(stage, target)
      const installed = await this.readPersonalPluginDirectory(manifest.pluginId)
      this.personalPluginManifests.set(installed.pluginId, installed); this.notify()
      return structuredClone(installed)
    } catch (error) { await rm(stage, { recursive: true, force: true }); throw error }
  }) }
  deletePersonalPlugin(input) { return this.mutate(async () => {
    if (!exact(input, ['pluginId', 'expected'])) invalid('Personal plugin delete fields are invalid')
    const pluginId = text(input.pluginId, 'pluginId', 96); const manifest = this.personalPluginManifests.get(pluginId)
    if (!manifest?.removable) invalid('Unknown removable personal plugin')
    const current = this.getToolset(); const ref = expected(input.expected)
    if (ref.version !== current.version || ref.sha256 !== current.sha256) throw new PrismToolsetConflictError('Toolset version conflict')
    if (current.enabledPlugins.includes(pluginId)) throw new PrismToolsetConflictError('Disable the personal plugin and save before deletion')
    const disposers = [...(this.personalPluginDisposers.get(pluginId) ?? []), ...manifest.tools.map(tool => this.nativeToolDisposers.get(tool)).filter(Boolean)]
    const disposal = await Promise.allSettled(disposers.map(dispose => Promise.resolve().then(dispose)))
    const failures = disposal.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, `Failed to deactivate personal plugin ${pluginId}`)
    this.personalPluginDisposers.delete(pluginId)
    const bundled = manifest.bundled === true; const target = manifest.directory || join(this.pluginRoot, pluginId); const hasPhysicalDirectory = typeof manifest.directory === 'string'
    const staged = hasPhysicalDirectory ? join(dirname(this.pluginRoot), `.prismflow-plugin-delete-${pluginId}-${process.pid}-${Date.now()}`) : ''
    if (hasPhysicalDirectory) await rename(target, staged)
    const tombstone = { pluginId, version: manifest.version, tools: manifest.tools, bundled, deletedAt: new Date().toISOString(), manifestSha256: digest({ pluginId, name: manifest.name, description: manifest.description, version: manifest.version, tools: manifest.tools }) }
    try { await this.requireTable().put(`@plugin-tombstone:${pluginId}`, tombstone) } catch (error) { if (hasPhysicalDirectory) await rename(staged, target).catch(() => {}); throw error }
    if (hasPhysicalDirectory) await rm(staged, { recursive: true, force: true })
    this.personalPluginManifests.delete(pluginId); if (bundled) this.removedBundledPluginIds.add(pluginId)
    this.notify()
    return tombstone
  }) }
  async bootstrapPromptSuggestions() {
    if (this.requireTable().get(PROMPT_SUGGESTIONS_KEY)) {
      const current = this.getPromptSuggestions()
      if (current.version === 1 && current.sha256 === LEGACY_DEFAULT_PROMPT_SUGGESTIONS_SHA256) {
        const snapshot = { items: structuredClone(DEFAULT_PROMPT_SUGGESTIONS), version: 2 }
        await this.requireTable().put(PROMPT_SUGGESTIONS_KEY, { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() })
      }
      return
    }
    const snapshot = { items: structuredClone(DEFAULT_PROMPT_SUGGESTIONS), version: 1 }
    await this.requireTable().put(PROMPT_SUGGESTIONS_KEY, { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() })
  }
  async bootstrap() {
    if (!this.skillIds().length) for (const skill of BUILTIN_SKILLS) await this.putSkill(skillRow({ ...skill, enabled: true }, 1, 'bootstrap', 0))
    if (!this.requireTable().get(TOOLSET_KEY)) {
      const skills = this.skillIds().filter(id => this.currentSkill(id)?.enabled)
      const snapshot = { enabledPlugins: this.pluginIds().sort(), enabledTools: this.toolNames().sort(), enabledSkills: skills.sort(), mode: 'complete', version: 1 }
      const row = { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() }
      await this.requireTable().put(TOOLSET_KEY, row); await this.requireTable().put(toolsetHistoryKey(1), row)
    } else {
      const current = this.getToolset({ allowUnavailable: true })
      const renamedTools = [...new Set(current.enabledTools.map(tool => LEGACY_TOOL_NAMES[tool] ?? tool))].sort()
      const expectedComplete = this.toolNames().sort()
      const availableTools = new Set(expectedComplete)
      const hasLegacyNames = current.enabledTools.some(tool => LEGACY_TOOL_NAMES[tool] !== undefined)
      let nextTools
      if (current.mode === 'complete' && JSON.stringify(current.enabledTools) !== JSON.stringify(expectedComplete)) {
        const supportedPrevious = [11, 16, 18, 21, 22].flatMap(length => [
          JSON.stringify([...PRISMFLOW_TOOL_NAMES.slice(0, length)].sort()),
          JSON.stringify([...LEGACY_PRISMFLOW_TOOL_NAMES.slice(0, length)].sort()),
        ])
        if (JSON.stringify(renamedTools) !== JSON.stringify(expectedComplete)
          && !renamedTools.every(tool => PRISMFLOW_TOOL_NAMES.includes(tool))
          && !supportedPrevious.includes(JSON.stringify(current.enabledTools))) {
          throw new Error('Complete PrismFlow Toolset does not match a supported schema revision')
        }
        nextTools = expectedComplete
      } else if (hasLegacyNames) {
        if (renamedTools.some(tool => !PRISMFLOW_TOOL_NAMES.includes(tool))) throw new Error('PrismFlow Toolset contains an unsupported legacy tool')
        nextTools = renamedTools.filter(tool => availableTools.has(tool))
      }
      if (current.mode === 'core' && JSON.stringify(renamedTools) !== JSON.stringify([...CORE_TOOLS].sort())) nextTools = [...CORE_TOOLS].sort()
      if (current.mode === 'custom' && renamedTools.some(tool => !availableTools.has(tool))) nextTools = renamedTools.filter(tool => availableTools.has(tool))
      const enabledTools = nextTools ?? renamedTools
      const renamedPlugins = Array.isArray(current.enabledPlugins) ? [...new Set(current.enabledPlugins.map(id => LEGACY_PLUGIN_IDS[id] ?? id))].sort() : undefined
      const availablePluginIds = new Set(this.pluginIds())
      const retainedPlugins = renamedPlugins?.filter(id => availablePluginIds.has(id))
      const expectedPlugins = current.mode === 'core' ? [...PRISMFLOW_SYSTEM_PLUGIN_IDS].sort() : current.mode === 'complete' ? this.pluginIds().sort() : retainedPlugins ?? this.pluginsForTools(enabledTools)
      const hasLegacyPluginIds = Array.isArray(current.enabledPlugins) && current.enabledPlugins.some(id => LEGACY_PLUGIN_IDS[id] !== undefined)
      const needsPluginMigration = !renamedPlugins || hasLegacyPluginIds || JSON.stringify(renamedPlugins) !== JSON.stringify(expectedPlugins)
      const activeSkills = this.listSkills().filter(skill => skill.enabled)
      const activeSkillIds = new Set(activeSkills.map(skill => skill.skillId))
      const enabledSkills = current.mode === 'core'
        ? activeSkills.filter(skill => skill.origin === 'system-default' && SYSTEM_PLUGIN_SKILL_IDS.has(skill.skillId)).map(skill => skill.skillId).sort()
        : current.mode === 'complete'
          ? activeSkills.map(skill => skill.skillId).sort()
          : current.enabledSkills.filter(skillId => activeSkillIds.has(skillId)).sort()
      const needsSkillMigration = JSON.stringify(current.enabledSkills) !== JSON.stringify(enabledSkills)
      if (nextTools || needsPluginMigration || needsSkillMigration) {
        const snapshot = { mode: current.mode, enabledPlugins: expectedPlugins, enabledTools, enabledSkills, version: current.version + 1 }
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
    if (PROTECTED_BUILTIN_SKILL_IDS.has(input.skillId)) throw new PrismToolsetConflictError('System-default PrismFlow Skills always exist and cannot be deleted')
    if (ref.version !== current.version || ref.sha256 !== current.sha256) throw new PrismToolsetConflictError('Skill version conflict')
    const row = skillRow(skillSnapshot({ skillId: current.skillId, name: current.name, description: current.description, whenToUse: current.whenToUse, content: current.content, enabled: false }), current.version + 1, 'delete', current.version)
    const target = join(this.skillRoot, current.skillId); const staged = join(dirname(this.skillRoot), `.prismflow-skill-delete-${current.skillId}-${process.pid}-${Date.now()}`)
    let stagedBundle = false
    try { await rename(target, staged); stagedBundle = true } catch (error) { if (error?.code !== 'ENOENT') throw error }
    try {
      await this.putSkill(row)
      const toolset = this.getToolset()
      if (toolset.enabledSkills.includes(current.skillId)) {
        const snapshot = { mode: toolset.mode, enabledPlugins: toolset.enabledPlugins, enabledTools: toolset.enabledTools, enabledSkills: toolset.enabledSkills.filter(skillId => skillId !== current.skillId), version: toolset.version + 1 }
        const next = { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() }
        await this.requireTable().put(TOOLSET_KEY, next); await this.requireTable().put(toolsetHistoryKey(next.version), next)
      }
    } catch (error) { if (stagedBundle) await rename(staged, target).catch(() => {}); throw error }
    if (stagedBundle) await rm(staged, { recursive: true, force: true })
    this.notify(); return projectSkill(row)
  }) }
  listPlugins() { return this.pluginCatalog().map(({ directory: _directory, entryPath: _entryPath, entryMtimeMs: _entryMtimeMs, format: _format, entry: _entry, ...plugin }) => plugin) }
  getToolset({ allowUnavailable = false } = {}) {
    const row = this.requireTable().get(TOOLSET_KEY)
    const legacy = row && exact(row, ['mode', 'enabledTools', 'enabledSkills', 'version', 'sha256', 'updatedAt'])
    const current = row && exact(row, ['mode', 'enabledPlugins', 'enabledTools', 'enabledSkills', 'version', 'sha256', 'updatedAt'])
    if ((!legacy && !current) || !['core', 'complete', 'custom'].includes(row.mode)
      || !Number.isInteger(row.version) || row.version < 1 || !SHA.test(row.sha256 ?? '')) throw new Error('PrismFlow Toolset is missing or corrupt')
    const hashInput = current
      ? { mode: row.mode, enabledPlugins: row.enabledPlugins, enabledTools: row.enabledTools, enabledSkills: row.enabledSkills, version: row.version }
      : { mode: row.mode, enabledTools: row.enabledTools, enabledSkills: row.enabledSkills, version: row.version }
    if (digest(hashInput) !== row.sha256) throw new Error('PrismFlow Toolset is missing or corrupt')
    const catalog = allowUnavailable ? PRISMFLOW_PLUGIN_MANIFESTS : this.pluginCatalog()
    const catalogTools = catalog.flatMap(plugin => plugin.tools)
    const catalogPluginIds = catalog.map(plugin => plugin.pluginId)
    sortedUnique(row.enabledTools, new Set([...catalogTools, ...Object.keys(LEGACY_TOOL_NAMES)]), 'enabledTools')
    if (current) {
      sortedUnique(row.enabledPlugins, new Set([...catalogPluginIds, ...Object.keys(LEGACY_PLUGIN_IDS)]), 'enabledPlugins')
      const normalizedPlugins = row.enabledPlugins.map(id => LEGACY_PLUGIN_IDS[id] ?? id)
      const allowedTools = new Set(catalog.filter(plugin => normalizedPlugins.includes(plugin.pluginId)).flatMap(plugin => plugin.tools))
      if (row.enabledTools.some(tool => !allowedTools.has(LEGACY_TOOL_NAMES[tool] ?? tool))) throw new Error('PrismFlow Toolset contains a tool whose plugin is disabled')
    }
    if (!Array.isArray(row.enabledSkills) || row.enabledSkills.length > 256 || new Set(row.enabledSkills).size !== row.enabledSkills.length || row.enabledSkills.some(id => !SKILL_ID.test(id))) throw new Error('PrismFlow Toolset is corrupt')
    return structuredClone(row)
  }
  getPromptSuggestions() {
    const row = this.requireTable().get(PROMPT_SUGGESTIONS_KEY)
    if (!row || !exact(row, ['items', 'version', 'sha256', 'updatedAt']) || !Number.isInteger(row.version) || row.version < 1 || !SHA.test(row.sha256 ?? '')) {
      throw new Error('PrismFlow Prompt Suggestions are missing or corrupt')
    }
    const items = promptSuggestionsSnapshot(row.items)
    if (digest({ items, version: row.version }) !== row.sha256) throw new Error('PrismFlow Prompt Suggestions are missing or corrupt')
    return structuredClone(row)
  }
  savePromptSuggestions(input) { return this.mutate(async () => {
    if (!exact(input, ['items', 'expected'])) invalid('Prompt suggestion fields are invalid')
    const current = this.getPromptSuggestions(); const ref = expected(input.expected)
    if (ref.version !== current.version || ref.sha256 !== current.sha256) throw new PrismToolsetConflictError('Prompt Suggestions version conflict')
    const snapshot = { items: promptSuggestionsSnapshot(input.items), version: current.version + 1 }
    const row = { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() }
    await this.requireTable().put(PROMPT_SUGGESTIONS_KEY, row); this.notify(); return structuredClone(row)
  }) }
  isToolEnabled(name) { return this.getToolset().enabledTools.includes(name) }
  activeSkills() { const selected = new Set(this.getToolset().enabledSkills); return this.listSkills().filter(skill => skill.enabled && selected.has(skill.skillId)) }
  saveToolset(input) { return this.mutate(async () => {
    const legacyInput = exact(input, ['mode', 'enabledTools', 'enabledSkills', 'expected'])
    const pluginInput = exact(input, ['mode', 'enabledPlugins', 'enabledTools', 'enabledSkills', 'expected'])
    if (!legacyInput && !pluginInput) invalid('Toolset fields are invalid')
    const current = this.getToolset(); const ref = expected(input.expected); if (ref.version !== current.version || ref.sha256 !== current.sha256) throw new PrismToolsetConflictError('Toolset version conflict')
    if (!['core', 'complete', 'custom'].includes(input.mode)) invalid('mode is invalid')
    const requestedTools = sortedUnique(input.enabledTools, new Set(this.toolNames()), 'enabledTools')
    const requestedPlugins = pluginInput ? sortedUnique(input.enabledPlugins, new Set(this.pluginIds()), 'enabledPlugins') : this.pluginsForTools(requestedTools)
    let enabledPlugins
    let enabledTools
    if (input.mode === 'core') {
      enabledPlugins = [...PRISMFLOW_SYSTEM_PLUGIN_IDS].sort(); enabledTools = [...CORE_TOOLS].sort()
    } else if (input.mode === 'complete') {
      enabledPlugins = this.pluginIds().sort(); enabledTools = this.toolNames().sort()
    } else {
      enabledPlugins = requestedPlugins
      const allowedTools = new Set(this.toolsForPlugins(enabledPlugins))
      if (requestedTools.some(tool => !allowedTools.has(tool))) invalid('enabledTools contains a tool whose plugin is disabled')
      enabledTools = requestedTools
    }
    const skills = this.listSkills()
    const availableSkills = new Set(skills.map(skill => skill.skillId))
    const requestedSkills = sortedUnique(input.enabledSkills, availableSkills, 'enabledSkills')
    const enabledSkills = input.mode === 'core'
      ? skills.filter(skill => skill.enabled && skill.origin === 'system-default' && SYSTEM_PLUGIN_SKILL_IDS.has(skill.skillId)).map(skill => skill.skillId).sort()
      : input.mode === 'complete'
        ? skills.filter(skill => skill.enabled).map(skill => skill.skillId).sort()
        : requestedSkills
    const snapshot = { mode: input.mode, enabledPlugins, enabledTools, enabledSkills, version: current.version + 1 }
    const row = { ...snapshot, sha256: digest(snapshot), updatedAt: new Date().toISOString() }
    await this.requireTable().put(TOOLSET_KEY, row); await this.requireTable().put(toolsetHistoryKey(row.version), row); this.notify(); return structuredClone(row)
  }) }
}

export function registerPrismFlowTool(ctx, definition) {
  const manager = ctx.get?.('prismToolsets')
  if (manager && !manager.isToolEnabled(definition.name)) return () => {}
  const dispose = ctx.tools.register(definition)
  return manager?.trackNativeTool?.(definition.name, dispose) ?? dispose
}

export default PrismToolsetStore
