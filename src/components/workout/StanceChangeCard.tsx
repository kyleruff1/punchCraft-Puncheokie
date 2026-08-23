/**
 * Stance change card (M32-06, doc §13, doc §11).
 *
 * Full-width and high-contrast, because a stance change is the one
 * instruction that invalidates everything the athlete has built up about
 * which hand is which. It shows foot orientation explicitly rather than
 * relying on the word alone.
 *
 * A stance change only ever happens at a round boundary (doc §11), so this
 * card never appears mid-combination.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import type { Stance } from '@domain/workout/WorkoutTokens'

export interface StanceChangeCardProps {
  toStance: Stance
  countdownMs?: number
}

/** Which foot leads, spelled out — the actionable part of the instruction. */
const LEAD_FOOT: Record<Stance, string> = {
  orthodox: 'Left foot forward',
  southpaw: 'Right foot forward',
}

const STANCE_NAME: Record<Stance, string> = {
  orthodox: 'Orthodox',
  southpaw: 'Southpaw',
}

/** Foot diagram: filled marker is the lead foot. */
function FootRow({ toStance }: { toStance: Stance }): React.JSX.Element {
  const leadIsLeft = toStance === 'orthodox'
  return (
    <View style={styles.feet} testID="foot-orientation">
      <View style={[styles.foot, leadIsLeft ? styles.footLead : styles.footRear]}>
        <Text style={styles.footText}>L</Text>
      </View>
      <View style={[styles.foot, leadIsLeft ? styles.footRear : styles.footLead]}>
        <Text style={styles.footText}>R</Text>
      </View>
    </View>
  )
}

export function StanceChangeCard(props: StanceChangeCardProps): React.JSX.Element {
  const { toStance, countdownMs } = props
  const seconds = countdownMs === undefined ? undefined : Math.max(0, Math.ceil(countdownMs / 1000))

  return (
    <View
      accessibilityLabel={`Switch to ${STANCE_NAME[toStance]}. ${LEAD_FOOT[toStance]}.`}
      accessibilityRole="alert"
      style={styles.root}
      testID="stance-change-card"
    >
      <Text style={styles.kicker}>Switch stance</Text>
      <Text style={styles.stance}>{STANCE_NAME[toStance]}</Text>
      <FootRow toStance={toStance} />
      <Text style={styles.leadFoot}>{LEAD_FOOT[toStance]}</Text>
      {seconds !== undefined ? (
        <Text style={styles.countdown} testID="stance-countdown">
          {seconds}s
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    width: '100%',
    padding: 20,
    gap: 8,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
  },
  kicker: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  stance: { fontSize: 40, fontWeight: '800', color: colors.textPrimary },
  feet: { flexDirection: 'row', gap: 16, marginVertical: 4 },
  foot: {
    width: 52,
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  footLead: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  footRear: { borderColor: colors.border, backgroundColor: 'transparent' },
  footText: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  leadFoot: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  countdown: { fontSize: 22, fontWeight: '800', color: colors.accent },
})
