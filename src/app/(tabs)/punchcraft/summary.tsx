/**
 * Workout summary (M33-08, doc §24).
 *
 * Renders what actually happened, from the realized stream and the
 * persisted cue results — never from the recipe (D8).
 *
 * Three rules shape the presentation:
 *
 * - **A short round is a result, not a verdict.** Nothing here scolds, and
 *   the count carries the D13 note that strikes below the tracker's
 *   sensing threshold are never transmitted — a low number is partly a
 *   statement about measurement.
 * - **Absent, never zero.** A figure nothing measured is omitted with its
 *   reason shown, because a zero reads as the athlete failing (D11).
 * - **Velocity is disclosed, not implied.** The representation line says
 *   what the numbers are, so a bare figure never suggests a physical
 *   measurement that was not made (spec §8.5, §4.3).
 */
import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'

import { CountBadge } from '@components/workout/CountBadge'
import { colors } from '@/theme/colors'
import type { WorkoutSummaryData } from '@domain/programs/workoutSummary'

export interface SummaryScreenProps {
  summary?: WorkoutSummaryData
}

/** Shown beside a short count. A measurement note, not a judgement (D13). */
export const SHORT_COUNT_NOTE =
  'The count is what the trackers registered. Strikes below their sensing threshold are not transmitted.'

function Metric(props: {
  label: string
  value: string
  caption?: string
  testID: string
}): React.JSX.Element {
  return (
    <View style={styles.metric} testID={props.testID}>
      <Text style={styles.metricLabel}>{props.label}</Text>
      <Text style={styles.metricValue}>{props.value}</Text>
      {props.caption ? <Text style={styles.metricCaption}>{props.caption}</Text> : null}
    </View>
  )
}

export default function SummaryScreen(props: SummaryScreenProps): React.JSX.Element {
  const router = useRouter()
  const summary = props.summary

  if (!summary) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.container}>
        <Stack.Screen options={{ title: 'Workout summary' }} />
        <Text style={styles.empty} testID="summary-empty">
          No workout to summarise yet.
        </Text>
      </ScrollView>
    )
  }

  const isShort = summary.grade.outcome === 'short'

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container} testID="summary-screen">
      <Stack.Screen options={{ title: 'Workout summary' }} />

      <Text style={styles.title}>{summary.recipeName}</Text>

      {/* The headline count reuses the same badge the round results use, so
          over / short / exact read identically everywhere (M33-03). */}
      <View style={styles.badgeRow}>
        <CountBadge
          actual={summary.totalPunches}
          target={summary.target}
          size="hero"
          {...(summary.handSequenceMatchPercent === undefined
            ? {}
            : {
                sequenceScore: {
                  pct: summary.handSequenceMatchPercent,
                  tier: summary.capabilityTier,
                },
              })}
        />
      </View>

      {isShort ? (
        <Text style={styles.note} testID="short-count-note">
          {SHORT_COUNT_NOTE}
        </Text>
      ) : null}

      <View style={styles.grid}>
        <Metric
          testID="summary-rounds"
          label="Rounds completed"
          value={`${summary.completedRounds}`}
        />
        <Metric
          testID="summary-rate"
          label="Average rate"
          value={`${summary.avgRatePerMin}/min`}
        />
        <Metric
          testID="summary-left-right"
          label="Left / right"
          value={`${summary.leftRightSplit.left} / ${summary.leftRightSplit.right}`}
        />
        <Metric
          testID="summary-extras"
          label="Extra punches"
          value={`${summary.extraPunches}`}
        />

        {/* Omitted entirely rather than shown as zero when nothing measured
            it (D11). */}
        {summary.avgVelocity === undefined ? null : (
          <Metric
            testID="summary-avg-velocity"
            label="Average velocity"
            value={`${summary.avgVelocity}`}
            caption="tracker-reported velocity"
          />
        )}
        {summary.peakVelocity === undefined ? null : (
          <Metric
            testID="summary-peak-velocity"
            label="Peak velocity"
            value={`${summary.peakVelocity}`}
            caption="tracker-reported velocity"
          />
        )}
      </View>

      {/* Spec §8.5: say what the numbers are rather than letting a bare
          figure imply a physical measurement. */}
      <Text style={styles.disclosure} testID="velocity-representation">
        {summary.velocityRepresentation}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>By round</Text>
        {summary.perRound.map((round) => (
          <View key={round.roundIndex} style={styles.roundRow} testID={`round-${round.roundIndex}`}>
            <Text style={styles.roundTheme}>{`${round.roundIndex + 1}. ${round.theme}`}</Text>
            <CountBadge actual={round.actual} target={round.target} size="compact" />
            <Text style={styles.roundSplit}>
              {`L ${round.leftRight.left} · R ${round.leftRight.right}`}
            </Text>
          </View>
        ))}
      </View>

      {summary.adaptationCount > 0 ? (
        <Text style={styles.note} testID="adaptation-note">
          {`The plan adapted ${summary.adaptationCount} time${summary.adaptationCount === 1 ? '' : 's'} to keep the workout reachable.`}
        </Text>
      ) : null}

      {/* Seed and versions are what make "run this exact workout again"
          (M36-01) possible, so they are shown rather than hidden. */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Reproducibility</Text>
        <Text style={styles.provenance} testID="summary-provenance">
          {`seed ${summary.seed} · generator ${summary.generatorVersion} · calculation ${summary.calculationVersion}`}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={styles.done}
        testID="summary-done"
      >
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
  badgeRow: { alignItems: 'flex-start' },
  empty: { fontSize: 16, color: colors.textSecondary },
  note: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  metric: { gap: 2, minWidth: 130 },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  metricValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  metricCaption: { fontSize: 10, color: colors.textMuted },
  disclosure: { fontSize: 12, lineHeight: 17, color: colors.textMuted, fontStyle: 'italic' },
  section: { gap: 8, marginTop: 4 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  roundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  roundTheme: { flex: 1, fontSize: 14, color: colors.textPrimary },
  roundSplit: { fontSize: 13, color: colors.textSecondary },
  provenance: { fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' },
  done: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  doneText: { fontSize: 16, fontWeight: '700', color: colors.textOnAccent },
})
