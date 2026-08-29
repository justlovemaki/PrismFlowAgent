import { createHash } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const name = 'prismflow-store-rss-outputs'
export const inject = ['storageDomain']
export const Config = Schema.object({
  maxOutputs: Schema.number().step(1).min(1).max(10_000).default(1_000),
  maxXmlBytes: Schema.number().step(1).min(1_024).max(4 * 1024 * 1024).default(2 * 1024 * 1024),
})

const SHA = /^[a-f0-9]{64}$/u
const rssOutputSchema = z.object({
  outputId: z.string().regex(SHA), draftId: z.string().min(1).max(128), draftVersion: z.number().int().min(1).max(1_000_000_000),
  artifactSha256: z.string().regex(SHA), title: z.string().min(1).max(300), markdown: z.string().max(1_000_000),
  htmlContent: z.string().max(4 * 1024 * 1024), xml: z.string().min(1).max(4 * 1024 * 1024), xmlSha256: z.string().regex(SHA),
  itemUrl: z.string().url().max(2_048), generatedAt: z.string().datetime(),
}).strict()

export const prismRssOutputsDomain = defineDomain({
  name: 'prismflow_rss_outputs', version: 1, tables: { outputs: domainTable(rssOutputSchema) },
})

function outputIdFor(value, xmlSha256) {
  return createHash('sha256').update(JSON.stringify(['prismflow-rss-output-v1', value.draftId, value.draftVersion, value.artifactSha256, xmlSha256]), 'utf8').digest('hex')
}
function normalize(value, maxXmlBytes, generatedAt = new Date().toISOString()) {
  const xmlBytes = Buffer.byteLength(value.xml ?? '', 'utf8')
  if (!value || typeof value !== 'object' || !SHA.test(value.artifactSha256 ?? '') || typeof value.xml !== 'string'
    || xmlBytes < 1 || xmlBytes > maxXmlBytes || typeof value.markdown !== 'string' || typeof value.htmlContent !== 'string') {
    throw new Error('RSS output value exceeds its persistence limits')
  }
  const xmlSha256 = createHash('sha256').update(value.xml, 'utf8').digest('hex')
  const record = {
    outputId: outputIdFor(value, xmlSha256), draftId: value.draftId, draftVersion: value.draftVersion,
    artifactSha256: value.artifactSha256, title: value.title, markdown: value.markdown, htmlContent: value.htmlContent,
    xml: value.xml, xmlSha256, itemUrl: value.itemUrl, generatedAt,
  }
  return rssOutputSchema.parse(record)
}
function clone(value) { return structuredClone(value) }

export class PrismRssOutputStore extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismRssOutputs')
    this.maxOutputs = config.maxOutputs ?? 1_000
    this.maxXmlBytes = config.maxXmlBytes ?? 2 * 1024 * 1024
    this.outputs = undefined
    this.tail = Promise.resolve()
    this.stopping = false
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(prismRssOutputsDomain)
    this.outputs = domain.table('outputs')
    this.stopping = false
    this.ctx.effect(() => async () => {
      this.stopping = true
      await this.tail.catch(() => {})
      this.outputs = undefined
      await domain.close()
    }, 'prismflow-rss-outputs.domainClose')
  }

  requireOutputs() { if (!this.outputs) throw new Error('RSS Output Store is unavailable'); return this.outputs }
  enqueue(operation) {
    if (this.stopping) return Promise.reject(new Error('RSS Output Store is stopping'))
    const result = this.tail.catch(() => {}).then(operation)
    this.tail = result.catch(() => {})
    return result
  }

  async save(value) {
    return this.enqueue(async () => {
      const outputs = this.requireOutputs()
      const candidate = normalize(value, this.maxXmlBytes)
      const existing = outputs.get(candidate.outputId)
      if (existing !== undefined) {
        const parsed = rssOutputSchema.safeParse(existing)
        if (!parsed.success || parsed.data.xmlSha256 !== candidate.xmlSha256 || parsed.data.artifactSha256 !== candidate.artifactSha256) {
          throw new Error('Persisted RSS output is corrupt')
        }
        return clone(parsed.data)
      }
      if (Array.from(outputs.entries()).length >= this.maxOutputs) throw new Error('RSS Output Store limit is reached')
      await outputs.put(candidate.outputId, candidate)
      return clone(candidate)
    })
  }

  get(outputId) {
    if (!SHA.test(outputId ?? '')) return undefined
    const raw = this.requireOutputs().get(outputId)
    if (raw === undefined) return undefined
    const parsed = rssOutputSchema.safeParse(raw)
    if (!parsed.success || parsed.data.outputId !== outputId || createHash('sha256').update(parsed.data.xml, 'utf8').digest('hex') !== parsed.data.xmlSha256) {
      throw new Error('Persisted RSS output is corrupt')
    }
    return clone(parsed.data)
  }

  list(query = {}) {
    const limit = Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= 100 ? query.limit : 50
    const rows = []
    for (const [key, raw] of this.requireOutputs().entries()) {
      const parsed = rssOutputSchema.safeParse(raw)
      if (!parsed.success || parsed.data.outputId !== key || createHash('sha256').update(parsed.data.xml, 'utf8').digest('hex') !== parsed.data.xmlSha256) {
        throw new Error('Persisted RSS output is corrupt')
      }
      if (!query.draftId || parsed.data.draftId === query.draftId) rows.push(parsed.data)
    }
    return rows.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.outputId.localeCompare(a.outputId)).slice(0, limit).map(clone)
  }
}

export function apply(ctx, config) { ctx.plugin(PrismRssOutputStore, config) }
export default PrismRssOutputStore
