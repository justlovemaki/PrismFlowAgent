#!/usr/bin/env node
import process from 'node:process'
import { resolve } from 'node:path'
import { migrateJsonStorageToSqlite } from '../lib/storage-sqlite-migration.js'

const storageRoot = process.argv[2] ? resolve(process.argv[2]) : undefined
const databasePath = process.argv[3]
  ? resolve(process.argv[3])
  : storageRoot
    ? resolve(storageRoot, 'domain.sqlite')
    : undefined

if (!storageRoot || !databasePath || process.argv.length > 4) {
  console.error('Usage: prismflow-dsh-migrate-sqlite <storage-root> [database-path]')
  process.exitCode = 2
} else {
  try {
    const result = await migrateJsonStorageToSqlite({ storageRoot, databasePath })
    console.log(`Migrated ${result.unitCount} JSON units (${result.recordCount} records, ${result.globalCount} globals).`)
    console.log(`SQLite database: ${result.databasePath}`)
    console.log(`JSON backup: ${result.backupDirectory}`)
    console.log('JSON source files remain unchanged for rollback. Configure DSH storage-domain to use backend sqlite only after validating this database.')
  } catch (error) {
    console.error(`SQLite migration failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
