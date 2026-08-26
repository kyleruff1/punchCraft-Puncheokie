/**
 * The Rhythm Map (M2) — one compiled timeline per round that audio and
 * presentation both consume.
 *
 * Every timing bug the live instruments caught this cycle was a second
 * party computing a deadline: the announcer derived call times from events,
 * the output port kept its own timers, and the two could disagree with the
 * screen. The map ends that: call placement, ready tones, burst re-calls
 * and phase marks are compiled here, once, from the same expanded timeline
 * the cue engine runs — and the conductor (the runner's tick) dispatches
 * them against the same clock sample that moves the screen.
 *
 * What the map deliberately does NOT decide:
 *
 * - **Permission.** The D1 gate (someone else's audio), voice policy and
 *   style are runtime conditions; the executor checks them at dispatch.
 *   The map says when a call would happen, never whether it may.
 * - **Per-word delivery detail.** A combination with no rendered phrase is
 *   compiled as a `per-word` call at the announce lead; the executor plans
 *   the word-by-word delivery at dispatch, where measured clip lengths
 *   live. The MAP time still governs when it starts.
 * - **Cue visuals.** The engine owns the cue lifecycle; the map carries the
 *   audio schedule beside it, not a copy of it.
 *
 * Compilation is pure and cheap — recompile a round whenever a pacing
 * mutation touches it.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { formatCombo } from '../workout/WorkoutTokens'
import type { RoundTimeline } from './CueTimeline'

/** Doc §18.3: voice at T−0.75 s, ready tone at T−0.10 s. M36-03 tunes these. */
export const DEFAULT_ANNOUNCE_LEAD_TIMES = { announceMs: 750, readyToneMs: 100 } as const

export interface AnnouncerLeadTimes {
  announceMs: number
  readyToneMs: number
}

/**
 * How often to re-call the motif during a count-scored burst, in ms.
 *
 * Six seconds is short enough that the pattern stays present for an athlete
 * drifting into a rhythm and long enough that it does not stack on itself.
 * The companion minimum avoids re-firing on a burst so short the initial
 * call already covers it; the tail-quiet keeps the last re-call from
 * running into the next block's announce.
 */
export const BURST_REFIRE_INTERVAL_MS = 6_000
export const MIN_BURST_MS_FOR_REFIRE = 10_000
export const BURST_TAIL_QUIET_MS = 1_500

/**
 * Phase marks (doc research, Rhythm Map plan): the round announces its own
 * arc at ~50% (push begins) and ~83% (red zone / final push).
 */
export const PHASE_MARKS = [0.5, 0.83] as const

export type RhythmEventKind =
  | 'cue'
  | 'call'
  | 'refire'
  | 'tone'
  | 'phase-announce'
  | 'encouragement'
  | 'movement'

export interface CallPayload {
  mode: 'phrase' | 'per-word'
  combination: string
  cadence: string
}

export interface TonePayload {
  tone: 'ready'
}

export interface PhasePayload {
  /** Fraction of the round at which this mark sits (0..1). */
  at: number
}

export interface RhythmEvent {
  /** Unique within the round — precise cancellation needs identity. */
  id: string
  /** The owning cue, or a synthetic id for round-level events. */
  cueId: string
  kind: RhythmEventKind
  /** Round-relative (work-elapsed) milliseconds. */
  atMs: number
  payload: CallPayload | TonePayload | PhasePayload | null
  cancelsWith: 'cue-end' | 'round-end' | 'never'
}

export interface RoundRhythmMap {
  roundIndex: number
  workDurationMs: number
  /** Sorted by atMs. */
  events: RhythmEvent[]
  /** Indices into `events` of everything audible — the silence audit reads this. */
  voicedEvents: number[]
}

export interface CompileOptions {
  /** Cadence profile id — selects which phrase rendering a call names. */
  cadence: string
  /**
   * Measured phrase length for a combination at this cadence, or undefined
   * when the library has no rendering — injected, because the manifest
   * lives outside the domain. Undefined selects the per-word call mode.
   */
  durationFor: (combination: string) => number | undefined
  leadTimes?: AnnouncerLeadTimes
}

/** Compile one round's audio schedule from its expanded timeline. */
export function compileRoundRhythmMap(
  round: RoundTimeline,
  opts: CompileOptions,
): RoundRhythmMap {
  const leadTimes = opts.leadTimes ?? { ...DEFAULT_ANNOUNCE_LEAD_TIMES }
  const events: RhythmEvent[] = []

  for (const cue of round.cues) {
    const readyAt = cue.scheduledStartMs - leadTimes.readyToneMs
    events.push({
      id: `${cue.id}/tone`,
      cueId: cue.id,
      kind: 'tone',
      atMs: readyAt,
      payload: { tone: 'ready' },
      cancelsWith: 'cue-end',
    })

    const combination = formatCombo(cue.tokens)
    const lengthMs = opts.durationFor(combination)
    if (lengthMs === undefined) {
      // No rendered phrase: the per-word fallback starts at the announce
      // lead, exactly where the event-driven announcer started it.
      events.push({
        id: `${cue.id}/call`,
        cueId: cue.id,
        kind: 'call',
        atMs: cue.announceAt,
        payload: { mode: 'per-word', combination, cadence: opts.cadence },
        cancelsWith: 'cue-end',
      })
    } else {
      // A phrase is placed to FINISH by the ready tone; when it cannot, it
      // starts at the preview and runs slightly long — reported by the
      // executor, never silent (doc §18 rule, unchanged).
      const finishBy = cue.scheduledStartMs - leadTimes.readyToneMs
      const startAt = Math.max(cue.previewAt, finishBy - lengthMs)
      events.push({
        id: `${cue.id}/call`,
        cueId: cue.id,
        kind: 'call',
        atMs: startAt,
        payload: { mode: 'phrase', combination, cadence: opts.cadence },
        cancelsWith: 'cue-end',
      })

      if (cue.scoring === 'count') {
        const windowMs = cue.windowEndMs - cue.scheduledStartMs
        if (windowMs >= MIN_BURST_MS_FOR_REFIRE) {
          const lastStart = cue.windowEndMs - lengthMs - BURST_TAIL_QUIET_MS
          let refireIndex = 0
          for (
            let at = cue.scheduledStartMs + BURST_REFIRE_INTERVAL_MS;
            at <= lastStart;
            at += BURST_REFIRE_INTERVAL_MS
          ) {
            events.push({
              id: `${cue.id}/refire#${refireIndex}`,
              cueId: cue.id,
              kind: 'refire',
              atMs: at,
              payload: { mode: 'phrase', combination, cadence: opts.cadence },
              cancelsWith: 'cue-end',
            })
            refireIndex += 1
          }
        }
      }
    }
  }

  for (const mark of PHASE_MARKS) {
    events.push({
      id: `phase#${Math.round(mark * 100)}`,
      cueId: `phase#${Math.round(mark * 100)}`,
      kind: 'phase-announce',
      atMs: Math.round(round.workDurationMs * mark),
      // Payload arrives with M4's phase clips; a null payload is declared
      // but silent, so the schedule is visible before the voice exists.
      payload: { at: mark },
      cancelsWith: 'round-end',
    })
  }

  events.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id))
  const voicedEvents = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.kind === 'call' || event.kind === 'refire' || event.kind === 'tone')
    .map(({ index }) => index)

  return {
    roundIndex: round.roundIndex,
    workDurationMs: round.workDurationMs,
    events,
    voicedEvents,
  }
}
