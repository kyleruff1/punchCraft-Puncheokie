/**
 * Cue lifecycle types (M32-04, doc §20).
 *
 * Split from the engine so CueMatcher (#130), CueAnnouncer (M34-03) and
 * PacingEngine (M33-05) can import the event shapes without importing the
 * engine itself.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { CueInstance } from './CueTimeline'

/**
 * Doc §20 lifecycle.
 *
 * `gap` is the post-combo rest before the next cue previews. It is named
 * `gap` and not "recovery" because spec §19.3 reserves "recovery" for BLE
 * connection recovery, and one word meaning two things in a live screen's
 * telemetry is how incidents get misread (D5).
 */
export type CueStatus =
  | 'queued'
  | 'previewing'
  | 'announcing'
  | 'active'
  | 'accepting'
  | 'completed'
  | 'expired'
  | 'gap'
  | 'suspended'
  | 'cancelled'

/**
 * Scheduled versus actual, kept side by side for every cue.
 *
 * Scheduled values are fixed at load from the timeline and are in
 * **work-elapsed** milliseconds. Actual values are stamped at emission from
 * the monotonic clock. Keeping both is what lets a session be replayed and
 * recalculated later (spec §13.6) — a single "when it happened" field would
 * lose the distinction between a cue that fired late and one that was
 * scheduled late.
 */
export interface CueTimestamps {
  previewScheduledMs: number
  previewActualMs?: number
  voiceScheduledMs: number
  voiceActualMs?: number
  executionScheduledMs: number
  executionActualMs?: number
  windowCloseMs: number
  completedAtMs?: number
  /** Monotonic times of tracker events credited to this cue. */
  trackerEventTimesMs: number[]
  /**
   * Suspension spans, in monotonic time rather than work-elapsed: the work
   * clock is frozen while suspended, so recording work-elapsed would make
   * every suspension zero-length.
   */
  suspensions: { atMs: number; resumedAtMs?: number }[]
}

export type SessionPhaseEvent =
  | { type: 'work-entered'; roundIndex: number; nowMs: number }
  | {
      type: 'paused' | 'resumed' | 'rest-entered' | 'finishing' | 'cancelled'
      nowMs: number
    }

export type CueEventType =
  | 'cue-previewing'
  | 'cue-announcing'
  /**
   * Doc §18.3's T-0.10s ready tone / contracting ring. Additive to the
   * binding union: `CueEngineOptions.leadTimes.readyToneMs` would otherwise
   * be a configured value nothing could observe.
   */
  | 'cue-ready'
  | 'cue-active'
  | 'cue-window-opened'
  | 'cue-window-closed'
  | 'cue-completed'
  | 'cue-expired'
  | 'cue-suspended'
  | 'cue-resumed'
  | 'cue-cancelled'

export type CueEvent =
  | {
      type: CueEventType
      cue: CueInstance
      status: CueStatus
      timestamps: CueTimestamps
      workElapsedMs: number
      nowMs: number
    }
  | {
      type: 'token-due'
      cue: CueInstance
      tokenIndex: number
      /**
       * Compiled repetition identifier for the strike (M39-V2
       * Phase 2' amendment). Sequence cues that haven't been
       * expanded through Phase 3's per-rep compiler carry
       * `DEFAULT_REP_ID` ("rep-0"). A `1-1-2 × 3` cue compiled
       * with repetition expansion produces `rep-0`, `rep-1`,
       * `rep-2`.
       */
      repId: string
      /**
       * Stable per-occurrence identifier —
       * `${cueId}:${repId}:${tokenIndex}` (M39-V2 Phase 2').
       * Distinguishes every strike across the cue's repetitions,
       * so consumers dedupe by unique id — the two `1`s in one
       * rep AND the three reps of a repeated combo all get their
       * own ids.
       */
      strikeId: string
      workElapsedMs: number
      nowMs: number
    }

/** Statuses a cue can no longer leave. */
export const TERMINAL_STATUSES: ReadonlySet<CueStatus> = new Set<CueStatus>([
  'completed',
  'expired',
  'gap',
  'cancelled',
])
