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
import { metronomeLoopFor } from '@audio/voiceAssets/metronomeAssets'
import type { CueMatchResult } from '@domain/programs/CueMatcher'
import type { CueScore } from '@domain/programs/cueScoring'
import { expandTimeline, type CueInstance, type ExpectedPunch } from '@domain/programs/CueTimeline'
import { CALLOUT_CLIPS } from '@audio/voiceAssets/calloutManifest'
import {
  findComboAnnounce,
  findComboAnnounceById,
} from '@audio/voiceAssets/comboAnnounceManifest'
import { runtimeCoachAssetResolver } from '@audio/coachAssetResolvers'
import { SlotDispatcher } from '@audio/SlotDispatcher'
import { compileWorkoutScore } from '@domain/programs/workoutScore'
import { TRANSPORT_TICKS_PER_PULSE } from '@domain/timing/TimingEngine'
import { instructionClipFor } from '@audio/voiceAssets/instructionManifest'
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
import type { Stance } from '@domain/workout/WorkoutTokens'
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
import type { VoiceCoachPolicy } from '@domain/coach/VoiceCoachPolicy'
import type { ThirdPartyPlaybackDetector } from '@audio/ThirdPartyPlaybackDetector'
import { getWorkoutPersistence, type WorkoutPersistence } from '@storage/getWorkoutPersistence'
import { persistWorkoutSession, type PersistedWorkoutSession } from '@storage/persistWorkoutSession'
import { toCueResultRows, type PendingCueResultRow } from '@storage/cueResultRows'
import type {
  AdaptationRecord,
  RealizedTokenStream,
} from '@storage/repositories/WorkoutRepository'
import { getLive, resetLive, setLive, type LiveVelocity } from '@state/useWorkoutStore'

/** Loop cadence — fine enough that a cue fires within a frame of its time. */
export const TICK_INTERVAL_MS = 50
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
  readCues(): { current?: CueView; next?: CueView; freeWork?: boolean }
  /** Settled matching so far. Read by M33-03 grading and M33-08 persistence. */
  readResults(): WorkoutRunnerResults
}

export interface UseWorkoutRunnerArgs {
  workout: GeneratedWorkout
  source: PunchEventSource
  stance: Stance
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
  /**
   * How far the beat has walked into the current combination — the ordinal of
   * the punch expected *now*, advanced by `token-due` on the cue clock.
   *
   * The lit cursor follows `max(credited, beatCursor)`, so it leads the athlete
   * to the next hit on the beat instead of stalling on a punch the tracker
   * never reported. Landing punches still fill the completed marks; this only
   * decides which token is highlighted as "throw this next".
   */
  const beatCursorRef = useRef(0)
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
  const announcerRef = useRef<CueAnnouncer | null>(null)
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
          if (token.kind !== 'punch') return active ? 'active' : 'upcoming'
          return index === lit && active ? 'active' : 'upcoming'
        })
      }
      const credited = countsRef.current.inCue
      const cursor = Math.max(credited, beatCursorRef.current)
      return cue.tokens.map((token, index) => {
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
    // Hide "Next" while a repeated combo runs: the engine's next is just the
    // next rep of the same block, so showing it duplicates what is already on
    // screen. The next *distinct* block previews normally once the reps finish.
    const nextIsSameBlock =
      snap.next !== undefined && snap.next.blockId === snap.current?.blockId
    nextRef.current = nextIsSameBlock ? null : renderStateFor(snap.next)
  }, [renderStateFor])

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
          combination: safe(event.cue.tokens.join('-')),
          tokenIndex: safe(event.tokenIndex),
          ordinal: safe(ordinal),
          workElapsedMs: safe(event.workElapsedMs),
          monotonicTimeMs: safe(event.nowMs),
        })
        if (ordinal > beatCursorRef.current) {
          // 2026-08-31 token-order forensics — DO NOT sync/push here.
          //
          // This used to call `syncFromEngine()` + `pushStore(true)` per
          // token-due event. When the runner's 50 ms interval stalls (JS
          // churn: ~330 transport re-anchors/round each logging + notifying,
          // store pushes, render churn) the engine's `fireDueTokens` finds
          // several tokens overdue and publishes them all inside ONE
          // `engine.tick(...)` call — measured on a TRF drive: 74 token-due
          // events across only 63 distinct `workElapsedMs` values, worst
          // tick firing FIVE tokens microseconds apart.
          //
          // Each of those events then forced its own immediate, throttle-
          // bypassing store push and re-render, so the row strobed 0→1→2→3→4
          // in ~1 ms instead of walking the beat. On-glass: rings lighting
          // "spastically and out of order", repeating nodes mid-combo, and
          // the avatar (which follows the active token index) jumping in
          // lockstep with them — exactly what Kyle reported.
          //
          // The cursor is monotonic, so simply advancing it and letting the
          // runner's own tick loop render is correct AND adds no latency:
          // `syncFromEngine()` runs a few statements after `engine.tick(...)`
          // inside the SAME interval callback. A burst therefore collapses
          // into ONE render at the final cursor position — the visual jumps
          // to where the beat actually is rather than replaying history
          // (M39-V2 principle #3: a stall may skip an event that is already
          // over; missed events are recorded diagnostically, never replayed).
          //
          // The per-token `cue.tokenDue` log above still fires for every
          // token, so the cadence-lab analyzer keeps full resolution.
          beatCursorRef.current = ordinal
        }
        // Record EVERY token-due, including ones the cursor guard skipped:
        // a burst is exactly the case under investigation, and the skipped
        // ones are what make it visible.
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
        // A new combination: the per-cue credit, the beat cursor and any combo
        // celebration reset. A burst's target is its punch count; a sequence
        // cue's is its expectation count.
        countsRef.current.inCue = 0
        beatCursorRef.current = 0
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
    const startMetronome = (): void => {
      if (!workout.recipe.metronome.enabled) return
      const port = voice?.output.metronome
      if (!port) return
      const loop = metronomeLoopFor(
        workout.recipe.coachTempo.division,
        workout.recipe.coachTempo.swing,
      )
      if (!loop) {
        logger.warn('puncheokie.metronome', 'no loop for tempo', {
          division: safe(workout.recipe.coachTempo.division),
          swing: safe(workout.recipe.coachTempo.swing),
        })
        return
      }
      // baseBpm from the recipe drives the shared logical transport
      // (M39-V2 Phase W0-a) alongside the audible loop — one call,
      // both lifecycles synced. Consumers reading
      // `port.transport.snapshot()` see the fresh generation on
      // this start.
      port.start(loop, workout.recipe.metronome.volume, bpmForRecipe(workout.recipe))
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
      switch (transition.type) {
        case 'work-entered': {
          // A new round opens fresh tallies, and the previous round's frozen
          // result leaves the store rather than lingering behind the cues.
          freezeRef.current.beginRound(transition.roundIndex)
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
    const announcer = voice
      ? new CueAnnouncer({
          policy: voice.policy,
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
    if (announcer && voice) {
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
        play: (assetId, _atTick, slotId) => {
          const clip = findComboAnnounceById(assetId)
          if (!clip) {
            logger.warn(
              'puncheokie.slotDispatcher.assetMissing',
              'compiled coach slot references an unknown combo-announce id',
              { assetId: safe(assetId), slotId: safe(slotId) },
            )
            return
          }
          voice.output.playComboAnnounce?.({
            text: clip.text,
            module: clip.module,
            durationMs: clip.durationMs,
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
      const atwCueIds = new Set<string>()
      for (const round of timeline) {
        for (const cue of round.cues) {
          if (cue.voicePolicy === 'announce-then-work') atwCueIds.add(cue.id)
        }
      }
      const enqueuableSlots = compiledScore.coachSlots.filter((slot) =>
        atwCueIds.has(slot.cueId),
      )
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
    const MS_PER_SCORE_TICK = 60_000 / (60 * TRANSPORT_TICKS_PER_PULSE)
    const scoreTickAt = (workElapsedMs: number): number =>
      Math.round(workElapsedMs / MS_PER_SCORE_TICK)

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
    let offDetector = (): void => {}
    if (voice && announcer && voice.detector.available) {
      // Assume playback until the first answer arrives. `isActive` is async,
      // so a gate that started open would speak over the athlete's music for
      // however long the first read took — and that window covers the
      // countdown and the opening bell. Silence is recoverable; talking over
      // someone's music is the failure D1 exists to prevent.
      announcer.setThirdPartyPlayback(true)
      void voice.detector.isActive().then((active) => {
        announcer.setThirdPartyPlayback(active)
      })
      offDetector = voice.detector.subscribe((active) => {
        announcer.setThirdPartyPlayback(active)
      })
    }

    // Token-order forensics (2026-08-31). Gated on __DEV__ so a release
    // build never pays for it; a forensic drive runs the dev bundle. The
    // recorder is per-arm so a new workout starts with a clean buffer.
    vizRef.current = new VizForensics({
      enabled: __DEV__,
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
        slotDispatcher?.advance(scoreTickAt(snapshot.workElapsedMs))
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
      // Flush whatever the last tick recorded before dropping the buffer,
      // so a stall at the very end of a round is not lost.
      vizRef.current?.flush()
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
        announcerRef.current?.setVocabulary(vocabulary)
      },
      skipCountdown: () => {
        // The intro finished ahead of its padded cap; ring the bell now
        // rather than serving the athlete the leftover slack in silence.
        applyTransitions(sessionRef.current?.skipCountdown() ?? [])
        syncFromEngine()
        pushStore(true)
      },
      readCues: () => ({
        ...(currentRef.current ? { current: currentRef.current } : {}),
        ...(nextRef.current ? { next: nextRef.current } : {}),
        ...(freeWorkRef.current ? { freeWork: true } : {}),
      }),
      readResults: () => ({
        cueResults: matcherRef.current?.results() ?? [],
        ...(lastScoreRef.current ? { lastScore: lastScoreRef.current } : {}),
      }),
    }),
    [applyTransitions, clock, pushStore, source, syncFromEngine],
  )
}
