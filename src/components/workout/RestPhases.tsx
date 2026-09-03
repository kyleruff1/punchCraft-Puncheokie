/**
 * The rest screen and its three presentation phases (M33-04, doc §23, D6).
 *
 * At the bell the round's numbers stop moving and this takes the stage for
 * the whole rest interval. It renders one of three views chosen purely by
 * how far through the rest the clock is (`restPhaseAt`); the session stays
 * in a single `rest` state throughout (spec §18.1), and there is exactly one
 * skip control, because there is exactly one thing to skip (D6).
 *
 * ## Three phases you can tell apart in greyscale
 *
 * Spec §19.4 forbids colour-only signalling, and "which part of the rest am
 * I in" is a state like any other. Every phase differs on four
 * non-colour signals at once:
 *
 * 1. a different **heading word** — `ROUND RESULT` / `RECOVER` / `NEXT ROUND`;
 * 2. a different **glyph** — `◆` / `≈` / `»`, three different shapes;
 * 3. a different **step marker** — `▮▯▯` / `▯▮▯` / `▯▯▮`, filled position; and
 * 4. entirely different **content**.
 *
 * Nothing here tints the chrome per phase at all, so there is no colour to
 * remove. `RestPhases.test.tsx` strips every colour from the tree and
 * asserts the three renders are still three distinguishable things.
 *
 * ## Nothing here scolds
 *
 * A short round is a result, not a failure (doc §21). The badge already
 * refuses verdict words; this screen adds the reason a low count may not be
 * read as the athlete's: the trackers transmit nothing below an
 * acceleration floor, so a soft strike and an unthrown one are the same
 * absence of evidence (D13). `SHORT_ROUND_NOTE` says that, once, calmly.
 * The `trackerDropped` warning is the same idea for a different cause.
 *
 * ## Calm, not a dashboard
 *
 * Rest is where the athlete catches their breath. Each phase carries at
 * most a handful of large lines, readable from arm's length at the bag —
 * the full statistics belong to the workout summary (M33-08).
 *
 * ## No audio
 *
 * `onAnnounce` is a port-shaped hook, called once when a phase becomes
 * current. It is silent by default and this component never speaks: the
 * Voice Coach arrives in M34 behind the D1 gate (spec §13.5).
 *
 * Presentational only — no store, engine or clock imports. Elapsed time and
 * the frozen result are both handed in.
 */
import React, { useEffect, useRef } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'

import { formatCountdown } from './RoundTopBar'
import { colors } from '@/theme/colors'
import { gradeAccessibilityText, gradeRound } from '@domain/programs/roundGrading'
import {
  REST_PHASE_ORDER,
  restPhaseAt,
  restPhaseStep,
  type FrozenRoundResult,
  type RestPhase,
} from '@domain/session/restPhases'
import type { Stance } from '@domain/workout/WorkoutTokens'

export interface RestNextRound {
  theme: string
  stance: Stance
  /** Two, per doc §23. More are accepted and the first two are shown. */
  sampleCombos: string[]
}

export interface RestAnnouncement {
  phase: RestPhase
  text: string
}

export interface RestPhasesProps {
  frozen: FrozenRoundResult
  /**
   * Absent after the final round — the clock still runs that round's rest,
   * and there is no next round to preview. A deviation from #190's
   * interface block, which types this as required.
   */
  nextRound?: RestNextRound
  restElapsedMs: number
  restDurationMs: number
  onSkipRest: () => void
  /** Disables the breathing animation (doc §25). */
  reducedMotion?: boolean
  /** Voice Coach port hook. Silent until M34-05. */
  onAnnounce?: (announcement: RestAnnouncement) => void
  /**
   * Pre-bell hold indicator (Script Bible v2, Kyle 2026-09-01): the next
   * round's opening bar, visible through ALL rest sub-phases (the preview
   * sub-phase alone left the athlete guessing until the last quarter).
   * Notation strings — '1', '2b', '.' for a rest slot.
   */
  upNext?: { tokens: readonly string[]; rateWord?: string }
}

const STANCE_LABEL: Record<Stance, string> = {
  orthodox: 'Orthodox',
  southpaw: 'Southpaw',
}

interface PhaseChrome {
  heading: string
  /** Survives greyscale and names a different shape per phase. */
  glyph: string
  glyphLabel: string
}

const PHASE_CHROME: Record<RestPhase, PhaseChrome> = {
  result: { heading: 'ROUND RESULT', glyph: '◆', glyphLabel: 'result' },
  recovery: { heading: 'RECOVER', glyph: '≈', glyphLabel: 'recovery' },
  preview: { heading: 'NEXT ROUND', glyph: '»', glyphLabel: 'next round' },
}

/**
 * The D13 sentence. States what the count is a measurement of, and stops.
 *
 * No verdict word, and in particular no "only", "missed" or "failed": the
 * count is evidence the trackers produced, not a report on the athlete.
 */
export const SHORT_ROUND_NOTE =
  'The count is what the trackers registered. Strikes below their sensing threshold are not transmitted.'

/** Shown whenever a glove was not streaming for part of the round. */
export const TRACKER_DROPPED_NOTE =
  'A glove dropped out during this round, so some punches were never received.'

const BREATH_IN_MS = 4_000
const BREATH_OUT_MS = 4_000
const BREATH_DIAMETER = 132

// ---------------------------------------------------------------------------

/**
 * What the Voice Coach would say on entering this phase (doc §23).
 *
 * Pure and exported so the wording is testable without rendering, and so
 * the spoken line and the accessible line cannot drift apart. Numerals stay
 * numerals — turning 246 into "two hundred forty-six" is the speech
 * engine's job, not this module's.
 */
export function restAnnouncementText(
  phase: RestPhase,
  frozen: FrozenRoundResult,
  nextRound?: RestNextRound,
): string {
  switch (phase) {
    case 'result': {
      const parts = [
        `Round ${frozen.roundIndex + 1} complete.`,
        gradeAccessibilityText(frozen.actual, frozen.target),
      ]
      if (frozen.avgVelocity) {
        parts.push(
          `Average ${Math.round(frozen.avgVelocity.value)} ${frozen.avgVelocity.label}.`,
        )
      }
      return parts.join(' ')
    }
    case 'recovery': {
      const parts = ['Recover.', `Left ${frozen.left}, right ${frozen.right}.`]
      if (frozen.trackerDropped) parts.push(TRACKER_DROPPED_NOTE)
      return parts.join(' ')
    }
    case 'preview':
      return nextRound
        ? `Next round: ${nextRound.theme}. ${STANCE_LABEL[nextRound.stance]} stance.`
        : 'Last round complete.'
  }
}

// ---------------------------------------------------------------------------

function StepMarker(props: { phase: RestPhase }): React.JSX.Element {
  const step = restPhaseStep(props.phase)
  const marker = REST_PHASE_ORDER.map((_, index) => (index + 1 === step ? '▮' : '▯')).join('')
  return (
    <Text
      accessibilityLabel={`Rest phase ${step} of ${REST_PHASE_ORDER.length}`}
      style={styles.stepMarker}
      testID="rest-step-marker"
    >
      {marker}
    </Text>
  )
}

/**
 * Doc §23's "heart-rate-style breathing animation, if desired".
 *
 * Slow on purpose — a four-second in and a four-second out is a pace worth
 * following, where a decorative pulse is just motion. With reduced motion
 * the circle is still and the word carries it (doc §25).
 */
function BreathingCircle(props: { reducedMotion: boolean }): React.JSX.Element {
  const breath = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (props.reducedMotion) return undefined
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: BREATH_IN_MS, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: BREATH_OUT_MS, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => {
      loop.stop()
    }
  }, [breath, props.reducedMotion])

  const style = props.reducedMotion
    ? undefined
    : {
        transform: [
          { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
        ],
        opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
      }

  return (
    <Animated.View
      accessibilityLabel="Breathe"
      pointerEvents="none"
      style={[styles.breath, style]}
      testID={props.reducedMotion ? 'rest-breath-static' : 'rest-breath-animated'}
    >
      <Text style={styles.breathText}>Breathe</Text>
    </Animated.View>
  )
}

function Line(props: { label: string; value: string; testID: string }): React.JSX.Element {
  return (
    <View style={styles.line} testID={props.testID}>
      <Text style={styles.lineLabel}>{props.label}</Text>
      <Text style={styles.lineValue}>{props.value}</Text>
    </View>
  )
}

/**
 * One tile on the round grade card.
 *
 * Same shape whether the value is a number, absent (rendered as the em-dash
 * D11 requires) or `undefined`. `sub` is the small line under the value,
 * used by the velocity tiles to name the unit and by the precision tile to
 * carry its capability caveat without shrinking the number.
 */
function GradeTile(props: {
  label: string
  value: string
  sub?: string
  testID: string
}): React.JSX.Element {
  return (
    <View style={styles.gradeTile} testID={props.testID}>
      <Text style={styles.gradeTileLabel} numberOfLines={1}>
        {props.label}
      </Text>
      <Text style={styles.gradeTileValue} numberOfLines={1} adjustsFontSizeToFit>
        {props.value}
      </Text>
      {props.sub ? (
        <Text style={styles.gradeTileSub} numberOfLines={2}>
          {props.sub}
        </Text>
      ) : null}
    </View>
  )
}

// ---------------------------------------------------------------------------

/**
 * Round grade — four tiles, one row (D25).
 *
 * Punches thrown / max velocity / avg velocity / precision. The four numbers
 * are the whole read: this is not a summary of the workout, it is the four
 * things the athlete wants to know before the next round.
 *
 * Absence and truth: velocity tiles read `—` when the tracker sent no
 * readings (D11 — absent, never a false zero). Precision reads its plain
 * count and carries a small caveat when the number is zero, since a zero
 * there is ambiguous on the FightCamp v1 hardware — the tracker cannot
 * confirm every technique, so the athlete may have thrown all the right
 * shots and had none of them land on a confirmable byte (H12).
 */
function ResultView(props: {
  frozen: FrozenRoundResult
}): React.JSX.Element {
  const { frozen } = props
  const outcome = gradeRound(frozen.actual, frozen.target).outcome
  // Two-decimal for a "precise reading" look on the grade tiles (Kyle
  // 2026-09-02). The spoken accessibility text at line 158 still uses
  // Math.round — TTS reading "sixty-eight" beats "sixty-eight point
  // four zero" — this helper is displayed-text only.
  const round = (n: number): string => n.toFixed(2)

  return (
    <View style={styles.body} testID="rest-phase-result">
      <View style={styles.gradeRow} testID="rest-grade-row">
        <GradeTile
          testID="grade-punches"
          label="Punches"
          value={String(frozen.actual)}
          sub={`Target ${frozen.target}`}
        />
        <GradeTile
          testID="grade-max-velocity"
          label="Max velocity"
          value={frozen.bestVelocity ? round(frozen.bestVelocity.value) : '—'}
          sub={frozen.bestVelocity ? 'tracker units' : 'no reading'}
        />
        <GradeTile
          testID="grade-avg-velocity"
          label="Avg velocity"
          value={frozen.avgVelocity ? round(frozen.avgVelocity.value) : '—'}
          sub={frozen.avgVelocity ? 'tracker units' : 'no reading'}
        />
        <GradeTile
          testID="grade-precision"
          label="Precision"
          value={String(frozen.precision)}
          sub={
            frozen.precision === 0
              ? 'this hardware only confirms some techniques'
              : 'correct hand and type'
          }
        />
      </View>

      {outcome === 'short' ? (
        <Text style={styles.note} testID="rest-short-note">
          {SHORT_ROUND_NOTE}
        </Text>
      ) : null}
    </View>
  )
}

function RecoveryView(props: {
  frozen: FrozenRoundResult
  reducedMotion: boolean
}): React.JSX.Element {
  const { frozen, reducedMotion } = props
  // Doc §23 asks for "best combo or best velocity". The per-combination
  // results belong to M33-08, so velocity is what this can honestly show.
  const best = frozen.bestCombo
    ? { label: 'Best combination', value: frozen.bestCombo }
    : frozen.bestVelocity
      ? {
          label: `Best ${frozen.bestVelocity.label}`,
          value: frozen.bestVelocity.value.toFixed(2),
        }
      : undefined

  return (
    <View style={styles.body} testID="rest-phase-recovery">
      <BreathingCircle reducedMotion={reducedMotion} />
      <Line
        testID="rest-balance"
        label="Left / right"
        value={`${frozen.left} / ${frozen.right}`}
      />
      {best ? <Line testID="rest-best" label={best.label} value={best.value} /> : null}
      {frozen.trackerDropped ? (
        <Text style={styles.note} testID="rest-tracker-dropped">
          {`⚠ ${TRACKER_DROPPED_NOTE}`}
        </Text>
      ) : null}
    </View>
  )
}

function PreviewView(props: { nextRound?: RestNextRound }): React.JSX.Element {
  const { nextRound } = props

  if (!nextRound) {
    return (
      <View style={styles.body} testID="rest-phase-preview">
        <Text style={styles.previewTheme} testID="rest-next-theme">
          Last round complete
        </Text>
      </View>
    )
  }

  const combos = nextRound.sampleCombos.slice(0, 2)

  return (
    <View style={styles.body} testID="rest-phase-preview">
      <Text style={styles.previewTheme} testID="rest-next-theme">
        {nextRound.theme}
      </Text>
      <Line testID="rest-next-stance" label="Stance" value={STANCE_LABEL[nextRound.stance]} />
      {combos.length > 0 ? (
        <View style={styles.comboRow} testID="rest-sample-combos">
          {combos.map((combo, index) => (
            <Text key={`${combo}-${index}`} style={styles.combo} testID={`rest-sample-combo-${index}`}>
              {combo}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  )
}

// ---------------------------------------------------------------------------

export function RestPhases(props: RestPhasesProps): React.JSX.Element {
  const {
    frozen,
    nextRound,
    restElapsedMs,
    restDurationMs,
    onSkipRest,
    reducedMotion = false,
    onAnnounce,
  } = props

  const phase = restPhaseAt(restElapsedMs, restDurationMs)
  const chrome = PHASE_CHROME[phase]
  const remainingMs = Math.max(0, restDurationMs - restElapsedMs)

  // One call per phase entry, through the port and nowhere else. The ref
  // guard is what makes it once-per-phase rather than once-per-render: this
  // component re-renders roughly ten times a second while the clock runs.
  const announcedRef = useRef<RestPhase | null>(null)
  useEffect(() => {
    if (!onAnnounce) return
    if (announcedRef.current === phase) return
    announcedRef.current = phase
    onAnnounce({ phase, text: restAnnouncementText(phase, frozen, nextRound) })
  }, [frozen, nextRound, onAnnounce, phase])

  return (
    <View style={styles.root} testID="rest-phases">
      <View style={styles.header} testID="rest-header">
        <StepMarker phase={phase} />
        <Text
          accessibilityLabel={chrome.glyphLabel}
          style={styles.glyph}
          testID="rest-phase-glyph"
        >
          {chrome.glyph}
        </Text>
        <Text style={styles.heading} testID="rest-phase-heading">
          {chrome.heading}
        </Text>
        <Text style={styles.countdown} testID="rest-countdown">
          {formatCountdown(remainingMs)}
        </Text>
      </View>

      {props.upNext ? (
        <View style={styles.upNextRow} testID="rest-upnext">
          <Text style={styles.upNextLabel}>Up next</Text>
          {props.upNext.tokens.map((t, i) => (
            <View key={i} style={[styles.upNextPill, t === '.' && styles.upNextRest]}>
              <Text style={[styles.upNextPillText, t === '.' && styles.upNextRestText]}>
                {t === '.' ? '·' : t}
              </Text>
            </View>
          ))}
          {props.upNext.rateWord ? (
            <Text style={styles.upNextRate}>{props.upNext.rateWord}</Text>
          ) : null}
        </View>
      ) : null}

      {phase === 'result' ? <ResultView frozen={frozen} /> : null}
      {phase === 'recovery' ? (
        <RecoveryView frozen={frozen} reducedMotion={reducedMotion} />
      ) : null}
      {phase === 'preview' ? (
        <PreviewView {...(nextRound ? { nextRound } : {})} />
      ) : null}

      {/* One control, because there is one rest state (D6). Nothing here
          skips a single sub-phase — there is no such thing to skip. */}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Ends the rest and starts the next round"
        onPress={onSkipRest}
        style={styles.skip}
        testID="rest-skip"
      >
        <Text style={styles.skipText}>Skip rest</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingVertical: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upNextRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'nowrap' },
  upNextLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginRight: 4,
  },
  upNextPill: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upNextRest: { borderColor: colors.borderStrong, borderStyle: 'dashed' },
  upNextPillText: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  upNextRestText: { color: colors.textMuted },
  upNextRate: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  stepMarker: { fontSize: 14, letterSpacing: 3, color: colors.textMuted },
  glyph: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  heading: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.textSecondary,
  },
  countdown: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  body: { alignItems: 'center', gap: 14 },
  line: { alignItems: 'center', gap: 2 },
  lineLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  lineValue: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  gradeRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    gap: 12,
    maxWidth: 720,
  },
  gradeTile: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: colors.surface,
    minWidth: 96,
  },
  gradeTileLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  gradeTileValue: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    lineHeight: 40,
  },
  gradeTileSub: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Deliberately not tinted: a warning colour here would make the note the
  // loudest thing on a rest screen (doc §21).
  note: {
    maxWidth: 420,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  breath: {
    width: BREATH_DIAMETER,
    height: BREATH_DIAMETER,
    borderRadius: BREATH_DIAMETER / 2,
    borderWidth: 3,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breathText: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  previewTheme: { fontSize: 30, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  comboRow: { flexDirection: 'row', gap: 12 },
  combo: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.textPrimary,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  skip: {
    minHeight: 52,
    minWidth: 160,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
})
