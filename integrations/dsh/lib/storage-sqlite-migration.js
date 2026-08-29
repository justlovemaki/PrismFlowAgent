import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, copyFile, link, mkdir, open, readFile, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'

const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/
const SQLITE_SCHEMA_VERSION = 1
const TOP_LEVEL_KEYS = ['global', 'tables', 'unit']
const UNIT_KEYS = ['name', 'version']

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value, expected) {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function quoteIdentifier(value) {
  if (!UNIT_NAME_RE.test(value)) throw new Error(`Unsafe SQLite identifier segment: ${value}`)
  return `"${value}"`
}

function recordTableName(unitName, tableName) {
  return `u_${unitName}_${tableName}`
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function removeSqliteArtifacts(path) {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-wal`, { force: true }),
    rm(`${path}-shm`, { force: true }),
  ])
}

function pathsEqual(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function validateUnitDocument(fileName, document) {
  if (!isPlainObject(document) || !exactKeys(document, TOP_LEVEL_KEYS)) {
    throw new Error(`Storage unit ${fileName} has an invalid top-level envelope`)
  }
  if (!isPlainObject(document.unit) || !exactKeys(document.unit, UNIT_KEYS)) {
    throw new Error(`Storage unit ${fileName} has an invalid unit header`)
  }
  const { name, version } = document.unit
  if (typeof name !== 'string' || !UNIT_NAME_RE.test(name)) {
    throw new Error(`Storage unit ${fileName} has an invalid unit name`)
  }
  if (fileName !== `${name}.json`) {
    throw new Error(`Storage unit ${fileName} does not match unit name ${name}`)
  }
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Storage unit ${fileName} has an invalid version`)
  }
  if (!isPlainObject(document.tables)) {
    throw new Error(`Storage unit ${fileName} has invalid tables`)
  }
  for (const [tableName, records] of Object.entries(document.tables)) {
    if (!UNIT_NAME_RE.test(tableName)) {
      throw new Error(`Storage unit ${fileName} has an invalid table name`)
    }
    if (!isPlainObject(records)) {
      throw new Error(`Storage unit ${fileName} table ${tableName} is not a record object`)
    }
  }
  return { fileName, name, version, global: document.global, tables: document.tables }
}

async function loadJsonUnits(storageRoot) {
  const entries = await readdir(storageRoot, { withFileTypes: true })
  const jsonEntries = entries.filter(entry => entry.name.endsWith('.json'))
  const nonFiles = jsonEntries.filter(entry => !entry.isFile())
  if (nonFiles.length > 0) throw new Error(`JSON storage unit is not a regular file: ${nonFiles[0].name}`)
  const fileNames = jsonEntries.map(entry => entry.name).sort()
  if (fileNames.length === 0) throw new Error(`No JSON storage units found in ${storageRoot}`)

  const units = []
  const names = new Set()
  for (const fileName of fileNames) {
    const text = await readFile(join(storageRoot, fileName), 'utf8')
    let document
    try {
      document = JSON.parse(text)
    } catch (error) {
      throw new Error(`Storage unit ${fileName} is not valid JSON`, { cause: error })
    }
    const unit = validateUnitDocument(fileName, document)
    if (names.has(unit.name)) throw new Error(`Duplicate storage unit name: ${unit.name}`)
    names.add(unit.name)
    units.push({ ...unit, text })
  }
  return units
}

function configureDatabase(db) {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE units (
      name    TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE unit_globals (
      unit  TEXT PRIMARY KEY REFERENCES units(name),
      value TEXT NOT NULL
    ) STRICT;
  `)
}

function migrateTransaction(db, units) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const insertUnit = db.prepare('INSERT INTO units (name, version) VALUES (?, ?)')
    const insertGlobal = db.prepare('INSERT INTO unit_globals (unit, value) VALUES (?, ?)')
    for (const unit of units) {
      insertUnit.run(unit.name, unit.version)
      for (const [tableName, records] of Object.entries(unit.tables)) {
        const physical = recordTableName(unit.name, tableName)
        db.exec(`
          CREATE TABLE ${quoteIdentifier(physical)} (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
          ) STRICT
        `)
        const insertRecord = db.prepare(`INSERT INTO ${quoteIdentifier(physical)} (key, value) VALUES (?, ?)`)
        for (const [key, value] of Object.entries(records)) insertRecord.run(key, JSON.stringify(value))
      }
      if (unit.global !== null) insertGlobal.run(unit.name, JSON.stringify(unit.global))
    }
    db.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch {}
    throw error
  }
}

function validateDatabase(db, units) {
  const integrity = db.prepare('PRAGMA integrity_check').all()
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
    throw new Error('SQLite integrity check failed')
  }
  const { user_version: userVersion } = db.prepare('PRAGMA user_version').get()
  if (userVersion !== SQLITE_SCHEMA_VERSION) throw new Error('SQLite schema version validation failed')

  const actualUnits = db.prepare('SELECT name, version FROM units ORDER BY name').all()
  const expectedUnits = units.map(unit => ({ name: unit.name, version: unit.version })).sort((a, b) => a.name.localeCompare(b.name))
  if (canonicalJson(actualUnits) !== canonicalJson(expectedUnits)) throw new Error('SQLite unit metadata validation failed')

  let recordCount = 0
  for (const unit of units) {
    for (const [tableName, expectedRecords] of Object.entries(unit.tables)) {
      const physical = recordTableName(unit.name, tableName)
      const rows = db.prepare(`SELECT key, value FROM ${quoteIdentifier(physical)} ORDER BY key`).all()
      const actualRecords = Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value)]))
      if (canonicalJson(actualRecords) !== canonicalJson(expectedRecords)) {
        throw new Error(`SQLite record validation failed for ${unit.name}.${tableName}`)
      }
      recordCount += rows.length
    }
  }

  const actualGlobals = Object.fromEntries(
    db.prepare('SELECT unit, value FROM unit_globals ORDER BY unit').all().map(row => [row.unit, JSON.parse(row.value)]),
  )
  const expectedGlobals = Object.fromEntries(units.filter(unit => unit.global !== null).map(unit => [unit.name, unit.global]))
  if (canonicalJson(actualGlobals) !== canonicalJson(expectedGlobals)) throw new Error('SQLite global validation failed')
  return { recordCount, globalCount: Object.keys(actualGlobals).length }
}

function timestampForPath(now) {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z')
}

async function createBackups(storageRoot, units, now) {
  const backupDirectory = join(storageRoot, `json-backup-${timestampForPath(now)}`)
  await mkdir(backupDirectory, { recursive: false, mode: 0o700 })
  try {
    for (const unit of units) {
      const target = join(backupDirectory, unit.fileName)
      await copyFile(join(storageRoot, unit.fileName), target, fsConstants.COPYFILE_EXCL)
      if (await readFile(target, 'utf8') !== unit.text) throw new Error(`Backup verification failed for ${unit.fileName}`)
    }
    return backupDirectory
  } catch (error) {
    await rm(backupDirectory, { recursive: true, force: true })
    throw error
  }
}

export async function migrateJsonStorageToSqlite({ storageRoot, databasePath, now = new Date() }) {
  if (typeof storageRoot !== 'string' || !storageRoot.trim()) throw new Error('storageRoot is required')
  if (typeof databasePath !== 'string' || !databasePath.trim()) throw new Error('databasePath is required')
  const root = resolve(storageRoot)
  const target = resolve(databasePath)
  if (!pathsEqual(dirname(target), root)) throw new Error('databasePath must be a direct child of storageRoot')
  if (await pathExists(target) || await pathExists(`${target}-wal`) || await pathExists(`${target}-shm`)) {
    throw new Error(`SQLite target already exists: ${target}`)
  }

  const units = await loadJsonUnits(root)
  const temporary = join(root, `.${basename(target)}.${randomUUID()}.tmp`)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const handle = await open(temporary, 'wx', 0o600)
  await handle.close()

  let db
  let backupDirectory
  let published = false
  try {
    db = new DatabaseSync(temporary)
    configureDatabase(db)
    migrateTransaction(db, units)
    const counts = validateDatabase(db, units)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    db = undefined
    await rm(`${temporary}-wal`, { force: true })
    await rm(`${temporary}-shm`, { force: true })
    backupDirectory = await createBackups(root, units, now)
    try {
      // link(2) is an atomic same-filesystem create-if-absent operation. Unlike
      // rename on Windows and POSIX, it cannot replace a target won by a race
      // after the preflight check.
      await link(temporary, target)
      published = true
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`SQLite target already exists: ${target}`, { cause: error })
      }
      throw error
    }
    await rm(temporary)
    return {
      databasePath: target,
      backupDirectory,
      unitCount: units.length,
      recordCount: counts.recordCount,
      globalCount: counts.globalCount,
    }
  } catch (error) {
    try { db?.close() } catch {}
    await removeSqliteArtifacts(temporary)
    // Once the no-clobber link succeeds the verified target is published and
    // must retain its rollback backup even if unlinking the temporary name
    // reports an error. Before publication, remove any partial backup.
    if (backupDirectory && !published) await rm(backupDirectory, { recursive: true, force: true })
    throw error
  }
}
