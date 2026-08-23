/**
 * In-memory SQLite for storage tests.
 *
 * Uses Node's built-in `node:sqlite` — no new npm dependency, no native
 * expo-sqlite binding, so the whole suite runs on the Windows workstation and
 * on CI without Bluetooth hardware or an Android toolchain (§21).
 *
 * The adapter exposes the `SqlPort` shape our repositories depend on, and the
 * same object is handed to `Migration.up`, which only ever calls `execSync`.
 * That means these tests exercise the real migration SQL against a real SQLite
 * engine: constraint violations, CHECK enforcement, and ON DELETE CASCADE all
 * behave here exactly as they do on device.
 *
 * Not a test file itself — jest.config.js excludes `__tests__/helpers/`.
 */

import { DatabaseSync } from 'node:sqlite'

import type { SQLiteDatabase } from 'expo-sqlite'

import { MIGRATION_001 } from '@/storage/migrations/001_initial'
import { MIGRATION_002 } from '@/storage/migrations/002_punch_events'
import { MIGRATION_003 } from '@/storage/migrations/003_sessions'
import type { SqlBindValue, SqlPort, SqlStatement } from '@/storage/SqlPort'

type NodeBind = string | number | bigint | null | Uint8Array

function toNodeBind(v: SqlBindValue): NodeBind {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === undefined) return null
  return v
}

export class MemoryDb implements SqlPort {
  readonly raw: DatabaseSync

  constructor() {
    this.raw = new DatabaseSync(':memory:')
    // Cascades are the whole point of these tests; enforce them explicitly
    // rather than relying on the driver default.
    this.raw.exec('PRAGMA foreign_keys = ON;')
  }

  execSync(sql: string): void {
    this.raw.exec(sql)
  }

  prepareSync(sql: string): SqlStatement {
    const stmt = this.raw.prepare(sql)
    return {
      executeSync: <TRow = unknown>(params: SqlBindValue[]) => {
        const rows = stmt.all(...params.map(toNodeBind)) as TRow[]
        return { getAllSync: () => rows }
      },
      finalizeSync: () => {
        /* node:sqlite finalizes on GC; nothing to release here. */
      },
    }
  }

  /** Convenience for assertions: run a query and get plain rows back. */
  query<TRow = Record<string, unknown>>(sql: string, params: SqlBindValue[] = []): TRow[] {
    return this.raw.prepare(sql).all(...params.map(toNodeBind)) as TRow[]
  }

  /** Convenience for assertions: single-value scalar query. */
  count(sql: string, params: SqlBindValue[] = []): number {
    const rows = this.query<{ n: number }>(sql, params)
    return rows[0]?.n ?? 0
  }

  close(): void {
    this.raw.close()
  }
}

/**
 * A fresh database with migrations 001–003 applied, exactly as the runner
 * applies them on device.
 */
export function createMigratedDb(): MemoryDb {
  const db = new MemoryDb()
  const asSqliteDatabase = db as unknown as SQLiteDatabase
  MIGRATION_001.up(asSqliteDatabase)
  MIGRATION_002.up(asSqliteDatabase)
  MIGRATION_003.up(asSqliteDatabase)
  return db
}
