import { isIP } from 'node:net'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { fetchParsedRssFeed, normalizeParsedRssFeed, validateRssFeedDefinition } from './shared/rss-source.js'
import { isPublicAddress, managedRssFetch } from './secure-rss-fetch.js'
import { fetchGitHubTrending, normalizeGitHubTrending, validateGitHubTrendingDefinition } from './shared/github-trending-source.js'
import { fetchFollowEntries, normalizeFollowEntries, validateFollowSourceDefinition } from './shared/follow-source.js'
import { buildAISearchPrompt, normalizeAISearchItems, parseAISearchItems } from './shared/ai-search-source.js'

export const name = 'prismflow-store-source-settings'

const SOURCE_TYPES = ['github-trending', 'rss', 'ai-search', 'follow']
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/
const SLOT_PATTERN = /^[a-zA-Z0-9_.:-]{1,128}$/
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const CREDENTIAL_USAGES = ['follow-cookie']
const ADAPTER_STATE_PREFIX = '@adapter:'

// Keep the storage envelope permissive so one malformed legacy/corrupt record can
// be isolated by the service instead of preventing the whole domain from opening.
export const managedSourceSchema = z.unknown()

export const prismSourceSettingsDomain = defineDomain({
  name: 'prismflow_source_settings', version: 1,
  tables: { sources: domainTable(managedSourceSchema) },
})

const SourceDefinition = Schema.object({
  type: Schema.union(SOURCE_TYPES).required(), id: Schema.string().required(), name: Schema.string().required(), category: Schema.string().default(''), enabled: Schema.boolean().default(true), limit: Schema.number(),
  since: Schema.union(['daily', 'weekly', 'monthly']), spokenLanguageCode: Schema.string(), url: Schema.string(), keyword: Schema.string(),
  listId: Schema.string(), feedId: Schema.string(), fetchDays: Schema.number(), fetchPages: Schema.number(), view: Schema.number(), pageDelayMs: Schema.number(), detailDelayMs: Schema.number(), credentialSlotId: Schema.string(),
})
const CredentialSlot = Schema.object({
  id: Schema.string().required(), name: Schema.string().required(), usage: Schema.union(CREDENTIAL_USAGES).required(),
  credentialRef: Schema.string().required(), allowDashboardWrite: Schema.boolean().default(false),
})
export const Config = Schema.object({
  credentialSlots: Schema.array(CredentialSlot).default([]),
  bootstrap: Schema.array(SourceDefinition).default([]),
})

export class ManagedSourceValidationError extends Error {
  constructor(message) { super(message); this.name = 'ManagedSourceValidationError' }
}

function invalid(message) { throw new ManagedSourceValidationError(message) }
function boundedText(value, field, maximum, required = true) {
  if (typeof value !== 'string') invalid(`${field} is invalid`)
  const result = value.trim()
  if ((required && !result) || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) invalid(`${field} is invalid`)
  return result
}
function boundedInteger(value, field, minimum, maximum, fallback) {
  const result = value === undefined ? fallback : value
  if (!Number.isInteger(result) || result < minimum || result > maximum) invalid(`${field} is invalid`)
  return result
}
export function assertSafeRssUrl(value) {
  const raw = boundedText(value, 'url', 2048)
  let parsed
  try { parsed = new URL(raw) } catch { invalid('RSS URL is invalid') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid('RSS URL must be credential-free HTTP or HTTPS')
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.home') || hostname.endsWith('.lan') || hostname.endsWith('.test') || hostname.endsWith('.invalid') || hostname === 'metadata.google.internal') invalid('RSS URL host is not allowed')
  const literal = hostname.replace(/^\[|\]$/g, '')
  const family = isIP(literal)
  if (family === 0 && !hostname.includes('.')) invalid('RSS URL host is not allowed')
  if (family !== 0 && !isPublicAddress(literal)) invalid('RSS URL host is not allowed')
  return parsed.toString()
}

export function normalizeManagedSource(input, existing, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Source configuration is invalid')
  if (!SOURCE_TYPES.includes(input.type)) invalid('type is invalid')
  const id = boundedText(input.id, 'id', 64)
  if (!ID_PATTERN.test(id)) invalid('id must match [a-zA-Z0-9_-]+')
  const name = boundedText(input.name, 'name', 128)
  const defaultCategory = { 'github-trending': 'githubTrending', rss: 'rss', 'ai-search': 'news', follow: 'paper' }[input.type]
  const category = boundedText(input.category || defaultCategory, 'category', 64)
  const enabled = input.enabled === undefined ? true : input.enabled
  if (typeof enabled !== 'boolean') invalid('enabled is invalid')
  const prefix = input.type
  const settingsId = `${prefix}:${id}`
  const timestamp = now.toISOString()
  const base = { settingsId, type: input.type, id, name, category, enabled, limit: 20, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp }
  if (input.type === 'github-trending') {
    const since = input.since ?? 'daily'
    if (!['daily', 'weekly', 'monthly'].includes(since)) invalid('since is invalid')
    return { ...base, limit: boundedInteger(input.limit, 'limit', 1, 100, 25), since, spokenLanguageCode: boundedText(input.spokenLanguageCode ?? '', 'spokenLanguageCode', 16, false) }
  }
  if (input.type === 'rss') return { ...base, limit: boundedInteger(input.limit, 'limit', 1, 1000, 20), url: assertSafeRssUrl(input.url) }
  if (input.type === 'ai-search') return { ...base, limit: boundedInteger(input.limit, 'limit', 1, 50, 10), keyword: boundedText(input.keyword, 'keyword', 500) }
  const listId = input.listId === undefined ? undefined : boundedText(input.listId, 'listId', 128, false)
  const feedId = input.feedId === undefined ? undefined : boundedText(input.feedId, 'feedId', 128, false)
  if ((!listId && !feedId) || (listId && feedId)) invalid('Follow requires exactly one listId or feedId')
  const credentialSlotId = input.credentialSlotId === undefined || input.credentialSlotId === '' ? undefined : boundedText(input.credentialSlotId, 'credentialSlotId', 128)
  return { ...base, limit: boundedInteger(input.limit, 'limit', 1, 2000, 50), ...(listId ? { listId } : { feedId }), fetchDays: boundedInteger(input.fetchDays, 'fetchDays', 1, 365, 3), fetchPages: boundedInteger(input.fetchPages, 'fetchPages', 1, 20, 1), view: boundedInteger(input.view, 'view', 0, 100, 0), pageDelayMs: boundedInteger(input.pageDelayMs, 'pageDelayMs', 0, 60_000, 1500), detailDelayMs: boundedInteger(input.detailDelayMs, 'detailDelayMs', 0, 60_000, 400), ...(credentialSlotId ? { credentialSlotId } : {}) }
}

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: false, properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, url: { type: 'string' }, description: { type: 'string' }, content: { type: 'string' }, author: { type: 'string' }, published_date: { type: 'string' }, metadata: { type: 'object', additionalProperties: true } }, required: ['title', 'url', 'description', 'content'] } } }, required: ['items'] }
function outputText(blocks) { return blocks.filter(block => block?.type === 'text').map(block => block.text).join('') }
function requestedLimit(request, configuredLimit) {
  const value = request?.limit
  if (value === undefined) return configuredLimit
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new ManagedSourceValidationError('limit must be a positive integer')
  }
  return Math.min(value, configuredLimit)
}
function adapterStateKey(type) { return `${ADAPTER_STATE_PREFIX}${type}` }
async function settleRun(run) {
  const [execution] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') throw new AggregateError([execution.reason, disposal.reason], 'AI Search execution and disposal failed')
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

export class PrismSourceSettings extends Service {
  static inject = ['storageDomain', 'prismSources', 'subagents', 'credentials']
  constructor(ctx, config = {}) {
    super(ctx, 'prismSourceSettings')
    this.config = config
    this.sources = undefined
    this.domain = undefined
    this.registrations = new Map()
    this.active = new Map()
    this.operationTail = Promise.resolve()
    this.disposing = false
    this.adapterEnabled = new Map(SOURCE_TYPES.map(type => [type, true]))
    this.slots = new Map()
    for (const slot of config.credentialSlots ?? []) {
      if (!SLOT_PATTERN.test(slot.id) || typeof slot.name !== 'string' || !slot.name.trim() || slot.name.length > 128
        || !CREDENTIAL_USAGES.includes(slot.usage) || typeof slot.credentialRef !== 'string'
        || !CREDENTIAL_REF_PATTERN.test(slot.credentialRef) || typeof slot.allowDashboardWrite !== 'boolean') {
        throw new Error('Invalid managed source credential slot configuration')
      }
      if (this.slots.has(slot.id)) throw new Error(`Duplicate managed source credential slot: ${slot.id}`)
      this.slots.set(slot.id, {
        id: slot.id, name: slot.name.trim(), usage: slot.usage,
        credentialRef: slot.credentialRef, allowDashboardWrite: slot.allowDashboardWrite,
      })
    }
  }
  async [Service.init]() {
    this.domain = await this.ctx.storageDomain.open(prismSourceSettingsDomain)
    this.sources = this.domain.table('sources')
    try {
      if (Array.from(this.sources.entries()).length === 0) await this.bootstrap()
      for (const type of SOURCE_TYPES) {
        const value = this.sources.get(adapterStateKey(type))
        if (value === undefined) continue
        if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'adapter-state' || value.type !== type || typeof value.enabled !== 'boolean') {
          this.ctx.logger?.warn(`ignored invalid PrismFlow managed adapter state: ${type}`)
          continue
        }
        this.adapterEnabled.set(type, value.enabled)
      }
      for (const [settingsId, value] of this.sources.entries()) {
        if (typeof settingsId === 'string' && settingsId.startsWith(ADAPTER_STATE_PREFIX)) continue
        try {
          const updatedAt = value && typeof value === 'object' && !Array.isArray(value) && typeof value.updatedAt === 'string' ? new Date(value.updatedAt) : new Date(0)
          const record = normalizeManagedSource(value, value, updatedAt)
          if (record.settingsId !== settingsId || (record.credentialSlotId && !this.slots.has(record.credentialSlotId))) throw new ManagedSourceValidationError('Stored source is invalid')
          if (record.enabled && this.isAdapterEnabled(record.type) && !this.registrations.has(record.settingsId)) this.start(record)
        } catch {
          this.ctx.logger?.warn(`ignored invalid PrismFlow managed source record: ${String(settingsId).slice(0, 128)}`)
        }
      }
    } catch (error) {
      await Promise.allSettled([...this.registrations.keys()].map(id => this.stop(id)))
      await this.domain.close()
      throw error
    }
    this.ctx.effect(() => async () => {
      this.disposing = true
      await this.operationTail
      await Promise.allSettled([...this.registrations.keys()].map(id => this.stop(id)))
      await this.domain.close()
    }, 'prismflow-source-settings.domainClose')
  }
  async bootstrap() {
    const table = this.requireSources()
    const seen = new Set()
    const occupied = new Set(this.ctx.prismSources.list().map(source => source.id))
    const candidates = []
    for (const input of this.config.bootstrap ?? []) {
      try {
        const record = normalizeManagedSource(input)
        if (seen.has(record.settingsId)) throw new ManagedSourceValidationError('Duplicate bootstrap source')
        seen.add(record.settingsId)
        if (occupied.has(record.settingsId)) throw new ManagedSourceValidationError('Bootstrap source collides with an existing provider')
        if (record.credentialSlotId && !this.slots.has(record.credentialSlotId)) throw new ManagedSourceValidationError('Unknown credential slot')
        candidates.push(record)
      } catch (error) {
        if (!(error instanceof ManagedSourceValidationError)) throw error
        this.ctx.logger?.warn('ignored invalid PrismFlow managed source bootstrap record')
      }
    }

    const accepted = []
    for (const record of candidates) {
      try {
        if (record.enabled) this.start(record)
        accepted.push(record)
      } catch (error) {
        if (!this.ctx.prismSources.list().some(source => source.id === record.settingsId)) throw error
        this.ctx.logger?.warn('ignored conflicting PrismFlow managed source bootstrap record')
      }
    }

    const attempted = []
    try {
      for (const record of accepted) {
        attempted.push(record.settingsId)
        await table.put(record.settingsId, record)
      }
    } catch (writeError) {
      const rollbackErrors = []
      for (const record of accepted) {
        if (record.enabled) {
          try { await this.stop(record.settingsId) } catch (error) { rollbackErrors.push(error) }
        }
      }
      for (const settingsId of attempted.reverse()) {
        try { await table.delete(settingsId) } catch (error) { rollbackErrors.push(error) }
      }
      if (rollbackErrors.length) throw new AggregateError([writeError, ...rollbackErrors], 'PrismFlow managed source bootstrap and rollback failed')
      throw writeError
    }
  }
  list() {
    const records = []
    for (const [settingsId, value] of this.requireSources().entries()) {
      if (typeof settingsId === 'string' && settingsId.startsWith(ADAPTER_STATE_PREFIX)) continue
      try {
        const updatedAt = typeof value?.updatedAt === 'string' ? new Date(value.updatedAt) : new Date(0)
        const record = normalizeManagedSource(value, value, updatedAt)
        if (record.settingsId === settingsId && (!record.credentialSlotId || this.slots.has(record.credentialSlotId))
          && (!record.enabled || !this.isAdapterEnabled(record.type) || this.registrations.has(record.settingsId))) records.push(record)
      } catch {}
    }
    return records.sort((a, b) => a.settingsId.localeCompare(b.settingsId))
  }
  isAdapterEnabled(type) { return this.adapterEnabled.get(type) !== false }
  adapterStates() { return SOURCE_TYPES.map(type => ({ type, enabled: this.isAdapterEnabled(type) })) }
  async describeCredentialSlots() {
    const projected = []
    for (const slot of this.slots.values()) {
      let info
      try { info = await this.ctx.credentials.describe(slot.credentialRef) }
      catch { throw new Error(`Credential status could not be read for slot: ${slot.id}`) }
      projected.push({
        id: slot.id, name: slot.name, usage: slot.usage,
        configured: info?.configured === true,
        ...(typeof info?.source === 'string' ? { source: info.source } : {}),
        writable: info?.writable === true,
        allowDashboardWrite: slot.allowDashboardWrite,
      })
    }
    return projected
  }
  setCredential(slotId, value) {
    return this.enqueue(async () => {
      const slot = this.requireWritableSlot(slotId)
      await this.assertProviderWritable(slot)
      if (typeof value !== 'string' || value.length < 1 || value.length > 16 * 1024 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new ManagedSourceValidationError('Credential value is invalid')
      }
      try { await this.ctx.credentials.set(slot.credentialRef, value) }
      catch { throw new Error(`Credential could not be stored for slot: ${slot.id}`) }
      return { slotId: slot.id }
    })
  }
  unsetCredential(slotId) {
    return this.enqueue(async () => {
      const slot = this.requireWritableSlot(slotId)
      await this.assertProviderWritable(slot)
      try { await this.ctx.credentials.unset(slot.credentialRef) }
      catch { throw new Error(`Credential could not be removed for slot: ${slot.id}`) }
      return { slotId: slot.id }
    })
  }
  requireWritableSlot(slotId) {
    if (typeof slotId !== 'string' || !SLOT_PATTERN.test(slotId)) throw new ManagedSourceValidationError('Credential slot is invalid')
    const slot = this.slots.get(slotId)
    if (!slot) throw new ManagedSourceValidationError('Unknown credential slot')
    if (!slot.allowDashboardWrite) throw new ManagedSourceValidationError('Credential slot is read-only in the Dashboard')
    return slot
  }
  async assertProviderWritable(slot) {
    let info
    try { info = await this.ctx.credentials.describe(slot.credentialRef) }
    catch { throw new Error(`Credential status could not be read for slot: ${slot.id}`) }
    if (info?.writable !== true) throw new ManagedSourceValidationError('Credential slot is read-only in the Dashboard')
  }
  setAdapterEnabled(type, enabled) {
    return this.enqueue(async () => {
      if (!SOURCE_TYPES.includes(type) || typeof enabled !== 'boolean') throw new ManagedSourceValidationError('Adapter state is invalid')
      const previous = this.isAdapterEnabled(type)
      if (previous === enabled) return { type, enabled }
      const records = this.list().filter(record => record.type === type && record.enabled)
      const changed = []
      try {
        if (enabled) {
          for (const record of records) { this.start(record); changed.push(record.settingsId) }
        } else {
          for (const record of records) { await this.stop(record.settingsId); changed.push(record.settingsId) }
        }
        await this.requireSources().put(adapterStateKey(type), { kind: 'adapter-state', type, enabled, updatedAt: new Date().toISOString() })
        this.adapterEnabled.set(type, enabled)
        return { type, enabled }
      } catch (error) {
        if (enabled) {
          for (const settingsId of changed.reverse()) await this.stop(settingsId)
        } else {
          const rollbackErrors = []
          for (const record of records) {
            if (!this.registrations.has(record.settingsId)) {
              try { this.start(record) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
            }
          }
          if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Adapter state update and rollback failed')
        }
        throw error
      }
    })
  }
  save(input, options = {}) {
    return this.enqueue(async () => {
      const { mode, expectedSettingsId, expectedUpdatedAt } = options
      if (!['create', 'update'].includes(mode)) throw new ManagedSourceValidationError('Source save mode is invalid')
      const table = this.requireSources()
      const identity = normalizeManagedSource(input)
      const existing = table.get(identity.settingsId)
      if (mode === 'create') {
        if (existing !== undefined) throw new ManagedSourceValidationError('Source identity already exists')
      } else {
        if (typeof expectedSettingsId !== 'string' || typeof expectedUpdatedAt !== 'string') throw new ManagedSourceValidationError('Source update precondition is required')
        if (expectedSettingsId !== identity.settingsId) throw new ManagedSourceValidationError('Source identity cannot change while editing')
        if (!existing || existing.updatedAt !== expectedUpdatedAt) throw new ManagedSourceValidationError('Source was changed by another editor; refresh and retry')
      }
      const now = new Date()
      if (existing?.updatedAt && now.toISOString() <= existing.updatedAt) now.setTime(Date.parse(existing.updatedAt) + 1)
      const record = normalizeManagedSource(input, existing, now)
      if (record.credentialSlotId && !this.slots.has(record.credentialSlotId)) throw new ManagedSourceValidationError('Unknown credential slot')
      if (existing && existing.type !== record.type) throw new ManagedSourceValidationError('Source identity cannot change')
      const wasRegistered = this.registrations.has(record.settingsId)
      if (wasRegistered) await this.stop(record.settingsId)
      let started = false
      try {
        if (record.enabled && this.isAdapterEnabled(record.type)) { this.start(record); started = true }
        await table.put(record.settingsId, record)
        return record
      } catch (error) {
        if (started) await this.stop(record.settingsId)
        if (wasRegistered) this.start(existing)
        throw error
      }
    })
  }
  delete(settingsId) {
    return this.enqueue(async () => {
      if (typeof settingsId !== 'string' || settingsId.length > 96) throw new ManagedSourceValidationError('settingsId is invalid')
      const table = this.requireSources(); const existing = table.get(settingsId)
      if (!existing) throw new ManagedSourceValidationError('Unknown managed source')
      if (existing.enabled) await this.stop(settingsId)
      try { await table.delete(settingsId); return existing }
      catch (error) { if (existing.enabled && this.isAdapterEnabled(existing.type)) this.start(existing); throw error }
    })
  }
  enqueue(operation) {
    if (this.disposing) return Promise.reject(new Error('PrismFlow source settings are stopping'))
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
  start(record) {
    if (this.registrations.has(record.settingsId)) throw new Error(`Managed PrismFlow source is already registered: ${record.settingsId}`)
    const provider = this.provider(record)
    const dispose = this.ctx.prismSources.register({ ...provider, fetch: (request = {}, execution = {}) => this.trackFetch(record.settingsId, provider.fetch, request, execution) })
    this.registrations.set(record.settingsId, dispose)
  }
  async stop(settingsId) {
    const dispose = this.registrations.get(settingsId)
    if (dispose) { this.registrations.delete(settingsId); dispose() }
    const state = this.active.get(settingsId)
    if (!state) return
    for (const controller of state.controllers) controller.abort(new Error('Managed PrismFlow source configuration changed'))
    await Promise.allSettled([...state.operations])
    this.active.delete(settingsId)
  }
  trackFetch(settingsId, fetcher, request, execution) {
    if (this.disposing) return Promise.reject(new Error('PrismFlow source settings are stopping'))
    let state = this.active.get(settingsId)
    if (!state) { state = { controllers: new Set(), operations: new Set() }; this.active.set(settingsId, state) }
    const controller = new AbortController(); state.controllers.add(controller)
    const signal = execution.signal ? AbortSignal.any([execution.signal, controller.signal]) : controller.signal
    const operation = Promise.resolve().then(() => fetcher(request, { ...execution, signal }))
    state.operations.add(operation)
    operation.finally(() => { state.controllers.delete(controller); state.operations.delete(operation); if (!state.operations.size && !this.registrations.has(settingsId)) this.active.delete(settingsId) }).catch(() => {})
    return operation
  }
  provider(record) {
    if (record.type === 'rss') {
      const feed = { id: record.id, name: record.name, url: record.url, category: record.category, limit: record.limit }; validateRssFeedDefinition(feed)
      return { id: record.settingsId, name: record.name, description: `Fetch managed RSS/Atom feed ${record.name}.`, fetch: async (request, execution) => normalizeParsedRssFeed(await fetchParsedRssFeed(feed, { limit: requestedLimit(request, record.limit), signal: execution.signal, userAgent: 'PrismFlow-DSH/0.6', fetchImpl: managedRssFetch }), { feedId: record.id, name: record.name, category: record.category }) }
    }
    if (record.type === 'github-trending') {
      const source = { id: record.id, name: record.name, baseUrl: 'https://github.com/trending', category: record.category, since: record.since, spokenLanguageCode: record.spokenLanguageCode, limit: record.limit }; validateGitHubTrendingDefinition(source)
      return { id: record.settingsId, name: record.name, description: `Fetch managed GitHub Trending repositories for the ${record.since} range.`, fetch: async (request, execution) => normalizeGitHubTrending(await fetchGitHubTrending(source, { limit: requestedLimit(request, record.limit), signal: execution.signal, userAgent: 'PrismFlow-DSH/0.6' }), { sourceName: record.name, category: record.category }) }
    }
    if (record.type === 'follow') {
      const source = { id: record.id, name: record.name, apiUrl: 'https://api.folo.is/entries', category: record.category, listId: record.listId, feedId: record.feedId, fetchDays: record.fetchDays, fetchPages: record.fetchPages, view: record.view, limit: record.limit, pageDelayMs: record.pageDelayMs, detailDelayMs: record.detailDelayMs }; validateFollowSourceDefinition(source)
      return { id: record.settingsId, name: record.name, description: `Fetch managed Follow ${record.listId ? 'list' : 'feed'} ${record.name}.`, fetch: async (request, execution) => {
        const limit = requestedLimit(request, record.limit)
        const slot = record.credentialSlotId ? this.slots.get(record.credentialSlotId) : undefined
        let credential
        try { credential = slot ? await this.ctx.credentials.resolve(slot.credentialRef) : undefined }
        catch { throw new Error(`Follow credential could not be resolved for source: ${record.settingsId}`) }
        if (slot && (typeof credential?.value !== 'string' || !credential.value.trim())) throw new Error(`Follow credential could not be resolved for source: ${record.settingsId}`)
        const options = { cookie: credential?.value, signal: execution.signal, pageDelayMs: record.pageDelayMs, detailDelayMs: record.detailDelayMs }
        const raw = await fetchFollowEntries(source, options)
        return await normalizeFollowEntries(raw, source, { ...options, limit })
      } }
    }
    return { id: record.settingsId, name: record.name, description: `Research current information for the managed keyword: ${record.keyword}.`, requiresAgent: true, fetch: async (request, execution) => {
      if (!execution.agent) throw new Error('AI Search requires a model-driven DSH tool call with a parent agent')
      const limit = requestedLimit(request, record.limit)
      const run = await this.ctx.subagents.start('spawn', { label: `search ${record.id}`, prompt: [{ type: 'text', text: buildAISearchPrompt(record.keyword, limit) }], parent: execution.agent, signal: execution.signal, outputSchema: OUTPUT_SCHEMA, persona: 'You are a careful web researcher. Use only verified web-search results, never invent URLs or facts, and finish through the structured-output tool.', toolFilter: { allow: ['web_search'] } })
      const result = await settleRun(run)
      if (result.stopReason !== 'completed') throw new Error(`AI Search subagent stopped with reason: ${result.stopReason}`)
      const structured = result.structured && typeof result.structured === 'object' && Array.isArray(result.structured.items) ? result.structured.items : undefined
      const items = structured ?? parseAISearchItems(outputText(result.output))
      if (!items.length) throw new Error('AI Search subagent returned no structured search items')
      return normalizeAISearchItems(items.slice(0, limit), { sourceName: record.name, category: record.category, keyword: record.keyword, executorId: 'dsh-subagent:spawn' })
    } }
  }
  requireSources() { if (!this.sources) throw new Error('PrismFlow source settings are not initialized'); return this.sources }
}

export default PrismSourceSettings
