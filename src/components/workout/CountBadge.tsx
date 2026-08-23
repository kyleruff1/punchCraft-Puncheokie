/**
 * Round count badge (M33-03, doc §23).
 *
 * The primary round result: a large circular badge carrying the achieved
 * count against the target, reused verbatim on the rest screen (M33-04) and
 * the workout summary (M33-08).
 *
 * ## This is the one place red is allowed
 *
 * `tokenVisuals` refuses `colors.danger` outright, because doc §13/§21
 * forbid a red flash mid-combination. A round *result* is different: the
 * round is over, the athlete is at rest, and the number is frozen. So the
 * short state may be red — and precisely because it may, the badge is built
 * so that colour is never load-bearing (spec §19.4):
 *
 * - each outcome has its **own glyph** (▲ / ▼ / ◎), and
 * - each outcome has its **own words** (`+6 OVER` / `19 SHORT` /
 *   `EXACT TARGET`), and
 * - the count line itself (`221 / 240`) already states the result.
 *
 * Delete every colour from the tree and the three states are still three
 * different things. `CountBadge.test.tsx` asserts exactly that by walking
 * the rendered tree with colour stripped.
 *
 * ## Counts only, and no letter grades
 *
 * The badge grades punch count. It never grades technique, and it never
 * renders A/B/C — doc §23's decision is that the count target is the
 * objective result. The optional `sequenceScore` caption takes its wording
 * from `sequenceScoreLabel`, so on FightCamp v1 it reads "hand-sequence
 * match" and cannot be talked into "technique accuracy" (D4, spec §13.3).
 *
 * Presentational only — no store, engine or clock imports. All grading is
 * `@domain/programs/roundGrading`.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import {
  gradeAccessibilityText,
  gradeCountText,
  gradeRound,
  gradeStatusText,
  type RoundOutcome,
} from '@domain/programs/roundGrading'
import { sequenceScoreLabel, type CapabilityTier } from '@domain/workout/capabilityTier'

export type CountBadgeSize = 'hero' | 'compact'

export interface OutcomeVisual {
  /** Doc §23 tint. Reinforces the glyph and the words; never carries them. */
  tint: string
  /** Survives greyscale and a colour-blind reader. */
  icon: string
  /** Names the glyph for assistive technology. */
  iconLabel: string
}

/**
 * Three tints, three glyphs, three shapes of glyph. The pair (icon, status
 * text) is unique per outcome on its own, so the tint is the third signal
 * rather than the first.
 */
export const OUTCOME_VISUALS: Record<RoundOutcome, OutcomeVisual> = {
  over: { tint: colors.success, icon: '▲', iconLabel: 'up' },
  short: { tint: colors.danger, icon: '▼', iconLabel: 'down' },
  exact: { tint: colors.gold, icon: '◎', iconLabel: 'target' },
}

const DIAMETER: Record<CountBadgeSize, number> = {
  // Read from a few feet away on a rest screen, so it is much larger than a
  // cue token; the compact form is for a summary row.
  hero: 200,
  compact: 112,
}

const COUNT_FONT_SIZE: Record<CountBadgeSize, number> = { hero: 34, compact: 18 }
const STATUS_FONT_SIZE: Record<CountBadgeSize, number> = { hero: 20, compact: 13 }
const BORDER_WIDTH: Record<CountBadgeSize, number> = { hero: 6, compact: 4 }

export interface CountBadgeProps {
  actual: number
  target: number
  size?: CountBadgeSize
  /**
   * Optional hand-pattern score shown under the badge.
   *
   * Additive to the #189 interface block: the acceptance criteria require
   * that *any* adjacent sequence-score text be labelled by tier, and the
   * only way to guarantee that is to own the rendering here rather than let
   * each caller compose its own string.
   */
  sequenceScore?: { pct: number; tier: CapabilityTier }
}

export function CountBadge(props: CountBadgeProps): React.JSX.Element {
  const { actual, target, size = 'hero', sequenceScore } = props

  const grade = gradeRound(actual, target)
  const visual = OUTCOME_VISUALS[grade.outcome]
  const statusText = gradeStatusText(grade)
  const countText = gradeCountText(actual, target)
  const diameter = DIAMETER[size]

  const accessibilityLabel = [
    gradeAccessibilityText(actual, target),
    sequenceScore ? `${sequenceScore.pct}% ${sequenceScoreLabel(sequenceScore.tier)}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={styles.root}
      testID="count-badge"
    >
      <View
        style={[
          styles.circle,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            borderWidth: BORDER_WIDTH[size],
            borderColor: visual.tint,
          },
        ]}
        testID={`count-badge-circle-${grade.outcome}`}
      >
        <Text style={[styles.count, { fontSize: COUNT_FONT_SIZE[size] }]} testID="count-badge-count">
          {countText}
        </Text>
      </View>

      {/* Glyph and words are siblings and both always render: either one
          alone would make the tint necessary to read the result. */}
      <View style={styles.statusRow} testID="count-badge-status-row">
        <Text
          style={[styles.icon, { color: visual.tint, fontSize: STATUS_FONT_SIZE[size] }]}
          testID="count-badge-icon"
        >
          {visual.icon}
        </Text>
        <Text
          style={[styles.status, { color: visual.tint, fontSize: STATUS_FONT_SIZE[size] }]}
          testID="count-badge-status"
        >
          {statusText}
        </Text>
      </View>

      {sequenceScore ? (
        <Text style={styles.sequenceScore} testID="count-badge-sequence-score">
          {`${sequenceScore.pct}% ${sequenceScoreLabel(sequenceScore.tier)}`}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 10 },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  count: {
    color: colors.textPrimary,
    fontWeight: '700',
    // Tabular-ish: the count changes between rounds and a jittering baseline
    // on the rest screen reads as instability.
    letterSpacing: 1,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { fontWeight: '700', lineHeight: 24 },
  status: { fontWeight: '700', letterSpacing: 1.5 },
  sequenceScore: { color: colors.textSecondary, fontSize: 12 },
})
