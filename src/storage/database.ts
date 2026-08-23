/**
 * SQLite bootstrap for punchcraft.
 *
 * Opens the shared on-device database (expo-sqlite) with WAL journaling and
 * foreign keys enabled, then applies pending migrations. Storage is
 * deliberately decoupled from the BLE transport — nothing in this module,
 * or the migrations/repositories it fans out to, may import from src/ble/**.
 */

import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite'

import { logger, safe } from '@/diagnostics/logger'
import { runMigrations } from '@/storage/migrations/001_initial'

const DB_NAME = 'punchcraft.db'

let dbInstance: SQLiteDatabase | null = null

/**
 * Open the punchcraft database (idempotent within the process). Configures
 * PRAGMAs and runs migrations on first open.
 */
export function openDatabase(): SQLiteDatabase {
  if (dbInstance) return dbInstance
  const db = openDatabaseSync(DB_NAME)
  // WAL gives us concurrent readers alongside the capture writer; foreign
  // keys must be enabled per-connection since the default is OFF.
  db.execSync('PRAGMA journal_mode = WAL;')
  db.execSync('PRAGMA foreign_keys = ON;')
  runMigrations(db)
  dbInstance = db
  logger.info('storage.open', 'punchcraft.db opened', { name: safe(DB_NAME) })
  return db
}

/** Reset the process-wide handle. Intended for tests. */
export function __resetDatabaseForTests(): void {
  dbInstance = null
}
