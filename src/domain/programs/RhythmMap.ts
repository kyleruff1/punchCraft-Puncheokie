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
  | 'set-callout'

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

/**
 * One part of a pre-set ceremony (Set Ceremonies): a rendered sentence
 * clip, or a recitation of the set's notation replayed from the phrase
 * library at technical cadence.
 */
export type SetCalloutPayload =
  | { asset: string }
  | { recite: string; cadence: 'technical' }

/** Ceremony must FINISH this long before the set's first call starts. */
export const SET_CALLOUT_QUIET_MS = 500
/**
 * Breath between ceremony parts (sentence → recitation → tail). Widened
 * 250 → 450 after Kyle heard parts stack under tick jitter ("chaos"):
 * a dispatch that lands one busy tick late must not run into the next
 * part's absolute time.
 */
export const SET_CALLOUT_PART_GAP_MS = 450
/** Ceremony never starts before the previous cue's window has ended. */
export const SET_CALLOUT_MIN_CLEAR_MS = 200
/**
 * Quiet after the round bell before the FIRST ceremony may speak — the
 * ding-ding (and the walkout's tail on round one) needs room to land;
 * without it the round opens as clutter (Kyle's live note).
 */
export const ROUND_OPEN_QUIET_MS = 1_500

/**
 * The 30-second closer (Kyle): every round, the coach yells "Thirty
 * seconds left in this round!" and a rotating finisher. Compiled at
 * T-30s, nudged earlier up to the search window to clear calls, skipped
 * if no quiet exists — the voiced replacement for the retired warning
 * beep, and the round-end hype the athlete actually wants.
 */
export const CLOSER_AT_REMAINING_MS = 30_000
export const CLOSER_SEARCH_BACK_MS = 4_000
export const CLOSER_ROTATION: readonly string[] = [
  'co-closer-01', 'co-closer-02', 'co-closer-03', 'co-closer-04',
  'co-closer-05', 'co-closer-06', 'co-closer-07', 'co-closer-08',
  'co-closer-09', 'co-closer-10', 'co-closer-11', 'co-closer-12',
  'co-closer-13',
]

export interface EncouragementPayload {
  asset:
    | 'double-up'
    | 'put-it-on-em'
    | 'touch-and-go'
    | 'breathe'
    | 'hands-up'
    | 'power-strikes'
}

/**
 * The rotation the compiler deals encouragement from — deterministic (the
 * compiler is pure; roundIndex + slot pick the line), energy-ordered so a
 * burst gap gets a push and a recovery gap gets a breath.
 */
export const ENCOURAGEMENT_ROTATION: readonly EncouragementPayload['asset'][] = [
  'double-up',
  'hands-up',
  'put-it-on-em',
  'breathe',
  'touch-and-go',
]

/**
 * Repeat thinning (Kyle: "end of this round with 10 seconds left,
 * overlapping audio"): a tightened pressure phase can rep a combination
 * faster than its phrase clip plays — 1b-pairs carry an extra "body" and
 * run ~1.5s against a ~1.2s rep interval, so every rep's call stepped on
 * the last for the final 20s of the round. When the SAME combination
 * repeats before the previous phrase (plus this clearance) can finish,
 * the repeat is not re-called — the athlete knows the combo and the
 * strike grid is untouched. A changed combination is always called.
 */
export const REANNOUNCE_MIN_CLEAR_MS = 150

/** Voiced gaps longer than this earn an encouragement (research: 15-20s grid). */
export const ENCOURAGEMENT_GAP_MS = 15_000
/** Density cap per round — a coach interjects, never narrates. */
export const MAX_ENCOURAGEMENTS_PER_ROUND = 6

/**
 * Power mode (Kyle's rule): a run of 1-2 strike segments spaced this wide
 * has dropped the pace on purpose — those reps are POWER strikes, and the
 * coach says so ("Okay, power strikes! Slow down a bit — and hit it
 * HARD!"). Without the announcement a slow window just feels empty.
 */
export const POWER_MAX_TOKENS = 2
export const POWER_MIN_INTERVAL_MS = 5_000
export const POWER_MIN_REPS = 3
export const MAX_POWER_ANNOUNCES_PER_ROUND = 2

export interface RhythmEvent {
  /** Unique within the round — precise cancellation needs identity. */
  id: string
  /** The owning cue, or a synthetic id for round-level events. */
  cueId: string
  kind: RhythmEventKind
  /** Round-relative (work-elapsed) milliseconds. */
  atMs: number
  payload:
    | CallPayload
    | TonePayload
    | PhasePayload
    | EncouragementPayload
    | SetCalloutPayload
    | null
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

/** Per-token word timing from the phrase manifest, for the cadence rail. */
export interface WordMark {
  tokenIndex: number
  offsetMs: number
  endOffsetMs?: number
}

/**
 * The scalable cadence rail's constant: ring N fires this long after
 * word N's audible envelope ends, giving both vocabularies a predictable
 * proportional lag between the coach's voice and the ring animation.
 * A single project constant so cross-vocab consistency is a property of
 * the rail, not of per-vocab tuning.
 */
export const RAIL_K_MS = 120

export interface CompileOptions {
  /** The workout's cadence profile — the default when a cue names none. */
  cadence: string
  /**
   * Measured phrase length for a combination at a cadence, or undefined
   * when the library has no rendering — injected, because the manifest
   * lives outside the domain. Undefined selects the per-word call mode.
   */
  durationFor: (combination: string, cadence: string) => number | undefined
  /**
   * Per-clip placement shift in milliseconds — the cadence-lab surgical
   * knob (2026-08-28). Positive starts the clip EARLIER (fixes a clip
   * whose spoken token lagged its ring); negative starts it later. Kept
   * as a per-clip nudge rather than a global lead-time change because
   * Kyle's ear read the library as ~75 % clean, drift set-dependent —
   * a blanket adjustment would move the aligned 75 % out of alignment.
   * Absent or 0 = shipped behaviour unchanged.
   */
  phraseShiftFor?: (combination: string, cadence: string) => number | undefined
  /**
   * Scalable cadence rail (2026-08-28): per-token word onsets and ends
   * (ms into the clip) that let the compiler derive ring-fire times from
   * the coach's actual word timing instead of the beat grid. When
   * provided AND every token has both `offsetMs` and `endOffsetMs`, the
   * clip is placed so word 0's END lands `RAIL_K_MS` before ring 0, and
   * rings 1+ follow the clip's inter-word spacing. Absent OR gap in the
   * marks → beat-grid fallback, byte-identical to the pre-rail behaviour.
   */
  wordMarksFor?: (combination: string, cadence: string) => WordMark[] | undefined
  leadTimes?: AnnouncerLeadTimes
  /**
   * Schedule encouragement into voiced gaps longer than the grid (M4).
   * Off by default so existing compiles stay byte-identical; the runner
   * turns it on when the recipe enables coach calls.
   */
  encouragement?: boolean
  /**
   * Set Ceremonies: measured duration of a call-out sentence clip, or
   * undefined when it is not rendered. Absent entirely = no ceremony
   * events — compiles stay byte-identical by construction.
   */
  setupCalloutDurationFor?: (asset: string) => number | undefined
}

/** Compile one round's audio schedule from its expanded timeline. */
export function compileRoundRhythmMap(
  round: RoundTimeline,
  opts: CompileOptions,
): RoundRhythmMap {
  const leadTimes = opts.leadTimes ?? { ...DEFAULT_ANNOUNCE_LEAD_TIMES }
  const events: RhythmEvent[] = []
  // The repeat-thinning window: the phrase currently "on air", so a
  // same-combination rep arriving before it clears is not re-called.
  let lastPhrase: { combination: string; endMs: number } | null = null

  for (let cueIndex = 0; cueIndex < round.cues.length; cueIndex += 1) {
    const cue = round.cues[cueIndex] as RoundTimeline['cues'][number]
    // No ready tones are compiled: the coach's voice IS the cue (Kyle's
    // sound design — no beeps, ever; a tone before every call put
    // hundreds of chirps under the vocals per workout). `readyToneMs`
    // survives only as the quiet margin a phrase must finish inside.

    // Per-block cadence (M4, doc §17): a flurry block is CALLED in the
    // sprint rendering even while the beat grid stays on the workout's
    // profile — the cadence names which recording speaks, and the clips
    // exist at all four bands.
    const cadence = cue.cadence ?? opts.cadence
    const combination = formatCombo(cue.tokens)
    const lengthMs = opts.durationFor(combination, cadence)
    let callStartAt = cue.announceAt
    if (lengthMs === undefined) {
      // No rendered phrase: the per-word fallback starts at the announce
      // lead, exactly where the event-driven announcer started it. Its
      // length is unknown here, so the thinning window resets.
      lastPhrase = null
      events.push({
        id: `${cue.id}/call`,
        cueId: cue.id,
        kind: 'call',
        atMs: cue.announceAt,
        payload: { mode: 'per-word', combination, cadence },
        cancelsWith: 'cue-end',
      })
    } else {
      // A phrase is placed to FINISH by the ready tone; when it cannot, it
      // starts at the preview and runs slightly long — reported by the
      // executor, never silent (doc §18 rule, unchanged). The scalable
      // rail refines this: when the clip has per-token wordMarks with
      // end-of-word times, the clip is placed so word 0 ends RAIL_K_MS
      // before ring 0, and rings 1+ follow the clip's inter-word spacing
      // via phraseTokenTimesMs. Without wordMarks the old placement holds
      // and ring cadence stays on the beat grid.
      const marks = opts.wordMarksFor?.(combination, cadence)
      const railMarks = marks && marks.length === cue.tokens.length &&
        marks.every((m) => typeof m.endOffsetMs === 'number')
        ? marks
        : null

      const finishBy = cue.scheduledStartMs - leadTimes.readyToneMs
      const phraseShift = opts.phraseShiftFor?.(combination, cadence) ?? 0
      const railWord0End = railMarks?.[0]?.endOffsetMs
      const railStartAt =
        railMarks && railWord0End !== undefined
          ? cue.scheduledStartMs - RAIL_K_MS - railWord0End
          : null
      // Rail placement respects the preview floor same as the classic rule.
      const railStartFits = railStartAt !== null && railStartAt >= cue.previewAt
      const startAt = railStartFits
        ? (railStartAt as number)
        : Math.max(cue.previewAt, finishBy - lengthMs - phraseShift)
      callStartAt = startAt
      // Stamp per-token ring times on the cue when the rail is active.
      // Ring N fires (word[N] end wall time) + RAIL_K_MS, expressed as an
      // offset from cue.scheduledStartMs (same reference as tokenOffsetsMs).
      if (railMarks && railStartFits) {
        const railStart = railStartAt as number
        const times: number[] = []
        for (let i = 0; i < railMarks.length; i += 1) {
          const mark = railMarks[i]
          const end = mark?.endOffsetMs
          if (end === undefined) {
            // Should be unreachable per the `railMarks` guard, but be
            // defensive: if any token is missing an end, fall back to
            // the beat grid rather than stamping a partial override.
            cue.phraseTokenTimesMs = undefined
            break
          }
          const wordEndWall = railStart + end
          times.push(Math.round(wordEndWall + RAIL_K_MS - cue.scheduledStartMs))
        }
        if (times.length === railMarks.length) cue.phraseTokenTimesMs = times
      }
      // Repeat thinning: a same-combination rep that lands while the
      // previous phrase is still sounding is NOT re-called. Ceremony
      // cues are exempt — their placement anchors on this call.
      const crowded =
        lastPhrase !== null &&
        lastPhrase.combination === combination &&
        startAt < lastPhrase.endMs + REANNOUNCE_MIN_CLEAR_MS &&
        cue.setupCallout === undefined
      if (!crowded) {
        lastPhrase = { combination, endMs: startAt + lengthMs }
        events.push({
          id: `${cue.id}/call`,
          cueId: cue.id,
          kind: 'call',
          atMs: startAt,
          payload: { mode: 'phrase', combination, cadence },
          cancelsWith: 'cue-end',
        })
      }

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
              payload: { mode: 'phrase', combination, cadence },
              cancelsWith: 'cue-end',
            })
            refireIndex += 1
          }
        }
      }
    }

    // ---- Set Ceremonies: the pre-set call-out, compiled INSIDE the
    // fill's reservation (cue.setupCallout only exists on a block's
    // first cue, and the fill laid `leadInBeats` of quiet before it).
    // Placement is backward from the set's own first call, degrading
    // gracefully: drop the recitation, then the tail, then everything.
    // No other event is touched — the property test holds them
    // byte-identical with the feature on or off.
    if (cue.setupCallout !== undefined && opts.setupCalloutDurationFor !== undefined) {
      const ceremony = cue.setupCallout
      const sentenceMs = opts.setupCalloutDurationFor(ceremony.asset)
      if (sentenceMs !== undefined) {
        const prev = round.cues[cueIndex - 1]
        const earliest =
          prev === undefined
            ? ROUND_OPEN_QUIET_MS
            : prev.scheduledEndMs + SET_CALLOUT_MIN_CLEAR_MS
        const anchor = callStartAt - SET_CALLOUT_QUIET_MS
        const reciteMs =
          ceremony.notation === undefined
            ? undefined
            : opts.durationFor(ceremony.notation, 'technical')
        const tailMs =
          ceremony.tail === undefined ? undefined : opts.setupCalloutDurationFor(ceremony.tail)

        // Try full → no recite → sentence only, keeping whatever fits.
        const attempts: Array<{ recite: boolean; tail: boolean }> = [
          { recite: reciteMs !== undefined, tail: tailMs !== undefined },
          { recite: false, tail: tailMs !== undefined },
          { recite: false, tail: false },
        ]
        for (const attempt of attempts) {
          const parts: Array<{ payload: SetCalloutPayload; durationMs: number }> = [
            { payload: { asset: ceremony.asset }, durationMs: sentenceMs },
          ]
          if (attempt.recite && ceremony.notation !== undefined && reciteMs !== undefined) {
            parts.push({
              payload: { recite: ceremony.notation, cadence: 'technical' },
              durationMs: reciteMs,
            })
          }
          if (attempt.tail && ceremony.tail !== undefined && tailMs !== undefined) {
            parts.push({ payload: { asset: ceremony.tail }, durationMs: tailMs })
          }
          const totalMs =
            parts.reduce((sum, part) => sum + part.durationMs, 0) +
            SET_CALLOUT_PART_GAP_MS * (parts.length - 1)
          const startAt = anchor - totalMs
          if (startAt < earliest) continue
          let at = startAt
          parts.forEach((part, k) => {
            events.push({
              id: `${cue.id}/ceremony#${k}`,
              cueId: cue.id,
              kind: 'set-callout',
              atMs: Math.round(at),
              payload: part.payload,
              cancelsWith: 'cue-end',
            })
            at += part.durationMs + SET_CALLOUT_PART_GAP_MS
          })
          break
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

  // ---- The 30-second closer: placed against the round's real call
  // schedule, in quiet, never moving anything else.
  if (opts.setupCalloutDurationFor && round.workDurationMs > 60_000) {
    const thirtyMs = opts.setupCalloutDurationFor('co-thirty-left')
    const closerId = CLOSER_ROTATION[round.roundIndex % CLOSER_ROTATION.length] as string
    const closerMs = opts.setupCalloutDurationFor(closerId)
    if (thirtyMs !== undefined && closerMs !== undefined) {
      // Unconditional at T-30s: this is HYPE OVER THE ACTION, not a
      // ceremony needing quiet — the pressure phase it lands in has no
      // multi-second gaps by design, and the coach yelling over the work
      // is exactly the effect. Additive events only; nothing moves.
      const start = round.workDurationMs - CLOSER_AT_REMAINING_MS
      events.push({
        id: 'closer#thirty',
        cueId: 'closer',
        kind: 'set-callout',
        atMs: start,
        payload: { asset: 'co-thirty-left' },
        cancelsWith: 'round-end',
      })
      events.push({
        id: 'closer#line',
        cueId: 'closer',
        kind: 'set-callout',
        atMs: Math.round(start + thirtyMs + SET_CALLOUT_PART_GAP_MS),
        payload: { asset: closerId },
        cancelsWith: 'round-end',
      })
    }
  }

  if (opts.encouragement) {
    // Power mode (Kyle's rule): find runs of the same 1-2 strike segment
    // spaced wide enough that the pace has clearly dropped, and call out
    // WHY — inside the window, right after the slow part starts, in the
    // first wide gap between strikes.
    let powerAdded = 0
    let runStart = 0
    while (runStart < round.cues.length && powerAdded < MAX_POWER_ANNOUNCES_PER_ROUND) {
      const first = round.cues[runStart]
      if (!first || first.tokens.length > POWER_MAX_TOKENS) {
        runStart += 1
        continue
      }
      const combination = formatCombo(first.tokens)
      let runEnd = runStart + 1
      while (
        runEnd < round.cues.length &&
        formatCombo((round.cues[runEnd] as (typeof round.cues)[number]).tokens) === combination
      ) {
        runEnd += 1
      }
      const run = round.cues.slice(runStart, runEnd)
      if (run.length >= POWER_MIN_REPS) {
        const intervals = run
          .slice(1)
          .map((cue, i) => cue.scheduledStartMs - (run[i] as (typeof run)[number]).scheduledStartMs)
        const slowest = Math.min(...intervals)
        if (slowest >= POWER_MIN_INTERVAL_MS) {
          const firstGap = intervals[0] as number
          events.push({
            id: `power#${powerAdded}`,
            cueId: `power#${powerAdded}`,
            kind: 'encouragement',
            // 40% into the first inter-strike gap: the athlete has felt
            // one slow rep, and the next call's announce lead is clear.
            atMs: (first as (typeof round.cues)[number]).scheduledStartMs + Math.round(firstGap * 0.4),
            payload: { asset: 'power-strikes' },
            cancelsWith: 'round-end',
          })
          powerAdded += 1
        }
      }
      runStart = runEnd
    }
    // Fill audited silence: any gap between voiced events longer than the
    // grid earns one line from the rotation, deterministic per round and
    // slot, density-capped. The compiler placed every call, so a scheduled
    // encouragement can never collide with one — it lands in guaranteed
    // quiet (the runtime queue still yields it first if anything moves).
    // Ceremonies and closers are SPANS, not instants: a rotation line
    // placed between two ceremony parts lands inside the ceremony (the
    // overlapping-voices chaos Kyle heard). Every voiced event
    // contributes its END too, so gap bounds respect real durations.
    const voicedTimes = events
      .filter(
        (e) =>
          e.kind === 'call' ||
          e.kind === 'refire' ||
          e.kind === 'encouragement' ||
          e.kind === 'set-callout',
      )
      .flatMap((e) => {
        if (e.kind === 'set-callout') {
          const payload = e.payload as SetCalloutPayload
          const lengthMs =
            'recite' in payload
              ? opts.durationFor(payload.recite, payload.cadence) ?? 2_000
              : opts.setupCalloutDurationFor?.(payload.asset) ?? 2_500
          return [e.atMs, e.atMs + lengthMs]
        }
        if (e.kind === 'call' || e.kind === 'refire') {
          const payload = e.payload as CallPayload
          const lengthMs = opts.durationFor(payload.combination, payload.cadence) ?? 1_500
          return [e.atMs, e.atMs + lengthMs]
        }
        // Encouragement lines are short interjections; a nominal length
        // keeps a rotation line from being packed against a power call.
        return [e.atMs, e.atMs + 1_800]
      })
      .sort((a, b) => a - b)
    const bounds = [0, ...voicedTimes, round.workDurationMs]
    let added = 0
    for (let i = 1; i < bounds.length && added < MAX_ENCOURAGEMENTS_PER_ROUND; i += 1) {
      const gap = (bounds[i] as number) - (bounds[i - 1] as number)
      if (gap <= ENCOURAGEMENT_GAP_MS) continue
      // A long gap gets the full grid, not one lonely line in the middle —
      // evenly spaced interjections, still under the round's density cap.
      const slots = Math.min(
        Math.floor(gap / ENCOURAGEMENT_GAP_MS),
        MAX_ENCOURAGEMENTS_PER_ROUND - added,
      )
      for (let k = 1; k <= slots; k += 1) {
        const atMs = Math.round((bounds[i - 1] as number) + (gap * k) / (slots + 1))
        const asset = ENCOURAGEMENT_ROTATION[
          (round.roundIndex + added) % ENCOURAGEMENT_ROTATION.length
        ] as EncouragementPayload['asset']
        events.push({
          id: `encourage#${added}`,
          cueId: `encourage#${added}`,
          kind: 'encouragement',
          atMs,
          payload: { asset },
          cancelsWith: 'round-end',
        })
        added += 1
      }
    }
  }

  events.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id))
  const voicedEvents = events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.kind === 'call' ||
        event.kind === 'refire' ||
        event.kind === 'encouragement' ||
        event.kind === 'set-callout',
    )
    .map(({ index }) => index)

  return {
    roundIndex: round.roundIndex,
    workDurationMs: round.workDurationMs,
    events,
    voicedEvents,
  }
}
