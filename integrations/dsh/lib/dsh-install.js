import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'

const SQLITE_ID = 'storage-sqlite'
const SQLITE_MODULE = '@deepseek-ai/dsh-storage-sqlite'
const STORAGE_DOMAIN_ID = 'storage-domain'
const DEFAULT_GENERATOR_BUILDER_PROFILE = Object.freeze({
  id: 'dashboard-builder', version: 1, subagentProvider: 'spawn', allowedTools: Object.freeze(['*']),
  maxSteps: 8, maxInputChars: 100000, maxIntermediateOutputChars: 100000, maxCombinedInputChars: 250000,
  maxOutputChars: 100000, maxPromptAggregateChars: 32000,
})
const SUPPORTED = new Map([
  ['0.1.0-rc.6', '0.1.0-rc.6'],
  ['0.1.1-rc.2', '0.1.1-rc.2'],
])
const ENABLED_RUNTIME_IDS = Object.freeze([
  'prismflow-store-source-settings',
  'prismflow-store-content',
  'prismflow-store-content-relevance',
  'prismflow-store-content-selection',
  'prismflow-reviewer-ai-relevance-subagent',
  'prismflow-tool-content',
  'prismflow-tool-content-selection',
  'prismflow-store-publication-receipts',
  'prismflow-store-production-media',
  'prismflow-store-rss-outputs',
  'prismflow-store-toolsets',
  'prismflow-store-image-generation-settings',
  'prismflow-skill-provider',
  'prismflow-tool-production-media',
  'prismflow-store-production',
  'prismflow-store-generator-prompts',
  'prismflow-store-generator-workflows',
  'prismflow-generator-subagent',
  'prismflow-tool-production',
  'prismflow-tool-legacy-production',
])

function fail(message) { throw new Error(`PrismFlow DSH installer: ${message}`) }
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

export function listProcProcesses(procRoot = '/proc') {
  const processes = []
  for (const entry of readdirSync(procRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue
    const processDir = join(procRoot, entry.name)
    try {
      const stat = readFileSync(join(processDir, 'stat'), 'utf8')
      const commandEnd = stat.lastIndexOf(')')
      if (commandEnd < 2) throw new Error(`malformed ${entry.name}/stat`)
      const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u)
      const pid = Number(entry.name)
      const parentPid = Number(fields[1])
      if (!Number.isInteger(parentPid) || parentPid < 0) throw new Error(`malformed ${entry.name}/stat parent pid`)
      const commandLine = readFileSync(join(processDir, 'cmdline'))
        .toString('utf8').split('\0').filter(Boolean).join(' ').trim()
      processes.push({ pid, parentPid, commandLine })
    } catch (error) {
      // Processes can disappear between readdir and file reads. Every other
      // failure is significant: silently ignoring EACCES/hidepid could miss a
      // running DSH writer and make an online JSON migration look safe.
      if (error?.code === 'ENOENT' || error?.code === 'ESRCH') continue
      throw error
    }
  }
  return processes
}

export function findActiveDshProcesses(entries, currentPid = process.pid) {
  if (!Array.isArray(entries) || !Number.isInteger(currentPid) || currentPid <= 0) return []
  const processes = entries.flatMap(entry => {
    const pid = Number(entry?.pid ?? entry?.ProcessId)
    const parentPid = Number(entry?.parentPid ?? entry?.ParentProcessId)
    const commandLine = entry?.commandLine ?? entry?.CommandLine
    return Number.isInteger(pid) && pid > 0 && Number.isInteger(parentPid) && parentPid >= 0 && typeof commandLine === 'string'
      ? [{ pid, parentPid, commandLine }]
      : []
  })
  const byPid = new Map(processes.map(entry => [entry.pid, entry]))
  const excluded = new Set()
  let ancestor = currentPid
  while (Number.isInteger(ancestor) && ancestor > 0 && !excluded.has(ancestor)) {
    excluded.add(ancestor)
    ancestor = byPid.get(ancestor)?.parentPid
  }
  const dshCommand = /(?:@deepseek-ai[\\/]dsh(?:[\\/\s"']|$)|node_modules[\\/](?:\.bin[\\/])?dsh(?:\.cmd)?(?:[\s"']|$))/iu
  return processes
    .filter(entry => !excluded.has(entry.pid) && dshCommand.test(entry.commandLine))
    .sort((left, right) => left.pid - right.pid)
}

export function resolveInstallerDshHome(explicitHome, env = process.env, userHome) {
  if (typeof explicitHome === 'string' && explicitHome.trim()) return explicitHome
  if (typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim()) return env.DSH_HOME
  if (typeof userHome !== 'string' || !userHome.trim()) fail('OS home directory is unavailable')
  return join(userHome, '.dsh')
}

export function sqliteVersionForDsh(dshVersion) {
  if (typeof dshVersion !== 'string' || !SUPPORTED.has(dshVersion)) {
    fail(`unsupported DSH version ${JSON.stringify(dshVersion)}; supported versions: ${[...SUPPORTED.keys()].join(', ')}`)
  }
  return SUPPORTED.get(dshVersion)
}

export function configureProfileManifest(source) {
  let value
  try { value = JSON.parse(source) } catch { fail('Profile package.json is malformed') }
  if (!plainObject(value) || !plainObject(value.dsh) || !plainObject(value.dsh.profile)
    || !Array.isArray(value.dsh.profile.bundles)
    || value.dsh.profile.bundles.some(bundle => typeof bundle !== 'string' || !bundle.trim())) {
    fail('Profile package.json has an invalid dsh.profile.bundles manifest')
  }
  const matches = value.dsh.profile.bundles.filter(bundle => bundle === '@prismflow/dsh').length
  if (matches > 1) fail('Profile bundle list contains duplicate @prismflow/dsh entries')
  if (matches === 0) value.dsh.profile.bundles.push('@prismflow/dsh')
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Configure one exact SQLite backend row and one top-level Storage Domain
 * override. Reserved ids/modules in any other shape fail closed.
 */
export function configurePrismFlowRuntime(patch, dshHome) {
  if (typeof dshHome !== 'string' || !dshHome.trim() || /[\u0000\r\n]/u.test(dshHome)) fail('DSH home path is invalid')
  let document
  try { document = parseDocument(patch, { strict: true, uniqueKeys: true, keepSourceTokens: true }) } catch { fail('Profile patch is malformed YAML') }
  if (document.errors.length || !isSeq(document.contents)) fail('Profile patch must be a YAML sequence')

  const managed = new Set(ENABLED_RUNTIME_IDS)
  const matches = new Map(ENABLED_RUNTIME_IDS.map(id => [id, []]))
  for (const operation of document.contents.items) {
    if (!isMap(operation)) continue
    const id = operation.get('id')
    if (managed.has(id)) matches.get(id).push(operation)
  }
  const occurrences = new Map(ENABLED_RUNTIME_IDS.map(id => [id, 0]))
  const walk = value => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return }
    if (!plainObject(value)) return
    if (managed.has(value.id)) occurrences.set(value.id, occurrences.get(value.id) + 1)
    for (const child of Object.values(value)) walk(child)
  }
  walk(document.toJSON())
  for (const id of ENABLED_RUNTIME_IDS) {
    const rows = matches.get(id)
    if (rows.length > 1 || occurrences.get(id) !== rows.length) fail(`runtime override ${id} is duplicated, nested, or has an unsupported shape`)
  }

  const normalizedHome = dshHome.replaceAll('\\', '/').replace(/\/$/u, '')
  const configs = new Map([
    ['prismflow-store-production', { writerLockPath: `${normalizedHome}/locks/prismflow-production.lock` }],
    ['prismflow-store-toolsets', {
      writerLockPath: `${normalizedHome}/locks/prismflow-toolsets.lock`,
      skillRoot: `${normalizedHome}/skills`,
      pluginRoot: `${normalizedHome}/plugins/prismflow-personal`,
    }],
    ['prismflow-skill-provider', { skillRoot: `${normalizedHome}/skills` }],
    ['prismflow-store-generator-workflows', { writerLockPath: `${normalizedHome}/locks/prismflow-workflows.lock` }],
  ])
  let generatorRuntimeRow
  for (const id of ENABLED_RUNTIME_IDS) {
    let row = matches.get(id)[0]
    if (!row) {
      row = document.createNode({ id, disabled: false, ...(configs.has(id) ? { config: configs.get(id) } : {}) })
      document.contents.add(row)
    } else {
      const allowed = new Set(['id', 'name', 'disabled', 'config'])
      if (row.items.some(pair => !allowed.has(String(pair.key?.value ?? pair.key)))) fail(`runtime override ${id} has unsupported fields`)
      row.set('disabled', false)
      const required = configs.get(id)
      if (required) {
        const config = row.get('config', true)
        if (config !== undefined && !isMap(config)) fail(`runtime override ${id} config must be a mapping`)
        if (config) for (const [key, value] of Object.entries(required)) config.set(key, value)
        else row.set('config', required)
      }
    }
    if (id === 'prismflow-generator-subagent') generatorRuntimeRow = row
  }
  if (!generatorRuntimeRow) fail('generator runtime row is missing after configuration')
  const generatorConfig = generatorRuntimeRow.get('config', true)
  if (generatorConfig !== undefined && !isMap(generatorConfig)) fail('generator runtime config must be a mapping')
  if (generatorConfig) {
    if (generatorConfig.get('builderProfile') === undefined) generatorConfig.set('builderProfile', DEFAULT_GENERATOR_BUILDER_PROFILE)
    const generators = generatorConfig.get('generators', true)
    if (generators === undefined) generatorConfig.set('generators', [])
    else if (!isSeq(generators)) fail('generator runtime generators must be a sequence')
  }
  let output = String(document)
  if (patch.includes('\r\n')) output = output.replace(/(?<!\r)\n/gu, '\r\n')
  return output
}

export function configureSqliteStorage(patch, databasePath) {
  if (typeof databasePath !== 'string' || !databasePath.trim() || /[\u0000\r\n]/u.test(databasePath)) fail('SQLite database path is invalid')
  let document
  try { document = parseDocument(patch, { strict: true, uniqueKeys: true, keepSourceTokens: true }) } catch { fail('Profile patch is malformed YAML') }
  if (document.errors.length || !isSeq(document.contents)) fail('Profile patch must be a YAML sequence')

  const sqliteMatches = []
  const domainMatches = []
  for (const operation of document.contents.items) {
    if (!isMap(operation)) continue
    if (operation.get('id') === STORAGE_DOMAIN_ID) domainMatches.push(operation)
    const insert = operation.get('insert', true)
    if (!isSeq(insert)) continue
    for (const row of insert.items) {
      if (!isMap(row)) continue
      if (row.get('id') === SQLITE_ID || row.get('name') === SQLITE_MODULE) sqliteMatches.push(row)
    }
  }

  const json = document.toJSON()
  let sqliteOccurrences = 0
  let domainOccurrences = 0
  const walk = value => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return }
    if (!plainObject(value)) return
    if (value.id === SQLITE_ID || value.name === SQLITE_MODULE) sqliteOccurrences += 1
    if (value.id === STORAGE_DOMAIN_ID) domainOccurrences += 1
    for (const child of Object.values(value)) walk(child)
  }
  walk(json)
  if (sqliteOccurrences !== sqliteMatches.length || sqliteMatches.length > 1) fail('SQLite backend row is duplicated, nested, or has an unsupported shape')
  if (domainOccurrences !== domainMatches.length || domainMatches.length > 1) fail('Storage Domain override is duplicated, nested, or has an unsupported shape')

  const normalizedPath = databasePath.replaceAll('\\', '/')
  if (sqliteMatches.length) {
    const row = sqliteMatches[0]
    const allowed = new Set(['id', 'name', 'config'])
    if (row.get('id') !== SQLITE_ID || row.get('name') !== SQLITE_MODULE
      || row.items.some(pair => !allowed.has(String(pair.key?.value ?? pair.key)))) fail('SQLite backend row conflicts with the exact managed shape')
    row.set('config', { path: normalizedPath, journalMode: 'wal' })
  } else {
    document.contents.add({ insert: [{ id: SQLITE_ID, name: SQLITE_MODULE, config: { path: normalizedPath, journalMode: 'wal' } }] })
  }

  if (domainMatches.length) {
    const row = domainMatches[0]
    const allowed = new Set(['id', 'config'])
    if (row.items.some(pair => !allowed.has(String(pair.key?.value ?? pair.key)))) fail('Storage Domain override conflicts with the exact managed shape')
    const config = row.get('config', true)
    if (config !== undefined && !isMap(config)) fail('Storage Domain config must be a mapping')
    if (config) config.set('backend', 'sqlite')
    else row.set('config', { backend: 'sqlite' })
  } else {
    document.contents.add({ id: STORAGE_DOMAIN_ID, config: { backend: 'sqlite' } })
  }

  let output = String(document)
  if (patch.includes('\r\n')) output = output.replace(/(?<!\r)\n/gu, '\r\n')
  return output
}
