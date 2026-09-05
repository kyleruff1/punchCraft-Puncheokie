/**
 * SessionRepository — persistence for sessions, rounds, their punch events,
 * and the §9.5 quality counters (#115 / M22-01, spec §17.1, §18.2).
 *
 * Boundaries this file deliberately holds:
 *
 * - **No write path for `session_metrics`.** MetricsEngine (M22-03) owns those
 *   writes through its own seam; everything here is read-only against that
 *   table. A session delete still removes its metric rows, but that happens in
 *   SQLite via ON DELETE CASCADE, not through a statement in this class.
 * - **Raw frames are untouchable.** `punch_events.source_frame_id` is a plain
 *   id, not a foreign key, so deleting a session can never take a `ble_frames`
 *   row with it (§12.4, non-negotiable rule 1).
 * - **Monotonic time orders, wall time only displays** (§18.3). Every query
 *   here orders by a `*_monotonic_ms` column; the ISO columns exist for
 *   history screens and exports.
 * - **No imports from `src/ble/**`, React, or `src/app/**`** — storage stays on
 *   the inward side of the dependency rule (§15.1).
 *
 * Talks to SQLite through `SqlPort` rather than `SQLiteDatabase` so the suite
 * runs on the Windows workstation without the native expo-sqlite binding (§21).
 */

import { logger, safe } from '@/diagnostics/logger'
import { PUNCH_REJECTION_REASONS } from '@/storage/migrations/003_sessions'
import type {
  PunchRejectionReason,
  SessionMode,
  SessionStatus,
} from '@/storage/migrations/003_sessions'
import type { PunchEventInsertInput } from '@/storage/repositories/PunchEventRepository'
import type { SqlBindValue, SqlPort } from '@/storage/SqlPort'

/* ------------------------------------------------------------------ types */

/** §9.5 session-wide counters. */
export interface SessionQualityCounters {
  duplicatesSuppressed: number
  rejectedEvents: number
  unmatchedEvents: number
  malformedEvents: number
}

export interface SessionRow {
  id: string
  mode: SessionMode
  status: SessionStatus
  /** ISO wall time — display and export only. */
  startedAt: string | null
  endedAt: string | null
  /** Monotonic clock — ordering and duration. */
  startedMonotonicMs: number | null
  endedMonotonicMs: number | null
  activeDurationMs: number
  timerConfigJson: string | null
  /** Nullable until a Puncheokie workout is generated for this session. */
  generatedWorkoutId: string | null
  spotifyPlaylistId: string | null
  leftCalibrationId: string | null
  rightCalibrationId: string | null
  notes: string | null
  quality: SessionQualityCounters
  createdAt: string
}

export interface SessionCreateInput {
  /** Supply your own id for deterministic tests; otherwise one is generated. */
  id?: string
  mode: SessionMode
  status?: SessionStatus
  startedAtIso?: string | null
  startedMonotonicMs?: number | null
  activeDurationMs?: number
  timerConfigJson?: string | null
  generatedWorkoutId?: string | null
  spotifyPlaylistId?: string | null
  leftCalibrationId?: string | null
  rightCalibrationId?: string | null
  notes?: string | null
}

export interface SessionEndInput {
  id: string
  status: SessionStatus
  endedAtIso: string
  endedMonotonicMs: number
  activeDurationMs: number
}

export interface RoundRow {
  id: string
  sessionId: string
  roundNumber: number
  workStartedAt: string | null
  workEndedAt: string | null
  restStartedAt: string | null
  restEndedAt: string | null
  workStartedMonotonicMs: number | null
  workEndedMonotonicMs: number | null
  restStartedMonotonicMs: number | null
  restEndedMonotonicMs: number | null
}

export interface RoundAppendInput {
  id?: string
  sessionId: string
  /** Omit to append after the highest existing round number in the session. */
  roundNumber?: number
  workStartedAtIso?: string | null
  workEndedAtIso?: string | null
  restStartedAtIso?: string | null
  restEndedAtIso?: string | null
  workStartedMonotonicMs?: number | null
  workEndedMonotonicMs?: number | null
  restStartedMonotonicMs?: number | null
  restEndedMonotonicMs?: number | null
}

/**
 * A punch event as stored inside a session: everything migration 002 already
 * kept (source frame, raw + calibrated values, unit, decoder id/version,
 * quality flags) plus the session linkage added by migration 003.
 */
export interface SessionPunchEventInput extends PunchEventInsertInput {
  sessionId: string
  roundId?: string | null
  /** Calibration profile applied to THIS event's hand (§10, §17.1). */
  calibrationProfileId?: string | null
  /** NULL means accepted into default metrics (§18.2). */
  rejectionReason?: PunchRejectionReason | null
}

export interface SessionPunchEventRow extends SessionPunchEventInput {
  roundId: string | null
  calibrationProfileId: string | null
  rejectionReason: PunchRejectionReason | null
}

export interface AppendPunchEventResult {
  /** False when the compound-key dedup index (migration 002) dropped the row. */
  inserted: boolean
  duplicate: boolean
}

export interface SessionMetricRow {
  id: string
  sessionId: string
  roundId: string | null
  metricKey: string
  metricValue: number | null
  metricUnit: string | null
  calculationVersion: string
  calculatedAt: string
}

export interface TrackerQualityRow {
  sessionId: string
  trackerKey: string
  deviceId: string | null
  hand: 'left' | 'right' | 'unknown'
  gapCount: number
  gapTotalMs: number
  reconnectCount: number
  updatedAt: string
}

export interface TrackerQualityInput {
  sessionId: string
  /** Transport address when known — matches `punch_events.device_address`. */
  trackerKey: string
  deviceId?: string | null
  hand?: 'left' | 'right' | 'unknown'
  gapCount?: number
  gapTotalMs?: number
  reconnectCount?: number
  updatedAtIso?: string
}

export interface ListSessionsOptions {
  mode?: SessionMode
  status?: SessionStatus
  limit?: number
  offset?: number
}

export interface ListPunchEventsOptions {
  roundId?: string
  /** Default true — rejected events stay queryable (§18.2). */
  includeRejected?: boolean
}

export interface ListMetricsOptions {
  /** Pass `null` for session-scoped metrics only; omit for both scopes. */
  roundId?: string | null
  calculationVersion?: string
}

/* ------------------------------------------------------------- row mapping */

interface RawSession {
  id: string
  mode: SessionMode
  status: SessionStatus
  started_at: string | null
  ended_at: string | null
  started_monotonic_ms: number | null
  ended_monotonic_ms: number | null
  active_duration_ms: number
  timer_config_json: string | null
  generated_workout_id: string | null
  spotify_playlist_id: string | null
  left_calibration_id: string | null
  right_calibration_id: string | null
  notes: string | null
  duplicates_suppressed: number
  rejected_events: number
  unmatched_events: number
  malformed_events: number
  created_at: string
}

function mapSession(r: RawSession): SessionRow {
  return {
    id: r.id,
    mode: r.mode,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    startedMonotonicMs: r.started_monotonic_ms,
    endedMonotonicMs: r.ended_monotonic_ms,
    activeDurationMs: r.active_duration_ms,
    timerConfigJson: r.timer_config_json,
    generatedWorkoutId: r.generated_workout_id,
    spotifyPlaylistId: r.spotify_playlist_id,
    leftCalibrationId: r.left_calibration_id,
    rightCalibrationId: r.right_calibration_id,
    notes: r.notes,
    quality: {
      duplicatesSuppressed: r.duplicates_suppressed,
      rejectedEvents: r.rejected_events,
      unmatchedEvents: r.unmatched_events,
      malformedEvents: r.malformed_events,
    },
    createdAt: r.created_at,
  }
}

interface RawRound {
  id: string
  session_id: string
  round_number: number
  work_started_at: string | null
  work_ended_at: string | null
  rest_started_at: string | null
  rest_ended_at: string | null
  work_started_monotonic_ms: number | null
  work_ended_monotonic_ms: number | null
  rest_started_monotonic_ms: number | null
  rest_ended_monotonic_ms: number | null
}

function mapRound(r: RawRound): RoundRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    roundNumber: r.round_number,
    workStartedAt: r.work_started_at,
    workEndedAt: r.work_ended_at,
    restStartedAt: r.rest_started_at,
    restEndedAt: r.rest_ended_at,
    workStartedMonotonicMs: r.work_started_monotonic_ms,
    workEndedMonotonicMs: r.work_ended_monotonic_ms,
    restStartedMonotonicMs: r.rest_started_monotonic_ms,
    restEndedMonotonicMs: r.rest_ended_monotonic_ms,
  }
}

interface RawPunchEvent {
  id: string
  source_frame_id: string
  capture_id: string | null
  device_id: string | null
  device_address: string | null
  hand: 'left' | 'right' | 'unknown'
  tracker_timestamp_ms: number | null
  received_monotonic_time_ms: number
  received_wall_time_iso: string
  sequence: number | null
  punch_type_raw: number | null
  punch_type: string | null
  acceleration_raw: number | null
  velocity_raw: number | null
  velocity_calibrated: number | null
  velocity_unit: string
  recovered: number
  decoder_id: string
  decoder_version: string
  quality_flags: string
  session_id: string
  round_id: string | null
  calibration_profile_id: string | null
  rejection_reason: PunchRejectionReason | null
}

function mapPunchEvent(r: RawPunchEvent): SessionPunchEventRow {
  return {
    id: r.id,
    sourceFrameId: r.source_frame_id,
    captureId: r.capture_id,
    deviceId: r.device_id,
    deviceAddress: r.device_address ?? '',
    hand: r.hand,
    trackerTimestampMs: r.tracker_timestamp_ms ?? undefined,
    receivedMonotonicTimeMs: r.received_monotonic_time_ms,
    receivedWallTimeIso: r.received_wall_time_iso,
    sequence: r.sequence ?? undefined,
    punchTypeRaw: r.punch_type_raw ?? undefined,
    punchType: r.punch_type ?? undefined,
    accelerationRaw: r.acceleration_raw ?? undefined,
    velocityRaw: r.velocity_raw ?? undefined,
    velocityCalibrated: r.velocity_calibrated ?? undefined,
    velocityUnit: r.velocity_unit,
    recovered: r.recovered === 1,
    decoderId: r.decoder_id,
    decoderVersion: r.decoder_version,
    qualityFlags: parseFlags(r.quality_flags),
    sessionId: r.session_id,
    roundId: r.round_id,
    calibrationProfileId: r.calibration_profile_id,
    rejectionReason: r.rejection_reason,
  }
}

function parseFlags(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    logger.warn('storage.session.flags.malformed', 'quality_flags was not valid JSON', {
      value: safe(json),
    })
    return []
  }
}

interface RawMetric {
  id: string
  session_id: string
  round_id: string | null
  metric_key: string
  metric_value: number | null
  metric_unit: string | null
  calculation_version: string
  calculated_at: string
}

function mapMetric(r: RawMetric): SessionMetricRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    roundId: r.round_id,
    metricKey: r.metric_key,
    metricValue: r.metric_value,
    metricUnit: r.metric_unit,
    calculationVersion: r.calculation_version,
    calculatedAt: r.calculated_at,
  }
}

interface RawTrackerQuality {
  session_id: string
  tracker_key: string
  device_id: string | null
  hand: 'left' | 'right' | 'unknown'
  gap_count: number
  gap_total_ms: number
  reconnect_count: number
  updated_at: string
}

function mapTrackerQuality(r: RawTrackerQuality): TrackerQualityRow {
  return {
    sessionId: r.session_id,
    trackerKey: r.tracker_key,
    deviceId: r.device_id,
    hand: r.hand,
    gapCount: r.gap_count,
    gapTotalMs: r.gap_total_ms,
    reconnectCount: r.reconnect_count,
    updatedAt: r.updated_at,
  }
}

/** RN-safe id generator; the schema needs uniqueness, not RFC-4122 UUIDs. */
function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

/* -------------------------------------------------------------- repository */

export class SessionRepository {
  constructor(private readonly db: SqlPort) {}

  /* -- sessions -------------------------------------------------------- */

  create(input: SessionCreateInput): SessionRow {
    const id = input.id ?? newId('ses')
    const createdAt = new Date().toISOString()
    this.run(
      `INSERT INTO sessions
         (id, mode, status, started_at, ended_at, started_monotonic_ms, ended_monotonic_ms,
          active_duration_ms, timer_config_json, generated_workout_id, spotify_playlist_id,
          left_calibration_id, right_calibration_id, notes, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.mode,
        input.status ?? 'configuring',
        input.startedAtIso ?? null,
        input.startedMonotonicMs ?? null,
        input.activeDurationMs ?? 0,
        input.timerConfigJson ?? null,
        input.generatedWorkoutId ?? null,
        input.spotifyPlaylistId ?? null,
        input.leftCalibrationId ?? null,
        input.rightCalibrationId ?? null,
        input.notes ?? null,
        createdAt,
      ],
    )
    logger.info('storage.session.create', 'session created', {
      id: safe(id),
      mode: safe(input.mode),
    })
    const row = this.getById(id)
    if (!row) throw new Error(`sessions row missing after insert: ${id}`)
    return row
  }

  getById(id: string): SessionRow | null {
    const rows = this.select<RawSession>('SELECT * FROM sessions WHERE id = ?', [id])
    const row = rows[0]
    return row ? mapSession(row) : null
  }

  /**
   * Most recent first. Ordered on the monotonic start when we have one so a
   * system-clock change cannot reshuffle history (§18.3); `created_at` breaks
   * ties for sessions that never started.
   */
  list(options: ListSessionsOptions = {}): SessionRow[] {
    const where: string[] = []
    const params: SqlBindValue[] = []
    if (options.mode) {
      where.push('mode = ?')
      params.push(options.mode)
    }
    if (options.status) {
      where.push('status = ?')
      params.push(options.status)
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = options.limit ?? 100
    const offset = options.offset ?? 0
    const rows = this.select<RawSession>(
      `SELECT * FROM sessions ${clause}
        ORDER BY started_monotonic_ms DESC NULLS LAST, created_at DESC, id ASC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    return rows.map(mapSession)
  }

  /**
   * Close out a session: final status, wall-clock end, monotonic end, and the
   * accumulated active duration the timer engine measured.
   */
  markEnded(input: SessionEndInput): SessionRow | null {
    if (!this.getById(input.id)) {
      logger.warn('storage.session.end.missing', 'session not found', { id: safe(input.id) })
      return null
    }
    this.run(
      `UPDATE sessions
          SET status = ?, ended_at = ?, ended_monotonic_ms = ?, active_duration_ms = ?
        WHERE id = ?`,
      [input.status, input.endedAtIso, input.endedMonotonicMs, input.activeDurationMs, input.id],
    )
    return this.getById(input.id)
  }

  /**
   * Delete a session. SQLite cascades to its rounds, punch_events,
   * session_metrics and quality counters; `ble_frames` is never involved.
   * Returns false when nothing matched.
   */
  delete(id: string): boolean {
    if (!this.getById(id)) return false
    this.run('DELETE FROM sessions WHERE id = ?', [id])
    logger.info('storage.session.delete', 'session deleted', { id: safe(id) })
    return true
  }

  /* -- rounds ---------------------------------------------------------- */

  appendRound(input: RoundAppendInput): RoundRow {
    const id = input.id ?? newId('rnd')
    const roundNumber = input.roundNumber ?? this.nextRoundNumber(input.sessionId)
    this.run(
      `INSERT INTO rounds
         (id, session_id, round_number,
          work_started_at, work_ended_at, rest_started_at, rest_ended_at,
          work_started_monotonic_ms, work_ended_monotonic_ms,
          rest_started_monotonic_ms, rest_ended_monotonic_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.sessionId,
        roundNumber,
        input.workStartedAtIso ?? null,
        input.workEndedAtIso ?? null,
        input.restStartedAtIso ?? null,
        input.restEndedAtIso ?? null,
        input.workStartedMonotonicMs ?? null,
        input.workEndedMonotonicMs ?? null,
        input.restStartedMonotonicMs ?? null,
        input.restEndedMonotonicMs ?? null,
      ],
    )
    const row = this.getRoundById(id)
    if (!row) throw new Error(`rounds row missing after insert: ${id}`)
    return row
  }

  getRoundById(id: string): RoundRow | null {
    const rows = this.select<RawRound>('SELECT * FROM rounds WHERE id = ?', [id])
    const row = rows[0]
    return row ? mapRound(row) : null
  }

  listRounds(sessionId: string): RoundRow[] {
    return this.select<RawRound>(
      'SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number ASC',
      [sessionId],
    ).map(mapRound)
  }

  private nextRoundNumber(sessionId: string): number {
    const rows = this.select<{ n: number | null }>(
      'SELECT MAX(round_number) AS n FROM rounds WHERE session_id = ?',
      [sessionId],
    )
    return (rows[0]?.n ?? 0) + 1
  }

  /* -- punch events ---------------------------------------------------- */

  /**
   * Append one normalized event to a session.
   *
   * INSERT OR IGNORE against the compound-key dedup index from migration 002
   * (the FightCamp v1 payload has no sequence number, H11), so a re-synced
   * frame is dropped rather than raising. A dropped row bumps the session's
   * `duplicates_suppressed` counter; a row carrying a rejection reason bumps
   * `rejected_events`, and `decoder-invalid` additionally bumps
   * `malformed_events` (§9.5). Callers should therefore not also count those
   * two through {@link addQualityCounters} — `unmatched_events` is the only
   * counter this method cannot observe, because cue matching happens above
   * the storage layer.
   */
  appendPunchEvent(input: SessionPunchEventInput): AppendPunchEventResult {
    // Validated in TypeScript first: OR IGNORE would otherwise swallow the
    // CHECK violation and report a bad row as a harmless duplicate. Foreign
    // keys are unaffected by OR IGNORE and still raise, so an event pointing
    // at a missing session or round throws on its own.
    if (
      input.rejectionReason != null &&
      !(PUNCH_REJECTION_REASONS as readonly string[]).includes(input.rejectionReason)
    ) {
      throw new Error(
        `unknown rejection_reason "${String(input.rejectionReason)}" — expected one of ` +
          `${PUNCH_REJECTION_REASONS.join(', ')} (§18.2)`,
      )
    }

    const before = this.totalChanges()
    this.run(
      `INSERT OR IGNORE INTO punch_events
         (id, source_frame_id, capture_id, device_id, device_address, hand,
          tracker_timestamp_ms, received_monotonic_time_ms, received_wall_time_iso, sequence,
          punch_type_raw, punch_type, acceleration_raw,
          velocity_raw, velocity_calibrated, velocity_unit,
          recovered, decoder_id, decoder_version, quality_flags,
          session_id, round_id, calibration_profile_id, rejection_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.sourceFrameId,
        input.captureId,
        input.deviceId,
        input.deviceAddress,
        input.hand,
        input.trackerTimestampMs ?? null,
        input.receivedMonotonicTimeMs,
        input.receivedWallTimeIso,
        input.sequence ?? null,
        input.punchTypeRaw ?? null,
        input.punchType ?? null,
        input.accelerationRaw ?? null,
        input.velocityRaw ?? null,
        input.velocityCalibrated ?? null,
        input.velocityUnit,
        input.recovered ? 1 : 0,
        input.decoderId,
        input.decoderVersion,
        JSON.stringify(input.qualityFlags ?? []),
        input.sessionId,
        input.roundId ?? null,
        input.calibrationProfileId ?? null,
        input.rejectionReason ?? null,
      ],
    )
    const inserted = this.totalChanges() > before

    if (!inserted) {
      this.addQualityCounters(input.sessionId, { duplicatesSuppressed: 1 })
      return { inserted: false, duplicate: true }
    }
    if (input.rejectionReason) {
      this.addQualityCounters(input.sessionId, {
        rejectedEvents: 1,
        ...(input.rejectionReason === 'decoder-invalid' ? { malformedEvents: 1 } : {}),
      })
    }
    return { inserted: true, duplicate: false }
  }

  /** Events in monotonic order. Rejected events are included by default (§18.2). */
  listPunchEvents(sessionId: string, options: ListPunchEventsOptions = {}): SessionPunchEventRow[] {
    const where = ['session_id = ?']
    const params: SqlBindValue[] = [sessionId]
    if (options.roundId !== undefined) {
      where.push('round_id = ?')
      params.push(options.roundId)
    }
    if (options.includeRejected === false) where.push('rejection_reason IS NULL')
    return this.select<RawPunchEvent>(
      `SELECT * FROM punch_events WHERE ${where.join(' AND ')}
        ORDER BY received_monotonic_time_ms ASC, id ASC`,
      params,
    ).map(mapPunchEvent)
  }

  /* -- session_metrics (READ ONLY — M22-03 owns the writes) ------------- */

  listMetrics(sessionId: string, options: ListMetricsOptions = {}): SessionMetricRow[] {
    const where = ['session_id = ?']
    const params: SqlBindValue[] = [sessionId]
    if (options.roundId === null) {
      where.push('round_id IS NULL')
    } else if (options.roundId !== undefined) {
      where.push('round_id = ?')
      params.push(options.roundId)
    }
    if (options.calculationVersion !== undefined) {
      where.push('calculation_version = ?')
      params.push(options.calculationVersion)
    }
    return this.select<RawMetric>(
      `SELECT * FROM session_metrics WHERE ${where.join(' AND ')}
        ORDER BY metric_key ASC, calculation_version ASC, id ASC`,
      params,
    ).map(mapMetric)
  }

  /**
   * One metric, or null when it was never computed. When the same key exists
   * under several calculation versions, the lexicographically highest version
   * wins — pass `calculationVersion` explicitly to pin a specific one.
   */
  getMetric(
    sessionId: string,
    metricKey: string,
    options: ListMetricsOptions = {},
  ): SessionMetricRow | null {
    const matches = this.listMetrics(sessionId, options).filter((m) => m.metricKey === metricKey)
    return matches[matches.length - 1] ?? null
  }

  /* -- §9.5 quality counters ------------------------------------------- */

  /**
   * Add to the session-wide counters. Additive rather than absolute so a
   * long-running session can report incrementally without read-modify-write
   * races.
   */
  addQualityCounters(sessionId: string, delta: Partial<SessionQualityCounters>): void {
    this.run(
      `UPDATE sessions
          SET duplicates_suppressed = duplicates_suppressed + ?,
              rejected_events       = rejected_events + ?,
              unmatched_events      = unmatched_events + ?,
              malformed_events      = malformed_events + ?
        WHERE id = ?`,
      [
        delta.duplicatesSuppressed ?? 0,
        delta.rejectedEvents ?? 0,
        delta.unmatchedEvents ?? 0,
        delta.malformedEvents ?? 0,
        sessionId,
      ],
    )
  }

  /** Per-tracker gap and reconnect totals (§9.5). Replaces the stored row. */
  upsertTrackerQuality(input: TrackerQualityInput): void {
    this.run(
      `INSERT INTO session_tracker_quality
         (session_id, tracker_key, device_id, hand, gap_count, gap_total_ms, reconnect_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, tracker_key) DO UPDATE SET
         device_id = excluded.device_id,
         hand = excluded.hand,
         gap_count = excluded.gap_count,
         gap_total_ms = excluded.gap_total_ms,
         reconnect_count = excluded.reconnect_count,
         updated_at = excluded.updated_at`,
      [
        input.sessionId,
        input.trackerKey,
        input.deviceId ?? null,
        input.hand ?? 'unknown',
        input.gapCount ?? 0,
        input.gapTotalMs ?? 0,
        input.reconnectCount ?? 0,
        input.updatedAtIso ?? new Date().toISOString(),
      ],
    )
  }

  listTrackerQuality(sessionId: string): TrackerQualityRow[] {
    return this.select<RawTrackerQuality>(
      'SELECT * FROM session_tracker_quality WHERE session_id = ? ORDER BY tracker_key ASC',
      [sessionId],
    ).map(mapTrackerQuality)
  }

  /* -- statement plumbing ---------------------------------------------- */

  private select<TRow>(sql: string, params: SqlBindValue[]): TRow[] {
    const stmt = this.db.prepareSync(sql)
    try {
      return stmt.executeSync<TRow>(params).getAllSync()
    } finally {
      stmt.finalizeSync()
    }
  }

  private run(sql: string, params: SqlBindValue[]): void {
    const stmt = this.db.prepareSync(sql)
    try {
      stmt.executeSync(params)
    } finally {
      stmt.finalizeSync()
    }
  }

  /** Cumulative change counter; the delta tells us whether a row really landed. */
  private totalChanges(): number {
    return this.select<{ n: number }>('SELECT total_changes() AS n', [])[0]?.n ?? 0
  }
}
