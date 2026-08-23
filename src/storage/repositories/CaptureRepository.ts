/**
 * CaptureRepository — `ble_captures` lifecycle and batched `ble_frames` writes.
 *
 * This is the durable half of the persist-before-parse rule (CLAUDE.md §1,
 * spec §11.9 / §12.4). Frames are written verbatim: base64 AND hex, the
 * monotonic timestamp stamped in the native callback, and the connection
 * generation. Nothing here inspects the payload — a frame that the decoder
 * will later reject is stored exactly like one that decodes cleanly, which is
 * the whole point.
 *
 * Storage never imports from `src/ble/**`; the frame shape arrives as a plain
 * input record.
 */

import { logger, safe } from '@/diagnostics/logger'
import type { SqlPort } from '@/storage/SqlPort'

export interface OpenCaptureInput {
  label?: string | null
  appVersion?: string | null
  osVersion?: string | null
  notes?: string | null
}

/** A frame ready to persist. Mirrors RawBleFrame without importing from ble/. */
export interface FrameInsertInput {
  id: string
  captureId: string
  /** Resolved `tracker_devices.id`, or null when the device is not yet known. */
  deviceId: string | null
  /** The transport-reported BLE address, always recorded. */
  deviceAddress: string
  monotonicTimeMs: number
  wallTimeIso: string
  direction: string
  serviceUuid: string
  characteristicUuid: string
  valueBase64: string
  valueHex: string
  connectionGeneration: number
}

export interface CaptureRow {
  id: string
  label: string | null
  startedAt: string
  endedAt: string | null
}

interface RawCaptureRow {
  id: string
  label: string | null
  started_at: string
  ended_at: string | null
}

function newCaptureId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `cap_${Date.now().toString(36)}_${rand}`
}

export class CaptureRepository {
  constructor(private readonly db: SqlPort) {}

  /** Start a capture and return its id. Frames reference this id. */
  open(input: OpenCaptureInput = {}): string {
    const id = newCaptureId()
    const stmt = this.db.prepareSync(
      `INSERT INTO ble_captures (id, label, started_at, app_version, os_version, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    try {
      stmt.executeSync([
        id,
        input.label ?? null,
        new Date().toISOString(),
        input.appVersion ?? null,
        input.osVersion ?? null,
        input.notes ?? null,
      ])
    } finally {
      stmt.finalizeSync()
    }
    logger.info('storage.capture.open', 'capture opened', { captureId: safe(id) })
    return id
  }

  /** Mark a capture ended. Idempotent — re-closing keeps the first end time. */
  close(captureId: string): void {
    const stmt = this.db.prepareSync(
      'UPDATE ble_captures SET ended_at = COALESCE(ended_at, ?) WHERE id = ?',
    )
    try {
      stmt.executeSync([new Date().toISOString(), captureId])
    } finally {
      stmt.finalizeSync()
    }
    logger.info('storage.capture.close', 'capture closed', { captureId: safe(captureId) })
  }

  /**
   * Insert a batch of frames inside a single transaction.
   *
   * Returns the number written. A failure rolls the whole batch back and
   * rethrows — the caller decides whether to retry or surface an overrun,
   * because silently dropping frames would violate the persist-before-parse
   * guarantee just as surely as never writing them.
   */
  insertFrames(frames: readonly FrameInsertInput[]): number {
    if (frames.length === 0) return 0

    this.db.execSync('BEGIN')
    const stmt = this.db.prepareSync(
      `INSERT OR IGNORE INTO ble_frames
         (id, capture_id, device_id, device_address, monotonic_time_ms, wall_time_iso,
          direction, service_uuid, characteristic_uuid, value_base64, value_hex,
          connection_generation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    try {
      for (const f of frames) {
        stmt.executeSync([
          f.id,
          f.captureId,
          f.deviceId,
          f.deviceAddress,
          f.monotonicTimeMs,
          f.wallTimeIso,
          f.direction,
          f.serviceUuid,
          f.characteristicUuid,
          f.valueBase64,
          f.valueHex,
          f.connectionGeneration,
        ])
      }
      stmt.finalizeSync()
      this.db.execSync('COMMIT')
      return frames.length
    } catch (err) {
      try {
        stmt.finalizeSync()
      } catch {
        /* already finalized */
      }
      this.db.execSync('ROLLBACK')
      logger.error('storage.frames.insert.failed', 'frame batch insert failed', {
        count: safe(frames.length),
        error: safe(String(err)),
      })
      throw err
    }
  }

  /** Count frames in a capture. Used by the capture UI and by exports. */
  countFrames(captureId: string): number {
    const stmt = this.db.prepareSync('SELECT COUNT(*) AS n FROM ble_frames WHERE capture_id = ?')
    try {
      const rows = stmt.executeSync<{ n: number }>([captureId]).getAllSync()
      return rows[0]?.n ?? 0
    } finally {
      stmt.finalizeSync()
    }
  }

  /** Most recent captures first. */
  listRecent(limit = 20): CaptureRow[] {
    const stmt = this.db.prepareSync(
      'SELECT id, label, started_at, ended_at FROM ble_captures ORDER BY started_at DESC LIMIT ?',
    )
    try {
      const rows = stmt.executeSync<RawCaptureRow>([limit]).getAllSync()
      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      }))
    } finally {
      stmt.finalizeSync()
    }
  }
}
