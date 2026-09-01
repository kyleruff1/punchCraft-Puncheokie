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
import { ComboFlourish } from './ComboFlourish'
import { DefenseToken } from './DefenseToken'
import { FootworkToken } from './FootworkToken'
import { RestSlot } from './RestSlot'
import type { SharedValue } from 'react-native-reanimated'

import { PunchAvatarCard } from './PunchAvatarCard'
import { useRingBeatClock, type RingBeatCue } from './useRingBeatClock'
import type { SharedTransportAnchor } from '@domain/timing/SharedTransportAnchor'
import type { SharedWorkClock } from '@domain/timing/SharedWorkClock'
import { PunchToken } from './PunchToken'
import { visibleBar, type TokenVisualState } from './tokenVisuals'
import { colors } from '@/theme/colors'
import { fonts, sizes, weights } from '@/theme/typography'
import type { CueInstance } from '@domain/programs/CueTimeline'
import type { WorkoutToken } from '@domain/workout/WorkoutTokens'
import { logger, safe } from '@/diagnostics/logger'

export interface CueView {
  cue: CueInstance
  /** One state per entry in `cue.tokens`, same order. */
  tokenStates: TokenVisualState[]
  /**
   * Token indexes whose punch earned the form affirmation — landed with
   * the right hand AND a device-local type byte that agreed with the
   * prescribed technique. Reward only; absence is never rendered.
   */
  affirmedTokenIndexes?: number[]
  /**
   * How many repeats this block prescribes in total.
   *
   * Additive to the binding interface: `CueInstance` carries `repeatIndex`
   * but not the total, so "×N" and the dot stack are unrenderable without
   * it. M32-08 supplies it by counting the cues sharing a `blockId`.
   */
  repeatTotal?: number
  /**
   * A presentation identity stable across the reps of a block. When present it
   * keys the token nodes instead of `cue.id`, so a repeated combo stays mounted
   * — shown once with an advancing counter rather than re-animating each rep
   * (doc §14, §19.2). Falls back to `cue.id` when absent.
   */
  presentationKey?: string
  /**
   * Set (to a value that changes per completion) when this combination was just
   * completed in sequence with the correct hands — fires the whole-combo
   * flourish. Absent for an incomplete combo, which celebrates nothing.
   */
  comboCompleteKey?: string
}

export interface CueStageProps {
  current?: CueView
  next?: CueView
  reducedMotion?: boolean
  /**
   * What the empty stage says. 'Ready' before the first cue; the runner
   * passes a free-work line when the round has no further cues scheduled,
   * so the athlete keeps working instead of reading a frozen combination.
   */
  idleLabel?: string
  /**
   * Optional shared transport anchor (M39-V2 Phase W0-b-iii, Kyle
   * 2026-08-30). Passed through to `PunchAvatarCard`, which uses it
   * to drive its flip from a `useFrameCallback` worklet instead of
   * a JS `setInterval`. Absent (test doubles, screens predating
   * W0) → the card falls back to the setInterval path.
   */
  avatarAnchor?: SharedValue<SharedTransportAnchor>
  /**
   * UI-thread work clock (MVP v2, GH #305). When present, the active
   * sequence cue's beat cursor is projected per frame by
   * `useRingBeatClock` instead of waiting on the JS tick. Absent →
   * props-supplied tokenStates render untouched (tests, legacy screens).
   */
  workClock?: SharedValue<SharedWorkClock>
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
  affirmed: boolean,
  presentationKey: string,
): React.JSX.Element | null {
  // React identity is block-stable so a repeated combo does not remount each
  // rep; the affirmation re-trigger stays rep-varying (`cue.id` changes per
  // rep) so the gold burst fires again when a punch lands on the next rep.
  const key = `${presentationKey}-${index}`
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
          affirmed={affirmed}
          affirmKey={`${cue.id}-${index}`}
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
    // A rest holds its slot so the bar keeps its width. It must NOT fall
    // through to `default` — returning null would silently shorten the row
    // and defeat the fixed-width bar entirely (GH #305).
    case 'rest':
      return <RestSlot key={key} size={size} />
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
  const presentationKey = view.presentationKey ?? cue.id
  const coachTokens = cue.tokens.filter((t) => t.kind === 'coach')

  return (
    <View style={styles.cueRow} testID={testID}>
      {size === 'stage' ? (
        <ComboFlourish
          {...(view.comboCompleteKey === undefined ? {} : { fireKey: view.comboCompleteKey })}
          reducedMotion={reducedMotion}
        />
      ) : null}
      <View style={styles.tokens}>
        {visibleBar(cue.tokens, view.tokenStates).map(({ token, index }) =>
          renderToken(
            token,
            index,
            cue,
            view.tokenStates[index] ?? 'upcoming',
            size,
            reducedMotion,
            view.affirmedTokenIndexes?.includes(index) ?? false,
            presentationKey,
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

/**
 * The UI-thread walk (MVP v2, GH #305): worklet-projected beat cursor for
 * the ACTIVE sequence cue, merged over the JS-delivered tokenStates. JS
 * still owns matcher credit (`completed` ✓ marks) and everything
 * non-sequence; the worklet owns WHEN the active node advances — the
 * rhythm carrier that used to trail the click by a mean 209 ms on the JS
 * tick. Without a `workClock` (tests, screens without the wiring) this is
 * inert and the props-supplied states render exactly as before.
 */
function useWalkedView(
  current: CueView | undefined,
  workClock: SharedValue<SharedWorkClock> | undefined,
): CueView | undefined {
  const [walk, setWalk] = React.useState<{ epoch: string; ordinal: number } | null>(null)
  const cue = current?.cue
  const ringCue = React.useMemo<RingBeatCue | null>(() => {
    if (!cue || cue.scoring !== 'sequence') return null
    return {
      epoch: cue.id,
      scheduledStartMs: cue.scheduledStartMs,
      tokenOffsetsMs: cue.tokenOffsetsMs,
      expectedTokenIndexes: cue.expectedPunches.map((p) => p.tokenIndex),
    }
    // Occurrence identity only — a re-render with the same cue must not
    // rebuild (and thereby restage/reset) the worklet's clamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue?.id])
  const onOrdinal = React.useCallback((epoch: string, ordinal: number) => {
    setWalk({ epoch, ordinal })
    // Click-lock v2 ground truth (A6): the DISPLAYED walk, not the engine
    // event. ~3-4 lines/sec — production-safe, and the only way to measure
    // what the athlete actually saw against the beat grid.
    logger.info('puncheokie.ring.visual', 'walk advanced', {
      cueId: safe(epoch),
      ordinal: safe(ordinal),
    })
  }, [])
  useRingBeatClock(ringCue, workClock, onOrdinal)

  return React.useMemo(() => {
    if (!current || !cue) return current
    if (!walk || walk.epoch !== cue.id) return current
    // Merge: cursor = max(matcher credit, worklet beat) — identical to the
    // runner's own sequence-branch rule, just fed a fresher beat.
    const credited = current.tokenStates.filter(
      (s, i) => s === 'completed' && cue.tokens[i]?.kind === 'punch',
    ).length
    const cursor = Math.max(credited, walk.ordinal)
    const tokenStates = cue.tokens.map((t, i): TokenVisualState => {
      if (t.kind === 'rest') return 'empty'
      if (t.kind !== 'punch') return current.tokenStates[i] ?? 'upcoming'
      const po = cue.expectedPunches.findIndex((p) => p.tokenIndex === i)
      if (po < 0) return 'upcoming'
      if (po < credited) return 'completed'
      if (po === cursor) return 'active'
      return 'upcoming'
    })
    return { ...current, tokenStates }
  }, [current, cue, walk])
}

function CueStageInner(props: CueStageProps): React.JSX.Element {
  const { next, reducedMotion = false, idleLabel, avatarAnchor, workClock } = props
  const current = useWalkedView(props.current, workClock)

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
          <>
            {/* Rendered first so it paints BEHIND the token row — behind the
                numbered circles, but still far above the backdrop and its
                effects, which live in an earlier sibling of this whole
                subtree and cannot reach a view up here. */}
            <PunchAvatarCard
              cue={current.cue}
              activeTokenIndex={current.tokenStates.findIndex(
                (state, i) => state === 'active' && current.cue.tokens[i]?.kind === 'punch',
              )}
              reducedMotion={reducedMotion}
              {...(avatarAnchor ? { anchor: avatarAnchor } : {})}
            />
            <CueRow
              view={current}
              size="stage"
              reducedMotion={reducedMotion}
              testID="cue-stage-current"
            />
          </>
        ) : (
          <Text style={styles.idle} testID="cue-stage-idle">
            {idleLabel ?? 'Ready'}
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
    fontSize: sizes.micro,
    fontFamily: fonts.label,
    fontWeight: weights.bold,
    letterSpacing: 1.2,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  // Dimmed rather than hidden: preparable, but not competing with the
  // combination currently being thrown.
  nextDim: { opacity: 0.55 },
  currentZone: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cueRow: { alignItems: 'center', gap: 8 },
  // `nowrap`, deliberately. A bar that wraps onto a second line stops being
  // a bar — the whole point is that four slots sit in the same four places
  // every time. Paging keeps the row at BAR_SLOTS or fewer, so at stage size
  // this is ~464dp: comfortable on the tablet, tight on a phone, where the
  // node diameter is the knob to turn rather than wrapping (GH #305).
  tokens: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'nowrap' },
  repeat: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  repeatLabel: {
    fontSize: sizes.subtitle,
    fontFamily: fonts.display,
    fontWeight: weights.black,
    color: colors.textSecondary,
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  dotFilled: { backgroundColor: colors.accent, borderColor: colors.accent },
  dotEmpty: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
  idle: {
    fontSize: sizes.hero,
    fontFamily: fonts.heading,
    fontWeight: weights.bold,
    color: colors.textMuted,
  },
})

/**
 * Memoized: the live screen re-renders on every store push, and this
 * component's subtree is heavy — re-committing it at store cadence was
 * part of the JS churn that starved the responder system (dead buttons
 * during work). Props are plain values/stable objects, so a shallow
 * compare skips most commits.
 */
export const CueStage = React.memo(CueStageInner)
