import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import process from 'node:process'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { migrateJsonStorageToSqlite } from '../lib/storage-sqlite-migration.js'

async function fixture() {
  const root = join(tmpdir(), `prismflow-storage-migration-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  return root
}

async function writeUnit(root, name, version, tables, global = null) {
  const document = { unit: { name, version }, global, tables }
  await writeFile(join(root, `${name}.json`), `${JSON.stringify(document, null, 2)}\n`)
  return document
}

async function temporaryArtifacts(root) {
  return (await readdir(root)).filter(name => /^\.domain\.sqlite\..*\.tmp(?:-wal|-shm)?$/.test(name))
}

test('migrates every JSON unit, record, and non-null global into one verified SQLite database', async t => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const content = await writeUnit(root, 'prismflow_content', 1, {
    items: {
      b: { title: '第二条', nested: { z: 2, a: 1 } },
      a: { title: 'First', values: [1, true, null] },
    },
  })
  const workspace = await writeUnit(root, 'workspace', 2, {
    workspaces: { default: { path: 'C:/workspace' } },
  }, { activeWorkspaceId: 'default' })
  const result = await migrateJsonStorageToSqlite({
    storageRoot: root,
    databasePath: join(root, 'domain.sqlite'),
    now: new Date('2026-08-19T12:34:56.789Z'),
  })

  assert.deepEqual({ unitCount: result.unitCount, recordCount: result.recordCount, globalCount: result.globalCount }, {
    unitCount: 2,
    recordCount: 3,
    globalCount: 1,
  })
  assert.equal(result.backupDirectory, join(root, 'json-backup-2026-08-19_12-34-56-789Z'))
  assert.deepEqual(JSON.parse(await readFile(join(result.backupDirectory, 'prismflow_content.json'), 'utf8')), content)
  assert.deepEqual(JSON.parse(await readFile(join(result.backupDirectory, 'workspace.json'), 'utf8')), workspace)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'prismflow_content.json'), 'utf8')), content)

  const db = new DatabaseSync(result.databasePath, { readOnly: true })
  assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row => ({ ...row })), [{ integrity_check: 'ok' }])
  assert.deepEqual({ ...db.prepare('PRAGMA user_version').get() }, { user_version: 1 })
  assert.deepEqual(db.prepare('SELECT name, version FROM units ORDER BY name').all().map(row => ({ ...row })), [
    { name: 'prismflow_content', version: 1 },
    { name: 'workspace', version: 2 },
  ])
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM u_prismflow_content_items').get().count, 2)
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM unit_globals WHERE unit = ?').get('workspace').value), workspace.global)
  assert.deepEqual(await temporaryArtifacts(root), [])
  db.close()

  const backend = new SqliteStorageBackend({ path: result.databasePath, journalMode: 'wal' })
  try {
    const contentUnit = await backend.kv.open({
      name: 'prismflow_content',
      version: 1,
      tables: ['items'],
      hasGlobal: false,
    })
    const loadedContent = await contentUnit.loadAll()
    assert.deepEqual({ ...loadedContent.tables.items }, content.tables.items)
    assert.equal(loadedContent.global, null)
    await contentUnit.close()

    const workspaceUnit = await backend.kv.open({
      name: 'workspace',
      version: 2,
      tables: ['workspaces'],
      hasGlobal: true,
    })
    const loadedWorkspace = await workspaceUnit.loadAll()
    assert.deepEqual({ ...loadedWorkspace.tables.workspaces }, workspace.tables.workspaces)
    assert.deepEqual(loadedWorkspace.global, workspace.global)
    await workspaceUnit.close()
  } finally {
    await backend.close()
  }
})

test('rejects malformed source envelopes before creating SQLite or backup state', async t => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeUnit(root, 'valid', 1, { rows: { one: { ok: true } } })
  await writeFile(join(root, 'invalid.json'), JSON.stringify({
    unit: { name: 'invalid', version: 1 },
    global: null,
    tables: { 'bad-table': {} },
  }))

  await assert.rejects(migrateJsonStorageToSqlite({
    storageRoot: root,
    databasePath: join(root, 'domain.sqlite'),
  }), /invalid table name/)
  await assert.rejects(readFile(join(root, 'domain.sqlite')), error => error.code === 'ENOENT')
  assert.equal((await readdir(root)).some(name => name.startsWith('json-backup-')), false)
  assert.deepEqual(await temporaryArtifacts(root), [])
})

test('refuses an existing SQLite target without reading or mutating source files', async t => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeUnit(root, 'valid', 1, { rows: { one: { ok: true } } })
  const target = join(root, 'domain.sqlite')
  await writeFile(target, 'existing-target')

  await assert.rejects(migrateJsonStorageToSqlite({ storageRoot: root, databasePath: target }), /target already exists/)
  assert.equal(await readFile(target, 'utf8'), 'existing-target')
  assert.equal((await readdir(root)).some(name => name.startsWith('json-backup-')), false)
  assert.deepEqual(await temporaryArtifacts(root), [])
})

test('accepts a Windows direct-child path whose root casing differs', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeUnit(root, 'valid', 1, { rows: { one: { ok: true } } })
  const differentlyCasedRoot = `${root[0].toLowerCase()}${root.slice(1)}`

  const result = await migrateJsonStorageToSqlite({
    storageRoot: differentlyCasedRoot,
    databasePath: join(root, 'domain.sqlite'),
  })
  assert.equal(result.databasePath, join(root, 'domain.sqlite'))
})

test('atomically refuses a target created after preflight and cleans migration artifacts', async t => {
  const root = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  for (let index = 0; index < 16; index += 1) {
    await writeUnit(root, `unit_${index}`, 1, { rows: { one: { index, text: 'x'.repeat(32_768) } } })
  }
  const target = join(root, 'domain.sqlite')
  const backupDirectory = join(root, 'json-backup-2026-08-20_01-02-03-000Z')

  const competitor = (async () => {
    while (true) {
      try {
        await access(backupDirectory)
        await writeFile(target, 'concurrent-winner', { flag: 'wx' })
        return
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }
  })()

  await assert.rejects(migrateJsonStorageToSqlite({
    storageRoot: root,
    databasePath: target,
    now: new Date('2026-08-20T01:02:03.000Z'),
  }), /target already exists/)
  await competitor

  assert.equal(await readFile(target, 'utf8'), 'concurrent-winner')
  assert.deepEqual(await temporaryArtifacts(root), [])
  assert.equal((await readdir(root)).some(name => name.startsWith('json-backup-')), false)
})
