import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'

test('SQLite keeps existing production v1 rows while adding selection, prompt, and workflow v1 tables', async t => {
  const path = join(tmpdir(), `prismflow-selection-compat-${randomUUID()}.sqlite`)
  t.after(() => rm(path, { force: true }))
  const backend = new SqliteStorageBackend({ path, journalMode: 'wal' })
  const old = { requestId: 'old', generatorId: 'daily', contentStoreIds: ['a'], status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  try {
    const production = await backend.kv.open({ name: 'prismflow_production', version: 1, tables: ['requests', 'drafts'], hasGlobal: false })
    await production.putRecord('requests', 'old', old)
    await production.close()
    const reopened = await backend.kv.open({ name: 'prismflow_production', version: 1, tables: ['requests', 'drafts'], hasGlobal: false })
    assert.deepEqual({ ...((await reopened.loadAll()).tables.requests.old) }, old)
    await reopened.close()
    const selection = await backend.kv.open({ name: 'prismflow_content_selection', version: 1, tables: ['reviews', 'selections'], hasGlobal: false })
    await selection.putRecord('reviews', 'a', { decision: 'relevant' })
    assert.deepEqual({ ...((await selection.loadAll()).tables.reviews.a) }, { decision: 'relevant' })
    await selection.close()
    const prompts = await backend.kv.open({ name: 'prismflow_generator_prompts', version: 1, tables: ['history'], hasGlobal: false })
    await prompts.putRecord('history', 'daily:0000000001', { version: 1 })
    assert.deepEqual({ ...((await prompts.loadAll()).tables.history['daily:0000000001']) }, { version: 1 })
    await prompts.close()
    const workflows = await backend.kv.open({ name: 'prismflow_generator_workflows', version: 1, tables: ['history'], hasGlobal: false })
    await workflows.putRecord('history', 'dashboard:0000000001', { format: 'workflow-v1', version: 1 })
    await workflows.close()
    const reopenedWorkflows = await backend.kv.open({ name: 'prismflow_generator_workflows', version: 1, tables: ['history'], hasGlobal: false })
    assert.equal((await reopenedWorkflows.loadAll()).tables.history['dashboard:0000000001'].format, 'workflow-v1')
    await reopenedWorkflows.close()
  } finally { await backend.close() }
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(db.prepare("SELECT name, version FROM units WHERE name LIKE 'prismflow_%' ORDER BY name").all().map(row => ({ ...row })), [
      { name: 'prismflow_content_selection', version: 1 }, { name: 'prismflow_generator_prompts', version: 1 },
      { name: 'prismflow_generator_workflows', version: 1 }, { name: 'prismflow_production', version: 1 },
    ])
  } finally { db.close() }
})
