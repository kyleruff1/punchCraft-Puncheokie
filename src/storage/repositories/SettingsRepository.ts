/**
 * SettingsRepository — durable user preferences (M34-05, spec §17.1).
 *
 * A key/value store over `app_settings`, one JSON blob per key.
 *
 * ## Reads never throw
 *
 * `read` returns the fallback for a missing row *and* for an unreadable one.
 * A settings table is not worth crashing a workout over: if the stored JSON
 * is corrupt the honest recovery is to fall back to the defaults and say so
 * in the log, not to refuse to start. That is the opposite of the
 * `generated_workouts` policy, where a corrupt payload must surface — because
 * there the row *is* the record of what happened, and quietly substituting a
 * default would fabricate history.
 *
 * Talks to SQLite through `SqlPort` so the suite runs without the native
 * binding (spec §21).
 */

import { logger, safe } from '@/diagnostics/logger'
import type { SettingsKey } from '@/storage/migrations/006_app_settings'
import type { SqlBindValue, SqlPort } from '@/storage/SqlPort'

interface RawSetting {
  value_json: string
}

export class SettingsRepository {
  constructor(private readonly db: SqlPort) {}

  /**
   * Read one setting, or `fallback` if it is absent or unreadable.
   *
   * `merge` decides how a stored value combines with the fallback, so a
   * preference object that has gained a field since it was written comes back
   * complete rather than missing the new one.
   */
  read<T extends object>(key: SettingsKey, fallback: T): T {
    const rows = this.select<RawSetting>('SELECT value_json FROM app_settings WHERE key = ?', [key])
    const raw = rows[0]?.value_json
    if (raw === undefined) return fallback

    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`expected an object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`)
      }
      // Fallback first: a key added since this row was written keeps its
      // default rather than arriving undefined.
      return { ...fallback, ...(parsed as Partial<T>) }
    } catch (err) {
      logger.warn('storage.settings.unreadable', 'stored setting ignored; using defaults', {
        key: safe(key),
        error: safe(String(err)),
      })
      return fallback
    }
  }

  write(key: SettingsKey, value: object, nowIso = new Date().toISOString()): void {
    this.run(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                        updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), nowIso],
    )
  }

  /** Remove a setting, returning it to its default. */
  clear(key: SettingsKey): void {
    this.run('DELETE FROM app_settings WHERE key = ?', [key])
  }

  /* -- internals -------------------------------------------------------- */

  private run(sql: string, params: SqlBindValue[]): void {
    const stmt = this.db.prepareSync(sql)
    try {
      stmt.executeSync(params)
    } finally {
      stmt.finalizeSync()
    }
  }

  private select<T>(sql: string, params: SqlBindValue[]): T[] {
    const stmt = this.db.prepareSync(sql)
    try {
      return stmt.executeSync<T>(params).getAllSync()
    } finally {
      stmt.finalizeSync()
    }
  }
}
