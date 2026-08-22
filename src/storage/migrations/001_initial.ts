/**
 * Migration runner + the initial Phase 1 schema (spec §17.1).
 *
 * The runner is intentionally tiny: a schema_migrations table records applied
 * ids, and pending migrations are executed in ascending id order within a
 * transaction. Add new migrations by appending to MIGRATIONS.
 */

import type { SQLiteDatabase } from 'expo-sqlite'

import { logger, safe } from '@/diagnostics/logger'

interface Migration {
  id: number
  name: string
  up: (db: SQLiteDatabase) => void
}

const MIGRATION_001: Migration = {
  id: 1,
  name: '001_initial',
  up(db) {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS tracker_devices (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        android_device_id TEXT UNIQUE,
        identity_fingerprint TEXT,
        assigned_hand TEXT CHECK(assigned_hand IN ('left','right','unknown')) DEFAULT 'unknown',
        led_color TEXT,
        firmware_revision TEXT,
        hardware_revision TEXT,
        protocol_adapter_id TEXT,
        protocol_confidence REAL,
        first_seen_at TEXT,
        last_seen_at TEXT
      );

      CREATE TABLE IF NOT EXISTS ble_captures (
        id TEXT PRIMARY KEY,
        label TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        app_version TEXT,
        os_version TEXT,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS ble_frames (
        id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL REFERENCES ble_captures(id) ON DELETE CASCADE,
        device_id TEXT REFERENCES tracker_devices(id) ON DELETE SET NULL,
        monotonic_time_ms REAL NOT NULL,
        wall_time_iso TEXT NOT NULL,
        direction TEXT NOT NULL,
        service_uuid TEXT NOT NULL,
        characteristic_uuid TEXT NOT NULL,
        value_base64 TEXT NOT NULL,
        value_hex TEXT NOT NULL,
        connection_generation INTEGER NOT NULL,
        decoder_version TEXT,
        decode_status TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_ble_frames_capture_time
        ON ble_frames(capture_id, monotonic_time_ms);
      CREATE INDEX IF NOT EXISTS idx_ble_frames_device
        ON ble_frames(device_id);

      CREATE TABLE IF NOT EXISTS gatt_inventory (
        device_id TEXT NOT NULL REFERENCES tracker_devices(id) ON DELETE CASCADE,
        service_uuid TEXT NOT NULL,
        characteristic_uuid TEXT NOT NULL,
        properties TEXT NOT NULL,
        descriptors TEXT,
        discovered_at TEXT NOT NULL,
        PRIMARY KEY(device_id, service_uuid, characteristic_uuid)
      );
    `)
  },
}

const MIGRATIONS: readonly Migration[] = [MIGRATION_001]

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
