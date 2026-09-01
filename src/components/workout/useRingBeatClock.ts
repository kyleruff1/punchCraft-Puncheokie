/**
 * Ring beat clock — the token walk on the UI thread (MVP v2, GH #305).
 *
 * The displayed beat cursor used to ride the runner's JS tick (designed
 * 50 ms, measured 150-340 ms under load), which made ring fires trail the
 * click by mean 209 ms / p95 547 ms at 180 BPM. This hook is the same
 * medicine `useAvatarFrameClock` proved on the avatar: a `useFrameCallback`
 * worklet projects the cursor per frame from a shared clock, and JS hears
 * about it only when the ordinal ADVANCES (~3-4 times a second).
 *
 * ## The walk contract (Kyle): left to right, never skipping, never
 * duplicating, never backwards.
 *
 * Structural, not aspirational:
 *  - the projection is monotone in time (beatOrdinalAtMs never decreases
 *    as elapsed grows) and the clamp refuses regressions anyway;
 *  - emission advances AT MOST +1 PER FRAME. At 60 fps a frame is ~16 ms
 *    against a >=125 ms half-beat, so normal operation steps one node at
 *    a time by construction; on a rare multi-step frame (UI hiccup) the
 *    walk catches up one node per subsequent frame — visibly WALKING
 *    through the intermediates rather than teleporting past them;
 *  - a new cue occurrence (cueEpoch) resets the clamp — the page turn,
 *    the one permitted "reset".
 *
 * ## Worklet math duplication
 *
 * `beatOrdinalAtMsWorklet` mirrors `beatOrdinalAtMs`
 * (src/domain/programs/beatProjection.ts), which was written worklet-safe
 * BY DESIGN for exactly this lift. It is hand-mirrored rather than
 * imported because the Babel workletizer only transforms functions marked
 * or defined in worklet scope — the same trade `useAvatarFrameClock`
 * makes, and pinned the same way: a parity test asserts the two agree.
 */
import { useEffect } from 'react'
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

import {
  sharedWorkElapsedMs,
  type SharedWorkClock,
} from '@domain/timing/SharedWorkClock'
import { beatOrdinalAtMsWorklet } from './ringBeatMath'

export interface RingBeatCue {
  /** Occurrence identity — a change resets the monotonic clamp. */
  epoch: string
  scheduledStartMs: number
  tokenOffsetsMs: readonly number[]
  /** Token indexes of the expected punches, in punch-ordinal order. */
  expectedTokenIndexes: readonly number[]
}

/**
 * Drives `onOrdinal` with the displayed punch ordinal for the active cue.
 * `cue` MUST be identity-stable per occurrence (memoized on epoch) — the
 * staging effect deps on its primitives, the same discipline the avatar
 * clock learned the hard way.
 *
 * Passing `clock` undefined (tests, screens without the wiring) leaves
 * the hook inert; callers keep their JS-derived states untouched.
 */
export function useRingBeatClock(
  cue: RingBeatCue | null,
  /**
   * The PREVIEWED next cue (GH #305, late-staging fix). JS flips
   * `current` on its ~200-350ms tick, so staging-from-current promoted
   * cues PAST their boundary and the walk opened mid-bar ("random
   * starts on the 2"). The engine previews `next` seconds early — stage
   * it the moment it appears and promotion lands exactly on the clock.
   */
  nextCue: RingBeatCue | null,
  clock: SharedValue<SharedWorkClock> | undefined,
  onOrdinal: (epoch: string, ordinal: number) => void,
  /**
   * Worklet-side mirror of the displayed ordinal (Stage 3, GH #305).
   * Written UI-thread-synchronously on every advance/clear so
   * Reanimated styles can paint the nodes with ZERO JS in the path —
   * the runOnJS emission above proved insufficient on glass: at 1.5x
   * the 222ms step-dwell sits under React's commit latency, so tail
   * steps coalesced into the next clear and never painted.
   */
  displayOrdinal?: SharedValue<number>,
): void {
  // TWO slots — the cue being WALKED and the cue STAGED behind it — and
  // the WORKLET moves between them on its own clock (GH #305).
  //
  // The first wiring adopted whatever cue JS said was current, and JS
  // says so EARLY: a sim/tracker punch landing on the final token
  // completes the cue on that JS push, the runner flips `current`, and
  // the row re-staged before the frame that would have lit the last
  // node — on-glass: "very low rate of ever getting to the fourth
  // node". The walk was losing its final step to the exact JS-event
  // path it exists to escape.
  //
  // Now JS only ever STAGES: the incoming cue lands in the `next*`
  // slots, and the worklet promotes it when the CLOCK reaches its
  // scheduledStart — after the current bar's walk has finished by
  // construction, since bars precede their successors on the same grid.
  const epoch = useSharedValue('')
  const scheduledStartMs = useSharedValue(0)
  const offsets = useSharedValue<number[]>([])
  const expected = useSharedValue<number[]>([])
  const nextEpoch = useSharedValue('')
  const nextScheduledStartMs = useSharedValue(0)
  const nextOffsets = useSharedValue<number[]>([])
  const nextExpected = useSharedValue<number[]>([])
  const lastOrdinal = useSharedValue(-1)
  const active = useSharedValue(false)

  const cueEpoch = cue?.epoch ?? null
  const nextEpochProp = nextCue?.epoch ?? null
  useEffect(() => {
    if (!cue || !clock) {
      active.value = false
      return
    }
    if (!active.value || epoch.value === '') {
      // Cold start: nothing is walking — adopt directly.
      epoch.value = cue.epoch
      scheduledStartMs.value = cue.scheduledStartMs
      offsets.value = [...cue.tokenOffsetsMs]
      expected.value = [...cue.expectedTokenIndexes]
      lastOrdinal.value = -1
      nextEpoch.value = ''
      if (displayOrdinal) displayOrdinal.value = -1
    } else if (cue.epoch !== epoch.value && cue.epoch !== nextEpoch.value) {
      // STAGE ONLY — the worklet promotes on its own clock. (Fallback
      // path: normally the preview staged this seconds ago.)
      nextEpoch.value = cue.epoch
      nextScheduledStartMs.value = cue.scheduledStartMs
      nextOffsets.value = [...cue.tokenOffsetsMs]
      nextExpected.value = [...cue.expectedTokenIndexes]
    }
    // EARLY staging from the preview — the fix for boundary lateness.
    if (
      nextCue &&
      nextCue.epoch !== epoch.value &&
      nextCue.epoch !== nextEpoch.value
    ) {
      nextEpoch.value = nextCue.epoch
      nextScheduledStartMs.value = nextCue.scheduledStartMs
      nextOffsets.value = [...nextCue.tokenOffsetsMs]
      nextExpected.value = [...nextCue.expectedTokenIndexes]
    }
    active.value = true
    // Primitive-keyed on the occurrence: a re-render must not restage
    // (restaging resets the clamp — the exact class of bug the avatar's
    // dep-stomp was). A new epoch IS the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cueEpoch, nextEpochProp, clock])

  const cb = useFrameCallback(({ timestamp }) => {
    'worklet'
    if (!active.value || !clock) return
    const c = clock.value
    if (!c.running) return
    const elapsed = sharedWorkElapsedMs(c, timestamp)
    // Promote the staged cue once the clock reaches it — the boundary is
    // a clock fact, not a JS-event fact.
    if (nextEpoch.value !== '' && elapsed >= nextScheduledStartMs.value) {
      epoch.value = nextEpoch.value
      scheduledStartMs.value = nextScheduledStartMs.value
      offsets.value = nextOffsets.value
      expected.value = nextExpected.value
      lastOrdinal.value = -1
      nextEpoch.value = ''
      if (displayOrdinal) displayOrdinal.value = -1
      runOnJS(onOrdinal)(epoch.value, -1) // page-turn clear at the boundary
    }
    const target = beatOrdinalAtMsWorklet(
      scheduledStartMs.value,
      offsets.value,
      expected.value,
      elapsed,
    )
    // TARGET-JUMP, not step-per-frame (GH #305). The +1/frame walk
    // existed for the retired React paint path; with state-based
    // overlays it rendered late joins as a 16ms strobe through the
    // intermediates — on-glass: "speed-up spastic changes". Normal
    // cadence still lights each node in order (target advances one beat
    // at a time); a late join snaps once — past nodes filled, the
    // correct node active — which is the option-C principle applied to
    // paint: never replay what is already over. Monotonic clamp stands.
    if (target <= lastOrdinal.value) return
    lastOrdinal.value = target
    if (displayOrdinal) displayOrdinal.value = target
    runOnJS(onOrdinal)(epoch.value, target)
  })

  useEffect(() => {
    // NOT gated on reducedMotion, deliberately: freezing the avatar's
    // flip is cosmetic; freezing the WALK would strand the athlete on a
    // stale token. Reduced motion already strips the pulse animation at
    // the token level (ActiveRing renders a static outline).
    cb.setActive(!!clock && cueEpoch !== null)
  }, [cb, clock, cueEpoch])
}
