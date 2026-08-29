import { createHash } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { personaOnlySnapshot } from './generator-prompt-policy.js'

export const name = 'prismflow-store-generator-prompts'
export const inject = ['storageDomain']

export const PROMPT_HISTORY_LIMIT = 50

export const Config = Schema.object({
  maxHistoryPerGenerator: Schema.number().step(1).min(PROMPT_HISTORY_LIMIT).max(PROMPT_HISTORY_LIMIT).default(PROMPT_HISTORY_LIMIT),
})

export const prismGeneratorPromptsDomain = defineDomain({
  name: 'prismflow_generator_prompts', version: 1,
  tables: { history: domainTable(z.unknown()) },
})

export const GENERATOR_PROMPT_FIELDS = ['persona', 'instruction', 'reviewPersona', 'reviewInstruction']
const ROW_FIELDS = ['generatorId', 'generatorName', ...GENERATOR_PROMPT_FIELDS, 'version', 'sha256', 'updatedAt', 'actor', 'action', 'sourceVersion']
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/u

export class GeneratorPromptValidationError extends Error { constructor(message) { super(message); this.name = 'GeneratorPromptValidationError' } }
export class GeneratorPromptConflictError extends Error { constructor(message) { super(message); this.name = 'GeneratorPromptConflictError' } }
export class GeneratorPromptCorruptError extends Error { constructor(message) { super(message); this.name = 'GeneratorPromptCorruptError' } }

function exactKeys(value, fields) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
}
function promptText(value, field) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 10_000 || /[\u0000\u007f]/u.test(value)) {
    throw new GeneratorPromptValidationError(`${field} must be a non-empty string of at most 10000 characters without NUL or DEL`)
  }
  return value
}
function generatorName(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new GeneratorPromptValidationError('generatorName is invalid')
  }
  return value
}
function iso(value) {
  if (typeof value !== 'string' || value.length > 40) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}
export function normalizeGeneratorPrompts(value) {
  return Object.fromEntries(GENERATOR_PROMPT_FIELDS.map(field => [field, promptText(value[field], field)]))
}
export function generatorPromptSha256(value) {
  const prompts = normalizeGeneratorPrompts(value)
  return createHash('sha256').update(JSON.stringify(GENERATOR_PROMPT_FIELDS.map(field => [field, prompts[field]])), 'utf8').digest('hex')
}
function validRow(raw, expectedGeneratorId) {
  if (!exactKeys(raw, ROW_FIELDS) || raw.generatorId !== expectedGeneratorId || !ID_PATTERN.test(raw.generatorId ?? '')
    || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > 1_000_000_000
    || !/^[a-f0-9]{64}$/u.test(raw.sha256 ?? '') || !iso(raw.updatedAt)
    || raw.actor !== 'dashboard-admin' && raw.actor !== 'deployment'
    || !['bootstrap', 'update', 'rollback'].includes(raw.action)
    || !Number.isInteger(raw.sourceVersion) || raw.sourceVersion < 0 || raw.sourceVersion > raw.version) return undefined
  let prompts; let historicalName
  try { prompts = normalizeGeneratorPrompts(raw); historicalName = generatorName(raw.generatorName) } catch { return undefined }
  if (generatorPromptSha256(prompts) !== raw.sha256) return undefined
  if (raw.action === 'bootstrap' && (raw.version !== 1 || raw.sourceVersion !== 0 || raw.actor !== 'deployment')) return undefined
  if (raw.action === 'update' && (raw.version < 2 || raw.sourceVersion !== raw.version - 1 || raw.actor !== 'dashboard-admin')) return undefined
  if (raw.action === 'rollback' && (raw.version < 2 || raw.sourceVersion < 1 || raw.sourceVersion >= raw.version || raw.actor !== 'dashboard-admin')) return undefined
  return { generatorId: expectedGeneratorId, generatorName: historicalName, ...prompts, version: raw.version, sha256: raw.sha256,
    updatedAt: raw.updatedAt, actor: raw.actor, action: raw.action, sourceVersion: raw.sourceVersion }
}
function project(row, currentName) { return structuredClone(currentName === undefined ? row : { ...row, generatorName: currentName }) }
function historySlot(version) { return ((version - 1) % PROMPT_HISTORY_LIMIT) + 1 }
function historyKey(generatorId, version) { return `${generatorId}:${String(historySlot(version)).padStart(10, '0')}` }

export class PrismGeneratorPromptStore extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismGeneratorPrompts')
    const ceiling = config.maxHistoryPerGenerator ?? PROMPT_HISTORY_LIMIT
    if (ceiling !== PROMPT_HISTORY_LIMIT) throw new GeneratorPromptValidationError(`maxHistoryPerGenerator must be ${PROMPT_HISTORY_LIMIT}`)
    this.maxHistoryPerGenerator = PROMPT_HISTORY_LIMIT
    this.definitions = new Map()
    this.adoptionResolvers = new Map()
    this.historyTable = undefined
    this.mutationTail = Promise.resolve()
    this.stopping = false
  }

  async [Service.init]() {
    let domain
    this.stopping = false
    try {
      domain = await this.ctx.storageDomain.open(prismGeneratorPromptsDomain)
      this.historyTable = domain.table('history')
      this.ctx.effect(() => async () => {
        this.stopping = true
        await this.mutationTail.catch(() => {})
        this.historyTable = undefined
        await domain.close()
      }, 'prismflow-generator-prompts.domainClose')
    } catch (error) {
      this.historyTable = undefined
      this.stopping = false
      if (domain) await domain.close().catch(() => {})
      throw error
    }
  }

  register(definition) {
    if (!exactKeys(definition, ['id', 'name', ...GENERATOR_PROMPT_FIELDS]) || !ID_PATTERN.test(definition.id ?? '')) {
      throw new GeneratorPromptValidationError('Managed legacy generator definition is invalid')
    }
    const name = generatorName(definition.name)
    if (this.definitions.has(definition.id)) throw new GeneratorPromptConflictError(`Managed legacy generator already registered: ${definition.id}`)
    const deploymentPrompts = normalizeGeneratorPrompts(definition)
    let defaults
    try {
      defaults = normalizeGeneratorPrompts(personaOnlySnapshot(
        deploymentPrompts.persona, deploymentPrompts.instruction,
        deploymentPrompts.reviewPersona, deploymentPrompts.reviewInstruction,
      ))
    } catch (error) {
      throw new GeneratorPromptValidationError(error instanceof Error ? error.message : 'Deployment prompt migration is invalid')
    }
    if (JSON.stringify(defaults).length > 32_000) throw new GeneratorPromptValidationError('Managed legacy generator prompt aggregate is too large')
    const value = { id: definition.id, name, defaults }
    this.definitions.set(value.id, value)
    return () => { if (this.definitions.get(value.id) === value) this.definitions.delete(value.id) }
  }

  registerAdoptionResolver(generatorId, resolver) {
    if (!ID_PATTERN.test(generatorId ?? '') || typeof resolver !== 'function') throw new GeneratorPromptValidationError('Generator adoption resolver is invalid')
    if (this.adoptionResolvers.has(generatorId)) throw new GeneratorPromptConflictError(`Generator adoption resolver already registered: ${generatorId}`)
    this.adoptionResolvers.set(generatorId, resolver)
    return () => { if (this.adoptionResolvers.get(generatorId) === resolver) this.adoptionResolvers.delete(generatorId) }
  }
  requireDefinition(generatorId, forAdoption = false) {
    if (typeof generatorId !== 'string' || !ID_PATTERN.test(generatorId)) throw new GeneratorPromptValidationError('generatorId is invalid')
    const value = this.definitions.get(generatorId)
    if (!value) throw new GeneratorPromptValidationError(`Managed legacy generator is not registered: ${generatorId}`)
    if (forAdoption && this.adoptionResolvers.get(generatorId)?.() === true) {
      throw new GeneratorPromptConflictError(`Managed legacy prompt history adopted by workflow administration: ${generatorId}`)
    }
    return value
  }
  requireHistory() {
    if (!this.historyTable) throw new Error('Generator Prompt Store is not initialized')
    return this.historyTable
  }
  mutate(work) {
    if (this.stopping) return Promise.reject(new Error('Generator Prompt Store is stopping'))
    const operation = this.mutationTail.catch(() => {}).then(work)
    this.mutationTail = operation.catch(() => {})
    return operation
  }
  historyRows(definition) {
    const rows = []
    for (const [key, raw] of this.requireHistory().entries()) {
      if (!String(key).startsWith(`${definition.id}:`)) continue
      const row = validRow(raw, definition.id)
      if (!row || key !== historyKey(definition.id, row.version)) throw new GeneratorPromptCorruptError(`Generator prompt history is corrupt: ${definition.id}`)
      rows.push(row)
    }
    rows.sort((a, b) => a.version - b.version)
    if (rows.length > this.maxHistoryPerGenerator) throw new GeneratorPromptCorruptError(`Generator prompt history exceeds its rolling window: ${definition.id}`)
    if (rows.length > 0) {
      const latestVersion = rows.at(-1).version
      const expectedFirstVersion = Math.max(1, latestVersion - this.maxHistoryPerGenerator + 1)
      if (rows.length !== latestVersion - expectedFirstVersion + 1) {
        throw new GeneratorPromptCorruptError(`Generator prompt rolling history is incomplete: ${definition.id}`)
      }
      for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].version !== expectedFirstVersion + index) {
          throw new GeneratorPromptCorruptError(`Generator prompt rolling history is incomplete: ${definition.id}`)
        }
      }
    }
    return rows
  }
  async ensureHistory(definition) {
    const rows = this.historyRows(definition)
    if (rows.length > 0) return rows
    const prompts = definition.defaults
    const row = { generatorId: definition.id, generatorName: definition.name, ...prompts, version: 1,
      sha256: generatorPromptSha256(prompts), updatedAt: new Date().toISOString(), actor: 'deployment', action: 'bootstrap', sourceVersion: 0 }
    // One immutable row is the entire durable mutation. A failed put leaves no
    // published version and a successful put is immediately the derived current.
    await this.requireHistory().put(historyKey(definition.id, 1), row)
    return [row]
  }

  withExpectedSnapshot(generatorId, expectedVersion, expectedSha256, operation) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !/^[a-f0-9]{64}$/u.test(expectedSha256 ?? '')
      || typeof operation !== 'function') throw new GeneratorPromptValidationError('Generator prompt adoption precondition is invalid')
    return this.mutate(async () => {
      const definition = this.requireDefinition(generatorId, true)
      const current = (await this.ensureHistory(definition)).at(-1)
      if (current.version !== expectedVersion || current.sha256 !== expectedSha256) {
        throw new GeneratorPromptConflictError('Generator prompt changed before workflow adoption')
      }
      return operation(project(current, definition.name))
    })
  }

  snapshot(generatorId, version) {
    return this.mutate(async () => {
      const definition = this.requireDefinition(generatorId)
      const rows = await this.ensureHistory(definition)
      if (version === undefined) return project(rows.at(-1), definition.name)
      if (!Number.isInteger(version) || version < 1) throw new GeneratorPromptValidationError('Prompt version is invalid')
      const row = rows.find(item => item.version === version)
      if (!row) throw new GeneratorPromptValidationError('Unknown generator prompt version')
      return project(row, definition.name)
    })
  }
  list() {
    return this.mutate(async () => {
      const rows = []
      for (const definition of [...this.definitions.values()].sort((a, b) => a.id.localeCompare(b.id))) {
        rows.push(project((await this.ensureHistory(definition)).at(-1), definition.name))
      }
      return rows
    })
  }
  history(generatorId, limit = PROMPT_HISTORY_LIMIT, beforeVersion) {
    if (!Number.isInteger(limit) || limit < 1 || limit > PROMPT_HISTORY_LIMIT) throw new GeneratorPromptValidationError('history limit is invalid')
    if (beforeVersion !== undefined && (!Number.isInteger(beforeVersion) || beforeVersion < 2)) throw new GeneratorPromptValidationError('beforeVersion is invalid')
    return this.mutate(async () => {
      const definition = this.requireDefinition(generatorId)
      const rows = await this.ensureHistory(definition)
      return rows.filter(row => beforeVersion === undefined || row.version < beforeVersion)
        .sort((a, b) => b.version - a.version).slice(0, limit).map(row => project(row))
    })
  }
}

export default PrismGeneratorPromptStore
