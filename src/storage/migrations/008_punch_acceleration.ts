/**
 * Migration 008 — promote the punch record's peak-acceleration u16 onto
 * `punch_events` (Puncheoke instrument, instrument-design §14).
 *
 * The FightCamp v1 record has always carried a two-byte peak-acceleration
 * reading (bytes 1-2 LE on the 9-byte layout); the decoder parsed it and
 * dropped it before the event until now. The column is nullable REAL like
 * `velocity_raw`: absent on rows written before this migration, and absent
 * whenever a future adapter has no such reading. Tracker-scale, no physical
 * unit claimed (§4.3 posture applies to this reading too).
 *
 * The 002 dedup index (device_address, tracker_timestamp_ms, punch_type_raw,
 * velocity_raw) is deliberately unchanged — acceleration adds no identity.
 */

import type { SQLiteDatabase } from 'expo-sqlite'

import type { Migration } from './index'

export const MIGRATION_008: Migration = {
  id: 8,
  name: 'punch_acceleration',
  up(db: SQLiteDatabase): void {
    db.execSync('ALTER TABLE punch_events ADD COLUMN acceleration_raw REAL')
  },
}
