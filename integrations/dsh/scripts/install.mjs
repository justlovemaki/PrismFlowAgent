#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parse } from 'yaml'
import { configureDashboardRow, deriveDashboardProfileBinding } from '../lib/dashboard-install.js'
import { configurePrismFlowRuntime, configureProfileManifest, configureSqliteStorage, detectInstalledDshVersion, findActiveDshProcesses, listProcProcesses, resolveInstallerDshHome, sqliteVersionForDsh } from '../lib/dsh-install.js'
import { migrateJsonStorageToSqlite } from '../lib/storage-sqlite-migration.js'
import { acquireWriterLease } from '../lib/writer-lease-lock.js'

const DEFAULT_DSH_VERSION = '0.1.2-rc.1'
const PLUGIN_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const MANUAL_IMPORT_ROOT = new URL('../manual-import/', import.meta.url)
const PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/u
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

function usage() {
  console.error('Usage: prismflow-dsh-install [--profile <name>] [--dsh-home <path>] [--dsh-version <version>] [--migrate-json --confirm-dsh-stopped]')
  console.error('Legacy migration flags remain accepted, but JSON storage is now migrated automatically after active DSH processes are ruled out. Use prismflow-dsh-update for automatic stop, update, restart, and health checking.')
}
function fail(message) { throw new Error(`PrismFlow DSH installer: ${message}`) }
function takeValue(args, index, option) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) fail(`${option} requires a value`)
  return value
}
function parseArgs(argv) {
  const result = {
    profileName: '',
    dshHome: resolveInstallerDshHome(undefined, process.env, homedir()),
    dshVersion: process.env.DSH_VERSION ?? '', migrateJson: false, confirmStopped: false, recoverStoppedLocks: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--profile') { result.profileName = takeValue(argv, index, argument); index += 1 }
    else if (argument === '--dsh-home') { result.dshHome = takeValue(argv, index, argument); index += 1 }
    else if (argument === '--dsh-version') { result.dshVersion = takeValue(argv, index, argument); index += 1 }
    else if (argument === '--migrate-json') result.migrateJson = true
    else if (argument === '--confirm-dsh-stopped') result.confirmStopped = true
    else if (argument === '--recover-stopped-locks') result.recoverStoppedLocks = true
    else if (argument === '--help' || argument === '-h') return { help: true }
    else fail(`unknown option ${argument}`)
  }
  if (result.profileName && !PROFILE_NAME.test(result.profileName)) fail('--profile must contain 1-64 letters, digits, underscores, or hyphens')
  if (result.dshVersion && !VERSION.test(result.dshVersion)) fail('--dsh-version is invalid')
  if (result.confirmStopped && !result.migrateJson) fail('--confirm-dsh-stopped is valid only with --migrate-json')
  return result
}
function command(name) {
  if (process.platform !== 'win32' || /[\\/]/u.test(name) || /\.(?:cmd|exe)$/iu.test(name)) return name
  return `${name}.cmd`
}
function run(name, args, options = {}) {
  const result = spawnSync(command(name), args, {
    cwd: options.cwd,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) fail(`${name} could not be started: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || '').trim() : ''
    fail(`${name} exited with status ${result.status}${detail ? `: ${detail}` : ''}`)
  }
  return result
}
function detectLatestDshVersion() {
  try {
    const result = run('npm', ['view', '@deepseek-ai/dsh', 'version', '--json'], { capture: true })
    const value = JSON.parse(result.stdout)
    if (typeof value === 'string' && VERSION.test(value)) return value
  } catch (error) {
    console.warn(`${error.message}; using bundled tested default ${DEFAULT_DSH_VERSION}`)
    return DEFAULT_DSH_VERSION
  }
  fail('npm returned an invalid @deepseek-ai/dsh version')
}
function atomicWrite(path, content) {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  writeFileSync(temporary, content, { flag: 'wx' })
  try { renameSync(temporary, path) } catch (error) { rmSync(temporary, { force: true }); throw error }
}
function sha256File(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function pinLocalPackageArtifact(packagePath, profileDir, dshHome) {
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  const specification = manifest.dependencies?.['@prismflow/dsh']
  if (typeof specification !== 'string' || !specification.startsWith('file:')) return undefined
  const rawPath = decodeURIComponent(specification.slice('file:'.length))
  const sourcePath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(profileDir, rawPath)
  if (!sourcePath.toLowerCase().endsWith('.tgz')) return undefined
  if (!existsSync(sourcePath)) fail(`local PrismFlow package artifact no longer exists: ${sourcePath}; keep the downloaded .tgz until the installer completes`)
  const artifactRoot = join(dshHome, 'packages')
  const targetPath = join(artifactRoot, `prismflow-dsh-${PLUGIN_VERSION}.tgz`)
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 })
  const sourceHash = sha256File(sourcePath)
  if (resolve(sourcePath) !== resolve(targetPath)) {
    if (existsSync(targetPath)) {
      if (sha256File(targetPath) !== sourceHash) fail(`durable package artifact collision: ${targetPath}`)
    } else {
      const temporary = join(artifactRoot, `.${basename(targetPath)}.${randomUUID()}.tmp`)
      copyFileSync(sourcePath, temporary)
      try { renameSync(temporary, targetPath) } catch (error) { rmSync(temporary, { force: true }); throw error }
    }
  }
  if (sha256File(targetPath) !== sourceHash) fail('durable package artifact verification failed')
  manifest.dependencies['@prismflow/dsh'] = `file:${targetPath.replaceAll('\\', '/')}`
  atomicWrite(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  return targetPath
}
function installManualImportBundles(dshHome) {
  const targetRoot = join(dshHome, 'prismflow-manual-import', `@prismflow-dsh-${PLUGIN_VERSION}`)
  for (const kind of ['skills', 'plugins']) {
    const source = new URL(`${kind}/`, MANUAL_IMPORT_ROOT)
    const target = join(targetRoot, kind)
    mkdirSync(target, { recursive: true, mode: 0o700 })
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.zip')) copyFileSync(new URL(entry.name, source), join(target, entry.name))
    }
  }
  return targetRoot
}
function verifyDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = database.prepare('PRAGMA integrity_check').all()
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') fail('SQLite integrity_check failed')
  } finally { database.close() }
}
function writerLockPaths(patch, dshHome) {
  const paths = new Set([
    join(dshHome, 'locks', 'prismflow-production.lock'),
    join(dshHome, 'locks', 'prismflow-toolsets.lock'),
    join(dshHome, 'locks', 'prismflow-workflows.lock'),
  ])
  const walk = value => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return }
    if (!value || typeof value !== 'object') return
    if (typeof value.writerLockPath === 'string' && value.writerLockPath.trim()) {
      if (!isAbsolute(value.writerLockPath)) fail('Profile contains a non-absolute writerLockPath')
      paths.add(resolve(value.writerLockPath))
    }
    for (const child of Object.values(value)) walk(child)
  }
  walk(parse(patch))
  return [...paths].sort()
}
function listSystemProcesses() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true })
    if (result.error || result.status !== 0) throw new Error(String(result.stderr || result.error?.message || 'Windows process query failed').trim())
    const parsed = JSON.parse(result.stdout || '[]')
    return (Array.isArray(parsed) ? parsed : [parsed]).map(entry => ({
      pid: entry.ProcessId, parentPid: entry.ParentProcessId, commandLine: entry.CommandLine ?? '',
    }))
  }
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
  if (!result.error && result.status === 0) {
    return String(result.stdout).split(/\r?\n/u).flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line)
      return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), commandLine: match[3] }] : []
    })
  }
  try {
    return listProcProcesses()
  } catch (procError) {
    const psError = String(result.stderr || result.error?.message || 'POSIX process query failed').trim()
    throw new AggregateError([result.error, procError].filter(Boolean), `ps failed (${psError}) and /proc inspection failed (${procError.message})`)
  }
}
function assertDshIsOffline(options) {
  let entries
  try { entries = listSystemProcesses() } catch (error) {
    if (options.confirmStopped) {
      console.warn(`Could not inspect system processes; honoring explicit --confirm-dsh-stopped: ${error.message}`)
      return
    }
    fail(`could not verify that DSH is stopped (${error.message}); stop every DSH process or use the legacy explicit --migrate-json --confirm-dsh-stopped confirmation`)
  }
  const active = findActiveDshProcesses(entries)
  if (active.length) {
    fail(`detected active DSH process${active.length === 1 ? '' : 'es'} (${active.slice(0, 8).map(entry => `PID ${entry.pid}`).join(', ')}); stop every DSH process before installing or updating PrismFlow, then rerun the same installer command`)
  }
}

async function acquireInstallationLocks(paths, recoverStoppedLocks = false) {
  const releases = []
  try {
    for (const path of paths) releases.push(await acquireWriterLease(path, recoverStoppedLocks ? { staleAgeMs: 1 } : undefined))
    return async () => {
      const failures = []
      for (const release of releases.reverse()) try { await release() } catch (error) { failures.push(error) }
      if (failures.length) throw new AggregateError(failures, 'PrismFlow installer failed to release writer locks')
    }
  } catch (error) {
    for (const release of releases.reverse()) await release().catch(() => {})
    throw new Error('PrismFlow DSH installer requires every DSH process using this home to be stopped', { cause: error })
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { usage(); return }
  let profileDir
  if (options.profileName) profileDir = resolve(options.dshHome, 'profiles', options.profileName)
  else {
    const inferred = deriveDashboardProfileBinding(process.cwd())
    options.profileName = inferred.profileName
    options.dshHome = inferred.dshHome
    profileDir = resolve(inferred.dshHome, 'profiles', inferred.profileName)
  }
  const packagePath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(packagePath) || !existsSync(patchPath)) fail(`${profileDir} is not an initialized DSH Profile`)
  const binding = deriveDashboardProfileBinding(profileDir)
  const storageRoot = join(binding.dshHome, 'storages')
  const databasePath = join(storageRoot, 'domain.sqlite')
  const dshVersion = options.dshVersion || detectInstalledDshVersion(profileDir) || detectLatestDshVersion()
  const sqliteVersion = sqliteVersionForDsh(dshVersion)
  configureProfileManifest(readFileSync(packagePath, 'utf8'))
  const originalPatch = readFileSync(patchPath, 'utf8')
  const configuredPatch = configureDashboardRow(
    configurePrismFlowRuntime(configureSqliteStorage(originalPatch, databasePath), binding.dshHome),
    binding,
  )

  // Package installation, dependency mutation, Profile rewrites, and storage
  // migration all require one offline boundary. On first install there are no
  // PrismFlow writer leases yet, so process inspection must be unconditional.
  assertDshIsOffline(options)
  const databaseExists = existsSync(databasePath)
  const jsonUnits = existsSync(storageRoot)
    ? readdirSync(storageRoot, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    : []
  if (!databaseExists && jsonUnits.length) {
    console.log(`Detected ${jsonUnits.length} JSON storage units and no SQLite database; starting verified automatic migration.`)
  }

  const releaseLocks = await acquireInstallationLocks(writerLockPaths(originalPatch, binding.dshHome), options.recoverStoppedLocks)
  try {
    if (!databaseExists && jsonUnits.length) {
      const migrated = await migrateJsonStorageToSqlite({ storageRoot, databasePath })
      console.log(`Migrated ${migrated.unitCount} JSON units (${migrated.recordCount} records); verified backup: ${migrated.backupDirectory}`)
    }
    if (existsSync(databasePath)) verifyDatabase(databasePath)

    const durablePackageArtifact = pinLocalPackageArtifact(packagePath, profileDir, binding.dshHome)
    console.log(`DSH ${dshVersion} requires @deepseek-ai/dsh-storage-sqlite ${sqliteVersion}.`)
    run('pnpm', ['add', '--allow-build=sharp', '--save-exact', `@deepseek-ai/dsh-storage-sqlite@${sqliteVersion}`], { cwd: profileDir })
    const installedVersion = JSON.parse(readFileSync(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-storage-sqlite', 'package.json'), 'utf8')).version
    if (installedVersion !== sqliteVersion) fail(`installed SQLite backend version ${installedVersion} does not match ${sqliteVersion}`)
    atomicWrite(packagePath, configureProfileManifest(readFileSync(packagePath, 'utf8')))
    atomicWrite(patchPath, configuredPatch)
    const manualImportRoot = installManualImportBundles(binding.dshHome)

    console.log(`PrismFlow installation completed for Profile ${options.profileName}.`)
    console.log(`Optional personal Skill/plugin ZIPs require manual Dashboard import: ${manualImportRoot}`)
    console.log(`SQLite backend: ${installedVersion}; database: ${databasePath}`)
    if (durablePackageArtifact) console.log(`Durable PrismFlow package artifact: ${durablePackageArtifact}`)
    console.log('Restart DSH Web. Existing Chats must be replaced to receive the frozen updated tools and Skills.')
  } finally { await releaseLocks() }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  usage()
  process.exitCode = 1
})
