import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import AdmZip from 'adm-zip'
import Schema from '@deepseek-ai/schemastery'
import YAML from 'yaml'
import { managedMediaFetch } from './secure-rss-fetch.js'
import { publicationReconciliationResult } from './store-production.js'
import { PRISMFLOW_CORE_TOOL_NAMES, PRISMFLOW_TOOL_NAMES, prismFlowToolOrigin } from './store-prismflow-toolsets.js'
import { isPublisherOutcomeError } from './shared/publisher-outcome.js'
import {
  PublisherProfileCliError, beginPublisherProfileOperationDrain, cancelPendingPublisherProfileOperation,
  commitPublisherProfileOperation, exportPublisherProfile, getPendingPublisherProfileOperation, getPublisherProfileOperation,
  preparePublisherProfileOperation, resolveNamedProfile,
} from './publisher-profile-cli.js'

const API_PREFIX = '/api/prismflow'
const PLUGIN_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const PUBLISHER_OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MAX_BODY_BYTES = 32 * 1024
const MAX_REQUEST_TARGET_BYTES = 8 * 1024
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u
const SECRET_LIKE_CREDENTIAL_REF = /^(?:gh[pousr]_|github_pat_|sk-|AKIA|ASIA)/u
const PUBLISHER_CREDENTIAL_FIELDS = Object.freeze({
  'github-markdown': Object.freeze({ tokenCredential: 'GitHub Token' }),
  'r2-markdown': Object.freeze({ accessKeyIdCredential: 'R2 Access Key ID', secretAccessKeyCredential: 'R2 Secret Access Key' }),
  'wechat-draft': Object.freeze({ appSecretCredential: '微信公众号 App Secret' }),
})

export const name = 'prismflow-ui'
export const inject = ['webServer', 'credentials', 'prismImageGenerationSettings']
export const Config = Schema.object({
  dshHome: Schema.string().required(),
  profileName: Schema.string().required(),
})

class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

function jsonResponse(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function isLoopbackHostname(value) {
  if (typeof value !== 'string') return false
  const hostname = value.toLowerCase()
  return hostname === 'localhost' || hostname === '[::1]' || hostname === '127.0.0.1'
}

function validateLoopbackHost(req) {
  try {
    const host = req.headers.host
    const effectiveProtocol = req.socket?.encrypted === true ? 'https:' : 'http:'
    if (typeof host !== 'string' || host.length < 1 || /[\s\/,]/u.test(host)) throw new Error('host missing or malformed')
    const authority = new URL(`${effectiveProtocol}//${host}`)
    if (authority.username || authority.password || !isLoopbackHostname(authority.hostname)) throw new Error('host is not loopback')
    const defaultPort = effectiveProtocol === 'https:' ? 443 : 80
    const authorityPort = authority.port === '' ? defaultPort : Number(authority.port)
    if (!Number.isInteger(req.socket?.localPort) || authorityPort !== req.socket.localPort) throw new Error('host port mismatch')
    return authority
  } catch {
    throw new HttpError(403, 'PrismFlow dashboard Host must match the local loopback listener')
  }
}

function validateSameOrigin(req, authority, originRequired = false) {
  const origin = req.headers.origin
  if (origin === undefined) {
    if (originRequired) throw new HttpError(403, 'An explicit same-origin request is required')
    return
  }
  try {
    const parsed = new URL(origin)
    if (parsed.origin !== authority.origin || parsed.username || parsed.password) throw new Error('origin mismatch')
  } catch {
    throw new HttpError(403, 'Cross-origin requests are not allowed')
  }
}

function isLoopbackAddress(value) {
  if (typeof value !== 'string') return false
  const address = value.toLowerCase().split('%', 1)[0]
  return address === '::1'
    || address.startsWith('127.')
    || address.startsWith('::ffff:127.')
}

async function readBinary(req, expectedType, maxBodyBytes = MAX_BODY_BYTES) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith(expectedType)) throw new HttpError(415, `Expected ${expectedType}`)
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > maxBodyBytes) throw new HttpError(413, 'Request body is too large'); chunks.push(chunk) }
  if (!size) throw new HttpError(400, 'Request body is empty')
  return Buffer.concat(chunks)
}

function parseSkillZip(buffer) {
  let entries
  try { entries = new AdmZip(buffer).getEntries() } catch { throw new HttpError(400, 'Invalid ZIP archive') }
  if (entries.length < 1 || entries.length > 64) throw new HttpError(400, 'ZIP must contain 1 to 64 entries')
  const rawFiles = []; let total = 0
  for (const entry of entries) {
    const path = entry.entryName
    if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/u.test(path) || path.includes('\u0000')) throw new HttpError(400, 'ZIP contains an unsafe path')
    const parts = path.split('/').filter(Boolean)
    if (parts.some(part => part === '.' || part === '..') || parts.length > 8 || path.length > 240) throw new HttpError(400, 'ZIP contains an unsafe path')
    const unixType = (entry.attr >>> 16) & 0xf000
    if (unixType === 0xa000 || (entry.header?.flags & 1) !== 0) throw new HttpError(400, 'ZIP links and encrypted entries are not allowed')
    if (entry.isDirectory) continue
    const declared = Number(entry.header?.size ?? 0)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > 64 * 1024 || total + declared > 128 * 1024) throw new HttpError(413, 'Expanded Skill Bundle is too large')
    let data; try { data = entry.getData() } catch { throw new HttpError(400, 'ZIP entry cannot be extracted') }
    total += data.length; if (data.length !== declared || total > 128 * 1024) throw new HttpError(400, 'ZIP entry size is invalid')
    rawFiles.push({ path: parts.join('/'), data })
  }
  const hasRootSkill = rawFiles.some(file => file.path.toLowerCase() === 'skill.md')
  let wrapper = ''
  if (!hasRootSkill) {
    const roots = new Set(rawFiles.map(file => file.path.split('/')[0]))
    if (roots.size !== 1) throw new HttpError(400, 'ZIP must contain SKILL.md at its root or in one top-level directory')
    wrapper = [...roots][0]
  }
  const files = rawFiles.map(file => ({ ...file, path: wrapper ? file.path.slice(wrapper.length + 1) : file.path })).filter(file => file.path)
  const folded = new Set(); for (const file of files) { const key = file.path.toLowerCase(); if (folded.has(key)) throw new HttpError(400, 'ZIP contains duplicate paths'); folded.add(key) }
  const skillFile = files.find(file => file.path.toLowerCase() === 'skill.md')
  if (!skillFile || files.length > 32) throw new HttpError(400, 'Skill Bundle must contain SKILL.md and at most 32 files')
  let source; try { source = new TextDecoder('utf-8', { fatal: true }).decode(skillFile.data) } catch { throw new HttpError(400, 'SKILL.md must be UTF-8 text') }
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u); if (!match) throw new HttpError(400, 'SKILL.md is missing YAML frontmatter')
  let metadata; try { metadata = YAML.parse(match[1]) } catch { throw new HttpError(400, 'SKILL.md frontmatter is invalid YAML') }
  const name = metadata?.name; const description = metadata?.description
  if (typeof name !== 'string' || !/^prismflow-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64 || (wrapper && wrapper !== name)) throw new HttpError(400, 'Skill name must be prismflow-* kebab-case and match its directory')
  if (typeof description !== 'string' || !description.trim() || description.length > 1024) throw new HttpError(400, 'Skill description is invalid')
  const content = match[2].trim(); if (!content || content.length > 32000) throw new HttpError(400, 'Skill instructions are invalid')
  return { input: { skillId: name, name, description: description.trim(), whenToUse: '', content, enabled: metadata['disable-model-invocation'] !== true }, files }
}

async function readJson(req, maxBodyBytes = MAX_BODY_BYTES) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json')
  }
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBodyBytes) throw new HttpError(413, 'Request body is too large')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required')
    return value
  } catch {
    throw new HttpError(400, 'Request body must be a JSON object')
  }
}

function requireService(ctx, key, label) {
  const service = ctx.get(key)
  if (service === undefined) throw new HttpError(409, `${label} is not enabled in this profile`)
  return service
}

function text(value, field, max = 256, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`)
    return undefined
  }
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(400, `${field} is invalid`)
  }
  return value
}

function integer(value, field, minimum, maximum, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new HttpError(400, `${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function boolean(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new HttpError(400, `${field} must be a boolean`)
  return value
}

function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be a JSON object`)
  }
  return value
}

function allowFields(value, fields) {
  const unknown = Object.keys(value).find(key => !fields.includes(key))
  if (unknown) throw new HttpError(400, `Unsupported request field: ${unknown}`)
}
function allowQuery(searchParams, fields) {
  const seen = new Set()
  for (const key of searchParams.keys()) {
    if (!fields.includes(key) || seen.has(key)) throw new HttpError(400, `Unsupported or duplicate query field: ${key}`)
    seen.add(key)
  }
}

function receiptQuery(input = {}) {
  plainObject(input, 'query')
  allowFields(input, ['receiptId', 'publisherId', 'status', 'trigger', 'jobId', 'workflowId', 'draftId', 'draftVersion', 'artifactSha256', 'publicationAttemptId', 'limit', 'offset'])
  const status = text(input.status, 'status', 16)
  if (status !== undefined && !['created', 'updated', 'unchanged', 'skipped'].includes(status)) {
    throw new HttpError(400, 'status is invalid')
  }
  const trigger = text(input.trigger, 'trigger', 16)
  if (trigger !== undefined && !['manual', 'scheduler', 'workflow', 'host'].includes(trigger)) {
    throw new HttpError(400, 'trigger is invalid')
  }
  const artifactSha256 = text(input.artifactSha256, 'artifactSha256', 64)
  if (artifactSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(artifactSha256)) throw new HttpError(400, 'artifactSha256 is invalid')
  return {
    receiptId: text(input.receiptId, 'receiptId', 128),
    publisherId: text(input.publisherId, 'publisherId'),
    status,
    trigger,
    jobId: text(input.jobId, 'jobId', 128),
    workflowId: text(input.workflowId, 'workflowId', 128),
    draftId: text(input.draftId, 'draftId', 128),
    draftVersion: integer(input.draftVersion, 'draftVersion', 1, 1_000_000_000),
    artifactSha256,
    publicationAttemptId: text(input.publicationAttemptId, 'publicationAttemptId', 128),
    limit: integer(input.limit, 'limit', 1, 100, 20),
    offset: integer(input.offset, 'offset', 0, 1_000_000, 0),
  }
}

function safeWebUrl(value) {
  if (typeof value !== 'string' || value.length > 2_048) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function mediaReference(searchParams) {
  allowQuery(searchParams, ['draftId', 'assetId', 'kind', 'url'])
  const draftId = text(searchParams.get('draftId'), 'draftId', 128, true)
  const assetId = text(searchParams.get('assetId'), 'assetId', 64)
  if (assetId !== undefined) {
    if (!/^[a-f0-9]{64}$/u.test(assetId) || searchParams.has('kind') || searchParams.has('url')) throw new HttpError(400, 'assetId lookup is invalid')
    return { draftId, assetId }
  }
  const kind = text(searchParams.get('kind'), 'kind', 8, true)
  const url = text(searchParams.get('url'), 'url', 2_048, true)
  if (!['image', 'video'].includes(kind)) throw new HttpError(400, 'kind is invalid')
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('not allowed')
  } catch {
    throw new HttpError(400, 'url is invalid')
  }
  return { draftId, kind, url }
}

async function mediaResponse(ctx, req, res, searchParams) {
  const reference = mediaReference(searchParams)
  let admitted
  try {
    admitted = reference.assetId
      ? await requireService(ctx, 'prismProduction', 'Production Store').resolveDraftAsset(reference.draftId, reference.assetId)
      : requireService(ctx, 'prismProduction', 'Production Store').resolveDraftMedia(reference.draftId, reference.kind, reference.url)
  } catch (error) {
    if (error?.name === 'DraftMediaAdmissionError') throw new HttpError(404, 'Draft media is not available')
    throw error
  }
  try {
    const fetchMedia = ctx.get('prismMediaFetch') ?? managedMediaFetch
    const upstream = reference.assetId ? undefined : await fetchMedia(admitted.url, { kind: admitted.kind, signal: operationSignal(req, res) })
    const contentType = reference.assetId ? admitted.mime : upstream.headers.get('content-type')
    const body = reference.assetId ? admitted.bytes : Buffer.from(await upstream.arrayBuffer())
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': body.length,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    })
    res.end(body)
  } catch {
    throw new HttpError(502, 'Draft media could not be loaded')
  }
}

function boundedString(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function projectRegistryEntry(record) {
  return {
    id: boundedString(record?.id, 256),
    name: boundedString(record?.name, 512),
    description: boundedString(record?.description, 2_000),
    ...(['local-markdown', 'github-markdown', 'r2-markdown', 'wechat-draft'].includes(record?.kind) ? { kind: record.kind } : {}),
    ...(['news', 'newspic'].includes(record?.articleType) ? { articleType: record.articleType } : {}),
    ...(record?.kind === 'wechat-draft' ? { hasDeploymentDefaultCover: record.hasDeploymentDefaultCover === true } : {}),
  }
}

function projectPublisherChannel(record) {
  return {
    kind: ['local-markdown', 'github-markdown', 'r2-markdown', 'wechat-draft'].includes(record?.kind) ? record.kind : '',
    name: boundedString(record?.name, 128), active: record?.active === true, disabled: record?.active !== true,
    configured: record?.configured === true,
    destinations: Array.isArray(record?.destinations) ? record.destinations.slice(0, 100).map(destination => ({
      id: boundedString(destination?.id, 256), name: boundedString(destination?.name, 512),
    })) : [],
    configRevision: /^[a-f0-9]{64}$/u.test(record?.configRevision ?? '') ? record.configRevision : '',
  }
}

const MANAGED_SOURCE_FIELDS = {
  'github-trending': ['type', 'id', 'name', 'category', 'enabled', 'limit', 'since', 'spokenLanguageCode'],
  rss: ['type', 'id', 'name', 'category', 'enabled', 'limit', 'url'],
  'ai-search': ['type', 'id', 'name', 'category', 'enabled', 'limit', 'keyword'],
  follow: ['type', 'id', 'name', 'category', 'enabled', 'limit', 'listId', 'feedId', 'fetchDays', 'fetchPages', 'view', 'pageDelayMs', 'detailDelayMs', 'credentialSlotId'],
}

function managedSourceInput(value) {
  plainObject(value, 'source')
  const type = text(value.type, 'type', 32, true).trim()
  const fields = MANAGED_SOURCE_FIELDS[type]
  if (!fields) throw new HttpError(400, 'type is invalid')
  allowFields(value, fields)
  const common = {
    type,
    id: text(value.id, 'id', 64, true).trim(),
    name: text(value.name, 'name', 128, true).trim(),
    category: text(value.category, 'category', 64)?.trim(),
    enabled: boolean(value.enabled, 'enabled', true),
    limit: integer(value.limit, 'limit', 1, type === 'follow' ? 2000 : type === 'rss' ? 1000 : type === 'ai-search' ? 50 : 100, type === 'github-trending' ? 25 : type === 'ai-search' ? 10 : type === 'follow' ? 50 : 20),
  }
  if (type === 'github-trending') {
    const since = text(value.since, 'since', 16) ?? 'daily'
    if (!['daily', 'weekly', 'monthly'].includes(since)) throw new HttpError(400, 'since is invalid')
    return { ...common, since, spokenLanguageCode: text(value.spokenLanguageCode, 'spokenLanguageCode', 16) ?? '' }
  }
  if (type === 'rss') return { ...common, url: text(value.url, 'url', 2_048, true) }
  if (type === 'ai-search') return { ...common, keyword: text(value.keyword, 'keyword', 500, true) }
  return {
    ...common,
    listId: text(value.listId, 'listId', 128), feedId: text(value.feedId, 'feedId', 128),
    fetchDays: integer(value.fetchDays, 'fetchDays', 1, 365, 3), fetchPages: integer(value.fetchPages, 'fetchPages', 1, 20, 1),
    view: integer(value.view, 'view', 0, 100, 0), pageDelayMs: integer(value.pageDelayMs, 'pageDelayMs', 0, 60_000, 1_500),
    detailDelayMs: integer(value.detailDelayMs, 'detailDelayMs', 0, 60_000, 400), credentialSlotId: text(value.credentialSlotId, 'credentialSlotId', 128),
  }
}

function projectManagedSource(record) {
  const fields = MANAGED_SOURCE_FIELDS[record?.type] ?? []
  const projected = {
    settingsId: boundedString(record?.settingsId, 96),
    updatedAt: boundedString(record?.updatedAt, 64),
  }
  for (const field of fields) {
    const value = record?.[field]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') projected[field] = value
  }
  return projected
}

function projectReceipt(record) {
  const fields = [
    'receiptId', 'publisherId', 'status', 'itemCount', 'truncated', 'omittedMedia', 'bytes', 'sha256',
    'publishedAt', 'recordedAt', 'trigger', 'fileName', 'path', 'key', 'repository',
    'branch', 'bucket', 'operation', 'commitSha', 'contentSha', 'etag', 'versionId',
    'verification', 'jobId', 'workflowId', 'receiptPersistence', 'publicationCommitted',
    'draftId', 'draftVersion', 'artifactSha256', 'artifactBindingSha256', 'articleType', 'wechatDraftMediaId',
    'publicationAttemptId', 'publicationAttemptNumber', 'publicationIntent',
  ]
  const projected = {}
  for (const field of fields) {
    const value = record?.[field]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') projected[field] = value
  }
  const publicUrl = safeWebUrl(record?.publicUrl)
  if (publicUrl !== undefined) projected.publicUrl = publicUrl
  return projected
}

function generatorId(value) {
  const result = text(value, 'generatorId', 128, true)
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(result)) throw new HttpError(400, 'generatorId is invalid')
  return result
}

function workflowText(value, field, max, multiline = false) {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || controls.test(value)) throw new HttpError(400, `${field} is invalid`)
  return value
}
function optionalWorkflowText(value, field, max) {
  if (value === '') return value
  if (typeof value !== 'string' || value.trim() === '' || value.length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new HttpError(400, `${field} is invalid`)
  return value
}
function workflowSteps(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new HttpError(400, 'steps must contain from 1 to 8 ordered steps')
  const ids = new Set()
  const steps = value.map((step, index) => {
    plainObject(step, `steps[${index}]`); allowFields(step, ['id', 'name', 'persona', 'processPrompt'])
    const id = generatorId(step.id)
    if (ids.has(id)) throw new HttpError(400, 'Workflow step ids must be unique')
    ids.add(id)
    return { id, name: workflowText(step.name, `steps[${index}].name`, 256),
      persona: workflowText(step.persona, `steps[${index}].persona`, 10_000, true),
      processPrompt: optionalWorkflowText(step.processPrompt, `steps[${index}].processPrompt`, 10_000) }
  })
  if (JSON.stringify(steps).length > 31_000) throw new HttpError(400, 'Workflow prompt aggregate is too large')
  return steps
}
function workflowExpected(value) {
  plainObject(value, 'expected'); allowFields(value, ['kind', 'version', 'sha256'])
  if (!['legacy-v1', 'workflow-v1'].includes(value.kind)) throw new HttpError(400, 'expected.kind is invalid')
  const version = integer(value.version, 'expected.version', value.kind === 'legacy-v1' ? 0 : 1, 1_000_000_000)
  if (version === undefined || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) throw new HttpError(400, 'expected reference is invalid')
  return { kind: value.kind, version, sha256: value.sha256 }
}
function workflowDefinition(body, includeExpected) {
  plainObject(body, 'workflow')
  allowFields(body, ['generatorId', 'generatorName', 'description', 'steps', ...(includeExpected ? ['expected'] : [])])
  if (typeof body.description !== 'string' || body.description.length > 2_000 || /[\u0000-\u001f\u007f]/u.test(body.description)) throw new HttpError(400, 'description is invalid')
  return { generatorId: generatorId(body.generatorId), generatorName: workflowText(body.generatorName, 'generatorName', 256),
    description: body.description, steps: workflowSteps(body.steps), ...(includeExpected ? { expected: workflowExpected(body.expected) } : {}) }
}
function projectWorkflow(record) {
  const isLegacy = record?.kind === 'legacy-v1'
  const lifecycle = record?.action === 'delete' ? 'deleted' : record?.enabled === true ? 'active' : 'archived'
  return {
    kind: isLegacy ? 'legacy-v1' : 'workflow-v1', generatorId: boundedString(record?.generatorId, 128), generatorName: boundedString(record?.generatorName, 256),
    description: boundedString(record?.description, 2_000), enabled: record?.enabled === true, lifecycle: isLegacy ? (record?.enabled === true ? 'active' : 'archived') : lifecycle,
    steps: lifecycle !== 'deleted' && Array.isArray(record?.steps) ? record.steps.slice(0, 8).map(step => ({ id: boundedString(step?.id, 128), name: boundedString(step?.name, 256), persona: boundedString(step?.persona, 10_000), processPrompt: boundedString(step?.processPrompt, 10_000) })) : [],
    ...(isLegacy ? { expected: { kind: 'legacy-v1', version: record.legacyVersion, sha256: record.legacySha256 } } : {
      version: record.version, sha256: boundedString(record?.sha256, 64), updatedAt: boundedString(record?.updatedAt, 64), actor: boundedString(record?.actor, 32),
      action: boundedString(record?.action, 32), sourceVersion: record.sourceVersion,
      expected: { kind: 'workflow-v1', version: record.version, sha256: boundedString(record?.sha256, 64) },
      ...(lifecycle === 'deleted' ? { deletion: { deletedAt: boundedString(record?.updatedAt, 64), deletedFrom: {
        version: record?.sourceVersion, sha256: boundedString(record?.sha256, 64),
      } } } : {}),
    }),
    deploymentPolicy: { id: boundedString(record?.executionProfile?.id, 128), version: record?.executionProfile?.version,
      sha256: boundedString(record?.executionProfile?.sha256, 64), runnerPolicyVersion: boundedString(record?.executionProfile?.runnerPolicyVersion, 64),
      toolsAllowed: Array.isArray(record?.executionProfile?.toolPolicy?.allow) ? record.executionProfile.toolPolicy.allow.length : 0,
      ceilings: record?.executionProfile?.ceilings ? structuredClone(record.executionProfile.ceilings) : {} },
  }
}
function projectWorkflowDeletion(record) {
  const workflow = projectWorkflow(record)
  return {
    kind: workflow.kind, generatorId: workflow.generatorId, generatorName: workflow.generatorName,
    enabled: workflow.enabled, lifecycle: workflow.lifecycle, version: workflow.version, sha256: workflow.sha256,
    updatedAt: workflow.updatedAt, action: workflow.action, sourceVersion: workflow.sourceVersion,
    expected: workflow.expected, ...(workflow.deletion ? { deletion: workflow.deletion } : {}),
  }
}
function workflowError(error) {
  if (error?.name === 'GeneratorWorkflowValidationError') return new HttpError(400, error.message, { code: error.code ?? 'workflow_validation' })
  if (error?.name === 'GeneratorWorkflowConflictError') return new HttpError(409, error.message, { code: error.code ?? 'workflow_version_conflict', ...(error.details ?? {}) })
  if (error?.name === 'GeneratorWorkflowDeletedError') return new HttpError(410, error.message, { code: 'workflow_deleted' })
  if (error?.name === 'ProductionWorkflowDeletionError') return new HttpError(error.status ?? 409, error.message, { code: error.code, ...(error.details ?? {}) })
  return error
}
function imageSettingsError(error) {
  if (error?.name !== 'ImageGenerationSettingsError') return error
  return new HttpError(error.code === 'conflict' ? 409 : error.code === 'unavailable' ? 503 : 400, error.message, { code: `image_settings_${error.code ?? 'validation'}` })
}
function toolsetError(error) {
  if (error?.name === 'PrismToolsetValidationError') return new HttpError(400, error.message, { code: 'toolset_validation' })
  if (error?.name === 'PrismToolsetConflictError') return new HttpError(409, error.message, { code: 'toolset_conflict' })
  if (error?.name === 'PrismToolsetDeletedError') return new HttpError(410, error.message, { code: 'skill_deleted' })
  return error
}
function projectPrismSkill(record, includeContent = false) {
  return { skillId: boundedString(record?.skillId, 96), name: boundedString(record?.name, 128), description: boundedString(record?.description, 500),
    whenToUse: boundedString(record?.whenToUse, 1000), enabled: record?.enabled === true, lifecycle: boundedString(record?.lifecycle, 16),
    origin: record?.origin === 'system-default' ? 'system-default' : 'personal-custom', version: record?.version, sha256: boundedString(record?.sha256, 64), updatedAt: boundedString(record?.updatedAt, 64),
    action: boundedString(record?.action, 16), sourceVersion: record?.sourceVersion, ...(includeContent ? { content: boundedString(record?.content, 32000) } : {}) }
}
function projectPrismToolset(record) {
  return { mode: record?.mode, enabledTools: Array.isArray(record?.enabledTools) ? record.enabledTools.slice(0, 64) : [],
    enabledSkills: Array.isArray(record?.enabledSkills) ? record.enabledSkills.slice(0, 256) : [], version: record?.version,
    sha256: boundedString(record?.sha256, 64), updatedAt: boundedString(record?.updatedAt, 64) }
}
function projectRequest(record) {
  return { requestId: boundedString(record?.requestId, 128), generatorId: boundedString(record?.generatorId, 128), status: boundedString(record?.status, 16),
    itemCount: Array.isArray(record?.contentStoreIds) ? record.contentStoreIds.length : 0, attempt: Number.isInteger(record?.attempt) ? record.attempt : 0,
    createdAt: boundedString(record?.createdAt, 64), updatedAt: boundedString(record?.updatedAt, 64),
    ...(record?.draftId ? { draftId: boundedString(record.draftId, 128) } : {}), ...(record?.errorCode ? { errorCode: boundedString(record.errorCode, 64) } : {}),
    ...(record?.executionKind === 'workflow-v1' ? { executionKind: 'workflow-v1', generatorWorkflowVersion: record.generatorWorkflowVersion, generatorWorkflowSha256: boundedString(record.generatorWorkflowSha256, 64) }
      : Number.isInteger(record?.generatorPromptVersion) ? { generatorPromptVersion: record.generatorPromptVersion, generatorPromptSha256: boundedString(record.generatorPromptSha256, 64) } : {}) }
}

function draftRevisionInput(body) {
  plainObject(body, 'draft revision')
  allowFields(body, ['draftId', 'expectedVersion', 'expectedSha256', 'title', 'markdown'])
  if (typeof body.draftId !== 'string' || body.draftId.length < 1 || body.draftId.length > 128 || /[\u0000-\u001f\u007f]/u.test(body.draftId)) {
    throw new HttpError(400, 'draftId is invalid')
  }
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || body.expectedVersion > 1_000_000_000) {
    throw new HttpError(400, 'expectedVersion is invalid')
  }
  if (typeof body.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(body.expectedSha256)) {
    throw new HttpError(400, 'expectedSha256 is invalid')
  }
  if (typeof body.title !== 'string' || body.title.trim() === '' || body.title.length > 300 || /[\u0000-\u001f\u007f]/u.test(body.title)) {
    throw new HttpError(400, 'title must be non-empty, control-free, and at most 300 characters')
  }
  if (typeof body.markdown !== 'string' || body.markdown.trim() === '' || body.markdown.length > 100_000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body.markdown)) {
    throw new HttpError(400, 'markdown must be non-empty, control-free, and at most 100000 characters')
  }
  return body
}

function draftRevisionError(error) {
  if (error?.name === 'DraftRevisionValidationError') return new HttpError(400, error.message)
  if (error?.name === 'DraftRevisionConflictError') return new HttpError(409, error.message)
  return error
}

function projectDraft(record) {
  if (typeof record?.markdown !== 'string' || record.markdown.length > 500_001) {
    throw new Error('Stored production draft cannot be represented exactly for review')
  }
  return {
    draftId: boundedString(record?.draftId, 128), requestId: boundedString(record?.requestId, 128), generatorId: boundedString(record?.generatorId, 128),
    generatorPromptVersion: Number.isInteger(record?.generatorPromptVersion) && record.generatorPromptVersion >= 0 ? record.generatorPromptVersion : undefined,
    generatorPromptSha256: /^[a-f0-9]{64}$/u.test(record?.generatorPromptSha256 ?? '') ? record.generatorPromptSha256 : undefined,
    ...(record?.executionKind === 'workflow-v1' ? { executionKind: 'workflow-v1', generatorWorkflowVersion: record.generatorWorkflowVersion, generatorWorkflowSha256: boundedString(record.generatorWorkflowSha256, 64) } : {}),
    title: boundedString(record?.title, 300), markdown: record.markdown, sha256: boundedString(record?.sha256, 64),
    version: Number.isInteger(record?.version) ? record.version : 0,
    status: ['draft', 'approved', 'rejected', 'publishing', 'published'].includes(record?.status) ? record.status : 'draft',
    sourceContentStoreIds: Array.isArray(record?.sourceContentStoreIds) ? record.sourceContentStoreIds.slice(0, 100).map(value => boundedString(value, 128)) : [],
    publishedPublisherIds: Array.isArray(record?.publishedPublisherIds) ? record.publishedPublisherIds.slice(0, 50).map(value => boundedString(value, 256)) : [],
    createdAt: boundedString(record?.createdAt, 64), updatedAt: boundedString(record?.updatedAt, 64),
    approvedAt: boundedString(record?.approvedAt, 64) || undefined, publishedAt: boundedString(record?.publishedAt, 64) || undefined,
    artifactBindingSha256: /^[a-f0-9]{64}$/u.test(record?.artifactBindingSha256 ?? '') ? record.artifactBindingSha256 : undefined,
    mediaAssets: Array.isArray(record?.mediaAssets) ? record.mediaAssets.slice(0, 100).map(asset => ({
      assetId: boundedString(asset?.assetId, 64), sha256: boundedString(asset?.sha256, 64), bytes: Number.isSafeInteger(asset?.bytes) ? asset.bytes : 0,
      mime: ['image/jpeg', 'image/png', 'image/gif'].includes(asset?.mime) ? asset.mime : '', width: Number.isInteger(asset?.width) ? asset.width : 0, height: Number.isInteger(asset?.height) ? asset.height : 0,
    })) : [],
    destinationPresentations: Array.isArray(record?.destinationPresentations) ? record.destinationPresentations.slice(0, 50).map(item => ({
      publisherId: boundedString(item?.publisherId, 256), ...(typeof item?.author === 'string' ? { author: boundedString(item.author, 64) } : {}),
      ...(typeof item?.digest === 'string' ? { digest: boundedString(item.digest, 512) } : {}),
      ...(item?.cover ? { cover: { assetId: boundedString(item.cover.assetId, 64), crops: Array.isArray(item.cover.crops) ? item.cover.crops.slice(0, 3) : [] } } : {}),
      imageOrder: Array.isArray(item?.imageOrder) ? item.imageOrder.slice(0, 20).map(value => boundedString(value, 64)) : [],
    })) : [],
    reconciliationRequired: record?.status === 'publishing' && (record?.publishingOutcome === 'unknown' || record?.publishingPhase === 'reconciliation-required'),
    ...(record?.status === 'publishing' && (record?.publishingOutcome === 'unknown' || record?.publishingPhase === 'reconciliation-required')
      ? { externalOutcome: 'unknown' } : {}),
  }
}

function projectRssOutput(record, includeContent = false) {
  const base = {
    outputId: /^[a-f0-9]{64}$/u.test(record?.outputId ?? '') ? record.outputId : '',
    draftId: boundedString(record?.draftId, 128), draftVersion: Number.isInteger(record?.draftVersion) ? record.draftVersion : 0,
    artifactSha256: /^[a-f0-9]{64}$/u.test(record?.artifactSha256 ?? '') ? record.artifactSha256 : '',
    title: boundedString(record?.title, 300), xmlSha256: /^[a-f0-9]{64}$/u.test(record?.xmlSha256 ?? '') ? record.xmlSha256 : '',
    itemUrl: boundedString(record?.itemUrl, 2_048), generatedAt: boundedString(record?.generatedAt, 64),
  }
  if (!includeContent) return base
  if (typeof record?.markdown !== 'string' || typeof record?.htmlContent !== 'string' || typeof record?.xml !== 'string'
    || record.markdown.length > 1_000_000 || record.htmlContent.length > 4 * 1024 * 1024 || record.xml.length > 4 * 1024 * 1024) {
    throw new Error('Stored RSS output cannot be represented exactly')
  }
  return { ...base, markdown: record.markdown, htmlContent: record.htmlContent, xml: record.xml }
}

function listDraftAttempts(production, receipts, draftId) {
  const attempts = typeof production.listPublicationAttempts === 'function'
    ? production.listPublicationAttempts({ draftId, limit: 50 }).map(record => projectAttempt(record, receipts?.get?.(record.receiptId))) : []
  const legacy = typeof receipts?.list === 'function' ? receipts.list({ draftId, limit: 50 })
    .filter(receipt => !receipt.publicationAttemptId).map(receipt => ({
      attemptId: receipt.receiptId, receiptId: receipt.receiptId, draftId, publisherId: receipt.publisherId,
      state: receipt.status, intent: 'legacy', createdAt: receipt.recordedAt, completedAt: receipt.recordedAt,
      receiptStatus: receipt.status, targetIdentifier: boundedString(receipt.wechatDraftMediaId ?? receipt.publicUrl ?? receipt.repository
        ?? receipt.bucket ?? receipt.path ?? receipt.fileName, 2_048) || undefined, legacy: true,
    })) : []
  return [...attempts, ...legacy].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 50)
}

function projectAttempt(record, receipt) {
  const fields = ['attemptId', 'receiptId', 'attemptNumber', 'draftId', 'draftVersion', 'artifactSha256', 'artifactBindingSha256',
    'publisherId', 'intent', 'intentId', 'trigger', 'surface', 'state', 'reconciliationReason', 'reconciliationOperation', 'createdAt', 'updatedAt', 'destinationStartedAt', 'completedAt']
  const projected = Object.fromEntries(fields.flatMap(field => ['string', 'number'].includes(typeof record?.[field]) ? [[field, record[field]]] : []))
  if (record?.terminalFailure?.kind === 'publisher-not-committed' && ['token', 'body-upload', 'material-upload', 'draft-create'].includes(record.terminalFailure.operation)) {
    projected.failureOperation = record.terminalFailure.operation
    if (record.terminalFailure.externalOutcome === 'unknown') projected.externalOutcome = 'unknown'
    if (Number.isInteger(record.terminalFailure.code) && record.terminalFailure.code >= -1 && record.terminalFailure.code !== 0 && record.terminalFailure.code <= 1_000_000_000) projected.failureCode = record.terminalFailure.code
    if (typeof record.terminalFailure.requestId === 'string' && record.terminalFailure.requestId.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(record.terminalFailure.requestId)) projected.failureRequestId = record.terminalFailure.requestId
  }
  if (receipt) {
    projected.receiptStatus = boundedString(receipt.status, 32)
    projected.targetIdentifier = boundedString(receipt.wechatDraftMediaId ?? receipt.publicUrl ?? receipt.repository ?? receipt.bucket ?? receipt.path ?? receipt.fileName, 2_048) || undefined
  }
  if (record?.legacy === true) projected.legacy = true
  return projected
}

function operationSignal(req, res) {
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('Dashboard request disconnected'))
  req.once('aborted', abort)
  res.once('close', () => {
    if (!res.writableEnded) abort()
  })
  return controller.signal
}

function publisherProfileBinding(binding) {
  if (!binding) throw new HttpError(409, 'Direct Publisher Profile management is not enabled for this Dashboard deployment')
  return binding
}
function publisherCredentialRows(document) {
  const slots = []
  for (const row of document?.rows ?? []) {
    const fields = PUBLISHER_CREDENTIAL_FIELDS[row?.channelKind]
    if (!fields || !Array.isArray(row?.config?.destinations)) continue
    for (const destination of row.config.destinations) {
      for (const [field, label] of Object.entries(fields)) {
        const credentialRef = destination?.[field]
        if (typeof credentialRef !== 'string') continue
        slots.push({ rowId: row.rowId, channelKind: row.channelKind, destinationId: destination.id, destinationName: destination.name,
          field, label, credentialRef, configRevision: row.configRevision, migrationRequired: row.migrationRequired === true })
      }
    }
  }
  return slots
}
function credentialAuthority(document, body) {
  const rowId = text(body.rowId, 'rowId', 128, true)
  const destinationId = text(body.destinationId, 'destinationId', 128, true)
  const field = text(body.field, 'field', 64, true)
  const expectedConfigRevision = text(body.expectedConfigRevision, 'expectedConfigRevision', 64, true)
  if (!/^[a-f0-9]{64}$/u.test(expectedConfigRevision)) throw new HttpError(400, 'expectedConfigRevision must be a SHA-256 digest')
  const slot = publisherCredentialRows(document).find(item => item.rowId === rowId && item.destinationId === destinationId && item.field === field)
  if (!slot) throw new HttpError(404, 'Publisher credential slot was not found in the persisted Profile')
  if (slot.configRevision !== expectedConfigRevision) throw new HttpError(409, 'Publisher credential Profile binding changed; reload before writing')
  if (slot.migrationRequired || !CREDENTIAL_REF_PATTERN.test(slot.credentialRef) || SECRET_LIKE_CREDENTIAL_REF.test(slot.credentialRef)) {
    throw new HttpError(400, 'The configured Credential Ref is invalid or appears to contain a secret; replace it with a reference name first')
  }
  return slot
}
async function credentialProvider(ctx) {
  const provider = requireService(ctx, 'credentials', 'Credential provider')
  if (typeof provider.describe !== 'function' || typeof provider.set !== 'function' || typeof provider.unset !== 'function') {
    throw new HttpError(503, 'Credential provider does not support secure Dashboard writes')
  }
  return provider
}
async function describePublisherCredentials(ctx, document) {
  const provider = await credentialProvider(ctx)
  const statusByRef = new Map()
  const slots = []
  for (const slot of publisherCredentialRows(document)) {
    const validRef = !slot.migrationRequired && CREDENTIAL_REF_PATTERN.test(slot.credentialRef) && !SECRET_LIKE_CREDENTIAL_REF.test(slot.credentialRef)
    let info = { configured: false, writable: false }
    if (validRef) {
      if (!statusByRef.has(slot.credentialRef)) {
        try { statusByRef.set(slot.credentialRef, await provider.describe(slot.credentialRef)) }
        catch { throw new HttpError(503, 'Publisher credential status could not be read') }
      }
      info = statusByRef.get(slot.credentialRef) ?? info
    }
    slots.push({ rowId: slot.rowId, channelKind: slot.channelKind, destinationId: slot.destinationId,
      destinationName: boundedString(slot.destinationName, 512), field: slot.field, label: slot.label,
      configRevision: slot.configRevision, configured: info?.configured === true, writable: info?.writable === true,
      ...(typeof info?.source === 'string' ? { source: boundedString(info.source, 64) } : {}), ...(!validRef ? { invalidRef: true } : {}) })
  }
  return slots
}
function publisherProfileError(error, maintenanceEntered = false) {
  const detail = error instanceof Error ? error.message : ''
  const conflict = /stale|already used|previously used|cannot be reused|pending|locked|reservation|ambiguous|identity or hash|no longer renders|recover/u.test(detail)
  if (error instanceof PublisherProfileCliError || error?.name === 'PublisherProfileValidationError') {
    let message = 'Publisher Profile request failed validation or preflight'
    let conflictCode
    if (/previously used by a different immutable identity|cannot be reused with a different identity/u.test(detail)) {
      message = 'Publisher destination identity state is inconsistent; replace the conflicting destination id before saving'
      conflictCode = 'destination-identity-conflict'
    } else if (/already used/u.test(detail)) {
      message = 'operationId is already bound to a different request'; conflictCode = 'operation-id-conflict'
    } else if (/pending|recover|ambiguous/u.test(detail)) {
      message = 'A Publisher Profile operation is pending durable recovery'; conflictCode = 'operation-recovery-required'
    } else if (/locked/u.test(detail)) {
      message = 'Publisher Profile is busy; retry after the active writer releases its lock'; conflictCode = 'profile-busy'
    } else if (conflict) {
      message = 'Publisher Profile baseline changed; reload before saving'; conflictCode = 'profile-baseline-changed'
    }
    return new HttpError(conflict ? 409 : 400, message, {
      ...(conflictCode ? { conflictCode } : {}), ...(maintenanceEntered ? { maintenance: true, restartRequired: true } : {}),
    })
  }
  if (maintenanceEntered) return new HttpError(500, 'Publisher Profile commit failed after maintenance began', { maintenance: true, restartRequired: true })
  return error
}
async function drainForProfileApply(ctx, timeoutMs = 30_000) {
  const publishers = requireService(ctx, 'prismPublishers', 'Publisher registry')
  const production = ctx.get('prismProduction')
  const services = [publishers, ...(production ? [production] : [])]
  if (services.some(service => typeof service.beginMaintenanceDrain !== 'function' || typeof service.maintenanceStatus !== 'function')) {
    throw new HttpError(409, 'All production admission authorities must support maintenance drain before Profile apply')
  }
  const draining = Promise.allSettled(services.map(service => service.beginMaintenanceDrain()))
  let timer
  const settled = await Promise.race([
    draining.then(results => ({ completed: true, results })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ completed: false, results: [] }), timeoutMs); timer.unref?.() }),
  ])
  if (timer) clearTimeout(timer)
  const activeAttempts = services.reduce((sum, service) => sum + Math.max(0, Math.min(10_000, Number(service.maintenanceStatus().active) || 0)), 0)
  const restartAllowed = settled.completed && settled.results.every(result => result.status === 'fulfilled')
    && services.every(service => service.maintenanceStatus().restartAllowed === true)
  return { maintenance: true, drained: restartAllowed && activeAttempts === 0, timedOut: !settled.completed,
    activeAttempts: Math.min(activeAttempts, 20_000), restartAllowed }
}

async function routeRequest(ctx, req, res, requestUrl, profileBinding) {
  const pathname = requestUrl.pathname
  const method = req.method ?? 'GET'
  const mutating = method === 'POST' || method === 'PUT'
  const authority = validateLoopbackHost(req)
  validateSameOrigin(req, authority, mutating)
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    throw new HttpError(403, 'PrismFlow dashboard operations are restricted to the local machine')
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/status`) {
    const sources = ctx.get('prismSources')
    const contentStore = ctx.get('prismContentStore')
    const publishers = ctx.get('prismPublishers')
    const receipts = ctx.get('prismPublicationReceipts')
    const production = ctx.get('prismProduction')
    const sourceSettings = ctx.get('prismSourceSettings')
    const generatorWorkflows = ctx.get('prismGeneratorWorkflows')
    const rssOutputs = ctx.get('prismRssOutputs')
    const workflowRows = generatorWorkflows ? await generatorWorkflows.list() : []
    return jsonResponse(res, 200, {
      version: 1,
      pluginVersion: PLUGIN_VERSION,
      services: {
        sources: sources !== undefined,
        sourceSettings: sourceSettings !== undefined,
        contentStore: contentStore !== undefined,
        publishers: publishers !== undefined,
        receipts: receipts !== undefined,
        production: production !== undefined,
        generatorWorkflows: generatorWorkflows !== undefined,
        toolsets: ctx.get('prismToolsets') !== undefined,
        imageGenerationSettings: ctx.get('prismImageGenerationSettings') !== undefined,
        rssOutputs: rssOutputs !== undefined,
      },
      counts: {
        sources: sources?.list().length ?? 0,
        sourceSettings: sourceSettings?.list().length ?? 0,
        publishers: publishers?.list().length ?? 0,
        generators: production?.listGenerators().length ?? 0,
        generatorWorkflows: workflowRows.length,
        rssOutputs: rssOutputs?.list({ limit: 100 }).length ?? 0,
      },
    })
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/image-generation/settings`) {
    const settings = requireService(ctx, 'prismImageGenerationSettings', 'Image generation settings')
    try { return jsonResponse(res, 200, { settings: settings.get(), credential: await settings.describeCredential() }) }
    catch (error) { throw imageSettingsError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/image-generation/settings`) {
    const body = await readJson(req); allowFields(body, ['settings', 'expected'])
    const input = plainObject(body.settings, 'settings'); allowFields(input, ['imageApiUrl', 'imageApiProtocol', 'imageModel', 'imageSize', 'avifQuality', 'avifEffort'])
    const expected = plainObject(body.expected, 'expected'); allowFields(expected, ['version', 'sha256'])
    try {
      const service = requireService(ctx, 'prismImageGenerationSettings', 'Image generation settings')
      return jsonResponse(res, 200, { settings: await service.update(input, expected), credential: await service.describeCredential() })
    } catch (error) { throw imageSettingsError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/image-generation/credential/set`) {
    const body = await readJson(req); allowFields(body, ['value'])
    if (typeof body.value !== 'string' || !body.value.trim() || body.value.length > 16 * 1024 || /[\u0000-\u001f\u007f]/u.test(body.value)) throw new HttpError(400, 'Image API credential value is invalid')
    try { return jsonResponse(res, 200, { credential: await requireService(ctx, 'prismImageGenerationSettings', 'Image generation settings').setCredential(body.value) }) }
    catch (error) { throw imageSettingsError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/image-generation/credential/unset`) {
    const body = await readJson(req); allowFields(body, [])
    try { return jsonResponse(res, 200, { credential: await requireService(ctx, 'prismImageGenerationSettings', 'Image generation settings').unsetCredential() }) }
    catch (error) { throw imageSettingsError(error) }
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/source-settings`) {
    const settings = requireService(ctx, 'prismSourceSettings', 'Visual source settings')
    return jsonResponse(res, 200, {
      sources: settings.list().map(projectManagedSource),
      adapters: settings.adapterStates().map(state => ({ type: boundedString(state?.type, 32), enabled: state?.enabled === true })),
      credentialSlots: (await settings.describeCredentialSlots()).map(slot => ({
        id: boundedString(slot?.id, 128), name: boundedString(slot?.name, 128),
        usage: slot?.usage === 'follow-cookie' ? slot.usage : '', configured: slot?.configured === true,
        ...(typeof slot?.source === 'string' ? { source: boundedString(slot.source, 64) } : {}),
        writable: slot?.writable === true, allowDashboardWrite: slot?.allowDashboardWrite === true,
      })),
    })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/source-settings/credential/set`) {
    const body = await readJson(req)
    allowFields(body, ['slotId', 'value'])
    const slotId = text(body.slotId, 'slotId', 128, true)
    if (typeof body.value !== 'string' || body.value.length < 1 || body.value.length > 16 * 1024 || /[\u0000-\u001f\u007f]/.test(body.value)) {
      throw new HttpError(400, 'Credential value is invalid')
    }
    try { await requireService(ctx, 'prismSourceSettings', 'Visual source settings').setCredential(slotId, body.value) }
    catch (error) {
      if (error?.name === 'ManagedSourceValidationError') throw new HttpError(400, error.message)
      throw error
    }
    return jsonResponse(res, 200, { updated: true, slotId })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/source-settings/credential/unset`) {
    const body = await readJson(req)
    allowFields(body, ['slotId'])
    const slotId = text(body.slotId, 'slotId', 128, true)
    try { await requireService(ctx, 'prismSourceSettings', 'Visual source settings').unsetCredential(slotId) }
    catch (error) {
      if (error?.name === 'ManagedSourceValidationError') throw new HttpError(400, error.message)
      throw error
    }
    return jsonResponse(res, 200, { removed: true, slotId })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/source-settings/adapter`) {
    const body = await readJson(req)
    allowFields(body, ['type', 'enabled'])
    const type = text(body.type, 'type', 32, true)
    if (!Object.hasOwn(MANAGED_SOURCE_FIELDS, type)) throw new HttpError(400, 'type is invalid')
    const enabled = boolean(body.enabled, 'enabled')
    if (enabled === undefined) throw new HttpError(400, 'enabled is required')
    try {
      const adapter = await requireService(ctx, 'prismSourceSettings', 'Visual source settings').setAdapterEnabled(type, enabled)
      return jsonResponse(res, 200, { adapter: { type: adapter.type, enabled: adapter.enabled } })
    } catch (error) {
      if (error?.name === 'ManagedSourceValidationError') throw new HttpError(400, error.message)
      throw error
    }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/source-settings/save`) {
    const body = await readJson(req)
    allowFields(body, ['mode', 'source', 'expectedSettingsId', 'expectedUpdatedAt'])
    const mode = text(body.mode, 'mode', 16, true)
    if (!['create', 'update'].includes(mode)) throw new HttpError(400, 'mode is invalid')
    const expectedSettingsId = text(body.expectedSettingsId, 'expectedSettingsId', 96)
    const expectedUpdatedAt = text(body.expectedUpdatedAt, 'expectedUpdatedAt', 64)
    if (mode === 'update' && (!expectedSettingsId || !expectedUpdatedAt)) throw new HttpError(400, 'Update preconditions are required')
    if (mode === 'create' && (expectedSettingsId || expectedUpdatedAt)) throw new HttpError(400, 'Create must not include update preconditions')
    let source
    try {
      source = await requireService(ctx, 'prismSourceSettings', 'Visual source settings').save(managedSourceInput(body.source), { mode, expectedSettingsId, expectedUpdatedAt })
    } catch (error) {
      if (error?.name === 'ManagedSourceValidationError') throw new HttpError(400, error.message)
      throw error
    }
    return jsonResponse(res, 200, { source: projectManagedSource(source) })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/source-settings/delete`) {
    const body = await readJson(req)
    allowFields(body, ['settingsId'])
    try {
      await requireService(ctx, 'prismSourceSettings', 'Visual source settings').delete(text(body.settingsId, 'settingsId', 96, true))
    } catch (error) {
      if (error?.name === 'ManagedSourceValidationError') throw new HttpError(400, error.message)
      throw error
    }
    return jsonResponse(res, 200, { deleted: true })
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/toolsets`) {
    const store = requireService(ctx, 'prismToolsets', 'PrismFlow Toolset')
    return jsonResponse(res, 200, { toolset: projectPrismToolset(store.getToolset()), tools: PRISMFLOW_TOOL_NAMES,
      toolOrigins: Object.fromEntries(PRISMFLOW_TOOL_NAMES.map(tool => [tool, prismFlowToolOrigin(tool)])),
      toolPresets: { core: PRISMFLOW_CORE_TOOL_NAMES, complete: PRISMFLOW_TOOL_NAMES },
      skills: store.listSkills().map(skill => projectPrismSkill(skill)) })
  }
  if (method === 'GET' && pathname === `${API_PREFIX}/toolsets/skill`) {
    const id = text(requestUrl.searchParams.get('skillId'), 'skillId', 96, true)
    try { return jsonResponse(res, 200, { skill: projectPrismSkill(requireService(ctx, 'prismToolsets', 'PrismFlow Toolset').getSkill(id), true) }) }
    catch (error) { throw toolsetError(error) }
  }
  if (method === 'GET' && pathname === `${API_PREFIX}/toolsets/skill/history`) {
    const id = text(requestUrl.searchParams.get('skillId'), 'skillId', 96, true)
    try { return jsonResponse(res, 200, { records: requireService(ctx, 'prismToolsets', 'PrismFlow Toolset').history(id).map(skill => projectPrismSkill(skill)) }) }
    catch (error) { throw toolsetError(error) }
  }
  if (method === 'POST' && pathname === `${API_PREFIX}/toolsets`) {
    const body = await readJson(req); allowFields(body, ['mode', 'enabledTools', 'enabledSkills', 'expected'])
    try { return jsonResponse(res, 200, { toolset: projectPrismToolset(await requireService(ctx, 'prismToolsets', 'PrismFlow Toolset').saveToolset(body)), restartRequired: true }) }
    catch (error) { throw toolsetError(error) }
  }
  if (method === 'POST' && pathname === `${API_PREFIX}/toolsets/skill/import-zip`) {
    const bundle = parseSkillZip(await readBinary(req, 'application/zip'))
    try { return jsonResponse(res, 200, { skill: projectPrismSkill(await requireService(ctx, 'prismToolsets', 'PrismFlow Toolset').importSkillBundle(bundle.input, bundle.files), true) }) }
    catch (error) { throw toolsetError(error) }
  }
  if (method === 'POST' && pathname === `${API_PREFIX}/toolsets/skill`) {
    const body = await readJson(req); allowFields(body, ['skillId', 'name', 'description', 'whenToUse', 'content', 'enabled'])
    try { return jsonResponse(res, 200, { skill: projectPrismSkill(await requireService(ctx, 'prismToolsets', 'PrismFlow Toolset').createSkill(body), true) }) }
    catch (error) { throw toolsetError(error) }
  }
  if (method === 'PUT' && pathname === `${API_PREFIX}/toolsets/skill`) {
    const body = await readJson(req); allowFields(body, ['skillId', 'name', 'description', 'whenToUse', 'content', 'enabled', 'expected'])
    try { return jsonResponse(res, 200, { skill: projectPrismSkill(await requireService(ctx, 'prismToolsets', 'PrismFlow Toolset').updateSkill(body), true) }) }
    catch (error) { throw toolsetError(error) }
  }
  if (method === 'POST' && pathname === `${API_PREFIX}/toolsets/skill/rollback`) {
    const body = await readJson(req); allowFields(body, ['skillId', 'targetVersion', 'expected'])
    try { return jsonResponse(res, 200, { skill: projectPrismSkill(await requireService(ctx, 'prismToolsets', 'PrismFlow Toolset').rollbackSkill(body), true) }) }
    catch (error) { throw toolsetError(error) }
  }
  if (method === 'POST' && pathname === `${API_PREFIX}/toolsets/skill/delete`) {
    const body = await readJson(req); allowFields(body, ['skillId', 'expected'])
    try { return jsonResponse(res, 200, { skill: projectPrismSkill(await requireService(ctx, 'prismToolsets', 'PrismFlow Toolset').deleteSkill(body)) }) }
    catch (error) { throw toolsetError(error) }
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/generator-workflows`) {
    allowQuery(requestUrl.searchParams, ['includeDeleted'])
    const rawIncludeDeleted = requestUrl.searchParams.get('includeDeleted')
    if (rawIncludeDeleted !== null && rawIncludeDeleted !== 'true' && rawIncludeDeleted !== 'false') throw new HttpError(400, 'includeDeleted must be true or false')
    const includeDeleted = rawIncludeDeleted === 'true'
    try { return jsonResponse(res, 200, { records: (await requireService(ctx, 'prismGeneratorWorkflows', 'Generator Workflow Store').list({ includeDeleted })).map(projectWorkflow) }) }
    catch (error) { throw workflowError(error) }
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/generator-workflows/current`) {
    allowQuery(requestUrl.searchParams, ['generatorId'])
    try { return jsonResponse(res, 200, { record: projectWorkflow(await requireService(ctx, 'prismGeneratorWorkflows', 'Generator Workflow Store').snapshot(generatorId(requestUrl.searchParams.get('generatorId')))) }) }
    catch (error) { throw workflowError(error) }
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/generator-workflows/history`) {
    allowQuery(requestUrl.searchParams, ['generatorId', 'limit', 'beforeVersion'])
    const rawLimit = requestUrl.searchParams.get('limit'); const rawBefore = requestUrl.searchParams.get('beforeVersion')
    const limit = rawLimit === null ? 50 : integer(Number(rawLimit), 'limit', 1, 50)
    const beforeVersion = rawBefore === null ? undefined : integer(Number(rawBefore), 'beforeVersion', 2, 1_000_000_000)
    try {
      const rows = await requireService(ctx, 'prismGeneratorWorkflows', 'Generator Workflow Store').history(generatorId(requestUrl.searchParams.get('generatorId')), limit < 50 ? limit + 1 : 50, beforeVersion)
      const hasMore = rows.length > limit; const page = rows.slice(0, limit)
      return jsonResponse(res, 200, { records: page.map(projectWorkflow), ...(hasMore ? { nextBeforeVersion: page.at(-1)?.version } : {}) })
    } catch (error) { throw workflowError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/generator-workflows`) {
    try { return jsonResponse(res, 201, { record: projectWorkflow(await requireService(ctx, 'prismGeneratorWorkflows', 'Generator Workflow Store').create(workflowDefinition(await readJson(req), false))) }) }
    catch (error) { throw workflowError(error) }
  }

  if (method === 'PUT' && pathname === `${API_PREFIX}/generator-workflows`) {
    try { return jsonResponse(res, 200, { record: projectWorkflow(await requireService(ctx, 'prismGeneratorWorkflows', 'Generator Workflow Store').save(workflowDefinition(await readJson(req), true))) }) }
    catch (error) { throw workflowError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/generator-workflows/rollback`) {
    const body = await readJson(req); allowFields(body, ['generatorId', 'expected', 'targetVersion'])
    const input = { generatorId: generatorId(body.generatorId), expected: workflowExpected(body.expected), targetVersion: integer(body.targetVersion, 'targetVersion', 1, 1_000_000_000) }
    if (input.targetVersion === undefined) throw new HttpError(400, 'targetVersion is required')
    try { return jsonResponse(res, 200, { record: projectWorkflow(await requireService(ctx, 'prismGeneratorWorkflows', 'Generator Workflow Store').rollback(input)) }) }
    catch (error) { throw workflowError(error) }
  }

  if (method === 'POST' && (pathname === `${API_PREFIX}/generator-workflows/disable` || pathname === `${API_PREFIX}/generator-workflows/enable`)) {
    const body = await readJson(req); allowFields(body, ['generatorId', 'expected'])
    const input = { generatorId: generatorId(body.generatorId), expected: workflowExpected(body.expected) }
    const store = requireService(ctx, 'prismGeneratorWorkflows', 'Generator Workflow Store')
    try { return jsonResponse(res, 200, { record: projectWorkflow(await (pathname.endsWith('/enable') ? store.enable(input) : store.disable(input))) }) }
    catch (error) { throw workflowError(error) }
  }

  if (method === 'POST' && (pathname === `${API_PREFIX}/generator-workflows/delete/preview` || pathname === `${API_PREFIX}/generator-workflows/delete`)) {
    const body = await readJson(req); allowFields(body, ['generatorId', 'expected'])
    const input = { generatorId: generatorId(body.generatorId), expected: workflowExpected(body.expected) }
    const production = ctx.get('prismProduction')
    if (!production) throw new HttpError(503, 'Production Request reference checks are unavailable', { code: 'production_reference_check_unavailable' })
    try {
      const result = pathname.endsWith('/preview')
        ? await production.previewGeneratorWorkflowDeletion(input)
        : await production.deleteGeneratorWorkflow(input)
      return jsonResponse(res, 200, { ...result, record: projectWorkflowDeletion(result.record) })
    } catch (error) { throw workflowError(error) }
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/publisher-profile/pending-operation`) {
    allowQuery(requestUrl.searchParams, [])
    const binding = publisherProfileBinding(profileBinding)
    try { return jsonResponse(res, 200, { operation: getPendingPublisherProfileOperation(binding.profileName, { home: binding.dshHome }) ?? null }) }
    catch (error) { throw publisherProfileError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/publisher-profile/pending-operation`) {
    allowQuery(requestUrl.searchParams, [])
    const body = await readJson(req)
    allowFields(body, ['action', 'operationId'])
    const action = text(body.action, 'action', 16, true)
    const operationId = text(body.operationId, 'operationId', 36, true)
    if (!['resume', 'cancel'].includes(action)) throw new HttpError(400, 'action must be resume or cancel')
    if (!PUBLISHER_OPERATION_ID.test(operationId)) throw new HttpError(400, 'operationId must be a canonical lowercase UUID')
    const binding = publisherProfileBinding(profileBinding)
    if (action === 'cancel') {
      try {
        const operation = cancelPendingPublisherProfileOperation(binding.profileName, operationId, { home: binding.dshHome })
        if (!operation) throw new HttpError(409, 'Pending Publisher Profile operation changed; reload before reconciling')
        return jsonResponse(res, 200, { operation })
      } catch (error) { if (error instanceof HttpError) throw error; throw publisherProfileError(error) }
    }
    let started
    try {
      started = beginPublisherProfileOperationDrain(binding.profileName, operationId, { home: binding.dshHome })
    } catch (error) { if (error instanceof HttpError) throw error; throw publisherProfileError(error) }
    if (!started.request) return jsonResponse(res, 200, { operation: started.operation })
    let maintenance
    try { maintenance = await drainForProfileApply(ctx) }
    catch (error) { throw publisherProfileError(error, true) }
    if (!maintenance.drained || !maintenance.restartAllowed) return jsonResponse(res, 202, { operation: started.operation, ...maintenance })
    try {
      const operation = commitPublisherProfileOperation(binding.profileName, operationId, started.request.plan, { home: binding.dshHome })
      return jsonResponse(res, 200, { operation, ...maintenance })
    } catch (error) { throw publisherProfileError(error, true) }
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/publisher-profile/credentials`) {
    allowQuery(requestUrl.searchParams, [])
    const binding = publisherProfileBinding(profileBinding)
    let document
    try { document = exportPublisherProfile(binding.profileName, { home: binding.dshHome }) }
    catch (error) { throw publisherProfileError(error) }
    return jsonResponse(res, 200, { slots: await describePublisherCredentials(ctx, document) })
  }

  if (method === 'POST' && (pathname === `${API_PREFIX}/publisher-profile/credential/set` || pathname === `${API_PREFIX}/publisher-profile/credential/unset`)) {
    const body = await readJson(req)
    const setting = pathname.endsWith('/set')
    allowFields(body, setting ? ['rowId', 'destinationId', 'field', 'expectedConfigRevision', 'value'] : ['rowId', 'destinationId', 'field', 'expectedConfigRevision'])
    if (setting && (typeof body.value !== 'string' || body.value.length < 1 || body.value.length > 16 * 1024 || /[\u0000-\u001f\u007f]/u.test(body.value))) {
      throw new HttpError(400, 'Credential value is invalid')
    }
    const binding = publisherProfileBinding(profileBinding)
    let document
    try { document = exportPublisherProfile(binding.profileName, { home: binding.dshHome }) }
    catch (error) { throw publisherProfileError(error) }
    const slot = credentialAuthority(document, body)
    const provider = await credentialProvider(ctx)
    let info
    try { info = await provider.describe(slot.credentialRef) }
    catch { throw new HttpError(503, 'Publisher credential status could not be read') }
    if (info?.writable !== true) throw new HttpError(409, 'Publisher credential is read-only because a higher-priority source owns it')
    try {
      if (setting) await provider.set(slot.credentialRef, body.value)
      else await provider.unset(slot.credentialRef)
    } catch { throw new HttpError(500, setting ? 'Publisher credential could not be stored' : 'Publisher credential could not be removed') }
    return jsonResponse(res, 200, setting ? { updated: true } : { removed: true })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/publisher-profile/read`) {
    allowQuery(requestUrl.searchParams, [])
    const body = await readJson(req)
    allowFields(body, [])
    const binding = publisherProfileBinding(profileBinding)
    try {
      const document = exportPublisherProfile(binding.profileName, { home: binding.dshHome })
      return jsonResponse(res, 200, { document, credentialSlots: await describePublisherCredentials(ctx, document) })
    } catch (error) { if (error instanceof HttpError) throw error; throw publisherProfileError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/publisher-profile/operation`) {
    allowQuery(requestUrl.searchParams, [])
    const body = await readJson(req)
    allowFields(body, ['operationId'])
    const operationId = text(body.operationId, 'operationId', 36, true)
    const binding = publisherProfileBinding(profileBinding)
    try {
      const operation = getPublisherProfileOperation(binding.profileName, operationId, { home: binding.dshHome })
      if (!operation) throw new HttpError(404, 'Publisher Profile operation was not found')
      return jsonResponse(res, 200, { operation })
    } catch (error) { if (error instanceof HttpError) throw error; throw publisherProfileError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/publisher-profile/apply`) {
    allowQuery(requestUrl.searchParams, [])
    const body = await readJson(req)
    allowFields(body, ['operationId', 'confirmPauseUntilRestart', 'plan'])
    const operationId = text(body.operationId, 'operationId', 36, true)
    if (body.confirmPauseUntilRestart !== true) throw new HttpError(400, 'Explicit confirmation of the pause until process restart is required')
    const plan = plainObject(body.plan, 'plan')
    const binding = publisherProfileBinding(profileBinding)
    let prepared
    try { prepared = preparePublisherProfileOperation(binding.profileName, operationId, plan, { home: binding.dshHome }) }
    catch (error) { throw publisherProfileError(error) }
    if (prepared.replayed) return jsonResponse(res, 200, { operation: prepared.result })
    let started
    try { started = beginPublisherProfileOperationDrain(binding.profileName, operationId, { home: binding.dshHome }) }
    catch (error) { throw publisherProfileError(error) }
    if (!started.request) return jsonResponse(res, 200, { operation: started.operation })
    let maintenance
    try { maintenance = await drainForProfileApply(ctx) }
    catch (error) { throw publisherProfileError(error, true) }
    if (!maintenance.drained || !maintenance.restartAllowed) {
      return jsonResponse(res, 202, { operation: started.operation, ...maintenance })
    }
    try {
      const operation = commitPublisherProfileOperation(binding.profileName, operationId, started.request.plan, { home: binding.dshHome })
      return jsonResponse(res, 200, { operation, ...maintenance })
    } catch (error) { throw publisherProfileError(error, true) }
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/publishers`) {
    return jsonResponse(res, 200, requireService(ctx, 'prismPublishers', 'Publisher registry').list().map(item => projectRegistryEntry(item)))
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/publisher-channels`) {
    allowQuery(requestUrl.searchParams, [])
    const registry = requireService(ctx, 'prismPublishers', 'Publisher registry')
    return jsonResponse(res, 200, { channels: registry.inventory().map(projectPublisherChannel) })
  }

  // Kept as a deployment/operator maintenance primitive. Direct Profile save never
  // trusts this endpoint and always performs its own validation → preflight → drain.
  if (method === 'POST' && pathname === `${API_PREFIX}/maintenance/drain`) {
    const body = await readJson(req)
    allowFields(body, ['timeoutMs', 'confirmPauseUntilRestart'])
    if (body.confirmPauseUntilRestart !== true) throw new HttpError(400, 'Explicit confirmation of the pause until process restart is required')
    if (Object.hasOwn(body, 'timeoutMs') && !Number.isInteger(body.timeoutMs)) throw new HttpError(400, 'timeoutMs must be an integer from 100 to 120000')
    const timeoutMs = integer(body.timeoutMs, 'timeoutMs', 100, 120_000, 30_000)
    const maintenance = await drainForProfileApply(ctx, timeoutMs)
    return jsonResponse(res, maintenance.timedOut ? 202 : 200, maintenance)
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/receipts/query`) {
    const body = await readJson(req)
    const records = requireService(ctx, 'prismPublicationReceipts', 'Publication Receipt Store').list(receiptQuery(body))
    return jsonResponse(res, 200, { count: records.length, records: records.map(projectReceipt) })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/requests`) {
    const body = await readJson(req); allowFields(body, ['status', 'limit'])
    const status = text(body.status, 'status', 16)
    if (status && !['pending', 'running', 'completed', 'failed', 'cancelled'].includes(status)) throw new HttpError(400, 'status is invalid')
    const records = requireService(ctx, 'prismProduction', 'Production Store').listRequests({ status, limit: integer(body.limit, 'limit', 1, 100, 50) })
    return jsonResponse(res, 200, { records: records.map(projectRequest) })
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/production/request`) {
    allowQuery(requestUrl.searchParams, ['requestId'])
    const record = requireService(ctx, 'prismProduction', 'Production Store').getRequest(text(requestUrl.searchParams.get('requestId'), 'requestId', 128, true))
    if (!record) throw new HttpError(404, 'Generation request was not found')
    return jsonResponse(res, 200, { request: projectRequest(record) })
  }

  if (method === 'POST' && (pathname === `${API_PREFIX}/production/request/cancel` || pathname === `${API_PREFIX}/production/request/retry`)) {
    const body = await readJson(req); allowFields(body, ['requestId'])
    const production = requireService(ctx, 'prismProduction', 'Production Store')
    const requestId = text(body.requestId, 'requestId', 128, true)
    try { return jsonResponse(res, 200, { request: projectRequest(await (pathname.endsWith('/retry') ? production.retry(requestId) : production.cancel(requestId))) }) }
    catch (error) { throw new HttpError(/not (?:cancellable|retryable)/u.test(error?.message ?? '') ? 409 : 400, error instanceof Error ? error.message : 'Request operation failed') }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/drafts`) {
    const body = await readJson(req)
    allowFields(body, ['status', 'limit'])
    const status = text(body.status, 'status', 16)
    if (status && !['draft', 'approved', 'rejected', 'publishing', 'published'].includes(status)) throw new HttpError(400, 'status is invalid')
    const production = requireService(ctx, 'prismProduction', 'Production Store')
    const records = production.listDrafts({ status, limit: integer(body.limit, 'limit', 1, 100, 50) })
    const receipts = ctx.get('prismPublicationReceipts')
    return jsonResponse(res, 200, { records: records.map(record => ({ ...projectDraft(record),
      publicationAttempts: listDraftAttempts(production, receipts, record.draftId) })) })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/rss-outputs`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'limit'])
    const draftId = text(body.draftId, 'draftId', 128)
    const limit = integer(body.limit, 'limit', 1, 100, 50)
    const records = requireService(ctx, 'prismRssOutputs', 'RSS Output Store').list({ draftId, limit })
    return jsonResponse(res, 200, { records: records.map(record => projectRssOutput(record)) })
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/production/rss-output`) {
    allowQuery(requestUrl.searchParams, ['outputId'])
    const outputId = text(requestUrl.searchParams.get('outputId'), 'outputId', 64, true)
    if (!/^[a-f0-9]{64}$/u.test(outputId)) throw new HttpError(400, 'outputId is invalid')
    const record = requireService(ctx, 'prismRssOutputs', 'RSS Output Store').get(outputId)
    if (!record) throw new HttpError(404, 'RSS output was not found')
    return jsonResponse(res, 200, { record: projectRssOutput(record, true) })
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/production/draft`) {
    allowQuery(requestUrl.searchParams, ['draftId'])
    const draftId = text(requestUrl.searchParams.get('draftId'), 'draftId', 128, true)
    const draft = requireService(ctx, 'prismProduction', 'Production Store').getDraft(draftId)
    if (!draft) throw new HttpError(404, 'Production draft was not found')
    return jsonResponse(res, 200, { draft: projectDraft(draft) })
  }

  if (method === 'GET' && pathname === `${API_PREFIX}/production/media`) {
    return mediaResponse(ctx, req, res, requestUrl.searchParams)
  }

  if (method === 'PUT' && pathname === `${API_PREFIX}/production/revise`) {
    const body = draftRevisionInput(await readJson(req, 128 * 1024))
    try {
      const draft = await requireService(ctx, 'prismProduction', 'Production Store').reviseDraft(
        body.draftId, body.expectedVersion, body.expectedSha256, body.title, body.markdown,
      )
      return jsonResponse(res, 200, { draft: projectDraft(draft) })
    } catch (error) { throw draftRevisionError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/delete-draft`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'expectedVersion', 'expectedSha256'])
    const draftId = text(body.draftId, 'draftId', 128, true)
    const expectedVersion = integer(body.expectedVersion, 'expectedVersion', 1, 1_000_000_000)
    const expectedSha256 = text(body.expectedSha256, 'expectedSha256', 64, true)
    if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) throw new HttpError(400, 'expectedSha256 is invalid')
    try {
      const deletion = await requireService(ctx, 'prismProduction', 'Production Store').deleteDraft(draftId, expectedVersion, expectedSha256)
      return jsonResponse(res, 200, { deletion })
    } catch (error) { throw draftRevisionError(error) }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/review`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'decision', 'version', 'sha256'])
    const decision = text(body.decision, 'decision', 16, true)
    if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'decision is invalid')
    const sha256 = text(body.sha256, 'sha256', 64, true)
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'sha256 is invalid')
    const version = integer(body.version, 'version', 1, 1_000_000)
    if (version === undefined) throw new HttpError(400, 'version is required')
    try {
      const draft = await requireService(ctx, 'prismProduction', 'Production Store').review(
        text(body.draftId, 'draftId', 128, true), decision, version, sha256,
      )
      return jsonResponse(res, 200, { draft: projectDraft(draft) })
    } catch (error) {
      if (error?.name === 'DraftReviewConflictError') throw new HttpError(409, error.message)
      throw error
    }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/publish`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'publisherId'])
    try {
      const receipt = await requireService(ctx, 'prismProduction', 'Production Store').publish(
        text(body.draftId, 'draftId', 128, true), text(body.publisherId, 'publisherId', 256, true),
        { signal: operationSignal(req, res), trigger: 'manual', surface: 'dashboard' },
      )
      return jsonResponse(res, 200, { receipt: projectReceipt(receipt) })
    } catch (error) {
      const receipt = publicationReconciliationResult(error)
      if (receipt) return jsonResponse(res, 202, { warning: 'Publication outcome requires operator reconciliation before any retry.', receipt })
      if (isPublisherOutcomeError(error) && error.outcome === 'not-committed') return jsonResponse(res, 422, {
        error: error.message, outcome: error.outcome, operation: error.operation,
        ...(error.externalOutcomeUnknown === true ? { externalOutcome: 'unknown', retryAllowed: true } : {}),
        ...(Number.isInteger(error.errcode) && error.errcode >= -1 && error.errcode !== 0 ? { code: error.errcode } : {}), ...(error.rid ? { requestId: error.rid } : {}),
      })
      throw error
    }
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/reconcile-committed`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'publisherId', 'attemptId', 'confirmation'])
    const draftId = text(body.draftId, 'draftId', 128, true)
    const publisherId = text(body.publisherId, 'publisherId', 256, true)
    const attemptId = text(body.attemptId, 'attemptId', 128, true)
    const confirmation = text(body.confirmation, 'confirmation', 64, true)
    if (!publisherId.startsWith('wechat-draft:') || confirmation !== 'external-destination-checked-committed') {
      throw new HttpError(400, 'Exact WeChat committed-destination operator confirmation is required')
    }
    const draft = await requireService(ctx, 'prismProduction', 'Production Store')
      .confirmCommittedPublication(draftId, publisherId, attemptId)
    return jsonResponse(res, 200, { draft: projectDraft(draft) })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/reconcile-not-committed`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'publisherId', 'attemptId', 'confirmation'])
    const draftId = text(body.draftId, 'draftId', 128, true)
    const publisherId = text(body.publisherId, 'publisherId', 256, true)
    const attemptId = text(body.attemptId, 'attemptId', 128, true)
    const confirmation = text(body.confirmation, 'confirmation', 64, true)
    if (!publisherId.startsWith('wechat-draft:') || confirmation !== 'external-destination-checked-absent') {
      throw new HttpError(400, 'Exact WeChat absent-destination reconciliation confirmation is required')
    }
    const draft = await requireService(ctx, 'prismProduction', 'Production Store')
      .reconcilePublication(draftId, publisherId, attemptId, 'not-committed')
    return jsonResponse(res, 200, { draft: projectDraft(draft) })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/allow-unknown-retry`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'publisherId', 'attemptId', 'confirmation'])
    const draftId = text(body.draftId, 'draftId', 128, true)
    const publisherId = text(body.publisherId, 'publisherId', 256, true)
    const attemptId = text(body.attemptId, 'attemptId', 128, true)
    if (!publisherId.startsWith('wechat-draft:') || text(body.confirmation, 'confirmation', 64, true) !== 'accept-possible-duplicate-draft') {
      throw new HttpError(400, 'Exact WeChat duplicate-risk retry confirmation is required')
    }
    const draft = await requireService(ctx, 'prismProduction', 'Production Store')
      .allowUnknownPublicationRetry(draftId, publisherId, attemptId)
    return jsonResponse(res, 200, { draft: projectDraft(draft) })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/attempts`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'publisherId', 'limit', 'offset'])
    const records = requireService(ctx, 'prismProduction', 'Production Store').listPublicationAttempts({
      draftId: text(body.draftId, 'draftId', 128), publisherId: text(body.publisherId, 'publisherId', 256),
      limit: integer(body.limit, 'limit', 1, 100, 20), offset: integer(body.offset, 'offset', 0, 1_000_000, 0),
    })
    const receipts = ctx.get('prismPublicationReceipts')
    return jsonResponse(res, 200, { records: records.map(record => projectAttempt(record, receipts?.get?.(record.receiptId))) })
  }

  if (method === 'POST' && pathname === `${API_PREFIX}/production/republish`) {
    const body = await readJson(req)
    allowFields(body, ['draftId', 'publisherId', 'expectedVersion', 'expectedSha256', 'intentId'])
    const expectedVersion = integer(body.expectedVersion, 'expectedVersion', 1, 1_000_000_000)
    const expectedSha256 = text(body.expectedSha256, 'expectedSha256', 64, true)
    const intentId = text(body.intentId, 'intentId', 36, true)
    if (expectedVersion === undefined || !/^[a-f0-9]{64}$/u.test(expectedSha256) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(intentId)) throw new HttpError(400, 'Exact repeat version/hash/canonical lowercase intentId is invalid')
    try {
      const receipt = await requireService(ctx, 'prismProduction', 'Production Store').republishExact(
        text(body.draftId, 'draftId', 128, true), text(body.publisherId, 'publisherId', 256, true), expectedVersion, expectedSha256, intentId,
        { signal: operationSignal(req, res), trigger: 'manual', surface: 'dashboard' },
      )
      return jsonResponse(res, 200, { receipt: projectReceipt(receipt) })
    } catch (error) {
      const receipt = publicationReconciliationResult(error)
      if (receipt) return jsonResponse(res, 202, { warning: 'Publication outcome requires privileged reconciliation or Receipt repair before another publication.', receipt })
      if (isPublisherOutcomeError(error) && error.outcome === 'not-committed') return jsonResponse(res, 422, {
        error: error.message, outcome: error.outcome, operation: error.operation,
        ...(error.externalOutcomeUnknown === true ? { externalOutcome: 'unknown', retryAllowed: true } : {}),
        ...(Number.isInteger(error.errcode) && error.errcode >= -1 && error.errcode !== 0 ? { code: error.errcode } : {}), ...(error.rid ? { requestId: error.rid } : {}),
      })
      throw error
    }
  }

  if (method === 'OPTIONS') {
    res.writeHead(204, { allow: 'GET, PUT, POST, OPTIONS', 'cache-control': 'no-store' })
    return res.end()
  }
  throw new HttpError(404, 'Unknown PrismFlow dashboard endpoint')
}

export function apply(ctx, config) {
  let profileBinding
  if (config !== undefined) {
    if (!config || typeof config !== 'object' || Array.isArray(config)
      || Object.keys(config).length !== 2 || Object.keys(config).some(key => !['dshHome', 'profileName'].includes(key))
      || typeof config.dshHome !== 'string' || !isAbsolute(config.dshHome) || typeof config.profileName !== 'string') {
      throw new Error('PrismFlow Dashboard Profile binding requires exact dshHome and profileName fields')
    }
    const resolved = resolveNamedProfile(config.profileName, config.dshHome)
    profileBinding = { dshHome: resolved.homeRoot, profileName: config.profileName }
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      const rawTarget = req.url ?? '/'
      let requestUrl
      let pathname = ''
      try {
        if (Buffer.byteLength(rawTarget) > MAX_REQUEST_TARGET_BYTES) throw new HttpError(414, 'Request target is too large')
        requestUrl = new URL(rawTarget, 'http://localhost')
        pathname = requestUrl.pathname
        await routeRequest(ctx, req, res, requestUrl, profileBinding)
      } catch (error) {
        if (res.headersSent || res.writableEnded || res.destroyed) return
        if (error instanceof HttpError) {
          jsonResponse(res, error.status, { error: error.message, ...(error.details ?? {}) })
          return
        }
        ctx.logger.warn(`prismflow dashboard request failed: ${req.method ?? 'GET'} ${pathname}`)
        jsonResponse(res, 500, { error: 'PrismFlow operation failed. Check the DSH host log.' })
      }
    },
  }), 'prismflow-ui.api')
}
