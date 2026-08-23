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
import { CADENCE_PROFILES as CADENCE } from '@domain/workout/cadence'
import type { CueMatchResult } from '@domain/programs/CueMatcher'
import type { CueScore } from '@domain/programs/cueScoring'
import { expandTimeline, type CueInstance } from '@domain/programs/CueTimeline'
import { CADENCE_PROFILES } from '@domain/workout/cadence'
import { resolveCapabilityTier, sequenceScoreLabel } from '@domain/workout/capabilityTier'
import { systemMonotonicClock, type MonotonicClock } from '@domain/time/MonotonicClock'
import { WorkoutSessionClock, type SessionTransition } from '@domain/session/WorkoutSessionClock'
import { RoundResultFreeze } from '@domain/session/restPhases'
import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'
import type { PunchEventSource } from '@domain/punch/PunchEventSource'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import type { Stance } from '@domain/workout/WorkoutTokens'
import type { CueEvent } from '@domain/programs/CueState'
import type { TokenVisualState } from '@components/workout/tokenVisuals'
import type { CueView } from '@components/workout/CueStage'
import { logger, safe } from '@diagnostics/logger'
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
/** Store write ceiling (spec §15.3). The UI cannot use more than 10 Hz. */
export const STORE_THROTTLE_MS = 100
/**
 * How many recent punch events stay resolvable when a cue settles. A cue's
 * window closes within a couple of seconds of its punches, so this is far
 * more than needed even at flurry cadence.
 */
export const RECENT_EVENT_WINDOW = 256

export interface WorkoutRunner {
  start(): void
  pause(): void
  resume(): void
  emergencyStop(): void
  skipCue(): void
  repeatCue(): void
  /** End the rest interval — all three §23 rest views go with it (D6). */
  skipRest(): void
  /** Cue views for the stage, kept out of the store (they hold token objects). */
  readCues(): { current?: CueView; next?: CueView }
  /** Settled matching so far. Read by M33-03 grading and M33-08 persistence. */
  readResults(): WorkoutRunnerResults
}

export interface UseWorkoutRunnerArgs {
  workout: GeneratedWorkout
  source: PunchEventSource
  stance: Stance
  clock?: MonotonicClock
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
}

export function useWorkoutRunner(args: UseWorkoutRunnerArgs): WorkoutRunner {
  const { workout, source, stance, persistence, onSessionEnded } = args
  const clock = useMemo(() => args.clock ?? systemMonotonicClock(), [args.clock])

  const bpm = CADENCE_PROFILES[workout.recipe.cadenceProfile].nominalBpm
  const timeline = useMemo(
    () => expandTimeline(workout, stance, bpm),
    [workout, stance, bpm],
  )

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

  const countsRef = useRef({ total: 0, left: 0, right: 0, inCue: 0, inCueExpected: 0 })
  const velocitySumRef = useRef(0)
  const velocityCountRef = useRef(0)
  const lastVelocityRef = useRef<LiveVelocity | undefined>(undefined)
  const lastStoreWriteRef = useRef(0)
  /** Active work seconds banked from completed rounds. */
  const completedActiveSecondsRef = useRef(0)
  const activeElapsedSecondsRef = useRef(0)
  const matcherRef = useRef<LiveCueMatcher | null>(null)
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
  /** Adaptations the plan actually made, in the order it made them. */
  const adaptationsRef = useRef<Array<Omit<AdaptationRecord, 'generatedWorkoutId'>>>([])
  /**
   * Blocks the athlete was actually shown. This is the realized stream D8
   * requires — recalculation replays what ran, so a block the workout never
   * reached must not appear as though it did.
   */
  const realizedBlocksRef = useRef(new Set<string>())
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
          ? { requiredPace: pacing.requiredPace, projectedTotal: pacing.projectedTotal }
          : {}),
        pacingCue: pacingCueRef.current,
        sequenceScoreLabel: sequenceScoreLabel(capability.tier),
        velocityAvailable: capability.velocityAvailable,
        capabilityTier: capability.tier,
        sourceKind: source.id === 'sim' ? 'simulated' : 'tracker',
        ...(capability.velocityAvailable
          ? { lastVelocity: lastVelocityRef.current, avgVelocity: avg }
          : { lastVelocity: undefined, avgVelocity: undefined }),
      })
    },
    [capability, clock, source.id, stance],
  )

  const syncFromEngine = useCallback((): void => {
    const engine = engineRef.current
    if (!engine) return
    const snap = engine.snapshot()

    // Token states come from the engine's status plus which expectations
    // have been credited — never from a timer of the screen's own.
    const states = (cue: CueInstance | undefined, active: boolean): TokenVisualState[] => {
      if (!cue) return []
      const credited = countsRef.current.inCue
      return cue.tokens.map((token, index) => {
        if (token.kind !== 'punch') return active ? 'active' : 'upcoming'
        const punchOrdinal = cue.expectedPunches.findIndex((p) => p.tokenIndex === index)
        if (punchOrdinal < 0) return 'upcoming'
        if (punchOrdinal < credited) return 'completed'
        if (punchOrdinal === credited && active) return 'active'
        return 'upcoming'
      })
    }

    const isActive = snap.status === 'active' || snap.status === 'accepting'
    currentRef.current = renderStateFor(snap.current, states(snap.current, isActive))
    nextRef.current = renderStateFor(snap.next)
  }, [renderStateFor])

  // -------------------------------------------------------------------------

  const onCueEvent = useCallback(
    (event: CueEvent): void => {
      if (event.type === 'token-due') return
      // The matcher needs the window lifecycle to know which cue is open.
      matcherRef.current?.onCueEvent(event)
      if (event.type === 'cue-active') {
        // Shown, therefore realized — regardless of what the athlete threw.
        realizedBlocksRef.current.add(event.cue.blockId)
        // A new combination: the per-cue credit resets. A burst's target is
        // its punch count; a sequence cue's is its expectation count.
        countsRef.current.inCue = 0
        affirmedRef.current = []
        countsRef.current.inCueExpected =
          event.cue.scoring === 'count'
            ? (event.cue.countScored?.targetPunches ?? 0)
            : event.cue.expectedPunches.length
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
        case 'match':
          // A hand mismatch still consumed the slot, so the combination
          // advances either way — but only a real match is credited to the
          // engine, which is what decides completed vs expired.
          if (event.match.outcome === 'matched') {
            engineRef.current?.notifyMatch(
              event.match.cueId,
              event.match.expectedIndex,
              event.match.eventTimeMs,
            )
          }
          countsRef.current.inCue = event.match.expectedIndex + 1
          // Reward only: nothing is recorded when the byte disagrees.
          if (event.match.affirmed) {
            const expected = currentRef.current?.cue.expectedPunches[event.match.expectedIndex]
            if (expected) affirmedRef.current = [...affirmedRef.current, expected.tokenIndex]
          }
          break

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
            cueRowsRef.current.push(
              ...toCueResultRows({
                cue: settled,
                result: event.result,
                events: recentEventsRef.current.values(),
              }),
            )
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
    for (const transition of transitions) {
      switch (transition.type) {
        case 'work-entered': {
          // A new round opens fresh tallies, and the previous round's frozen
          // result leaves the store rather than lingering behind the cues.
          freezeRef.current.beginRound(transition.roundIndex)
          setLive({ frozenRoundResult: undefined })

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
          break
        }
        case 'rest-entered': {
          // The bell. Everything the rest screen shows is fixed here; later
          // punches reach a closed accumulator and change nothing (doc §23).
          const target = workout.schedule[transition.roundIndex]?.targetPunches ?? 0
          const frozen = freezeRef.current.freeze(target)
          if (frozen) setLive({ frozenRoundResult: frozen })

          engine.onSessionPhase({ type: 'rest-entered', nowMs: clock.now() })
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
          break
        case 'resumed':
          engine.onSessionPhase({ type: 'resumed', nowMs: clock.now() })
          break
        case 'completed':
          engine.onSessionPhase({ type: 'finishing', nowMs: clock.now() })
          // After the engine, so the last cue has settled and its rows are
          // in hand before the transaction opens.
          endSession(false)
          break
        case 'cancelled':
          engine.onSessionPhase({ type: 'cancelled', nowMs: clock.now() })
          // A cancelled workout is still a workout that happened; it is
          // written with status 'cancelled' rather than discarded.
          endSession(true)
          break
        default:
          break
      }
    }
  }, [clock, endSession, workout])

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
      { clock },
    )
    engineRef.current = engine
    sessionRef.current = session

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
      if (transitions.length > 0) applyTransitions(transitions)
      engine.tick(session.snapshot().workElapsedMs)
      syncFromEngine()
      pushStore(false)
    }, TICK_INTERVAL_MS)

    logger.info('puncheokie.runner.start', 'workout runner armed', {
      workout: safe(workout.id),
      rounds: safe(workout.schedule.length),
      source: safe(source.id),
    })

    return () => {
      clearInterval(timer)
      offEngine()
      offMatcher()
      offSource()
      source.stop()
      engineRef.current = null
      sessionRef.current = null
      matcherRef.current = null
      pacingRef.current = null
      resetLive()
    }
  }, [
    applyTransitions,
    capability.tier,
    clock,
    onCueEvent,
    onMatcherEvent,
    onPunch,
    pushStore,
    source,
    syncFromEngine,
    timeline,
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
      readCues: () => ({
        ...(currentRef.current ? { current: currentRef.current } : {}),
        ...(nextRef.current ? { next: nextRef.current } : {}),
      }),
      readResults: () => ({
        cueResults: matcherRef.current?.results() ?? [],
        ...(lastScoreRef.current ? { lastScore: lastScoreRef.current } : {}),
      }),
    }),
    [applyTransitions, clock, pushStore, source, syncFromEngine],
  )
}
