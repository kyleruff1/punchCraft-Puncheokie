/**
 * Punch avatar — a two-frame stop-motion card behind the token row.
 *
 * The figure demonstrates the shot whose ring is lit: step 1 is the
 * guard/wind-up, step 2 is the strike, and the pair flips on the cue's own
 * rhythm. Both frames always play — a punch holds the card for
 * `MIN_HOLD_MS` even if the next token is already due, and tokens arriving
 * inside that hold replace each other, so the card skips ahead rather than
 * lagging behind the rings.
 *
 * Layer contract: this is HUD. It renders inside the cue stage, which is a
 * later sibling of the backdrop layer, so the reactive backdrop can never
 * distort, shake or dim it — the veil's darkening happens inside a fragment
 * shader that cannot reach a React view above the canvas. Its opacity is a
 * fixed local constant, never modulated by any effect state.
 *
 * Presentational only — no store, engine or clock imports; identity comes
 * from the same token the punch nodes render.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { GUARD_FRAME, findPunchAvatar, type PunchAvatarFrames } from './punchAvatarManifest'
import { colors } from '@/theme/colors'
import { useAvatarFrameClock } from './useAvatarFrameClock'
import type { CueInstance } from '@domain/programs/CueTimeline'
import type { SharedTransportAnchor } from '@domain/timing/SharedTransportAnchor'
import {
  MIN_FRAME_MS,
  avatarFrameAt,
  avatarWindowMs,
  flipFrameMs,
  minHoldMs,
  type AvatarStep,
} from '@domain/workout/punchAvatar'

/**
 * Full presence (Kyle on glass, 2026-09-02). The 0.28 watermark was
 * settled for the era when the figure haunted the stage BEHIND the
 * token row; it ended when he moved into his own partitioned trainer
 * box — a demonstrator the boxer mimics, not a background spirit.
 * Still deliberately a constant: a blackout round must leave the card
 * exactly as bright as a quiet one.
 */
const CARD_OPACITY = 1
/** The source art's 1024x1536. */
const CARD_ASPECT = 1024 / 1536
/**
 * A FIXED height, not a share of the zone. The cue stage's current zone
 * grows and shrinks as the "Next" preview comes and goes, and a
 * percentage height made the figure jump between two sizes on every one
 * of those layout changes. Grown 400 → 480 on Kyle's 2026-08-30 live
 * observation that the stage has room for a larger figure without
 * competing with the token row.
 */
const CARD_HEIGHT = 480
/**
 * How often the flip clock is sampled. Well under the shortest frame
 * (MIN_FRAME_MS 90) so a strike can never be skipped, and cheap: it
 * re-renders one small component, not the stage.
 */
const FLIP_TICK_MS = 30

interface Shown {
  key: string
  frames: PunchAvatarFrames
  windowMs: number
  isLast: boolean
  startedAt: number
}

/**
 * The punch the card should be showing, or null for a non-punch token.
 * Exported so the anti-collapse `key` contract can be pinned in a unit
 * test (M39-V2 Phase 3c) without needing to reason about
 * `useEffect` timing.
 */
export function requestedFor(
  cue: CueInstance | undefined,
  tokenIndex: number,
  lastPunchIndex: number,
): { key: string; frames: PunchAvatarFrames; windowMs: number; isLast: boolean } | null {
  if (!cue || tokenIndex < 0) return null
  const token = cue.tokens[tokenIndex]
  if (!token || token.kind !== 'punch') return null
  const frames = findPunchAvatar(token.number, token.body)
  if (!frames) return null
  // The same due times the rings fire on. Phase 5-ii retired the V1c
  // `phraseTokenTimesMs` rail override; only the beat grid remains.
  // (Engine-authored per-strike ticks live on
  // `SpineSchedule.compiled[cueId]` — a follow-up Phase 5 pass wires
  // the avatar to that shared authority.)
  const dueTimes = cue.tokenOffsetsMs
  let windowMs = avatarWindowMs(dueTimes, tokenIndex, cue.windowEndMs - cue.scheduledStartMs)
  // COUNT-SCORED cues pump the same motif for the whole block, and a
  // single-token pump has no "next due time" — so `avatarWindowMs` fell
  // back to the ENTIRE cue window. A jab pad runs tens of seconds, and a
  // lone token is also `isLast` (strict thirds), so the figure held one
  // frame for a third of the block: Kyle's "avatar is stationary during
  // the extended jab segment" (GH #305). The rings already pump on
  // per-punch pulses (`pulsesFor`: window / cycles); cap the flip window
  // at that same stride so the avatar throws WITH the pulse. Same
  // formula as `pulsesFor`, cited rather than imported — this module is
  // presentational and must not pull the spine in.
  if (cue.scoring === 'count') {
    const target = cue.countScored?.targetPunches ?? 0
    const punchCount = cue.tokens.filter((t) => t.kind === 'punch').length
    const cycles = Math.max(1, Math.round(target / Math.max(1, punchCount)))
    const pumpWindowMs = cue.scheduledEndMs - cue.scheduledStartMs
    if (pumpWindowMs > 0) {
      const strideMs = pumpWindowMs / cycles
      windowMs = Math.min(windowMs, strideMs)
    }
  }
  const isLast = tokenIndex === lastPunchIndex
  // Per-occurrence identity — the two `1`s in `1-1-2` produce the same
  // `punchAvatarKey('1', false)` and would short-circuit each other at
  // the adoption guard below (`current.key === req.key`), leaving the
  // second `1`'s ring lit against a stale card. Keying on the cue's
  // strike-occurrence id (M39-V2 Phase 2 shape) distinguishes them.
  const key = `${cue.id}:${tokenIndex}`
  return { key, frames, windowMs, isLast }
}

export function PunchAvatarCard(props: {
  cue?: CueInstance
  /** Index into `cue.tokens` of the token currently lit, or -1. */
  activeTokenIndex: number
  reducedMotion?: boolean
  /**
   * Optional shared transport anchor (M39-V2 Phase W0-b-iii, Kyle
   * 2026-08-30). When provided, the card's flip derives from the
   * transport tick via a `useFrameCallback` worklet; when absent
   * the original 30 ms `setInterval` path runs instead (test doubles
   * and any screen predating W0 keep working unchanged). See
   * `useAvatarFrameClock.ts`.
   */
  anchor?: SharedValue<SharedTransportAnchor>
}): React.JSX.Element | null {
  const { cue, activeTokenIndex, reducedMotion = false, anchor } = props

  // Every punch in the combination, in order. The card walks these.
  const punchIndexes = useMemo(
    () =>
      (cue?.tokens ?? []).reduce<number[]>((acc, token, index) => {
        if (token.kind === 'punch') acc.push(index)
        return acc
      }, []),
    [cue],
  )
  const cueId = cue?.id

  // Only a PUNCH the engine has lit can steer the card. Defense, footwork
  // and coach tokens are marked active for the whole cue, so trusting any
  // active index parked the figure in guard for the entire block.
  //
  // NO self-driven fallback (stillness rule, Kyle on-glass 2026-09-02).
  // The old "demo walker" cycled the combination whenever the engine was
  // quiet — which is exactly every rest slot, bar boundary, setup gap and
  // pause — and every hop was a fresh adoption + flip: "empty slots make
  // the avatar jitter out". Quiet now means the guard-hold below.
  const engineLit = activeTokenIndex >= 0 && punchIndexes.includes(activeTokenIndex)
  const tokenIndex = engineLit ? activeTokenIndex : -1
  const lastPunchIndex = punchIndexes.at(-1) ?? -1
  const requested = requestedFor(cue, tokenIndex, lastPunchIndex)
  // The identity the effect actually keys off; the object itself is rebuilt
  // every render, so it travels by ref instead of through the deps array.
  const requestedKey = requested?.key ?? null
  const requestedWindowMs = requested?.windowMs ?? 0
  const requestedIsLast = requested?.isLast ?? false
  const requestedRef = useRef(requested)
  requestedRef.current = requested

  const [shown, setShown] = useState<Shown | null>(null)
  const [step, setStep] = useState<AvatarStep>('step1')
  const shownRef = useRef<Shown | null>(null)
  shownRef.current = shown
  const promoteRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Which STRIKE OCCURRENCE is on screen — not just which punch art.
  //
  // Kyle 2026-08-31: "our avatar flipping should always coincide with the
  // node lighting up that it's representing... relighting of a token, or
  // pumping, would be new avatar flips." A pump block (`1 × 8`) mints a
  // separate cue per rep (`r1-b3#0` … `r1-b3#7`) but every rep requests the
  // SAME punch art (`'1'`), so the adopt guard below — which compared only
  // `key` — bailed after the first rep. The card then sat on one frame for
  // the whole pump: "avatar stays stagnant on single punch indicator
  // session pumps". Keying adoption on (cue, token) re-arms the flip for
  // every re-light while still letting the art lookup stay by punch key.
  const occurrenceKey = requested ? `${cueId}:${tokenIndex}` : null
  const adoptedOccurrenceRef = useRef<string | null>(null)

  // Adopt the requested punch, honouring the minimum hold so a fast
  // sequence can never show half a flip.
  useEffect(() => {
    const req = requestedRef.current
    if (!req) return
    const current = shownRef.current
    // Same art AND same occurrence: nothing new to show. A repeat of the
    // same punch in a new occurrence falls through and re-flips.
    if (current && current.key === req.key && adoptedOccurrenceRef.current === occurrenceKey)
      return

    const adopt = (): void => {
      adoptedOccurrenceRef.current = occurrenceKey
      setShown({ ...req, startedAt: Date.now() })
      // Strike-first (2026-09-02): the identity frame lands ON the beat
      // the node lights; the drivers walk it to retract, then guard.
      setStep('step1')
    }
    if (!current) {
      adopt()
      return
    }
    const hold = minHoldMs(current.windowMs, current.isLast)
    const heldFor = Date.now() - current.startedAt
    if (heldFor >= hold) {
      adopt()
      return
    }
    // Inside the hold: land it the moment the flip completes. A newer token
    // arriving first simply re-schedules this, dropping the stale one.
    if (promoteRef.current) clearTimeout(promoteRef.current)
    promoteRef.current = setTimeout(adopt, hold - heldFor)
    return () => {
      if (promoteRef.current) clearTimeout(promoteRef.current)
      promoteRef.current = null
    }
  }, [requestedKey, requestedWindowMs, requestedIsLast, occurrenceKey])



  // Flip: wind-up, strike, hold the strike, back to guard, repeat on the
  // beat. LEVEL-TRIGGERED on purpose — the frame is recomputed from elapsed
  // time on every tick rather than scheduled as a chain of transitions. A
  // scheduled chain can be cancelled by the screen's re-render churn and
  // wedge the figure on one frame (it did); this cannot, because the worst
  // a lost tick costs is one frame of lag before the clock corrects it.
  //
  // Two paths, mutually exclusive: when an `anchor` is provided (M39-V2
  // Phase W0-b-iii), the frame-clock worklet below owns the flip and
  // this `setInterval` is skipped. Absent an anchor — test doubles, any
  // screen that predates W0, `reducedMotion` renders — the setInterval
  // path stays authoritative.
  useEffect(() => {
    // Gate on the anchor RUNNING, not merely existing (GH #305). The live
    // screen ALWAYS supplies an anchor SharedValue, but the transport only
    // starts on workouts with `metronome.enabled` — 4 of 11 samples. On
    // the other 7 the anchor stays STOPPED (`ticksPerMillisecond: 0`),
    // the worklet freezes at its bail-out, and gating this fallback on
    // mere existence left the figure unable to flip AT ALL — Kyle's
    // "avatar frozen in extended / no movement" QA reports.
    const anchorRunning = anchor !== undefined && anchor.value.ticksPerMillisecond > 0
    if (anchorRunning) return
    if (!shown || reducedMotion) return
    // RAW elapsed, never wrapped (stillness rule, 2026-09-02): the cycle
    // is guard -> strike -> settle-to-guard, once. The old modulo wrap
    // re-threw the same punch every beat through rests and pauses. Once
    // settled the interval clears itself — still means ZERO timers.
    const settleAtMs =
      Math.max(MIN_FRAME_MS, shown.windowMs - flipFrameMs(shown.windowMs)) +
      flipFrameMs(shown.windowMs) +
      FLIP_TICK_MS
    const id = setInterval(() => {
      // Deterministic handoff: if the transport starts mid-adoption the
      // worklet takes over; two writers on `step` would fight.
      if (anchor !== undefined && anchor.value.ticksPerMillisecond > 0) return
      const elapsed = Date.now() - shown.startedAt
      setStep(avatarFrameAt(elapsed, shown.windowMs, shown.isLast))
      if (elapsed >= settleAtMs) clearInterval(id)
    }, FLIP_TICK_MS)
    setStep(avatarFrameAt(Date.now() - shown.startedAt, shown.windowMs, shown.isLast))
    return () => clearInterval(id)
  }, [shown, reducedMotion, anchor])

  // Frame-clock path (M39-V2 Phase W0-b-iii). No-op when `anchor` is
  // undefined; when present, drives the flip from the shared transport
  // tick on the UI thread. `setStep` receives a `runOnJS` from the
  // worklet only when the computed frame changes — same lazy cadence
  // as the setInterval path above.
  // MEMOIZED, and the memo is load-bearing (GH #305): an inline object
  // literal here sat in the hook's effect deps, so EVERY re-render of the
  // card re-ran the effect, re-sampled `startedAtTick` and reset the flip
  // cycle to step1. The live screen re-renders on every tracker punch
  // (`pushStore(true)` bypasses the throttle) and every 50 ms tick — the
  // flip phase was being re-zeroed several times a second during a flurry.
  // THE dominant avatar jank, and it was React, not the transport.
  const clockShown = useMemo(
    () => (shown ? { key: shown.key, windowMs: shown.windowMs, isLast: shown.isLast } : null),
    // Keyed on the three primitives the clock consumes; `shown` itself is
    // a fresh object per adoption and would defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown?.key, shown?.windowMs, shown?.isLast],
  )
  useAvatarFrameClock(clockShown, reducedMotion, anchor, setStep)

  // THE GUARD STANCE (Kyle, on-glass 2026-09-02): whenever no punch is
  // lit — round start, combo-end breaths, rest slots, bar boundaries,
  // setup gaps, pauses, transitionary call-outs — the figure sits
  // MOTIONLESS in the universal GUARD art. Purely visual filler for the
  // quiet moments; never called out by the coach. The per-punch cycle's
  // own settle also lands here (avatarFrameAt returns 'guard' after the
  // strike linger), so every full combo ends in guard with no last-punch
  // special case.
  const holding = requested === null
  const frames = shown?.frames ?? null
  const visible: AvatarStep = reducedMotion || holding ? 'guard' : step
  if (!frames && visible !== 'guard') return null

  return (
    <View style={styles.layer} pointerEvents="none" testID="punch-avatar-card">
      {/* 1:5 spacers put a sixth of the free width on his left — the
          "smidge further left" Kyle settled on-glass (2026-09-02). */}
      <View style={styles.leftSpacer} />
      <View style={styles.card} testID="punch-avatar-figure">
        {/* Both frames stay mounted and toggle opacity — swapping a single
            source would risk a decode hitch mid-combination.
            fadeDuration={0} (GH #305): RN Android defaults to a 300 ms
            fade-in on a freshly decoded image. `shown.frames` swaps both
            sources on every new punch adoption, so each first appearance
            GHOSTED in over 300 ms — on top of a 90-220 ms stop-motion
            frame. The flip must be a hard cut. */}
        {frames ? (
          <Image
            source={frames.step1}
            style={[styles.frame, visible === 'step1' ? styles.frameOn : styles.frameOff]}
            resizeMode="contain"
            fadeDuration={0}
            testID="punch-avatar-step1"
          />
        ) : null}
        {frames ? (
          <Image
            source={frames.step2}
            style={[styles.frame, visible === 'step2' ? styles.frameOn : styles.frameOff]}
            resizeMode="contain"
            fadeDuration={0}
            testID="punch-avatar-step2"
          />
        ) : null}
        <Image
          source={GUARD_FRAME}
          style={[styles.frame, visible === 'guard' ? styles.frameOn : styles.frameOff]}
          resizeMode="contain"
          fadeDuration={0}
          testID="punch-avatar-guard"
        />
      </View>
      <View style={styles.rightSpacer} />
    </View>
  )
}

const styles = StyleSheet.create({
  // The trainer box (Kyle, 2026-09-02): left panel, ~35% of the stage,
  // full height, partitioned by the SAME 1px colors.border line the KPI
  // rail draws — "so he's in a box." Watermark opacity stays settled.
  layer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '35%',
    borderRightWidth: 1,
    borderRightColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    opacity: CARD_OPACITY,
  },
  // 1:3 — a quarter of the free width on his left: shifted TOWARD the
  // screen's left border by half the centered gap (Kyle, final direction
  // call after one on-glass round-trip each way).
  leftSpacer: { flex: 1 },
  rightSpacer: { flex: 5 },
  card: { height: CARD_HEIGHT, maxWidth: '96%', aspectRatio: CARD_ASPECT },
  frame: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  frameOn: { opacity: 1 },
  frameOff: { opacity: 0 },
})
