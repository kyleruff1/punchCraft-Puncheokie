/**
 * DeviceRepository — minimal CRUD over tracker_devices for Phase 1.
 *
 * Persists devices discovered on the transport layer without knowing
 * anything about BLE itself. Callers upsert by the stable android device id
 * (§10 identity), optionally attaching an identity fingerprint, and can
 * later toggle the assigned hand once the user chooses one.
 */

import type { SQLiteDatabase } from 'expo-sqlite'

import { logger, safe } from '@/diagnostics/logger'

export type AssignedHand = 'left' | 'right' | 'unknown'

export interface TrackerDeviceRow {
  id: string
  displayName: string | null
  androidDeviceId: string | null
  identityFingerprint: string | null
  assignedHand: AssignedHand
  ledColor: string | null
  firmwareRevision: string | null
  hardwareRevision: string | null
  protocolAdapterId: string | null
  protocolConfidence: number | null
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export interface UpsertByAndroidIdInput {
  androidDeviceId: string
  displayName?: string | null
  identityFingerprint?: string | null
}

interface RawRow {
  id: string
  display_name: string | null
  android_device_id: string | null
  identity_fingerprint: string | null
  assigned_hand: AssignedHand
  led_color: string | null
  firmware_revision: string | null
  hardware_revision: string | null
  protocol_adapter_id: string | null
  protocol_confidence: number | null
  first_seen_at: string | null
  last_seen_at: string | null
}

function mapRow(r: RawRow): TrackerDeviceRow {
  return {
    id: r.id,
    displayName: r.display_name,
    androidDeviceId: r.android_device_id,
    identityFingerprint: r.identity_fingerprint,
    assignedHand: r.assigned_hand ?? 'unknown',
    ledColor: r.led_color,
    firmwareRevision: r.firmware_revision,
    hardwareRevision: r.hardware_revision,
    protocolAdapterId: r.protocol_adapter_id,
    protocolConfidence: r.protocol_confidence,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  }
}

// Simple, RN-safe id generator. UUIDs are not required by the schema — only
// uniqueness. Avoids pulling in crypto polyfills.
function newId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `dev_${Date.now().toString(36)}_${rand}`
}

export class DeviceRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  /**
   * Upsert a device keyed by its stable android device id. If a row already
   * exists we only touch last_seen_at and any newly-known optional fields;
   * we never overwrite an existing value with null.
   */
  upsertByAndroidId(input: UpsertByAndroidIdInput): TrackerDeviceRow {
    const nowIso = new Date().toISOString()
    const findStmt = this.db.prepareSync('SELECT * FROM tracker_devices WHERE android_device_id = ?')
    let existing: RawRow | null = null
    try {
      const rows = findStmt.executeSync<RawRow>([input.androidDeviceId]).getAllSync()
      existing = rows[0] ?? null
    } finally {
      findStmt.finalizeSync()
    }

    if (existing) {
      const updateStmt = this.db.prepareSync(
        `UPDATE tracker_devices
           SET display_name = COALESCE(?, display_name),
               identity_fingerprint = COALESCE(?, identity_fingerprint),
               last_seen_at = ?
         WHERE id = ?`,
      )
      try {
        updateStmt.executeSync([
          input.displayName ?? null,
          input.identityFingerprint ?? null,
          nowIso,
          existing.id,
        ])
      } finally {
        updateStmt.finalizeSync()
      }
      logger.info('storage.device.update', 'tracker device seen', { id: safe(existing.id) })
      return this.getByIdOrThrow(existing.id)
    }

    const id = newId()
    const insertStmt = this.db.prepareSync(
      `INSERT INTO tracker_devices
         (id, display_name, android_device_id, identity_fingerprint, assigned_hand, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, 'unknown', ?, ?)`,
    )
    try {
      insertStmt.executeSync([
        id,
        input.displayName ?? null,
        input.androidDeviceId,
        input.identityFingerprint ?? null,
        nowIso,
        nowIso,
      ])
    } finally {
      insertStmt.finalizeSync()
    }
    logger.info('storage.device.insert', 'tracker device inserted', { id: safe(id) })
    return this.getByIdOrThrow(id)
  }

  /** Return all known tracker devices ordered by most-recently-seen first. */
  listAll(): TrackerDeviceRow[] {
    const stmt = this.db.prepareSync(
      'SELECT * FROM tracker_devices ORDER BY last_seen_at DESC NULLS LAST, id ASC',
    )
    try {
      const rows = stmt.executeSync<RawRow>().getAllSync()
      return rows.map(mapRow)
    } finally {
      stmt.finalizeSync()
    }
  }

  /** Set the assigned hand for a device. Returns the updated row, or null if unknown. */
  setAssignedHand(id: string, hand: AssignedHand): TrackerDeviceRow | null {
    const stmt = this.db.prepareSync('UPDATE tracker_devices SET assigned_hand = ? WHERE id = ?')
    try {
      const result = stmt.executeSync([hand, id])
      if (result.changes === 0) {
        logger.warn('storage.device.assignHand.missing', 'device not found', { id: safe(id) })
        return null
      }
    } finally {
      stmt.finalizeSync()
    }
    logger.info('storage.device.assignHand', 'assigned hand updated', {
      id: safe(id),
      hand: safe(hand),
    })
    return this.getById(id)
  }

  getById(id: string): TrackerDeviceRow | null {
    const stmt = this.db.prepareSync('SELECT * FROM tracker_devices WHERE id = ?')
    try {
      const rows = stmt.executeSync<RawRow>([id]).getAllSync()
      const row = rows[0]
      return row ? mapRow(row) : null
    } finally {
      stmt.finalizeSync()
    }
  }

  private getByIdOrThrow(id: string): TrackerDeviceRow {
    const row = this.getById(id)
    if (!row) throw new Error(`tracker_devices row missing after write: ${id}`)
    return row
  }
}
