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
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'

import { findPunchAvatar, type PunchAvatarFrames } from './punchAvatarManifest'
import { useAvatarFrameClock } from './useAvatarFrameClock'
import type { CueInstance } from '@domain/programs/CueTimeline'
import type { SharedTransportAnchor } from '@domain/timing/SharedTransportAnchor'
import {
  avatarFrameAt,
  avatarWindowMs,
  minHoldMs,
  type AvatarStep,
} from '@domain/workout/punchAvatar'

/**
 * Watermark strength — SETTLED, not a placeholder (Kyle on glass,
 * 2026-08-29): "not completely opaque but a background spirit". Do not
 * raise this toward opacity 1 thinking it is unfinished; the figure is
 * meant to haunt the stage behind the numbers, not compete with them.
 *
 * Deliberately a constant, too: a blackout round must leave the card
 * exactly as bright as a quiet one.
 */
const CARD_OPACITY = 0.28
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
 * Placement offset from the layer's flexbox center (Kyle 2026-08-30
 * live observation): the token row + metrics rail leave more room on
 * the right and top of the stage than on the left/bottom, so the
 * central figure gets pushed off-center to breathe.
 *
 * Percentages of the CURRENT stage size (via useWindowDimensions);
 * portrait/landscape and tablet/phone all offset the same fraction of
 * the frame, not a fixed pixel count that would drift with viewport.
 */
const RIGHT_SHIFT_PCT = 0.2
const UP_SHIFT_PCT = 0.05
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
  const windowMs = avatarWindowMs(dueTimes, tokenIndex, cue.windowEndMs - cue.scheduledStartMs)
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
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions()

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
  // Where the demonstration has walked to. The engine is authoritative
  // whenever it lights a token; between those moments — a gap between reps,
  // a cue still previewing — the card keeps demonstrating the combination
  // rather than freezing on a guard pose.
  const [demoPos, setDemoPos] = useState(0)
  useEffect(() => {
    setDemoPos(0)
  }, [cueId])
  useEffect(() => {
    const pos = punchIndexes.indexOf(activeTokenIndex)
    if (pos >= 0) setDemoPos(pos)
  }, [activeTokenIndex, punchIndexes])

  // Only a PUNCH the engine has lit can steer the card. Defense, footwork
  // and coach tokens are marked active for the whole cue, so trusting any
  // active index parked the figure in guard for the entire block.
  const engineLit = activeTokenIndex >= 0 && punchIndexes.includes(activeTokenIndex)
  const tokenIndex = engineLit ? activeTokenIndex : (punchIndexes[demoPos] ?? -1)
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

  // Walk to the next punch when the engine is quiet, on that punch's own
  // window so the demonstration keeps the combination's rhythm.
  const stepCount = punchIndexes.length
  useEffect(() => {
    if (engineLit || stepCount === 0 || requestedWindowMs <= 0) return
    const dwell = Math.max(requestedWindowMs, minHoldMs(requestedWindowMs, requestedIsLast))
    const timer = setTimeout(() => setDemoPos((p) => (p + 1) % stepCount), dwell)
    return () => clearTimeout(timer)
  }, [engineLit, stepCount, requestedWindowMs, requestedIsLast, demoPos])

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
    if (anchor) return
    if (!shown || reducedMotion) return
    const beat = Math.max(shown.windowMs, minHoldMs(shown.windowMs, shown.isLast))
    const tick = (): void => {
      const elapsed = (Date.now() - shown.startedAt) % beat
      setStep(avatarFrameAt(elapsed, shown.windowMs, shown.isLast))
    }
    tick()
    const id = setInterval(tick, FLIP_TICK_MS)
    return () => clearInterval(id)
  }, [shown, reducedMotion, anchor])

  // Frame-clock path (M39-V2 Phase W0-b-iii). No-op when `anchor` is
  // undefined; when present, drives the flip from the shared transport
  // tick on the UI thread. `setStep` receives a `runOnJS` from the
  // worklet only when the computed frame changes — same lazy cadence
  // as the setInterval path above.
  useAvatarFrameClock(
    shown ? { key: shown.key, windowMs: shown.windowMs, isLast: shown.isLast } : null,
    reducedMotion,
    anchor,
    setStep,
  )

  if (!shown) return null
  // No art for defense, footwork or coach tokens: the figure holds guard.
  //
  // `step2` IS the guard (see punchAvatarManifest: step1 → `-s2.png`, the
  // STRIKE; step2 → `-s1.png`, the RETRACTED guard). This branch used to
  // return `step1`, which pinned the figure EXTENDED for the whole span —
  // exactly the "he's stuck in position extended" Kyle saw on-glass
  // 2026-08-31, because `shown` is never cleared, so any cue whose active
  // token is defense/footwork/coach (or has no lit punch) froze the card
  // mid-strike with no path back.
  const holdingGuard = requested === null
  const visible: AvatarStep = reducedMotion
    ? 'step2'
    : holdingGuard
      ? 'step2'
      : step

  return (
    <View style={styles.layer} pointerEvents="none" testID="punch-avatar-card">
      <View
        style={[
          styles.card,
          {
            transform: [
              { translateX: viewportWidth * RIGHT_SHIFT_PCT },
              { translateY: -viewportHeight * UP_SHIFT_PCT },
            ],
          },
        ]}
      >
        {/* Both frames stay mounted and toggle opacity — swapping a single
            source would risk a decode hitch mid-combination. */}
        <Image
          source={shown.frames.step1}
          style={[styles.frame, visible === 'step1' ? styles.frameOn : styles.frameOff]}
          resizeMode="contain"
          testID="punch-avatar-step1"
        />
        <Image
          source={shown.frames.step2}
          style={[styles.frame, visible === 'step2' ? styles.frameOn : styles.frameOff]}
          resizeMode="contain"
          testID="punch-avatar-step2"
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: CARD_OPACITY,
  },
  card: { height: CARD_HEIGHT, aspectRatio: CARD_ASPECT },
  frame: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  frameOn: { opacity: 1 },
  frameOff: { opacity: 0 },
})
