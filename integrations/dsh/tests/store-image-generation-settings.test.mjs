import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import { PrismImageGenerationSettingsStore } from '../lib/store-image-generation-settings.js'

class Table { constructor() { this.map = new Map() } get(key) { return this.map.get(key) } async put(key, value) { this.map.set(key, structuredClone(value)) } entries() { return this.map.entries() } }
function fixture(config = {}) {
  const ctx = new Context(); const current = new Table(); const history = new Table(); const secrets = new Map(); let writable = true
  Object.defineProperty(ctx, 'storageDomain', { value: { async open() { return { table: name => name === 'current' ? current : history, async close() {} } } } })
  Object.defineProperty(ctx, 'credentials', { value: {
    async describe(ref) { return { configured: secrets.has(ref), writable, source: secrets.has(ref) ? 'file' : undefined } },
    async resolve(ref) { return secrets.has(ref) ? { value: secrets.get(ref) } : undefined }, async set(ref, value) { secrets.set(ref, value) }, async unset(ref) { secrets.delete(ref) },
  } })
  ctx.effect = () => {}
  const service = new PrismImageGenerationSettingsStore(ctx, config)
  return { ctx, service, current, history, secrets, setWritable(value) { writable = value } }
}

test('persists CAS-versioned image settings and validates safe OpenAI-compatible endpoints', async () => {
  const value = fixture(); await value.service[Service.init]()
  const initial = value.service.get(); assert.equal(initial.version, 1); assert.equal(initial.imageModel, 'gpt-image-1'); assert.equal(initial.ffmpegPath, '')
  const next = await value.service.update({ imageApiUrl: 'https://images.example/v1/chat/completions', imageApiProtocol: 'chat-completions', imageModel: 'image-pro', imageSize: '1536x1024', avifQuality: 75, avifEffort: 6, ffmpegPath: '/opt/homebrew/bin/ffmpeg' }, { version: initial.version, sha256: initial.sha256 })
  assert.equal(next.version, 2); assert.equal(value.service.runtime().imageModel, 'image-pro'); assert.equal(value.service.runtime().ffmpegPath, '/opt/homebrew/bin/ffmpeg'); assert.equal(value.history.map.size, 2)
  await assert.rejects(value.service.update(value.service.runtime(), { version: 1, sha256: initial.sha256 }), error => error.code === 'conflict')
  const http = await value.service.update({ ...value.service.runtime(), imageApiUrl: 'http://images.example/v1/images/generations' }, { version: next.version, sha256: next.sha256 })
  assert.equal(http.imageApiUrl, 'http://images.example/v1/images/generations')
  await assert.rejects(value.service.update({ ...value.service.runtime(), imageApiUrl: 'http://user:secret@images.example/v1/images/generations?token=bad#fragment' }, { version: http.version, sha256: http.sha256 }), /credential-free HTTP\(S\)/u)
})

test('reads legacy image-only records and upgrades them on the next CAS write', async () => {
  const value = fixture()
  const legacyFields = ['imageApiUrl', 'imageApiProtocol', 'imageModel', 'imageSize', 'avifQuality', 'avifEffort']
  const legacy = { id: 'current', version: 4, imageApiUrl: 'https://images.example/v1/images/generations', imageApiProtocol: 'auto', imageModel: 'legacy', imageSize: '1024x1024', avifQuality: 70, avifEffort: 5, updatedAt: '2026-01-01T00:00:00.000Z' }
  legacy.sha256 = createHash('sha256').update(JSON.stringify(legacyFields.map(field => [field, legacy[field]])), 'utf8').digest('hex')
  value.current.map.set('current', legacy)
  await value.service[Service.init]()
  const current = value.service.get(); assert.equal(current.ffmpegPath, ''); assert.equal(current.sha256, legacy.sha256)
  const upgraded = await value.service.update({ ...value.service.runtime(), ffmpegPath: '/usr/bin/ffmpeg' }, { version: current.version, sha256: current.sha256 })
  assert.equal(upgraded.version, 5); assert.equal(upgraded.ffmpegPath, '/usr/bin/ffmpeg')
})

test('manages the fixed image API credential write-only and honors higher-priority ownership', async () => {
  const value = fixture(); await value.service[Service.init]()
  assert.deepEqual(await value.service.describeCredential(), { configured: false, writable: true, allowDashboardWrite: true })
  const saved = await value.service.setCredential('secret-value'); assert.equal(saved.configured, true); assert.equal(JSON.stringify(saved).includes('secret-value'), false)
  assert.equal((await value.service.resolveCredential()).value, 'secret-value')
  const removed = await value.service.unsetCredential(); assert.equal(removed.configured, false)
  value.setWritable(false); await assert.rejects(value.service.setCredential('next-secret'), /higher-priority/u)
})
