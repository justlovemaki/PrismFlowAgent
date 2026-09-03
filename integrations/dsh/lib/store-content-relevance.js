import { setImmediate as yieldEventLoop } from 'node:timers/promises'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  AI_RELEVANCE_CLASSIFIER_VERSION,
  aiRelevanceContentHash,
  aiRelevanceInputChars,
  aiRelevanceProfileFingerprint,
  assessAIRelevance,
  buildAIRelevanceCard,
} from './shared/ai-relevance.js'

export const name = 'prismflow-store-content-relevance'
export const inject = ['storageDomain', 'prismContentStore']

export const Config = Schema.object({
  defaultHours: Schema.number().step(1).min(1).max(168).default(48),
  maxSnapshotRecords: Schema.number().step(1).min(1).max(1000000).default(100000),
  maxCandidateRecords: Schema.number().step(1).min(1).max(100000).default(10000),
  maxHashCharsPerRecord: Schema.number().step(1).min(4096).max(10000000).default(2000000),
  maxAggregateHashChars: Schema.number().step(1).min(1048576).max(2000000000).default(1500000000),
  maxScanCharsPerRecord: Schema.number().step(1).min(4096).max(2000000).default(524288),
  maxAggregateScanChars: Schema.number().step(1).min(1048576).max(2000000000).default(1500000000),
  maxEvidence: Schema.number().step(1).min(1).max(32).default(8),
  maxEvidenceChars: Schema.number().step(1).min(40).max(500).default(160),
  maxCardChars: Schema.number().step(1).min(512).max(8000).default(2000),
})

// A permissive envelope lets the service isolate one corrupt derived row.
export const prismContentRelevanceDomain = defineDomain({
  name: 'prismflow_content_relevance', version: 1,
  tables: { assessments: domainTable(z.unknown()) },
})

const VERDICTS = new Set(['matched-ai', 'ambiguous', 'unmatched', 'error'])
const TOPICS = new Set([
  'foundation-models', 'machine-learning', 'agents-rag-inference',
  'multimodal-generative-ai', 'frameworks-deployment', 'ai-compute',
  'robotics-autonomy', 'safety-governance', 'ai-companies-funding',
])
const EVIDENCE_FIELDS = new Set(['title', 'description', 'content', 'ai_summary', 'source', 'category'])

function boundedString(value, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.length === 0)
    || /[\u0000-\u001f\u007f]/u.test(value)) return undefined
  return value
}
function validIso(value) {
  if (typeof value !== 'string' || value.length > 40) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}
function validAssessment(raw, expectedKey) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const storeId = boundedString(raw.storeId, 128)
  const sourceId = boundedString(raw.sourceId, 256)
  if (!storeId || !sourceId || (expectedKey !== undefined && storeId !== expectedKey)
    || !/^[a-f0-9]{64}$/u.test(raw.contentHash ?? '')
    || raw.classifierVersion !== AI_RELEVANCE_CLASSIFIER_VERSION
    || !/^[a-f0-9]{64}$/u.test(raw.profileFingerprint ?? '')
    || !VERDICTS.has(raw.verdict)
    || !Array.isArray(raw.topics) || raw.topics.length > TOPICS.size
    || raw.topics.some(topic => typeof topic !== 'string' || !TOPICS.has(topic))
    || new Set(raw.topics).size !== raw.topics.length
    || !Array.isArray(raw.reasonCodes) || raw.reasonCodes.length > 16
    || raw.reasonCodes.some(code => !boundedString(code, 128))
    || !Array.isArray(raw.evidence) || raw.evidence.length > 32
    || !Number.isInteger(raw.scannedChars) || raw.scannedChars < 0 || raw.scannedChars > 2_000_000
    || typeof raw.truncated !== 'boolean' || !validIso(raw.assessedAt)) return undefined
  const evidence = []
  for (const item of raw.evidence) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !EVIDENCE_FIELDS.has(item.field)
      || (item.topic !== undefined && !TOPICS.has(item.topic))
      || !boundedString(item.phrase, 200)
      || !boundedString(item.excerpt, 500, { allowEmpty: true })) return undefined
    evidence.push({
      field: item.field,
      ...(item.topic ? { topic: item.topic } : {}),
      phrase: item.phrase,
      excerpt: item.excerpt,
    })
  }
  return {
    storeId, sourceId, contentHash: raw.contentHash,
    classifierVersion: raw.classifierVersion, profileFingerprint: raw.profileFingerprint,
    verdict: raw.verdict, topics: [...raw.topics], reasonCodes: [...raw.reasonCodes], evidence,
    scannedChars: raw.scannedChars, truncated: raw.truncated, assessedAt: raw.assessedAt,
  }
}

function configInteger(value, fallback, field, min, max) {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${field} is invalid`)
  return result
}
function normalizeConfig(config) {
  return {
    defaultHours: configInteger(config.defaultHours, 48, 'defaultHours', 1, 168),
    maxSnapshotRecords: configInteger(config.maxSnapshotRecords, 100_000, 'maxSnapshotRecords', 1, 1_000_000),
    maxCandidateRecords: configInteger(config.maxCandidateRecords, 10_000, 'maxCandidateRecords', 1, 100_000),
    maxHashCharsPerRecord: configInteger(config.maxHashCharsPerRecord, 2_000_000, 'maxHashCharsPerRecord', 4096, 10_000_000),
    maxAggregateHashChars: configInteger(config.maxAggregateHashChars, 1_500_000_000, 'maxAggregateHashChars', 1_048_576, 2_000_000_000),
    maxScanCharsPerRecord: configInteger(config.maxScanCharsPerRecord, 524_288, 'maxScanCharsPerRecord', 4096, 2_000_000),
    maxAggregateScanChars: configInteger(config.maxAggregateScanChars, 1_500_000_000, 'maxAggregateScanChars', 1_048_576, 2_000_000_000),
    maxEvidence: configInteger(config.maxEvidence, 8, 'maxEvidence', 1, 32),
    maxEvidenceChars: configInteger(config.maxEvidenceChars, 160, 'maxEvidenceChars', 40, 500),
    maxCardChars: configInteger(config.maxCardChars, 2000, 'maxCardChars', 512, 8000),
  }
}
function timestampFor(record) {
  const published = typeof record.item.published_date === 'string' ? Date.parse(record.item.published_date) : NaN
  if (Number.isFinite(published)) return { timestamp: published, basis: 'published_date' }
  const firstSeen = Date.parse(record.firstSeenAt ?? '')
  return Number.isFinite(firstSeen) ? { timestamp: firstSeen, basis: 'firstSeenAt' } : undefined
}
function safeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || !raw.item || typeof raw.item !== 'object' || Array.isArray(raw.item)) return undefined
  const storeId = boundedString(raw.storeId, 128)
  const sourceId = boundedString(raw.sourceId, 128)
  if (!storeId || !sourceId) return undefined
  const effective = timestampFor(raw)
  if (!effective) return undefined
  return { record: raw, effective, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '' }
}
function boundedFilter(value, field, max = 128) {
  if (value === undefined) return undefined
  const result = boundedString(value, max)
  if (!result) throw new Error(`${field} is invalid`)
  return result
}
function boundedHours(value, fallback) {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < 1 || result > 168) throw new Error('hours must be an integer from 1 to 168')
  return result
}
function boundedAsOf(value) {
  if (value === undefined) return new Date()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('asOf is invalid')
  return new Date(value.getTime())
}
function candidateSnapshot(contentStore, query, config) {
  const asOf = boundedAsOf(query.asOf)
  const hours = boundedHours(query.hours, config.defaultHours)
  const sourceId = boundedFilter(query.sourceId, 'sourceId')
  const category = boundedFilter(query.category, 'category')
  const afterMs = asOf.getTime() - hours * 60 * 60 * 1000
  const records = []
  let malformed = 0
  for (const raw of contentStore.snapshot(config.maxSnapshotRecords)) {
    const safe = safeRecord(raw)
    if (!safe) { malformed += 1; continue }
    if (safe.effective.timestamp < afterMs || safe.effective.timestamp > asOf.getTime()) continue
    if (sourceId && safe.record.sourceId !== sourceId) continue
    if (category && safe.record.item.category !== category) continue
    if (records.length >= config.maxCandidateRecords) {
      throw new Error(`AI relevance window exceeds the configured ${config.maxCandidateRecords}-candidate limit`)
    }
    records.push(safe)
  }
  records.sort((left, right) => right.effective.timestamp - left.effective.timestamp
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.record.storeId.localeCompare(right.record.storeId))
  return { asOf, hours, after: new Date(afterMs), records, malformed }
}
function throwIfAborted(signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error(`AI relevance preparation aborted: ${String(signal.reason ?? 'aborted')}`)
}

export class PrismContentRelevanceStore extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismContentRelevance')
    this.config = normalizeConfig(config)
    this.profileFingerprint = aiRelevanceProfileFingerprint(this.config)
    this.assessments = undefined
    this.mutationTail = Promise.resolve()
    this.activePrepare = undefined
    this.activeReads = new Set()
    this.stopping = false
    this.shutdownController = new AbortController()
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(prismContentRelevanceDomain)
    this.assessments = domain.table('assessments')
    try {
      this.ctx.effect(() => async () => { await this.shutdown(); await domain.close() }, 'prismflow-content-relevance.domainClose')
    } catch (error) {
      this.assessments = undefined
      await domain.close()
      throw error
    }
  }

  prepare(query = {}, execution = {}) {
    if (this.stopping) return Promise.reject(new Error('AI relevance store is stopping'))
    if (this.activePrepare) return Promise.reject(new Error('AI relevance preparation is already running'))
    const signals = [execution.signal, this.shutdownController.signal].filter(Boolean)
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
    const operation = this.prepareInner(query, signal)
    this.activePrepare = operation
    operation.finally(() => { if (this.activePrepare === operation) this.activePrepare = undefined }).catch(() => {})
    return operation
  }

  async prepareInner(query, signal) {
    const snapshot = candidateSnapshot(this.ctx.prismContentStore, query, this.config)
    const summary = {
      asOf: snapshot.asOf.toISOString(), since: snapshot.after.toISOString(), hours: snapshot.hours,
      candidateCount: snapshot.records.length, cached: 0, assessed: 0,
      matchedAi: 0, ambiguous: 0, unmatched: 0, failed: 0,
      incomplete: 0, malformed: snapshot.malformed, complete: true,
    }
    let hashedChars = 0
    let scannedChars = 0
    let index = 0
    for (const { record } of snapshot.records) {
      throwIfAborted(signal)
      if ((index += 1) % 25 === 0) { await yieldEventLoop(); throwIfAborted(signal) }
      let hash
      try {
        const inputChars = aiRelevanceInputChars(record)
        const hashCharge = Math.max(inputChars, 1)
        if (inputChars > this.config.maxHashCharsPerRecord
          || hashedChars + hashCharge > this.config.maxAggregateHashChars) {
          summary.incomplete += 1; summary.complete = false; continue
        }
        hashedChars += hashCharge
        hash = aiRelevanceContentHash(record, this.config.maxHashCharsPerRecord)
        throwIfAborted(signal)
        const cached = this.currentAssessment(record.storeId, hash)
        if (cached && cached.verdict !== 'error') {
          summary.cached += 1
          if (cached.verdict === 'matched-ai') summary.matchedAi += 1
          else if (cached.verdict === 'ambiguous') summary.ambiguous += 1
          else summary.unmatched += 1
          continue
        }
        const requiredScanChars = Math.max(1, Math.min(inputChars, this.config.maxScanCharsPerRecord))
        if (scannedChars + requiredScanChars > this.config.maxAggregateScanChars) {
          summary.incomplete += 1; summary.complete = false; continue
        }
        const result = assessAIRelevance(record, {
          maxScanChars: this.config.maxScanCharsPerRecord,
          maxEvidence: this.config.maxEvidence,
          maxEvidenceChars: this.config.maxEvidenceChars,
        })
        scannedChars += result.scannedChars
        const assessment = {
          storeId: record.storeId, sourceId: record.sourceId, contentHash: hash,
          classifierVersion: AI_RELEVANCE_CLASSIFIER_VERSION,
          profileFingerprint: this.profileFingerprint,
          ...result, assessedAt: new Date().toISOString(),
        }
        throwIfAborted(signal)
        await this.mutate(() => this.requireAssessments().put(record.storeId, assessment))
        throwIfAborted(signal)
        summary.assessed += 1
        if (assessment.verdict === 'matched-ai') summary.matchedAi += 1
        else if (assessment.verdict === 'ambiguous') summary.ambiguous += 1
        else summary.unmatched += 1
      } catch (error) {
        if (signal?.aborted) throwIfAborted(signal)
        summary.failed += 1
        if (typeof hash === 'string') {
          const failed = {
            storeId: record.storeId, sourceId: record.sourceId, contentHash: hash,
            classifierVersion: AI_RELEVANCE_CLASSIFIER_VERSION, profileFingerprint: this.profileFingerprint,
            verdict: 'error', topics: [], reasonCodes: ['assessment-failed'], evidence: [],
            scannedChars: 0, truncated: false, assessedAt: new Date().toISOString(),
          }
          try { await this.mutate(() => this.requireAssessments().put(record.storeId, failed)) } catch { /* next run retries */ }
        }
      }
    }
    if (summary.failed > 0 || summary.incomplete > 0 || summary.malformed > 0) summary.complete = false
    return summary
  }

  async snapshotCurrent(query = {}, execution = {}) {
    const prepared = await this.prepare(query, execution)
    if (!prepared.complete) throw new Error('AI relevance coverage is incomplete for the frozen window')
    return this.trackRead(async signal => {
      const snapshot = candidateSnapshot(this.ctx.prismContentStore, { ...query, asOf: new Date(prepared.asOf) }, this.config)
      const matched = []
      const ambiguous = []
      const unmatched = []
      let hashedChars = 0
      let index = 0
      for (const { record, effective } of snapshot.records) {
        throwIfAborted(signal)
        if ((index += 1) % 25 === 0) { await yieldEventLoop(); throwIfAborted(signal) }
        const chars = aiRelevanceInputChars(record)
        const charge = Math.max(chars, 1)
        if (chars > this.config.maxHashCharsPerRecord || hashedChars + charge > this.config.maxAggregateHashChars) {
          throw new Error('AI relevance snapshot hash budget was exceeded after preparation')
        }
        hashedChars += charge
        const contentHash = aiRelevanceContentHash(record, this.config.maxHashCharsPerRecord)
        const assessment = this.currentAssessment(record.storeId, contentHash)
        if (!assessment || assessment.verdict === 'error') throw new Error('AI relevance snapshot contains a missing, stale, or failed assessment')
        const claim = {
          record, assessment, contentHash, effectiveTimestamp: effective.timestamp,
          timestampBasis: effective.basis,
          card: buildAIRelevanceCard(record, assessment, this.config.maxCardChars),
        }
        if (assessment.verdict === 'matched-ai') matched.push(claim)
        else if (assessment.verdict === 'ambiguous') ambiguous.push(claim)
        else unmatched.push(claim)
      }
      return {
        asOf: prepared.asOf, since: prepared.since, hours: prepared.hours,
        classifierVersion: AI_RELEVANCE_CLASSIFIER_VERSION,
        relevanceProfileFingerprint: this.profileFingerprint,
        candidateCount: snapshot.records.length, matched, ambiguous, unmatched,
      }
    }, execution)
  }

  revalidateClaims(claims) {
    if (!Array.isArray(claims)) throw new Error('AI relevance claims are invalid')
    for (const claim of claims) {
      const record = this.ctx.prismContentStore.get(claim.storeId)
      if (!record) throw new Error(`Selected content is no longer available: ${claim.storeId}`)
      const hash = aiRelevanceContentHash(record, this.config.maxHashCharsPerRecord)
      if (hash !== claim.contentHash) throw new Error(`Selected content changed during selection: ${claim.storeId}`)
    }
    return true
  }

  coverage(query = {}, execution = {}) {
    return this.trackRead(signal => this.coverageInner(query, signal), execution)
  }
  async coverageInner(query, signal) {
    const snapshot = candidateSnapshot(this.ctx.prismContentStore, query, this.config)
    const result = {
      asOf: snapshot.asOf.toISOString(), since: snapshot.after.toISOString(), hours: snapshot.hours,
      candidateCount: snapshot.records.length, currentAssessments: 0,
      matchedAi: 0, ambiguous: 0, unmatched: 0, missing: 0, stale: 0,
      failed: 0, malformed: snapshot.malformed, complete: true,
    }
    let hashedChars = 0
    let index = 0
    for (const { record } of snapshot.records) {
      throwIfAborted(signal)
      if ((index += 1) % 25 === 0) { await yieldEventLoop(); throwIfAborted(signal) }
      let hash
      try {
        const chars = aiRelevanceInputChars(record)
        const hashCharge = Math.max(chars, 1)
        if (chars > this.config.maxHashCharsPerRecord || hashedChars + hashCharge > this.config.maxAggregateHashChars) {
          result.missing += 1; continue
        }
        hashedChars += hashCharge
        hash = aiRelevanceContentHash(record, this.config.maxHashCharsPerRecord)
      } catch { result.failed += 1; continue }
      const raw = this.requireAssessments().get(record.storeId)
      const stored = validAssessment(raw, record.storeId)
      if (!raw) { result.missing += 1; continue }
      if (!stored) { result.failed += 1; continue }
      if (stored.contentHash !== hash || stored.profileFingerprint !== this.profileFingerprint) { result.stale += 1; continue }
      result.currentAssessments += 1
      if (stored.verdict === 'error') result.failed += 1
      else if (stored.verdict === 'matched-ai') result.matchedAi += 1
      else if (stored.verdict === 'ambiguous') result.ambiguous += 1
      else result.unmatched += 1
    }
    result.complete = result.missing === 0 && result.stale === 0 && result.failed === 0 && result.malformed === 0
    return result
  }

  query(query = {}, execution = {}) {
    return this.trackRead(signal => this.queryInner(query, signal), execution)
  }
  async queryInner(query, signal) {
    const snapshot = candidateSnapshot(this.ctx.prismContentStore, query, this.config)
    const verdict = query.verdict ?? 'matched-ai'
    if (!['matched-ai', 'ambiguous', 'unmatched'].includes(verdict)) throw new Error('verdict is invalid')
    const topic = boundedFilter(query.topic, 'topic')
    if (topic && !TOPICS.has(topic)) throw new Error('topic is invalid')
    const limit = query.limit ?? 20
    const offset = query.offset ?? 0
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100')
    if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer')
    const items = []
    let total = 0
    let missing = 0
    let stale = 0
    let failed = 0
    let hashedChars = 0
    let index = 0
    for (const { record, effective } of snapshot.records) {
      throwIfAborted(signal)
      if ((index += 1) % 25 === 0) { await yieldEventLoop(); throwIfAborted(signal) }
      let hash
      try {
        const chars = aiRelevanceInputChars(record)
        const hashCharge = Math.max(chars, 1)
        if (chars > this.config.maxHashCharsPerRecord || hashedChars + hashCharge > this.config.maxAggregateHashChars) { missing += 1; continue }
        hashedChars += hashCharge
        hash = aiRelevanceContentHash(record, this.config.maxHashCharsPerRecord)
      } catch { failed += 1; continue }
      const raw = this.requireAssessments().get(record.storeId)
      const assessment = validAssessment(raw, record.storeId)
      if (!raw) { missing += 1; continue }
      if (!assessment) { failed += 1; continue }
      if (assessment.contentHash !== hash || assessment.profileFingerprint !== this.profileFingerprint) { stale += 1; continue }
      if (assessment.verdict !== verdict || (topic && !assessment.topics.includes(topic))) continue
      if (total >= offset && items.length < limit) {
        items.push({
          ...buildAIRelevanceCard(record, assessment, this.config.maxCardChars),
          timestampBasis: effective.basis,
        })
      }
      total += 1
    }
    return {
      asOf: snapshot.asOf.toISOString(), since: snapshot.after.toISOString(),
      total, missing, stale, failed, malformed: snapshot.malformed, items,
    }
  }

  trackRead(operation, execution = {}) {
    if (this.stopping) return Promise.reject(new Error('AI relevance store is stopping'))
    const signals = [execution.signal, this.shutdownController.signal].filter(Boolean)
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
    const running = Promise.resolve().then(() => operation(signal))
    this.activeReads.add(running)
    running.finally(() => this.activeReads.delete(running)).catch(() => {})
    return running
  }
  currentContentClaim(storeId) {
    const record = this.ctx.prismContentStore.get(storeId)
    if (!record) return undefined
    const contentHash = aiRelevanceContentHash(record, this.config.maxHashCharsPerRecord)
    if (!this.currentAssessment(storeId, contentHash)) return undefined
    return { contentHash, relevanceProfileFingerprint: this.profileFingerprint }
  }
  currentAssessment(storeId, contentHash) {
    const value = validAssessment(this.requireAssessments().get(storeId), storeId)
    if (!value || value.contentHash !== contentHash || value.profileFingerprint !== this.profileFingerprint) return undefined
    return value
  }
  mutate(operation) {
    if (this.stopping) return Promise.reject(new Error('AI relevance store is stopping'))
    const result = this.mutationTail.then(operation)
    this.mutationTail = result.then(() => {}, () => {})
    return result
  }
  async shutdown() {
    if (!this.stopping) { this.stopping = true; this.shutdownController.abort(new Error('AI relevance store is stopping')) }
    if (this.activePrepare) await Promise.allSettled([this.activePrepare])
    await Promise.allSettled([...this.activeReads])
    await this.mutationTail
  }
  requireAssessments() {
    if (!this.assessments) throw new Error('AI relevance store is not initialized')
    return this.assessments
  }
}

export default PrismContentRelevanceStore
