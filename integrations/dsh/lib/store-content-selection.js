import { createHash, randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  AI_CONTENT_SELECTION_STRATEGY_VERSION,
  aiSelectionContentHash,
  clusterAIEvents,
  extractSelectionMedia,
  packSelectionMaterials,
  rankDiverseEvents,
  selectionSha256,
} from './shared/ai-content-selection.js'

export const name = 'prismflow-store-content-selection'
export const inject = ['storageDomain', 'prismContentStore', 'prismContentRelevance', 'prismProduction']

const TOPICS = [
  'foundation-models', 'machine-learning', 'agents-rag-inference',
  'multimodal-generative-ai', 'frameworks-deployment', 'ai-compute',
  'robotics-autonomy', 'safety-governance', 'ai-companies-funding',
]

export const Config = Schema.object({
  defaultMaxItems: Schema.number().step(1).min(1).max(50).default(30),
  maxItems: Schema.number().step(1).min(1).max(50).default(50),
  defaultMaxInputTokens: Schema.number().step(1).min(1024).max(100000).default(50000),
  maxInputTokens: Schema.number().step(1).min(1024).max(100000).default(60000),
  maxMaterialChars: Schema.number().step(1).min(4096).max(200000).default(80000),
  minCharsPerItem: Schema.number().step(1).min(256).max(5000).default(600),
  maxCharsPerItem: Schema.number().step(1).min(256).max(20000).default(3000),
  maxMediaPerItem: Schema.number().step(1).min(0).max(2).default(2),
  maxPerSource: Schema.number().step(1).min(1).max(50).default(8),
  sourceQuotaId: Schema.string().default(''),
  sourceQuotaMinItems: Schema.number().step(1).min(0).max(50).default(0),
  sourceQuotaMaxItems: Schema.number().step(1).min(0).max(50).default(0),
  longTailPercent: Schema.number().step(1).min(0).max(50).default(20),
  maxBucketSize: Schema.number().step(1).min(2).max(1000).default(200),
  maxPairComparisons: Schema.number().step(1).min(1).max(2000000).default(200000),
  maxMemberClaims: Schema.number().step(1).min(1).max(100000).default(10000),
  selectionHashMaxChars: Schema.number().step(1).min(10000000).max(20000000).default(12000000),
})

export const prismContentSelectionDomain = defineDomain({
  name: 'prismflow_content_selection', version: 1,
  tables: { reviews: domainTable(z.unknown()), selections: domainTable(z.unknown()) },
})

function integer(value, fallback, field, min, max) {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${field} is invalid`)
  return result
}
function normalizeConfig(config) {
  const result = {
    defaultMaxItems: integer(config.defaultMaxItems, 30, 'defaultMaxItems', 1, 50),
    maxItems: integer(config.maxItems, 50, 'maxItems', 1, 50),
    defaultMaxInputTokens: integer(config.defaultMaxInputTokens, 50000, 'defaultMaxInputTokens', 1024, 100000),
    maxInputTokens: integer(config.maxInputTokens, 60000, 'maxInputTokens', 1024, 100000),
    maxMaterialChars: integer(config.maxMaterialChars, 80000, 'maxMaterialChars', 4096, 200000),
    minCharsPerItem: integer(config.minCharsPerItem, 600, 'minCharsPerItem', 256, 5000),
    maxCharsPerItem: integer(config.maxCharsPerItem, 3000, 'maxCharsPerItem', 256, 20000),
    maxMediaPerItem: integer(config.maxMediaPerItem, 2, 'maxMediaPerItem', 0, 2),
    maxPerSource: integer(config.maxPerSource, 8, 'maxPerSource', 1, 50),
    sourceQuotaId: config.sourceQuotaId ?? '',
    sourceQuotaMinItems: integer(config.sourceQuotaMinItems, 0, 'sourceQuotaMinItems', 0, 50),
    sourceQuotaMaxItems: integer(config.sourceQuotaMaxItems, 0, 'sourceQuotaMaxItems', 0, 50),
    longTailPercent: integer(config.longTailPercent, 20, 'longTailPercent', 0, 50),
    maxBucketSize: integer(config.maxBucketSize, 200, 'maxBucketSize', 2, 1000),
    maxPairComparisons: integer(config.maxPairComparisons, 200000, 'maxPairComparisons', 1, 2000000),
    maxMemberClaims: integer(config.maxMemberClaims, 10000, 'maxMemberClaims', 1, 100000),
    selectionHashMaxChars: integer(config.selectionHashMaxChars, 12000000, 'selectionHashMaxChars', 10000000, 20000000),
  }
  if (result.defaultMaxItems > result.maxItems || result.defaultMaxInputTokens > result.maxInputTokens
    || result.minCharsPerItem > result.maxCharsPerItem) throw new Error('AI selection default limits exceed their ceilings')
  if (typeof result.sourceQuotaId !== 'string' || result.sourceQuotaId.length > 256 || /[\u0000-\u001f\u007f]/u.test(result.sourceQuotaId)
    || (result.sourceQuotaId ? !result.sourceQuotaId.trim() : result.sourceQuotaMinItems !== 0 || result.sourceQuotaMaxItems !== 0)
    || (result.sourceQuotaId && (result.sourceQuotaMinItems < 1 || result.sourceQuotaMaxItems < result.sourceQuotaMinItems
      || result.sourceQuotaMaxItems > result.maxPerSource || result.sourceQuotaMinItems > result.defaultMaxItems))) {
    throw new Error('AI selection source quota configuration is invalid')
  }
  return result
}
function canonicalIso(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value
}
function bounded(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) }
function validHash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) }
function exactKeys(raw, keys) {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    && Object.keys(raw).length === keys.length && keys.every(key => Object.hasOwn(raw, key))
}
function validReview(raw, storeId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.storeId !== storeId
    || !bounded(raw.sourceId, 256) || !validHash(raw.contentHash) || !validHash(raw.relevanceProfileFingerprint)
    || !validHash(raw.reviewerProfileFingerprint) || !['relevant', 'irrelevant'].includes(raw.decision)
    || !Array.isArray(raw.topics) || raw.topics.length > TOPICS.length || raw.topics.some(topic => !TOPICS.includes(topic))
    || !bounded(raw.reasonCode, 128) || !canonicalIso(raw.reviewedAt)) return undefined
  return { ...raw, topics: [...raw.topics] }
}
const EXCERPT_KEYS = ['field', 'start', 'end', 'text', 'sha256']
const MEDIA_KEYS = ['kind', 'url']
const MATERIAL_KEYS_V1 = ['storeId', 'title', 'url', 'source', 'author', 'publishedDate', 'category', 'excerpts', 'materialChars', 'estimatedTokens', 'materialSha256']
const MATERIAL_KEYS_V2 = ['storeId', 'title', 'url', 'source', 'author', 'publishedDate', 'category', 'excerpts', 'media', 'materialChars', 'estimatedTokens', 'materialSha256']
function validMediaUrl(value) {
  if (!bounded(value, 2048)) return false
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}
function validMaterial(raw) {
  const hasMedia = exactKeys(raw, MATERIAL_KEYS_V2)
  if ((!hasMedia && !exactKeys(raw, MATERIAL_KEYS_V1)) || !bounded(raw.storeId, 128)
    || typeof raw.title !== 'string' || raw.title.length > 1000 || typeof raw.url !== 'string' || raw.url.length > 2048
    || typeof raw.source !== 'string' || raw.source.length > 512 || typeof raw.author !== 'string' || raw.author.length > 512
    || typeof raw.publishedDate !== 'string' || raw.publishedDate.length > 64 || typeof raw.category !== 'string' || raw.category.length > 256
    || !Array.isArray(raw.excerpts) || raw.excerpts.length > 32 || !Number.isInteger(raw.materialChars) || raw.materialChars < 0 || raw.materialChars > 20000
    || !Number.isInteger(raw.estimatedTokens) || raw.estimatedTokens < 0 || raw.estimatedTokens > 100000 || !validHash(raw.materialSha256)) return undefined
  const excerpts = []
  for (const item of raw.excerpts) {
    if (!exactKeys(item, EXCERPT_KEYS) || !['description', 'content'].includes(item.field)
      || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end < item.start
      || typeof item.text !== 'string' || item.text.length > 20000 || !validHash(item.sha256)
      || createHash('sha256').update(item.text, 'utf8').digest('hex') !== item.sha256) return undefined
    excerpts.push({ field: item.field, start: item.start, end: item.end, text: item.text, sha256: item.sha256 })
  }
  const media = []
  if (hasMedia) {
    if (!Array.isArray(raw.media) || raw.media.length > 64) return undefined
    const seen = new Set()
    for (const item of raw.media) {
      if (!exactKeys(item, MEDIA_KEYS) || !['image', 'video'].includes(item.kind) || !validMediaUrl(item.url) || seen.has(item.url)) return undefined
      seen.add(item.url); media.push({ kind: item.kind, url: item.url })
    }
  }
  const material = {
    storeId: raw.storeId, title: raw.title, url: raw.url, source: raw.source, author: raw.author,
    publishedDate: raw.publishedDate, category: raw.category, excerpts,
    ...(hasMedia ? { media } : {}),
    materialChars: raw.materialChars, estimatedTokens: raw.estimatedTokens, materialSha256: raw.materialSha256,
  }
  const encoded = JSON.stringify({
    storeId: material.storeId, title: material.title, url: material.url, source: material.source, author: material.author,
    publishedDate: material.publishedDate, category: material.category, excerpts: material.excerpts,
    ...(hasMedia ? { media: material.media } : {}),
  })
  return encoded.length === material.materialChars
    && createHash('sha256').update(encoded, 'utf8').digest('hex') === material.materialSha256 ? material : undefined
}
const COUNT_KEYS = ['candidate', 'localMatched', 'ambiguous', 'reviewed', 'reviewAccepted', 'reviewRejected', 'eventClusters', 'selected']
const ROOT_KEYS = ['selectionId', 'version', 'createdAt', 'asOf', 'since', 'hours', 'classifierVersion', 'relevanceProfileFingerprint', 'reviewerProfileFingerprint', 'strategyVersion', 'strategyProfileFingerprint', 'counts', 'items', 'totalMaterialChars', 'estimatedTokens', 'selectionSha256']
const ITEM_KEYS = ['rank', 'storeId', 'sourceId', 'contentHash', 'clusterId', 'topics', 'signals', 'reasons', 'memberClaims', 'material']
const SIGNAL_KEYS = ['distinctSourceCount', 'memberCount', 'recencyTimestamp', 'bodyChars', 'topicCount', 'localMatch']
const MEMBER_CLAIM_KEYS = ['storeId', 'contentHash']
function validSelection(raw) {
  if (!exactKeys(raw, ROOT_KEYS) || !bounded(raw.selectionId, 128) || raw.version !== 1
    || !validHash(raw.selectionSha256) || !canonicalIso(raw.createdAt) || !canonicalIso(raw.asOf) || !canonicalIso(raw.since)
    || !Number.isInteger(raw.hours) || raw.hours < 1 || raw.hours > 168
    || !bounded(raw.classifierVersion, 128) || !validHash(raw.relevanceProfileFingerprint) || !validHash(raw.reviewerProfileFingerprint)
    || raw.strategyVersion !== AI_CONTENT_SELECTION_STRATEGY_VERSION || !validHash(raw.strategyProfileFingerprint)
    || !Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 50
    || !Number.isInteger(raw.totalMaterialChars) || raw.totalMaterialChars < 0 || raw.totalMaterialChars > 200000
    || !Number.isInteger(raw.estimatedTokens) || raw.estimatedTokens < 0 || raw.estimatedTokens > 100000
    || !exactKeys(raw.counts, COUNT_KEYS)
    || COUNT_KEYS.some(key => !Number.isInteger(raw.counts[key]) || raw.counts[key] < 0 || raw.counts[key] > 1000000)) return undefined
  const counts = Object.fromEntries(COUNT_KEYS.map(key => [key, raw.counts[key]]))
  const items = []; const allMemberIds = new Set(); let memberClaimCount = 0
  for (let index = 0; index < raw.items.length; index += 1) {
    const item = raw.items[index]
    if (!exactKeys(item, ITEM_KEYS) || item.rank !== index + 1 || !bounded(item.storeId, 128)
      || !bounded(item.sourceId, 256) || !validHash(item.contentHash) || !validHash(item.clusterId)
      || !Array.isArray(item.topics) || item.topics.length > TOPICS.length || new Set(item.topics).size !== item.topics.length
      || item.topics.some(topic => !TOPICS.includes(topic)) || !Array.isArray(item.reasons) || item.reasons.length > 16
      || item.reasons.some(reason => !bounded(reason, 128)) || !exactKeys(item.signals, SIGNAL_KEYS)
      || !Number.isInteger(item.signals.distinctSourceCount) || item.signals.distinctSourceCount < 1 || item.signals.distinctSourceCount > 100000
      || !Number.isInteger(item.signals.memberCount) || item.signals.memberCount < 1 || item.signals.memberCount > 100000
      || !Number.isSafeInteger(item.signals.recencyTimestamp) || item.signals.recencyTimestamp < 0
      || !Number.isInteger(item.signals.bodyChars) || item.signals.bodyChars < 0 || item.signals.bodyChars > 20000000
      || !Number.isInteger(item.signals.topicCount) || item.signals.topicCount < 0 || item.signals.topicCount > TOPICS.length
      || typeof item.signals.localMatch !== 'boolean' || !Array.isArray(item.memberClaims)
      || item.memberClaims.length !== item.signals.memberCount || item.memberClaims.length < 1) return undefined
    const memberClaims = []
    for (const claim of item.memberClaims) {
      if (!exactKeys(claim, MEMBER_CLAIM_KEYS) || !bounded(claim.storeId, 128) || !validHash(claim.contentHash)
        || allMemberIds.has(claim.storeId)) return undefined
      allMemberIds.add(claim.storeId); memberClaims.push({ storeId: claim.storeId, contentHash: claim.contentHash })
    }
    memberClaimCount += memberClaims.length
    if (memberClaimCount > 100000 || !memberClaims.some(claim => claim.storeId === item.storeId && claim.contentHash === item.contentHash)) return undefined
    const material = validMaterial(item.material)
    if (!material || material.storeId !== item.storeId) return undefined
    items.push({
      rank: item.rank, storeId: item.storeId, sourceId: item.sourceId, contentHash: item.contentHash,
      clusterId: item.clusterId, topics: [...item.topics],
      signals: Object.fromEntries(SIGNAL_KEYS.map(key => [key, item.signals[key]])),
      reasons: [...item.reasons], memberClaims, material,
    })
  }
  if (JSON.stringify(items.map(item => item.material)).length !== raw.totalMaterialChars) return undefined
  const payload = {
    selectionId: raw.selectionId, version: raw.version, createdAt: raw.createdAt, asOf: raw.asOf, since: raw.since, hours: raw.hours,
    classifierVersion: raw.classifierVersion, relevanceProfileFingerprint: raw.relevanceProfileFingerprint,
    reviewerProfileFingerprint: raw.reviewerProfileFingerprint, strategyVersion: raw.strategyVersion,
    strategyProfileFingerprint: raw.strategyProfileFingerprint, counts, items,
    totalMaterialChars: raw.totalMaterialChars, estimatedTokens: raw.estimatedTokens,
  }
  if (selectionSha256(payload) !== raw.selectionSha256) return undefined
  return { ...payload, selectionSha256: raw.selectionSha256 }
}
function reviewerCard(claim, maxChars) {
  const raw = claim.card ?? {}
  const card = {
    storeId: claim.record.storeId,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : '',
    source: typeof raw.source === 'string' ? raw.source.slice(0, 120) : '',
    category: typeof raw.category === 'string' ? raw.category.slice(0, 120) : '',
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt.slice(0, 64) : '',
    localVerdict: claim.assessment.verdict,
    evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 3).map(item => ({ field: item.field, excerpt: String(item.excerpt ?? '').slice(0, 120) })) : [],
    context: (() => {
      const item = claim.record?.item ?? {}
      const description = typeof item.description === 'string' ? item.description : ''
      const content = typeof item.content === 'string' ? item.content : ''
      const body = content.length > description.length ? content : description
      if (body.length <= 240) return body.replace(/[\u0000\u007f]/gu, '')
      return `${body.slice(0, 80)} … ${body.slice(Math.max(0, Math.floor(body.length / 2) - 40), Math.floor(body.length / 2) + 40)} … ${body.slice(-80)}`.replace(/[\u0000\u007f]/gu, '')
    })(),
  }
  while (JSON.stringify(card).length > maxChars && card.evidence.length > 0) card.evidence.pop()
  while (JSON.stringify(card).length > maxChars && card.context.length > 40) card.context = card.context.slice(0, card.context.length - 20)
  if (JSON.stringify(card).length > maxChars) card.title = card.title.slice(0, 80)
  if (JSON.stringify(card).length > maxChars) throw new Error('Reviewer card cannot fit configured limit')
  return card
}
function throwIfAborted(signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error(`AI selection aborted: ${String(signal.reason ?? 'aborted')}`)
}
function auditSelected(storeId, percent) {
  if (percent <= 0) return false
  const value = createHash('sha256').update(storeId).digest().readUInt32BE(0) % 10000
  return value < Math.round(percent * 100)
}

export class PrismContentSelectionStore extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismContentSelections')
    this.config = normalizeConfig(config)
    this.strategyProfileFingerprint = selectionSha256({ version: AI_CONTENT_SELECTION_STRATEGY_VERSION, ...this.config })
    this.reviews = undefined; this.selections = undefined; this.reviewer = undefined
    this.activeCreate = undefined; this.mutationTail = Promise.resolve(); this.stopping = false
    this.shutdownController = new AbortController(); this.unregisterMaterialProvider = undefined
  }
  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(prismContentSelectionDomain)
    this.reviews = domain.table('reviews'); this.selections = domain.table('selections')
    try {
      this.unregisterMaterialProvider = this.ctx.prismProduction.registerMaterialProvider({
        id: 'ai-selection', resolve: selectionId => this.resolveMaterial(selectionId),
      })
      this.ctx.effect(() => async () => {
        await this.shutdown(); this.unregisterMaterialProvider?.(); await domain.close()
      }, 'prismflow-content-selection.domainClose')
    } catch (error) {
      this.unregisterMaterialProvider?.(); this.reviews = undefined; this.selections = undefined; await domain.close(); throw error
    }
  }
  registerReviewer(provider) {
    if (!provider?.id || typeof provider.reviewBatch !== 'function' || !validHash(provider.fingerprint)) throw new Error('AI relevance reviewer provider is invalid')
    if (this.reviewer) throw new Error('AI relevance reviewer is already registered')
    this.reviewer = provider
    return () => { if (this.reviewer === provider) this.reviewer = undefined }
  }
  create(query = {}, execution = {}) {
    if (this.stopping) return Promise.reject(new Error('AI selection store is stopping'))
    if (this.activeCreate) return Promise.reject(new Error('AI selection creation is already running'))
    const signals = [execution.signal, this.shutdownController.signal].filter(Boolean)
    const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
    const operation = this.createInner(query, { ...execution, signal })
    this.activeCreate = operation
    operation.finally(() => { if (this.activeCreate === operation) this.activeCreate = undefined }).catch(() => {})
    return operation
  }
  async createInner(query, execution) {
    const maxItems = integer(query.maxItems, this.config.defaultMaxItems, 'maxItems', 1, this.config.maxItems)
    const maxInputTokens = integer(query.maxInputTokens, this.config.defaultMaxInputTokens, 'maxInputTokens', 1024, this.config.maxInputTokens)
    const topic = query.topic
    if (topic !== undefined && !TOPICS.includes(topic)) throw new Error('topic is invalid')
    const sourceQuota = this.config.sourceQuotaId && (!query.sourceId || query.sourceId === this.config.sourceQuotaId) ? {
      sourceId: this.config.sourceQuotaId,
      minItems: this.config.sourceQuotaMinItems,
      maxItems: this.config.sourceQuotaMaxItems,
    } : undefined
    const snapshot = await this.ctx.prismContentRelevance.snapshotCurrent(query, execution)
    throwIfAborted(execution.signal)
    const reviewer = this.reviewer
    const reviewClaims = [...snapshot.ambiguous]
    if (reviewer) reviewClaims.push(...snapshot.unmatched.filter(item => item.record.sourceId === sourceQuota?.sourceId
      || auditSelected(item.record.storeId, reviewer.unmatchedAuditPercent)))
    const acceptedReviews = []
    let rejectedReviews = 0
    if (reviewClaims.length > 0) {
      if (!reviewer) throw new Error('AI relevance reviewer is unavailable for ambiguous content')
      if (!execution.agent) throw new Error('AI selection with ambiguous content requires a calling DSH Agent')
      if (reviewClaims.length > reviewer.maxCards) throw new Error('AI relevance reviewer card ceiling exceeded')
      const pending = []
      for (const claim of reviewClaims) {
        const cached = validReview(this.requireReviews().get(claim.record.storeId), claim.record.storeId)
        if (cached && cached.contentHash === claim.contentHash
          && cached.relevanceProfileFingerprint === snapshot.relevanceProfileFingerprint
          && cached.reviewerProfileFingerprint === reviewer.fingerprint) {
          if (cached.decision === 'relevant') acceptedReviews.push({ claim, review: cached }); else rejectedReviews += 1
        } else pending.push(claim)
      }
      for (let index = 0; index < pending.length; index += reviewer.batchSize) {
        throwIfAborted(execution.signal)
        const batch = pending.slice(index, index + reviewer.batchSize)
        const cards = batch.map(claim => reviewerCard(claim, reviewer.maxCardChars))
        const decisions = await reviewer.reviewBatch(cards, execution)
        throwIfAborted(execution.signal)
        const rows = decisions.map(decision => {
          const claim = batch.find(item => item.record.storeId === decision.storeId)
          if (!claim) throw new Error('Reviewer returned an unknown decision id')
          return {
            storeId: decision.storeId, sourceId: claim.record.sourceId, contentHash: claim.contentHash,
            relevanceProfileFingerprint: snapshot.relevanceProfileFingerprint, reviewerProfileFingerprint: reviewer.fingerprint,
            decision: decision.decision, topics: decision.topics, reasonCode: decision.reasonCode, reviewedAt: new Date().toISOString(),
          }
        })
        await this.mutate(async () => { for (const row of rows) await this.requireReviews().put(row.storeId, row) })
        for (const row of rows) {
          const claim = batch.find(item => item.record.storeId === row.storeId)
          if (row.decision === 'relevant') acceptedReviews.push({ claim, review: row }); else rejectedReviews += 1
        }
      }
    }
    const candidates = snapshot.matched.map(claim => ({
      record: claim.record, contentHash: claim.contentHash, assessment: claim.assessment,
      relevanceOrigin: 'local-match', effectiveTimestamp: claim.effectiveTimestamp,
    }))
    for (const { claim, review } of acceptedReviews) candidates.push({
      record: claim.record, contentHash: claim.contentHash,
      assessment: { ...claim.assessment, verdict: 'matched-ai', topics: review.topics },
      relevanceOrigin: claim.assessment.verdict === 'ambiguous' ? 'reviewed-ambiguous' : 'reviewed-audit',
      effectiveTimestamp: claim.effectiveTimestamp,
    })
    const filtered = topic ? candidates.filter(item => item.assessment.topics.includes(topic)) : candidates
    if (filtered.length === 0) throw new Error('No AI-related content matched the selection policy')
    throwIfAborted(execution.signal)
    const clusters = clusterAIEvents(filtered, { maxBucketSize: this.config.maxBucketSize, maxPairComparisons: this.config.maxPairComparisons })
    throwIfAborted(execution.signal)
    const ranked = rankDiverseEvents(clusters, {
      maxItems, maxPerSource: this.config.maxPerSource, longTailPercent: this.config.longTailPercent, sourceQuota,
    })
    const packed = packSelectionMaterials(ranked, {
      maxMaterialChars: this.config.maxMaterialChars, maxMaterialTokens: maxInputTokens,
      minCharsPerItem: this.config.minCharsPerItem, maxCharsPerItem: this.config.maxCharsPerItem,
      maxMediaPerItem: this.config.maxMediaPerItem,
    })
    throwIfAborted(execution.signal)
    if (packed.length === 0) throw new Error('No selected material fits the configured context budget')
    if (sourceQuota) {
      const packedQuotaCount = packed.filter(item => item.ranked.cluster.representative.record.sourceId === sourceQuota.sourceId).length
      if (packedQuotaCount < sourceQuota.minItems || packedQuotaCount > sourceQuota.maxItems) {
        throw new Error(`Packed material violates source quota for ${sourceQuota.sourceId}: expected ${sourceQuota.minItems}-${sourceQuota.maxItems}, got ${packedQuotaCount}`)
      }
    }
    const relevanceClaims = []
    const items = packed.map(({ ranked: item, material }, index) => {
      const memberClaims = item.cluster.members
        .map(member => {
          relevanceClaims.push({ storeId: member.record.storeId, contentHash: member.contentHash })
          return {
            storeId: member.record.storeId,
            contentHash: aiSelectionContentHash(member.record, this.config.selectionHashMaxChars),
          }
        })
        .sort((left, right) => left.storeId.localeCompare(right.storeId))
      const representativeClaim = memberClaims.find(claim => claim.storeId === item.cluster.representative.record.storeId)
      if (!representativeClaim) throw new Error('Selected cluster is missing its representative claim')
      return {
        rank: index + 1, storeId: item.cluster.representative.record.storeId, sourceId: item.cluster.representative.record.sourceId,
        contentHash: representativeClaim.contentHash, clusterId: item.cluster.clusterId, topics: item.cluster.topics,
        signals: item.cluster.signals, reasons: item.reasons, memberClaims, material,
      }
    })
    const memberClaims = items.flatMap(item => item.memberClaims)
    if (memberClaims.length > this.config.maxMemberClaims || memberClaims.length > snapshot.candidateCount) {
      throw new Error('Selected cluster member claim ceiling exceeded')
    }
    const createdAt = new Date().toISOString(); const selectionId = randomUUID()
    const payload = {
      selectionId, version: 1, createdAt, asOf: snapshot.asOf, since: snapshot.since, hours: snapshot.hours,
      classifierVersion: snapshot.classifierVersion, relevanceProfileFingerprint: snapshot.relevanceProfileFingerprint,
      reviewerProfileFingerprint: reviewer?.fingerprint ?? createHash('sha256').update('no-reviewer').digest('hex'),
      strategyVersion: AI_CONTENT_SELECTION_STRATEGY_VERSION, strategyProfileFingerprint: this.strategyProfileFingerprint,
      counts: {
        candidate: snapshot.candidateCount, localMatched: snapshot.matched.length, ambiguous: snapshot.ambiguous.length,
        reviewed: reviewClaims.length, reviewAccepted: acceptedReviews.length, reviewRejected: rejectedReviews,
        eventClusters: clusters.length, selected: items.length,
      },
      items, totalMaterialChars: JSON.stringify(items.map(item => item.material)).length,
      estimatedTokens: items.reduce((sum, item) => sum + item.material.estimatedTokens, 0),
    }
    const selection = { ...payload, selectionSha256: selectionSha256(payload) }
    throwIfAborted(execution.signal)
    await this.mutate(async () => {
      throwIfAborted(execution.signal)
      if (this.requireSelections().get(selectionId)) throw new Error('Selection id collision')
      this.ctx.prismContentRelevance.revalidateClaims(relevanceClaims)
      this.revalidateSelectionClaims(memberClaims)
      throwIfAborted(execution.signal)
      await this.requireSelections().put(selectionId, selection)
      if (execution.signal?.aborted) {
        await this.requireSelections().delete(selectionId)
        throwIfAborted(execution.signal)
      }
    })
    return this.project(selection)
  }
  list({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit is invalid')
    const values = []
    for (const [, raw] of this.requireSelections().entries()) { const value = validSelection(raw); if (value) values.push(value) }
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(value => this.project(value))
  }
  get(selectionId) {
    if (!bounded(selectionId, 128)) return undefined
    const value = validSelection(this.requireSelections().get(selectionId)); return value ? this.project(value) : undefined
  }
  project(value) {
    return {
      selectionId: value.selectionId, selectionSha256: value.selectionSha256, createdAt: value.createdAt,
      asOf: value.asOf, since: value.since, hours: value.hours,
      counts: Object.fromEntries(COUNT_KEYS.map(key => [key, value.counts[key]])),
      selectedCount: value.items.length, totalMaterialChars: value.totalMaterialChars, estimatedTokens: value.estimatedTokens,
      contentStoreIds: value.items.map(item => item.storeId),
      sourceIds: [...new Set(value.items.map(item => item.sourceId))].sort(),
    }
  }
  resolveMaterial(selectionId) {
    if (!bounded(selectionId, 128)) throw new Error('AI selection id is invalid')
    const selection = validSelection(this.requireSelections().get(selectionId))
    if (!selection) throw new Error(`Unknown or corrupt AI selection: ${selectionId}`)
    const claims = selection.items.map(item => ({ storeId: item.storeId, contentHash: item.contentHash }))
    const memberClaims = selection.items.flatMap(item => item.memberClaims)
    if (memberClaims.length > this.config.maxMemberClaims) throw new Error('AI selection member claim ceiling exceeded')
    this.revalidateSelectionClaims(memberClaims)
    for (const item of selection.items) {
      const record = this.ctx.prismContentStore.get(item.storeId)
      for (const excerpt of item.material.excerpts) {
        const source = typeof record?.item?.[excerpt.field] === 'string' ? record.item[excerpt.field] : ''
        const current = source.slice(excerpt.start, excerpt.end).replace(/[\u0000\u007f]/gu, '').trim()
        if (current !== excerpt.text || createHash('sha256').update(current, 'utf8').digest('hex') !== excerpt.sha256) {
          throw new Error(`Selected material excerpt no longer matches authoritative content: ${item.storeId}`)
        }
      }
      if (item.material.media) {
        const metadata = record?.item?.metadata && typeof record.item.metadata === 'object' && !Array.isArray(record.item.metadata)
          ? record.item.metadata : {}
        const contentHtml = typeof metadata.content_html === 'string' ? metadata.content_html : ''
        const currentMedia = extractSelectionMedia(record?.item?.description, record?.item?.content, this.config.maxMediaPerItem, contentHtml)
        if (JSON.stringify(currentMedia) !== JSON.stringify(item.material.media)) throw new Error(`Selected material media no longer matches authoritative content: ${item.storeId}`)
      }
    }
    return {
      selectionId: selection.selectionId, selectionSha256: selection.selectionSha256,
      contentStoreIds: selection.items.map(item => item.storeId), sourceContentClaims: claims,
      packedMaterials: selection.items.map(item => ({
        storeId: item.material.storeId, title: item.material.title, url: item.material.url,
        source: item.material.source, author: item.material.author, publishedDate: item.material.publishedDate,
        category: item.material.category, excerpts: item.material.excerpts.map(excerpt => ({ ...excerpt })),
        ...(item.material.media ? { media: item.material.media.map(media => ({ ...media })) } : {}),
        materialChars: item.material.materialChars, estimatedTokens: item.material.estimatedTokens,
        materialSha256: item.material.materialSha256,
      })),
    }
  }
  revalidateSelectionClaims(claims) {
    for (const claim of claims) {
      const record = this.ctx.prismContentStore.get(claim.storeId)
      if (!record || aiSelectionContentHash(record, this.config.selectionHashMaxChars) !== claim.contentHash) throw new Error(`Selected content changed or disappeared: ${claim.storeId}`)
    }
    return true
  }
  mutate(operation) {
    if (this.stopping) return Promise.reject(new Error('AI selection store is stopping'))
    const result = this.mutationTail.then(operation); this.mutationTail = result.then(() => {}, () => {}); return result
  }
  async shutdown() {
    if (!this.stopping) { this.stopping = true; this.shutdownController.abort(new Error('AI selection store is stopping')) }
    if (this.activeCreate) await Promise.allSettled([this.activeCreate])
    await this.mutationTail
  }
  requireReviews() { if (!this.reviews) throw new Error('AI selection reviews are not initialized'); return this.reviews }
  requireSelections() { if (!this.selections) throw new Error('AI selections are not initialized'); return this.selections }
}

export default PrismContentSelectionStore
