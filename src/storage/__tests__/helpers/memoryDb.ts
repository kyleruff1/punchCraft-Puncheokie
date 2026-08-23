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

import { MIGRATIONS_FOR_TESTS } from '@/storage/migrations'
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
      // `SqlPort` types params as required because expo-sqlite's own signature
      // is non-optional, but the real driver still accepts a bare call — and
      // `runMigrations` makes one. Defaulting here keeps the fake honest to
      // the driver rather than to the type.
      executeSync: <TRow = unknown>(params: SqlBindValue[] = []) => {
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
 * A fresh database with migrations 001–004 applied, exactly as the runner
 * applies them on device.
 */
export function createMigratedDb(): MemoryDb {
  const db = new MemoryDb()
  const asSqliteDatabase = db as unknown as SQLiteDatabase
  // Driven from the registry rather than a hand-kept list. A hard-coded list
  // drifts silently: a new migration lands, every storage test keeps running
  // against the old schema, and the mismatch only shows up on device.
  for (const migration of [...MIGRATIONS_FOR_TESTS].sort((a, b) => a.id - b.id)) {
    migration.up(asSqliteDatabase)
  }
  return db
}
