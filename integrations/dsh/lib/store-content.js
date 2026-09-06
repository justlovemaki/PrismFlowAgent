import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  countStoredContent,
  prepareStoredContentRecord,
  queryStoredContent,
} from './shared/content-store.js'

const contentItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  description: z.string(),
  published_date: z.string(),
  ingestion_date: z.string().optional(),
  source: z.string(),
  category: z.string(),
  author: z.string().optional(),
  status: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).catchall(z.unknown())

const storedContentSchema = z.object({
  storeId: z.string(),
  sourceId: z.string(),
  externalId: z.string(),
  firstSeenAt: z.string(),
  updatedAt: z.string(),
  fetchedAt: z.string(),
  status: z.enum(['unread', 'read', 'archived']),
  item: contentItemSchema,
})

export const prismContentDomain = defineDomain({
  name: 'prismflow_content',
  version: 1,
  tables: {
    items: domainTable(storedContentSchema),
  },
})

export class PrismContentStore extends Service {
  static inject = ['storageDomain']

  constructor(ctx) {
    super(ctx, 'prismContentStore')
    this.items = undefined
    this.operationTail = Promise.resolve()
    this.disposing = false
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(prismContentDomain)
    this.ctx.effect(() => async () => {
      this.disposing = true
      await this.operationTail
      await domain.close()
    }, 'prismflow-content.domainClose')
    this.items = domain.table('items')
  }

  putBatch(sourceId, inputs, options = {}) {
    if (!Array.isArray(inputs)) return Promise.reject(new Error('Content batch must be an array'))
    if (inputs.length > 500) return Promise.reject(new Error('Content batch cannot exceed 500 items'))

    return this.enqueueMutation(async () => {
      const table = this.requireItems()
      const seen = new Set()
      const summary = { inserted: 0, updated: 0, skipped: 0, total: inputs.length }

      for (const input of inputs) {
        this.throwIfAborted(options.signal)
        let candidate
        try { candidate = prepareStoredContentRecord(sourceId, input, undefined, options.now) }
        catch { summary.skipped += 1; continue }
        if (seen.has(candidate.storeId)) {
          summary.skipped += 1
          continue
        }
        seen.add(candidate.storeId)

        const existing = table.get(candidate.storeId)
        if (existing && !options.overwrite) {
          summary.skipped += 1
          continue
        }

        let record
        try { record = existing ? prepareStoredContentRecord(sourceId, input, existing, options.now) : candidate }
        catch { summary.skipped += 1; continue }
        await table.put(record.storeId, record)
        if (existing) summary.updated += 1
        else summary.inserted += 1
      }

      return summary
    })
  }

  /** Delete only explicitly selected IDs; serialize against ingestion and report partial storage failures. */
  deleteBatch(storeIds) {
    if (!Array.isArray(storeIds) || storeIds.length < 1 || storeIds.length > 100
      || storeIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id))
      || new Set(storeIds).size !== storeIds.length) {
      return Promise.reject(new Error('storeIds must contain 1 to 100 unique SHA-256 IDs'))
    }
    const ids = [...storeIds]
    return this.enqueueMutation(async () => {
      const table = this.requireItems()
      const result = { deletedIds: [], missingIds: [], failedIds: [] }
      for (const id of ids) {
        if (!table.get(id)) { result.missingIds.push(id); continue }
        try { await table.delete(id); result.deletedIds.push(id) }
        catch { result.failedIds.push(id) }
      }
      return result
    })
  }

  get(storeId) {
    return this.requireItems().get(storeId)
  }

  records(filter) {
    if (filter !== undefined && typeof filter !== 'function') throw new Error('Content record filter must be a function')
    const records = []
    for (const [, record] of this.requireItems().entries()) if (!filter || filter(record)) records.push(record)
    return records
  }

  list(query = {}, filter) {
    return queryStoredContent(this.records(filter), query)
  }

  count(query = {}, filter) {
    return countStoredContent(this.records(filter), query)
  }

  categoryCounts(filter) {
    const counts = new Map()
    for (const record of this.records(filter)) {
      const category = typeof record.item?.category === 'string' ? record.item.category.trim() : ''
      if (category) counts.set(category, (counts.get(category) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => left.category.localeCompare(right.category))
  }

  snapshot(maxRecords = 100_000) {
    if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 1_000_000) {
      throw new Error('Content snapshot limit must be an integer from 1 to 1000000')
    }
    const records = []
    for (const [, record] of this.requireItems().entries()) {
      if (records.length >= maxRecords) throw new Error(`Content snapshot exceeds the configured ${maxRecords}-record limit`)
      records.push(record)
    }
    return records
  }

  setStatus(storeId, status) {
    if (!['unread', 'read', 'archived'].includes(status)) {
      return Promise.reject(new Error(`Unsupported content status: ${status}`))
    }
    return this.enqueueMutation(async () => {
      const table = this.requireItems()
      if (!table.get(storeId)) throw new Error(`Unknown stored content: ${storeId}`)
      return table.update(storeId, current => ({
        ...current,
        status,
        updatedAt: new Date().toISOString(),
      }))
    })
  }

  enqueueMutation(operation) {
    if (this.disposing) return Promise.reject(new Error('PrismFlow content store is disposing'))
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  throwIfAborted(signal) {
    if (signal?.aborted) {
      throw new Error(`Content persistence aborted: ${String(signal.reason ?? 'aborted')}`)
    }
  }

  requireItems() {
    if (!this.items) throw new Error('PrismFlow content store is not initialized')
    return this.items
  }
}

export default PrismContentStore
