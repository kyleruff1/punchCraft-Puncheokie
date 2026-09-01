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
import { useSharedValue, type SharedValue } from 'react-native-reanimated'

import { PunchAvatarCard } from './PunchAvatarCard'
import { useRingBeatClock, type RoundWalkPlan } from './useRingBeatClock'
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
   * Pre-bell hold indicator (Script Bible v2, Kyle 2026-09-01): when the
   * stage is empty during the countdown, show HOW the round starts —
   * the opening bar's slots — while the coach calls it out. `tokens` are
   * notation strings ('1', '2b', '.'); `rateWord` is the spoken rate.
   */
  upNext?: { tokens: readonly string[]; rateWord?: string }
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
  /**
   * The current round's FULL walk plan (GH #305 v3). Staged onto the UI
   * thread once per round; the worklet iterates bars by clock, so there
   * is no per-rep handoff left to race (the single-successor design let
   * the engine's early completions clobber un-promoted bars — whole bars
   * were swallowed on glass).
   */
  walkPlan?: RoundWalkPlan
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
  walkOrdinal?: SharedValue<number>,
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
          {...(walkOrdinal !== undefined
            ? {
                walkOrdinal,
                punchOrdinal: cue.expectedPunches.findIndex((p) => p.tokenIndex === index),
              }
            : {})}
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
  /** Stage 3: worklet walk cursor — nodes paint from it directly. */
  walkOrdinal?: SharedValue<number>
}): React.JSX.Element {
  const { view, size, reducedMotion, testID, walkOrdinal } = props
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
            walkOrdinal,
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
  plan: RoundWalkPlan | null,
  workClock: SharedValue<SharedWorkClock> | undefined,
): { view: CueView | undefined; walkOrdinal: SharedValue<number> } {
  // Stage 3 (GH #305): the worklet writes this UI-thread-synchronously;
  // PunchToken paints from it via Reanimated styles. The setWalk/JS copy
  // below survives for the avatar's adoption index and the ring.visual
  // click-lock log — it no longer touches node pixels.
  const walkOrdinal = useSharedValue(-1)
  const [walk, setWalk] = React.useState<{ epoch: string; ordinal: number } | null>(null)
  const cue = current?.cue
  const onOrdinal = React.useCallback((epoch: string, ordinal: number) => {
    setWalk({ epoch, ordinal })
    logger.info('puncheokie.ring.visual', 'walk advanced', {
      cueId: safe(epoch),
      ordinal: safe(ordinal),
    })
  }, [])
  useRingBeatClock(plan, workClock, onOrdinal, walkOrdinal)

  const view = React.useMemo(() => {
    if (!current || !cue) return current
    if (!workClock || cue.scoring !== 'sequence') return current
    // THE WORKLET OWNS THE ROW — sole source, no merge (GH #305): the
    // walk's ordinal for the bar the CLOCK is in. When the worklet is a
    // hair ahead of JS's `current` at a boundary, epoch mismatch renders
    // all-upcoming for a frame or two — the page-turn, not a flash of the
    // previous bar.
    const ordinal = walk && walk.epoch === cue.id ? walk.ordinal : -1
    const tokenStates = cue.tokens.map((t, i): TokenVisualState => {
      if (t.kind === 'rest') return 'empty'
      if (t.kind !== 'punch') return current.tokenStates[i] ?? 'upcoming'
      const po = cue.expectedPunches.findIndex((p) => p.tokenIndex === i)
      if (po < 0) return 'upcoming'
      if (po < ordinal) return 'completed'
      if (po === ordinal) return 'active'
      return 'upcoming'
    })
    return { ...current, tokenStates }
  }, [current, cue, walk, workClock])
  return { view, walkOrdinal }
}

function CueStageInner(props: CueStageProps): React.JSX.Element {
  const { next, reducedMotion = false, idleLabel, avatarAnchor, workClock } = props
  const { view: current, walkOrdinal } = useWalkedView(
    props.current,
    props.walkPlan ?? null,
    workClock,
  )
  const walked = workClock !== undefined

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
              {...(walked && current.cue.scoring === 'sequence'
                ? { walkOrdinal }
                : {})}
            />
          </>
        ) : props.upNext ? (
          <View style={styles.upNext} testID="cue-stage-upnext">
            <Text style={styles.nextLabel}>Starting with</Text>
            <View style={styles.upNextRow}>
              {props.upNext.tokens.map((t, i) => (
                <View
                  key={i}
                  style={[styles.upNextPill, t === '.' && styles.upNextRest]}
                  testID={`cue-stage-upnext-${i}`}
                >
                  <Text style={[styles.upNextPillText, t === '.' && styles.upNextRestText]}>
                    {t === '.' ? '·' : t}
                  </Text>
                </View>
              ))}
            </View>
            {props.upNext.rateWord ? (
              <Text style={styles.upNextRate}>{props.upNext.rateWord}</Text>
            ) : null}
          </View>
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
  upNext: { alignItems: 'center', gap: 14 },
  upNextRow: { flexDirection: 'row', gap: 14, flexWrap: 'nowrap' },
  upNextPill: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upNextRest: { borderColor: colors.borderStrong, borderStyle: 'dashed' },
  upNextPillText: {
    fontSize: sizes.title,
    fontFamily: fonts.display,
    fontWeight: weights.black,
    color: colors.textPrimary,
  },
  upNextRestText: { color: colors.textMuted },
  upNextRate: {
    fontSize: sizes.subtitle,
    fontFamily: fonts.label,
    fontWeight: weights.bold,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    textTransform: 'uppercase',
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
