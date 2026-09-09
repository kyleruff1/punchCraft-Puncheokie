/**
 * Workout runner (M32-08).
 *
 * The one place the session clock, the cue engine and the punch source are
 * wired together. Everything above it reads the store; everything below it
 * is pure and clock-driven.
 *
 * Three things are deliberate here:
 *
 * 1. **The loop is a single interval, not one per subsystem.** The session
 *    clock advances, then the cue engine ticks against the work clock it
 *    produced. One ordering, one place to reason about it.
 * 2. **Store writes are throttled.** The loop runs at 50ms so cue timing is
 *    accurate to a frame, but the store is written at most every 100ms
 *    (spec §15.3) — the UI cannot use more and every write re-renders the
 *    zones. Counts changed by a punch flush immediately, because a punch
 *    landing must feel instant.
 * 3. **No raw event array reaches the store.** Only counts and the two
 *    velocity readings a surface actually shows.
 *
 * Matching runs through `LiveCueMatcher` (#188): a punch is credited
 * provisionally the moment it lands, and the cue settles authoritatively
 * when its window closes. Settled results accumulate here for M33-08 to
 * persist as `cue_results`.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { CueEngine, DEFAULT_LEAD_TIMES } from '@domain/programs/CueEngine'
import { LiveCueMatcher, type LiveMatcherEvent } from '@domain/programs/LiveCueMatcher'
import { PacingEngine, type PacingCueText } from '@domain/programs/PacingEngine'
import { bpmForRecipe, CADENCE_PROFILES as CADENCE } from '@domain/workout/cadence'
import { metronomeLoopFor, type MetronomeLoop } from '@audio/voiceAssets/metronomeAssets'
import type { CueMatchResult } from '@domain/programs/CueMatcher'
import type { CueScore } from '@domain/programs/cueScoring'
import { expandTimeline, type CueInstance, type ExpectedPunch } from '@domain/programs/CueTimeline'
import { beatOrdinalAt } from '@domain/programs/beatProjection'
import { CALLOUT_CLIPS } from '@audio/voiceAssets/calloutManifest'
import {
  findComboAnnounce,
  findComboAnnounceById,
} from '@audio/voiceAssets/comboAnnounceManifest'
import { runtimeCoachAssetResolver } from '@audio/coachAssetResolvers'
import { SlotDispatcher } from '@audio/SlotDispatcher'
import { compileWorkoutScore } from '@domain/programs/workoutScore'
import { roundStartTicksFrom, scoreTickAt } from '@domain/programs/scoreClock'
import type { RoundWalkPlan } from '@/components/workout/useRingBeatClock'
import { type SharedWorkClock } from '@domain/timing/SharedWorkClock'
import { instructionClipFor } from '@audio/voiceAssets/instructionManifest'
import { findClickScript } from '@audio/voiceAssets/clickScriptManifest'
import { avatarTargetIndex, buildAvatarTrack, type AvatarTrackEntry } from '@domain/programs/avatarTrack'
import { compileRoundRhythmMap } from '@domain/programs/RhythmMap'
import {
  compileRoundSpine,
  pulseCursorAt,
  type SpineSchedule,
} from '@domain/programs/RhythmSpine'
import { resolveCapabilityTier, sequenceScoreLabel } from '@domain/workout/capabilityTier'
import { systemMonotonicClock, type MonotonicClock } from '@domain/time/MonotonicClock'
import { WorkoutSessionClock, type SessionTransition } from '@domain/session/WorkoutSessionClock'
import { RoundResultFreeze } from '@domain/session/restPhases'
import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'
import type { PunchEventSource } from '@domain/punch/PunchEventSource'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import type { BackdropImpulsePort } from '@domain/effects/BackdropImpulsePort'
import { formatCombo, type Stance } from '@domain/workout/WorkoutTokens'
import type { CueEvent, SessionPhaseEvent } from '@domain/programs/CueState'
import type { TokenVisualState } from '@components/workout/tokenVisuals'
import type { CueView } from '@components/workout/CueStage'
import { logger, safe } from '@diagnostics/logger'
import { VizForensics, type VizRecord } from '@diagnostics/vizForensics'
import { CueAnnouncer, deliveryForCadence } from '@domain/coach/CueAnnouncer'
import { selectPerformanceState } from '@domain/coach/performanceState'
import { AUDIO_PRIORITY, type VoiceOutputPort } from '@domain/coach/VoiceOutputPort'
import type { HapticOutputPort } from '@domain/coach/HapticOutputPort'
import { TIMING_TIGHT_MS } from '@domain/programs/cueScoring'
import {
  shouldSpeak,
  voiceAllowed,
  type VoiceCoachPolicy,
} from '@domain/coach/VoiceCoachPolicy'
import type { ThirdPartyPlaybackDetector } from '@audio/ThirdPartyPlaybackDetector'
import { getWorkoutPersistence, type WorkoutPersistence } from '@storage/getWorkoutPersistence'
import { persistWorkoutSession, type PersistedWorkoutSession } from '@storage/persistWorkoutSession'
import { toCueResultRows, type PendingCueResultRow } from '@storage/cueResultRows'
import type {
  AdaptationRecord,
  RealizedTokenStream,
} from '@storage/repositories/WorkoutRepository'
import { CALL_DISPATCH_LAG_MS, callDispatchAtMs, leadInDispatchAtMs } from '@domain/coach/callPlacement'
import { isQaEnabled } from '@state/useQaStore'
import { getLive, resetLive, setLive, type LiveVelocity } from '@state/useWorkoutStore'

/** Loop cadence — fine enough that a cue fires within a frame of its time. */
export const TICK_INTERVAL_MS = 50

// Call and lead-in PLACEMENT — constants and arithmetic — now live in
// `src/domain/coach/callPlacement.ts` so the Node analysis tools and the
// domain tests can import the same numbers instead of restating them.
// Re-exported here because this module was their only home for a long
// time and plenty of code (and every existing test) imports them from it.
export {
  LEAD_IN_PAD_MS,
  CALL_PAD_MS,
  CALL_DISPATCH_LAG_MS,
  TECHNIQUE_CALL_LEAD_MS,
  TECHNIQUE_LEADIN_LEAD_MS,
  NUMBERS_CALL_LEAD_MS,
  DENSE_BREATH_MS,
  BREATH_REF_SLOT_MS,
  BREATH_TRACK_GAIN,
  MIN_BREATH_MS,
  DELIVERED_BREATH_SHORTFALL_MS,
  CALL_BREATH_OVERRIDES,
  breathForBar,
} from '@domain/coach/callPlacement'

/**
 * How many reps before a section ends to start previewing the NEXT distinct
 * block's opening pills (Kyle, 2026-09-04: the preview should lead in with
 * the section's whisper, not flash in on the final rep). ~2 reps ≈ the
 * lead-in whisper + setup-pause window at typical strides.
 */
export const PREVIEW_LEAD_REPS = 2

/**
 * How far before a section's first node the audible-grid loop swap is
 * dispatched (W2, Kyle 2026-09-04 "roll into the grid"). The swap tears
 * down and rebuilds the native click playlist (~50-200ms), so it must
 * land inside the section's punch-free setup gap — never over a strike.
 * A 2-measure setup gap is ≥4000ms (@120) / ≥5600ms (@85), so 400ms of
 * lead sits comfortably inside it with the rebuild finishing before the
 * gap's downbeat.
 */
export const METRONOME_SWAP_LEAD_MS = 400

/**
 * The metronome subdivision whose audible click lands on a section's node
 * grid — WITHOUT moving the (locked) visual grid (W2, Kyle 2026-09-04).
 *
 * The visual grid is owned by `bpmForRecipe` and never touched here; this
 * only chooses which loop WAV plays so its clicks fall on the section's
 * inter-node interval (`slotMs`). A master beat is `60000/baseBpm` ms; a
 * loop at `division` clicks every `beatMs/division` ms. We pick the
 * COARSEST rendered division whose click interval divides `slotMs` a
 * whole number of times (≥1 click per node) — e.g. @100 base
 * (beatMs=600): rate-1 slot 600 → div 1 (click every node), rate-2 slot
 * 300 → div 2, rate-1.5 slot 400 → div 3 (two clicks per node, back on
 * grid). Returns undefined when no rendered division lands on grid (the
 * caller falls back to the recipe's own division).
 */
export function audibleDivisionForSlot(
  slotMs: number,
  baseBpm: number,
): 1 | 2 | 3 | 4 | undefined {
  if (!(slotMs > 0) || !(baseBpm > 0)) return undefined
  const beatMs = 60000 / baseBpm
  for (const d of [1, 2, 3, 4] as const) {
    const clickInterval = beatMs / d
    const perSlot = slotMs / clickInterval
    const nearest = Math.round(perSlot)
    // ≥1 click per node, and the slot is (near) a whole multiple of the
    // click interval — that is exactly "on the grid".
    if (nearest >= 1 && Math.abs(perSlot - nearest) < 0.06) return d
  }
  return undefined
}


/**
 * Dim-until-called mask (Kyle 2026-09-04: "lit = spoken"). Two rules, both
 * PRESENTATION-ONLY — the walk, matcher and scoring never read the result:
 *
 *  Rule 0 — ear-first window: the first ~2 measures of punching in every
 *  round stay dim EVEN though called (Variant B calls the opener now) —
 *  "establish a bit of a rhythm before seeing the light up node tokens."
 *  Bar granularity: a rate-1 opener (2 measures/bar) dims exactly rep 0;
 *  the bar that begins EXACTLY at the window's edge stays lit (−1 ms
 *  float guard).
 *
 *  Rule 1 — any bar with NO call scheduled for it stays dim, so lighting
 *  always means the coach is calling right now.
 *
 * Exempt entirely when the guided layer is off as a whole (`guided` false:
 * no voice port, or mode 'off' — visuals ARE the workout then) and when
 * the round scheduled no calls at all (unrendered bank).
 */
export function maskedBarIds(
  cues: readonly { id: string; scoring: string; scheduledStartMs: number }[],
  calledCueIds: ReadonlySet<string>,
  guided: boolean,
  bpm: number,
): Set<string> {
  const masked = new Set<string>()
  if (!guided || calledCueIds.size === 0) return masked
  const measureMs = 240000 / bpm
  let sectionOneStartMs: number | undefined
  for (const cue of cues) {
    if (cue.scoring !== 'sequence') continue
    sectionOneStartMs ??= cue.scheduledStartMs
    if (!calledCueIds.has(cue.id)) masked.add(cue.id)
    if (cue.scheduledStartMs < sectionOneStartMs + 2 * measureMs - 1) masked.add(cue.id)
  }
  return masked
}

/**
 * The avatar's lead over the nodes (Kyle, on-glass 2026-09-02): the whole
 * flip track plays this far AHEAD of the walk — "a trainer training,
 * between the voice and the avatar showing." A pure time-shift of the
 * full track each round, never an acceleration. The single tuning knob.
 * Tuned 750 -> 375 on-glass (Kyle, 2026-09-02): at 750 the figure struck
 * slightly before the calls on transitions; 375 lands him 125ms AFTER
 * each loop call ends and within a hair of the lead-ins — "sync up
 * amazingly and pretty consistently." Next stop on the dial if
 * transitions still read early: 250 (= LEAD_IN_PAD_MS, lead-in-end exact).
 */
export const AVATAR_LEAD_MS = 375
/**
 * Store write ceiling. Was 100ms (spec §15.3's 10Hz) — but bag testing
 * found Pressables dead DURING work while fine in idle: the 10Hz
 * full-screen re-render churn starved the JS responder system, so taps
 * were processed after the finger lifted (native surfaces like the dev
 * menu still worked). 4Hz halves-again the churn; punch-count changes
 * still flush immediately on the punch, so scoring feel is untouched.
 */
export const STORE_THROTTLE_MS = 250
/**
 * How many recent punch events stay resolvable when a cue settles. A cue's
 * window closes within a couple of seconds of its punches, so this is far
 * more than needed even at flurry cadence.
 */
export const RECENT_EVENT_WINDOW = 256

/**
 * Was a matched punch on the beat?
 *
 * Mirrors the matcher's own timing math — the punch's time against the token's
 * scheduled moment (`scheduledStartMs + tokenOffsetsMs[tokenIndex]`) — using
 * the same tight window the score uses (`TIMING_TIGHT_MS`, much tighter than
 * the acceptance window). Gates the "good hit" haptic so a right-hand punch
 * thrown late still counts for the combo but does not earn the reward buzz.
 */
function onTimeForMatch(
  cue: CueInstance | undefined,
  expected: ExpectedPunch,
  eventTimeMs: number,
): boolean {
  if (!cue) return false
  const dueMs = cue.scheduledStartMs + (cue.tokenOffsetsMs[expected.tokenIndex] ?? 0)
  return Math.abs(eventTimeMs - dueMs) <= TIMING_TIGHT_MS
}

/**
 * `SessionTransition` → `SessionPhaseEvent`.
 *
 * Two unions that overlap but do not match: the clock says `completed`, the
 * cue side calls it `finishing`, and `countdown-entered` has no audio meaning
 * at all. Written out so the mismatch is handled rather than cast away.
 */
function toSessionPhaseEvent(
  transition: SessionTransition,
  nowMs: number,
): SessionPhaseEvent | null {
  switch (transition.type) {
    case 'work-entered':
      return { type: 'work-entered', roundIndex: transition.roundIndex, nowMs }
    case 'rest-entered':
      return { type: 'rest-entered', nowMs }
    case 'paused':
      return { type: 'paused', nowMs }
    case 'resumed':
      return { type: 'resumed', nowMs }
    case 'completed':
      return { type: 'finishing', nowMs }
    case 'cancelled':
      return { type: 'cancelled', nowMs }
    case 'countdown-entered':
      // The lead-in is visual; there is nothing to say yet.
      return null
    default:
      return null
  }
}

export interface WorkoutRunner {
  start(): void
  pause(): void
  resume(): void
  emergencyStop(): void
  skipCue(): void
  repeatCue(): void
  /** End the rest interval — all three §23 rest views go with it (D6). */
  skipRest(): void
  /** End the lead-in now — the walkout finished ahead of its cap. */
  skipCountdown(): void
  /** Live vocabulary switch (numbers ⇄ techniques) — next call speaks it. */
  setVocabulary(vocabulary: 'numbers' | 'techniques'): void
  /** Cue views for the stage, kept out of the store (they hold token objects). */
  readCues(): { current?: CueView; next?: CueView; walkPlan?: RoundWalkPlan; freeWork?: boolean; avatar?: { cue: CueInstance; tokenIndex: number } }
  /** Settled matching so far. Read by M33-03 grading and M33-08 persistence. */
  readResults(): WorkoutRunnerResults
}

export interface UseWorkoutRunnerArgs {
  workout: GeneratedWorkout
  source: PunchEventSource
  stance: Stance
  /**
   * UI-thread work clock slot (MVP v2, GH #305). Plain `{value}` shape so
   * the runner stays Reanimated-free and node-testable; the live screen
   * passes a real `useSharedValue`. The runner publishes a NEW frozen
   * struct at every clock discontinuity (work-entered with its overflow,
   * paused, resumed, rest-entered, stop) and NEVER per tick — smoothness
   * between anchors is the UI thread's job (`useRingBeatClock`).
   */
  workClock?: { value: SharedWorkClock }
  clock?: MonotonicClock
  /**
   * Lead-in before round 1, overriding the session clock's default. The
   * live screen sets it to the walkout announcement's planned length
   * (`planIntro`) so the coach finishes before the first bell.
   */
  countdownMs?: number
  /**
   * Repositories to write the finished session into. Defaults to the shared
   * app database; pass `null` to run without persisting, which is what the
   * component tests do — they have no native SQLite binding.
   */
  persistence?: WorkoutPersistence | null
  /**
   * Called once when the workout ends, after the write attempt. It fires on
   * failure too: a lost write must not also leave the athlete with no ending.
   *
   * Must be stable across renders — the engine wiring depends on it, so a
   * fresh closure each render would tear down and rebuild the cue engine
   * mid-workout.
   */
  onSessionEnded?: (outcome: SessionEndOutcome) => void
  /**
   * The Voice Coach. Omit it and the workout runs silently — which is a
   * supported way to train, not a degraded one (doc §25).
   */
  voice?: {
    output: VoiceOutputPort
    policy: VoiceCoachPolicy
    detector: ThirdPartyPlaybackDetector
  }
  /**
   * Felt feedback. Omit it and the workout is silent to the touch, the same
   * way omitting `voice` makes it silent to the ear — a supported way to
   * train, not a degraded one.
   */
  haptics?: HapticOutputPort
  /**
   * The reactive backdrop. Omit it and the water simply never stirs.
   * Best-effort by contract (D17): the port may drop a splash, the
   * runner never waits on it, and nothing here can touch scoring.
   */
  backdrop?: BackdropImpulsePort
  /**
   * Whether the audible metronome "click" sounds (Kyle 2026-09-04 — the
   * click is removable development instrumentation). Gates ONLY the click's
   * loop volume: false plays the loop silently (mute-only) so the logical
   * transport keeps running and the visual grid / avatar flip / coach calls
   * stay byte-identical. Absent → true, so existing callers and tests keep
   * today's audible behaviour; the live screen passes the persisted
   * `clickEnabled` setting (off by default). Never gate via
   * `recipe.metronome.enabled`, which would move the visual grid.
   */
  clickAudible?: boolean
}

/** What the runner reports when a workout ends. */
export type SessionEndOutcome =
  | { status: 'persisted'; cancelled: boolean; session: PersistedWorkoutSession }
  /** Ended before any cue was presented — there is no session to record. */
  | { status: 'nothing-to-persist'; cancelled: boolean }
  /** Persistence was not configured for this run. */
  | { status: 'skipped'; cancelled: boolean }
  | { status: 'failed'; cancelled: boolean; error: unknown }

export interface WorkoutRunnerResults {
  /** Settled per-cue matches, in cue order — M33-08 persists these. */
  cueResults: CueMatchResult[]
  /** The most recent settled score, for the round readouts. */
  lastScore?: CueScore
}

interface CueRenderState {
  cue: CueInstance
  tokenStates: TokenVisualState[]
  repeatTotal: number
  affirmedTokenIndexes: number[]
  comboCompleteKey?: string
  /**
   * Dim-until-called (Kyle 2026-09-04): this bar renders every token in
   * its dim 'upcoming' look — no walk lighting, no ✓ marks, no flourish —
   * because no call covers it, or it sits in the round-start ear-first
   * window. Presentation-only.
   */
  masked?: boolean
  /**
   * A presentation identity stable across the reps of a block. Keyed on
   * `blockId` so the stage keeps the same nodes mounted while a repeated combo
   * runs — the combo is shown once and the counter advances, rather than the
   * whole row remounting and re-animating each rep (doc §14, §19.2).
   */
  presentationKey: string
}

export function useWorkoutRunner(args: UseWorkoutRunnerArgs): WorkoutRunner {
  const { workout, source, stance, persistence, onSessionEnded, voice, haptics, backdrop, countdownMs } =
    args
  // The click is dev instrumentation; absent means audible (today's
  // behaviour) so existing callers/tests are unchanged. The live screen
  // passes the persisted `clickEnabled` (off by default).
  const clickAudible = args.clickAudible ?? true
  // Read through a ref so the applyTransitions/tick closures see the latest
  // value without being rebuilt (mid-session toggles apply at the next
  // start/swap, and immediately via the setVolume effect below).
  // Read through a ref so startMetronome / the swap loop see the value the
  // setting held when the workout began, without rebuilding those closures.
  // The click state is FIXED for the duration of a run — there is deliberately
  // NO in-workout control to unmute (Kyle 2026-09-04); the only control is the
  // settings toggle, applied at the next work-entered.
  const clickAudibleRef = useRef(clickAudible)
  clickAudibleRef.current = clickAudible
  const clock = useMemo(() => args.clock ?? systemMonotonicClock(), [args.clock])

  // M39-V1b: engine tempo when the recipe opts in (`metronome.enabled`),
  // legacy `nominalBpm` otherwise — the bridge is `bpmForRecipe`. With
  // `enabled: false` this returns the same value as before, so all
  // pre-M39 samples produce a byte-identical timeline.
  const bpm = bpmForRecipe(workout.recipe)
  const timeline = useMemo(
    () => expandTimeline(workout, stance, bpm),
    [workout, stance, bpm],
  )

  /**
   * The compiled per-token spine, one per round (A2 / issue #257).
   * `pulses[cueId]` fills the count-scored windows the cue engine
   * deliberately leaves dark — the ring row walks the motif in real
   * time without the matcher scoring anything (D4 holds).
   */
  const spines = useMemo<SpineSchedule[]>(
    () => timeline.map((round) => compileRoundSpine(round)),
    [timeline],
  )
  const spinesRef = useRef(spines)
  spinesRef.current = spines
  /** Latest work-elapsed sample, mutated on every tick; read by the ring cursor. */
  const workElapsedMsRef = useRef(0)

  /**
   * The compiled rhythm maps, one per round (M2): every call, refire and
   * tone with its time, from the same timeline the engine runs. Phrase
   * lengths come from the manifest via the output port; recompiles when
   * the timeline or vocabulary changes.
   */
  const rhythmMaps = useMemo(() => {
    const vocabulary = voice?.policy.vocabulary === 'names' ? 'techniques' : 'numbers'
    return timeline.map((round) =>
      compileRoundRhythmMap(round, {
        cadence: workout.recipe.cadenceProfile,
        // Per-cue cadence (M4): a flurry block is CALLED in its own band's
        // rendering, so the length lookup follows the cue.
        durationFor: (combination, cadence) =>
          voice?.output.combinationDurationMs?.(combination, cadence, {
            vocabulary,
            performance: 'work',
          }),
        // Phase 5-iv retired the per-punch phrase corpus. The cadence-lab
        // per-clip shift and the scalable-rail wordMarks both lived on
        // that manifest; both now return undefined uniformly. RhythmMap's
        // rail-vs-beat-grid decision degrades to beat grid for every cue.
        phraseShiftFor: () => undefined,
        wordMarksFor: () => undefined,
        encouragement:
          workout.recipe.enabledCoachCalls.length > 0 && workout.recipe.voiceMode !== 'off',
        // Set Ceremonies: measured sentence lengths from the generated
        // manifest (not the output port — it only answers for resident
        // players). Absent clip = no ceremony, never a guessed duration.
        setupCalloutDurationFor: (asset) =>
          (CALLOUT_CLIPS as Record<string, { durationMs: number }>)[asset]?.durationMs,
        // Block-level cornerman instructions (WS4 / A23). Empty until
        // the render batch fills instructionManifest — then a match
        // returns the Metro `module` + measured duration and the compiler
        // emits an `instruction` event; the announcer's dispatch flows
        // it to `voice.output.playInstruction`.
        instructionClipFor: (text) => {
          const clip = instructionClipFor(text)
          return clip === undefined
            ? undefined
            : { module: clip.module, durationMs: clip.durationMs }
        },
      }),
    )
  }, [timeline, workout.recipe, voice])
  const timelineRef = useRef(timeline)
  timelineRef.current = timeline
  const rhythmMapsRef = useRef(rhythmMaps)
  rhythmMapsRef.current = rhythmMaps

  /** How many cues share each block, so the stage can render "×N". */
  const repeatTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const round of timeline) {
      for (const cue of round.cues) {
        totals.set(cue.blockId, (totals.get(cue.blockId) ?? 0) + 1)
      }
    }
    return totals
  }, [timeline])

  /**
   * Every cue by id. A cue settles after its window closes, by which time
   * the engine has usually moved on, so the settled result is looked up
   * here rather than read off whatever happens to be current.
   */
  const cuesById = useMemo(() => {
    const byId = new Map<string, CueInstance>()
    for (const round of timeline) for (const cue of round.cues) byId.set(cue.id, cue)
    return byId
  }, [timeline])

  const engineRef = useRef<CueEngine | null>(null)
  const sessionRef = useRef<WorkoutSessionClock | null>(null)
  const currentRef = useRef<CueRenderState | null>(null)
  const nextRef = useRef<CueRenderState | null>(null)
  /** The round ran out of scheduled cues — free work until the bell (M2). */
  const freeWorkRef = useRef(false)

  const countsRef = useRef({ total: 0, left: 0, right: 0, inCue: 0, inCueExpected: 0 })
  // NOTE: there is deliberately no `beatCursorRef` any more. How far the
  // beat has walked into the current combination is PROJECTED per render by
  // `beatOrdinalAt(cue, workElapsedMs)` (option C, GH #305) rather than
  // accumulated from `token-due` events. The lit cursor still follows
  // `max(credited, beatOrdinal)`, so it leads the athlete to the next hit
  // on the beat instead of stalling on a punch the tracker never reported —
  // but it can no longer be desynchronised by event delivery.
  /**
   * The id of the cue whose combination was just completed in sequence, so the
   * stage can play a one-shot whole-combo flourish. Keyed by cue id (which
   * changes per rep) so each completed rep re-fires the celebration; cleared
   * when the next cue starts.
   */
  const comboCompleteRef = useRef<string | null>(null)
  const velocitySumRef = useRef(0)
  const velocityCountRef = useRef(0)
  const velocityMaxRef = useRef(0)
  const lastVelocityRef = useRef<LiveVelocity | undefined>(undefined)
  const lastStoreWriteRef = useRef(0)
  /** Active work seconds banked from completed rounds. */
  const completedActiveSecondsRef = useRef(0)
  const activeElapsedSecondsRef = useRef(0)
  const matcherRef = useRef<LiveCueMatcher | null>(null)
  const hapticsRef = useRef<HapticOutputPort | undefined>(undefined)
  hapticsRef.current = haptics
  const backdropRef = useRef<BackdropImpulsePort | undefined>(undefined)
  backdropRef.current = backdrop
  const pacingRef = useRef<PacingEngine | null>(null)
  const pacingCueRef = useRef<PacingCueText | undefined>(undefined)
  /** Rows accumulated per settled cue, written in one transaction at the end. */
  const cueRowsRef = useRef<PendingCueResultRow[]>([])
  /**
   * A bounded window of recent events, so a settling cue can read the
   * velocity of the punch that answered it. Bounded because a full workout's
   * events would grow without limit in memory for no benefit — a cue settles
   * within a second or two of its punches.
   */
  const recentEventsRef = useRef(new Map<string, TrackerPunchEvent>())
  /**
   * Every punch a persisted cue result names, kept for the whole session.
   *
   * Separate from `recentEventsRef`, which is a small rolling window sized for
   * the live rail. These have to survive to the bell: `cue_results` carries a
   * foreign key into `punch_events`, so a row naming a punch that was never
   * written takes the entire session transaction down with it.
   */
  const matchedEventsRef = useRef(new Map<string, TrackerPunchEvent>())
  /** Adaptations the plan actually made, in the order it made them. */
  const adaptationsRef = useRef<Array<Omit<AdaptationRecord, 'generatedWorkoutId'>>>([])
  /**
   * Blocks the athlete was actually shown. This is the realized stream D8
   * requires — recalculation replays what ran, so a block the workout never
   * reached must not appear as though it did.
   */
  const realizedBlocksRef = useRef(new Set<string>())
  /**
   * Round-scoped walk plan for the UI-thread walk (GH #305 v3): every
   * sequence bar of the current round, in order. Built once per round —
   * the whole plan crosses to the worklet in one staging, so no per-rep
   * handoff exists to race the engine's early completions.
   */
  const walkPlanRef = useRef<{ roundIndex: number; bars: Array<{ epoch: string; scheduledStartMs: number; tokenOffsetsMs: readonly number[]; expectedTokenIndexes: number[] }> } | null>(null)
  const buildWalkPlan = useCallback((roundIndex: number): void => {
    const cues = timelineRef.current[roundIndex]?.cues ?? []
    walkPlanRef.current = {
      roundIndex,
      bars: cues
        .filter((c) => c.scoring === 'sequence')
        .map((c) => ({
          epoch: c.id,
          scheduledStartMs: c.scheduledStartMs,
          tokenOffsetsMs: c.tokenOffsetsMs,
          expectedTokenIndexes: c.expectedPunches.map((p) => p.tokenIndex),
        })),
    }
  }, [])
  /**
   * Round-scoped lead-in schedule (Script Bible v2, Kyle 2026-09-01):
   * one entry per SECTION (block) of the current round, computed from
   * the compiled timeline at work-entered so each authored lead-in clip
   * FINISHES as its section's first strike lands (call-then-shots — the
   * clip talks over the previous section's tail, announce-then-work
   * style). Data-driven gate: a workout with no rendered click-script
   * clips builds an empty schedule and nothing here runs.
   */
  const leadInScheduleRef = useRef<{
    roundIndex: number
    entries: Array<{
      kind: 'lead-in' | 'call'
      slot: string
      text: string
      module: number
      durationMs: number
      /** Fire when workElapsedMs reaches this. */
      dispatchAtMs: number
      /** Past this, the clip is no longer useful — skip. */
      giveUpAtMs: number
      /** Calls only: the bar's first punch, which the call must end a breath before. */
      firstNodeMs?: number
      /**
       * Calls only: the breath `breathForBar` INTENDED — logged so the
       * analyzer compares the delivered breath against the intent instead
       * of re-deriving it from the dispatch time (which now carries the
       * dispatch-lag compensation and would read 71 ms too generous).
       */
      breathMs?: number
      state: 'pending' | 'played' | 'skipped'
      /** The section's rep-0 call, sequenced right after its lead-in — exempt from the lead-in collision drop. */
      firstRep?: boolean
      /** The bar (cue) a CALL entry covers — feeds the dim-until-called mask. */
      cueId?: string
    }>
  } | null>(null)
  /**
   * Bars whose tokens render DIM for their whole rep (dim-until-called +
   * the round-start ear-first window). Rebuilt with each round's lead-in
   * schedule; presentation-only — the walk, matcher and scoring never
   * read it.
   */
  const maskedCueIdsRef = useRef<Set<string>>(new Set())
  /**
   * The avatar's lead track (2026-09-02): the round's punch schedule,
   * sampled at workElapsed + AVATAR_LEAD_MS so the figure demonstrates
   * each form before its node lights. Cursor is monotonic — O(1)/read,
   * can trail under load, can never run ahead of the authored lead.
   */
  const avatarTrackRef = useRef<{ roundIndex: number; entries: AvatarTrackEntry[]; cursor: number } | null>(null)
  const buildAvatarLeadTrack = useCallback((roundIndex: number): void => {
    avatarTrackRef.current = {
      roundIndex,
      entries: buildAvatarTrack(timelineRef.current[roundIndex]?.cues ?? []),
      cursor: -1,
    }
  }, [])
  /**
   * The click-script vocabulary, snapshotted per round: schedules compile
   * with the vocabulary current at round start, so a mid-round radio flip
   * applies from the following round — same precedent as the announcer's
   * placement margins. Numbers fallback lives in findClickScript itself.
   */
  const clickVocabularyRef = useRef<'numbers' | 'techniques'>(
    voice?.policy.vocabulary === 'names' ? 'techniques' : 'numbers',
  )
  const buildLeadInSchedule = useCallback((roundIndex: number): void => {
    const vocabulary = clickVocabularyRef.current
    // Lead-ins ride ahead of numbers by a fixed lead (Kyle, 2026-09-03);
    // per-bar calls use the set-aware breath (breathForBar) instead, folded
    // from the same tuned dense values via DENSE_BREATH_MS. Both leads now
    // live inside `callPlacement`, which the manifest generator shares.
    const cues = timelineRef.current[roundIndex]?.cues ?? []
    const seenBlocks = new Set<string>()
    type Entry = NonNullable<typeof leadInScheduleRef.current>['entries'][number]
    const leadIns: Entry[] = []
    const calls: Entry[] = []
    // Build the per-bar call entry for one cue (its motif named so it
    // FINISHES a set-aware breath before the bar's first shot). Anchored to
    // the first PUNCH (a bar may open on a rest). `firstRep` marks a
    // section's rep-0 call so the collision filter leaves it beside its
    // lead-in.
    const buildCall = (cue: CueInstance, firstRep: boolean): Entry | null => {
      const motif = cue.tokens
        .map((t) => (t.kind === 'punch' ? `${t.number}${t.body ? 'b' : ''}` : '.'))
        .join('-')
      const slot = `call/${motif}`
      const clip = findClickScript(slot, vocabulary)
      if (!clip) return null
      // The placement itself lives in the domain (`callPlacement`) so the
      // manifest generator computes the identical number instead of its own.
      const { dispatchAtMs, firstNodeMs, breathMs } = callDispatchAtMs({
        cue,
        scheduledStartMs: cue.scheduledStartMs,
        vocabulary,
        slot,
        clipDurationMs: clip.durationMs,
      })
      return {
        kind: 'call',
        slot,
        text: clip.text,
        module: clip.module,
        durationMs: clip.durationMs,
        breathMs,
        // Asks CALL_DISPATCH_LAG_MS early: the scheduler fires late and the
        // player takes time to sound, and the measured sum of the two was
        // eating ~71 ms out of every bar's breath.
        dispatchAtMs,
        // A call that could not start by the bar's first beats is noise —
        // the next bar's call is seconds away.
        giveUpAtMs: firstNodeMs + 500,
        firstNodeMs,
        state: 'pending',
        cueId: cue.id,
        ...(firstRep ? { firstRep: true } : {}),
      }
    }
    for (const cue of cues) {
      if (cue.scoring !== 'sequence') continue
      if (cue.repeatIndex === 0 && !seenBlocks.has(cue.blockId)) {
        seenBlocks.add(cue.blockId)
        // Kyle, 2026-09-04: the first set of every section was MUTED — the
        // whisper described it, rep 0 threw silent, the coach entered on
        // rep 1. Now EVERY section's rep 0 gets its call — including the
        // round opener (Variant B, "fit in the missing audio for the first
        // rep"): each round's first row now carries an authored
        // setupMeasures pad (fit-round-openers.mjs), so the bell releases
        // into a breath, the rep-0 call, then the first punches. The
        // opener is still NAMED pre-bell (round 1 in the intro sequence,
        // rounds 2+ in the warn playlist) — that ceremony is unchanged;
        // only the per-bar call was missing.
        const rep0Call = buildCall(cue, true)
        if (rep0Call) calls.push(rep0Call)
        // Section index is the block's ORDER in the round, not its id —
        // blockId prefixes ('jab1-b2') do not match workout ids. Section 1
        // has NO mid-round lead-in whisper (pre-bell ceremony owns that);
        // sections 2+ sequence whisper → rep-0 call inside their pads.
        if (seenBlocks.size > 1) {
          const slot = `lead-in/${workout.id}/r${roundIndex + 1}s${seenBlocks.size}`
          const clip = findClickScript(slot, vocabulary)
          if (clip) {
            // End before the rep-0 call starts (fallback: before the first
            // shot, the old target, if there is no rep-0 call). Shared with
            // the manifest generator, which used to anchor to the first shot
            // unconditionally and so expected every lead-in ~2 s late.
            const { dispatchAtMs, endByMs } = leadInDispatchAtMs({
              ...(rep0Call ? { rep0CallDispatchAtMs: rep0Call.dispatchAtMs } : {}),
              scheduledStartMs: cue.scheduledStartMs,
              clipDurationMs: clip.durationMs,
              vocabulary,
            })
            leadIns.push({
              kind: 'lead-in',
              slot,
              text: clip.text,
              module: clip.module,
              durationMs: clip.durationMs,
              dispatchAtMs,
              giveUpAtMs: endByMs,
              state: 'pending',
            })
          }
        }
        continue
      }
      const call = buildCall(cue, false)
      if (call) calls.push(call)
    }
    // Deterministic collision resolution: a call whose window overlaps a
    // lead-in's (padded) window is dropped at BUILD time, so the coach
    // lane is guaranteed free when the lead-in comes due — lead-ins must
    // never starve behind call-saturated busy checks.
    const survivors = calls.filter((call) => {
      // The rep-0 call is deliberately sequenced right after its section's
      // lead-in — never drop it as a "collision" with that lead-in.
      if (call.firstRep) return true
      const callEnd = call.dispatchAtMs + call.durationMs
      return !leadIns.some((li) => {
        const liStart = li.dispatchAtMs - 500
        const liEnd = li.dispatchAtMs + li.durationMs
        return call.dispatchAtMs < liEnd && callEnd > liStart
      })
    })
    const entries = [...leadIns, ...survivors].sort((a, b) => a.dispatchAtMs - b.dispatchAtMs)
    leadInScheduleRef.current = { roundIndex, entries }

    const calledIds = new Set(
      survivors.filter((e) => e.cueId !== undefined).map((e) => e.cueId as string),
    )
    maskedCueIdsRef.current = maskedBarIds(
      cues,
      calledIds,
      !!voice && voice.policy.mode !== 'off',
      bpm,
    )
  }, [workout.id, voice, bpm])
  /**
   * Round-scoped audible-metronome schedule (W2, Kyle 2026-09-04 "roll
   * into the grid"). One loop for the round opener plus a per-SECTION
   * loop swap wherever the section's subdivision changes — so a slow
   * workout's mixed rates each land an on-grid click without moving the
   * (locked) visual node grid. `firstLoop` is what `startMetronome`
   * plays; `swaps` fire from the tick loop during each section's
   * punch-free setup gap. A uniform-rate workout emits zero swaps and
   * plays one continuous loop (byte-identical to pre-W2 behaviour). Empty
   * when the recipe's metronome is disabled.
   */
  const metronomeScheduleRef = useRef<{
    roundIndex: number
    firstLoop: MetronomeLoop | undefined
    swaps: Array<{ dispatchAtMs: number; loop: MetronomeLoop; state: 'pending' | 'played' }>
  } | null>(null)
  const buildMetronomeSchedule = useCallback((roundIndex: number): void => {
    const recipe = workout.recipe
    if (!recipe.metronome.enabled) {
      metronomeScheduleRef.current = { roundIndex, firstLoop: undefined, swaps: [] }
      return
    }
    const baseBpm = recipe.coachTempo.baseBpm
    const swing = recipe.coachTempo.swing
    // The recipe's own division is the safety net for a section whose slot
    // finds no on-grid rendered loop — never worse than pre-W2.
    const fallback = metronomeLoopFor(recipe.coachTempo.division, swing, baseBpm)
    const cues = timelineRef.current[roundIndex]?.cues ?? []
    const seenBlocks = new Set<string>()
    const swaps: Array<{ dispatchAtMs: number; loop: MetronomeLoop; state: 'pending' | 'played' }> = []
    let firstLoop: MetronomeLoop | undefined
    let currentModule: number | undefined
    for (const cue of cues) {
      if (cue.scoring !== 'sequence') continue
      if (cue.repeatIndex !== 0 || seenBlocks.has(cue.blockId)) continue
      seenBlocks.add(cue.blockId)
      // slotMs = the inter-PUNCH interval on the (locked) visual grid — the
      // same measure `breathForBar` reads. A single-punch bar has no
      // interval → treat it as one master beat (division 1 / the base).
      const punchIdx: number[] = []
      cue.tokens.forEach((t, i) => {
        if (t.kind === 'punch') punchIdx.push(i)
      })
      const slotMs =
        punchIdx.length >= 2
          ? (cue.tokenOffsetsMs[punchIdx[1]!] ?? 0) - (cue.tokenOffsetsMs[punchIdx[0]!] ?? 0)
          : 60000 / baseBpm
      const division = audibleDivisionForSlot(slotMs, baseBpm)
      const loop = (division ? metronomeLoopFor(division, swing, baseBpm) : undefined) ?? fallback
      if (!loop) continue
      if (seenBlocks.size === 1) {
        firstLoop = loop
        currentModule = loop.module
        continue
      }
      // Sections 2+: only emit a swap when the loop actually changes — a
      // uniform-rate round plays one continuous loop, no rebuilds. Land it
      // in the punch-free setup gap ahead of the section's first node.
      if (loop.module === currentModule) continue
      currentModule = loop.module
      swaps.push({
        dispatchAtMs: Math.max(0, cue.scheduledStartMs - METRONOME_SWAP_LEAD_MS),
        loop,
        state: 'pending',
      })
    }
    metronomeScheduleRef.current = { roundIndex, firstLoop: firstLoop ?? fallback, swaps }
  }, [workout])
  const announcerRef = useRef<CueAnnouncer | null>(null)
  /**
   * D1 third-party-playback state, mirrored out of the detector so the
   * score-authoritative dispatcher can consult it. The announcer keeps its
   * own copy via `setThirdPartyPlayback`; this exists because the
   * dispatcher plays without going through the announcer.
   */
  const playbackActiveRef = useRef(false)
  // Token-order forensics recorder (2026-08-31). Null unless a forensic
  // drive armed it; see `vizForensics.ts` for why this is a buffer rather
  // than per-transition logging.
  const vizRef = useRef<VizForensics | null>(null)
  // M39-V2 W1 Epic Slice 3-a-ii — score-authoritative combo-announce
  // dispatcher. Owned by the runner because it is instantiated at arm
  // time with the compiled score's coachSlots pre-enqueued and advanced
  // on every runtime tick.
  const slotDispatcherRef = useRef<SlotDispatcher | null>(null)
  const startedAtRef = useRef(0)
  /** The end is written once; a cancel after a completion must not double it. */
  const persistedRef = useRef(false)
  /** Token indexes affirmed in the cue currently on the stage. */
  const affirmedRef = useRef<number[]>([])
  const extrasRef = useRef(0)
  const lastScoreRef = useRef<CueScore | undefined>(undefined)
  /**
   * Per-round tallies that stop at the bell (M33-04). Separate from
   * `countsRef`, which is cumulative for the whole session and therefore
   * cannot answer "what did this round do".
   */
  const freezeRef = useRef<RoundResultFreeze>(new RoundResultFreeze())

  const capability = useMemo(
    () => resolveCapabilityTier({ capability: source.capability }),
    [source],
  )

  // -------------------------------------------------------------------------

  const renderStateFor = useCallback(
    (cue: CueInstance | undefined, states?: TokenVisualState[]): CueRenderState | null => {
      if (!cue) return null
      return {
        cue,
        tokenStates: states ?? cue.tokens.map(() => 'upcoming' as const),
        repeatTotal: repeatTotals.get(cue.blockId) ?? 1,
        affirmedTokenIndexes: [...affirmedRef.current],
        presentationKey: cue.blockId,
        ...(maskedCueIdsRef.current.has(cue.id) ? { masked: true } : {}),
        // Present (and equal to the cue id) exactly when this cue was just
        // completed in sequence, so the stage fires a one-shot flourish and
        // re-fires it for each completed rep.
        ...(comboCompleteRef.current === cue.id ? { comboCompleteKey: cue.id } : {}),
      }
    },
    [repeatTotals],
  )

  const pushStore = useCallback(
    (immediate: boolean): void => {
      const now = clock.now()
      if (!immediate && now - lastStoreWriteRef.current < STORE_THROTTLE_MS) return
      lastStoreWriteRef.current = now

      const session = sessionRef.current?.snapshot()
      if (session?.phase === 'work') {
        activeElapsedSecondsRef.current =
          completedActiveSecondsRef.current + session.workElapsedMs / 1000
      }
      const pacing = pacingRef.current?.snapshot(activeElapsedSecondsRef.current)
      const avg =
        velocityCountRef.current > 0
          ? ({
              value: velocitySumRef.current / velocityCountRef.current,
              unit: 'tracker-unit',
              label: 'tracker-reported velocity',
            } as LiveVelocity)
          : undefined

      // Punches inside the last 15 s, from the bounded recent-event window.
      const cutoff = clock.now() - 15_000
      let last15s = 0
      for (const e of recentEventsRef.current.values()) {
        if (e.receivedMonotonicTimeMs >= cutoff) last15s += 1
      }
      setLive({
        phase: session?.phase ?? 'idle',
        roundIndex: session?.roundIndex ?? -1,
        roundCount: session?.roundCount ?? 0,
        roundRemainingMs: session?.phaseRemainingMs ?? 0,
        stance,
        currentCueId: currentRef.current?.cue.id,
        nextCueId: nextRef.current?.cue.id,
        counts: { ...countsRef.current },
        extraCount: extrasRef.current,
        ...(pacing
          ? {
              requiredPace: pacing.requiredPace,
              actualPace: pacing.achievedPace,
              projectedTotal: pacing.projectedTotal,
            }
          : {}),
        punchesLast15s: last15s,
        pacingCue: pacingCueRef.current,
        sequenceScoreLabel: sequenceScoreLabel(capability.tier),
        velocityAvailable: capability.velocityAvailable,
        capabilityTier: capability.tier,
        sourceKind: source.id === 'sim' ? 'simulated' : 'tracker',
        ...(capability.velocityAvailable
          ? {
              lastVelocity: lastVelocityRef.current,
              avgVelocity: avg,
              ...(velocityMaxRef.current > 0
                ? {
                    peakVelocity: {
                      value: velocityMaxRef.current,
                      unit: 'tracker-unit',
                      label: 'tracker-reported velocity',
                    } as LiveVelocity,
                  }
                : {}),
            }
          : { lastVelocity: undefined, avgVelocity: undefined, peakVelocity: undefined }),
      })
    },
    [capability, clock, source.id, stance],
  )

  const syncFromEngine = useCallback((): void => {
    const engine = engineRef.current
    if (!engine) return
    const snap = engine.snapshot()

    // Completed marks come from what landed; the lit cursor comes from the
    // later of what landed and where the beat has reached, so it anticipates
    // the next hit instead of waiting on a punch the tracker may have dropped.
    const states = (cue: CueInstance | undefined, active: boolean): TokenVisualState[] => {
      if (!cue) return []
      // A2 (#257): count-scored windows (volume-burst, open-pressure,
      // coast) have `expectedPunches: []` and no per-token engine
      // events — the ring row was dark for 20-30s per burst. Walk the
      // spine's pulses instead so the motif's active token lights on
      // the beat; scoring stays untouched (D4).
      if (cue.scoring === 'count') {
        const round = sessionRef.current?.snapshot()?.roundIndex ?? -1
        const spine = round >= 0 ? spinesRef.current[round] : undefined
        const lit = spine ? pulseCursorAt(spine, cue, workElapsedMsRef.current) : -1
        return cue.tokens.map((token, index) => {
          // A rest holds the bar's width and is never thrown. Without this
          // it would fall into the non-punch branch below and sit LIT for
          // the whole cue (GH #305).
          if (token.kind === 'rest') return 'empty'
          if (token.kind !== 'punch') return active ? 'active' : 'upcoming'
          return index === lit && active ? 'active' : 'upcoming'
        })
      }
      const credited = countsRef.current.inCue
      // Option C (GH #305): the beat position is PROJECTED from the clock,
      // not accumulated from `token-due` events.
      //
      // The old cursor was a ref advanced by each event and reset on
      // `cue-active`, which made the displayed position a function of
      // event HISTORY. With the runner ticking at ~341 ms against a 50 ms
      // interval, backlogs are routine, so history was routinely replayed.
      // A projection cannot have that class of bug: it answers "where is
      // the beat now" from the authored offsets alone (principle #0 —
      // runtime projects the score, never accumulates; principle #3 — a
      // stall may skip an event already over, never replay it).
      //
      // Count-scored cues have always projected this way via
      // `pulseCursorAt` above; this puts sequence cues on the same footing.
      const beatOrdinal = beatOrdinalAt(cue, workElapsedMsRef.current)
      const cursor = Math.max(credited, beatOrdinal)
      return cue.tokens.map((token, index) => {
        // See the count-scored branch above — a rest must never read as
        // active, or every padded bar shows a permanently lit slot.
        if (token.kind === 'rest') return 'empty'
        if (token.kind !== 'punch') return active ? 'active' : 'upcoming'
        const punchOrdinal = cue.expectedPunches.findIndex((p) => p.tokenIndex === index)
        if (punchOrdinal < 0) return 'upcoming'
        // Landed, in order: the greedy matcher fills expectations front to back.
        if (punchOrdinal < credited) return 'completed'
        // The one to throw now — led by the beat, so it moves on even when a
        // punch was missed rather than freezing on it.
        if (punchOrdinal === cursor && active) return 'active'
        return 'upcoming'
      })
    }

    const isActive = snap.status === 'active' || snap.status === 'accepting'
    freeWorkRef.current = snap.freeWork === true
    currentRef.current = renderStateFor(snap.current, states(snap.current, isActive))
    // "Next" preview. While a repeated combo runs, the engine's next is just
    // the next rep of the SAME block — hidden, or it duplicates the screen.
    // Revealing the upcoming DISTINCT block only near the end proved too
    // late twice (2026-09-04: the lead-in whisper played over hidden pills;
    // 2026-09-05, Kyle: "should persist the entire time it's up next") — so
    // the next block's opener previews for the WHOLE current block: look
    // ahead in the round timeline and hold it from the block's first rep
    // through the setup pause. PREVIEW_LEAD_REPS survives as the historical
    // constant; nothing gates on it any more.
    const cur = snap.current
    let leadInPreview: CueInstance | undefined
    if (cur) {
      const total = repeatTotals.get(cur.blockId) ?? 1
      const roundIdx = sessionRef.current?.snapshot()?.roundIndex ?? -1
      const roundCues = roundIdx >= 0 ? (timelineRef.current[roundIdx]?.cues ?? []) : []
      const firstIdx = roundCues.findIndex((c) => c.blockId === cur.blockId)
      // Block cues are contiguous (repeatIndex 0..total-1), so the cue right
      // after the block's last rep is the next distinct block's opener.
      if (firstIdx >= 0) leadInPreview = roundCues[firstIdx + total]
    }
    const nextIsSameBlock = snap.next !== undefined && snap.next.blockId === cur?.blockId
    nextRef.current = leadInPreview
      ? renderStateFor(leadInPreview)
      : nextIsSameBlock
        ? null
        : renderStateFor(snap.next)
    // GH #305 v3: the walk plan is round-scoped and consumed whole by
    // the UI thread (see useRingBeatClock). Nothing per-rep remains here.
  }, [renderStateFor, repeatTotals])

  // -------------------------------------------------------------------------

  const onCueEvent = useCallback(
    (event: CueEvent): void => {
      if (event.type === 'token-due') {
        // The beat reached a token. If it is a punch, walk the lit cursor to
        // it so the next hit lights up on time — the anticipatory guide the
        // whole responsiveness fix rests on. Movement tokens are shown active
        // by the cue status, so they need no cursor.
        const ordinal = event.cue.expectedPunches.findIndex(
          (p) => p.tokenIndex === event.tokenIndex,
        )
        // Cadence lab (2026-08-28): the ring-highlight moment. Externalising
        // it lets the mic-anchored analyzer compute per-token drift between
        // when the coach's voice said the token and when its ring lit. Kyle's
        // ear read the library at ~75 % clean, drift set-dependent — no way
        // to find which combos drift without this signal.
        logger.info('puncheokie.cue.tokenDue', 'ring token fired', {
          roundIndex: safe(sessionRef.current?.snapshot()?.roundIndex ?? -1),
          cueId: safe(event.cue.id),
          // `formatCombo`, NOT `tokens.join('-')`: tokens are objects, so
          // join stringified them to '[object Object]-[object Object]' in
          // every record ever captured. This is the ring-side signal any
          // audio/visual correlation joins on, so it was unusable (GH #305).
          combination: safe(formatCombo(event.cue.tokens)),
          tokenIndex: safe(event.tokenIndex),
          ordinal: safe(ordinal),
          workElapsedMs: safe(event.workElapsedMs),
          monotonicTimeMs: safe(event.nowMs),
          // Where the beat grid put this ring, on the work axis — so ring
          // lateness (`workElapsedMs − scheduledMs`) needs no manifest.
          scheduledMs: safe(
            event.cue.scheduledStartMs + (event.cue.tokenOffsetsMs[event.tokenIndex] ?? 0),
          ),
        })
        // No cursor to advance: option C made the ring position a
        // PROJECTION of the clock (`beatOrdinalAt` in `syncFromEngine`),
        // so `token-due` no longer feeds the visuals at all. It survives
        // here purely as the cadence-lab timing signal and the forensics
        // record below — which is the point: a stalled tick can deliver a
        // backlog of these and the row is unaffected, because nothing
        // downstream accumulates them.
        //
        // Record EVERY token-due; a burst is exactly the case under
        // investigation, and the skipped ones are what make it visible.
        vizRef.current?.token({
          cueId: event.cue.id,
          repeatIndex: event.cue.repeatIndex,
          tokenIndex: event.tokenIndex,
          ordinal,
          prev: 'upcoming',
          next: 'active',
          source: 'token-due',
          workElapsedMs: event.workElapsedMs,
        })
        return
      }
      // The matcher needs the window lifecycle to know which cue is open.
      matcherRef.current?.onCueEvent(event)
      // The announcer gates itself; the runner never decides what is spoken.
      announcerRef.current?.onCueEvent(event)
      if (event.type === 'cue-active') {
        // Shown, therefore realized — regardless of what the athlete threw.
        realizedBlocksRef.current.add(event.cue.blockId)
        // A new combination: the per-cue credit and any combo celebration
        // reset. A burst's target is its punch count; a sequence cue's is
        // its expectation count. (No beat cursor to reset since option C —
        // the beat position is projected from the clock per render, so it
        // is already correct for whichever cue is on stage.)
        countsRef.current.inCue = 0
        comboCompleteRef.current = null
        affirmedRef.current = []
        countsRef.current.inCueExpected =
          event.cue.scoring === 'count'
            ? (event.cue.countScored?.targetPunches ?? 0)
            : event.cue.expectedPunches.length
      } else if (event.type === 'cue-completed') {
        // The engine only completes a cue when every expectation was answered
        // with the correct hand, in sequence — so this is exactly the "landed
        // the whole combo" moment. `cue-expired` (partial) never reaches here.
        comboCompleteRef.current = event.cue.id
        hapticsRef.current?.strike('combo')
      }
      syncFromEngine()
      pushStore(true)
    },
    [pushStore, syncFromEngine],
  )

  const onPunch = useCallback(
    (event: TrackerPunchEvent): void => {
      const counts = countsRef.current
      counts.total += 1
      if (event.hand === 'left') counts.left += 1
      else if (event.hand === 'right') counts.right += 1

      // Frozen rounds count from the same punch stream — and ignore it once
      // the bell has rung (M33-04).
      freezeRef.current.observePunch({
        hand: event.hand,
        ...(capability.velocityAvailable && typeof event.velocityRaw === 'number'
          ? { velocityRaw: event.velocityRaw }
          : {}),
      })

      if (capability.velocityAvailable && typeof event.velocityRaw === 'number') {
        velocitySumRef.current += event.velocityRaw
        velocityCountRef.current += 1
        velocityMaxRef.current = Math.max(velocityMaxRef.current, event.velocityRaw)
        lastVelocityRef.current = {
          value: event.velocityRaw,
          unit: 'tracker-unit',
          label: 'tracker-reported velocity',
        }
      }

      // Pacing counts every accepted punch, matched or not: doc §22's
      // required pace is about volume, not sequence accuracy.
      pacingRef.current?.recordAccepted(1)
      recentEventsRef.current.set(event.id, event)
      if (recentEventsRef.current.size > RECENT_EVENT_WINDOW) {
        // Map iterates in insertion order, so the first key is the oldest.
        const oldest = recentEventsRef.current.keys().next()
        if (!oldest.done) recentEventsRef.current.delete(oldest.value)
      }

      // The backdrop's splash rides the same tick as the token flash.
      // Same posture as haptics: optional, best-effort, fire-and-forget.
      backdropRef.current?.impulse({
        hand: event.hand,
        ...(typeof event.velocityRaw === 'number' ? { velocityRaw: event.velocityRaw } : {}),
      })
      // Touch rides the same tick as the glass: every tracker punch
      // buzzes, and the buzz tier tracks the reading — so the causal
      // chain punch → feel → pane is airtight even when the eyes are on
      // the bag, not the screen.
      hapticsRef.current?.punch(
        event.hand,
        typeof event.velocityRaw === 'number' ? event.velocityRaw : undefined,
      )

      // The matcher decides what this punch answered; the runner only
      // counts. Its callback drives notifyMatch and the in-cue tally.
      matcherRef.current?.onPunchEvent(event)

      syncFromEngine()
      // Bypasses the throttle: a punch landing has to feel instant.
      pushStore(true)
    },
    [capability.velocityAvailable, pushStore, syncFromEngine],
  )

  const onMatcherEvent = useCallback(
    (event: LiveMatcherEvent): void => {
      switch (event.type) {
        case 'match': {
          // A hand mismatch still consumed the slot, so the combination
          // advances either way — but only a real match is credited to the
          // engine, which is what decides completed vs expired.
          const matched = event.match.outcome === 'matched'
          if (matched) {
            engineRef.current?.notifyMatch(
              event.match.cueId,
              event.match.expectedIndex,
              event.match.eventTimeMs,
            )
          }
          // 2026-08-31 forensics fix — cue identity + monotonicity.
          //
          // `inCue` feeds `syncFromEngine`'s lit-token cursor as
          // `Math.max(credited, beatCursorRef.current)`. Two bugs lived on
          // the old unguarded assignment:
          //
          //   1. NO CUE CHECK. Acceptance windows overlap by 200 ms
          //      (`DEFAULT_GRACE_BEFORE_MS`), so while the stage still shows
          //      cue P the matcher's open cue is already N. A punch in that
          //      window matched N's expectedIndex 0 and wrote `inCue = 1`,
          //      which flipped P's completed tokens back to `upcoming` and
          //      re-lit a token in the MIDDLE of the combo. This is the
          //      "repeating nodes mid-combo" Kyle saw on-glass.
          //   2. ASSIGNMENT, NOT MAX. Even within one cue, an out-of-order
          //      or lower-index match rewound the cursor, backtracking the
          //      row right-to-left.
          //
          // Credit only matches belonging to the cue currently on stage, and
          // never let the credited count move backwards.
          if (event.match.cueId === currentRef.current?.cue.id) {
            countsRef.current.inCue = Math.max(
              countsRef.current.inCue,
              event.match.expectedIndex + 1,
            )
          }
          const expected = currentRef.current?.cue.expectedPunches[event.match.expectedIndex]
          // Reward only: nothing is recorded when the byte disagrees.
          if (event.match.affirmed && expected) {
            affirmedRef.current = [...affirmedRef.current, expected.tokenIndex]
            // Roll the affirmed match into the round tally too, so the grade
            // card at the bell can name "precision punches" — the count of
            // hits where the tracker actually confirmed the prescribed
            // technique (D25). Kept alongside `affirmedRef` rather than
            // derived from it because `affirmedRef` is cleared on every new
            // cue, while the round's precision must accumulate across all of
            // them.
            freezeRef.current.notePrecisionHit()
          }
          // Tiered per-hit haptic: a solid buzz for a right-hand hit on the
          // beat, a stronger one when the strike type also agrees (rare on v1).
          if (matched && expected) {
            const onBeat = onTimeForMatch(currentRef.current?.cue, expected, event.match.eventTimeMs)
            if (onBeat) hapticsRef.current?.strike(event.match.affirmed ? 'perfect' : 'good')
          }
          break
        }

        case 'count':
          // Output during a burst: credited to the cue, not counted as an
          // extra (doc §14).
          engineRef.current?.notifyCount(event.count.cueId, event.count.eventTimeMs)
          countsRef.current.inCue += 1
          break

        case 'extra':
          // Counted and surfaced, never discarded (spec §13.6).
          extrasRef.current += 1
          break

        case 'cue-settled': {
          lastScoreRef.current = event.score
          // One row per expectation, including the unanswered ones — a
          // missing row could not be told from a cue never reached.
          const settled = cuesById.get(event.result.cueId)
          if (settled) {
            const rows = toCueResultRows({
              cue: settled,
              result: event.result,
              events: recentEventsRef.current.values(),
            })
            cueRowsRef.current.push(...rows)
            // `cue_results.observed_event_id` is a real foreign key into
            // `punch_events`, so every event a row names has to be written
            // too or the whole session rolls back. Captured here, where the
            // event is still in the recent window — by the bell it is long
            // gone, and the row would name a punch nothing can resolve.
            for (const row of rows) {
              if (!row.observedEventId) continue
              const observed = recentEventsRef.current.get(row.observedEventId)
              if (observed) matchedEventsRef.current.set(observed.id, observed)
            }
          }
          if (event.corrections.length > 0) {
            // A late or recovered event reordered a cue the athlete already
            // saw feedback for. Worth a log: it is rare and it means the
            // tokens they watched did not match the recorded result.
            logger.info('puncheokie.match.corrected', 'settled match differed from live feedback', {
              cue: safe(event.result.cueId),
              corrections: safe(event.corrections.length),
            })
          }
          break
        }
      }
      syncFromEngine()
      pushStore(true)
    },
    [cuesById, pushStore, syncFromEngine],
  )

  /**
   * Write the finished session, once.
   *
   * Everything here is best-effort from the athlete's point of view: the
   * workout is over either way, so a failed write is logged and reported
   * rather than thrown. `persistWorkoutSession` guarantees a failure leaves
   * the database untouched, so there is nothing half-written to repair.
   */
  const endSession = useCallback(
    (cancelled: boolean): void => {
      if (persistedRef.current) return
      persistedRef.current = true

      const realized: RealizedTokenStream = []
      for (const round of workout.schedule) {
        for (const block of round.blocks) {
          if (realizedBlocksRef.current.has(block.id)) {
            realized.push({ blockId: block.id, tokens: block.tokens })
          }
        }
      }

      const report = (outcome: SessionEndOutcome): void => {
        onSessionEnded?.(outcome)
      }

      if (realized.length === 0) {
        // Stopped before a single cue reached the stage. There is no
        // realized stream, and D8 makes one mandatory — a session that could
        // never be recalculated must not be stored as if it could.
        report({ status: 'nothing-to-persist', cancelled })
        return
      }
      if (persistence === null) {
        report({ status: 'skipped', cancelled })
        return
      }

      try {
        const repos = persistence ?? getWorkoutPersistence()
        const session = persistWorkoutSession({
          db: repos.db,
          sessions: repos.sessions,
          workouts: repos.workouts,
          workout,
          realized,
          cueResults: cueRowsRef.current,
          // Written before the cue results that name them — see the ref.
          punchEvents: [...matchedEventsRef.current.values()],
          // Written before the cue results that name them — see the ref.
          adaptations: adaptationsRef.current,
          startedMonotonicMs: startedAtRef.current,
          endedMonotonicMs: clock.now(),
          // Work time only — rests and pauses are not the workout.
          activeDurationMs: Math.round(activeElapsedSecondsRef.current * 1000),
          cancelled,
        })
        report({ status: 'persisted', cancelled, session })
      } catch (error) {
        logger.error('puncheokie.session.endWriteFailed', 'finished workout was not written', {
          error: safe(String(error)),
          cueResults: safe(cueRowsRef.current.length),
        })
        report({ status: 'failed', cancelled, error })
      }
    },
    [clock, onSessionEnded, persistence, workout],
  )

  const applyTransitions = useCallback((transitions: SessionTransition[]): void => {
    const engine = engineRef.current
    if (!engine) return
    // M39-V1b: the metronome click is the master pulse. It plays only
    // during WORK — every rest, pause, and terminal phase tears it down
    // so the next work-entered restarts on the downbeat and drift can't
    // accumulate across a boundary. `metronome` is optional on the port
    // (unavailable in headless tests / older `VoiceOutputExpo` builds).
    // The audible loop in force at `workElapsedMs` — the round opener
    // (firstLoop) until a section swap's dispatch time has passed, then
    // that swap's loop. Used so a resume mid-round re-anchors on the
    // CURRENT section's subdivision, not the round opener's.
    const metronomeLoopAt = (workElapsedMs: number): MetronomeLoop | undefined => {
      const sched = metronomeScheduleRef.current
      if (!sched) return undefined
      let loop = sched.firstLoop
      for (const s of sched.swaps) {
        if (s.dispatchAtMs <= workElapsedMs) loop = s.loop
        else break
      }
      return loop
    }
    const startMetronome = (): void => {
      if (!workout.recipe.metronome.enabled) return
      const port = voice?.output.metronome
      if (!port) return
      const atMs = sessionRef.current?.snapshot()?.workElapsedMs ?? 0
      const loop =
        metronomeLoopAt(atMs) ??
        metronomeLoopFor(
          workout.recipe.coachTempo.division,
          workout.recipe.coachTempo.swing,
          workout.recipe.coachTempo.baseBpm,
        )
      if (!loop) {
        logger.warn('puncheokie.metronome', 'no loop for tempo', {
          division: safe(workout.recipe.coachTempo.division),
          swing: safe(workout.recipe.coachTempo.swing),
          baseBpm: safe(workout.recipe.coachTempo.baseBpm),
        })
        return
      }
      // A resume past one or more section swaps must not let those swaps
      // re-fire from the tick loop — starting here already puts us on the
      // right loop.
      const sched = metronomeScheduleRef.current
      if (sched) for (const s of sched.swaps) if (s.dispatchAtMs <= atMs) s.state = 'played'
      // baseBpm from the recipe drives the shared logical transport
      // (M39-V2 Phase W0-a) alongside the audible loop — one call,
      // both lifecycles synced. Consumers reading
      // `port.transport.snapshot()` see the fresh generation on
      // this start. The transport rate is bpmForRecipe (the locked
      // visual clock), independent of which subdivision WAV plays.
      // clickAudible gates ONLY the loop volume (mute-only): the transport
      // still starts, so the avatar flip and everything else are unchanged
      // whether the click sounds or not.
      const clickVolume = clickAudibleRef.current ? workout.recipe.metronome.volume : 0
      port.start(loop, clickVolume, bpmForRecipe(workout.recipe))
    }
    const stopMetronome = (): void => {
      // Gate stop on the same flag as start — a legacy recipe never
      // touched the port, so the tear-down side shouldn't either.
      if (!workout.recipe.metronome.enabled) return
      voice?.output.metronome?.stop()
    }
    for (const transition of transitions) {
      // Mapped rather than cast: `SessionTransition` and `SessionPhaseEvent`
      // are different shapes, and `completed` is `finishing` on the other
      // side. A cast here would compile and then silently deliver a phase the
      // announcer does not recognise.
      const phase = toSessionPhaseEvent(transition, clock.now())
      if (phase) announcerRef.current?.onSessionPhase(phase)
      // Round boundaries are the inspection harness's only way to know which
      // round a captured event belongs to, and until now NOTHING marked them
      // in logcat — the drive harness waited on the literal string
      // 'rest-entered', which is a domain event TYPE that was never logged, so
      // every capture burned its full timeout and ran past the round it meant
      // to record (GH #305). Cheap: two lines per round, not per tick.
      // MVP v2 (GH #305): re-anchor the UI-thread work clock at every
      // discontinuity. Running only while an unpaused WORK phase is on —
      // projecting through rest/pause would advance a clock the session
      // itself holds still.
      if (args.workClock) {
        const s = sessionRef.current?.snapshot()
        args.workClock.value = Object.freeze({
          roundIndex: s?.roundIndex ?? -1,
          workElapsedAtPublishMs: s?.workElapsedMs ?? 0,
          publishFrameTimestampMs:
            typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now(),
          running: s?.phase === 'work',
        })
      }
      logger.info('puncheokie.round.boundary', 'session phase boundary', {
        transition: safe(transition.type),
        roundIndex: safe(
          transition.type === 'work-entered'
            ? transition.roundIndex
            : (sessionRef.current?.snapshot()?.roundIndex ?? -1),
        ),
        workElapsedMs: safe(sessionRef.current?.snapshot()?.workElapsedMs ?? -1),
        // Same clock as cue.tokenDue and every voice.play dispatchMs, so a
        // bell's onset can be measured from the boundary it answers. The log
        // sink prints fields only — a record's own timestamp never reaches
        // logcat.
        monotonicTimeMs: safe(clock.now()),
      })
      switch (transition.type) {
        case 'work-entered': {
          // A new round opens fresh tallies, and the previous round's frozen
          // result leaves the store rather than lingering behind the cues.
          freezeRef.current.beginRound(transition.roundIndex)
          buildWalkPlan(transition.roundIndex)
          buildLeadInSchedule(transition.roundIndex)
          buildAvatarLeadTrack(transition.roundIndex)
          buildMetronomeSchedule(transition.roundIndex)
          setLive({ frozenRoundResult: undefined })

          // Install the round's compiled rhythm map (M2): from here the map
          // owns every call time and the conductor tick dispatches them.
          const round = timelineRef.current[transition.roundIndex]
          const map = rhythmMapsRef.current[transition.roundIndex]
          announcerRef.current?.setRound(round ?? null, map ?? null)

          // Bank the previous round's active time so the pacing clock spans
          // the whole workout rather than restarting each round.
          const previous = workout.schedule[transition.roundIndex - 1]
          if (previous?.countsTowardGoal) {
            completedActiveSecondsRef.current += previous.workDurationMs / 1000
          }
          engine.onSessionPhase({
            type: 'work-entered',
            roundIndex: transition.roundIndex,
            nowMs: clock.now(),
          })
          startMetronome()
          break
        }
        case 'rest-entered': {
          // The bell. Everything the rest screen shows is fixed here; later
          // punches reach a closed accumulator and change nothing (doc §23).
          const target = workout.schedule[transition.roundIndex]?.targetPunches ?? 0
          const frozen = freezeRef.current.freeze(target)
          if (frozen) setLive({ frozenRoundResult: frozen })

          engine.onSessionPhase({ type: 'rest-entered', nowMs: clock.now() })
          stopMetronome()
          // 2026-08-31 audio-append fix side-effect drain:
          // playSequence's new append-not-clear semantic keeps clips
          // from the ending round queued if they hadn't fired yet.
          // Without a drain those pending clips continue playing
          // through rest and into round 2, so round 2 rings light
          // on time but audio is behind by round 1's tail. Cancel
          // everything below bell priority (keeps the round-end bell
          // itself intact but drops pending punch commands / coach
          // reminders).
          voice?.output.cancel(AUDIO_PRIORITY.bell)
          // A rest is a safe boundary (doc §22) — the only place pacing may
          // propose anything.
          const restSnapshot = sessionRef.current?.snapshot()
          const decision = pacingRef.current?.onBoundary('rest', {
            roundIndex: restSnapshot?.roundIndex ?? 0,
            atWorkElapsedMs: restSnapshot?.workElapsedMs ?? 0,
            activeElapsedSeconds: activeElapsedSecondsRef.current,
          })
          pacingCueRef.current = decision?.cueText
          if (decision && decision.action.kind !== 'none') {
            // Only real changes are recorded. A decision to leave the plan
            // alone is not an adaptation, and counting it would tell the
            // athlete the workout adapted when it did not.
            adaptationsRef.current.push({
              decidedAtMonotonicMs: clock.now(),
              boundary: 'rest',
              inputs: decision.inputs,
              decision: decision.action,
            })
          }
          break
        }
        case 'paused':
          engine.onSessionPhase({ type: 'paused', nowMs: clock.now() })
          stopMetronome()
          break
        case 'resumed':
          engine.onSessionPhase({ type: 'resumed', nowMs: clock.now() })
          // Re-anchor: a paused loop that resumes from its previous
          // position would land off the downbeat by the pause duration.
          // Starting fresh keeps the click on the grid.
          startMetronome()
          break
        case 'completed':
          engine.onSessionPhase({ type: 'finishing', nowMs: clock.now() })
          stopMetronome()
          // After the engine, so the last cue has settled and its rows are
          // in hand before the transaction opens.
          endSession(false)
          break
        case 'cancelled':
          engine.onSessionPhase({ type: 'cancelled', nowMs: clock.now() })
          stopMetronome()
          // A cancelled workout is still a workout that happened; it is
          // written with status 'cancelled' rather than discarded.
          endSession(true)
          break
        default:
          break
      }
    }
    // args.workClock is a stable SharedValue slot (or a stable plain
    // object in tests); its .value writes are imperative and identity
    // never changes across renders, so it is deliberately not a dep —
    // the same treatment the transport anchor slot gets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, endSession, voice, workout])

  // -------------------------------------------------------------------------
  // Wiring. Keyed on the timeline + source so a recipe change rebuilds
  // cleanly rather than leaving a stale engine subscribed.
  // -------------------------------------------------------------------------

  useEffect(() => {
    const engine = new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock })
    const matcher = new LiveCueMatcher({
      tier: capability.tier,
      extraPunchPolicy: workout.recipe.extraPunchPolicy,
    })
    matcherRef.current = matcher

    // Per-cue round context for the performance-state selector. Built here,
    // where the whole timeline is in hand — `scheduledStartMs` is
    // round-relative, so "how far into the round" is direct, and cues are
    // sorted, so the first is the opening.
    const performanceMeta = new Map<
      string,
      { startMsIntoRound: number; workDurationMs: number; isRoundOpening: boolean }
    >()
    for (const round of timeline) {
      round.cues.forEach((c, index) => {
        performanceMeta.set(c.id, {
          startMsIntoRound: c.scheduledStartMs,
          workDurationMs: round.workDurationMs,
          isRoundOpening: index === 0,
        })
      })
    }

    // The announcer holds the policy and the gate; the runner only feeds it
    // events. Absent `voice`, nothing is constructed and the workout is
    // silent by construction rather than by a flag (doc §25).
    // MVP v2 (GH #305): a recipe may cap the coach at 'minimal' — the
    // click-track sets keep bells + stance + countdown and hand every
    // punch call to the visuals. The more-restrictive-wins rule inside
    // shouldSpeak makes this a pure ceiling over the athlete's policy.
    const effectivePolicy =
      voice && workout.recipe.voiceMode === 'minimal'
        ? { ...voice.policy, mode: 'minimal' as const }
        : voice?.policy
    const announcer = voice
      ? new CueAnnouncer({
          policy: effectivePolicy ?? voice.policy,
          output: voice.output,
          // The recipe's cadence chooses which rendering of a combination is
          // called — a phrase is a performance, so a faster round means a
          // different recording rather than the same one played faster.
          cadence: workout.recipe.cadenceProfile,
          // Coach Callouts (D15). The policy names it `names`; the rendered
          // library names the same vocabulary `techniques` — one canonical
          // sequence, two spoken forms.
          vocabulary: voice.policy.vocabulary === 'names' ? 'techniques' : 'numbers',
          // teach the opening, push the close (or a pressure block), work the
          // body — chosen from the round context the timeline carries.
          performanceFor: (cue) => {
            const meta = performanceMeta.get(cue.id)
            return meta
              ? selectPerformanceState({ ...meta, cadenceProfile: workout.recipe.cadenceProfile })
              : 'work'
          },
          // Call the combo ahead of the throw at speed; call each punch in time
          // at a slow technical cadence (doc §18.1).
          delivery: deliveryForCadence(workout.recipe.cadenceProfile),
          // Phase 5-iv: the per-punch phrase manifest retired; the
          // cadence-lab shift lookup goes with it. Live-executor + compiled
          // map both return undefined uniformly here (see phraseShiftFor
          // on the compiled-map wiring above).
          phraseShiftFor: () => undefined,
          // M39-V1c Phase B2: resolve the combo-announce clip for rep 0
          // of a block whose voicePolicy is announce-then-work. Undefined
          // returned when the announce library has no rendering for this
          // (combination, vocabulary) pair — the announcer falls back to
          // the interim per-punch phrase clip in that case.
          comboAnnounceFor: (combination, vocabulary) => {
            const clip = findComboAnnounce(combination, vocabulary)
            return clip
              ? { text: clip.text, module: clip.module, durationMs: clip.durationMs }
              : undefined
          },
        })
      : null
    announcerRef.current = announcer

    // M39-V2 W1 Epic Slice 3-a-ii — score-authoritative combo-announce
    // dispatch. Compile the full workout score once at arm time; hand its
    // coach slots to a SlotDispatcher; tell the announcer to skip its
    // map-driven combo-announce branch so nothing double-fires.
    //
    // The dispatcher owns ONE append-only queue for the whole workout
    // — no per-cue clearSequence, no truncation on cue boundaries. When
    // a new cue arms, its slots have already been enqueued at compile
    // time; the queue just plays them in order as each dispatchAtTick
    // arrives. This is the shape that fixes the 2026-08-30 regression
    // ("`1-2b-3` heard as `one one two one one one`" — old code's
    // clearSequence cut the previous cue's `body` clip mid-flight).
    //
    // Score tick space = 60 BPM × 960 PPQN = 16 ticks/ms. Runner's tick
    // sample is `snapshot.workElapsedMs`; advance() reads that in the
    // same tick unit the compiler used to author reservation windows.
    //
    // Vocab picking: the announcer holds the current callout vocab; the
    // dispatcher asks fresh on every slot dispatch so a mid-workout
    // toggle takes effect on the next unarmed slot (principle #8's
    // "vocab locks at earliest dispatch deadline" lands in a later slice;
    // for 3-a-ii the dispatcher checks at fire time — good enough while
    // slots are only combo-announces).
    let slotDispatcher: SlotDispatcher | null = null
    const scoreDispatchEnabled = workout.recipe.voiceMode !== 'minimal'
    /**
     * Score tick each round's work phase begins at, indexed by round.
     *
     * The score's tick space is CUMULATIVE across the whole workout
     * (round 0 at 0, round 1 at 230400, …) while `WorkoutSessionClock`
     * resets `workElapsedMs` to ~0 on every `work-entered`. Feeding the
     * round-relative millisecond straight to `advance()` therefore only
     * ever addressed round 0's band: at the end of round 0 the cursor
     * crossed 230400 and dumped EVERY round-1 slot in a single tick,
     * then the reset dropped it back to 0 and rounds 2+ never came due
     * at all (GH #305 blocker 2). This lets the runner lift the
     * round-relative clock back into the score's axis.
     */
    let roundStartTicks: number[] = []
    if (announcer && voice && scoreDispatchEnabled) {
      const compiledScore = compileWorkoutScore(workout, {
        stance,
        bpm: bpmForRecipe(workout.recipe),
        revision: 1,
        compiledAtEpochMs: Date.now(),
        coachAssets: runtimeCoachAssetResolver,
      })
      slotDispatcher = new SlotDispatcher({
        getCurrentVocabulary: () =>
          voice.policy.vocabulary === 'names' ? 'technique' : 'numeric',
        onSkipped: (slot, reason) => {
          logger.warn(
            'puncheokie.slotDispatcher.skipped',
            'coach slot dropped without playing',
            { slotId: safe(slot.slotId), roundIndex: safe(slot.roundIndex), reason: safe(reason) },
          )
        },
        play: (assetId, atTick, slotId) => {
          // The gates the announcer applies before ANY combo-announce.
          // The score path bypasses the announcer entirely, so without
          // these the coach talks when the athlete has asked it not to
          // (adversarial review, 2026-08-31).
          //
          // D1 (spec §13.5, §14.6): silent when the coach is off, and
          // never over someone else's music unless they opted in.
          if (!voiceAllowed(voice.policy, playbackActiveRef.current)) return
          // Category gate: a combo-announce is a punch command, which
          // `minimal` mode leaves to the visuals. `inCombo: false` — the
          // announce lands at block start, before the work.
          if (!shouldSpeak(voice.policy, 'punch-command', false)) return

          const clip = findComboAnnounceById(assetId)
          if (!clip) {
            logger.warn(
              'puncheokie.slotDispatcher.assetMissing',
              'compiled coach slot references an unknown combo-announce id',
              { assetId: safe(assetId), slotId: safe(slotId) },
            )
            return
          }
          // Coach-lane collision: the announcer defers a clip when the
          // lane is still sounding (instruction, encouragement, ceremony)
          // rather than stacking a second voice on it. `playComboAnnounce`
          // creates a fresh player and starts it immediately, so nothing
          // downstream would prevent the overlap.
          const audibleUntilMs = voice.output.audibleUntilMs?.() ?? 0
          if (audibleUntilMs > 0) {
            // DECLINE, don't discard. Returning `false` re-queues the slot so
            // the dispatcher re-offers it on later ticks until the strike it
            // names arrives.
            //
            // Dropping here cost the athlete the opening call of a block. Every
            // round's first combo-announce is a `precall` authored ~2355ms
            // BEFORE the bell, but the runner only advances during `work`, so
            // it first becomes due a few hundred ms INTO the round — while the
            // round-start bell is still sounding. Measured on-glass: both
            // heavy-hands and pace-pusher lost expectation #1 exactly this way,
            // and Kyle heard the block open in silence (GH #305).
            logger.info(
              'puncheokie.slotDispatcher.deferred',
              'coach lane busy — combo-announce re-queued for a later tick',
              { slotId: safe(slotId), audibleUntilMs: safe(audibleUntilMs) },
            )
            return false
          }
          // The score's own dispatch moment, joined to the audio record by
          // slotId. `atTick` was discarded here before, which left the
          // announce path with no scheduled time to measure lateness against.
          logger.info('puncheokie.comboAnnounce.dispatch', 'combo-announce dispatched', {
            slotId: safe(slotId),
            assetId: safe(assetId),
            atTick: safe(atTick),
            monotonicTimeMs: safe(clock.now()),
          })
          voice.output.playComboAnnounce?.({
            text: clip.text,
            module: clip.module,
            durationMs: clip.durationMs,
            traceId: slotId,
          })
        },
      })
      // Hotfix (2026-08-31): the compiler unconditionally uses
      // DEFAULT_COMBO_POLICY (combo-announce) via programCueBridge,
      // so every cue produces a coach slot regardless of its
      // authored V1c `voicePolicy`. Meanwhile the announcer only
      // skips its own combo-announce dispatch for cues whose
      // voicePolicy === 'announce-then-work' — for `per-punch` cues
      // the announcer plays per-word. Enqueuing every score slot
      // stacks a combo-announce on top of the per-word train (heard
      // as echo / "1-2-3 as 1-2-1" on-glass, 2026-08-31 QA). Until
      // slice 6 threads voicePolicy through the compiler, filter
      // slots to the cues actually authored as announce-then-work.
      // `announce-then-work` means speak the combination ONCE at the start
      // of a BLOCK, then stay silent while the athlete works to the rings.
      // `expandBlock` mints one CueInstance PER REPETITION (`sp1-b4#0` …
      // `#9`), and every rep carries the block's policy — so matching on
      // the policy alone admitted a slot per REP.
      //
      // Measured on-glass (speed-combos, 2026-08-31): 98 slots enqueued
      // for 117 ATW cues where the design calls for ~7 per round. At a
      // 525 ms rep stride against 1000-1400 ms clips, the dispatcher fired
      // a fresh combo-announce every rep and they piled on top of each
      // other — Kyle: "big delay then overlapping hard".
      //
      // `repeatIndex === 0` is the same gate `CueAnnouncer` has always
      // applied to its own ATW dispatch, so the score-authoritative path
      // now reproduces the announcer's semantic rather than contradicting
      // it. (The score compiler emits a slot per cue because
      // `programCueBridge` hands it `repetition: { count: 1 }` — each
      // CueInstance is already one rep — so the block-level collapse has
      // to happen here until Slice 6 threads the V1c policy into the
      // compiler.)
      const atwCueIds = new Set<string>()
      for (const round of timeline) {
        for (const cue of round.cues) {
          if (cue.voicePolicy === 'announce-then-work' && cue.repeatIndex === 0) {
            atwCueIds.add(cue.id)
          }
        }
      }
      const enqueuableSlots = compiledScore.coachSlots.filter((slot) =>
        atwCueIds.has(slot.cueId),
      )
      roundStartTicks = roundStartTicksFrom(compiledScore)
      slotDispatcher.enqueueAll(enqueuableSlots)
      announcer.setScoreOwnsCombos(true)
      logger.info(
        'puncheokie.slotDispatcher.armed',
        'score-authoritative combo-announce dispatcher armed',
        {
          workout: safe(workout.id),
          totalCompiledSlots: safe(compiledScore.coachSlots.length),
          enqueuedSlots: safe(enqueuableSlots.length),
          announceThenWorkCues: safe(atwCueIds.size),
          timelineHash: safe(compiledScore.identity.timelineHash),
        },
      )
    }
    slotDispatcherRef.current = slotDispatcher

    const pacing = new PacingEngine({
      totalGoal: workout.recipe.totalPunchGoal,
      schedule: workout.schedule,
      mode: workout.recipe.adaptationMode,
      profile: CADENCE[workout.recipe.cadenceProfile],
    })
    pacingRef.current = pacing
    const session = new WorkoutSessionClock(
      workout.schedule.map((r) => ({
        workDurationMs: r.workDurationMs,
        restAfterMs: r.restAfterMs,
      })),
      // The walkout announcement (intro) extends the lead-in: the screen
      // passes the planned intro length so the first bell waits for the
      // coach. The work clock — and the rhythm map with it — still starts
      // at the bell; the intro only ever moves the countdown.
      countdownMs === undefined ? { clock } : { clock, countdownMs },
    )
    engineRef.current = engine
    sessionRef.current = session

    // The D1 input. `available === false` means this build cannot tell, and
    // the surfaces say so rather than the gate silently assuming silence.
    //
    // The state is mirrored into `playbackActiveRef` as well as the
    // announcer, because the score-authoritative SlotDispatcher (Slice
    // 3-a-ii) plays combo-announces WITHOUT going through the announcer —
    // so the announcer's copy of this flag no longer gates everything the
    // coach says. Adversarial review 2026-08-31 found the dispatcher
    // consulted no policy at all: with third-party music playing, or
    // `mode: 'off'`, or `style: 'minimal'`, the announcer fell silent and
    // the score kept talking. `CueAnnouncer` calls that "the one thing the
    // design says must never happen."
    let offDetector = (): void => {}
    if (voice && announcer && voice.detector.available) {
      // Assume playback until the first answer arrives. `isActive` is async,
      // so a gate that started open would speak over the athlete's music for
      // however long the first read took — and that window covers the
      // countdown and the opening bell. Silence is recoverable; talking over
      // someone's music is the failure D1 exists to prevent.
      playbackActiveRef.current = true
      announcer.setThirdPartyPlayback(true)
      void voice.detector.isActive().then((active) => {
        playbackActiveRef.current = active
        announcer.setThirdPartyPlayback(active)
      })
      offDetector = voice.detector.subscribe((active) => {
        playbackActiveRef.current = active
        announcer.setThirdPartyPlayback(active)
      })
    } else {
      // No detector: nothing is known to be playing, and the announcer's
      // own default is likewise open. Matching it keeps the two paths
      // consistent rather than silently stricter on one.
      playbackActiveRef.current = false
    }

    // Token-order forensics (2026-08-31). On by default in dev; a
    // production bundle can opt IN via `EXPO_PUBLIC_VIZ_FORENSICS=1`,
    // which is what makes the release-like timing gate measurable at all
    // (M39-V2 principle #18 — the final timing gate must not run only
    // under Metro debug). Cost is near zero when nothing is anomalous:
    // clock records are written only past the stall threshold.
    // The recorder is per-arm, so a new workout starts with a clean buffer.
    // The persisted QA flag (GH #291/#292) arms it too, so the unattended
    // suite's token-forensics survive a release build without a rebuild.
    vizRef.current = new VizForensics({
      enabled: __DEV__ || process.env.EXPO_PUBLIC_VIZ_FORENSICS === '1' || isQaEnabled(),
      now: () => clock.now(),
      emit: (batch: readonly VizRecord[]) => {
        logger.info('puncheokie.viz.batch', 'visual transition batch', {
          count: safe(batch.length),
          records: safe(JSON.stringify(batch)),
        })
      },
    })

    const offEngine = engine.subscribe(onCueEvent)
    const offMatcher = matcher.subscribe(onMatcherEvent)
    const offSource = source.subscribe(onPunch)
    source.start()

    const timer = setInterval(() => {
      // Sampled rather than subscribed: `useLivePunchSource` owns the
      // degraded string, and a round only needs to know that a glove was
      // down at some point in it (doc §23).
      if (getLive().degraded) freezeRef.current.noteTrackerDropped()
      const transitions = session.advance()
      if (transitions.length > 0) {
        applyTransitions(transitions)
        // A phase boundary must reach the UI NOW — the throttle exists to
        // calm mid-phase churn, never to let the screen show "work" after
        // the bell.
        pushStore(true)
      }
      const snapshot = session.snapshot()
      // Doc §25's final warning fires off the round clock, so the announcer
      // needs the same sample the store gets.
      if (snapshot.phase === 'work') announcer?.onRoundClock(snapshot.phaseRemainingMs)
      // Latest work-elapsed sample for the pulse cursor to read from
      // syncFromEngine — same clock every other consumer reads.
      workElapsedMsRef.current = snapshot.workElapsedMs
      // Sample the tick cadence BEFORE the engine advances, so a stall is
      // attributed to the gap that preceded the burst rather than to the
      // burst itself (token-order forensics, 2026-08-31).
      vizRef.current?.tick(snapshot.workElapsedMs)
      engine.tick(snapshot.workElapsedMs)
      // The conductor's beat (M2): dispatch due rhythm-map events, then
      // fire any due scheduled audio — presentation and audio read one
      // clock sample, so they cannot drift apart (wall timers do, measured
      // ~2.3x slow under workout load). Engine first, so a cue that ended
      // this tick cancels its remaining events before they dispatch.
      if (snapshot.phase === 'work') {
        announcer?.onTick(snapshot.workElapsedMs, clock.now())
        // M39-V2 W1 Epic Slice 3-a-ii — advance the score-authoritative
        // combo-announce dispatcher against the same clock sample. The
        // announcer's map path skips combo-announces (setScoreOwnsCombos
        // above); the dispatcher fires them from the compiled score.
        slotDispatcher?.advance(
          scoreTickAt(roundStartTicks, snapshot.workElapsedMs, snapshot.roundIndex),
          // Clamp dispatch to the round the athlete is actually in — see
          // SlotDispatcher.advance. Without it the next round's opening
          // announce (authored to lead its bell) fires during THIS round's
          // final seconds, because the score's tick axis has no rest gap
          // for the lead-in to occupy.
          snapshot.roundIndex,
        )
        // Script Bible v2 lead-ins: dispatch any due section lead-in
        // against the same clock sample. Retry-on-busy (never overlap a
        // sounding coach clip — Pillar 2), give up loudly once the clip
        // could no longer set up its section.
        const schedule = leadInScheduleRef.current
        if (schedule && schedule.roundIndex === snapshot.roundIndex && voice) {
          for (const entry of schedule.entries) {
            if (entry.state !== 'pending' || snapshot.workElapsedMs < entry.dispatchAtMs) continue
            if (snapshot.workElapsedMs > entry.giveUpAtMs) {
              entry.state = 'skipped'
              // A skipped CALL is routine (busy lane, next call seconds
              // away); a skipped LEAD-IN lost real coaching — warn.
              if (entry.kind === 'lead-in') {
                logger.warn('puncheokie.clickScript.skipped', 'lead-in window expired before the lane freed', {
                  slot: safe(entry.slot),
                  workElapsedMs: safe(snapshot.workElapsedMs),
                })
              }
              continue
            }
            // D1 (coach off / third-party music without opt-in): the whole
            // guided layer stays silent. Checked at dispatch, not at build,
            // so a mid-round playback change is honoured.
            if (!voiceAllowed(voice.policy, playbackActiveRef.current)) continue
            const audibleUntilMs = voice.output.audibleUntilMs?.() ?? 0
            // A section's rep-0 call OWNS its pad by construction (Variant
            // B: the opener pad fits bell-clear + call + breath; mid-round
            // pads sequence whisper → rep-0 call). The only audio it can
            // overlap is the round bell's ring-out (section 1) or the last
            // syllable of a whisper that ran a hair long — both intended
            // gym texture. Waiting behind them is what made long opener
            // calls land LATE past the first node, so firstRep dispatches
            // on schedule instead of retrying.
            if (audibleUntilMs > 0 && !entry.firstRep) {
              // Busy lane: EVERYTHING else retries until its giveUp. Calls
              // originally yielded on first contact, but at 2s strides a
              // single tick-late call left the lane busy at the next
              // call's dispatch instant and the skips CASCADED — measured
              // 21/90 bars lost on-glass (2026-09-01). The giveUp bound
              // (bar start + 500ms) is what prevents deferred calls from
              // piling; the busy check itself prevents overlap.
              continue
            }
            entry.state = 'played'
            // Joins this dispatch record to its `voice.play` / observed
            // records: a slot can be dispatched more than once in a round
            // (busy-lane retries), so the authored dispatch time is part of
            // the id.
            const traceId = `${entry.slot}#${entry.dispatchAtMs}`
            voice.output.playClickScript?.(
              {
                text: entry.text,
                module: entry.module,
                durationMs: entry.durationMs,
                traceId,
              },
              // A lead-in whisper plays once a workout; its native player
              // releases after the clip instead of parking in the cache
              // (leak hunt 2026-09-05). Calls repeat per bar and stay
              // cached.
              { oneShot: entry.kind !== 'call' },
            )
            logger.info('puncheokie.clickScript.dispatch', 'click script dispatched', {
              kind: safe(entry.kind),
              slot: safe(entry.slot),
              traceId: safe(traceId),
              dispatchAtMs: safe(entry.dispatchAtMs),
              lateMs: safe(Math.round(snapshot.workElapsedMs - entry.dispatchAtMs)),
              durationMs: safe(entry.durationMs),
              // The work-axis deadline this clip is placed against: a lead-in
              // must END before it, a call must end a breath before its bar's
              // first node — both measurable once the observer reports ends.
              endByMs: safe(entry.giveUpAtMs),
              firstNodeMs: safe(entry.firstNodeMs ?? null),
              // Calls only: the INTENDED breath and the lag compensation
              // applied to reach it. The analyzer scores the delivered
              // breath against `breathMs`, never against the dispatch time.
              breathMs: safe(entry.breathMs ?? null),
              lagMs: safe(entry.kind === 'call' ? CALL_DISPATCH_LAG_MS : null),
              monotonicTimeMs: safe(clock.now()),
            })
          }
        }
        // W2 audible grid: swap the click WAV to the next section's
        // subdivision during its punch-free setup gap. `start` WITHOUT a
        // baseBpm reloads only the loop — the logical transport (avatar
        // flip clock) keeps running uninterrupted, so no generation bump
        // and no visual hitch. Its own lane, independent of the coach
        // busy-check above (the click floor never ducks under speech).
        const metroSchedule = metronomeScheduleRef.current
        const metroPort = voice?.output.metronome
        if (metroSchedule && metroSchedule.roundIndex === snapshot.roundIndex && metroPort) {
          for (const swap of metroSchedule.swaps) {
            if (swap.state !== 'pending' || snapshot.workElapsedMs < swap.dispatchAtMs) continue
            swap.state = 'played'
            // Mute-only when the dev click is off: swap the loop silently so
            // the grid machinery stays consistent but nothing is heard.
            metroPort.start(
              swap.loop,
              clickAudibleRef.current ? workout.recipe.metronome.volume : 0,
            )
            logger.info('puncheokie.metronome.swap', 'section subdivision swap', {
              dispatchAtMs: safe(swap.dispatchAtMs),
              division: safe(swap.loop.division),
              baseBpm: safe(swap.loop.baseBpm),
              lateMs: safe(Math.round(snapshot.workElapsedMs - swap.dispatchAtMs)),
            })
          }
        }
      }
      voice?.output.advance?.()
      syncFromEngine()
      pushStore(false)
      // Flush last: everything this tick recorded goes out in one batched
      // log line, after the work is done, so the instrumentation can never
      // sit inside the window it is measuring.
      vizRef.current?.flush()
    }, TICK_INTERVAL_MS)

    logger.info('puncheokie.runner.start', 'workout runner armed', {
      workout: safe(workout.id),
      rounds: safe(workout.schedule.length),
      source: safe(source.id),
    })

    return () => {
      clearInterval(timer)
      offDetector()
      offEngine()
      offMatcher()
      offSource()
      source.stop()
      // Slot dispatcher's per-workout queue is per-arm — dropped
      // here so a subsequent arm starts with an empty queue instead
      // of inheriting the prior workout's dispatched-set.
      slotDispatcher?.clear()
      announcer?.setScoreOwnsCombos(false)
      slotDispatcherRef.current = null
      // Force-flush whatever the last tick recorded before dropping the
      // buffer, so a stall at the very end of a round is not lost to the
      // rate limit.
      vizRef.current?.flush(true)
      vizRef.current = null
      engineRef.current = null
      sessionRef.current = null
      matcherRef.current = null
      pacingRef.current = null
      announcerRef.current = null
      resetLive()
    }
  }, [
    applyTransitions,
    capability.tier,
    clock,
    countdownMs,
    onCueEvent,
    onMatcherEvent,
    onPunch,
    pushStore,
    source,
    stance,
    syncFromEngine,
    timeline,
    voice,
    workout,
  ])

  // -------------------------------------------------------------------------

  return useMemo<WorkoutRunner>(
    () => ({
      start: () => {
        startedAtRef.current = clock.now()
        applyTransitions(sessionRef.current?.start() ?? [])
        pushStore(true)
      },
      pause: () => {
        applyTransitions(sessionRef.current?.pause() ?? [])
        pushStore(true)
      },
      resume: () => {
        applyTransitions(sessionRef.current?.resume() ?? [])
        pushStore(true)
      },
      emergencyStop: () => {
        applyTransitions(sessionRef.current?.cancel() ?? [])
        // Stop the source too: nothing should keep arriving after a stop.
        source.stop()
        pushStore(true)
      },
      skipCue: () => {
        engineRef.current?.skipCue()
        syncFromEngine()
        pushStore(true)
      },
      repeatCue: () => {
        engineRef.current?.repeatCue()
        syncFromEngine()
        pushStore(true)
      },
      skipRest: () => {
        // One call, one state left behind. The three §23 rest views have no
        // representation in the session machine, so there is nothing finer
        // to skip (D6).
        applyTransitions(sessionRef.current?.skipRest() ?? [])
        syncFromEngine()
        pushStore(true)
      },
      setVocabulary: (vocabulary: 'numbers' | 'techniques') => {
        if (clickVocabularyRef.current === vocabulary) return
        announcerRef.current?.setVocabulary(vocabulary)
        clickVocabularyRef.current = vocabulary
        // MID-SET flip (Kyle 2026-09-04: "switched it to technique and it's
        // still running on numeric a whole minute later"): rebuild the
        // CURRENT round's schedule in the new vocabulary, then retire
        // everything already in the past so nothing back-fires — the next
        // due call speaks the new set. Both banks fit every stride
        // (clickCallFit) and preload keeps both warm, so the swap is safe
        // mid-round.
        const snapshot = sessionRef.current?.snapshot()
        if (!snapshot || snapshot.phase !== 'work') return
        buildLeadInSchedule(snapshot.roundIndex)
        const schedule = leadInScheduleRef.current
        if (schedule) {
          for (const entry of schedule.entries) {
            if (entry.dispatchAtMs <= snapshot.workElapsedMs) entry.state = 'skipped'
          }
        }
      },
      skipCountdown: () => {
        // The intro finished ahead of its padded cap; ring the bell now
        // rather than serving the athlete the leftover slack in silence.
        applyTransitions(sessionRef.current?.skipCountdown() ?? [])
        syncFromEngine()
        pushStore(true)
      },
      readCues: () => {
        // Avatar lead target: the punch the figure demonstrates at
        // now + AVATAR_LEAD_MS. Feeding a long-stale entry is harmless —
        // the card's cycle has parked on guard by then.
        let avatar: { cue: CueInstance; tokenIndex: number } | undefined
        const track = avatarTrackRef.current
        if (track && track.roundIndex === (sessionRef.current?.snapshot()?.roundIndex ?? -1)) {
          track.cursor = avatarTargetIndex(
            track.entries,
            workElapsedMsRef.current,
            AVATAR_LEAD_MS,
            track.cursor,
          )
          const entry = track.entries[track.cursor]
          const cue = entry ? cuesById.get(entry.cueId) : undefined
          if (entry && cue) avatar = { cue, tokenIndex: entry.tokenIndex }
        }
        return {
        ...(currentRef.current ? { current: currentRef.current } : {}),
        ...(nextRef.current ? { next: nextRef.current } : {}),
        ...(walkPlanRef.current ? { walkPlan: walkPlanRef.current } : {}),
        ...(freeWorkRef.current ? { freeWork: true } : {}),
        ...(avatar ? { avatar } : {}),
        }
      },
      readResults: () => ({
        cueResults: matcherRef.current?.results() ?? [],
        ...(lastScoreRef.current ? { lastScore: lastScoreRef.current } : {}),
      }),
    }),
    [applyTransitions, buildLeadInSchedule, clock, pushStore, source, syncFromEngine, cuesById],
  )
}
