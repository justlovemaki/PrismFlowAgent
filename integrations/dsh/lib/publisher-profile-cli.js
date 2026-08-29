import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { hostname } from 'node:os'
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path'
import { parseDocument, isMap, isSeq } from 'yaml'
import {
  LEGACY_PUBLISHER_CHANGE_PLAN_KIND, LEGACY_PUBLISHER_PROFILE_DOCUMENT_KIND, PUBLISHER_CHANGE_PLAN_KIND,
  PUBLISHER_PROFILE_DOCUMENT_KIND, PUBLISHER_ROWS, canonicalJson, documentFingerprint, normalizePublisherConfig,
  publisherConfigRevision, publisherDocumentRevision, publisherRow, publisherRowRevision,
} from './shared/publisher-profile.js'

const PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const CANONICAL_ISO = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u
const PROFILE_OVERRIDE_FIELDS = ['id', 'disabled', 'config']
const FIXED_PUBLISHER_DEFAULT = Object.freeze({ disabled: true, config: Object.freeze({ destinations: Object.freeze([]) }) })
const DOCUMENT_FIELDS = ['kind', 'profile', 'profileHash', 'documentRevision', 'exportedAt', 'rows', 'fingerprint']
const DOCUMENT_ROW_FIELDS = ['rowId', 'channelKind', 'disabled', 'config', 'configRevision', 'rowRevision', 'migrationRequired']
const PLAN_FIELDS = ['kind', 'profile', 'expectedProfileHash', 'expectedDocumentRevision', 'createdAt', 'changes', 'fingerprint']
const LEGACY_DOCUMENT_FIELDS = ['kind', 'profile', 'profileHash', 'exportedAt', 'rows', 'fingerprint']
const LEGACY_DOCUMENT_ROW_FIELDS = ['rowId', 'channelKind', 'disabled', 'config', 'configRevision', 'migrationRequired']
const LEGACY_PLAN_FIELDS = ['kind', 'profile', 'expectedProfileHash', 'createdAt', 'changes', 'fingerprint']
const OPERATION_STATE_KIND = 'PrismFlowPublisherProfileOperations/v1'
const OPERATION_FILE = '.prismflow-publisher-profile-operations.json'
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MAX_OPERATIONS = 512
const MAX_OPERATION_BYTES = 1024 * 1024
const OPERATION_RECORD_FIELDS = ['operationId', 'digest', 'profile', 'oldProfileHash', 'newProfileHash', 'oldDocumentRevision', 'newDocumentRevision', 'revisions', 'status', 'phase', 'request', 'preconditions', 'createdAt', 'updatedAt']
const RECOVERY_OPERATION_RECORD_FIELDS = OPERATION_RECORD_FIELDS.filter(field => field !== 'preconditions')
const LEGACY_OPERATION_RECORD_FIELDS = RECOVERY_OPERATION_RECORD_FIELDS.filter(field => !['phase', 'request'].includes(field))
const OPERATION_REVISION_FIELDS = ['oldRowRevision', 'rowRevision', 'configRevision']
const OPERATION_PRECONDITION_FIELDS = ['profileDirectory', 'patch', 'overlays', 'state', 'nextState']
const LEGACY_OPERATION_PRECONDITION_FIELDS = ['overlays', 'state']
const PROFILE_DIRECTORY_SNAPSHOT_FIELDS = ['identity']
const PATCH_SNAPSHOT_FIELDS = ['identity', 'sha256']
const OVERLAY_SNAPSHOT_FIELDS = ['candidate', 'presence', 'identity', 'sha256']
const STATE_SNAPSHOT_FIELDS = ['presence', 'identity', 'fingerprint']
const NEXT_STATE_SNAPSHOT_FIELDS = ['fingerprint', 'sha256']
const OVERLAY_CANDIDATES = Object.freeze([
  { candidate: 'dsh-home-patch', path: location => join(location.homeRoot, 'cordis.patch.yml') },
  { candidate: 'dsh-home-config', path: location => join(location.homeRoot, 'cordis.yml') },
  { candidate: 'profile-config', path: location => join(location.profileDir, 'cordis.yml') },
])
const STATE_KIND = 'PrismFlowPublisherProfileState/v1'
const STATE_FILE = '.prismflow-publisher-profile-state.json'
const LOCK_FILE = '.prismflow-publisher-profile.lock'
const LOCK_OWNER_FIELDS = ['hostname', 'pid', 'processStartIdentity', 'nonce', 'createdAt']
const MAX_STATE_BYTES = 2 * 1024 * 1024
const MAX_STATE_DESTINATIONS = 10_000
const RETAINED_BACKUPS_PER_ARTIFACT = 5
const MANAGED_PUBLISHER_MODULES = new Map(PUBLISHER_ROWS.map(row => [`@prismflow/dsh/publisher-${row.kind}`, row]))

export class PublisherProfileCliError extends Error {
  constructor(message) { super(message); this.name = 'PublisherProfileCliError' }
}
function fail(message) { throw new PublisherProfileCliError(message) }
function object(value, field) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`); return value }
function exact(value, fields, field) { const unknown = Object.keys(value).find(key => !fields.includes(key)); if (unknown) fail(`${field} contains unsupported property: ${unknown}`) }
function safeProfileName(value) { if (!PROFILE_NAME.test(value ?? '')) fail('A fixed DSH Profile name is required'); return value }
function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function canonicalIso(value, field) {
  if (typeof value !== 'string' || value.length !== 24 || !CANONICAL_ISO.test(value) || new Date(value).toISOString() !== value) fail(`${field} must be a canonical ISO timestamp`)
  return value
}
function samePath(left, right) {
  const normalizedLeft = resolve(left), normalizedRight = resolve(right)
  return process.platform === 'win32' ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight
}
function assertNoLinksTo(path, label, expected) {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const segment of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, segment)
    const info = lstatSync(current)
    if (info.isSymbolicLink()) fail(`${label} must not contain a symlink or reparse point`)
  }
  const info = lstatSync(absolute)
  if (info.isSymbolicLink() || (expected === 'file' ? !info.isFile() : !info.isDirectory())) fail(`${label} must be a regular ${expected}`)
  if (!samePath(realpathSync.native?.(absolute) ?? realpathSync(absolute), absolute)) fail(`${label} resolved through an unsafe filesystem indirection`)
  return info
}
function fileIdentity(info) { return `${info.dev}:${info.ino}:${info.mode}:${info.nlink}` }
function captureDirectoryIdentity(path, label) {
  const info = assertNoLinksTo(path, label, 'directory')
  return { identity: fileIdentity(info), realpath: realpathSync.native?.(resolve(path)) ?? realpathSync(resolve(path)) }
}
function assertDirectoryIdentity(path, expected, label = 'Named DSH Profile') {
  let observed
  try { observed = captureDirectoryIdentity(path, label) } catch { fail(`${label} identity changed while the Publisher Profile lock was held`) }
  if (observed.identity !== expected.identity || !samePath(observed.realpath, expected.realpath)) {
    fail(`${label} identity changed while the Publisher Profile lock was held`)
  }
}
function readRegularFile(path, label) {
  const before = assertNoLinksTo(path, label, 'file')
  const fd = openSync(path, 'r')
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || fileIdentity(opened) !== fileIdentity(before)) fail(`${label} identity changed while opening`)
    return { source: readFileSync(fd, 'utf8'), identity: fileIdentity(opened) }
  } finally { closeSync(fd) }
}
function fsyncDirectory(path) {
  let fd
  try { fd = openSync(path, 'r'); fsyncSync(fd) }
  catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR'].includes(error?.code)) throw error }
  finally { if (fd !== undefined) closeSync(fd) }
}

export function resolveNamedProfile(profile, home = process.env.DSH_HOME) {
  safeProfileName(profile)
  if (typeof home !== 'string' || home.length < 1) fail('DSH_HOME is required')
  const homeRoot = resolve(home)
  const profilesRoot = join(homeRoot, 'profiles')
  const profileDir = resolve(profilesRoot, profile)
  if (dirname(profileDir) !== profilesRoot) fail('Profile name escaped DSH_HOME')
  assertNoLinksTo(homeRoot, 'DSH_HOME', 'directory')
  assertNoLinksTo(profilesRoot, 'DSH profiles directory', 'directory')
  assertNoLinksTo(profileDir, 'Named DSH Profile', 'directory')
  const packagePath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(packagePath) || !existsSync(patchPath)) fail(`Named DSH Profile does not exist: ${profile}`)
  assertNoLinksTo(packagePath, 'Profile package', 'file')
  assertNoLinksTo(patchPath, 'Profile patch', 'file')
  const statePath = join(profileDir, STATE_FILE)
  const operationPath = join(profileDir, OPERATION_FILE)
  if (existsSync(statePath)) assertNoLinksTo(statePath, 'Publisher managed state', 'file')
  if (existsSync(operationPath)) assertNoLinksTo(operationPath, 'Publisher operation state', 'file')
  return { homeRoot, profileDir, packagePath, patchPath, statePath, operationPath }
}

function managedPublisherChannel(value) {
  if (typeof value !== 'string') return undefined
  return publisherRow(value) ?? MANAGED_PUBLISHER_MODULES.get(value)
}
function containsManagedChannel(value) {
  if (typeof value === 'string') return managedPublisherChannel(value) !== undefined
  if (Array.isArray(value)) return value.some(containsManagedChannel)
  return !!value && typeof value === 'object' && Object.values(value).some(containsManagedChannel)
}
function overlayContainsManagedChannel(source) {
  let document
  try { document = parseDocument(source, { strict: true, uniqueKeys: true }) } catch { fail('Profile overlay is malformed YAML') }
  if (document.errors.length) fail('Profile overlay is malformed YAML')
  return containsManagedChannel(document.toJSON())
}
function assertNoOverlayEnvironment() {
  for (const name of ['DSH_PATCH', 'DSH_CONFIG', 'CORDIS_PATCH']) if (process.env[name]) fail(`Cannot prove effective publisher configuration while ${name} is set`)
}
function captureHigherPrecedenceOverlays(location) {
  assertNoOverlayEnvironment()
  return OVERLAY_CANDIDATES.map(descriptor => {
    const path = descriptor.path(location)
    try {
      lstatSync(path)
    } catch (error) {
      if (error?.code === 'ENOENT') return { candidate: descriptor.candidate, presence: 'absent', identity: null, sha256: null }
      throw error
    }
    const read = readRegularFile(path, 'Profile overlay')
    if (overlayContainsManagedChannel(read.source)) fail(`Publisher rows are shadowed by a higher-precedence overlay: ${basename(path)}`)
    return { candidate: descriptor.candidate, presence: 'present', identity: read.identity, sha256: sha256(read.source) }
  })
}
function rejectHigherPrecedenceOverlays(homeRoot, profileDir) {
  captureHigherPrecedenceOverlays({ homeRoot, profileDir })
}
function assertExactHigherPrecedenceOverlays(location, expected) {
  const observed = captureHigherPrecedenceOverlays(location)
  if (canonicalJson(observed) !== canonicalJson(expected)) fail('Higher-precedence overlay identity or hash became stale before atomic replacement')
}
function profileDirectorySnapshot(location) {
  return { identity: captureDirectoryIdentity(location.profileDir, 'Named DSH Profile').identity }
}
function assertExactProfileDirectorySnapshot(location, expected) {
  if (canonicalJson(profileDirectorySnapshot(location)) !== canonicalJson(expected)) {
    fail('Named DSH Profile directory identity became stale before maintenance drain')
  }
}
function patchSnapshot(read) { return { identity: read.identity, sha256: sha256(read.source) } }
function readExactPatchSnapshot(location, expected) {
  const read = readRegularFile(location.patchPath, 'Profile patch')
  if (canonicalJson(patchSnapshot(read)) !== canonicalJson(expected)) {
    fail('Profile patch identity or hash became stale before atomic replacement')
  }
  return read
}
function assertExactPatchSnapshot(location, expected) { readExactPatchSnapshot(location, expected) }

const SECRET_LIKE_CREDENTIAL_REF = /^(?:gh[pousr]_|github_pat_|sk-|AKIA|ASIA)/u
function sanitizeLiteralCredentials(config) {
  let migrationRequired = false
  const destinations = config.destinations.map(destination => Object.fromEntries(Object.entries(destination).map(([key, value]) => {
    if (/Credential$/u.test(key) && typeof value === 'string' && SECRET_LIKE_CREDENTIAL_REF.test(value)) {
      migrationRequired = true
      return [key, 'MIGRATION_REQUIRED']
    }
    return [key, value]
  })))
  return { migrationRequired, config: migrationRequired ? { destinations } : config }
}
function normalizedOverride(descriptor, raw) {
  exact(raw, PROFILE_OVERRIDE_FIELDS, `Profile override ${descriptor.rowId}`)
  if (raw.id !== descriptor.rowId || (raw.disabled !== undefined && typeof raw.disabled !== 'boolean')) {
    fail(`Profile override ${descriptor.rowId} has an unsupported shape`)
  }
  const disabled = raw.disabled ?? FIXED_PUBLISHER_DEFAULT.disabled
  const rawConfig = raw.config === undefined
    ? { ...FIXED_PUBLISHER_DEFAULT.config }
    : { ...FIXED_PUBLISHER_DEFAULT.config, ...object(raw.config, `Profile override ${descriptor.rowId} config`) }
  let config
  let migrationRequired = false
  try {
    config = normalizePublisherConfig(descriptor.kind, rawConfig)
    const sanitized = sanitizeLiteralCredentials(config)
    config = sanitized.config
    migrationRequired = sanitized.migrationRequired
  } catch (error) {
    if (descriptor.kind !== 'wechat-draft') throw error
    const legacy = normalizePublisherConfig(descriptor.kind, rawConfig, { allowLegacyCredentialRefs: true })
    migrationRequired = true
    config = { destinations: legacy.destinations.map(destination => ({ ...destination, appSecretCredential: 'MIGRATION_REQUIRED' })) }
  }
  return { rawConfig, row: { id: descriptor.rowId, disabled, config }, migrationRequired }
}

function parsePublisherRows(source) {
  let document
  try { document = parseDocument(source, { strict: true, uniqueKeys: true, keepSourceTokens: true }) } catch { fail('Profile patch is malformed YAML') }
  if (document.errors.length) fail('Profile patch is malformed YAML')
  if (!isSeq(document.contents)) fail('Profile patch must be a sequence')
  const found = new Map()
  for (const operation of document.contents.items) {
    const operationValue = operation?.toJSON?.() ?? operation
    if (!isMap(operation)) {
      if (containsManagedChannel(operationValue)) fail('Profile contains an ambiguous or unsupported publisher operation')
      continue
    }
    const insert = operation.get('insert', true)
    if (isSeq(insert) && insert.items.some(rowNode => isMap(rowNode)
      && (managedPublisherChannel(rowNode.get('id')) || managedPublisherChannel(rowNode.get('name'))))) {
      fail('Profile contains a publisher row inside local insert; use one top-level override')
    }
    const id = operation.get('id')
    const descriptor = publisherRow(id)
    if (descriptor) {
      if (found.has(id)) fail(`Profile contains duplicate top-level publisher override: ${id}`)
      const normalized = normalizedOverride(descriptor, operationValue)
      found.set(id, { node: operation, ...normalized })
      continue
    }
    if (containsManagedChannel(operationValue)) fail('Profile contains a remove or ambiguous/unsupported publisher operation')
  }
  for (const descriptor of PUBLISHER_ROWS) if (!found.has(descriptor.rowId)) {
    const config = { destinations: [] }
    found.set(descriptor.rowId, { node: undefined, rawConfig: config,
      row: { id: descriptor.rowId, disabled: true, config }, migrationRequired: false })
  }
  return { document, found }
}

function rowDto(descriptor, parsed) {
  const found = parsed.found.get(descriptor.rowId)
  const row = found.row
  const body = { rowId: descriptor.rowId, channelKind: descriptor.kind, disabled: row.disabled, config: row.config,
    configRevision: publisherConfigRevision(descriptor.kind, row.config), ...(found.migrationRequired ? { migrationRequired: true } : {}) }
  return { ...body, rowRevision: publisherRowRevision(body) }
}
function documentFrom(profile, source, parsed, now) {
  const rows = PUBLISHER_ROWS.map(row => rowDto(row, parsed))
  const body = { kind: PUBLISHER_PROFILE_DOCUMENT_KIND, profile, profileHash: sha256(source),
    documentRevision: publisherDocumentRevision(profile, rows), exportedAt: now.toISOString(), rows }
  canonicalIso(body.exportedAt, 'exportedAt')
  return { ...body, fingerprint: documentFingerprint(body) }
}

export function exportPublisherProfile(profile, options = {}) {
  const location = resolveNamedProfile(profile, options.home)
  rejectHigherPrecedenceOverlays(location.homeRoot, location.profileDir)
  const { source } = readRegularFile(location.patchPath, 'Profile patch')
  return documentFrom(profile, source, parsePublisherRows(source), options.now ?? new Date())
}

export function validatePublisherDocument(input) {
  const value = object(input, 'Profile document')
  const legacy = value.kind === LEGACY_PUBLISHER_PROFILE_DOCUMENT_KIND
  exact(value, legacy ? LEGACY_DOCUMENT_FIELDS : DOCUMENT_FIELDS, 'Profile document')
  if (!legacy && value.kind !== PUBLISHER_PROFILE_DOCUMENT_KIND) fail('Profile document kind is invalid')
  safeProfileName(value.profile); canonicalIso(value.exportedAt, 'exportedAt')
  if (!SHA256.test(value.profileHash ?? '') || !SHA256.test(value.fingerprint ?? '') || documentFingerprint(value) !== value.fingerprint) fail('Profile document fingerprint is invalid')
  if (!Array.isArray(value.rows) || value.rows.length !== PUBLISHER_ROWS.length) fail('Profile document must contain the four fixed publisher rows')
  const seen = new Set()
  const rows = value.rows.map((raw, index) => {
    const row = object(raw, `rows[${index}]`); exact(row, legacy ? LEGACY_DOCUMENT_ROW_FIELDS : DOCUMENT_ROW_FIELDS, `rows[${index}]`)
    const descriptor = publisherRow(row.rowId)
    if (!descriptor || descriptor.kind !== row.channelKind || seen.has(row.rowId) || typeof row.disabled !== 'boolean'
      || (row.migrationRequired !== undefined && row.migrationRequired !== true)) fail(`rows[${index}] is invalid`)
    seen.add(row.rowId); const config = normalizePublisherConfig(descriptor.kind, row.config)
    const configRevision = publisherConfigRevision(descriptor.kind, config)
    if (row.configRevision !== configRevision) fail(`rows[${index}] configRevision is stale`)
    const body = { rowId: row.rowId, channelKind: row.channelKind, disabled: row.disabled, config, configRevision,
      ...(row.migrationRequired ? { migrationRequired: true } : {}) }
    const rowRevision = publisherRowRevision(body)
    if (!legacy && row.rowRevision !== rowRevision) fail(`rows[${index}] rowRevision is stale`)
    return legacy ? body : { ...body, rowRevision }
  })
  if (!legacy && (!SHA256.test(value.documentRevision ?? '') || value.documentRevision !== publisherDocumentRevision(value.profile, rows))) {
    fail('Profile documentRevision is stale')
  }
  return { ...value, rows }
}

function operational(destination, rowId, legacy = false) {
  const { name: _name, ...value } = destination
  if (rowId === 'prismflow-publisher-wechat-draft') {
    delete value.allowInsecureHttp
    if (!legacy) { delete value.apiOrigin; delete value.ffmpegPath }
  }
  return canonicalJson(value)
}
function identityDigests(destination, rowId) {
  const current = sha256(operational(destination, rowId))
  const legacy = sha256(operational(destination, rowId, true))
  return { current, legacy }
}
function stateKey(rowId, id) { return `${rowId}:${id}` }
function emptyState() { const body = { kind: STATE_KIND, destinations: {} }; return { ...body, fingerprint: documentFingerprint(body) } }
function readState(location) {
  if (!existsSync(location.statePath)) return { state: emptyState(), identity: undefined, source: undefined }
  const { source, identity } = readRegularFile(location.statePath, 'Publisher managed state')
  if (Buffer.byteLength(source, 'utf8') > MAX_STATE_BYTES) fail('Publisher managed state exceeds the 2 MiB fail-closed limit')
  let value
  try { value = JSON.parse(source) } catch { fail('Publisher managed state is malformed') }
  object(value, 'Publisher managed state'); exact(value, ['kind', 'destinations', 'fingerprint'], 'Publisher managed state')
  const destinations = object(value.destinations, 'Publisher managed state destinations')
  if (Object.keys(destinations).length > MAX_STATE_DESTINATIONS) fail(`Publisher managed state exceeds ${MAX_STATE_DESTINATIONS} retained destination tombstones`)
  if (value.kind !== STATE_KIND || !SHA256.test(value.fingerprint ?? '') || documentFingerprint(value) !== value.fingerprint) fail('Publisher managed state fingerprint is invalid')
  for (const [key, digest] of Object.entries(destinations)) if (key.length > 300 || !SHA256.test(digest)) fail('Publisher managed state destination is invalid')
  return { state: { kind: STATE_KIND, destinations: { ...destinations }, fingerprint: value.fingerprint }, identity, source }
}
function stateSnapshot(read) {
  return { presence: read.source === undefined ? 'absent' : 'present', identity: read.identity ?? null, fingerprint: read.state.fingerprint }
}
function stateSource(state) { return `${JSON.stringify(state, null, 2)}\n` }
function nextStateSnapshot(state) {
  const source = stateSource(state)
  return { fingerprint: state.fingerprint, sha256: sha256(source) }
}
function matchesExactStateSnapshot(read, expected) {
  return canonicalJson(stateSnapshot(read)) === canonicalJson(expected)
}
function matchesNextStateSnapshot(read, expected) {
  return read.source !== undefined && read.state.fingerprint === expected.fingerprint && sha256(read.source) === expected.sha256
}
function assertExactStateSnapshot(read, expected) {
  if (!matchesExactStateSnapshot(read, expected)) fail('Publisher managed state became stale before atomic replacement')
}
function assertNextStateSnapshot(read, expected) {
  if (!matchesNextStateSnapshot(read, expected)) fail('Publisher managed state does not match the durably reserved next state')
}
function seedAndCheckState(state, parsed, changes) {
  const destinations = { ...state.destinations }
  for (const descriptor of PUBLISHER_ROWS) {
    const found = parsed.found.get(descriptor.rowId)
    const raw = found.migrationRequired
      ? normalizePublisherConfig(descriptor.kind, found.rawConfig, { allowLegacyCredentialRefs: true })
      : found.row.config
    for (const destination of raw.destinations) {
      const key = stateKey(descriptor.rowId, destination.id)
      const digests = identityDigests(destination, descriptor.rowId)
      if (destinations[key] !== undefined && ![digests.current, digests.legacy].includes(destinations[key])) fail(`Destination id ${descriptor.rowId}:${destination.id} was previously used by a different immutable identity`)
      destinations[key] = digests.current
    }
  }
  for (const change of changes) for (const destination of change.config.destinations) {
    const key = stateKey(change.rowId, destination.id)
    const digests = identityDigests(destination, change.rowId)
    if (destinations[key] !== undefined && ![digests.current, digests.legacy].includes(destinations[key])) fail(`Retired destination id ${change.rowId}:${destination.id} cannot be reused with a different identity`)
    destinations[key] = digests.current
  }
  if (Object.keys(destinations).length > MAX_STATE_DESTINATIONS) fail(`Publisher managed state cannot retain more than ${MAX_STATE_DESTINATIONS} destination tombstones; no ids were pruned`)
  const body = { kind: STATE_KIND, destinations }
  const next = { ...body, fingerprint: documentFingerprint(body) }
  if (Buffer.byteLength(`${JSON.stringify(next, null, 2)}\n`, 'utf8') > MAX_STATE_BYTES) fail('Publisher managed state would exceed the 2 MiB fail-closed limit; no ids were pruned')
  return next
}
function enforceImmutableIdentity(oldConfig, nextConfig, rowId) {
  const oldById = new Map(oldConfig.destinations.map(destination => [destination.id, destination]))
  for (const destination of nextConfig.destinations) {
    const previous = oldById.get(destination.id)
    if (previous && operational(previous, rowId) !== operational(destination, rowId)) fail(`Operational changes for ${rowId}:${destination.id} require a new immutable destination id and retirement of the old id`)
  }
}

export function validatePublisherChangePlan(input, currentDocument, options = {}) {
  const value = object(input, 'Change plan')
  const legacy = value.kind === LEGACY_PUBLISHER_CHANGE_PLAN_KIND
  exact(value, legacy ? LEGACY_PLAN_FIELDS : PLAN_FIELDS, 'Change plan')
  if (!legacy && value.kind !== PUBLISHER_CHANGE_PLAN_KIND) fail('Change plan kind is invalid')
  if (options.requireV2 === true && legacy) fail('Dashboard Profile apply requires a v2 change plan')
  safeProfileName(value.profile); canonicalIso(value.createdAt, 'createdAt')
  if (!SHA256.test(value.expectedProfileHash ?? '') || !SHA256.test(value.fingerprint ?? '') || documentFingerprint(value) !== value.fingerprint) fail('Change plan fingerprint is invalid')
  if (!legacy && !SHA256.test(value.expectedDocumentRevision ?? '')) fail('Change plan expectedDocumentRevision is invalid')
  if (currentDocument && value.profile !== currentDocument.profile) fail('Change plan targets a different Profile')
  // V2 is a partial row-replacement protocol: every changed row is bound by
  // expectedRowRevision, while all untouched rows are rendered from the latest
  // source. Whole-file and whole-document hashes can change because unrelated
  // source/workflow settings or a different publisher row changed; rejecting
  // those would discard a valid edit without improving CAS safety. Preparation
  // and commit still pin the exact patch/directory/state identities. Legacy V1
  // has no row CAS, so it retains the original whole-file hash requirement.
  if (currentDocument && legacy && value.expectedProfileHash !== currentDocument.profileHash) fail('Change plan has a stale Profile hash')
  if (!Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 4) fail('Change plan must contain one to four complete row replacements')
  const currentRows = new Map(currentDocument?.rows.map(row => [row.rowId, row]) ?? [])
  const seen = new Set()
  const changes = value.changes.map((raw, index) => {
    const change = object(raw, `changes[${index}]`)
    exact(change, legacy ? ['rowId', 'disabled', 'config', 'configRevision'] : ['rowId', 'expectedRowRevision', 'disabled', 'config', 'configRevision'], `changes[${index}]`)
    const descriptor = publisherRow(change.rowId)
    if (!descriptor || seen.has(change.rowId) || typeof change.disabled !== 'boolean') fail(`changes[${index}] is invalid`)
    seen.add(change.rowId); const config = normalizePublisherConfig(descriptor.kind, change.config)
    if (config.destinations.some(destination => Object.entries(destination).some(([key, credential]) => /Credential$/u.test(key) && credential === 'MIGRATION_REQUIRED'))) {
      fail(`changes[${index}] must replace migration placeholders with valid Credential Refs`)
    }
    const configRevision = publisherConfigRevision(descriptor.kind, config)
    if (change.configRevision !== configRevision) fail(`changes[${index}] configRevision is invalid`)
    const prior = currentRows.get(change.rowId)
    if (!legacy && (!SHA256.test(change.expectedRowRevision ?? '') || (prior && prior.rowRevision !== change.expectedRowRevision))) fail(`changes[${index}] has a stale row revision`)
    if (prior?.migrationRequired) {
      const legacyIds = new Set(prior.config.destinations.map(destination => destination.id))
      if (config.destinations.some(destination => legacyIds.has(destination.id))) fail(`Migration-required ${change.rowId} destinations must be replaced with new ids and valid Credential Refs`)
    } else if (prior) enforceImmutableIdentity(prior.config, config, change.rowId)
    return { rowId: change.rowId, ...(legacy ? {} : { expectedRowRevision: change.expectedRowRevision }), disabled: change.disabled, config, configRevision }
  })
  return { ...value, changes }
}

function assertSafeLocalRoot(root) { assertNoLinksTo(resolve(root), `Local destination root ${root}`, 'directory') }
export function preflightPublisherChangePlan(plan, currentDocument) {
  const validated = validatePublisherChangePlan(plan, currentDocument)
  const checks = []
  for (const change of validated.changes) {
    if (change.rowId === 'prismflow-publisher-local-markdown' && !change.disabled) {
      for (const destination of change.config.destinations) { assertSafeLocalRoot(destination.root); checks.push({ rowId: change.rowId, destinationId: destination.id, check: 'local-root-readable' }) }
    }
    for (const destination of change.config.destinations) {
      const refs = Object.entries(destination).filter(([key]) => /Credential$/u.test(key)).map(([, value]) => value)
      if (refs.length) checks.push({ rowId: change.rowId, destinationId: destination.id, check: 'credential-reference-syntax', count: refs.length })
    }
  }
  return { valid: true, networkRequests: 0, destinationWrites: 0, checks }
}

function linuxProcessStartIdentity(pid) {
  if (process.platform !== 'linux') return undefined
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/u)
    return /^\d+$/u.test(fields[19] ?? '') ? `linux-proc-start-ticks:${fields[19]}` : undefined
  } catch { return undefined }
}
const CURRENT_PROCESS_START_IDENTITY = linuxProcessStartIdentity(process.pid)
  ?? `process-start-epoch-ms:${Math.max(0, Math.round(Date.now() - process.uptime() * 1000))}`

function validLockOwner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== LOCK_OWNER_FIELDS.length
    || !LOCK_OWNER_FIELDS.every(field => Object.hasOwn(value, field)) || typeof value.hostname !== 'string' || value.hostname.length < 1 || value.hostname.length > 255
    || !Number.isInteger(value.pid) || value.pid < 1 || typeof value.processStartIdentity !== 'string' || value.processStartIdentity.length < 1 || value.processStartIdentity.length > 128
    || typeof value.nonce !== 'string' || !/^[a-f0-9-]{36}$/u.test(value.nonce) || typeof value.createdAt !== 'string'
    || !CANONICAL_ISO.test(value.createdAt) || new Date(value.createdAt).toISOString() !== value.createdAt) return undefined
  return value
}
function readLock(path, label) {
  const read = readRegularFile(path, label)
  let owner
  try { owner = validLockOwner(JSON.parse(read.source)) } catch { owner = undefined }
  if (!owner) fail(`${label} owner is missing, malformed, or unreadable; inspect it manually`)
  return { ...read, owner }
}
function sameLockOwner(left, right) {
  return LOCK_OWNER_FIELDS.every(field => left?.[field] === right?.[field])
}
function processIsAbsentOrReused(owner) {
  if (owner.hostname !== hostname()) return false
  try { process.kill(owner.pid, 0) } catch (error) { return error?.code === 'ESRCH' }
  const observed = owner.pid === process.pid ? CURRENT_PROCESS_START_IDENTITY : linuxProcessStartIdentity(owner.pid)
  return observed !== undefined && observed !== owner.processStartIdentity
}
function writeFsyncedExclusive(path, content) {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  const fd = openSync(path, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) }
}
function publishLock(path, owner, profileDir) {
  const candidate = `${path}.candidate-${owner.nonce}`
  try {
    writeFsyncedExclusive(candidate, `${JSON.stringify(owner)}\n`)
    linkSync(candidate, path)
    rmSync(candidate)
    fsyncDirectory(profileDir)
    return fileIdentity(statSync(path))
  } finally { rmSync(candidate, { force: true }) }
}
function removeExactLock(path, expected, profileDir, label) {
  if (!existsSync(path)) return false
  const current = readLock(path, label)
  if (!sameLockOwner(current.owner, expected.owner) || current.identity !== expected.identity) return false
  const confirmed = readLock(path, label)
  if (!sameLockOwner(confirmed.owner, expected.owner) || confirmed.identity !== expected.identity) return false
  rmSync(path)
  fsyncDirectory(profileDir)
  return true
}
function acquireRecoveryLock(lockDir, path, owner, label) {
  const recoveryPath = `${path}.recovery`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const identity = publishLock(recoveryPath, owner, lockDir)
      const expected = { owner, identity }
      return () => { if (!removeExactLock(recoveryPath, expected, lockDir, `${label} recovery lock`)) fail(`${label} recovery lock ownership changed`) }
    } catch (error) {
      if (!['EEXIST', 'EACCES', 'EPERM'].includes(error?.code)) throw error
      const existing = readLock(recoveryPath, `${label} recovery lock`)
      if (!processIsAbsentOrReused(existing.owner)) fail(`${label} stale recovery is held by an active or unverifiable process`)
      if (!removeExactLock(recoveryPath, existing, lockDir, `${label} recovery lock`)) continue
    }
  }
  fail(`${label} stale recovery lock could not be acquired`)
}
function acquirePathLock(lockDir, path, owner, label) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const identity = publishLock(path, owner, lockDir)
      const expected = { owner, identity }
      return () => { if (!removeExactLock(path, expected, lockDir, `${label} lock`)) fail(`${label} lock ownership changed before release`) }
    } catch (error) {
      if (!['EEXIST', 'EACCES', 'EPERM'].includes(error?.code)) throw error
      const existing = readLock(path, `${label} lock`)
      if (!processIsAbsentOrReused(existing.owner)) fail(`${label} is locked by active or unverifiable PID ${existing.owner.pid}`)
      const recoveryOwner = { ...owner, nonce: randomUUID(), createdAt: new Date().toISOString() }
      const releaseRecovery = acquireRecoveryLock(lockDir, path, recoveryOwner, label)
      try {
        const confirmed = readLock(path, `${label} lock`)
        if (!sameLockOwner(confirmed.owner, existing.owner) || confirmed.identity !== existing.identity) continue
        if (!processIsAbsentOrReused(confirmed.owner)) fail(`${label} lock became active while recovering PID ${confirmed.owner.pid}`)
        removeExactLock(path, confirmed, lockDir, `${label} lock`)
      } finally { releaseRecovery() }
    }
  }
  fail(`${label} lock could not be acquired`)
}
function acquireLock(profileDir) {
  const directoryIdentity = captureDirectoryIdentity(profileDir, 'Named DSH Profile')
  const profilesRoot = dirname(profileDir)
  assertNoLinksTo(profilesRoot, 'DSH profiles directory', 'directory')
  const owner = { hostname: hostname(), pid: process.pid, processStartIdentity: CURRENT_PROCESS_START_IDENTITY,
    nonce: randomUUID(), createdAt: new Date().toISOString() }
  // The stable parent lock prevents a renamed/replaced Profile directory from admitting a second manager.
  const coordinationPath = join(profilesRoot, `.prismflow-publisher-profile-${basename(profileDir)}.lock`)
  const releaseCoordination = acquirePathLock(profilesRoot, coordinationPath, owner, 'Publisher Profile coordination')
  let releaseLocal
  try { releaseLocal = acquirePathLock(profileDir, join(profileDir, LOCK_FILE), owner, 'Publisher Profile') }
  catch (error) { releaseCoordination(); throw error }
  const guard = {
    assertIdentity() { assertDirectoryIdentity(profileDir, directoryIdentity) },
    release() {
      let localError
      try { releaseLocal() } catch (error) { localError = error }
      try { releaseCoordination() } catch (error) { if (!localError) localError = error }
      if (localError) throw localError
    },
  }
  guard.assertIdentity()
  return guard
}
function pruneBackups(location, targetPath, keep) {
  const prefix = `${basename(targetPath)}.backup-`
  const entries = readdirSync(location.profileDir).filter(name => name.startsWith(prefix)).map(name => {
    const path = join(location.profileDir, name)
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isFile()) fail(`Profile backup set for ${basename(targetPath)} contains an unsafe entry`)
    return { path, mtimeMs: info.mtimeMs, name }
  }).sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name))
  for (const entry of entries.slice(keep)) rmSync(entry.path)
  if (entries.length > keep) fsyncDirectory(location.profileDir)
}
function atomicBackup(location, targetPath, source) {
  const candidate = join(location.profileDir, `.prismflow-backup-candidate-${randomUUID()}`)
  const backup = `${targetPath}.backup-${randomUUID()}`
  try {
    writeFsyncedExclusive(candidate, source)
    if (existsSync(backup)) fail('Exclusive Profile backup name collision')
    renameSync(candidate, backup)
    fsyncDirectory(location.profileDir)
    return backup
  } finally { rmSync(candidate, { force: true }) }
}

function renderPublisherPatch(source, parsed, plan) {
  const changesById = new Map(plan.changes.map(change => [change.rowId, change]))
  for (const descriptor of PUBLISHER_ROWS) {
    const found = parsed.found.get(descriptor.rowId)
    const effective = changesById.get(descriptor.rowId) ?? found.row
    if (found.node) {
      found.node.set('disabled', effective.disabled)
      found.node.set('config', effective.config)
    } else {
      parsed.document.contents.add({ id: descriptor.rowId, disabled: effective.disabled, config: effective.config })
    }
  }
  let output = String(parsed.document)
  if (source.includes('\r\n')) output = output.replace(/(?<!\r)\n/gu, '\r\n')
  return output
}

function emptyOperations() {
  const body = { kind: OPERATION_STATE_KIND, operations: {} }
  return { ...body, fingerprint: documentFingerprint(body) }
}
function normalizedOperationRequest(value) {
  const request = object(value, 'Publisher operation request')
  exact(request, ['confirmPauseUntilRestart', 'plan'], 'Publisher operation request')
  if (request.confirmPauseUntilRestart !== true) fail('Publisher operation request confirmation is invalid')
  return { confirmPauseUntilRestart: true, plan: validatePublisherChangePlan(request.plan, undefined, { requireV2: true }) }
}
function readOperations(location) {
  if (!existsSync(location.operationPath)) return emptyOperations()
  const { source } = readRegularFile(location.operationPath, 'Publisher operation state')
  if (Buffer.byteLength(source, 'utf8') > MAX_OPERATION_BYTES) fail('Publisher operation state exceeds its 1 MiB fail-closed limit')
  let value
  try { value = JSON.parse(source) } catch { fail('Publisher operation state is malformed') }
  object(value, 'Publisher operation state'); exact(value, ['kind', 'operations', 'fingerprint'], 'Publisher operation state')
  const operations = object(value.operations, 'Publisher operation records')
  if (value.kind !== OPERATION_STATE_KIND || Object.keys(operations).length > MAX_OPERATIONS
    || !SHA256.test(value.fingerprint ?? '') || documentFingerprint(value) !== value.fingerprint) fail('Publisher operation state is invalid')
  for (const [id, record] of Object.entries(operations)) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail('Publisher operation record is invalid')
    const fields = record.phase === undefined && record.request === undefined ? LEGACY_OPERATION_RECORD_FIELDS
      : record.preconditions === undefined ? RECOVERY_OPERATION_RECORD_FIELDS : OPERATION_RECORD_FIELDS
    exact(record, fields, 'Publisher operation record')
    if (!OPERATION_ID.test(id) || record.operationId !== id || !SHA256.test(record.digest ?? '') || !PROFILE_NAME.test(record.profile ?? '')
      || !SHA256.test(record.oldProfileHash ?? '') || !SHA256.test(record.newProfileHash ?? '') || !SHA256.test(record.oldDocumentRevision ?? '')
      || !SHA256.test(record.newDocumentRevision ?? '') || !record.revisions || typeof record.revisions !== 'object' || Array.isArray(record.revisions)
      || Object.keys(record.revisions).length !== PUBLISHER_ROWS.length
      || Object.entries(record.revisions).some(([rowId, revision]) => {
        if (!publisherRow(rowId) || !revision || typeof revision !== 'object' || Array.isArray(revision)) return true
        exact(revision, OPERATION_REVISION_FIELDS, 'Publisher operation row revision')
        return !SHA256.test(revision.oldRowRevision ?? '') || !SHA256.test(revision.rowRevision ?? '') || !SHA256.test(revision.configRevision ?? '')
      }) || !['pending', 'completed', 'cancelled'].includes(record.status) || !CANONICAL_ISO.test(record.createdAt ?? '') || !CANONICAL_ISO.test(record.updatedAt ?? '')) {
      fail('Publisher operation record is invalid')
    }
    if ((record.phase === undefined) !== (record.request === undefined)
      || (record.phase !== undefined && !['prepared', 'draining'].includes(record.phase))) fail('Publisher operation recovery metadata is invalid')
    if (record.request !== undefined) record.request = normalizedOperationRequest(record.request)
    if (record.preconditions !== undefined) {
      const preconditions = object(record.preconditions, 'Publisher operation preconditions')
      const hasDrainCas = preconditions.profileDirectory !== undefined || preconditions.patch !== undefined
      exact(preconditions, hasDrainCas ? OPERATION_PRECONDITION_FIELDS : LEGACY_OPERATION_PRECONDITION_FIELDS, 'Publisher operation preconditions')
      if (hasDrainCas) {
        const profileDirectory = object(preconditions.profileDirectory, 'Publisher operation Profile directory precondition')
        exact(profileDirectory, PROFILE_DIRECTORY_SNAPSHOT_FIELDS, 'Publisher operation Profile directory precondition')
        const patch = object(preconditions.patch, 'Publisher operation patch precondition')
        exact(patch, PATCH_SNAPSHOT_FIELDS, 'Publisher operation patch precondition')
        const nextState = object(preconditions.nextState, 'Publisher operation next state precondition')
        exact(nextState, NEXT_STATE_SNAPSHOT_FIELDS, 'Publisher operation next state precondition')
        if (typeof profileDirectory.identity !== 'string' || profileDirectory.identity.length < 1 || profileDirectory.identity.length > 200
          || typeof patch.identity !== 'string' || patch.identity.length < 1 || patch.identity.length > 200 || !SHA256.test(patch.sha256 ?? '')
          || !SHA256.test(nextState.fingerprint ?? '') || !SHA256.test(nextState.sha256 ?? '')) {
          fail('Publisher operation drain preconditions are invalid')
        }
      }
      if (!Array.isArray(preconditions.overlays) || preconditions.overlays.length !== OVERLAY_CANDIDATES.length) fail('Publisher operation overlay preconditions are invalid')
      const candidates = new Set()
      for (const raw of preconditions.overlays) {
        const overlay = object(raw, 'Publisher operation overlay precondition')
        exact(overlay, OVERLAY_SNAPSHOT_FIELDS, 'Publisher operation overlay precondition')
        if (!OVERLAY_CANDIDATES.some(item => item.candidate === overlay.candidate) || candidates.has(overlay.candidate)
          || !['absent', 'present'].includes(overlay.presence)
          || (overlay.presence === 'absent' && (overlay.identity !== null || overlay.sha256 !== null))
          || (overlay.presence === 'present' && (typeof overlay.identity !== 'string' || overlay.identity.length < 1 || overlay.identity.length > 200 || !SHA256.test(overlay.sha256 ?? '')))) {
          fail('Publisher operation overlay preconditions are invalid')
        }
        candidates.add(overlay.candidate)
      }
      const state = object(preconditions.state, 'Publisher operation state precondition')
      exact(state, STATE_SNAPSHOT_FIELDS, 'Publisher operation state precondition')
      if (!['absent', 'present'].includes(state.presence) || !SHA256.test(state.fingerprint ?? '')
        || (state.presence === 'absent' && state.identity !== null)
        || (state.presence === 'present' && (typeof state.identity !== 'string' || state.identity.length < 1 || state.identity.length > 200))) {
        fail('Publisher operation state precondition is invalid')
      }
    }
    canonicalIso(record.createdAt, 'Publisher operation createdAt')
    canonicalIso(record.updatedAt, 'Publisher operation updatedAt')
  }
  return { kind: OPERATION_STATE_KIND, operations: structuredClone(operations), fingerprint: value.fingerprint }
}
function operationStateSource(operations) {
  const body = { kind: OPERATION_STATE_KIND, operations }
  const value = { ...body, fingerprint: documentFingerprint(body) }
  return { value, source: `${JSON.stringify(value)}\n` }
}
function writeOperations(location, state) {
  const operations = structuredClone(state.operations)
  const oldestCompleted = () => Object.values(operations).filter(record => record.status !== 'pending')
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.operationId.localeCompare(right.operationId))[0]
  const projectedBytes = () => {
    const projected = Object.fromEntries(Object.entries(operations).map(([id, record]) => [id,
      record.status === 'pending' ? { ...record, status: 'completed' } : record]))
    return Buffer.byteLength(operationStateSource(projected).source, 'utf8')
  }
  while (Object.keys(operations).length > MAX_OPERATIONS) {
    const oldest = oldestCompleted()
    if (!oldest) fail('Too many unresolved Publisher Profile operations require recovery')
    delete operations[oldest.operationId]
  }
  let rendered = operationStateSource(operations)
  while (Buffer.byteLength(rendered.source, 'utf8') > MAX_OPERATION_BYTES || projectedBytes() > MAX_OPERATION_BYTES) {
    const oldest = oldestCompleted()
    if (!oldest) fail('Publisher operation state cannot preserve every pending operation below its 1 MiB limit')
    delete operations[oldest.operationId]
    rendered = operationStateSource(operations)
  }
  state.operations = structuredClone(operations)
  const candidate = `${location.operationPath}.candidate-${randomUUID()}`
  try {
    writeFsyncedExclusive(candidate, rendered.source)
    renameSync(candidate, location.operationPath)
    fsyncDirectory(location.profileDir)
  } finally { rmSync(candidate, { force: true }) }
  return rendered.value
}
function operationResult(record, replayed = false, recoveryState) {
  return { operationId: record.operationId, status: record.status, replayed,
    restartRequired: record.status === 'cancelled' ? false : true,
    ...(record.phase ? { phase: record.phase } : {}), ...(recoveryState ? { recoveryState } : {}),
    previousProfileHash: record.oldProfileHash, profileHash: record.newProfileHash,
    previousDocumentRevision: record.oldDocumentRevision, documentRevision: record.newDocumentRevision,
    revisions: structuredClone(record.revisions) }
}
function operationDigest(plan) { return sha256(canonicalJson({ confirmPauseUntilRestart: true, plan })) }
function pendingHashState(location, record) {
  const currentHash = sha256(readRegularFile(location.patchPath, 'Profile patch').source)
  if (currentHash === record.newProfileHash) return 'new-hash'
  if (currentHash === record.oldProfileHash) return record.phase === 'prepared' ? 'old-hash-pre-drain'
    : record.phase === 'draining' ? 'old-hash-after-drain-started' : 'old-hash-legacy-ambiguous-phase'
  return 'ambiguous-hash'
}
function pendingStatePublication(location, record) {
  const read = readState(location)
  if (matchesExactStateSnapshot(read, record.preconditions.state)) return 'old-state'
  if (matchesNextStateSnapshot(read, record.preconditions.nextState)) return 'next-state'
  return 'state-mismatch'
}
function recoverCompletedOperation(location, operations, record, now = new Date(), guard) {
  if (record.status !== 'pending') return record
  guard?.assertIdentity()
  const recoveryState = pendingHashState(location, record)
  if (recoveryState === 'new-hash') {
    if (!record.preconditions?.nextState) fail('Publisher Profile operation lacks a durable expected next-state identity')
    assertNextStateSnapshot(readState(location), record.preconditions.nextState)
    const completed = { ...record, status: 'completed', updatedAt: now.toISOString() }
    operations.operations[record.operationId] = completed
    guard?.assertIdentity()
    writeOperations(location, operations)
    return completed
  }
  return record
}
function assertNoOtherPending(operations, operationId) {
  const pending = Object.values(operations.operations).find(record => record.status === 'pending' && record.operationId !== operationId)
  if (pending) fail(`Publisher Profile operation ${pending.operationId} is pending recovery`)
}
function operationMetadata(profile, operationId, request, current, next, preconditions, now) {
  const oldRows = new Map(current.rows.map(row => [row.rowId, row]))
  const revisions = Object.fromEntries(next.rows.map(row => [row.rowId, { oldRowRevision: oldRows.get(row.rowId).rowRevision,
    rowRevision: row.rowRevision, configRevision: row.configRevision }]))
  return { operationId, digest: operationDigest(request.plan), profile, oldProfileHash: current.profileHash, newProfileHash: next.profileHash,
    oldDocumentRevision: current.documentRevision, newDocumentRevision: next.documentRevision, revisions,
    status: 'pending', phase: 'prepared', request, preconditions, createdAt: now.toISOString(), updatedAt: now.toISOString() }
}

/** Validate, preflight and durably reserve an idempotent direct operation before maintenance begins. */
export function preparePublisherProfileOperation(profile, operationId, input, options = {}) {
  if (!OPERATION_ID.test(operationId ?? '')) fail('operationId must be a canonical lowercase UUID')
  const request = normalizedOperationRequest({ confirmPauseUntilRestart: true, plan: input })
  const digest = operationDigest(request.plan)
  const location = resolveNamedProfile(profile, options.home)
  const lock = acquireLock(location.profileDir)
  try {
    lock.assertIdentity()
    const locked = resolveNamedProfile(profile, options.home)
    lock.assertIdentity()
    const operations = readOperations(locked)
    let existing = operations.operations[operationId]
    if (existing) {
      if (existing.digest !== digest || existing.profile !== profile) fail('operationId was already used for a different Publisher Profile request')
      existing = recoverCompletedOperation(locked, operations, existing, options.now ?? new Date(), lock)
      if (existing.status === 'completed') return { replayed: true, result: operationResult(existing, true) }
      if (existing.status === 'cancelled') fail('operationId belongs to a cancelled Publisher Profile request')
      return { replayed: false, pending: true, digest, phase: existing.phase }
    }
    assertNoOtherPending(operations, operationId)
    lock.assertIdentity()
    const directorySnapshot = profileDirectorySnapshot(locked)
    const overlaySnapshot = captureHigherPrecedenceOverlays(locked)
    const patchRead = readRegularFile(locked.patchPath, 'Profile patch')
    const source = patchRead.source
    const parsed = parsePublisherRows(source)
    const current = documentFrom(profile, source, parsed, options.now ?? new Date())
    const plan = validatePublisherChangePlan(request.plan, current, { requireV2: true })
    if (plan.profile !== profile) fail('Change plan Profile name does not match the pinned Profile')
    preflightPublisherChangePlan(plan, current)
    const stateRead = readState(locked)
    const nextState = seedAndCheckState(stateRead.state, parsed, plan.changes)
    const preconditions = { profileDirectory: directorySnapshot, patch: patchSnapshot(patchRead), overlays: overlaySnapshot,
      state: stateSnapshot(stateRead), nextState: nextStateSnapshot(nextState) }
    const normalizedRequest = { confirmPauseUntilRestart: true, plan }
    const output = renderPublisherPatch(source, parsed, plan)
    const next = documentFrom(profile, output, parsePublisherRows(output), options.now ?? new Date())
    const now = options.now ?? new Date()
    operations.operations[operationId] = operationMetadata(profile, operationId, normalizedRequest, current, next, preconditions, now)
    lock.assertIdentity()
    writeOperations(locked, operations)
    return { replayed: false, pending: true, digest, phase: 'prepared' }
  } finally { lock.release() }
}

/** Durably mark the exact reserved request as draining before any admission authority is paused. */
export function beginPublisherProfileOperationDrain(profile, operationId, options = {}) {
  if (!OPERATION_ID.test(operationId ?? '')) fail('operationId must be a canonical lowercase UUID')
  const location = resolveNamedProfile(profile, options.home)
  const lock = acquireLock(location.profileDir)
  try {
    lock.assertIdentity()
    const locked = resolveNamedProfile(profile, options.home)
    lock.assertIdentity()
    const operations = readOperations(locked)
    const pending = Object.values(operations.operations).find(candidate => candidate.status === 'pending' && candidate.profile === profile)
    if (!pending || pending.operationId !== operationId) fail('Pending Publisher Profile operationId is stale; reload the current pending operation')
    let record = recoverCompletedOperation(locked, operations, pending, options.now ?? new Date(), lock)
    if (record.status === 'completed') return { operation: operationResult(record, true) }
    if (!record.request) fail('Legacy pending Publisher Profile operation has no durable request and cannot be resumed automatically')
    if (!record.preconditions?.profileDirectory || !record.preconditions?.patch || !record.preconditions?.nextState) fail('Pending Publisher Profile operation lacks durable drain CAS preconditions and cannot be resumed automatically')
    const recoveryState = pendingHashState(locked, record)
    if (recoveryState === 'ambiguous-hash') fail('A pending Publisher Profile operation has an ambiguous Profile outcome; recover it before resuming')
    lock.assertIdentity()
    assertExactProfileDirectorySnapshot(locked, record.preconditions.profileDirectory)
    assertExactPatchSnapshot(locked, record.preconditions.patch)
    assertExactHigherPrecedenceOverlays(locked, record.preconditions.overlays)
    const statePublication = pendingStatePublication(locked, record)
    if (statePublication === 'state-mismatch' || (record.phase === 'prepared' && statePublication !== 'old-state')) {
      fail('Publisher managed state became stale and does not match an allowed operation recovery boundary')
    }
    lock.assertIdentity()
    if (record.phase === 'prepared') {
      record = { ...record, phase: 'draining', updatedAt: (options.now ?? new Date()).toISOString() }
      operations.operations[record.operationId] = record
      writeOperations(locked, operations)
    }
    return { operation: operationResult(record, false, recoveryState), request: structuredClone(record.request) }
  } finally { lock.release() }
}

export function getPendingPublisherProfileOperation(profile, options = {}) {
  const location = resolveNamedProfile(profile, options.home)
  const lock = acquireLock(location.profileDir)
  try {
    lock.assertIdentity()
    const operations = readOperations(location)
    const pending = Object.values(operations.operations).find(record => record.status === 'pending' && record.profile === profile)
    if (!pending) return undefined
    const record = recoverCompletedOperation(location, operations, pending, options.now ?? new Date(), lock)
    if (record.status !== 'pending') return undefined
    const recoveryState = pendingHashState(location, record)
    let statePublication = 'state-mismatch'
    if (record.preconditions?.state && record.preconditions?.nextState) statePublication = pendingStatePublication(location, record)
    const allowedState = statePublication === 'old-state' || (record.phase === 'draining' && statePublication === 'next-state')
    return { ...operationResult(record, false, recoveryState),
      canResume: !!record.request && !!record.preconditions?.profileDirectory && !!record.preconditions?.patch
        && recoveryState !== 'ambiguous-hash' && allowedState,
      canCancel: record.phase === 'prepared' && recoveryState === 'old-hash-pre-drain' }
  } finally { lock.release() }
}

export function cancelPendingPublisherProfileOperation(profile, operationIdOrOptions = {}, maybeOptions = {}) {
  const operationId = typeof operationIdOrOptions === 'string' ? operationIdOrOptions : undefined
  const options = typeof operationIdOrOptions === 'string' ? maybeOptions : operationIdOrOptions
  if (operationId !== undefined && !OPERATION_ID.test(operationId)) fail('operationId must be a canonical lowercase UUID')
  const location = resolveNamedProfile(profile, options.home)
  const lock = acquireLock(location.profileDir)
  try {
    lock.assertIdentity()
    const operations = readOperations(location)
    const pending = Object.values(operations.operations).find(record => record.status === 'pending' && record.profile === profile)
    if (!pending) return undefined
    if (operationId !== undefined && pending.operationId !== operationId) fail('Pending Publisher Profile operationId is stale; reload the current pending operation')
    const record = recoverCompletedOperation(location, operations, pending, options.now ?? new Date(), lock)
    if (record.status !== 'pending') fail('Publisher Profile operation already reached the new Profile hash and cannot be cancelled')
    const recoveryState = pendingHashState(location, record)
    if (record.phase !== 'prepared' || recoveryState !== 'old-hash-pre-drain') {
      fail('Publisher Profile operation can be cancelled only while definitively pre-drain at the old Profile hash')
    }
    const cancelled = { ...record, status: 'cancelled', updatedAt: (options.now ?? new Date()).toISOString() }
    operations.operations[record.operationId] = cancelled
    lock.assertIdentity()
    writeOperations(location, operations)
    return operationResult(cancelled, false, recoveryState)
  } finally { lock.release() }
}

/** Commit a previously reserved operation after the caller has drained all admission authorities. */
export function commitPublisherProfileOperation(profile, operationId, input, options = {}) {
  if (!OPERATION_ID.test(operationId ?? '')) fail('operationId must be a canonical lowercase UUID')
  const request = normalizedOperationRequest({ confirmPauseUntilRestart: true, plan: input })
  const digest = operationDigest(request.plan)
  const location = resolveNamedProfile(profile, options.home)
  const lock = acquireLock(location.profileDir)
  let patchCandidate
  let stateCandidate
  try {
    lock.assertIdentity()
    const locked = resolveNamedProfile(profile, options.home)
    lock.assertIdentity()
    const operations = readOperations(locked)
    let record = operations.operations[operationId]
    if (!record || record.digest !== digest || record.profile !== profile) fail('Publisher Profile operation reservation does not match this request')
    record = recoverCompletedOperation(locked, operations, record, options.now ?? new Date(), lock)
    if (record.status === 'completed') return operationResult(record, true)
    if (record.status !== 'pending' || !record.request) fail('Publisher Profile operation must have a durable request before commit')
    if (!record.preconditions?.profileDirectory || !record.preconditions?.patch || !record.preconditions?.nextState) {
      fail('Publisher Profile operation lacks durable preparation preconditions and cannot be committed')
    }
    if (pendingHashState(locked, record) === 'ambiguous-hash') fail('A pending Publisher Profile operation has an ambiguous Profile outcome; recover it before commit')
    if (record.phase !== 'draining') fail('Publisher Profile operation must be durably marked draining before commit')
    assertNoOtherPending(operations, operationId)

    // A drained commit may derive only from the exact directory and patch reserved before admission paused.
    lock.assertIdentity()
    assertExactProfileDirectorySnapshot(locked, record.preconditions.profileDirectory)
    assertExactHigherPrecedenceOverlays(locked, record.preconditions.overlays)
    const patchRead = readExactPatchSnapshot(locked, record.preconditions.patch)
    const stateRead = readState(locked)
    const statePublication = matchesExactStateSnapshot(stateRead, record.preconditions.state) ? 'old-state'
      : matchesNextStateSnapshot(stateRead, record.preconditions.nextState) ? 'next-state' : 'state-mismatch'
    if (statePublication === 'state-mismatch') fail('Publisher managed state became stale and does not match an allowed operation recovery boundary')

    const source = patchRead.source
    const parsed = parsePublisherRows(source)
    const current = documentFrom(profile, source, parsed, options.now ?? new Date())
    const plan = validatePublisherChangePlan(record.request.plan, current, { requireV2: true })
    preflightPublisherChangePlan(plan, current)
    const nextState = seedAndCheckState(stateRead.state, parsed, plan.changes)
    if (canonicalJson(nextStateSnapshot(nextState)) !== canonicalJson(record.preconditions.nextState)) {
      fail('Reserved Publisher Profile operation no longer renders the same managed state')
    }
    const output = renderPublisherPatch(source, parsed, plan)
    const next = documentFrom(profile, output, parsePublisherRows(output), options.now ?? new Date())
    if (next.profileHash !== record.newProfileHash || next.documentRevision !== record.newDocumentRevision) fail('Reserved Publisher Profile operation no longer renders the same result')
    patchCandidate = `${locked.patchPath}.candidate-${randomUUID()}`
    writeFsyncedExclusive(patchCandidate, output)
    if (statePublication === 'old-state') {
      stateCandidate = `${locked.statePath}.candidate-${randomUUID()}`
      writeFsyncedExclusive(stateCandidate, stateSource(nextState))
    }
    pruneBackups(locked, locked.patchPath, RETAINED_BACKUPS_PER_ARTIFACT - 1)
    atomicBackup(locked, locked.patchPath, source)
    if (statePublication === 'old-state' && stateRead.source !== undefined) {
      pruneBackups(locked, locked.statePath, RETAINED_BACKUPS_PER_ARTIFACT - 1)
      atomicBackup(locked, locked.statePath, stateRead.source)
    }

    // Repeat every prepared CAS immediately before crossing the first atomic publication boundary.
    lock.assertIdentity()
    assertExactProfileDirectorySnapshot(locked, record.preconditions.profileDirectory)
    assertExactPatchSnapshot(locked, record.preconditions.patch)
    assertExactHigherPrecedenceOverlays(locked, record.preconditions.overlays)
    if (statePublication === 'old-state') assertExactStateSnapshot(readState(locked), record.preconditions.state)
    else assertNextStateSnapshot(readState(locked), record.preconditions.nextState)
    lock.assertIdentity()
    if (statePublication === 'old-state') {
      renameSync(stateCandidate, locked.statePath); stateCandidate = undefined
      fsyncDirectory(locked.profileDir)
      options.onPowerLossPoint?.('state-rename-directory-fsynced-before-patch-rename')
    }

    // State publication is irreversible. Patch publication requires the same full CAS again on resume or first attempt.
    lock.assertIdentity()
    assertExactProfileDirectorySnapshot(locked, record.preconditions.profileDirectory)
    assertExactPatchSnapshot(locked, record.preconditions.patch)
    assertExactHigherPrecedenceOverlays(locked, record.preconditions.overlays)
    assertNextStateSnapshot(readState(locked), record.preconditions.nextState)
    lock.assertIdentity()
    renameSync(patchCandidate, locked.patchPath); patchCandidate = undefined
    fsyncDirectory(locked.profileDir)
    options.onPowerLossPoint?.('patch-rename-directory-fsynced-before-operation-completion')
    const completed = { ...record, status: 'completed', updatedAt: (options.now ?? new Date()).toISOString() }
    operations.operations[operationId] = completed
    lock.assertIdentity()
    writeOperations(locked, operations)
    return operationResult(completed)
  } finally {
    if (patchCandidate) rmSync(patchCandidate, { force: true })
    if (stateCandidate) rmSync(stateCandidate, { force: true })
    lock.release()
  }
}

export function getPublisherProfileOperation(profile, operationId, options = {}) {
  if (!OPERATION_ID.test(operationId ?? '')) fail('operationId must be a canonical lowercase UUID')
  const location = resolveNamedProfile(profile, options.home)
  const lock = acquireLock(location.profileDir)
  try {
    lock.assertIdentity()
    const operations = readOperations(location)
    let record = operations.operations[operationId]
    if (!record || record.profile !== profile) return undefined
    record = recoverCompletedOperation(location, operations, record, options.now ?? new Date(), lock)
    const recoveryState = record.status === 'pending' ? pendingHashState(location, record) : undefined
    return operationResult(record, false, recoveryState)
  } finally { lock.release() }
}

export function importPublisherChangePlan(profile, input, options = {}) {
  const location = resolveNamedProfile(profile, options.home)
  rejectHigherPrecedenceOverlays(location.homeRoot, location.profileDir)
  const lock = acquireLock(location.profileDir)
  let patchCandidate
  let stateCandidate
  try {
    lock.assertIdentity()
    // Re-resolve every managed artifact only after the cross-process lock is held.
    const lockedLocation = resolveNamedProfile(profile, options.home)
    lock.assertIdentity()
    const operations = readOperations(lockedLocation)
    for (const record of Object.values(operations.operations)) recoverCompletedOperation(lockedLocation, operations, record, options.now ?? new Date(), lock)
    assertNoOtherPending(operations)
    const patchRead = readRegularFile(lockedLocation.patchPath, 'Profile patch')
    const source = patchRead.source
    const parsed = parsePublisherRows(source)
    const current = documentFrom(profile, source, parsed, options.now ?? new Date())
    const plan = validatePublisherChangePlan(input, current)
    if (plan.profile !== profile) fail('Change plan Profile name does not match the selected Profile')
    const stateRead = readState(lockedLocation)
    const nextState = seedAndCheckState(stateRead.state, parsed, plan.changes)
    const output = renderPublisherPatch(source, parsed, plan)
    patchCandidate = `${lockedLocation.patchPath}.candidate-${randomUUID()}`
    stateCandidate = `${lockedLocation.statePath}.candidate-${randomUUID()}`
    writeFsyncedExclusive(patchCandidate, output)
    writeFsyncedExclusive(stateCandidate, `${JSON.stringify(nextState, null, 2)}\n`)
    pruneBackups(lockedLocation, lockedLocation.patchPath, RETAINED_BACKUPS_PER_ARTIFACT - 1)
    atomicBackup(lockedLocation, lockedLocation.patchPath, source)
    if (stateRead.source !== undefined) {
      pruneBackups(lockedLocation, lockedLocation.statePath, RETAINED_BACKUPS_PER_ARTIFACT - 1)
      atomicBackup(lockedLocation, lockedLocation.statePath, stateRead.source)
    }

    // Final CAS closes both path-swap and same-path lost-update windows immediately before replacement.
    lock.assertIdentity()
    const finalLocation = resolveNamedProfile(profile, options.home)
    if (finalLocation.profileDir !== lockedLocation.profileDir || finalLocation.patchPath !== lockedLocation.patchPath || finalLocation.statePath !== lockedLocation.statePath) fail('Profile path changed before atomic replacement')
    const patchNow = readRegularFile(lockedLocation.patchPath, 'Profile patch')
    if (patchNow.identity !== patchRead.identity || sha256(patchNow.source) !== plan.expectedProfileHash) fail('Profile identity or hash became stale before atomic replacement')
    const stateNow = readState(lockedLocation)
    if (stateNow.identity !== stateRead.identity || stateNow.state.fingerprint !== stateRead.state.fingerprint) fail('Publisher managed state became stale before atomic replacement')

    // Tombstones are committed and made directory-durable first: an interruption can conservatively reserve an id,
    // but can never expose the new patch while still permitting unsafe id reuse.
    lock.assertIdentity()
    renameSync(stateCandidate, lockedLocation.statePath); stateCandidate = undefined
    fsyncDirectory(lockedLocation.profileDir)
    options.onPowerLossPoint?.('state-rename-directory-fsynced-before-patch-rename')
    lock.assertIdentity()
    renameSync(patchCandidate, lockedLocation.patchPath); patchCandidate = undefined
    fsyncDirectory(lockedLocation.profileDir)
    const nextDocument = documentFrom(profile, output, parsePublisherRows(output), options.now ?? new Date())
    return { imported: true, restartRequired: true, previousProfileHash: current.profileHash, profileHash: nextDocument.profileHash,
      previousDocumentRevision: current.documentRevision, documentRevision: nextDocument.documentRevision,
      revisions: Object.fromEntries(nextDocument.rows.map(row => [row.rowId, { configRevision: row.configRevision, rowRevision: row.rowRevision }])) }
  } finally {
    if (patchCandidate) rmSync(patchCandidate, { force: true })
    if (stateCandidate) rmSync(stateCandidate, { force: true })
    lock.release()
  }
}
