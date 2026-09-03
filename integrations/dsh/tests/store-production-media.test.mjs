import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import sharp from 'sharp'
import { PrismProductionMediaService } from '../lib/store-production-media.js'

class Table {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { this.map.set(key, structuredClone(value)) }
}

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('Production Media resolves an exact claim by assetId without returning persisted Base64 or bytes', async () => {
  const service = new PrismProductionMediaService(new Context(), { maxAssetBytes: 10 * 1024 * 1024, maxAssets: 100 })
  service.assets = new Table()
  const admitted = await service.ingest(PIXEL)
  const resolved = await service.getClaim(admitted.assetId)
  assert.deepEqual(resolved, admitted)
  assert.equal(Object.hasOwn(resolved, 'base64'), false)
  assert.equal(Buffer.isBuffer(resolved.bytes), false)
  await assert.rejects(service.getClaim('0'.repeat(64)), /unavailable/)
  await assert.rejects(service.getClaim('bad'), /asset id is invalid/)
})

test('Production Media converts bounded AVIF input into an exact persisted JPEG claim', async () => {
  const service = new PrismProductionMediaService(new Context(), { maxAssetBytes: 10 * 1024 * 1024, maxAssets: 100 })
  service.assets = new Table()
  const avif = await sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0.5 } } }).avif().toBuffer()
  const admitted = await service.ingest(avif)
  assert.equal(admitted.mime, 'image/jpeg'); assert.equal(admitted.width, 8); assert.equal(admitted.height, 6)
  const resolved = await service.resolve(admitted)
  assert.equal(resolved.bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), true)
})
