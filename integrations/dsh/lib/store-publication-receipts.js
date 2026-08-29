import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  prepareStoredPublicationReceipt,
  queryPublicationReceipts,
} from './shared/publication-receipt.js'

const controlFree = (max) => z.string().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value))
const isoInstant = z.string().max(40).refine((value) => {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
})
const gitSha = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/)
const contentStoreId = z.string().regex(/^[a-f0-9]{64}$/)

const receiptSchema = z.object({
  receiptId: z.string().uuid(),
  publisherId: controlFree(256),
  status: z.enum(['created', 'updated', 'unchanged', 'skipped']),
  itemCount: z.number().int().min(1).max(100),
  truncated: z.number().int().min(0).max(100),
  omittedMedia: z.number().int().min(0).max(100).optional(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  publishedAt: isoInstant,
  recordedAt: isoInstant,
  trigger: z.enum(['manual', 'scheduler', 'workflow', 'host']),
  contentStoreIds: z.array(contentStoreId).min(1).max(100),
  fileName: controlFree(512).optional(),
  path: controlFree(2_048).optional(),
  key: controlFree(2_048).optional(),
  repository: controlFree(256).optional(),
  branch: controlFree(256).optional(),
  bucket: controlFree(128).optional(),
  publicUrl: z.string().url().max(2_048).refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  }).optional(),
  operation: controlFree(64).optional(),
  commitSha: gitSha.optional(),
  contentSha: gitSha.optional(),
  etag: controlFree(256).optional(),
  versionId: controlFree(512).optional(),
  verification: z.enum(['verified', 'unverified']).optional(),
  draftId: controlFree(128).optional(),
  draftVersion: z.number().int().positive().optional(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  artifactBindingSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  articleType: z.enum(['news', 'newspic']).optional(),
  wechatDraftMediaId: controlFree(128).optional(),
  publicationAttemptId: z.string().uuid().optional(),
  publicationAttemptNumber: z.number().int().positive().optional(),
  publicationIntent: z.enum(['initial', 'repeat']).optional(),
  jobId: controlFree(128).optional(),
  workflowId: controlFree(128).optional(),
}).strict().refine(value => value.contentStoreIds.length === value.itemCount)

export const prismPublicationReceiptDomain = defineDomain({
  name: 'prismflow_publication_receipts',
  version: 1,
  tables: {
    receipts: domainTable(receiptSchema),
  },
})

export class PrismPublicationReceiptStore extends Service {
  static inject = ['storageDomain', 'prismPublishers']

  constructor(ctx) {
    super(ctx, 'prismPublicationReceipts')
    this.receipts = undefined
    this.operationTail = Promise.resolve()
    this.disposing = false
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(prismPublicationReceiptDomain)
    this.receipts = domain.table('receipts')
    const sink = (receipt, context) => this.append(receipt, context)
    this.ctx.prismPublishers.registerReceiptSink(sink)
    this.ctx.effect(() => async () => {
      await this.ctx.prismPublishers.closeReceiptSink(sink)
      this.disposing = true
      await this.operationTail
      await domain.close()
    }, 'prismflow-publication-receipts.domainClose')
  }

  append(receipt, context = {}) {
    return this.enqueueMutation(async () => {
      const table = this.requireReceipts()
      const receiptId = context.receiptId ?? randomUUID()
      const existing = table.get(receiptId)
      const record = prepareStoredPublicationReceipt(receipt, {
        receiptId,
        trigger: context.trigger,
        jobId: context.jobId,
        workflowId: context.workflowId,
        publicationAttemptId: context.publicationAttemptId,
        publicationAttemptNumber: context.publicationAttemptNumber,
        publicationIntent: context.publicationIntent,
        ...(existing?.recordedAt ? { recordedAt: new Date(existing.recordedAt) } : {}),
      })
      if (existing !== undefined) {
        const parsed = receiptSchema.safeParse(existing)
        const expected = receiptSchema.safeParse(record)
        if (!parsed.success || !expected.success || JSON.stringify(parsed.data) !== JSON.stringify(expected.data)) {
          throw new Error(`Publication receipt id already exists with conflicting content: ${receiptId}`)
        }
        return JSON.parse(JSON.stringify(parsed.data))
      }
      await table.put(record.receiptId, record)
      const persisted = receiptSchema.safeParse(table.get(record.receiptId))
      const expected = receiptSchema.safeParse(record)
      if (!persisted.success || !expected.success || JSON.stringify(persisted.data) !== JSON.stringify(expected.data)) throw new Error('Publication receipt could not be verified after persistence')
      return JSON.parse(JSON.stringify(record))
    })
  }

  get(receiptId) {
    if (typeof receiptId !== 'string' || receiptId.length < 1 || receiptId.length > 128) {
      throw new Error('Publication receipt id must be a non-empty string of at most 128 characters')
    }
    const receipt = this.requireReceipts().get(receiptId)
    return receipt === undefined ? undefined : JSON.parse(JSON.stringify(receipt))
  }

  list(query = {}) {
    return queryPublicationReceipts(
      Array.from(this.requireReceipts().entries(), ([, receipt]) => receipt),
      query,
    )
  }

  attemptNumberSeed(publisherId, artifact) {
    let legacyCount = 0
    let knownMax = 0
    for (const [key, receipt] of this.requireReceipts().entries()) {
      const parsed = receiptSchema.safeParse(receipt)
      if (!parsed.success || key !== parsed.data.receiptId || Object.keys(parsed.data).length !== Object.keys(receipt).length) {
        throw new Error('Publication receipt storage contains a malformed key or row')
      }
      if (parsed.data.publisherId === publisherId && parsed.data.draftId === artifact.draftId) {
        if (parsed.data.publicationAttemptId) knownMax = Math.max(knownMax, parsed.data.publicationAttemptNumber ?? 0)
        else legacyCount += 1
      }
    }
    return Math.max(legacyCount, knownMax)
  }

  inspectAttemptPublication(attempt, artifact) {
    if (!attempt || typeof attempt !== 'object' || typeof attempt.attemptId !== 'string' || typeof attempt.receiptId !== 'string'
      || typeof attempt.publisherId !== 'string' || !artifact || typeof artifact !== 'object') throw new Error('Publication attempt recovery query is invalid')
    const receipt = this.requireReceipts().get(attempt.receiptId)
    if (receipt === undefined) return { outcome: 'none' }
    const parsed = receiptSchema.safeParse(receipt)
    if (!parsed.success || parsed.data.receiptId !== attempt.receiptId || Object.keys(parsed.data).length !== Object.keys(receipt).length) {
      throw new Error('Publication receipt storage contains a malformed key or row')
    }
    const exact = parsed.data.publisherId === attempt.publisherId
      && parsed.data.publicationAttemptId === attempt.attemptId
      && parsed.data.publicationAttemptNumber === attempt.attemptNumber
      && parsed.data.publicationIntent === attempt.intent
      && parsed.data.draftId === artifact.draftId && parsed.data.draftVersion === artifact.draftVersion
      && parsed.data.artifactSha256 === artifact.artifactSha256
      && parsed.data.artifactBindingSha256 === artifact.artifactBindingSha256
      && parsed.data.sha256 === artifact.artifactSha256
      && parsed.data.bytes === Buffer.byteLength(artifact.markdown, 'utf8')
      && JSON.stringify(parsed.data.contentStoreIds) === JSON.stringify(artifact.sourceContentStoreIds)
    if (!exact) return { outcome: 'ambiguous' }
    return { outcome: parsed.data.status === 'skipped' ? 'not-committed' : 'committed', receipt: JSON.parse(JSON.stringify(parsed.data)) }
  }

  /** Legacy-only recovery for claims which predate publication attempt identities. */
  inspectArtifactPublication(publisherId, artifact) {
    if (typeof publisherId !== 'string' || !artifact || typeof artifact !== 'object') throw new Error('Publication recovery query is invalid')
    const related = Array.from(this.requireReceipts().entries(), ([key, receipt]) => {
      const parsed = receiptSchema.safeParse(receipt)
      if (!parsed.success || key !== parsed.data.receiptId || Object.keys(parsed.data).length !== Object.keys(receipt).length) {
        throw new Error('Publication receipt storage contains a malformed key or row')
      }
      return parsed.data
    }).filter(receipt => receipt.publisherId === publisherId && receipt.draftId === artifact.draftId)
    const exact = related.filter(receipt => receipt.draftVersion === artifact.draftVersion
      && receipt.artifactSha256 === artifact.artifactSha256 && receipt.artifactBindingSha256 === artifact.artifactBindingSha256
      && receipt.sha256 === artifact.artifactSha256
      && receipt.bytes === Buffer.byteLength(artifact.markdown, 'utf8')
      && JSON.stringify(receipt.contentStoreIds) === JSON.stringify(artifact.sourceContentStoreIds))
    const committed = exact.filter(receipt => ['created', 'updated', 'unchanged'].includes(receipt.status))
    if (committed.length) return { outcome: 'committed', receipt: JSON.parse(JSON.stringify(committed.at(-1))) }
    if (exact.length && exact.every(receipt => receipt.status === 'skipped')) return { outcome: 'not-committed' }
    return { outcome: related.length ? 'ambiguous' : 'none' }
  }

  enqueueMutation(operation) {
    if (this.disposing) return Promise.reject(new Error('PrismFlow publication receipt store is disposing'))
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  requireReceipts() {
    if (!this.receipts) throw new Error('PrismFlow publication receipt store is not initialized')
    return this.receipts
  }
}

export default PrismPublicationReceiptStore
