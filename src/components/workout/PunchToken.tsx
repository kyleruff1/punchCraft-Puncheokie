/**
 * Numbered punch token (M32-06, doc §13).
 *
 * A large circular token carrying the number. A body shot is the same
 * circle with a prominent uppercase **B** badge and a lower placement cue —
 * the badge is purely visual; authored notation keeps the lowercase `b`
 * (D10), and nothing here ever emits notation.
 *
 * The optional `handHint` ('L'/'R') is caller-supplied because the hand
 * depends on stance, which this component deliberately does not know
 * (doc §11).
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { ACTIVE_RING_INSET, ActiveRing } from './ActiveRing'
import { AffirmationRing } from './AffirmationRing'
import {
  STATE_VISUALS,
  TOKEN_DIAMETER,
  TOKEN_FONT_SIZE,
  type TokenSize,
  type TokenVisualState,
} from './tokenVisuals'
import { colors } from '@/theme/colors'
import type { PunchNumber } from '@domain/workout/WorkoutTokens'

export interface PunchTokenProps {
  number: PunchNumber
  body: boolean
  state: TokenVisualState
  handHint?: 'L' | 'R'
  size?: TokenSize
  reducedMotion?: boolean
  /**
   * The punch landed AND the device-local type byte agreed with the
   * technique the cue asked for. Reward only — its absence is never
   * rendered, because the signal behind it is too inconsistent to accuse
   * anyone with (see `typeConcordance`).
   */
  affirmed?: boolean
  /** Changing this re-fires the affirmation, so repeat hits each get one. */
  affirmKey?: string | number
  /**
   * Stage 3 (GH #305): the worklet-owned walk cursor. When provided with
   * `punchOrdinal`, ACTIVE and COMPLETED are painted by Reanimated styles
   * reading this shared value directly — zero JS between the clock and the
   * pixels. The `state` prop then only supplies the base (upcoming) look;
   * JS-computed active/completed for this node are ignored, because a
   * second writer is exactly the bounce machine we removed.
   */
  walkOrdinal?: SharedValue<number>
  /** This node's punch ordinal within the cue (position in expectedPunches). */
  punchOrdinal?: number
}

export function PunchToken(props: PunchTokenProps): React.JSX.Element {
  const {
    number,
    body,
    state,
    handHint,
    size = 'stage',
    reducedMotion = false,
    affirmed = false,
  } = props
  const walked = props.walkOrdinal !== undefined && props.punchOrdinal !== undefined
  // Under worklet paint the base is always 'upcoming'; the overlays carry
  // active/completed. Without the SV, behaviour is byte-identical to before.
  const visual = STATE_VISUALS[walked ? 'upcoming' : state]
  const diameter = TOKEN_DIAMETER[size]

  const po = props.punchOrdinal ?? -2
  const ord = props.walkOrdinal
  const activeOverlay = useAnimatedStyle(() => ({
    opacity: ord !== undefined && po >= 0 && ord.value === po ? 1 : 0,
  }))
  const doneOverlay = useAnimatedStyle(() => ({
    opacity: ord !== undefined && po >= 0 && ord.value > po ? 1 : 0,
  }))

  const accessibilityLabel = [
    `Punch ${number}`,
    body ? 'to the body' : null,
    handHint ? (handHint === 'L' ? 'left hand' : 'right hand') : null,
    visual.label,
    // Named, not just tinted: the reward has to reach someone who cannot
    // see the glow (spec §19.4).
    affirmed ? 'good form' : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={[styles.root, body && styles.bodyPlacement]}
      testID={`punch-token-${number}${body ? 'b' : ''}`}
    >
      {/* Token slot — sized to include the active ring so the ring
          sits fully within the slot with symmetric space on every
          side rather than poking past its edges. alignItems /
          justifyContent 'center' pin every child (including the
          absolute rings and the circle itself) to the slot's centre. */}
      <View
        style={[
          styles.tokenSlot,
          {
            width: diameter + ACTIVE_RING_INSET * 2,
            height: diameter + ACTIVE_RING_INSET * 2,
          },
        ]}
      >
        {!walked && state === 'active' ? (
          <ActiveRing diameter={diameter} reducedMotion={reducedMotion} />
        ) : null}
        {walked ? (
          <>
            {/* ACTIVE — INVERTED interior (Kyle, on-glass sign-off of the
                static bold ring): solid accent fill with the number in
                background-ink, the exact colour swap of the resting node.
                The glyph lives INSIDE the overlay so the whole inversion is
                one UI-thread opacity flip — the base number underneath is
                simply covered. Pulse stays deliberately absent: the walk's
                motion is the animation. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.walkOverlay,
                styles.walkOverlayCenter,
                activeOverlay,
                {
                  width: diameter,
                  height: diameter,
                  borderRadius: diameter / 2,
                  borderWidth: STATE_VISUALS.active.borderWidth,
                  borderColor: STATE_VISUALS.active.borderColor,
                  backgroundColor: STATE_VISUALS.active.borderColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.number,
                  { fontSize: TOKEN_FONT_SIZE[size], color: colors.background },
                ]}
              >
                {number}
              </Text>
            </Animated.View>
            {/* COMPLETED — subdued fill, number kept legible in muted ink. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.walkOverlay,
                styles.walkOverlayCenter,
                doneOverlay,
                {
                  width: diameter,
                  height: diameter,
                  borderRadius: diameter / 2,
                  borderWidth: STATE_VISUALS.completed.borderWidth,
                  borderColor: STATE_VISUALS.completed.borderColor,
                  backgroundColor: STATE_VISUALS.completed.backgroundColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.number,
                  { fontSize: TOKEN_FONT_SIZE[size], color: STATE_VISUALS.completed.textColor },
                ]}
              >
                {number}
              </Text>
            </Animated.View>
          </>
        ) : null}

        <AffirmationRing
          diameter={diameter}
          active={affirmed}
          reducedMotion={reducedMotion}
          {...(props.affirmKey === undefined ? {} : { fireKey: props.affirmKey })}
        />

        <View
          style={[
            styles.circle,
            {
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              borderWidth: visual.borderWidth,
              borderColor: visual.borderColor,
              backgroundColor: visual.backgroundColor,
            },
            // The glow rides on top of whatever state the token is in, so a
            // completed token keeps its check and gains the gold.
            affirmed && styles.affirmedCircle,
          ]}
        >
          <Text
            style={[styles.number, { fontSize: TOKEN_FONT_SIZE[size], color: visual.textColor }]}
          >
            {number}
          </Text>

          {body ? (
            <View style={styles.bodyBadge} testID="body-badge">
              {/* Uppercase B is the on-screen badge only; serialized notation
                  stays lowercase `b` (D10). */}
              <Text style={styles.bodyBadgeText}>B</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Colour is never the only signal: the glow always comes with a
          glyph (spec §19.4). */}
      {affirmed ? (
        <Text style={styles.affirmedMarker} testID="affirmed-marker">
          ★
        </Text>
      ) : visual.marker ? (
        <Text style={[styles.marker, { color: visual.textColor }]} testID="state-marker">
          {visual.marker}
        </Text>
      ) : null}

      {handHint ? (
        <Text style={styles.handHint} testID="hand-hint">
          {handHint}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  walkOverlay: {
    position: 'absolute',
  },
  walkOverlayCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  /** Body shots sit lower on screen — the placement cue from doc §13. */
  bodyPlacement: { paddingTop: 24 },
  tokenSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    // The affirmation ring overshoots past the slot during its burst;
    // 'visible' ensures Android doesn't clip the reward animation.
    overflow: 'visible',
  },
  circle: { alignItems: 'center', justifyContent: 'center' },
  number: { fontWeight: '800' },
  bodyBadge: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyBadgeText: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  marker: { marginTop: 4, fontSize: 14, fontWeight: '700' },
  affirmedCircle: {
    borderColor: colors.gold,
    // A soft halo rather than a hard edge, so the token reads as lit
    // rather than merely outlined.
    shadowColor: colors.gold,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    elevation: 8,
  },
  affirmedMarker: { marginTop: 4, fontSize: 15, fontWeight: '800', color: colors.gold },
  handHint: { marginTop: 2, fontSize: 13, fontWeight: '700', color: colors.textMuted },
})
