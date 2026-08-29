import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import { normalizeProductionArtifactV2 } from './shared/content-production.js'
import { normalizePublicationReceipt } from './shared/publication-receipt.js'
import { publisherConfigRevision } from './shared/publisher-profile.js'
import { PublisherOutcomeError } from './shared/publisher-outcome.js'
export { PublisherOutcomeError } from './shared/publisher-outcome.js'

export const name = 'prismflow-publisher-core'

const CHANNELS = Object.freeze([
  { kind: 'local-markdown', name: 'Local Markdown' },
  { kind: 'github-markdown', name: 'GitHub Markdown' },
  { kind: 'r2-markdown', name: 'Cloudflare R2 Markdown' },
  { kind: 'wechat-draft', name: 'WeChat Draft' },
])

export class PrismPublisherRegistry extends Service {
  constructor(ctx) {
    super(ctx, 'prismPublishers')
    this.providers = new Map()
    this.channelStates = new Map()
    this.receiptSink = undefined
    this.receiptSinkClosing = false
    this.inFlight = new Set()
    this.maintenanceDraining = false
  }

  register(provider) {
    if (!provider?.id || typeof provider.publishArtifact !== 'function') {
      throw new Error('A PrismFlow publisher requires an id and publishArtifact()')
    }
    if (typeof provider.id !== 'string' || provider.id.length > 256 || /[\u0000-\u001f\u007f]/.test(provider.id)) {
      throw new Error('A PrismFlow publisher id must be a control-free string of at most 256 characters')
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`PrismFlow publisher already registered: ${provider.id}`)
    }
    if (provider.kind !== undefined && !CHANNELS.some(channel => channel.kind === provider.kind)) {
      throw new Error(`PrismFlow publisher kind is invalid: ${provider.kind}`)
    }
    if (provider.configRevision !== undefined && !/^[a-f0-9]{64}$/u.test(provider.configRevision)) {
      throw new Error('PrismFlow publisher configRevision must be a SHA-256 digest')
    }
    const conflicting = provider.kind && Array.from(this.providers.values()).find(item => item.kind === provider.kind
      && item.configRevision && provider.configRevision && item.configRevision !== provider.configRevision)
    if (conflicting) throw new Error(`PrismFlow publisher channel has conflicting Profile revisions: ${provider.kind}`)
    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  registerChannel(kind, configRevision) {
    if (!CHANNELS.some(channel => channel.kind === kind) || !/^[a-f0-9]{64}$/u.test(configRevision ?? '')) {
      throw new Error('A PrismFlow publisher channel requires a known kind and config revision')
    }
    if (this.channelStates.has(kind)) throw new Error(`PrismFlow publisher channel already registered: ${kind}`)
    const state = { configRevision }
    this.channelStates.set(kind, state)
    return () => { if (this.channelStates.get(kind) === state) this.channelStates.delete(kind) }
  }

  registerReceiptSink(sink) {
    if (typeof sink !== 'function') throw new Error('A PrismFlow publication receipt sink must be a function')
    if (this.receiptSink || this.receiptSinkClosing) throw new Error('A PrismFlow publication receipt sink is already registered or closing')
    this.receiptSink = sink
    return () => {
      if (this.receiptSink === sink) this.receiptSink = undefined
    }
  }

  drain() {
    return Promise.allSettled(Array.from(this.inFlight)).then(() => {})
  }

  async beginMaintenanceDrain() {
    this.maintenanceDraining = true
    await this.drain()
    return { drained: true, active: this.inFlight.size, restartAllowed: true }
  }

  maintenanceStatus() {
    return { draining: this.maintenanceDraining, active: this.inFlight.size, restartAllowed: this.maintenanceDraining && this.inFlight.size === 0 }
  }

  async closeReceiptSink(sink) {
    if (this.receiptSink !== sink) return
    this.receiptSinkClosing = true
    await this.drain()
    if (this.receiptSink === sink) this.receiptSink = undefined
    this.receiptSinkClosing = false
  }

  list() {
    return Array.from(this.providers.values(), provider => ({
      id: provider.id,
      name: provider.name,
      description: provider.description ?? '',
      ...(provider.kind ? { kind: provider.kind } : {}),
      ...(provider.configRevision ? { configRevision: provider.configRevision } : {}),
      ...(provider.articleType === 'news' || provider.articleType === 'newspic' ? { articleType: provider.articleType } : {}),
      ...(provider.kind === 'wechat-draft' ? { hasDeploymentDefaultCover: provider.hasDeploymentDefaultCover === true } : {}),
    }))
  }

  inventory() {
    return CHANNELS.map(channel => {
      const destinations = this.list().filter(provider => provider.kind === channel.kind)
      const revisions = [...new Set(destinations.map(provider => provider.configRevision).filter(Boolean))]
      const registered = this.channelStates.get(channel.kind)
      const active = registered !== undefined || destinations.length > 0
      return {
        kind: channel.kind, name: channel.name, active, disabled: !active, configured: destinations.length > 0,
        destinations: destinations.map(({ id, name }) => ({ id, name })),
        configRevision: registered?.configRevision ?? (revisions.length === 1 ? revisions[0] : publisherConfigRevision(channel.kind, { destinations: [] })),
      }
    })
  }

  resolveMediaUploaderId(configuredId = '') {
    if (configuredId) { this.assertMediaUploader(configuredId); return configuredId }
    const candidates = [...this.providers.values()].filter(provider => provider.kind === 'r2-markdown' && typeof provider.uploadMedia === 'function')
    if (candidates.length === 0) throw new Error('R2 media destination is not configured')
    if (candidates.length !== 1) throw new Error('R2 media destination must resolve to exactly one Profile target')
    return candidates[0].id
  }

  assertMediaUploader(publisherId) {
    if (typeof publisherId !== 'string' || !publisherId) throw new Error('R2 media destination is not configured')
    const provider = this.providers.get(publisherId)
    if (!provider || provider.kind !== 'r2-markdown' || typeof provider.uploadMedia !== 'function') throw new Error(`Configured R2 media destination is unavailable: ${publisherId}`)
    return true
  }

  ownsMediaUrl(publisherId, value) {
    this.assertMediaUploader(publisherId)
    return this.providers.get(publisherId).ownsMediaUrl?.(value) === true
  }

  uploadMedia(publisherId, bytes, mime, execution = {}) {
    this.assertMediaUploader(publisherId)
    if (this.maintenanceDraining) return Promise.reject(new Error('PrismFlow publication admission is paused for maintenance drain'))
    const provider = this.providers.get(publisherId)
    const operation = Promise.resolve().then(() => provider.uploadMedia(bytes, mime, execution))
    return this.trackPublication(operation)
  }

  async validateArtifact(publisherId, artifact) {
    const provider = this.providers.get(publisherId)
    if (!provider) throw new Error(`Unknown PrismFlow publisher: ${publisherId}`)
    if (!artifact || typeof artifact !== 'object' || typeof artifact.markdown !== 'string'
      || typeof artifact.artifactSha256 !== 'string' || createHash('sha256').update(artifact.markdown).digest('hex') !== artifact.artifactSha256) {
      throw new Error('PrismFlow publication artifact is invalid')
    }
    if (typeof provider.validateArtifact === 'function') await provider.validateArtifact(artifact)
    return true
  }

  publishArtifact(publisherId, artifact, records, execution = {}) {
    if (this.maintenanceDraining) return Promise.reject(new Error('PrismFlow publication admission is paused for maintenance drain'))
    if (this.receiptSinkClosing) return Promise.reject(new Error('PrismFlow publication receipt store is stopping'))
    const recordIds = Array.isArray(records) ? records.map(record => record?.storeId) : []
    if (!artifact || typeof artifact !== 'object' || typeof artifact.markdown !== 'string'
      || typeof artifact.draftId !== 'string' || !Number.isInteger(artifact.draftVersion)
      || typeof artifact.artifactSha256 !== 'string'
      || !Array.isArray(artifact.sourceContentStoreIds)
      || artifact.sourceContentStoreIds.length !== recordIds.length
      || artifact.sourceContentStoreIds.some((id, index) => id !== recordIds[index])
      || createHash('sha256').update(artifact.markdown).digest('hex') !== artifact.artifactSha256) {
      return Promise.reject(new Error('PrismFlow publication artifact is invalid'))
    }
    if (artifact.artifactBindingSha256 !== undefined) {
      try { normalizeProductionArtifactV2(artifact) }
      catch { return Promise.reject(new Error('PrismFlow publication Artifact v2 binding is invalid')) }
    }
    const production = this.ctx.get?.('prismProduction') ?? this.ctx.prismProduction
    try {
      if (typeof production?.assertPublicationArtifact !== 'function') {
        throw new Error('PrismFlow production authority is unavailable')
      }
      production.assertPublicationArtifact(publisherId, artifact)
    } catch {
      return Promise.reject(new Error('PrismFlow publication artifact is not under an active approved-draft claim'))
    }
    return this.trackPublication(this.executePublication(publisherId, records, execution, artifact))
  }

  trackPublication(operation) {
    this.inFlight.add(operation)
    operation.finally(() => this.inFlight.delete(operation)).catch(() => {})
    return operation
  }

  async executePublication(publisherId, records, execution, artifact) {
    const provider = this.providers.get(publisherId)
    if (!provider) {
      const available = this.list().map(item => item.id)
      throw new Error(
        available.length > 0
          ? `Unknown PrismFlow publisher: ${publisherId}. Available publishers: ${available.join(', ')}`
          : 'No PrismFlow publishers are configured.',
      )
    }
    if (!Array.isArray(records)) throw new Error('PrismFlow publisher records must be an array')
    const production = this.ctx.get?.('prismProduction') ?? this.ctx.prismProduction
    const claim = typeof production.publicationExecutionClaim === 'function'
      ? production.publicationExecutionClaim(publisherId, artifact) : undefined
    const raw = await provider.publishArtifact(artifact, records, execution)
    if (raw && typeof raw === 'object' && ['receiptId', 'publicationAttemptId', 'publicationAttemptNumber', 'publicationIntent']
      .some(field => Object.hasOwn(raw, field))) throw new Error('Publisher supplied protected publication attempt fields')
    let receipt
    try { receipt = normalizePublicationReceipt(raw, publisherId, records) }
    catch { throw new PublisherOutcomeError('unknown', 'receipt-normalization', 'Publisher reported success but its Receipt failed trusted normalization') }
    if (receipt.draftId !== artifact.draftId
      || receipt.draftVersion !== artifact.draftVersion
      || receipt.artifactSha256 !== artifact.artifactSha256
      || receipt.artifactBindingSha256 !== artifact.artifactBindingSha256
      || receipt.sha256 !== artifact.artifactSha256
      || receipt.bytes !== Buffer.byteLength(artifact.markdown, 'utf8')
      || receipt.itemCount !== records.length
      || receipt.truncated !== 0
      || receipt.contentStoreIds.length !== artifact.sourceContentStoreIds.length
      || receipt.contentStoreIds.some((id, index) => id !== artifact.sourceContentStoreIds[index])) {
      throw new Error('Publisher receipt does not match the approved artifact')
    }
    const protectedReceipt = claim ? { ...receipt, receiptId: claim.receiptId,
      publicationAttemptId: claim.attemptId, publicationAttemptNumber: claim.attemptNumber, publicationIntent: claim.intent } : receipt
    const sink = this.receiptSink
    if (!sink) return protectedReceipt
    try {
      return await sink(receipt, {
        ...(claim ? { receiptId: claim.receiptId, publicationAttemptId: claim.attemptId,
          publicationAttemptNumber: claim.attemptNumber, publicationIntent: claim.intent } : {}),
        trigger: claim?.trigger ?? execution.trigger ?? 'host',
        jobId: execution.jobId,
        workflowId: execution.workflowId,
        signal: execution.signal,
      })
    } catch {
      this.ctx.logger.error('prismflow publisher: publication committed but durable receipt persistence failed')
      return {
        ...protectedReceipt,
        publicationCommitted: receipt.status !== 'skipped',
        receiptPersistence: 'failed',
      }
    }
  }
}

export default PrismPublisherRegistry
