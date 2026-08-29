#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureDashboardRow, deriveDashboardProfileBinding } from '../lib/dashboard-install.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version
const profileDir = resolve(process.argv[2] ?? process.cwd())
const profilePackagePath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(profilePackagePath) || !existsSync(patchPath)) {
  console.error(`PrismFlow dashboard installer: ${profileDir} is not a DSH profile directory`)
  process.exit(1)
}

let binding, patch
try {
  binding = deriveDashboardProfileBinding(profileDir)
  patch = configureDashboardRow(readFileSync(patchPath, 'utf8'), binding)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PrismFlow dashboard installer: Profile binding validation failed')
  process.exit(1)
}

const dashboardDir = join(profileDir, '.prismflow', 'dashboard')
mkdirSync(dashboardDir, { recursive: true })

const dashboardPackage = {
  name: '@prismflow/dsh-dashboard',
  version: packageVersion,
  private: true,
  type: 'module',
  main: './index.js',
  exports: {
    '.': './index.js',
    './client': './client.js',
    './package.json': './package.json',
  },
  dsh: {
    client: {
      platform: 'web',
      inject: [
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-sidebar',
      ],
    },
  },
}
writeFileSync(join(dashboardDir, 'package.json'), `${JSON.stringify(dashboardPackage, null, 2)}\n`)
writeFileSync(join(dashboardDir, 'index.js'), "export { Config, apply, inject, name } from '@prismflow/dsh/ui'\n")
copyFileSync(join(packageRoot, 'lib', 'client.js'), join(dashboardDir, 'client.js'))

const profilePackage = JSON.parse(readFileSync(profilePackagePath, 'utf8'))
profilePackage.dependencies ??= {}
profilePackage.dependencies['@prismflow/dsh-dashboard'] = 'file:.prismflow/dashboard'
writeFileSync(profilePackagePath, `${JSON.stringify(profilePackage, null, 2)}\n`)

writeFileSync(patchPath, patch)

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const installed = spawnSync(command, ['install'], {
  cwd: profileDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (installed.error) {
  console.error(`PrismFlow dashboard files were created, but pnpm could not be started: ${installed.error.message}`)
  console.error(`Run "pnpm install" manually in ${profileDir}`)
  process.exit(1)
}
if (installed.status !== 0) process.exit(installed.status ?? 1)

console.log(`PrismFlow dashboard installed in ${profileDir}`)
console.log('Restart DSH Web, then use the PrismFlow action in the sidebar.')
