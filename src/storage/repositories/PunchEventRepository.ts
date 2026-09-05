/**
 * PunchEventRepository — persistence for decoded punch events (#91, §12.5).
 *
 * Dedup (#90 / #91): the FightCamp v1 payload carries no sequence number
 * (H11), so a replayed or re-synced frame cannot be identified by sequence.
 * We fall back to the compound key enforced by `idx_punch_events_dedup` in
 * migration 002 — (device address, tracker timestamp, type byte, velocity
 * byte) — and use INSERT OR IGNORE. `insertMany` reports how many rows were
 * actually new so callers can surface a duplicate count instead of guessing.
 *
 * Raw values are stored next to calibrated ones, along with decoder id and
 * version, so a decoder change stays recalculable against stored data
 * (§3.2, §8.6). Nothing here is ever overwritten by a re-decode.
 */

import { logger, safe } from '@/diagnostics/logger'
import type { SqlPort } from '@/storage/SqlPort'

/** Mirrors TrackerPunchEvent without importing from the domain layer. */
export interface PunchEventInsertInput {
  id: string
  sourceFrameId: string
  captureId: string | null
  /** Resolved `tracker_devices.id`, or null when the device row is unknown. */
  deviceId: string | null
  deviceAddress: string
  hand: 'left' | 'right' | 'unknown'
  trackerTimestampMs?: number | undefined
  receivedMonotonicTimeMs: number
  receivedWallTimeIso: string
  sequence?: number | undefined
  punchTypeRaw?: number | undefined
  punchType?: string | undefined
  /** Peak acceleration u16, tracker-scale (migration 008). */
  accelerationRaw?: number | undefined
  velocityRaw?: number | undefined
  velocityCalibrated?: number | undefined
  velocityUnit: string
  recovered: boolean
  decoderId: string
  decoderVersion: string
  qualityFlags: readonly string[]
}

export interface InsertManyResult {
  /** Rows the caller handed us. */
  submitted: number
  /** Rows that were genuinely new. */
  inserted: number
  /** Rows dropped by the compound-key dedup index. */
  duplicates: number
}

export class PunchEventRepository {
  constructor(private readonly db: SqlPort) {}

  /**
   * Insert a batch inside one transaction, ignoring compound-key duplicates.
   *
   * `inserted` is derived from a total_changes delta rather than assumed,
   * because INSERT OR IGNORE reports success for a row it silently dropped.
   */
  insertMany(events: readonly PunchEventInsertInput[]): InsertManyResult {
    if (events.length === 0) return { submitted: 0, inserted: 0, duplicates: 0 }

    const before = this.totalChanges()

    this.db.execSync('BEGIN')
    const stmt = this.db.prepareSync(
      `INSERT OR IGNORE INTO punch_events
         (id, source_frame_id, capture_id, device_id, device_address, hand,
          tracker_timestamp_ms, received_monotonic_time_ms, received_wall_time_iso, sequence,
          punch_type_raw, punch_type, acceleration_raw,
          velocity_raw, velocity_calibrated, velocity_unit,
          recovered, decoder_id, decoder_version, quality_flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    try {
      for (const e of events) {
        stmt.executeSync([
          e.id,
          e.sourceFrameId,
          e.captureId,
          e.deviceId,
          e.deviceAddress,
          e.hand,
          e.trackerTimestampMs ?? null,
          e.receivedMonotonicTimeMs,
          e.receivedWallTimeIso,
          e.sequence ?? null,
          e.punchTypeRaw ?? null,
          e.punchType ?? null,
          e.accelerationRaw ?? null,
          e.velocityRaw ?? null,
          e.velocityCalibrated ?? null,
          e.velocityUnit,
          e.recovered ? 1 : 0,
          e.decoderId,
          e.decoderVersion,
          JSON.stringify(e.qualityFlags ?? []),
        ])
      }
      stmt.finalizeSync()
      this.db.execSync('COMMIT')
    } catch (err) {
      try {
        stmt.finalizeSync()
      } catch {
        /* already finalized */
      }
      this.db.execSync('ROLLBACK')
      logger.error('storage.punch.insert.failed', 'punch batch insert failed', {
        count: safe(events.length),
        error: safe(String(err)),
      })
      throw err
    }

    const inserted = Math.max(0, Math.min(events.length, this.totalChanges() - before))
    const duplicates = events.length - inserted
    if (duplicates > 0) {
      logger.info('storage.punch.dedup', 'duplicate punch events ignored', {
        submitted: safe(events.length),
        inserted: safe(inserted),
        duplicates: safe(duplicates),
      })
    }
    return { submitted: events.length, inserted, duplicates }
  }

  /** Count events in a capture. */
  countForCapture(captureId: string): number {
    const stmt = this.db.prepareSync('SELECT COUNT(*) AS n FROM punch_events WHERE capture_id = ?')
    try {
      const rows = stmt.executeSync<{ n: number }>([captureId]).getAllSync()
      return rows[0]?.n ?? 0
    } finally {
      stmt.finalizeSync()
    }
  }

  /**
   * SQLite's cumulative change counter for this connection. The delta across
   * an INSERT OR IGNORE batch is how many rows actually landed.
   */
  private totalChanges(): number {
    const stmt = this.db.prepareSync('SELECT total_changes() AS n')
    try {
      const rows = stmt.executeSync<{ n: number }>([]).getAllSync()
      return rows[0]?.n ?? 0
    } finally {
      stmt.finalizeSync()
    }
  }
}
