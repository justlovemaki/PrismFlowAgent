import assert from 'node:assert/strict'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import {
  GeneratorPromptConflictError,
  GeneratorPromptCorruptError,
  GeneratorPromptValidationError,
  PROMPT_HISTORY_LIMIT,
  PrismGeneratorPromptStore,
  generatorPromptSha256,
} from '../lib/store-generator-prompts.js'
import { projectEffectivePersonas } from '../lib/generator-prompt-policy.js'

class Table {
  constructor() { this.map = new Map(); this.puts = 0 }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  async put(key, value) { this.puts += 1; this.map.set(key, structuredClone(value)); return value }
}
function defaults() {
  return { id: 'daily-brief', name: 'Daily Brief', persona: 'deployment writer', instruction: 'deployment instruction',
    reviewPersona: 'deployment reviewer', reviewInstruction: 'deployment review instruction' }
}
function fixture(config = {}) {
  const service = new PrismGeneratorPromptStore(new Context(), config)
  service.historyTable = new Table()
  return service
}
function slot(version) { return ((version - 1) % PROMPT_HISTORY_LIMIT) + 1 }
function seedRow(service, version, prompts, overrides = {}) {
  const row = {
    generatorId: 'daily-brief', generatorName: 'Daily Brief', ...prompts, version,
    sha256: generatorPromptSha256(prompts), updatedAt: `2026-01-01T00:${String(version % 60).padStart(2, '0')}:00.000Z`,
    actor: version === 1 ? 'deployment' : 'dashboard-admin', action: version === 1 ? 'bootstrap' : 'update',
    sourceVersion: version === 1 ? 0 : version - 1, ...overrides,
  }
  service.historyTable.map.set(`daily-brief:${String(slot(version)).padStart(10, '0')}`, structuredClone(row))
  return row
}

test('package keeps the internal compatibility prompt store without prompt-admin metadata', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.ok(packageJson.exports['./store-generator-prompts'])
  assert.equal(Object.keys(packageJson.exports).some(key => key.startsWith('./tool-') && key.includes('prompt')), false)
  assert.equal(PROMPT_HISTORY_LIMIT, 50)
  assert.match(patch, /id: prismflow-store-generator-prompts[\s\S]*?disabled: true[\s\S]*?maxHistoryPerGenerator: 50/u)
  assert.equal(packageJson.keywords.includes('prompt-admin'), false)
})

test('prompt store bootstraps the original four-field immutable row for compatibility resolution', async () => {
  const service = fixture(); const unregister = service.register(defaults())
  const first = await service.snapshot('daily-brief')
  assert.equal(first.version, 1); assert.equal(first.action, 'bootstrap'); assert.equal(first.actor, 'deployment')
  assert.match(first.sha256, /^[a-f0-9]{64}$/u)
  assert.deepEqual(Object.keys(first).sort(), [
    'action', 'actor', 'generatorId', 'generatorName', 'instruction', 'persona', 'reviewInstruction', 'reviewPersona',
    'sha256', 'sourceVersion', 'updatedAt', 'version',
  ].sort())
  assert.equal(service.historyTable.get('daily-brief:0000000001').sha256, first.sha256)
  assert.deepEqual((await service.list()).map(item => item.generatorId), ['daily-brief'])
  assert.deepEqual((await service.history('daily-brief')).map(item => item.version), [1])
  assert.equal(service.historyTable.puts, 1)
  unregister(); await assert.rejects(service.snapshot('daily-brief'), GeneratorPromptValidationError)
})

test('compatibility store exposes no prompt update, rollback, or rolling-write seam', () => {
  const service = fixture()
  for (const method of ['updatePersonas', 'rollback', 'putRolling']) assert.equal(typeof service[method], 'undefined', method)
  assert.equal(typeof service.snapshot, 'function')
  assert.equal(typeof service.history, 'function')
  assert.equal(typeof service.withExpectedSnapshot, 'function')
})

test('retained old rows preserve exact hashes and resolve contiguous rolling history read-only', async () => {
  const service = fixture(); service.register(defaults())
  const rows = []
  for (let version = 26; version <= 75; version += 1) {
    const prompts = { persona: `old writer ${version}`, instruction: `old instruction ${version}`,
      reviewPersona: `old reviewer ${version}`, reviewInstruction: `old review ${version}` }
    rows.push(seedRow(service, version, prompts, version === 26 ? { action: 'update', actor: 'dashboard-admin', sourceVersion: 25 } : {}))
  }
  const current = await service.snapshot('daily-brief')
  assert.equal(current.version, 75); assert.equal(current.sha256, rows.at(-1).sha256)
  assert.deepEqual((await service.history('daily-brief', 10)).map(row => row.version), [75, 74, 73, 72, 71, 70, 69, 68, 67, 66])
  assert.deepEqual((await service.history('daily-brief', 10, 66)).map(row => row.version), [65, 64, 63, 62, 61, 60, 59, 58, 57, 56])
  await assert.rejects(service.snapshot('daily-brief', 25), /Unknown generator prompt version/u)
  assert.equal((await service.snapshot('daily-brief', 26)).sha256, rows[0].sha256)
  assert.equal(service.historyTable.puts, 0, 'reads must not rewrite retained rows')
  assert.throws(() => service.history('daily-brief', 51), GeneratorPromptValidationError)
})

test('legacy adoption holds the exact prompt version and hash boundary without mutating prompt history', async () => {
  const service = fixture(); service.register(defaults())
  const prompts = { persona: 'old writer', instruction: 'old instruction', reviewPersona: 'old reviewer', reviewInstruction: 'old review' }
  const current = seedRow(service, 1, prompts)
  await assert.rejects(service.withExpectedSnapshot('daily-brief', 1, 'f'.repeat(64), () => 'nope'), GeneratorPromptConflictError)
  let adopted = false
  service.registerAdoptionResolver('daily-brief', () => adopted)
  const result = await service.withExpectedSnapshot('daily-brief', current.version, current.sha256, snapshot => {
    assert.equal(snapshot.sha256, current.sha256); adopted = true; return 'adopted'
  })
  assert.equal(result, 'adopted')
  assert.equal(service.historyTable.puts, 0)
  assert.deepEqual(service.historyTable.get('daily-brief:0000000001'), current)
  await assert.rejects(service.withExpectedSnapshot('daily-brief', current.version, current.sha256, () => 'again'), /adopted by workflow administration/u)
})

test('retained legacy four-field rows project deterministically without altering hash or text', async () => {
  const service = fixture(); service.register(defaults())
  const prompts = { persona: 'old writer', instruction: 'old editorial rules', reviewPersona: 'old reviewer', reviewInstruction: 'old review rules' }
  const row = seedRow(service, 1, prompts)
  const retained = await service.snapshot('daily-brief', 1)
  assert.equal(retained.sha256, row.sha256)
  assert.equal(retained.instruction, prompts.instruction)
  assert.deepEqual(projectEffectivePersonas(retained), {
    persona: 'old writer\n\nold editorial rules', reviewPersona: 'old reviewer\n\nold review rules',
  })
  assert.deepEqual(service.historyTable.get('daily-brief:0000000001'), row)
})

test('oversized legacy persona composition fails closed without exposing stored text', () => {
  const secret = 'private-editorial-text-'
  assert.throws(
    () => projectEffectivePersonas({ persona: 'p'.repeat(6000), instruction: secret.repeat(250), reviewPersona: 'reviewer', reviewInstruction: 'review' }),
    error => /stage-one prompt projects to \d+ persona characters; the migration limit is 10000/u.test(error.message)
      && !error.message.includes(secret),
  )
})

test('malformed or incomplete retained history fails closed', async () => {
  const service = fixture(); service.register(defaults())
  const prompts = { persona: 'p', instruction: 'i', reviewPersona: 'rp', reviewInstruction: 'ri' }
  seedRow(service, 1, prompts); seedRow(service, 3, prompts)
  await assert.rejects(service.snapshot('daily-brief'), GeneratorPromptCorruptError)
  const corrupt = fixture(); corrupt.register(defaults()); const row = seedRow(corrupt, 1, prompts)
  corrupt.historyTable.map.set('daily-brief:0000000001', { ...row, hidden: true })
  await assert.rejects(corrupt.snapshot('daily-brief'), GeneratorPromptCorruptError)
})

test('retention configuration remains fixed for compatibility with existing circular slots', () => {
  assert.throws(() => fixture({ maxHistoryPerGenerator: 49 }), GeneratorPromptValidationError)
  assert.throws(() => fixture({ maxHistoryPerGenerator: 51 }), GeneratorPromptValidationError)
})

test('prompt-store initialization closes an opened domain when table lookup or effect registration fails', async () => {
  for (const seam of ['table', 'effect']) {
    let closed = 0
    const service = new PrismGeneratorPromptStore(new Context())
    service.ctx = {
      storageDomain: { async open() { return {
        table() { if (seam === 'table') throw new Error('table lookup failed'); return new Table() },
        async close() { closed += 1 },
      } } },
      effect() { throw new Error('effect registration failed') },
    }
    await assert.rejects(service[Service.init](), new RegExp(seam === 'table' ? 'table lookup failed' : 'effect registration failed'))
    assert.equal(closed, 1); assert.equal(service.historyTable, undefined)
  }
})
