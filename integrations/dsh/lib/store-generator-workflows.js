import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  deploymentProfileSha256,
  generatorWorkflowSha256,
  normalizeWorkflowSnapshot,
  validateDeploymentExecutionProfile,
} from './shared/content-production.js'
import { acquireWriterLease, WriterLeaseConflictError, WriterLeaseValidationError } from './writer-lease-lock.js'

export const name = 'prismflow-store-generator-workflows'
export const inject = ['storageDomain']
export const WORKFLOW_HISTORY_LIMIT = 50
export const Config = Schema.object({
  maxHistoryPerGenerator: Schema.number().step(1).min(WORKFLOW_HISTORY_LIMIT).max(WORKFLOW_HISTORY_LIMIT).default(WORKFLOW_HISTORY_LIMIT),
  writerLockPath: Schema.string().default(''),
})

export const prismGeneratorWorkflowsDomain = defineDomain({
  name: 'prismflow_generator_workflows', version: 1,
  tables: { history: domainTable(z.unknown()) },
})

const ID = /^[a-zA-Z0-9_-]{1,128}$/u
const SHA = /^[a-f0-9]{64}$/u
const SNAPSHOT_FIELDS = ['format', 'generatorId', 'generatorName', 'description', 'enabled', 'steps', 'executionProfile']
const ROW_FIELDS = [...SNAPSHOT_FIELDS, 'version', 'sha256', 'updatedAt', 'actor', 'action', 'sourceVersion']
const ACTIONS = ['create', 'adopt', 'update', 'rollback', 'disable', 'enable', 'deployment-rebind', 'delete']

export class GeneratorWorkflowValidationError extends Error {
  constructor(message, code = 'workflow_validation') { super(message); this.name = 'GeneratorWorkflowValidationError'; this.code = code }
}
export class GeneratorWorkflowConflictError extends Error {
  constructor(message, code = 'workflow_version_conflict', details) { super(message); this.name = 'GeneratorWorkflowConflictError'; this.code = code; this.details = details }
}
export class GeneratorWorkflowDeletedError extends Error {
  constructor(message = 'Generator workflow is permanently deleted') { super(message); this.name = 'GeneratorWorkflowDeletedError'; this.code = 'workflow_deleted' }
}
export class GeneratorWorkflowCorruptError extends Error { constructor(message) { super(message); this.name = 'GeneratorWorkflowCorruptError' } }

function exact(value, fields) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
}
function iso(value) {
  if (typeof value !== 'string' || value.length > 40) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}
function snapshotOf(value) {
  try { return normalizeWorkflowSnapshot(Object.fromEntries(SNAPSHOT_FIELDS.map(field => [field, value[field]]))) }
  catch (error) { throw new GeneratorWorkflowValidationError(error instanceof Error ? error.message : 'Workflow is invalid') }
}
function validRow(raw, generatorId) {
  if (!exact(raw, ROW_FIELDS) || raw.generatorId !== generatorId || !ID.test(generatorId)
    || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > 1_000_000_000
    || !SHA.test(raw.sha256 ?? '') || !iso(raw.updatedAt)
    || !['dashboard-admin', 'deployment'].includes(raw.actor) || !ACTIONS.includes(raw.action)
    || !Number.isInteger(raw.sourceVersion) || raw.sourceVersion < 0 || raw.sourceVersion > raw.version) return undefined
  let snapshot
  try { snapshot = snapshotOf(raw) } catch { return undefined }
  if (generatorWorkflowSha256(snapshot) !== raw.sha256) return undefined
  if (raw.version === 1 && !['create', 'adopt'].includes(raw.action)) return undefined
  if (raw.version > 1 && ['create', 'adopt'].includes(raw.action)) return undefined
  if (raw.action === 'create' && (raw.actor !== 'dashboard-admin' || raw.sourceVersion !== 0)) return undefined
  if (raw.action === 'adopt' && raw.sourceVersion !== 0) return undefined
  if (raw.action === 'rollback' && (raw.actor !== 'dashboard-admin' || raw.sourceVersion < 1 || raw.sourceVersion >= raw.version)) return undefined
  if (!['create', 'adopt', 'rollback'].includes(raw.action) && raw.sourceVersion !== raw.version - 1) return undefined
  if (raw.action === 'deployment-rebind' && raw.actor !== 'deployment') return undefined
  if (raw.action === 'delete' && (raw.actor !== 'dashboard-admin' || raw.enabled !== false)) return undefined
  if (!['adopt', 'deployment-rebind'].includes(raw.action) && raw.actor !== 'dashboard-admin') return undefined
  return { ...snapshot, version: raw.version, sha256: raw.sha256, updatedAt: raw.updatedAt,
    actor: raw.actor, action: raw.action, sourceVersion: raw.sourceVersion }
}
function slot(version) { return ((version - 1) % WORKFLOW_HISTORY_LIMIT) + 1 }
function key(generatorId, version) { return `${generatorId}:${String(slot(version)).padStart(10, '0')}` }
const HISTORY_KEY = /^([a-zA-Z0-9_-]{1,128}):(\d{10})$/u
function lifecycle(row) { return row.action === 'delete' ? 'deleted' : row.enabled ? 'active' : 'archived' }
function projected(row) {
  const value = structuredClone(row)
  value.lifecycle = lifecycle(row)
  if (row.action === 'delete') value.deletion = { deletedAt: row.updatedAt, deletedFrom: { version: row.sourceVersion, sha256: row.sha256 } }
  return value
}
function assertMutable(current) {
  if (current?.action === 'delete') throw new GeneratorWorkflowDeletedError()
}

export async function acquireWorkflowWriterLock(lockPath, options) {
  try { return await acquireWriterLease(lockPath, options) }
  catch (error) {
    if (error instanceof WriterLeaseValidationError) throw new GeneratorWorkflowValidationError(error.message)
    if (error instanceof WriterLeaseConflictError) throw new GeneratorWorkflowConflictError(error.message)
    throw error
  }
}
function reference(input) {
  if (!exact(input, input?.kind === 'legacy-v1' ? ['kind', 'version', 'sha256'] : ['kind', 'version', 'sha256'])
    || !['legacy-v1', 'workflow-v1'].includes(input?.kind) || !Number.isInteger(input.version) || input.version < 0
    || !SHA.test(input.sha256 ?? '')) throw new GeneratorWorkflowValidationError('Workflow expected reference is invalid')
  if (input.kind === 'workflow-v1' && input.version < 1) throw new GeneratorWorkflowValidationError('Workflow expected reference is invalid')
  return input
}

export function createDeploymentExecutionProfile(value) {
  try {
    const profile = validateDeploymentExecutionProfile({ ...value, sha256: value.sha256 ?? '0'.repeat(64) }, false)
    return { ...profile, sha256: deploymentProfileSha256(profile) }
  } catch (error) {
    throw new GeneratorWorkflowValidationError(error instanceof Error ? error.message : 'Deployment execution profile is invalid')
  }
}

export class PrismGeneratorWorkflowStore extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismGeneratorWorkflows')
    if ((config.maxHistoryPerGenerator ?? WORKFLOW_HISTORY_LIMIT) !== WORKFLOW_HISTORY_LIMIT) {
      throw new GeneratorWorkflowValidationError(`maxHistoryPerGenerator must be ${WORKFLOW_HISTORY_LIMIT}`)
    }
    this.historyTable = undefined
    this.profiles = new Map()
    this.defaultBuilderProfile = undefined
    this.legacy = new Map()
    this.mutationTail = Promise.resolve()
    this.stopping = false
    this.writerLockPath = config.writerLockPath ?? ''
    this.releaseWriterLock = undefined
  }

  async [Service.init]() {
    let domain
    try {
      if (this.writerLockPath) this.releaseWriterLock = await acquireWorkflowWriterLock(this.writerLockPath)
      domain = await this.ctx.storageDomain.open(prismGeneratorWorkflowsDomain)
      this.historyTable = domain.table('history')
      this.scanHistory()
      this.ctx.effect(() => async () => {
        this.stopping = true
        await this.mutationTail.catch(() => {})
        this.historyTable = undefined
        const release = this.releaseWriterLock
        let domainCloseError
        let leaseReleaseError
        try { await domain.close() } catch (error) { domainCloseError = error }
        finally {
          try { await release?.() } catch (error) { leaseReleaseError = error }
          finally { if (this.releaseWriterLock === release) this.releaseWriterLock = undefined }
        }
        if (domainCloseError && leaseReleaseError) {
          throw new AggregateError([domainCloseError, leaseReleaseError], 'Generator Workflow Store domain close and writer lease release failed')
        }
        if (domainCloseError) throw domainCloseError
        if (leaseReleaseError) throw leaseReleaseError
      }, 'prismflow-generator-workflows.domainClose')
    } catch (error) {
      this.historyTable = undefined
      if (domain) await domain.close().catch(() => {})
      await this.releaseWriterLock?.().catch(() => {})
      this.releaseWriterLock = undefined
      throw error
    }
  }
  requireWriter() {
    if (!this.releaseWriterLock) throw new GeneratorWorkflowValidationError('Dashboard workflow writes require a deployment-configured local writerLockPath')
  }
  requireHistory() { if (!this.historyTable) throw new Error('Generator Workflow Store is not initialized'); return this.historyTable }
  mutate(work) {
    if (this.stopping) return Promise.reject(new Error('Generator Workflow Store is stopping'))
    const operation = this.mutationTail.catch(() => {}).then(work)
    this.mutationTail = operation.catch(() => {})
    return operation
  }

  registerExecutionProfile(raw, { builderDefault = false } = {}) {
    const profile = createDeploymentExecutionProfile(raw)
    const profileKey = `${profile.id}:${profile.version}:${profile.sha256}`
    if (this.profiles.has(profileKey)) throw new GeneratorWorkflowConflictError(`Deployment workflow profile already registered: ${profile.id}`)
    if (builderDefault && this.defaultBuilderProfile) throw new GeneratorWorkflowConflictError('A Dashboard workflow builder profile is already registered')
    this.profiles.set(profileKey, profile)
    if (builderDefault) this.defaultBuilderProfile = profile
    return () => {
      if (this.profiles.get(profileKey) === profile) this.profiles.delete(profileKey)
      if (this.defaultBuilderProfile === profile) this.defaultBuilderProfile = undefined
    }
  }

  registerLegacyProjection(definition) {
    if (!definition || !ID.test(definition.id ?? '') || typeof definition.read !== 'function'
      || definition.adopt !== undefined && typeof definition.adopt !== 'function') throw new GeneratorWorkflowValidationError('Legacy workflow projection is invalid')
    if (this.legacy.has(definition.id)) throw new GeneratorWorkflowConflictError(`Legacy workflow projection already registered: ${definition.id}`)
    this.legacy.set(definition.id, definition)
    return () => { if (this.legacy.get(definition.id) === definition) this.legacy.delete(definition.id) }
  }

  scanHistory() {
    const ids = new Set()
    for (const [storedKey, raw] of this.requireHistory().entries()) {
      if (typeof storedKey !== 'string') throw new GeneratorWorkflowCorruptError('Generator workflow history contains a malformed key')
      const match = storedKey.match(HISTORY_KEY)
      if (!match || Number(match[2]) < 1 || Number(match[2]) > WORKFLOW_HISTORY_LIMIT) {
        throw new GeneratorWorkflowCorruptError(`Generator workflow history contains an unknown key: ${storedKey || '<empty>'}`)
      }
      const row = validRow(raw, match[1])
      if (!row || storedKey !== key(match[1], row.version)) throw new GeneratorWorkflowCorruptError(`Generator workflow history is corrupt: ${match[1]}`)
      ids.add(match[1])
    }
    return [...ids].sort()
  }
  rows(generatorId) {
    const rows = []
    this.scanHistory()
    for (const [storedKey, raw] of this.requireHistory().entries()) {
      if (!String(storedKey).startsWith(`${generatorId}:`)) continue
      const row = validRow(raw, generatorId)
      if (!row || storedKey !== key(generatorId, row.version)) throw new GeneratorWorkflowCorruptError(`Generator workflow history is corrupt: ${generatorId}`)
      rows.push(row)
    }
    rows.sort((a, b) => a.version - b.version)
    if (!rows.length) return rows
    const latest = rows.at(-1).version
    const first = Math.max(1, latest - WORKFLOW_HISTORY_LIMIT + 1)
    if (rows.length !== latest - first + 1 || rows.some((row, index) => row.version !== first + index)) {
      throw new GeneratorWorkflowCorruptError(`Generator workflow rolling history is incomplete: ${generatorId}`)
    }
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const previous = rows[index - 1]
      if (previous?.action === 'delete') throw new GeneratorWorkflowCorruptError(`Generator workflow has a mutation after terminal deletion: ${generatorId}`)
      if (row.action === 'delete' && (!previous || previous.version !== row.sourceVersion || previous.enabled || previous.sha256 !== row.sha256)) {
        throw new GeneratorWorkflowCorruptError(`Generator workflow deletion tombstone is invalid: ${generatorId}`)
      }
    }
    return rows
  }
  generatorIds() { return this.scanHistory() }
  currentSync(generatorId) { return this.rows(generatorId).at(-1) }
  hasCurrent(generatorId) { return this.currentSync(generatorId) !== undefined }
  listEnabled() { return this.generatorIds().map(id => this.currentSync(id)).filter(row => row?.enabled).map(projected) }
  listCurrent() { return this.generatorIds().map(id => this.currentSync(id)).filter(Boolean).map(projected) }

  async list({ includeDeleted = false } = {}) {
    const persisted = new Map(this.listCurrent().map(row => [row.generatorId, { kind: 'workflow-v1', ...row }]))
    for (const legacy of this.legacy.values()) {
      if (persisted.has(legacy.id)) continue
      const legacyRead = await legacy.read()
      if (!exact(legacyRead, ['reference', 'snapshot'])) throw new GeneratorWorkflowValidationError('Legacy workflow projection read is invalid')
      const legacyRef = reference(legacyRead.reference)
      const snapshot = snapshotOf(legacyRead.snapshot)
      persisted.set(legacy.id, { kind: 'legacy-v1', ...snapshot, legacyVersion: legacyRef.version, legacySha256: legacyRef.sha256 })
    }
    return [...persisted.values()].filter(row => includeDeleted || row.action !== 'delete')
      .sort((a, b) => a.generatorId.localeCompare(b.generatorId)).map(projected)
  }
  snapshot(generatorId, version) {
    if (!ID.test(generatorId ?? '')) return Promise.reject(new GeneratorWorkflowValidationError('generatorId is invalid'))
    return this.mutate(async () => {
      const rows = this.rows(generatorId)
      const row = version === undefined ? rows.at(-1) : rows.find(item => item.version === version)
      if (row) return projected(row)
      const legacy = version === undefined ? this.legacy.get(generatorId) : undefined
      if (legacy) {
        const legacyRead = await legacy.read()
        if (!exact(legacyRead, ['reference', 'snapshot'])) throw new GeneratorWorkflowValidationError('Legacy workflow projection read is invalid')
        const legacyRef = reference(legacyRead.reference); const snapshot = snapshotOf(legacyRead.snapshot)
        return projected({ kind: 'legacy-v1', ...snapshot, legacyVersion: legacyRef.version, legacySha256: legacyRef.sha256 })
      }
      throw new GeneratorWorkflowValidationError('Unknown or evicted generator workflow version')
    })
  }
  history(generatorId, limit = 50, beforeVersion) {
    if (!ID.test(generatorId ?? '') || !Number.isInteger(limit) || limit < 1 || limit > 50
      || beforeVersion !== undefined && (!Number.isInteger(beforeVersion) || beforeVersion < 2)) {
      throw new GeneratorWorkflowValidationError('Workflow history query is invalid')
    }
    return this.mutate(async () => this.rows(generatorId).filter(row => beforeVersion === undefined || row.version < beforeVersion)
      .toReversed().slice(0, limit).map(projected))
  }

  async putRolling(row) {
    const storedKey = key(row.generatorId, row.version)
    const replaced = this.requireHistory().get(storedKey)
    if (replaced !== undefined) {
      const previous = validRow(replaced, row.generatorId)
      if (!previous || previous.version !== row.version - WORKFLOW_HISTORY_LIMIT) throw new GeneratorWorkflowCorruptError('Generator workflow rolling history slot is corrupt')
    } else if (row.version > WORKFLOW_HISTORY_LIMIT) throw new GeneratorWorkflowCorruptError('Generator workflow rolling history slot is missing')
    await this.requireHistory().put(storedKey, row)
  }
  makeRow(snapshot, version, actor, action, sourceVersion) {
    const normalized = snapshotOf(snapshot)
    return { ...normalized, version, sha256: generatorWorkflowSha256(normalized), updatedAt: new Date().toISOString(), actor, action, sourceVersion }
  }
  definitionInput(input, fields) {
    if (!exact(input, fields)) throw new GeneratorWorkflowValidationError('Workflow mutation fields are invalid')
    return input
  }

  create(input) {
    return this.mutate(async () => {
      this.requireWriter()
      this.definitionInput(input, ['generatorId', 'generatorName', 'description', 'steps'])
      if (this.hasCurrent(input.generatorId) || this.legacy.has(input.generatorId)) throw new GeneratorWorkflowConflictError('Generator id is already in use')
      if (!this.defaultBuilderProfile) throw new GeneratorWorkflowValidationError('Dashboard workflow creation is not enabled by deployment')
      const row = this.makeRow({ format: 'workflow-v1', ...input, enabled: true, executionProfile: this.defaultBuilderProfile }, 1, 'dashboard-admin', 'create', 0)
      await this.putRolling(row); return projected(row)
    })
  }

  save(input) {
    return this.mutate(async () => {
      this.requireWriter()
      this.definitionInput(input, ['generatorId', 'generatorName', 'description', 'steps', 'expected'])
      const expected = reference(input.expected)
      const current = this.currentSync(input.generatorId)
      if (!current) {
        if (expected.kind !== 'legacy-v1') throw new GeneratorWorkflowConflictError('Generator workflow does not exist')
        const legacy = this.legacy.get(input.generatorId)
        if (!legacy) throw new GeneratorWorkflowConflictError('Legacy generator is unavailable for adoption')
        const adopt = async legacyRead => {
          if (!exact(legacyRead, ['reference', 'snapshot'])) throw new GeneratorWorkflowValidationError('Legacy workflow projection read is invalid')
          const actual = reference(legacyRead.reference)
          if (actual.kind !== 'legacy-v1' || actual.version !== expected.version || actual.sha256 !== expected.sha256) throw new GeneratorWorkflowConflictError('Legacy generator changed before adoption')
          const base = snapshotOf(legacyRead.snapshot)
          const row = this.makeRow({ ...base, generatorName: input.generatorName, description: input.description, steps: input.steps, enabled: true }, 1, 'dashboard-admin', 'adopt', 0)
          await this.putRolling(row); return projected(row)
        }
        return typeof legacy.adopt === 'function' ? legacy.adopt(expected, adopt) : adopt(await legacy.read())
      }
      assertMutable(current)
      if (expected.kind !== 'workflow-v1' || current.version !== expected.version || current.sha256 !== expected.sha256) throw new GeneratorWorkflowConflictError('Generator workflow version conflict')
      const row = this.makeRow({ ...current, generatorName: input.generatorName, description: input.description, steps: input.steps }, current.version + 1, 'dashboard-admin', 'update', current.version)
      await this.putRolling(row); return projected(row)
    })
  }

  setEnabled(input, enabled) {
    return this.mutate(async () => {
      this.requireWriter()
      this.definitionInput(input, ['generatorId', 'expected'])
      const expected = reference(input.expected); const current = this.currentSync(input.generatorId)
      assertMutable(current)
      if (!current || expected.kind !== 'workflow-v1' || current.version !== expected.version || current.sha256 !== expected.sha256) throw new GeneratorWorkflowConflictError('Generator workflow version conflict')
      if (current.enabled === enabled) throw new GeneratorWorkflowValidationError(`Generator workflow is already ${enabled ? 'enabled' : 'disabled'}`)
      const row = this.makeRow({ ...current, enabled }, current.version + 1, 'dashboard-admin', enabled ? 'enable' : 'disable', current.version)
      await this.putRolling(row); return projected(row)
    })
  }
  disable(input) { return this.setEnabled(input, false) }
  enable(input) { return this.setEnabled(input, true) }

  rollback(input) {
    return this.mutate(async () => {
      this.requireWriter()
      this.definitionInput(input, ['generatorId', 'expected', 'targetVersion'])
      const expected = reference(input.expected); const rows = this.rows(input.generatorId); const current = rows.at(-1)
      assertMutable(current)
      if (!current || expected.kind !== 'workflow-v1' || current.version !== expected.version || current.sha256 !== expected.sha256) throw new GeneratorWorkflowConflictError('Generator workflow version conflict')
      if (!Number.isInteger(input.targetVersion) || input.targetVersion < 1 || input.targetVersion >= current.version) throw new GeneratorWorkflowValidationError('targetVersion must be an earlier retained version')
      const target = rows.find(row => row.version === input.targetVersion)
      if (!target) throw new GeneratorWorkflowValidationError('Unknown or evicted generator workflow targetVersion')
      const row = this.makeRow({ ...target, executionProfile: current.executionProfile }, current.version + 1, 'dashboard-admin', 'rollback', target.version)
      await this.putRolling(row); return projected(row)
    })
  }

  deploymentRebind(generatorId, expected, profile) {
    return this.mutate(async () => {
      this.requireWriter()
      const current = this.currentSync(generatorId); const ref = reference(expected); const pinned = createDeploymentExecutionProfile(profile)
      const profileKey = `${pinned.id}:${pinned.version}:${pinned.sha256}`
      if (!this.profiles.has(profileKey)) throw new GeneratorWorkflowValidationError('Deployment execution profile runtime is unavailable')
      assertMutable(current)
      if (!current || ref.kind !== 'workflow-v1' || current.version !== ref.version || current.sha256 !== ref.sha256) throw new GeneratorWorkflowConflictError('Generator workflow version conflict')
      const row = this.makeRow({ ...current, executionProfile: pinned }, current.version + 1, 'deployment', 'deployment-rebind', current.version)
      await this.putRolling(row); return projected(row)
    })
  }

  deletionReplaySync(input) {
    this.definitionInput(input, ['generatorId', 'expected'])
    const expected = reference(input.expected)
    if (expected.kind !== 'workflow-v1') return undefined
    const current = this.currentSync(input.generatorId)
    return current?.action === 'delete' && current.sourceVersion === expected.version && current.sha256 === expected.sha256
      ? projected(current) : undefined
  }

  previewDelete(input) {
    return this.mutate(async () => {
      this.requireWriter()
      this.definitionInput(input, ['generatorId', 'expected'])
      const expected = reference(input.expected)
      const current = this.currentSync(input.generatorId)
      const replay = this.deletionReplaySync(input)
      if (replay) return { record: replay, replay: true }
      assertMutable(current)
      if (expected.kind !== 'workflow-v1') throw new GeneratorWorkflowConflictError('Legacy generator must be adopted before deletion', 'legacy_adoption_required')
      if (!current || current.version !== expected.version || current.sha256 !== expected.sha256) {
        throw new GeneratorWorkflowConflictError('Generator workflow version conflict')
      }
      if (current.enabled) throw new GeneratorWorkflowConflictError('Generator workflow must be archived before deletion', 'workflow_archive_required')
      return { record: projected(current), replay: false }
    })
  }

  delete(input) {
    return this.mutate(async () => {
      this.requireWriter()
      this.definitionInput(input, ['generatorId', 'expected'])
      const expected = reference(input.expected)
      const replay = this.deletionReplaySync(input)
      if (replay) return replay
      const current = this.currentSync(input.generatorId)
      assertMutable(current)
      if (expected.kind !== 'workflow-v1') throw new GeneratorWorkflowConflictError('Legacy generator must be adopted before deletion', 'legacy_adoption_required')
      if (!current || current.version !== expected.version || current.sha256 !== expected.sha256) {
        throw new GeneratorWorkflowConflictError('Generator workflow version conflict')
      }
      if (current.enabled) throw new GeneratorWorkflowConflictError('Generator workflow must be archived before deletion', 'workflow_archive_required')
      const row = this.makeRow(current, current.version + 1, 'dashboard-admin', 'delete', current.version)
      await this.putRolling(row)
      return projected(row)
    })
  }

  async reconcileExecutionProfiles() {
    if (!this.releaseWriterLock) return
    const plan = []
    for (const current of this.listCurrent()) {
      if (current.action === 'delete') continue
      const exactKey = `${current.executionProfile.id}:${current.executionProfile.version}:${current.executionProfile.sha256}`
      if (this.profiles.has(exactKey)) continue
      const candidates = [...this.profiles.values()].filter(profile => profile.id === current.executionProfile.id)
      if (candidates.length !== 1) {
        throw new GeneratorWorkflowValidationError(`Deployment execution profile reconciliation is ambiguous or unavailable: ${current.executionProfile.id}`)
      }
      plan.push({ generatorId: current.generatorId, expected: { kind: 'workflow-v1', version: current.version, sha256: current.sha256 }, profile: candidates[0] })
    }
    for (const item of plan) await this.deploymentRebind(item.generatorId, item.expected, item.profile)
  }
}

export default PrismGeneratorWorkflowStore
