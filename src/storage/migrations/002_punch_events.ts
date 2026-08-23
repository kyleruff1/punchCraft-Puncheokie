/**
 * Migration 002 — decoded punch events + raw-frame device address.
 *
 * Two changes:
 *
 * 1. `ble_frames.device_address` — `RawBleFrame.deviceId` carries the BLE
 *    address the transport reported, which is NOT the same value as
 *    `tracker_devices.id` (our own surrogate key). Migration 001 declared
 *    `ble_frames.device_id` as a foreign key onto `tracker_devices(id)`, so
 *    writing the address straight into it fails once `PRAGMA foreign_keys`
 *    is ON. We keep `device_id` for the resolved surrogate key and store the
 *    transport address here so a capture is still attributable when the
 *    device row is missing.
 *
 * 2. `punch_events` — normalized decoded events (spec §17.1, §12.5). Retains
 *    source-frame reference, raw AND calibrated values, unit, decoder id +
 *    version, and quality flags, so stored sessions stay recalculable after a
 *    decoder change (§3.2, §8.6).
 *
 * Dedup: FightCamp v1 frames carry no sequence number (H11), so uniqueness
 * falls back to a compound key — see `idx_punch_events_dedup` below and
 * `PunchEventRepository`.
 *
 * SHIPPED — do not edit. Correct anything here with a new migration.
 */

import type { Migration } from '@/storage/migrations'

export const MIGRATION_002: Migration = {
  id: 2,
  name: '002_punch_events',
  up(db) {
    db.execSync(`
      ALTER TABLE ble_frames ADD COLUMN device_address TEXT;

      CREATE INDEX IF NOT EXISTS idx_ble_frames_address
        ON ble_frames(device_address);

      CREATE TABLE IF NOT EXISTS punch_events (
        id TEXT PRIMARY KEY,
        source_frame_id TEXT NOT NULL,
        capture_id TEXT REFERENCES ble_captures(id) ON DELETE CASCADE,
        device_id TEXT REFERENCES tracker_devices(id) ON DELETE SET NULL,
        device_address TEXT,
        hand TEXT NOT NULL CHECK(hand IN ('left','right','unknown')),

        tracker_timestamp_ms REAL,
        received_monotonic_time_ms REAL NOT NULL,
        received_wall_time_iso TEXT NOT NULL,
        sequence INTEGER,

        punch_type_raw INTEGER,
        punch_type TEXT,

        velocity_raw REAL,
        velocity_calibrated REAL,
        velocity_unit TEXT NOT NULL,

        recovered INTEGER NOT NULL DEFAULT 0,
        decoder_id TEXT NOT NULL,
        decoder_version TEXT NOT NULL,
        quality_flags TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_punch_events_capture_time
        ON punch_events(capture_id, received_monotonic_time_ms);
      CREATE INDEX IF NOT EXISTS idx_punch_events_device
        ON punch_events(device_address);
      CREATE INDEX IF NOT EXISTS idx_punch_events_source_frame
        ON punch_events(source_frame_id);

      -- Compound-key dedup (#91). No sequence number exists in the FightCamp
      -- v1 payload, so a replayed / re-synced frame is identified by the
      -- tracker's own timestamp plus its type and velocity bytes for a given
      -- device. Inserts use INSERT OR IGNORE so a duplicate is dropped rather
      -- than raising. COALESCE keeps NULLs from defeating the constraint,
      -- since NULLs never compare equal in a UNIQUE index.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_punch_events_dedup
        ON punch_events(
          COALESCE(device_address, ''),
          COALESCE(tracker_timestamp_ms, -1),
          COALESCE(punch_type_raw, -1),
          COALESCE(velocity_raw, -1)
        );
    `)
  },
}
