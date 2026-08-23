/**
 * Migration registry + runner.
 *
 * The runner is intentionally tiny: a schema_migrations table records applied
 * ids, and pending migrations execute in ascending id order, each inside its
 * own transaction. Add a new migration by creating `NNN_name.ts` next to this
 * file and appending it to MIGRATIONS.
 *
 * A migration is append-only once it has shipped — never edit a migration
 * that may already have run on a device, because schema_migrations will not
 * re-run it. Correct a mistake with a new migration.
 */

import type { SQLiteDatabase } from 'expo-sqlite'

import { logger, safe } from '@/diagnostics/logger'
import { MIGRATION_001 } from '@/storage/migrations/001_initial'
import { MIGRATION_002 } from '@/storage/migrations/002_punch_events'
import { MIGRATION_003 } from '@/storage/migrations/003_sessions'
import { MIGRATION_004 } from '@/storage/migrations/004_workouts'
import { MIGRATION_005 } from '@/storage/migrations/005_cue_result_repeat_index'
import { MIGRATION_006 } from '@/storage/migrations/006_app_settings'

export interface Migration {
  id: number
  name: string
  up: (db: SQLiteDatabase) => void
}

// Ids are permanent: never renumber a migration that has landed, and never
// reuse an id another branch has already claimed. 006 adds `app_settings`;
// the next branch to add one takes 007.
const MIGRATIONS: readonly Migration[] = [
  MIGRATION_001,
  MIGRATION_002,
  MIGRATION_003,
  MIGRATION_004,
  MIGRATION_005,
  MIGRATION_006,
]

/**
 * The registry, exposed so tests can assert ids are unique, ascending, and
 * never renumbered. Read-only — application code goes through runMigrations.
 */
export const MIGRATIONS_FOR_TESTS: readonly Migration[] = MIGRATIONS

/** Apply any migrations whose id is not yet recorded in schema_migrations. */
export function runMigrations(db: SQLiteDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const appliedStmt = db.prepareSync('SELECT id FROM schema_migrations')
  const applied = new Set<number>()
  try {
    const rows = appliedStmt.executeSync<{ id: number }>().getAllSync()
    for (const r of rows) applied.add(r.id)
  } finally {
    appliedStmt.finalizeSync()
  }

  const pending = [...MIGRATIONS].sort((a, b) => a.id - b.id).filter((m) => !applied.has(m.id))
  if (pending.length === 0) return

  for (const m of pending) {
    db.execSync('BEGIN')
    try {
      m.up(db)
      const insert = db.prepareSync('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      try {
        insert.executeSync([m.id, new Date().toISOString()])
      } finally {
        insert.finalizeSync()
      }
      db.execSync('COMMIT')
      logger.info('storage.migrate', 'migration applied', { id: safe(m.id), name: safe(m.name) })
    } catch (err) {
      db.execSync('ROLLBACK')
      logger.error('storage.migrate.failed', 'migration failed', {
        id: safe(m.id),
        name: safe(m.name),
        error: safe(String(err)),
      })
      throw err
    }
  }
}
