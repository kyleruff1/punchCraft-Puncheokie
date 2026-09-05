/**
 * Normalized punch event contract (spec §12.5).
 *
 * Velocity values are labeled 'tracker-unit' by default per §4.3 — a raw
 * decoder must never claim m/s / mph / g / force / power / energy. The
 * literal 'power' appearing in `punchType` is a punch classification, not
 * a physical unit, and is allowlisted by §12.5.
 *
 * Pure types only. No runtime code. No RN / Expo / BLE / SQLite imports.
 */

import type { PunchQualityFlag } from './PunchQuality'

export type PunchHand = 'left' | 'right' | 'unknown'

export type PunchType = 'straight' | 'hook' | 'uppercut' | 'power' | 'unknown'

export type PunchVelocityUnit =
  | 'unknown'
  | 'tracker-unit'
  | 'index'
  | 'cm/s'
  | 'm/s'
  | 'mph'

export interface TrackerPunchEvent {
  id: string
  sourceFrameId: string
  deviceId: string
  hand: PunchHand
  trackerTimestampMs?: number
  receivedMonotonicTimeMs: number
  receivedWallTimeIso: string
  sequence?: number
  punchTypeRaw?: number
  punchType?: PunchType
  /**
   * Peak acceleration, verbatim u16 from the record (bytes 1-2 LE on the
   * 9-byte layout). Tracker-scale — not validated against any physical
   * unit; normalize per hand before use (Puncheoke instrument-design §14).
   */
  accelerationRaw?: number
  velocityRaw?: number
  velocityCalibrated?: number
  velocityUnit: PunchVelocityUnit
  recovered: boolean
  decoderId: string
  decoderVersion: string
  qualityFlags: PunchQualityFlag[]
}

/**
 * Confirmed punch event — reserved for future refinement once the
 * confirmation pipeline (dedup, active-interval gating, user review) is
 * distinct from raw tracker events. Alias for TrackerPunchEvent for now.
 */
export type ConfirmedPunchEvent = TrackerPunchEvent
