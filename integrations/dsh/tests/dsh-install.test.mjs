import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse } from 'yaml'
import { configurePrismFlowRuntime, configureProfileManifest, configureSqliteStorage, detectInstalledDshVersion, findActiveDshProcesses, listProcProcesses, resolveInstallerDshHome, sqliteVersionForDsh } from '../lib/dsh-install.js'

const windowsDatabase = String.raw`C:\Users\person\dsh\storages\domain.sqlite`

test('one-stop installer follows DSH home precedence without a machine-fixed path', () => {
  assert.equal(resolveInstallerDshHome('D:/explicit', { DSH_HOME: 'D:/environment' }, 'D:/user'), 'D:/explicit')
  assert.equal(resolveInstallerDshHome('', { DSH_HOME: 'D:/environment' }, 'D:/user'), 'D:/environment')
  assert.equal(resolveInstallerDshHome(undefined, {}, 'D:/user'), join('D:/user', '.dsh'))
})

test('one-stop installer excludes its own dsh plugin-exec ancestry but detects other active DSH processes', () => {
  const entries = [
    { pid: 100, parentPid: 1, commandLine: 'node npx-cli.js @deepseek-ai/dsh plugin --profile web exec prismflow-dsh-install' },
    { pid: 101, parentPid: 100, commandLine: 'node scripts/install.mjs' },
    { pid: 200, parentPid: 1, commandLine: 'node /opt/node_modules/@deepseek-ai/dsh/lib/bin.js web' },
    { pid: 201, parentPid: 200, commandLine: 'node /opt/node_modules/@deepseek-ai/dsh/lib/bin.js web-worker' },
    { pid: 300, parentPid: 1, commandLine: 'node /opt/node_modules/@prismflow/dsh/lib/core.js' },
  ]
  assert.deepEqual(findActiveDshProcesses(entries, 101).map(entry => entry.pid), [200, 201])
  assert.deepEqual(findActiveDshProcesses(entries.filter(entry => entry.pid < 200), 101), [])
})

test('one-stop installer reads a minimal Linux /proc process table when ps is unavailable', async t => {
  const procRoot = await mkdtemp(join(tmpdir(), 'prismflow-proc-'))
  t.after(() => rm(procRoot, { recursive: true, force: true }))
  for (const entry of [
    { pid: 101, parentPid: 1, command: 'node (worker)', argv: ['node', '/opt/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web'] },
    { pid: 202, parentPid: 101, command: 'kernel-thread', argv: [] },
  ]) {
    const directory = join(procRoot, String(entry.pid))
    mkdirSync(directory)
    writeFileSync(join(directory, 'stat'), `${entry.pid} (${entry.command}) S ${entry.parentPid} 0 0 0 0\n`)
    writeFileSync(join(directory, 'cmdline'), `${entry.argv.join('\0')}${entry.argv.length ? '\0' : ''}`)
  }
  mkdirSync(join(procRoot, 'not-a-process'))
  assert.deepEqual(listProcProcesses(procRoot), [
    { pid: 101, parentPid: 1, commandLine: 'node /opt/node_modules/@deepseek-ai/dsh/lib/bin.js web' },
    { pid: 202, parentPid: 101, commandLine: '' },
  ])
})

test('one-stop installer recognizes Windows DSH command paths and ignores unrelated dsh text', () => {
  const entries = [
    { ProcessId: 10, ParentProcessId: 1, CommandLine: String.raw`"node" "C:\profile\node_modules\.bin\..\@deepseek-ai\dsh\lib\bin.js" web` },
    { ProcessId: 11, ParentProcessId: 1, CommandLine: 'editor README-dsh-notes.md' },
  ]
  assert.deepEqual(findActiveDshProcesses(entries, 99).map(entry => entry.pid), [10])
})

test('one-stop installer accepts the compatible DSH line and pins the same exact SQLite backend', () => {
  assert.equal(sqliteVersionForDsh('0.1.0-rc.6'), '0.1.0-rc.6')
  assert.equal(sqliteVersionForDsh('0.1.1-rc.2'), '0.1.1-rc.2')
  assert.equal(sqliteVersionForDsh('0.1.2-rc.1'), '0.1.2-rc.1')
  assert.equal(sqliteVersionForDsh('0.1.9-rc.12'), '0.1.9-rc.12')
  assert.equal(sqliteVersionForDsh('0.1.9'), '0.1.9')
  assert.throws(() => sqliteVersionForDsh('0.1.0-rc.5'), /unsupported DSH version/u)
  assert.throws(() => sqliteVersionForDsh('0.1.2-alpha.2'), /unsupported DSH version/u)
  assert.throws(() => sqliteVersionForDsh('0.2.0-rc.1'), /unsupported DSH version/u)
})

test('one-stop installer detects one coherent installed DSH release without an exact allowlist', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'prismflow-dsh-version-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  assert.equal(detectInstalledDshVersion(profile), undefined)
  for (const packageName of ['dsh-base', 'dsh-storage-domain']) {
    const directory = join(profile, 'node_modules', '@deepseek-ai', packageName)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), '{"version":"0.1.9-rc.12"}\n')
  }
  assert.equal(detectInstalledDshVersion(profile), '0.1.9-rc.12')
  writeFileSync(join(profile, 'node_modules', '@deepseek-ai', 'dsh-storage-domain', 'package.json'), '{"version":"0.1.8"}\n')
  assert.throws(() => detectInstalledDshVersion(profile), /inconsistent versions/u)
})

test('one-stop installer adds the PrismFlow bundle to an initialized Profile manifest exactly once', () => {
  const source = JSON.stringify({ name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } })
  const first = configureProfileManifest(source)
  const second = configureProfileManifest(first)
  assert.equal(second, first)
  assert.deepEqual(JSON.parse(first).dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@prismflow/dsh'])
  assert.throws(() => configureProfileManifest('{}'), /invalid dsh\.profile\.bundles/u)
  assert.throws(() => configureProfileManifest(JSON.stringify({ dsh: { profile: { bundles: ['@prismflow/dsh', '@prismflow/dsh'] } } })), /duplicate/u)
})

test('one-stop installer adds idempotent exact SQLite and Storage Domain rows', () => {
  const original = '- insert:\n    - id: unrelated\n      name: example\n\n# keep this comment\n- id: storage-json\n  disabled: true\n'
  const first = configureSqliteStorage(original, windowsDatabase)
  const second = configureSqliteStorage(first, windowsDatabase)
  assert.equal(second, first)
  assert.match(first, /# keep this comment/u)
  const value = parse(first)
  const sqlite = value.flatMap(operation => operation.insert ?? []).filter(row => row.id === 'storage-sqlite')
  assert.deepEqual(sqlite, [{ id: 'storage-sqlite', name: '@deepseek-ai/dsh-storage-sqlite', config: {
    path: 'C:/Users/person/dsh/storages/domain.sqlite', journalMode: 'wal',
  } }])
  assert.deepEqual(value.filter(operation => operation.id === 'storage-domain'), [{ id: 'storage-domain', config: { backend: 'sqlite' } }])
})

test('one-stop installer updates exact managed rows and rejects ambiguous reserved shapes', () => {
  const patch = '- insert:\n    - id: storage-sqlite\n      name: "@deepseek-ai/dsh-storage-sqlite"\n      config:\n        path: old.sqlite\n        journalMode: delete\n- id: storage-domain\n  config:\n    backend: json\n    retained: true\n'
  const value = parse(configureSqliteStorage(patch, '/safe/domain.sqlite'))
  assert.equal(value[0].insert[0].config.path, '/safe/domain.sqlite')
  assert.equal(value[0].insert[0].config.journalMode, 'wal')
  assert.deepEqual(value[1].config, { backend: 'sqlite', retained: true })
  assert.throws(() => configureSqliteStorage('- group:\n    - id: storage-sqlite\n      name: "@deepseek-ai/dsh-storage-sqlite"\n', '/safe/domain.sqlite'), /unsupported shape/u)
  assert.throws(() => configureSqliteStorage('- insert:\n    - id: storage-sqlite\n      name: "@deepseek-ai/dsh-storage-sqlite"\n      config: {}\n    - id: storage-sqlite\n      name: "@deepseek-ai/dsh-storage-sqlite"\n      config: {}\n', '/safe/domain.sqlite'), /duplicated/u)
})

test('one-stop installer enables the complete safe runtime and binds every writable root to the selected DSH home', () => {
  const original = '- insert:\n    - id: unrelated\n      name: example\n- id: prismflow-store-content\n  disabled: true\n  config:\n    retained: true\n'
  const first = configurePrismFlowRuntime(original, windowsDatabase.replace(/\\storages\\domain\.sqlite$/u, ''))
  const second = configurePrismFlowRuntime(first, windowsDatabase.replace(/\\storages\\domain\.sqlite$/u, ''))
  assert.equal(second, first)
  const value = parse(first)
  const rows = new Map(value.filter(row => row.id?.startsWith('prismflow-')).map(row => [row.id, row]))
  for (const row of rows.values()) assert.equal(row.disabled, false)
  assert.equal(rows.get('prismflow-store-content').config.retained, true)
  assert.deepEqual(rows.get('prismflow-store-production').config, { writerLockPath: 'C:/Users/person/dsh/locks/prismflow-production.lock' })
  assert.deepEqual(rows.get('prismflow-store-toolsets').config, {
    writerLockPath: 'C:/Users/person/dsh/locks/prismflow-toolsets.lock',
    skillRoot: 'C:/Users/person/dsh/skills',
    pluginRoot: 'C:/Users/person/dsh/plugins/prismflow-personal',
  })
  assert.deepEqual(rows.get('prismflow-store-generator-workflows').config, { writerLockPath: 'C:/Users/person/dsh/locks/prismflow-workflows.lock' })
  assert.equal(rows.get('prismflow-generator-subagent').config, undefined)
  const migrated = parse(configurePrismFlowRuntime(`${original}- id: prismflow-generator-subagent\n  disabled: false\n  config:\n    generators:\n      - id: daily-brief\n        name: Old packaged default\n      - id: retained-custom\n        name: Retained custom\n`, '/safe/home'))
  assert.deepEqual(migrated.find(row => row.id === 'prismflow-generator-subagent').config.generators.map(row => row.id), ['daily-brief', 'retained-custom'])
  assert.throws(() => configurePrismFlowRuntime('- insert:\n    - id: prismflow-store-content\n      disabled: true\n', '/safe/home'), /unsupported shape/u)
})

test('main installer writes runtime, storage, and Dashboard in one Profile patch update', async t => {
  const home = await mkdtemp(join(tmpdir(), 'prismflow-install-main-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles', 'web')
  const sqlitePackage = join(profile, 'node_modules', '@deepseek-ai', 'dsh-storage-sqlite')
  const domainPackage = join(profile, 'node_modules', '@deepseek-ai', 'dsh-storage-domain')
  const bin = join(home, 'bin'); const downloads = join(home, 'downloads'); const sourceArtifact = join(downloads, 'incoming-prismflow.tgz')
  mkdirSync(sqlitePackage, { recursive: true }); mkdirSync(domainPackage, { recursive: true }); mkdirSync(bin); mkdirSync(downloads); writeFileSync(sourceArtifact, 'verified-test-package')
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: { '@prismflow/dsh': `file:${sourceArtifact.replaceAll('\\', '/')}` }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }, null, 2)}\n`)
  writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(sqlitePackage, 'package.json'), '{"version":"0.1.2-rc.1"}\n')
  writeFileSync(join(domainPackage, 'package.json'), '{"version":"0.1.2-rc.1"}\n')
  const fakePnpm = join(bin, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  writeFileSync(fakePnpm, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n')
  if (process.platform !== 'win32') chmodSync(fakePnpm, 0o755)
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/install.mjs', import.meta.url)), '--profile', 'web', '--dsh-home', home], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` },
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const value = parse(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'))
  const nested = value.flatMap(operation => operation.insert ?? [])
  assert.equal(nested.filter(row => row.id === 'storage-sqlite').length, 1)
  assert.deepEqual(nested.filter(row => row.id === 'prismflow-dashboard'), [{ id: 'prismflow-dashboard', name: '@prismflow/dsh/ui', config: { dshHome: home, profileName: 'web' } }])
  assert.equal(value.filter(row => row.id === 'prismflow-store-content' && row.disabled === false).length, 1)
  const installedManifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  assert.equal(installedManifest.dsh.profile.bundles.filter(row => row === '@prismflow/dsh').length, 1)
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
  const durableArtifact = join(home, 'packages', `prismflow-dsh-${version}.tgz`)
  assert.equal(installedManifest.dependencies['@prismflow/dsh'], `file:${durableArtifact.replaceAll('\\', '/')}`)
  assert.equal(await readFile(durableArtifact, 'utf8'), 'verified-test-package')
  const manualRoot = join(home, 'prismflow-manual-import', `@prismflow-dsh-${version}`)
  assert.equal((await readdir(join(manualRoot, 'skills'))).filter(name => name.endsWith('.zip')).length, 3)
  assert.equal((await readdir(join(manualRoot, 'plugins'))).filter(name => name.endsWith('.zip')).length, 6)
  await assert.rejects(access(join(home, 'plugins', 'prismflow-personal', 'prismflow-personal-rss')), { code: 'ENOENT' })
  assert.doesNotMatch(result.stdout, /dashboard installed/u)
})

test('published package exposes the explicit installer without a postinstall hook', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.equal(packageJson.bin['prismflow-dsh-install'], './scripts/install.mjs')
  assert.equal(packageJson.scripts.postinstall, undefined)
  assert.ok(packageJson.files.includes('scripts/install.mjs'))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/install.mjs', import.meta.url)), '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /prismflow-dsh-install \[--profile/u)
  assert.match(result.stderr, /migrated automatically/u)
  const source = await readFile(new URL('../scripts/install.mjs', import.meta.url), 'utf8')
  assert.match(source, /starting verified automatic migration/u)
  assert.match(source, /listProcProcesses/u)
  assert.match(source, /--allow-build=sharp/u)
  assert.match(source, /configureDashboardRow/u)
  assert.doesNotMatch(source, /install-dashboard\.mjs/u)
  assert.match(readme, /plugin --profile web add --allow-build=sharp .* && dsh plugin --profile web exec prismflow-dsh-install/u)
  assert.doesNotMatch(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), /daily-brief|每日资讯简报/u)
  assert.doesNotMatch(source, /found .*JSON storage units but no SQLite database; stop every DSH process and rerun with/u)
})
