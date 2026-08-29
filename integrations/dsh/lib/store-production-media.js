import { createHash } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import sharp from 'sharp'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const name = 'prismflow-store-production-media'
export const inject = ['storageDomain']
const DefaultAsset = Schema.object({ ref: Schema.string().required(), assetId: Schema.string().required() })
export const Config = Schema.object({
  maxAssetBytes: Schema.number().step(1).min(1_024).max(32 * 1024 * 1024).default(10 * 1024 * 1024),
  maxAssets: Schema.number().step(1).min(1).max(100_000).default(10_000),
  defaultAssets: Schema.array(DefaultAsset).default([]),
})

const SHA256 = /^[a-f0-9]{64}$/u
const assetSchema = z.object({
  assetId: z.string().regex(SHA256), sha256: z.string().regex(SHA256), bytes: z.number().int().min(1).max(32 * 1024 * 1024),
  mime: z.enum(['image/jpeg', 'image/png', 'image/gif']), width: z.number().int().min(1).max(100_000), height: z.number().int().min(1).max(100_000),
  base64: z.string().min(1).max(45 * 1024 * 1024), createdAt: z.string(),
}).strict()

export const prismProductionMediaDomain = defineDomain({
  name: 'prismflow_production_media', version: 1, tables: { assets: domainTable(assetSchema) },
})

function inspectImage(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (bytes.length >= 10 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { mime: 'image/gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]
      if (marker === 0xd9 || marker === 0xda) break
      const size = bytes.readUInt16BE(offset + 2)
      if (size < 2 || offset + 2 + size > bytes.length) break
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { mime: 'image/jpeg', height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
      }
      offset += 2 + size
    }
  }
  throw new Error('Production media must be a structurally recognized JPG, PNG, or GIF image')
}

function claim(record) {
  return { assetId: record.assetId, sha256: record.sha256, bytes: record.bytes, mime: record.mime, width: record.width, height: record.height }
}

export class PrismProductionMediaService extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismProductionMedia')
    this.config = config
    this.defaultAssets = new Map()
    for (const item of config.defaultAssets ?? []) {
      if (typeof item.ref !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(item.ref) || !SHA256.test(item.assetId) || this.defaultAssets.has(item.ref)) {
        throw new Error('Production default media asset mapping is invalid')
      }
      this.defaultAssets.set(item.ref, item.assetId)
    }
    this.assets = undefined
    this.tail = Promise.resolve()
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(prismProductionMediaDomain)
    this.assets = domain.table('assets')
    this.ctx.effect(() => async () => { await this.tail; await domain.close(); this.assets = undefined }, 'prismflow-production-media.domainClose')
  }

  requireAssets() { if (!this.assets) throw new Error('Production media store is unavailable'); return this.assets }
  enqueue(operation) { const result = this.tail.then(operation); this.tail = result.then(() => {}, () => {}); return result }

  /** Internal pre-production admission seam. No Dashboard or publication route calls this method. */
  async ingest(value) {
    const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value) : undefined
    if (!bytes || bytes.length < 1 || bytes.length > this.config.maxAssetBytes) throw new Error('Production media asset exceeds its admission limit')
    const dimensions = inspectImage(bytes)
    let decoded
    try { decoded = await sharp(bytes, { failOn: 'error', limitInputPixels: 100_000_000, animated: true }).metadata() }
    catch { throw new Error('Production media image decoding failed') }
    const decodedMime = decoded.format === 'jpeg' ? 'image/jpeg' : decoded.format === 'png' ? 'image/png' : decoded.format === 'gif' ? 'image/gif' : undefined
    if (decodedMime !== dimensions.mime || decoded.width !== dimensions.width || decoded.height !== dimensions.height
      || dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height * (decoded.pages ?? 1) > 100_000_000) {
      throw new Error('Production media pixel dimensions are invalid')
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return this.enqueue(async () => {
      const assets = this.requireAssets()
      const existing = assets.get(sha256)
      if (existing) {
        if (existing.sha256 !== sha256 || Buffer.from(existing.base64, 'base64').length !== existing.bytes) throw new Error('Production media store contains a corrupt asset')
        return claim(existing)
      }
      if (Array.from(assets.entries()).length >= this.config.maxAssets) throw new Error('Production media store asset limit is reached')
      const record = { assetId: sha256, sha256, bytes: bytes.length, ...dimensions, base64: bytes.toString('base64'), createdAt: new Date().toISOString() }
      await assets.put(sha256, record)
      return claim(record)
    })
  }

  async getClaim(assetId) {
    if (typeof assetId !== 'string' || !SHA256.test(assetId)) throw new Error('Production media asset id is invalid')
    const record = this.requireAssets().get(assetId)
    if (!record) throw new Error('Production media asset is unavailable')
    const expected = claim(record)
    await this.resolve(expected)
    return expected
  }

  hasDeploymentAsset(ref) {
    const assetId = this.defaultAssets.get(ref)
    return typeof assetId === 'string' && this.requireAssets().get(assetId) !== undefined
  }

  async resolveDeploymentAsset(ref) {
    const assetId = this.defaultAssets.get(ref)
    if (!assetId) throw new Error('Deployment default media asset is not configured')
    const record = this.requireAssets().get(assetId)
    if (!record) throw new Error('Deployment default media asset is unavailable')
    return this.resolve(claim(record))
  }

  async assertClaims(claims) {
    if (!Array.isArray(claims)) throw new Error('Production media claims are invalid')
    for (const item of claims) await this.resolve(item)
    return true
  }

  async resolve(expected) {
    if (!expected || !SHA256.test(expected.assetId ?? '') || expected.assetId !== expected.sha256) throw new Error('Production media claim is invalid')
    const record = this.requireAssets().get(expected.assetId)
    if (!record || JSON.stringify(claim(record)) !== JSON.stringify(expected)) throw new Error('Production media claim does not match persisted bytes')
    const bytes = Buffer.from(record.base64, 'base64')
    if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error('Production media bytes are corrupt')
    return { ...claim(record), bytes }
  }
}

export default PrismProductionMediaService
