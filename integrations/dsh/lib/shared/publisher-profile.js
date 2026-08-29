import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { renderGitHubCommitMessage, normalizeGitHubApiBaseUrl, parseGitHubRepository, validateGitHubBranch, validateGitHubPathPrefix } from './github-publisher.js'
import { renderMarkdownFileName } from './markdown-publisher.js'
import { normalizeR2AccountId, normalizeR2PublicUrlPrefix, validateR2BucketName, validateR2PathPrefix } from './r2-publisher.js'

export const PUBLISHER_PROFILE_DOCUMENT_KIND = 'PrismFlowPublisherProfileDocument/v2'
export const PUBLISHER_CHANGE_PLAN_KIND = 'PrismFlowPublisherChangePlan/v2'
export const LEGACY_PUBLISHER_PROFILE_DOCUMENT_KIND = 'PrismFlowPublisherProfileDocument/v1'
export const LEGACY_PUBLISHER_CHANGE_PLAN_KIND = 'PrismFlowPublisherChangePlan/v1'
export const PUBLISHER_ROWS = Object.freeze([
  { rowId: 'prismflow-publisher-local-markdown', kind: 'local-markdown', label: 'Local Markdown' },
  { rowId: 'prismflow-publisher-github-markdown', kind: 'github-markdown', label: 'GitHub Markdown' },
  { rowId: 'prismflow-publisher-r2-markdown', kind: 'r2-markdown', label: 'Cloudflare R2 Markdown' },
  { rowId: 'prismflow-publisher-wechat-draft', kind: 'wechat-draft', label: 'WeChat Draft' },
])

const ROW_BY_KIND = new Map(PUBLISHER_ROWS.map(row => [row.kind, row]))
const ROW_BY_ID = new Map(PUBLISHER_ROWS.map(row => [row.rowId, row]))
const ID = /^[A-Za-z0-9_-]{1,128}$/u
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/u
const DEFAULT_WECHAT_API_BASE_URL = 'https://api.weixin.qq.com'

export class PublisherProfileValidationError extends Error {
  constructor(message) { super(message); this.name = 'PublisherProfileValidationError' }
}

function fail(message) { throw new PublisherProfileValidationError(message) }
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`)
  return value
}
function exact(value, allowed, field) {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown) fail(`${field} contains unsupported property: ${unknown}`)
}
function string(value, field, { required = true, max = 2048, controls = false } = {}) {
  if (value === undefined || value === null) { if (!required) return undefined; fail(`${field} is required`) }
  if (typeof value !== 'string' || (required && value.length === 0) || value.length > max || (!controls && /[\u0000-\u001f\u007f]/u.test(value))) fail(`${field} is invalid`)
  return value
}
function integer(value, field, min, max, fallback) {
  const result = value === undefined ? fallback : value
  if (!Number.isInteger(result) || result < min || result > max) fail(`${field} must be an integer from ${min} to ${max}`)
  return result
}
function choice(value, field, choices, fallback) {
  const result = value === undefined ? fallback : value
  if (!choices.includes(result)) fail(`${field} is invalid`)
  return result
}
function credentialRef(value, field, fallback) {
  const result = string(value ?? fallback, field, { max: 128 })
  if (!CREDENTIAL_REF.test(result)) fail(`${field} must be a valid credential reference`)
  return result
}
function identity(destination, field) {
  const id = string(destination.id, `${field}.id`, { max: 128 })
  if (!ID.test(id)) fail(`${field}.id must match [A-Za-z0-9_-]+`)
  return { id, name: string(destination.name, `${field}.name`, { max: 512 }) }
}
const MARKDOWN_COMPATIBILITY_DEFAULTS = Object.freeze({
  fileNamePattern: '{date}.md', title: 'PrismFlow Content', maxItems: 50, maxDescriptionChars: 1_000,
})
const LOCAL_COMPATIBILITY_DEFAULTS = Object.freeze({ ...MARKDOWN_COMPATIBILITY_DEFAULTS, fileNamePattern: 'prismflow-{date}.md' })
const GITHUB_COMPATIBILITY_DEFAULTS = Object.freeze({
  ...MARKDOWN_COMPATIBILITY_DEFAULTS, commitMessage: 'chore: publish PrismFlow content {date}',
})

function compatibility(destination, defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([field, fallback]) => {
    if (field === 'maxItems') return [field, integer(destination[field], field, 1, 100, fallback)]
    if (field === 'maxDescriptionChars') return [field, integer(destination[field], field, 1, 10_000, fallback)]
    const value = string(destination[field] ?? fallback, field, { max: field === 'title' ? 512 : field === 'commitMessage' ? 200 : 256 })
    if (field === 'tokenMode' && value !== 'stable') fail('tokenMode is invalid')
    return [field, value]
  }))
}

function normalizeLocal(destination, field) {
  exact(destination, ['id', 'name', 'root', 'fileNamePattern', 'artifactFileNamePattern', 'title', 'overwrite', 'maxItems', 'maxDescriptionChars', 'maxBytes'], field)
  const root = string(destination.root, `${field}.root`, { max: 4096 })
  if (!isAbsolute(root)) fail(`${field}.root must be an absolute path`)
  const artifactFileNamePattern = string(destination.artifactFileNamePattern ?? 'prismflow-draft-{date}.md', `${field}.artifactFileNamePattern`, { max: 256 })
  renderMarkdownFileName(artifactFileNamePattern, '2000-01-01')
  return { ...identity(destination, field), root: resolve(root), artifactFileNamePattern,
    overwrite: choice(destination.overwrite, `${field}.overwrite`, ['never', 'if-changed'], 'if-changed'),
    maxBytes: integer(destination.maxBytes, `${field}.maxBytes`, 1024, 2_000_000, 1_000_000),
    ...compatibility(destination, LOCAL_COMPATIBILITY_DEFAULTS) }
}

function normalizeGithub(destination, field) {
  exact(destination, ['id', 'name', 'repository', 'branch', 'pathPrefix', 'fileNamePattern', 'artifactFileNamePattern', 'title', 'overwrite', 'commitMessage', 'artifactCommitMessage', 'tokenCredential', 'apiBaseUrl', 'maxItems', 'maxDescriptionChars', 'maxBytes'], field)
  let repository, branch, pathPrefix, apiBaseUrl
  try {
    repository = string(destination.repository, `${field}.repository`, { max: 256 })
    parseGitHubRepository(repository)
    branch = validateGitHubBranch(destination.branch ?? 'main')
    pathPrefix = validateGitHubPathPrefix(destination.pathPrefix ?? 'daily')
    apiBaseUrl = normalizeGitHubApiBaseUrl(destination.apiBaseUrl ?? 'https://api.github.com')
  } catch (error) { fail(`${field}: ${error.message}`) }
  const artifactFileNamePattern = string(destination.artifactFileNamePattern ?? 'draft-{date}.md', `${field}.artifactFileNamePattern`, { max: 256 })
  const artifactCommitMessage = string(destination.artifactCommitMessage ?? 'chore: publish approved PrismFlow draft {date}', `${field}.artifactCommitMessage`, { max: 200 })
  const compatible = compatibility(destination, GITHUB_COMPATIBILITY_DEFAULTS)
  renderMarkdownFileName(artifactFileNamePattern, '2000-01-01'); renderGitHubCommitMessage(artifactCommitMessage, '2000-01-01')
  renderGitHubCommitMessage(compatible.commitMessage, '2000-01-01')
  return { ...identity(destination, field), repository, branch, pathPrefix, artifactFileNamePattern,
    overwrite: choice(destination.overwrite, `${field}.overwrite`, ['never', 'if-changed'], 'if-changed'), artifactCommitMessage,
    apiBaseUrl, tokenCredential: credentialRef(destination.tokenCredential, `${field}.tokenCredential`, 'GITHUB_TOKEN'),
    maxBytes: integer(destination.maxBytes, `${field}.maxBytes`, 1024, 1_000_000, 900_000), ...compatible }
}

function normalizeR2(destination, field) {
  exact(destination, ['id', 'name', 'accountId', 'bucket', 'pathPrefix', 'fileNamePattern', 'artifactFileNamePattern', 'title', 'overwrite', 'accessKeyIdCredential', 'secretAccessKeyCredential', 'publicUrlPrefix', 'maxItems', 'maxDescriptionChars', 'maxBytes'], field)
  let accountId, bucket, pathPrefix, publicUrlPrefix
  try {
    accountId = normalizeR2AccountId(string(destination.accountId, `${field}.accountId`, { max: 64 }))
    bucket = validateR2BucketName(string(destination.bucket, `${field}.bucket`, { max: 63 }))
    pathPrefix = validateR2PathPrefix(destination.pathPrefix ?? 'daily')
    publicUrlPrefix = normalizeR2PublicUrlPrefix(string(destination.publicUrlPrefix ?? '', `${field}.publicUrlPrefix`, { required: false, max: 2048 }) ?? '')
  } catch (error) { fail(`${field}: ${error.message}`) }
  const artifactFileNamePattern = string(destination.artifactFileNamePattern ?? 'draft-{date}.md', `${field}.artifactFileNamePattern`, { max: 256 })
  renderMarkdownFileName(artifactFileNamePattern, '2000-01-01')
  return { ...identity(destination, field), accountId, bucket, pathPrefix, artifactFileNamePattern,
    overwrite: choice(destination.overwrite, `${field}.overwrite`, ['never', 'if-changed'], 'if-changed'), publicUrlPrefix,
    accessKeyIdCredential: credentialRef(destination.accessKeyIdCredential, `${field}.accessKeyIdCredential`, 'R2_ACCESS_KEY_ID'),
    secretAccessKeyCredential: credentialRef(destination.secretAccessKeyCredential, `${field}.secretAccessKeyCredential`, 'R2_SECRET_ACCESS_KEY'),
    maxBytes: integer(destination.maxBytes, `${field}.maxBytes`, 1024, 1_000_000, 900_000),
    ...compatibility(destination, MARKDOWN_COMPATIBILITY_DEFAULTS) }
}

const WECHAT_LIMITS = Object.freeze({
  titleChars: [1, 32, 32], authorChars: [1, 16, 16], digestChars: [1, 120, 120], contentChars: [1000, 1_000_000, 20_000],
  contentBytes: [2048, 1_000_000, 1_000_000], maxImages: [1, 20, 20], bodyImageBytes: [1024, 999_999, 999_999],
  permanentImageBytes: [1024, 10 * 1024 * 1024, 10 * 1024 * 1024], maxPixels: [1, 100_000_000, 25_000_000],
  maxSourceBytes: [1024, 32 * 1024 * 1024, 10 * 1024 * 1024], fetchTimeoutMs: [100, 120_000, 15_000], requestTimeoutMs: [100, 120_000, 30_000],
  concurrency: [1, 8, 1],
})
function normalizeWechat(destination, field, options = {}) {
  exact(destination, ['id', 'name', 'appId', 'appSecretCredential', 'apiOrigin', 'allowInsecureHttp', 'tokenMode', 'articleType', 'defaultAuthor', 'digestPolicy', 'needOpenComment', 'onlyFansCanComment', 'defaultCoverAssetRef', 'ffmpegPath', 'limits'], field)
  const appId = string(destination.appId, `${field}.appId`, { max: 128 })
  if (!/^wx[A-Za-z0-9]{1,126}$/u.test(appId)) fail(`${field}.appId is invalid`)
  const limitsInput = object(destination.limits ?? {}, `${field}.limits`)
  exact(limitsInput, Object.keys(WECHAT_LIMITS), `${field}.limits`)
  const limits = Object.fromEntries(Object.entries(WECHAT_LIMITS).map(([key, [min, max, fallback]]) => [key, integer(limitsInput[key], `${field}.limits.${key}`, min, max, fallback)]))
  const defaultAuthor = string(destination.defaultAuthor ?? '', `${field}.defaultAuthor`, { required: false, max: limits.authorChars }) ?? ''
  const apiOrigin = string(destination.apiOrigin ?? DEFAULT_WECHAT_API_BASE_URL, `${field}.apiOrigin`, { max: 2048 })
  const allowInsecureHttp = integer(destination.allowInsecureHttp, `${field}.allowInsecureHttp`, 0, 1, 0)
  let parsed
  try { parsed = new URL(apiOrigin) } catch { fail(`${field}.apiOrigin is invalid`) }
  const allowedProtocol = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && allowInsecureHttp === 1)
  if (!allowedProtocol || parsed.username || parsed.password || parsed.search || parsed.hash) fail(`${field}.apiOrigin must be a credential-free HTTP(S) base URL without query or fragment; HTTP requires allowInsecureHttp=1`)
  const apiBaseUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/u, '')}`
  const ffmpegPath = destination.ffmpegPath === undefined ? undefined : string(destination.ffmpegPath, `${field}.ffmpegPath`, { max: 1024 })
  const appSecretCredential = options.allowLegacyCredentialRefs
    ? string(destination.appSecretCredential, `${field}.appSecretCredential`, { max: 128 })
    : credentialRef(destination.appSecretCredential, `${field}.appSecretCredential`)
  return { ...identity(destination, field), appId,
    appSecretCredential,
    apiOrigin: apiBaseUrl, ...(allowInsecureHttp === 1 ? { allowInsecureHttp: 1 } : {}), articleType: choice(destination.articleType, `${field}.articleType`, ['news', 'newspic']), defaultAuthor,
    digestPolicy: choice(destination.digestPolicy, `${field}.digestPolicy`, ['omit', 'plain-text-excerpt', 'artifact-or-omit', 'artifact-or-plain-text-excerpt'], 'artifact-or-omit'),
    needOpenComment: integer(destination.needOpenComment, `${field}.needOpenComment`, 0, 1, 1),
    onlyFansCanComment: integer(destination.onlyFansCanComment, `${field}.onlyFansCanComment`, 0, 1, 0),
    defaultCoverAssetRef: string(destination.defaultCoverAssetRef ?? '', `${field}.defaultCoverAssetRef`, { required: false, max: 256 }) ?? '',
    ...(ffmpegPath === undefined ? {} : { ffmpegPath }), limits,
    ...compatibility(destination, { tokenMode: 'stable' }) }
}

const NORMALIZERS = { 'local-markdown': normalizeLocal, 'github-markdown': normalizeGithub, 'r2-markdown': normalizeR2, 'wechat-draft': normalizeWechat }

export function normalizePublisherConfig(kind, config, options = {}) {
  if (!ROW_BY_KIND.has(kind)) fail(`Unsupported publisher channel kind: ${kind}`)
  object(config, `${kind} config`); exact(config, ['destinations'], `${kind} config`)
  if (!Array.isArray(config.destinations)) fail(`${kind} config.destinations must be an array`)
  if (config.destinations.length > 100) fail(`${kind} config has too many destinations`)
  const seen = new Set()
  const destinations = config.destinations.map((raw, index) => {
    const destination = NORMALIZERS[kind](object(raw, `${kind}.destinations[${index}]`), `${kind}.destinations[${index}]`, options)
    if (seen.has(destination.id)) fail(`Duplicate ${kind} destination id: ${destination.id}`)
    seen.add(destination.id); return destination
  })
  return { destinations }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
  return value
}
export function canonicalJson(value) { return JSON.stringify(canonicalize(value)) }
export function publisherConfigRevision(kind, config, options = {}) {
  return createHash('sha256').update(canonicalJson({ kind, config: normalizePublisherConfig(kind, config, options) })).digest('hex')
}
export function publisherRowRevision(row) {
  const descriptor = publisherRow(row?.rowId)
  if (!descriptor || descriptor.kind !== row?.channelKind || typeof row?.disabled !== 'boolean' || !/^[a-f0-9]{64}$/u.test(row?.configRevision ?? '')) {
    fail('Publisher row revision input is invalid')
  }
  return createHash('sha256').update(canonicalJson({ rowId: row.rowId, channelKind: row.channelKind,
    disabled: row.disabled, configRevision: row.configRevision, migrationRequired: row.migrationRequired === true })).digest('hex')
}
export function publisherDocumentRevision(profile, rows) {
  if (typeof profile !== 'string' || !Array.isArray(rows) || rows.length !== PUBLISHER_ROWS.length
    || rows.some((row, index) => row?.rowId !== PUBLISHER_ROWS[index].rowId)) fail('Publisher document revision input is invalid')
  return createHash('sha256').update(canonicalJson({ profile, rows: rows.map(row => ({ rowId: row.rowId, rowRevision: row.rowRevision })) })).digest('hex')
}
export function documentFingerprint(value) {
  const { fingerprint: _fingerprint, ...body } = object(value, 'document')
  return createHash('sha256').update(canonicalJson(body)).digest('hex')
}
export function publisherRow(rowId) { return ROW_BY_ID.get(rowId) }
