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

import { findPunchAvatar, type PunchAvatarFrames } from './punchAvatarManifest'
import type { CueInstance } from '@domain/programs/CueTimeline'
import {
  avatarFrameAt,
  avatarWindowMs,
  minHoldMs,
  punchAvatarKey,
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
const RIGHT_SHIFT_PCT = 0.15
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

/** The punch the card should be showing, or null for a non-punch token. */
function requestedFor(
  cue: CueInstance | undefined,
  tokenIndex: number,
  lastPunchIndex: number,
): { key: string; frames: PunchAvatarFrames; windowMs: number; isLast: boolean } | null {
  if (!cue || tokenIndex < 0) return null
  const token = cue.tokens[tokenIndex]
  if (!token || token.kind !== 'punch') return null
  const frames = findPunchAvatar(token.number, token.body)
  if (!frames) return null
  // The same due times the rings fire on: the clip rail when a phrase drives
  // the cue, the beat grid otherwise.
  const dueTimes = cue.phraseTokenTimesMs ?? cue.tokenOffsetsMs
  const windowMs = avatarWindowMs(dueTimes, tokenIndex, cue.windowEndMs - cue.scheduledStartMs)
  const isLast = tokenIndex === lastPunchIndex
  return { key: punchAvatarKey(token.number, token.body), frames, windowMs, isLast }
}

export function PunchAvatarCard(props: {
  cue?: CueInstance
  /** Index into `cue.tokens` of the token currently lit, or -1. */
  activeTokenIndex: number
  reducedMotion?: boolean
}): React.JSX.Element | null {
  const { cue, activeTokenIndex, reducedMotion = false } = props
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

  // Adopt the requested punch, honouring the minimum hold so a fast
  // sequence can never show half a flip.
  useEffect(() => {
    const req = requestedRef.current
    if (!req) return
    const current = shownRef.current
    if (current && current.key === req.key) return

    const adopt = (): void => {
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
  }, [requestedKey, requestedWindowMs, requestedIsLast])

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
  useEffect(() => {
    if (!shown || reducedMotion) return
    const beat = Math.max(shown.windowMs, minHoldMs(shown.windowMs, shown.isLast))
    const tick = (): void => {
      const elapsed = (Date.now() - shown.startedAt) % beat
      setStep(avatarFrameAt(elapsed, shown.windowMs, shown.isLast))
    }
    tick()
    const id = setInterval(tick, FLIP_TICK_MS)
    return () => clearInterval(id)
  }, [shown, reducedMotion])

  if (!shown) return null
  // No art for defense, footwork or coach tokens: the figure holds guard.
  const holdingGuard = requested === null
  const visible: AvatarStep = reducedMotion
    ? 'step2'
    : holdingGuard
      ? 'step1'
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
