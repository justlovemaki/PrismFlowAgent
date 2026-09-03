#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { configureDashboardRow, deriveDashboardProfileBinding } from '../lib/dashboard-install.js'

const profileDir = resolve(process.argv[2] ?? process.cwd())
const profilePackagePath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(profilePackagePath) || !existsSync(patchPath)) {
  console.error(`PrismFlow dashboard installer: ${profileDir} is not a DSH profile directory`)
  process.exit(1)
}

let binding, patch, profilePackage
try {
  binding = deriveDashboardProfileBinding(profileDir)
  patch = configureDashboardRow(readFileSync(patchPath, 'utf8'), binding)
  profilePackage = JSON.parse(readFileSync(profilePackagePath, 'utf8'))
  if (!profilePackage || typeof profilePackage !== 'object' || Array.isArray(profilePackage)) throw new Error('Profile package.json is malformed')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PrismFlow dashboard installer: Profile binding validation failed')
  process.exit(1)
}

// Since @prismflow/dsh 0.24.26 the Dashboard server and client are exported by
// the owning package itself. Remove the old generated file: dependency so a
// package-manager reconciliation after `dsh plugin exec` cannot delete the
// module referenced by the Cordis tree and leave the Profile unbootable.
if (profilePackage.dependencies && typeof profilePackage.dependencies === 'object') {
  delete profilePackage.dependencies['@prismflow/dsh-dashboard']
}
writeFileSync(profilePackagePath, `${JSON.stringify(profilePackage, null, 2)}\n`)
writeFileSync(patchPath, patch)
rmSync(join(profileDir, '.prismflow', 'dashboard'), { recursive: true, force: true })

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const installed = spawnSync(command, ['install'], {
  cwd: profileDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (installed.error) {
  console.error(`PrismFlow Dashboard Profile was configured, but pnpm could not be started: ${installed.error.message}`)
  console.error(`Run "pnpm install" manually in ${profileDir}`)
  process.exit(1)
}
if (installed.status !== 0) process.exit(installed.status ?? 1)

console.log(`PrismFlow dashboard installed in ${profileDir}`)
console.log('Restart DSH Web, then use the PrismFlow action in the sidebar.')
