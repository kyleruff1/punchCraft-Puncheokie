/**
 * Button lab — dev-only comparison bench for the ActionLabel art.
 *
 * The silver-metal + cyan-glow label art was authored for a dark ground
 * and drowns on the bright turquoise primary fill. This screen renders
 * both labels on a row of candidate base gradients so Kyle can pick the
 * winner on the tablet instead of iterating one guess per reload.
 *
 * Reach it at `punchcraft://dev/button-lab` (or type /dev/button-lab in
 * the dev-client URL bar). Not linked from any athlete-facing surface.
 * Once a winner is picked, its stops get encoded into ForgedButton's
 * variant table and this screen keeps living here for the next art drop.
 */
import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

import { ActionLabel } from '@/components/branding/ActionLabel'
import { colors, punch } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'

interface Candidate {
  name: string
  stops: [string, string, string]
  bevelTop: string
  bevelBottom: string
}

const CANDIDATES: Candidate[] = [
  {
    name: 'A — bright primary (current primary)',
    stops: [punch.aqua, punch.turquoise, punch.tealDeep],
    bevelTop: punch.aqua,
    bevelBottom: punch.tealBlack,
  },
  {
    name: 'B — dark forged (current hero)',
    stops: [punch.gunmetal, punch.charcoal, punch.tealBlack],
    bevelTop: punch.turquoise,
    bevelBottom: punch.tealDark,
  },
  {
    name: 'C — deep turquoise (#15949C family)',
    stops: [punch.turquoiseMid, punch.tealDark, punch.tealDeep],
    bevelTop: punch.turquoise,
    bevelBottom: punch.tealBlack,
  },
  {
    name: 'D — dark teal',
    stops: [punch.tealDark, punch.tealDeep, punch.tealBlack],
    bevelTop: punch.turquoiseMid,
    bevelBottom: punch.tealBlack,
  },
  {
    name: 'E — steel',
    stops: [punch.slate, punch.steel, punch.gunmetal],
    bevelTop: punch.silver,
    bevelBottom: punch.tealBlack,
  },
  {
    name: 'F — midnight, aqua edge',
    stops: [punch.charcoal, punch.tealBlack, punch.tealBlack],
    bevelTop: punch.aqua,
    bevelBottom: punch.tealDark,
  },
]

function LabRow({ candidate }: { candidate: Candidate }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowName}>{candidate.name}</Text>
      <LinearGradient
        colors={candidate.stops}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[
          styles.slab,
          { borderTopColor: candidate.bevelTop, borderBottomColor: candidate.bevelBottom },
        ]}
      >
        <ActionLabel action="buildAWorkout" size="md" />
      </LinearGradient>
      <LinearGradient
        colors={candidate.stops}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[
          styles.slab,
          { borderTopColor: candidate.bevelTop, borderBottomColor: candidate.bevelBottom },
        ]}
      >
        <ActionLabel action="startWorkout" size="md" />
      </LinearGradient>
    </View>
  )
}

export default function ButtonLab(): React.JSX.Element {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Action-label base colour lab</Text>
      <Text style={styles.hint}>
        Both labels on each candidate base. Pick the one where the silver lettering pops and the
        cyan glow still reads.
      </Text>
      {CANDIDATES.map((candidate) => (
        <LabRow key={candidate.name} candidate={candidate} />
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 20, paddingBottom: 48 },
  title: {
    fontSize: sizes.title,
    fontFamily: fonts.heading,
    color: colors.textPrimary,
  },
  hint: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  row: { gap: 8 },
  rowName: {
    fontSize: sizes.label,
    fontFamily: fonts.label,
    color: colors.textMuted,
  },
  slab: {
    borderRadius: 10,
    borderTopWidth: 1,
    borderBottomWidth: 2,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
  },
})
