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
import React, { useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'

import { findPunchAvatar, type PunchAvatarFrames } from './punchAvatarManifest'
import type { CueInstance } from '@domain/programs/CueTimeline'
import {
  avatarResetAtMs,
  avatarWindowMs,
  flipFrameMs,
  minHoldMs,
  punchAvatarKey,
  type AvatarStep,
} from '@domain/workout/punchAvatar'

/**
 * Watermark strength. Deliberately a constant: a blackout round must leave
 * the card exactly as bright as a quiet one.
 */
const CARD_OPACITY = 0.28
/** The source art's 1024x1536. */
const CARD_ASPECT = 1024 / 1536

interface Shown {
  key: string
  frames: PunchAvatarFrames
  windowMs: number
  startedAt: number
}

/** The punch the card should be showing, or null for a non-punch token. */
function requestedFor(
  cue: CueInstance | undefined,
  activeTokenIndex: number,
): { key: string; frames: PunchAvatarFrames; windowMs: number } | null {
  if (!cue || activeTokenIndex < 0) return null
  const token = cue.tokens[activeTokenIndex]
  if (!token || token.kind !== 'punch') return null
  const frames = findPunchAvatar(token.number, token.body)
  if (!frames) return null
  // The same due times the rings fire on: the clip rail when a phrase drives
  // the cue, the beat grid otherwise.
  const dueTimes = cue.phraseTokenTimesMs ?? cue.tokenOffsetsMs
  const windowMs = avatarWindowMs(
    dueTimes,
    activeTokenIndex,
    cue.windowEndMs - cue.scheduledStartMs,
  )
  return { key: punchAvatarKey(token.number, token.body), frames, windowMs }
}

export function PunchAvatarCard(props: {
  cue?: CueInstance
  /** Index into `cue.tokens` of the token currently lit, or -1. */
  activeTokenIndex: number
  reducedMotion?: boolean
}): React.JSX.Element | null {
  const { cue, activeTokenIndex, reducedMotion = false } = props
  const requested = requestedFor(cue, activeTokenIndex)
  // The identity the effect actually keys off; the object itself is rebuilt
  // every render, so it travels by ref instead of through the deps array.
  const requestedKey = requested?.key ?? null
  const requestedWindowMs = requested?.windowMs ?? 0
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
    const hold = minHoldMs(current.windowMs)
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
  }, [requestedKey, requestedWindowMs])

  // Flip: wind-up, strike, hold the strike, back to guard for the next beat.
  useEffect(() => {
    if (!shown || reducedMotion) return
    const timers = [
      setTimeout(() => setStep('step2'), flipFrameMs(shown.windowMs)),
      setTimeout(() => setStep('step1'), avatarResetAtMs(shown.windowMs)),
    ]
    return () => timers.forEach(clearTimeout)
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
      <View style={styles.card}>
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
  card: { height: '100%', aspectRatio: CARD_ASPECT },
  frame: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  frameOn: { opacity: 1 },
  frameOff: { opacity: 0 },
})
