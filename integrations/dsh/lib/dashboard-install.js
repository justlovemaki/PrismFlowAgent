import { realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'
import { resolveNamedProfile } from './publisher-profile-cli.js'

const DASHBOARD_ID = 'prismflow-dashboard'
const DASHBOARD_MODULE = '@prismflow/dsh/ui'
const LEGACY_DASHBOARD_MODULE = '@prismflow/dsh-dashboard'
const PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/u

function fail(message) { throw new Error(`PrismFlow dashboard installer: ${message}`) }
function samePath(left, right) {
  const a = resolve(left), b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function deriveDashboardProfileBinding(profileDirectory) {
  const profileDir = resolve(profileDirectory)
  const profilesRoot = dirname(profileDir)
  if (basename(profilesRoot) !== 'profiles') fail('Profile directory must use the layout <dshHome>/profiles/<profileName>')
  const dshHome = dirname(profilesRoot)
  const profileName = basename(profileDir)
  if (!PROFILE_NAME.test(profileName)) fail('Profile name is not safe')
  const location = resolveNamedProfile(profileName, dshHome)
  const canonical = realpathSync.native?.(profileDir) ?? realpathSync(profileDir)
  if (!samePath(location.profileDir, profileDir) || !samePath(canonical, location.profileDir)) fail('Profile directory does not match the resolved named Profile')
  return { dshHome: location.homeRoot, profileName }
}

/**
 * Migrate the one exact Dashboard insert row without regex editing. Any alias,
 * conflicting shape, nested occurrence, or duplicate is rejected rather than
 * creating a second plugin instance.
 */
export function configureDashboardRow(patch, binding) {
  let document
  try { document = parseDocument(patch, { strict: true, uniqueKeys: true, keepSourceTokens: true }) } catch { fail('Profile patch is malformed YAML') }
  if (document.errors.length || !isSeq(document.contents)) fail('Profile patch must be a YAML sequence')
  const matches = []
  for (const operation of document.contents.items) {
    if (!isMap(operation)) continue
    const insert = operation.get('insert', true)
    if (!isSeq(insert)) continue
    for (const row of insert.items) {
      if (!isMap(row)) continue
      const id = row.get('id')
      const name = row.get('name')
      if (id === DASHBOARD_ID || name === DASHBOARD_MODULE || name === LEGACY_DASHBOARD_MODULE) matches.push({ row, id, name })
    }
  }
  // Detect forbidden occurrences outside the supported top-level insert shape.
  const json = document.toJSON()
  let occurrences = 0, reservedScalars = 0
  const walk = value => {
    if (value === DASHBOARD_ID || value === DASHBOARD_MODULE || value === LEGACY_DASHBOARD_MODULE) { reservedScalars += 1; return }
    if (Array.isArray(value)) { for (const item of value) walk(item); return }
    if (!value || typeof value !== 'object') return
    if (value.id === DASHBOARD_ID || value.name === DASHBOARD_MODULE || value.name === LEGACY_DASHBOARD_MODULE) occurrences += 1
    for (const child of Object.values(value)) walk(child)
  }
  walk(json)
  if (occurrences !== matches.length || reservedScalars !== matches.length * 2 || matches.length > 1) fail('Dashboard row is duplicated, nested, or has an unsupported shape')
  if (matches.length === 1) {
    const match = matches[0]
    const allowed = new Set(['id', 'name', 'config'])
    if (match.id !== DASHBOARD_ID || (match.name !== DASHBOARD_MODULE && match.name !== LEGACY_DASHBOARD_MODULE)
      || match.row.items.some(pair => !allowed.has(String(pair.key?.value ?? pair.key)))) fail('Dashboard row conflicts with the exact managed shape')
    match.row.set('name', DASHBOARD_MODULE)
    match.row.set('config', { dshHome: binding.dshHome, profileName: binding.profileName })
  } else {
    document.contents.add({ insert: [{ id: DASHBOARD_ID, name: DASHBOARD_MODULE,
      config: { dshHome: binding.dshHome, profileName: binding.profileName } }] })
  }
  let output = String(document)
  if (patch.includes('\r\n')) output = output.replace(/(?<!\r)\n/gu, '\r\n')
  return output
}

export function hasDashboardRow(patch) {
  try {
    const value = parseDocument(patch, { strict: true, uniqueKeys: true }).toJSON()
    let count = 0
    const walk = current => {
      if (Array.isArray(current)) { for (const item of current) walk(item); return }
      if (!current || typeof current !== 'object') return
      if (current.id === DASHBOARD_ID && current.name === DASHBOARD_MODULE) count += 1
      for (const child of Object.values(current)) walk(child)
    }
    walk(value)
    return count === 1
  } catch { return false }
}
