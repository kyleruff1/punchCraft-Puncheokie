/**
 * Cue stage — the dominant zone of the live layout (M32-07, doc §19).
 *
 * The current combination occupies most of the zone and stays fully visible
 * for its whole life, so the athlete can anticipate the rest of it rather
 * than being fed one token at a time. The next combination sits above,
 * smaller and dimmed: present enough to prepare for, quiet enough not to
 * compete with what is being thrown now.
 *
 * Presentational only — no store, engine or clock imports. Token visual
 * states arrive already resolved from the engine (M32-08 maps them).
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { CoachBanner } from './CoachBanner'
import { DefenseToken } from './DefenseToken'
import { FootworkToken } from './FootworkToken'
import { PunchToken } from './PunchToken'
import type { TokenVisualState } from './tokenVisuals'
import { colors } from '@/theme/colors'
import type { CueInstance } from '@domain/programs/CueTimeline'
import type { WorkoutToken } from '@domain/workout/WorkoutTokens'

export interface CueView {
  cue: CueInstance
  /** One state per entry in `cue.tokens`, same order. */
  tokenStates: TokenVisualState[]
  /**
   * How many repeats this block prescribes in total.
   *
   * Additive to the binding interface: `CueInstance` carries `repeatIndex`
   * but not the total, so "×N" and the dot stack are unrenderable without
   * it. M32-08 supplies it by counting the cues sharing a `blockId`.
   */
  repeatTotal?: number
}

export interface CueStageProps {
  current?: CueView
  next?: CueView
  reducedMotion?: boolean
}

/** Hand letter for a punch token, taken from the resolved expectations. */
function handHintFor(cue: CueInstance, tokenIndex: number): 'L' | 'R' | undefined {
  const expected = cue.expectedPunches.find((p) => p.tokenIndex === tokenIndex)
  if (!expected) return undefined
  return expected.hand === 'left' ? 'L' : 'R'
}

function renderToken(
  token: WorkoutToken,
  index: number,
  cue: CueInstance,
  state: TokenVisualState,
  size: 'stage' | 'preview',
  reducedMotion: boolean,
): React.JSX.Element | null {
  const key = `${cue.id}-${index}`
  switch (token.kind) {
    case 'punch':
      return (
        <PunchToken
          key={key}
          number={token.number}
          body={token.body}
          state={state}
          {...(handHintFor(cue, index) ? { handHint: handHintFor(cue, index)! } : {})}
          size={size}
          reducedMotion={reducedMotion}
        />
      )
    case 'defense':
      return (
        <DefenseToken
          key={key}
          command={token.command}
          state={state}
          size={size}
          reducedMotion={reducedMotion}
        />
      )
    case 'footwork':
      return (
        <FootworkToken
          key={key}
          command={token.command}
          state={state}
          size={size}
          reducedMotion={reducedMotion}
        />
      )
    // Coach calls are banners, not tokens — rendered below the row so they
    // stay subordinate to the commands being thrown (doc §13).
    default:
      return null
  }
}

/**
 * Repeat treatment: "×N" plus a dot stack that fills as repeats complete,
 * so progress through a repeated block is legible without counting.
 */
function RepeatIndicator(props: { repeatIndex: number; repeatTotal: number }): React.JSX.Element {
  const { repeatIndex, repeatTotal } = props
  return (
    <View style={styles.repeat} testID="repeat-indicator">
      <Text style={styles.repeatLabel}>{`×${repeatTotal}`}</Text>
      <View style={styles.dots}>
        {Array.from({ length: repeatTotal }, (_, i) => (
          <View
            key={i}
            style={[styles.dot, i <= repeatIndex ? styles.dotFilled : styles.dotEmpty]}
            testID={i <= repeatIndex ? 'repeat-dot-filled' : 'repeat-dot-empty'}
          />
        ))}
      </View>
    </View>
  )
}

function CueRow(props: {
  view: CueView
  size: 'stage' | 'preview'
  reducedMotion: boolean
  testID: string
}): React.JSX.Element {
  const { view, size, reducedMotion, testID } = props
  const { cue } = view
  const coachTokens = cue.tokens.filter((t) => t.kind === 'coach')

  return (
    <View style={styles.cueRow} testID={testID}>
      <View style={styles.tokens}>
        {cue.tokens.map((token, index) =>
          renderToken(
            token,
            index,
            cue,
            view.tokenStates[index] ?? 'upcoming',
            size,
            reducedMotion,
          ),
        )}
      </View>

      {view.repeatTotal !== undefined && view.repeatTotal > 1 ? (
        <RepeatIndicator repeatIndex={cue.repeatIndex} repeatTotal={view.repeatTotal} />
      ) : null}

      {coachTokens.map((token, i) =>
        token.kind === 'coach' ? (
          <CoachBanner key={`${cue.id}-coach-${i}`} command={token.command} visible />
        ) : null,
      )}
    </View>
  )
}

export function CueStage(props: CueStageProps): React.JSX.Element {
  const { current, next, reducedMotion = false } = props

  return (
    <View style={styles.root} testID="cue-stage">
      <View style={styles.nextZone}>
        {next ? (
          <>
            <Text style={styles.nextLabel}>Next</Text>
            <View style={styles.nextDim}>
              <CueRow
                view={next}
                size="preview"
                reducedMotion={reducedMotion}
                testID="cue-stage-next"
              />
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.currentZone}>
        {current ? (
          <CueRow
            view={current}
            size="stage"
            reducedMotion={reducedMotion}
            testID="cue-stage-current"
          />
        ) : (
          <Text style={styles.idle} testID="cue-stage-idle">
            Ready
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  nextZone: { minHeight: 90, alignItems: 'center', justifyContent: 'flex-start', gap: 2 },
  nextLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  // Dimmed rather than hidden: preparable, but not competing with the
  // combination currently being thrown.
  nextDim: { opacity: 0.55 },
  currentZone: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cueRow: { alignItems: 'center', gap: 8 },
  tokens: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  repeat: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  repeatLabel: { fontSize: 20, fontWeight: '800', color: colors.textSecondary },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  dotFilled: { backgroundColor: colors.accent, borderColor: colors.accent },
  dotEmpty: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
  idle: { fontSize: 28, fontWeight: '700', color: colors.textMuted },
})
