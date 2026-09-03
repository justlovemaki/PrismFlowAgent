import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync, gunzipSync } from 'node:zlib'
import YAML from 'yaml'
import {
  createPrismFlowDataBackup, decryptPrismFlowDataBackup, encryptPrismFlowDataBackup, parsePrismFlowDataBackup,
  LEGACY_PRISMFLOW_DATA_BACKUP_KIND, LEGACY_PRISMFLOW_DATA_BACKUP_KIND_V1, LEGACY_PRISMFLOW_DATA_BACKUP_KIND_V3,
  PRISMFLOW_DATA_BACKUP_KIND, PRISMFLOW_ENCRYPTED_BACKUP_KIND, readSourceCredentialSlots,
  PRISMFLOW_DATA_UNITS, PrismFlowDataBackupError, restorePrismFlowDataBackup,
} from '../lib/data-backup.js'
import { normalizePublisherConfig } from '../lib/shared/publisher-profile.js'

function tableName(unit, table) { return `u_${unit}_${table}` }
function createDatabase(path, marker = 'source') {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA user_version = 1; CREATE TABLE units (name TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT; CREATE TABLE unit_globals (unit TEXT PRIMARY KEY REFERENCES units(name), value TEXT NOT NULL) STRICT')
  for (const unit of PRISMFLOW_DATA_UNITS) {
    db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run(unit.name, unit.version)
    for (const table of unit.tables) {
      db.exec(`CREATE TABLE "${tableName(unit.name, table)}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
      db.prepare(`INSERT INTO "${tableName(unit.name, table)}" (key, value) VALUES (?, ?)`).run(`${marker}:${table}`, JSON.stringify({ marker, unit: unit.name, table }))
    }
  }
  db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run('prismflow_content', 1)
  db.exec('CREATE TABLE u_prismflow_content_items (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
  db.prepare('INSERT INTO u_prismflow_content_items (key, value) VALUES (?, ?)').run('fetched-content', JSON.stringify({ marker }))
  db.close()
}
function readRows(path, unit, table) {
  const db = new DatabaseSync(path, { readOnly: true })
  try { return db.prepare(`SELECT key, value FROM "${tableName(unit, table)}" ORDER BY key`).all().map(row => ({ key: row.key, value: row.value })) }
  finally { db.close() }
}

test('configuration backup round-trips source and operator settings while excluding fetched content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prismflow-backup-'))
  try {
    const source = join(root, 'source.sqlite'); const target = join(root, 'target.sqlite')
    const targetHome = join(root, 'target-dsh'); const targetProfile = join(targetHome, 'profiles', 'web'); const targetPatch = join(targetProfile, 'cordis.patch.yml')
    createDatabase(source, 'source'); createDatabase(target, 'target'); await mkdir(targetProfile, { recursive: true }); await writeFile(join(targetProfile, 'package.json'), '{}\n')
    await writeFile(targetPatch, '- id: prismflow-store-source-settings\n  disabled: false\n  config:\n    credentialSlots: []\n    bootstrap:\n      - type: rss\n        id: target-default\n')
    const sourceDb = new DatabaseSync(source)
    sourceDb.prepare('INSERT INTO u_prismflow_generator_workflows_history (key, value) VALUES (?, ?)').run('@workflow:10', JSON.stringify({ marker: 'binary-order' }))
    sourceDb.prepare('INSERT INTO u_prismflow_generator_workflows_history (key, value) VALUES (?, ?)').run('workflow:02', JSON.stringify({ marker: 'binary-order' }))
    sourceDb.prepare('INSERT INTO u_prismflow_toolsets_records (key, value) VALUES (?, ?)').run('skill:prismflow-ai-shortreport:01', JSON.stringify({ marker: 'source-personal-skill' }))
    sourceDb.prepare('INSERT INTO u_prismflow_generator_prompts_history (key, value) VALUES (?, ?)').run('daily-brief:0000000001', JSON.stringify({ marker: 'retired-default-prompt' }))
    sourceDb.prepare('INSERT INTO u_prismflow_generator_workflows_history (key, value) VALUES (?, ?)').run('daily-brief:0000000001', JSON.stringify({ marker: 'retired-default-workflow' }))
    sourceDb.prepare('INSERT INTO u_prismflow_generator_workflows_history (key, value) VALUES (?, ?)').run('deleted-workflow:0000000001', JSON.stringify({ action: 'delete' }))
    sourceDb.close()
    const targetDb = new DatabaseSync(target)
    targetDb.prepare('INSERT INTO u_prismflow_toolsets_records (key, value) VALUES (?, ?)').run('skill:prismflow-manually-imported:01', JSON.stringify({ marker: 'target-manual-skill' }))
    targetDb.close()
    const slots = [{ id: 'follow-cookie', name: 'Follow Cookie', usage: 'follow-cookie', credentialRef: 'PRISMFLOW_FOLLOW_COOKIE', allowDashboardWrite: true }]
    const credentials = [{ ref: 'GITHUB_TOKEN', value: 'private-github-token' }, { ref: 'OPENAI_IMAGE_API_KEY', value: null }, { ref: 'PRISMFLOW_FOLLOW_COOKIE', value: 'private-follow-cookie' }]
    const publisherRows = [
      { rowId: 'prismflow-publisher-local-markdown', channelKind: 'local-markdown', disabled: true, config: { destinations: [] } },
      { rowId: 'prismflow-publisher-github-markdown', channelKind: 'github-markdown', disabled: false, config: { destinations: [{ id: 'archive', name: 'GitHub Archive', repository: 'owner/repository', tokenCredential: 'GITHUB_TOKEN' }] } },
      { rowId: 'prismflow-publisher-r2-markdown', channelKind: 'r2-markdown', disabled: true, config: { destinations: [] } },
      { rowId: 'prismflow-publisher-wechat-draft', channelKind: 'wechat-draft', disabled: true, config: { destinations: [] } },
    ]
    const exported = createPrismFlowDataBackup(source, '0.24.56', new Date('2026-09-02T12:00:00.000Z'), slots, credentials, publisherRows)
    assert.ok(exported.buffer.length > 0); assert.equal(exported.document.kind, PRISMFLOW_DATA_BACKUP_KIND)
    assert.equal(exported.workflowHistoryCount, 5); assert.equal(exported.workflowIdCount, 1)
    assert.equal(exported.workflowHistoricalIdCount, 2); assert.equal(exported.deletedWorkflowIdCount, 1)
    assert.equal(exported.document.units.length, PRISMFLOW_DATA_UNITS.length)
    assert.equal(exported.recordCount, PRISMFLOW_DATA_UNITS.reduce((sum, unit) => sum + unit.tables.length, 0) + 5)
    const encrypted = encryptPrismFlowDataBackup(exported.buffer, 'correct horse battery staple')
    assert.equal(JSON.parse(encrypted).kind, PRISMFLOW_ENCRYPTED_BACKUP_KIND); assert.equal(encrypted.includes('private-follow-cookie'), false); assert.equal(encrypted.includes('private-github-token'), false)
    assert.throws(() => decryptPrismFlowDataBackup(encrypted, 'incorrect password'), /incorrect|modified/u)
    const decrypted = decryptPrismFlowDataBackup(encrypted, 'correct horse battery staple')
    const parsed = parsePrismFlowDataBackup(decrypted)
    assert.equal(parsed.fingerprint, exported.document.fingerprint); assert.deepEqual(parsed.payload.sourceCredentialSlots, slots); assert.deepEqual(parsed.payload.credentials, credentials)
    assert.equal(parsed.payload.publisherRows[1].config.destinations[0].repository, 'owner/repository')
    const foreignDocument = JSON.parse(gunzipSync(exported.buffer).toString('utf8'))
    const foreignRoot = process.platform === 'win32' ? '/srv/source/publications' : 'C:\\Users\\source\\publications'
    foreignDocument.publisherRows[0] = { rowId: 'prismflow-publisher-local-markdown', channelKind: 'local-markdown', disabled: false,
      config: normalizePublisherConfig('local-markdown', { destinations: [{ id: 'archive', name: 'Archive', root: foreignRoot }] }, { allowPortableAbsolutePaths: true }) }
    const { fingerprint: _foreignFingerprint, ...foreignPayload } = foreignDocument
    foreignDocument.fingerprint = createHash('sha256').update(JSON.stringify(foreignPayload)).digest('hex')
    const foreignBuffer = gzipSync(JSON.stringify(foreignDocument))
    assert.equal(parsePrismFlowDataBackup(foreignBuffer).payload.publisherRows[0].config.destinations[0].root, foreignRoot)
    assert.equal(parsed.payload.units.some(unit => unit.name === 'prismflow_content'), false, 'fetched content must not be exported')
    const toolsetRecords = parsed.payload.units.find(unit => unit.name === 'prismflow_toolsets').tables[0].records
    assert.equal(toolsetRecords.some(record => record.key.includes('prismflow-ai-shortreport')), false, 'personal Skills require separate ZIP import')
    assert.equal(parsed.payload.units.filter(unit => unit.name === 'prismflow_generator_prompts' || unit.name === 'prismflow_generator_workflows')
      .some(unit => unit.tables.some(table => table.records.some(record => record.key.startsWith('daily-brief:')))), true, 'existing generator configuration must be exported')
    const legacyDocument = JSON.parse(gunzipSync(exported.buffer).toString('utf8'))
    legacyDocument.kind = LEGACY_PRISMFLOW_DATA_BACKUP_KIND
    const legacyRecords = legacyDocument.units.find(unit => unit.name === 'prismflow_toolsets').tables[0].records
    legacyRecords.push({ key: 'skill:prismflow-legacy-personal:01', value: '{"legacy":true}' })
    legacyRecords.sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)))
    const { fingerprint: _legacyFingerprint, ...legacyPayload } = legacyDocument
    legacyDocument.fingerprint = createHash('sha256').update(JSON.stringify(legacyPayload)).digest('hex')
    const migratedLegacy = parsePrismFlowDataBackup(gzipSync(JSON.stringify(legacyDocument)))
    assert.equal(migratedLegacy.migratedFrom, LEGACY_PRISMFLOW_DATA_BACKUP_KIND); assert.equal(migratedLegacy.payload.kind, PRISMFLOW_DATA_BACKUP_KIND)
    assert.equal(migratedLegacy.payload.units.find(unit => unit.name === 'prismflow_toolsets').tables[0].records.some(record => record.key.includes('legacy-personal')), false)
    assert.equal(migratedLegacy.payload.units.find(unit => unit.name === 'prismflow_generator_prompts').tables[0].records.some(record => record.key.startsWith('daily-brief:')), true)
    const legacyV3Document = structuredClone(legacyDocument); legacyV3Document.kind = LEGACY_PRISMFLOW_DATA_BACKUP_KIND_V3
    const { fingerprint: _legacyV3Fingerprint, ...legacyV3Payload } = legacyV3Document
    legacyV3Document.fingerprint = createHash('sha256').update(JSON.stringify(legacyV3Payload)).digest('hex')
    assert.equal(parsePrismFlowDataBackup(gzipSync(JSON.stringify(legacyV3Document))).migratedFrom, LEGACY_PRISMFLOW_DATA_BACKUP_KIND_V3)
    const legacyV1Document = structuredClone(legacyDocument); legacyV1Document.kind = LEGACY_PRISMFLOW_DATA_BACKUP_KIND_V1; delete legacyV1Document.publisherRows
    const { fingerprint: _legacyV1Fingerprint, ...legacyV1Payload } = legacyV1Document
    legacyV1Document.fingerprint = createHash('sha256').update(JSON.stringify(legacyV1Payload)).digest('hex')
    const migratedLegacyV1 = parsePrismFlowDataBackup(gzipSync(JSON.stringify(legacyV1Document)))
    assert.equal(migratedLegacyV1.migratedFrom, LEGACY_PRISMFLOW_DATA_BACKUP_KIND_V1); assert.equal(migratedLegacyV1.payload.publisherRows, null)
    const restored = restorePrismFlowDataBackup(target, foreignBuffer, targetPatch, { profileName: 'web', dshHome: targetHome })
    assert.equal(restored.recordCount, exported.recordCount); assert.equal(restored.sourcePluginVersion, '0.24.56'); assert.equal(restored.credentialSlotCount, 1); assert.equal(restored.publisherDestinationCount, 2)
    assert.equal(restored.publisherPathMappings.length, 1); assert.equal(restored.workflowHistoryCount, 5); assert.equal(restored.workflowIdCount, 1)
    assert.equal(restored.workflowHistoricalIdCount, 2); assert.equal(restored.deletedWorkflowIdCount, 1)
    const restoredPatch = await readFile(targetPatch, 'utf8')
    assert.deepEqual(readSourceCredentialSlots(restoredPatch), slots)
    const restoredRows = YAML.parse(restoredPatch)
    const restoredGithub = restoredRows.find(row => row.id === 'prismflow-publisher-github-markdown')
    assert.equal(restoredGithub.disabled, false); assert.equal(restoredGithub.config.destinations[0].repository, 'owner/repository')
    const restoredLocal = restoredRows.find(row => row.id === 'prismflow-publisher-local-markdown')
    assert.equal(restoredLocal.config.destinations[0].root, join(targetHome, 'publications', 'archive'))
    assert.equal((await stat(restoredLocal.config.destinations[0].root)).isDirectory(), true)
    assert.equal((await readFile(targetPatch, 'utf8')).includes('target-default'), false, 'target bootstrap must not repopulate omitted sources')
    for (const unit of PRISMFLOW_DATA_UNITS) for (const table of unit.tables) {
      const profileLocal = record => /^skill:(?!prismflow-(?:source-ingestion|draft-revision):)/u.test(record.key) || record.key.startsWith('@plugin-tombstone:')
      const portable = record => !(unit.name === 'prismflow_toolsets' && table === 'records' && profileLocal(record))
      const targetRows = readRows(target, unit.name, table); const sourceRows = readRows(source, unit.name, table)
      assert.deepEqual(targetRows.filter(portable), sourceRows.filter(portable), `${unit.name}.${table}`)
    }
    assert.equal(JSON.parse(readRows(target, 'prismflow_content', 'items')[0].value).marker, 'target', 'fetched content must remain untouched')
    const restoredToolsets = readRows(target, 'prismflow_toolsets', 'records')
    assert.equal(restoredToolsets.some(record => record.key === 'skill:prismflow-manually-imported:01'), true, 'target manually imported Skill must remain')
    assert.equal(restoredToolsets.some(record => record.key === 'skill:prismflow-ai-shortreport:01'), false, 'source personal Skill must not be restored')
    assert.equal(readRows(target, 'prismflow_generator_prompts', 'history').some(record => record.key.startsWith('daily-brief:')), true)
    assert.equal(readRows(target, 'prismflow_generator_workflows', 'history').some(record => record.key.startsWith('daily-brief:')), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('configuration restore rejects tampering, unknown fields, duplicate keys, and unsupported destination schemas without mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prismflow-backup-reject-'))
  try {
    const source = join(root, 'source.sqlite'); const target = join(root, 'target.sqlite'); const targetPatch = join(root, 'cordis.patch.yml')
    createDatabase(source, 'source'); createDatabase(target, 'target')
    await writeFile(targetPatch, '- id: prismflow-store-source-settings\n  disabled: false\n')
    const exported = createPrismFlowDataBackup(source, '0.24.56', new Date('2026-09-02T12:00:00.000Z'))
    const mutate = callback => {
      const value = JSON.parse(gunzipSync(exported.buffer).toString('utf8')); callback(value)
      return gzipSync(Buffer.from(JSON.stringify(value)))
    }
    for (const invalid of [
      mutate(value => { value.units[0].tables[0].records[0].value = JSON.stringify({ changed: true }) }),
      mutate(value => { value.unexpected = true }),
      mutate(value => { value.units[0].tables[0].records.push({ ...value.units[0].tables[0].records[0] }) }),
      mutate(value => { value.publisherRows[0].unexpected = true }),
      mutate(value => { value.units.find(unit => unit.name === 'prismflow_toolsets').tables[0].records.push({ key: 'skill:prismflow-personal:01', value: '{}' }) }),
    ]) assert.throws(() => restorePrismFlowDataBackup(target, invalid, targetPatch), PrismFlowDataBackupError)
    assert.equal(JSON.parse(readRows(target, 'prismflow_content', 'items')[0].value).marker, 'target')

    const broken = new DatabaseSync(target)
    broken.exec('DROP TABLE u_prismflow_source_settings_sources')
    broken.close()
    assert.throws(() => restorePrismFlowDataBackup(target, exported.buffer, targetPatch), /missing or has an unsupported schema/u)
    assert.equal(JSON.parse(readRows(target, 'prismflow_content', 'items')[0].value).marker, 'target', 'schema validation must happen before replacement')
  } finally { await rm(root, { recursive: true, force: true }) }
})
