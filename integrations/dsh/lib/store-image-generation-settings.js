import { createHash } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const name = 'prismflow-store-image-generation-settings'
export const inject = ['storageDomain', 'credentials']

export const Config = Schema.object({
  apiKeyCredential: Schema.string().role('credential-ref').default('OPENAI_IMAGE_API_KEY'),
  allowDashboardCredentialWrite: Schema.boolean().default(true),
  imageApiUrl: Schema.string().default('https://api.openai.com/v1/images/generations'),
  imageApiProtocol: Schema.union(['auto', 'chat-completions', 'images-generations']).default('auto'),
  imageModel: Schema.string().default('gpt-image-1'),
  imageSize: Schema.string().default('1024x1024'),
  avifQuality: Schema.number().step(1).min(1).max(100).default(70),
  avifEffort: Schema.number().step(1).min(0).max(9).default(5),
})

const SHA = /^[a-f0-9]{64}$/u
const REF = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u
const SETTINGS_FIELDS = ['imageApiUrl', 'imageApiProtocol', 'imageModel', 'imageSize', 'avifQuality', 'avifEffort']
const recordSchema = z.object({
  id: z.literal('current'), version: z.number().int().min(1).max(1_000_000_000), sha256: z.string().regex(SHA),
  imageApiUrl: z.string().min(1).max(2_048), imageApiProtocol: z.enum(['auto', 'chat-completions', 'images-generations']),
  imageModel: z.string().min(1).max(256), imageSize: z.string().min(1).max(64),
  avifQuality: z.number().int().min(1).max(100), avifEffort: z.number().int().min(0).max(9), updatedAt: z.string().datetime(),
}).strict()

export const prismImageGenerationSettingsDomain = defineDomain({
  name: 'prismflow_image_generation_settings', version: 1,
  tables: { current: domainTable(recordSchema), history: domainTable(recordSchema) },
})

export class ImageGenerationSettingsError extends Error {
  constructor(message, code = 'validation') { super(message); this.name = 'ImageGenerationSettingsError'; this.code = code }
}

function cleanText(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ImageGenerationSettingsError(`${field} is invalid`)
  }
  return value.trim()
}
function normalizeUrl(value) {
  const raw = cleanText(value, 'imageApiUrl', 2_048)
  let url
  try { url = new URL(raw) } catch { throw new ImageGenerationSettingsError('imageApiUrl must be a valid URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ImageGenerationSettingsError('imageApiUrl must be credential-free HTTP(S) without query or fragment')
  }
  return url.toString()
}
function normalizeInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== SETTINGS_FIELDS.length
    || SETTINGS_FIELDS.some(field => !Object.hasOwn(value, field))) throw new ImageGenerationSettingsError('Image generation settings fields are invalid')
  const imageApiProtocol = value.imageApiProtocol
  if (!['auto', 'chat-completions', 'images-generations'].includes(imageApiProtocol)) throw new ImageGenerationSettingsError('imageApiProtocol is invalid')
  if (!Number.isInteger(value.avifQuality) || value.avifQuality < 1 || value.avifQuality > 100
    || !Number.isInteger(value.avifEffort) || value.avifEffort < 0 || value.avifEffort > 9) throw new ImageGenerationSettingsError('AVIF settings are invalid')
  return {
    imageApiUrl: normalizeUrl(value.imageApiUrl), imageApiProtocol,
    imageModel: cleanText(value.imageModel, 'imageModel', 256), imageSize: cleanText(value.imageSize, 'imageSize', 64),
    avifQuality: value.avifQuality, avifEffort: value.avifEffort,
  }
}
function settingsHash(value) {
  return createHash('sha256').update(JSON.stringify(SETTINGS_FIELDS.map(field => [field, value[field]])), 'utf8').digest('hex')
}
function makeRecord(settings, version, now = new Date()) {
  const normalized = normalizeInput(settings)
  return recordSchema.parse({ id: 'current', ...normalized, version, sha256: settingsHash(normalized), updatedAt: now.toISOString() })
}
function validateRecord(raw) {
  const parsed = recordSchema.safeParse(raw)
  if (!parsed.success || settingsHash(parsed.data) !== parsed.data.sha256) throw new ImageGenerationSettingsError('Persisted image generation settings are corrupt', 'corrupt')
  return parsed.data
}
function clone(value) { return structuredClone(value) }

export class PrismImageGenerationSettingsStore extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismImageGenerationSettings')
    if (!REF.test(config.apiKeyCredential ?? 'OPENAI_IMAGE_API_KEY')) throw new ImageGenerationSettingsError('Image API Credential Ref is invalid')
    this.credentialRef = config.apiKeyCredential ?? 'OPENAI_IMAGE_API_KEY'
    this.allowDashboardCredentialWrite = config.allowDashboardCredentialWrite ?? true
    this.bootstrap = normalizeInput({
      imageApiUrl: config.imageApiUrl ?? 'https://api.openai.com/v1/images/generations',
      imageApiProtocol: config.imageApiProtocol ?? 'auto', imageModel: config.imageModel ?? 'gpt-image-1', imageSize: config.imageSize ?? '1024x1024',
      avifQuality: config.avifQuality ?? 70, avifEffort: config.avifEffort ?? 5,
    })
    this.current = undefined; this.history = undefined; this.tail = Promise.resolve(); this.stopping = false
  }
  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(prismImageGenerationSettingsDomain)
    this.current = domain.table('current'); this.history = domain.table('history')
    try {
      const existing = this.current.get('current')
      if (existing === undefined) {
        const initial = makeRecord(this.bootstrap, 1)
        await this.current.put('current', initial); await this.history.put(String(initial.version), initial)
      } else validateRecord(existing)
      this.ctx.effect(() => async () => { this.stopping = true; await this.tail.catch(() => {}); this.current = undefined; this.history = undefined; await domain.close() }, 'prismflow-image-generation-settings.domainClose')
    } catch (error) { this.current = undefined; this.history = undefined; await domain.close(); throw error }
  }
  requireCurrent() { if (!this.current) throw new ImageGenerationSettingsError('Image generation settings store is unavailable', 'unavailable'); return this.current }
  requireHistory() { if (!this.history) throw new ImageGenerationSettingsError('Image generation settings history is unavailable', 'unavailable'); return this.history }
  get() { return clone(validateRecord(this.requireCurrent().get('current'))) }
  runtime() { const value = this.get(); return Object.fromEntries(SETTINGS_FIELDS.map(field => [field, value[field]])) }
  update(settings, expected) {
    return this.enqueue(async () => {
      if (!expected || typeof expected !== 'object' || !Number.isInteger(expected.version) || !SHA.test(expected.sha256 ?? '')) throw new ImageGenerationSettingsError('Expected settings revision is invalid')
      const current = this.get()
      if (current.version !== expected.version || current.sha256 !== expected.sha256) throw new ImageGenerationSettingsError('Image generation settings changed; reload before saving', 'conflict')
      const next = makeRecord(settings, current.version + 1)
      await this.requireHistory().put(String(next.version), next); await this.requireCurrent().put('current', next)
      const committed = this.get()
      if (committed.version !== next.version || committed.sha256 !== next.sha256) throw new ImageGenerationSettingsError('Image generation settings commit could not be verified', 'commit')
      return committed
    })
  }
  async describeCredential() {
    let info
    try { info = await this.ctx.credentials.describe(this.credentialRef) } catch { throw new ImageGenerationSettingsError('Image API credential status could not be read', 'credential') }
    return { configured: info?.configured === true, writable: info?.writable === true, allowDashboardWrite: this.allowDashboardCredentialWrite,
      ...(typeof info?.source === 'string' ? { source: info.source.slice(0, 64) } : {}) }
  }
  async resolveCredential() { return this.ctx.credentials.resolve(this.credentialRef) }
  setCredential(value) {
    return this.enqueue(async () => {
      await this.assertCredentialWritable()
      if (typeof value !== 'string' || !value.trim() || value.length > 16 * 1024 || /[\u0000-\u001f\u007f]/u.test(value)) throw new ImageGenerationSettingsError('Image API credential value is invalid')
      try { await this.ctx.credentials.set(this.credentialRef, value) } catch { throw new ImageGenerationSettingsError('Image API credential could not be stored', 'credential') }
      return this.describeCredential()
    })
  }
  unsetCredential() {
    return this.enqueue(async () => {
      await this.assertCredentialWritable()
      try { await this.ctx.credentials.unset(this.credentialRef) } catch { throw new ImageGenerationSettingsError('Image API credential could not be removed', 'credential') }
      return this.describeCredential()
    })
  }
  async assertCredentialWritable() {
    const info = await this.describeCredential()
    if (!info.allowDashboardWrite) throw new ImageGenerationSettingsError('Image API credential is read-only in the Dashboard', 'credential')
    if (!info.writable) throw new ImageGenerationSettingsError('Image API credential is owned by a higher-priority read-only source', 'credential')
  }
  enqueue(operation) {
    if (this.stopping) return Promise.reject(new ImageGenerationSettingsError('Image generation settings store is stopping', 'unavailable'))
    const result = this.tail.catch(() => {}).then(operation); this.tail = result.catch(() => {}); return result
  }
}

export function apply(ctx, config) { ctx.plugin(PrismImageGenerationSettingsStore, config) }
export default PrismImageGenerationSettingsStore
