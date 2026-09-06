#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { deriveDashboardProfileBinding } from '../lib/dashboard-install.js'
import { detectInstalledDshVersion, findActiveDshProcesses, listProcProcesses, resolveInstallerDshHome, sqliteVersionForDsh } from '../lib/dsh-install.js'

const PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/u
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const STOP_TIMEOUT_MS = 15_000
const START_TIMEOUT_MS = 45_000

function usage() {
  console.error('Usage: prismflow-dsh-update --package <package-spec> [--profile <name>] [--dsh-home <path>] [--dsh-version <version>] [--no-restart]')
  console.error('Stops active DSH processes, installs the package and SQLite dependency offline, then restarts and health-checks DSH Web when it was previously running.')
}
function fail(message) { throw new Error(`PrismFlow DSH updater: ${message}`) }
function takeValue(args, index, option) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) fail(`${option} requires a value`)
  return value
}
function parseArgs(argv) {
  const result = {
    packageSpec: '', profileName: 'web', dshHome: resolveInstallerDshHome(undefined, process.env, homedir()),
    dshVersion: process.env.DSH_VERSION ?? '', restart: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--package') { result.packageSpec = takeValue(argv, index, argument); index += 1 }
    else if (argument === '--profile') { result.profileName = takeValue(argv, index, argument); index += 1 }
    else if (argument === '--dsh-home') { result.dshHome = takeValue(argv, index, argument); index += 1 }
    else if (argument === '--dsh-version') { result.dshVersion = takeValue(argv, index, argument); index += 1 }
    else if (argument === '--no-restart') result.restart = false
    else if (argument === '--help' || argument === '-h') return { help: true }
    else fail(`unknown option ${argument}`)
  }
  if (!result.packageSpec) fail('--package is required')
  if (!PROFILE_NAME.test(result.profileName)) fail('--profile must contain 1-64 letters, digits, underscores, or hyphens')
  if (result.dshVersion && !VERSION.test(result.dshVersion)) fail('--dsh-version is invalid')
  result.dshHome = resolve(result.dshHome)
  const remoteSpecification = /^[a-z][a-z0-9+.-]*:\/\//iu.test(result.packageSpec)
  const localSpecification = !remoteSpecification && (isAbsolute(result.packageSpec) || /^[.]|^file:|[\\/][^@]*\.tgz$/iu.test(result.packageSpec))
  if (localSpecification) {
    const localPath = resolve(result.packageSpec.replace(/^file:/iu, ''))
    if (!existsSync(localPath)) fail(`local package does not exist: ${localPath}`)
    result.packageSpec = localPath
  }
  return result
}
function command(name) {
  if (process.platform !== 'win32' || /[\\/]/u.test(name) || /\.(?:cmd|exe)$/iu.test(name)) return name
  return `${name}.cmd`
}
function run(name, args, options = {}) {
  const result = spawnSync(command(name), args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  if (result.error) fail(`${name} could not be started: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || '').trim() : ''
    fail(`${name} exited with status ${result.status}${detail ? `: ${detail}` : ''}`)
  }
  return result
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
  return listProcProcesses()
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}
function activeDshProcesses() { return findActiveDshProcesses(listSystemProcesses()) }
function isWebProcess(entry, profileName = 'web') {
  const token = profileName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return !/(?:^|[\s"'])plugin(?:[\s"']|$)/iu.test(entry.commandLine)
    && new RegExp(`(?:^|[\\s"'])${token}(?:[\\s"']|$)`, 'iu').test(entry.commandLine)
}
function webPort(entries, profileName) {
  for (const entry of entries.filter(entry => isWebProcess(entry, profileName))) {
    const match = /(?:^|[\s"'])--port(?:=|[\s"']+)(\d{1,5})(?:[\s"']|$)/iu.exec(entry.commandLine)
    const port = match ? Number(match[1]) : 3080
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port
  }
  return 3080
}
async function waitUntilStopped() {
  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    const active = activeDshProcesses()
    if (!active.length) return
    await delay(250)
  }
  const active = activeDshProcesses()
  fail(`could not stop DSH process${active.length === 1 ? '' : 'es'}: ${active.slice(0, 8).map(entry => `PID ${entry.pid}`).join(', ')}`)
}
async function stopDshProcesses(entries) {
  if (!entries.length) return
  console.log(`Stopping ${entries.length} active DSH process${entries.length === 1 ? '' : 'es'} before update: ${entries.slice(0, 8).map(entry => `PID ${entry.pid}`).join(', ')}`)
  const selected = new Set(entries.map(entry => entry.pid))
  const roots = entries.filter(entry => !selected.has(entry.parentPid))
  if (process.platform === 'win32') {
    for (const entry of roots) {
      const result = spawnSync('taskkill.exe', ['/PID', String(entry.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
      if (result.error) fail(`could not stop PID ${entry.pid}: ${result.error.message}`)
      if (result.status !== 0 && processAlive(entry.pid)) fail(`could not stop PID ${entry.pid}: ${String(result.stderr || result.stdout).trim()}`)
    }
  } else {
    for (const entry of [...entries].reverse()) {
      try { process.kill(entry.pid, 'SIGTERM') } catch (error) { if (error?.code !== 'ESRCH') throw error }
    }
    const gracefulDeadline = Date.now() + 8_000
    while (Date.now() < gracefulDeadline && entries.some(entry => processAlive(entry.pid))) await delay(200)
    for (const entry of [...entries].reverse()) {
      if (!processAlive(entry.pid)) continue
      try { process.kill(entry.pid, 'SIGKILL') } catch (error) { if (error?.code !== 'ESRCH') throw error }
    }
  }
  await waitUntilStopped()
  console.log('All active DSH processes stopped.')
}
function startDshWeb(options, port) {
  const environment = { ...process.env, DSH_HOME: options.dshHome }
  const args = ['dlx', `@deepseek-ai/dsh@${options.dshVersion}`, options.profileName, '--port', String(port), '--no-open']
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Start-Process -FilePath 'pnpm.cmd' -ArgumentList @('dlx', $env:PRISMFLOW_DSH_PACKAGE, $env:PRISMFLOW_DSH_PROFILE, '--port', $env:PRISMFLOW_DSH_PORT, '--no-open') -RedirectStandardOutput $env:PRISMFLOW_DSH_STDOUT -RedirectStandardError $env:PRISMFLOW_DSH_STDERR -WindowStyle Hidden"], {
      stdio: 'ignore', windowsHide: true,
      env: {
        ...environment,
        PRISMFLOW_DSH_PACKAGE: `@deepseek-ai/dsh@${options.dshVersion}`,
        PRISMFLOW_DSH_PROFILE: options.profileName,
        PRISMFLOW_DSH_PORT: String(port),
        PRISMFLOW_DSH_STDOUT: join(options.dshHome, 'web-prismflow-update.out'),
        PRISMFLOW_DSH_STDERR: join(options.dshHome, 'web-prismflow-update.err'),
      },
    })
    if (result.error || result.status !== 0) fail(`DSH Web restart could not be launched${result.error ? `: ${result.error.message}` : ''}`)
    return
  }
  const child = spawn(command('pnpm'), args, { detached: true, stdio: 'ignore', env: environment })
  child.on('error', error => console.error(`PrismFlow DSH updater: DSH Web restart failed: ${error.message}`))
  child.unref()
}
async function waitForHealth(port) {
  const deadline = Date.now() + START_TIMEOUT_MS
  let lastError = 'not started'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/prismflow/status`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) {
        const value = await response.json()
        if (value && typeof value === 'object') return value
        lastError = 'status response was malformed'
      } else lastError = `status returned HTTP ${response.status}`
    } catch (error) { lastError = error.message }
    await delay(500)
  }
  fail(`DSH Web did not become healthy on port ${port}: ${lastError}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { usage(); return }
  const profileDir = join(options.dshHome, 'profiles', options.profileName)
  const packagePath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(packagePath) || !existsSync(patchPath)) fail(`${profileDir} is not an initialized DSH Profile`)
  const binding = deriveDashboardProfileBinding(profileDir)
  if (resolve(binding.dshHome) !== options.dshHome || binding.profileName !== options.profileName) fail('Profile binding does not match the selected DSH home and Profile')
  options.dshVersion = options.dshVersion || detectInstalledDshVersion(profileDir)
  if (!options.dshVersion) fail('could not detect the installed DSH version; provide --dsh-version')
  sqliteVersionForDsh(options.dshVersion)

  const before = activeDshProcesses()
  const restartWeb = options.restart && before.some(entry => isWebProcess(entry, options.profileName))
  const port = webPort(before, options.profileName)
  let updateError
  try {
    await stopDshProcesses(before)
    const environment = { ...process.env, DSH_HOME: options.dshHome }
    run('pnpm', ['dlx', `@deepseek-ai/dsh@${options.dshVersion}`, 'plugin', '--profile', options.profileName,
      'add', '--allow-build=sharp', options.packageSpec], { env: environment })
    const installer = join(profileDir, 'node_modules', '@prismflow', 'dsh', 'scripts', 'install.mjs')
    if (!existsSync(installer)) fail(`updated package did not expose its installer: ${installer}`)
    run(process.execPath, [installer, '--profile', options.profileName, '--dsh-home', options.dshHome,
      '--dsh-version', options.dshVersion, '--recover-stopped-locks'], { env: environment })
  } catch (error) {
    updateError = error
  }

  let restartError
  if (restartWeb) {
    try {
      console.log(`Restarting DSH Web for Profile ${options.profileName} on port ${port}.`)
      startDshWeb(options, port)
      const status = await waitForHealth(port)
      console.log(`DSH Web is healthy; PrismFlow ${status.pluginVersion ?? 'version unavailable'} is ready.`)
    } catch (error) { restartError = error }
  }
  if (updateError && restartError) throw new AggregateError([updateError, restartError], 'update failed and DSH Web could not be restored')
  if (updateError) throw updateError
  if (restartError) throw restartError
  if (!restartWeb) console.log(options.restart ? 'DSH Web was not running before the update; it was left stopped.' : 'Automatic DSH Web restart was disabled.')
  console.log('PrismFlow DSH update completed.')
}

main().catch(error => {
  if (error instanceof AggregateError) {
    console.error(`PrismFlow DSH updater: ${error.message}`)
    for (const cause of error.errors) console.error(`- ${cause instanceof Error ? cause.message : String(cause)}`)
  } else console.error(error instanceof Error ? error.message : String(error))
  usage()
  process.exitCode = 1
})
