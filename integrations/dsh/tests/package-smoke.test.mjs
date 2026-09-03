import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const packageRoot = resolve(import.meta.dirname, '..')
const packageVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

test('packed package installs standalone and its publisher-profile bin exports an isolated Profile', { timeout: 180_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'prismflow-dsh-pack-smoke-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packs = join(root, 'packs'), home = join(root, 'home'), profile = join(home, 'profiles', 'web')
  mkdirSync(packs, { recursive: true }); mkdirSync(profile, { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"private":true}\n')
  writeFileSync(join(profile, 'package.json'), '{}\n')
  const fixture = readFileSync(join(packageRoot, 'tests', 'fixtures', 'web-profile-cordis.patch.yml'), 'utf8')
    .replace('__SQLITE_PATH__', join(home, 'storages', 'domain.sqlite').replaceAll('\\', '/'))
    .replace('__LOCAL_ROOT__', home.replaceAll('\\', '/'))
  writeFileSync(join(profile, 'cordis.patch.yml'), fixture)
  run(npm, ['pack', '--ignore-scripts', '--pack-destination', packs], { cwd: packageRoot })
  run(npm, ['install', '--ignore-scripts', '--legacy-peer-deps', join(packs, `prismflow-dsh-${packageVersion}.tgz`)], { cwd: root })
  const installed = join(root, 'node_modules', '@prismflow', 'dsh')
  assert.equal(existsSync(join(installed, 'skills', 'prismflow-daily-production')), false)
  assert.equal(existsSync(join(installed, 'plugins', 'personal', 'prismflow-personal-rss')), false)
  assert.equal(existsSync(join(installed, 'manual-import', 'skills', 'prismflow-daily-production.zip')), true)
  assert.equal(existsSync(join(installed, 'manual-import', 'skills', 'prismflow-ai-shortreport.zip')), true)
  assert.equal(existsSync(join(installed, 'manual-import', 'skills', 'prismflow-ai-shortreport')), false)
  assert.equal(existsSync(join(installed, 'manual-import', 'plugins', 'prismflow-personal-rss')), false)
  assert.equal(existsSync(join(installed, 'manual-import-src')), false)
  assert.equal(existsSync(join(installed, 'manual-import', 'plugins', 'prismflow-personal-rss.zip')), true)
  const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prismflow-dsh-profile.cmd' : 'prismflow-dsh-profile')
  const output = run(bin, ['export', '--profile', 'web'], { cwd: root, env: { ...process.env, DSH_HOME: home } })
  const document = JSON.parse(output)
  assert.equal(document.kind, 'PrismFlowPublisherProfileDocument/v2')
  assert.equal(document.rows.length, 4)
  assert.equal(JSON.stringify(document).includes(packageRoot), false)
})
