/**
 * Migration 001 — initial Phase 1 schema (spec §17.1).
 *
 * Tables: tracker_devices, ble_captures, ble_frames, gatt_inventory.
 * The runner and the migration registry live in ./index.ts.
 *
 * SHIPPED — do not edit. Correct anything here with a new migration.
 */

import type { Migration } from '@/storage/migrations'

export const MIGRATION_001: Migration = {
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
