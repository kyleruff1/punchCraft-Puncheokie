/**
 * Landscape live screen (M32-08, doc §19).
 *
 * Assembles the three zone components around the runner. It holds no
 * workout logic of its own — the session clock and cue engine live in the
 * runner, and everything here either reads the store or calls a control.
 *
 * The punch source is chosen by `useLivePunchSource` (M33-01): the real
 * trackers when both gloves are connected, the simulator otherwise. That
 * choice is invisible to the runner, which only knows the `PunchEventSource`
 * port — which is the entire reason the port exists.
 *
 * Landscape-first is a recorded deviation from spec §19.4's phone-first
 * rule for this one route (D7). The mechanism is the M32-05 spike's: global
 * `orientation: 'default'`, lock on focus, release on blur.
 *
 * Keep-awake is activated and deactivated **explicitly by tag** rather than
 * through `useKeepAwake()`. The spike found that the hook acquires the flag
 * and never releases it — the screen would then never sleep again after one
 * workout. Tying it to the same focus effect that owns the orientation lock
 * makes the release as reliable as the acquire.
 *
 * No app-generated audio here; voice arrives in M34 behind its own gate
 * (spec §13.5, D1).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, useFocusEffect, useNavigation, useRouter } from 'expo-router'
import * as ScreenOrientation from 'expo-screen-orientation'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

import { TAB_BAR_STYLE } from '../_layout'
import { setAutoRetrySuspended } from '@ble/autoConnectTrackers'
import { ActionButton } from '@components/branding/ActionButton'
import { CueStage } from '@components/workout/CueStage'
import { MetricsRail } from '@components/workout/MetricsRail'
import { RestPhases } from '@components/workout/RestPhases'
import { RoundTopBar } from '@components/workout/RoundTopBar'
import { SimControls } from '@components/workout/SimControls'
import { colors } from '@/theme/colors'
import { fonts, sizes, weights } from '@/theme/typography'
import { nextRoundPreview } from '@domain/session/restPhases'
import { systemMonotonicClock } from '@domain/time/MonotonicClock'
import { getSampleWorkout } from '@domain/workout/samples'
import { generateWorkout } from '@domain/workout/generateWorkout'
import { useLive, useRecipe, useSelectedSampleKey } from '@state/useWorkoutStore'
import { useLivePunchSource } from './useLivePunchSource'
import { useWorkoutRunner, type SessionEndOutcome } from './useWorkoutRunner'
import { VoiceOutputExpo } from '@audio/VoiceOutputExpo'
import { findPhraseAsset } from '@audio/voiceAssets/phraseManifest'
import { IntroPlayer } from '@audio/IntroPlayer'
import { CALLOUT_CLIPS } from '@audio/voiceAssets/calloutManifest'
import { RoundWarningPlayer } from '@audio/RoundWarningPlayer'
import {
  INTRO_COUNTDOWN_SLACK_MS,
  INTRO_TAIL_PAD_MS,
  planIntro,
} from '@audio/introPlan'
import { HapticOutputExpo } from '@audio/HapticOutputExpo'
import {
  PLAYBACK_DETECTION_UNAVAILABLE_NOTICE,
  createPlaybackDetector,
} from '@audio/ThirdPartyPlaybackDetector'
import { useVoiceSettingsStore } from '@state/useVoiceSettingsStore'
import type { SimScriptId } from '@simulation/scripts'

/** Tag for the keep-awake lock this screen owns; see the header note. */
const LIVE_KEEP_AWAKE_TAG = 'punchcraft-live'

/**
 * Workout backdrop art (§17, D17). The wide-format hero from the branding
 * kit — fist on the left, cyan spikes fading into dark negative space that
 * the cue stage sits over. Not audio-reactive; not a signal — ambience only.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BACKDROP = require('../../../../assets/branding/backdrop-landscape.png') as number

export default function LiveScreen(): React.JSX.Element {
  const router = useRouter()
  const navigation = useNavigation()
  const selectedSampleKey = useSelectedSampleKey()
  const recipe = useRecipe()
  const live = useLive()
  const [confirmingStop, setConfirmingStop] = useState(false)
  /**
   * How the finished workout was written (M33-08). Held here rather than in
   * the store because it is a one-shot ending, not live state — and a failed
   * write is shown rather than swallowed: the athlete should know their
   * workout was not saved while they can still say something about it.
   */
  const [endOutcome, setEndOutcome] = useState<SessionEndOutcome | null>(null)

  // The Voice Coach. Built once per screen: the output owns players and a
  // focus request, and rebuilding it mid-workout would drop both.
  const storePolicy = useVoiceSettingsStore((s) => s.policy)
  // The recipe is the single source of truth for HOW the coach speaks
  // (voiceMode) and WHICH words it uses (voiceVocabulary) — Kyle's
  // recipe redesign. The persisted settings store still carries style,
  // overlay opt-in, etc., but its stale mode/vocabulary must never win:
  // the lab caught the coach saying "jab, cross" against a recipe that
  // plainly said Numbers, because the store defaulted to 'names'.
  const policy = React.useMemo(
    () => ({ ...storePolicy, mode: recipe.voiceMode, vocabulary: recipe.voiceVocabulary }),
    [storePolicy, recipe.voiceMode, recipe.voiceVocabulary],
  )
  const volumes = useVoiceSettingsStore((s) => s.volumes)
  const detector = React.useMemo(() => createPlaybackDetector(), [])
  // Built once, never per render: the output owns players and a focus
  // request, and rebuilding it mid-workout would drop both.
  const output = React.useMemo(() => new VoiceOutputExpo(), [])
  // Felt feedback, built once and gated by the haptics volume — turning it off
  // in settings silences the motor rather than just muting a number.
  const haptics = React.useMemo(() => new HapticOutputExpo(), [])

  React.useEffect(() => {
    haptics.setEnabled(volumes.haptics > 0)
  }, [haptics, volumes.haptics])

  React.useEffect(() => {
    return () => {
      output.release()
    }
  }, [output])

  // Live vocabulary override (Kyle's mid-workout radio): dispatch-time
  // only. Clips resolve at play time and preload keeps BOTH tracks warm,
  // so the flip is instant — no engine rebuild, no rhythm-map change.
  // (Placement margins stay compiled with the starting vocabulary; a
  // longer techniques phrase may finish slightly into its window, which
  // the overrun reporting already tolerates.)
  const [liveVocabulary, setLiveVocabulary] = useState<'numbers' | 'names' | null>(null)
  const effectiveVocabulary = liveVocabulary ?? recipe.voiceVocabulary

  React.useEffect(() => {
    // Preload during the countdown, not at the first cue: M34-01 measured a
    // cold clip at roughly twice the jitter of a preloaded one. Re-runs on a
    // vocabulary change; preload also warms the OTHER vocabulary's openers.
    output.setVocabulary(effectiveVocabulary)
    void output.preload()
  }, [output, effectiveVocabulary])

  React.useEffect(() => {
    output.setVolumes(volumes)
  }, [output, volumes])

  const voice = React.useMemo(
    () => ({ output, policy, detector }),
    [output, policy, detector],
  )

  const clock = useMemo(() => systemMonotonicClock(), [])
  // Real trackers when both gloves are connected, the simulator otherwise
  // (M33-01). The runner is written against the port and sees no difference.
  const { source, sim, connection } = useLivePunchSource(clock, {
    // Before Start is pressed the runner is only armed, so upgrading from
    // the simulator to freshly-connected trackers is safe — and rescues
    // the athlete who opened the screen while a reconnect was in flight.
    allowUpgrade: live.phase === 'idle',
  })

  // The auto-retry scheduler must not scan or evict while a workout is
  // RUNNING — a retry pass mid-round churns the radios and drops the very
  // connections the athlete is punching through (observed: streaming hand
  // knocked to Off, other hand's GATT dead). Suspend for every non-idle
  // phase; resume (which also re-evaluates an interrupted chase) when the
  // session returns to idle or the screen goes away.
  React.useEffect(() => {
    setAutoRetrySuspended(live.phase !== 'idle')
  }, [live.phase])
  React.useEffect(() => {
    return () => {
      setAutoRetrySuspended(false)
    }
  }, [])

  // The workout to run: a library pick when the athlete chose one, otherwise a
  // workout generated from the current recipe (M35). The generation is
  // memoized on the recipe so it stays stable for the length of a run and only
  // rebuilds when the recipe changes. Either way the workout carries its own
  // stance, so a switch-by-round sample opens in the stance it prescribes.
  // The clip gate (M1/M3): the generator's build-up ladders only emit
  // notations the phrase library can actually say. A notation with no
  // rendered clip drops that ladder from selection rather than sending the
  // coach to the per-word fallback for a whole round.
  const generated = useMemo(() => {
    const vocabulary = recipe.voiceVocabulary === 'names' ? 'techniques' : 'numbers'
    return generateWorkout(recipe, {
      voiceReady: (notation) =>
        findPhraseAsset(notation, recipe.cadenceProfile, vocabulary) !== undefined,
      // Set Ceremonies: price a pre-set call-out from MEASURED clip
      // lengths so the fill can reserve exactly the lead-in the coach
      // needs. Any missing clip prices to undefined — the ceremony is
      // skipped, never guessed.
      ...(recipe.voiceMode === 'off'
        ? {}
        : {
            setupCallouts: {
              reserveMsFor: (asset: string, notation?: string, tail?: string) => {
                const sentence = (
                  CALLOUT_CLIPS as Record<string, { durationMs: number }>
                )[asset]?.durationMs
                if (sentence === undefined) return undefined
                let total = sentence
                if (notation !== undefined) {
                  const recite = findPhraseAsset(notation, 'technical', vocabulary)?.durationMs
                  if (recite === undefined) return undefined
                  total += recite + 250
                }
                if (tail !== undefined) {
                  const tailMs = (
                    CALLOUT_CLIPS as Record<string, { durationMs: number }>
                  )[tail]?.durationMs
                  if (tailMs === undefined) return undefined
                  total += tailMs + 250
                }
                // Finish-quiet margin plus start slack.
                return total + 800
              },
            },
          }),
    })
  }, [recipe])
  const workout = selectedSampleKey ? getSampleWorkout(selectedSampleKey).workout : generated

  // The walkout announcement: "Hello! Welcome to punch craft. I'm your
  // coach, Jonathan punch craft…" — workout details, a double breath, the
  // joke, a beat, "Let's get started!". The countdown stretches to fit the
  // planned sequence (joke included — it draws once per workout, here in
  // the memo), so the coach finishes before the first bell and the rhythm
  // map never moves. Voice off, or no rendered segments, falls back to the
  // default 5-second lead-in.
  const intro = useMemo(() => planIntro(workout), [workout])
  // The countdown is a CAP, not the schedule: planned speech plus slack
  // for dev-client load stalls. The intro's completion callback skips the
  // remainder, so the bell follows the coach's actual last word.
  const introMs =
    policy.mode !== 'off' && intro.totalMs > 0
      ? intro.totalMs + INTRO_COUNTDOWN_SLACK_MS
      : undefined

  const runner = useWorkoutRunner({
    workout,
    source,
    stance: workout.recipe.defaultStance,
    clock,
    countdownMs: introMs,
    // `setEndOutcome` is stable, which the runner requires — an unstable
    // callback here would rebuild the cue engine on every render.
    onSessionEnded: setEndOutcome,
    voice,
    haptics,
  })

  // The walkout announcement: players buffer during the lobby (the first
  // monitored run measured ~16s of cold-load silence when loading began at
  // the countdown), then play() during the extended countdown runs the
  // sequence on warm clips. The player is idempotent, so re-renders
  // mid-countdown cannot restart it.
  const introRef = useRef<IntroPlayer | null>(null)
  React.useEffect(() => {
    if (live.phase !== 'idle' || policy.mode === 'off') return
    introRef.current ??= new IntroPlayer()
    introRef.current.load(intro.segments)
  }, [live.phase, policy.mode, intro.segments])
  React.useEffect(() => {
    if (live.phase !== 'countdown' || policy.mode === 'off') return
    introRef.current?.play(volumes.voice, {
      tailMs: INTRO_TAIL_PAD_MS,
      // "Let's get started!" → a beat → the bell, regardless of how much
      // of the padded cap is left.
      onComplete: runner.skipCountdown,
    })
  }, [live.phase, policy.mode, volumes.voice, runner.skipCountdown])
  React.useEffect(() => {
    // The bell has authority: a still-talking intro is cut, never waited on.
    if (live.phase !== 'idle' && live.phase !== 'countdown') introRef.current?.stop()
  }, [live.phase])
  React.useEffect(() => () => introRef.current?.stop(), [])

  // Round-start warnings: every rest ends with the coach preparing the
  // athlete and counting down into the ding. Prepared (natively buffered)
  // at rest entry, started on the first tick inside its measured window so
  // "one!" lands on the bell. Tick-driven via store updates — no timers.
  const warnRef = useRef<RoundWarningPlayer | null>(null)
  React.useEffect(() => {
    if (policy.mode === 'off') return
    if (live.phase !== 'rest') {
      warnRef.current?.stop()
      return
    }
    warnRef.current ??= new RoundWarningPlayer()
    // During rest, roundIndex still names the round just finished; the
    // athlete is being readied for the NEXT one (1-based: index + 2).
    // The next round's theme ("Coming up — the Square Builder!") joins
    // the ceremony when a clip exists for it.
    warnRef.current.prepare(live.roundIndex + 2, workout.schedule[live.roundIndex + 1]?.theme)
    warnRef.current.playIfDue(live.roundRemainingMs, volumes.voice)
  }, [live.phase, live.roundIndex, live.roundRemainingMs, policy.mode, volumes.voice, workout.schedule])
  React.useEffect(() => () => warnRef.current?.stop(), [])

  React.useEffect(() => {
    runner.setVocabulary(effectiveVocabulary === 'names' ? 'techniques' : 'numbers')
  }, [runner, effectiveVocabulary])

  const startedRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      void activateKeepAwakeAsync(LIVE_KEEP_AWAKE_TAG)

      // Hide the tab bar: doc §19 requires settings and recipe navigation to
      // be unreachable during a workout, and a visible tab bar is a one-tap
      // exit sitting under the athlete's thumb. It also reclaims the height
      // the cue stage wants.
      const parent = navigation.getParent()
      parent?.setOptions({ tabBarStyle: { display: 'none' } })

      return () => {
        // Restore the shared style object, not `undefined`: an explicit
        // undefined overrides the navigator-level tabBarStyle in the
        // options merge and leaves the bar unstyled (it collapses to a
        // few pixels — the "no navigation bar" bug).
        parent?.setOptions({ tabBarStyle: TAB_BAR_STYLE })
        // Release rather than force portrait: the global setting is
        // 'default', so unlocking hands control back to the OS.
        void ScreenOrientation.unlockAsync().catch(() => undefined)
        // Explicit, tagged release — see the header note on the spike finding.
        try {
          deactivateKeepAwake(LIVE_KEEP_AWAKE_TAG)
        } catch {
          // Already released; nothing to do.
        }
      }
    }, [navigation]),
  )

  const cues = runner.readCues()
  const isWorking = live.phase === 'work'
  const isPaused = live.phase === 'paused'
  const isOver = live.phase === 'completed' || live.phase === 'cancelled'

  const handleStart = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    runner.start()
  }, [runner])

  const roundGoal = workout.schedule[Math.max(0, live.roundIndex)]?.targetPunches

  // Rest presentation (M33-04). Elapsed is derived from the remaining time
  // the session clock already publishes — the sub-phases read the same
  // monotonic timer as the rest itself, never a timer of their own (D6).
  const frozen = live.frozenRoundResult
  const restDurationMs = workout.schedule[Math.max(0, live.roundIndex)]?.restAfterMs ?? 0
  const restElapsedMs = Math.max(0, restDurationMs - live.roundRemainingMs)
  const preview = nextRoundPreview(workout.schedule[live.roundIndex + 1], live.stance)

  return (
    <View style={styles.root} testID="live-screen">
      {/* Header hidden: the zones are the chrome, and a nav bar would eat
          the width the cue stage needs (doc §19). */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* Workout backdrop (§17, D17) — ambience, never a signal.
          - Static image: doc §17 permits an animated backdrop but starts
            unanimated by design, and D17 forbids it from being audio-reactive.
          - Scrim on top: a semi-opaque black layer sets a contrast floor so
            the cue stage stays readable at any brightness of the underlying
            art. Doc §7's contrast rule is not negotiable — a beautiful
            backdrop that costs a missed hit is a defect.
          - `pointerEvents: 'none'` on both: nothing behind the stage may
            steal a tap from the athlete.
          The whole layer sits *behind* every zone that follows because it is
          declared before them in the tree; nothing needs to reason about
          z-index. */}
      <View style={styles.backdropLayer} pointerEvents="none">
        <Image
          source={BACKDROP}
          style={styles.backdropImage}
          resizeMode="cover"
          accessibilityLabel=""
        />
        <View style={styles.backdropScrim} />
      </View>

      {/* Right inset keeps the glove chips clear of the Exit button. */}
      <View style={styles.topBarInset}>
        <RoundTopBar
          roundIndex={Math.max(0, live.roundIndex)}
          roundCount={live.roundCount || workout.schedule.length}
          roundRemainingMs={live.roundRemainingMs}
          stance={live.stance}
          connection={connection}
          {...(live.degraded ? { degraded: live.degraded } : {})}
        />
      </View>

      {/* Why the coach is silent, said once and quietly. Either the athlete
          turned it off, or this build cannot tell whether their music is
          playing — and the second is the app's limitation, not theirs. */}
      {policy.mode === 'off' ? null : detector.available ? null : (
        <Text style={styles.gateNotice} testID="voice-gate-notice">
          {PLAYBACK_DETECTION_UNAVAILABLE_NOTICE}
        </Text>
      )}

      <View style={styles.body}>
        <View style={styles.stage}>
          {live.phase === 'idle' ? (
            <ActionButton action="startWorkout" onPress={handleStart} testID="start-workout" />
          ) : live.phase === 'rest' && frozen ? (
            <RestPhases
              frozen={frozen}
              {...(preview ? { nextRound: preview } : {})}
              restElapsedMs={restElapsedMs}
              restDurationMs={restDurationMs}
              onSkipRest={runner.skipRest}
            />
          ) : (
            <CueStage
              {...(cues.current ? { current: cues.current } : {})}
              {...(cues.next ? { next: cues.next } : {})}
              {...(cues.freeWork ? { idleLabel: 'Free work — keep your hands moving' } : {})}
            />
          )}

          {isPaused ? (
            <View style={styles.pausedOverlay} testID="paused-overlay">
              <Text style={styles.pausedText}>Paused</Text>
            </View>
          ) : null}

          {isOver ? (
            <View style={styles.pausedOverlay} testID="finished-overlay">
              <Text style={styles.pausedText}>
                {live.phase === 'completed' ? 'Workout complete' : 'Stopped'}
              </Text>
              {endOutcome?.status === 'failed' ? (
                <Text style={styles.saveNote} testID="save-failed">
                  This workout could not be saved.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <MetricsRail
          counts={{ total: live.counts.total, left: live.counts.left, right: live.counts.right }}
          {...(roundGoal === undefined ? {} : { roundGoal })}
          {...(live.requiredPace === undefined ? {} : { requiredPace: live.requiredPace })}
          {...(live.actualPace === undefined ? {} : { actualPace: live.actualPace })}
          {...(live.avgVelocity ? { avgVelocity: live.avgVelocity } : {})}
          {...(live.lastVelocity ? { lastVelocity: live.lastVelocity } : {})}
          velocityAvailable={live.velocityAvailable}
          capabilityTier={live.capabilityTier}
          tiles={live.tiles}
          tileValues={{
            'combo-completion': `${live.counts.inCue}/${live.counts.inCueExpected}`,
            'punches-last-15s': live.punchesLast15s ?? 0,
            ...(live.peakVelocity ? { 'peak-velocity': Math.round(live.peakVelocity.value) } : {}),
            ...(live.degraded === undefined ? { 'connection-completeness': 'OK' } : {}),
            ...(live.projectedTotal === undefined
              ? {}
              : { 'projected-final': live.projectedTotal }),
          }}
        />
      </View>

      {/* Extras are always visible — a punch with no cue to answer still
          happened (spec §13.6). The label comes from the store so no surface
          can hardcode a technique claim (D4). */}
      <View style={styles.scoreStrip} testID="score-strip">
        <Text style={styles.extras} testID="extra-count">
          {`Extra punches: ${live.extraCount}`}
        </Text>
        {/* Set only at a boundary, and never when the target is out of
            reach — doc §25 forbids urging acceleration toward one. */}
        {live.pacingCue ? (
          <Text style={styles.pacingCue} testID="pacing-cue">
            {live.pacingCue}
          </Text>
        ) : null}
      </View>

      <View style={styles.controls}>
        {isPaused ? (
          <Pressable
            accessibilityRole="button"
            onPress={runner.resume}
            style={styles.control}
            testID="control-resume"
          >
            <Text style={styles.controlText}>Resume</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={live.phase === 'idle' || isOver}
            onPress={runner.pause}
            style={[styles.control, (live.phase === 'idle' || isOver) && styles.controlDisabled]}
            testID="control-pause"
          >
            <Text style={styles.controlText}>Pause</Text>
          </Pressable>
        )}

        {/* Skip and repeat sit behind a long press: a glove mis-tap during a
            combination should not silently change the workout (doc §25). */}
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Long press to skip this combination"
          disabled={!isWorking}
          onLongPress={runner.skipCue}
          style={[styles.control, !isWorking && styles.controlDisabled]}
          testID="control-skip"
        >
          <Text style={styles.controlText}>Skip (hold)</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityHint="Long press to repeat this combination"
          disabled={!isWorking}
          onLongPress={runner.repeatCue}
          style={[styles.control, !isWorking && styles.controlDisabled]}
          testID="control-repeat"
        >
          <Text style={styles.controlText}>Repeat (hold)</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            runner.emergencyStop()
            setConfirmingStop(true)
          }}
          style={[styles.control, styles.stopControl]}
          testID="control-stop"
        >
          <Text style={styles.controlText}>Stop</Text>
        </Pressable>
      </View>

      {/* Discard is destructive, so it is confirmed rather than immediate
          (spec §19.4). The stop itself already happened — only the fate of
          the session is still open. */}
      {confirmingStop ? (
        <View style={styles.confirm} testID="stop-confirm">
          <Text style={styles.confirmText}>Workout stopped. Keep this session?</Text>
          <View style={styles.confirmRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.control}
              testID="confirm-save"
            >
              <Text style={styles.controlText}>Save</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.control, styles.stopControl]}
              testID="confirm-discard"
            >
              <Text style={styles.controlText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Sim controls exist only when the simulator is the source: with real
          trackers streaming there is nothing to fake, and a tap pad would be
          a way to inflate a real session's counts. */}
      {__DEV__ && sim ? (
        <SimControls
          onTap={(hand) => sim.emitTap(hand)}
          onPlayScript={(id: SimScriptId) => sim.playScript(id)}
        />
      ) : null}

      {/* Tap controls are the LAST siblings in the root on purpose:
          Kyle's bag testing found Exit "hardly ever records taps" — an
          intermediate layer was winning Android's hit test. Rendering
          these after everything else (plus elevation) makes them the
          topmost layer no matter what the stage/rails do. */}
      {/* Exit is the escape hatch — always visible, corner of the screen so
          it never falls under the athlete's grip, small enough not to steal
          from the cue stage. Top RIGHT, under the floating settings gear:
          the top-left corner belongs to the round counter, and the first
          bag test had this button sitting exactly on top of "Round 1/3".
          The top bar wrapper below reserves the width so the glove chips
          slide left rather than underlapping. Fires the same confirm flow
          the Stop button does; a workout is real work and dropping it
          silently would lose the athlete's session. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Exit workout"
        onPress={() => {
          // Nothing to stop and nothing to save on `idle` / `completed` /
          // `cancelled` — leave directly. On a running/paused workout the
          // same confirm the Stop button uses runs, so a mid-session tap
          // does not silently lose the athlete's work.
          if (live.phase === 'idle' || isOver) {
            router.back()
            return
          }
          runner.emergencyStop()
          setConfirmingStop(true)
        }}
        style={styles.exitButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 8 }}
        testID="exit-workout"
      >
        <Text style={styles.exitButtonText}>← Exit</Text>
      </Pressable>

      {/* Live vocabulary radio (Kyle): flip numbers ⇄ techniques mid-
          workout. Sits left of Exit; the next call speaks the new set. */}
      <View style={styles.vocabRadio} testID="vocab-radio">
        {(['numbers', 'names'] as const).map((v) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ selected: effectiveVocabulary === v }}
            accessibilityLabel={v === 'numbers' ? 'Numbers callouts' : 'Technique callouts'}
            onPress={() => setLiveVocabulary(v)}
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            style={styles.vocabOption}
            testID={`vocab-${v}`}
          >
            <Text
              style={[
                styles.vocabDot,
                effectiveVocabulary === v && styles.vocabDotActive,
              ]}
            >
              {effectiveVocabulary === v ? '◉' : '○'}
            </Text>
            <Text
              style={[
                styles.vocabLabel,
                effectiveVocabulary === v && styles.vocabLabelActive,
              ]}
            >
              {v === 'numbers' ? 'Numbers' : 'Techniques'}
            </Text>
          </Pressable>
        ))}
      </View>

    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  /**
   * Contrast floor for the backdrop.
   *
   * 0.72 opacity of the base background sits the underlying art at roughly
   * 28% presence — enough to feel like a room, dim enough that the cue
   * tokens keep the same contrast ratio they had against a flat background.
   * Doc §7's minimum contrast is not negotiable; a beautiful backdrop that
   * costs a missed hit is a defect (D17).
   */
  backdropLayer: {
    ...StyleSheet.absoluteFill,
  },
  backdropImage: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  backdropScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    opacity: 0.72,
  },
  body: { flex: 1, flexDirection: 'row' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pausedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    opacity: 0.92,
  },
  gateNotice: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    fontSize: 11,
    color: colors.textMuted,
  },
  saveNote: { marginTop: 6, fontSize: 13, color: colors.textSecondary },
  pausedText: {
    fontSize: sizes.display,
    fontFamily: fonts.display,
    fontWeight: weights.black,
    color: colors.textPrimary,
  },
  scoreStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  extras: { fontSize: 13, color: colors.textSecondary },
  pacingCue: { fontSize: 13, fontWeight: '700', color: colors.accent },
  topBarInset: { paddingRight: 380 },
  vocabRadio: {
    position: 'absolute',
    top: 8,
    right: 110,
    zIndex: 20,
    elevation: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  vocabOption: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vocabDot: { color: colors.textMuted, fontSize: sizes.body },
  vocabDotActive: { color: colors.accent },
  vocabLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: sizes.label },
  vocabLabelActive: { color: colors.accent },
  exitButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 20,
    elevation: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    // Sit above the stage without eating touch area from the punch tokens.
    opacity: 0.9,
  },
  exitButtonText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  controls: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  control: {
    minHeight: 52,
    minWidth: 110,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlDisabled: { opacity: 0.4 },
  stopControl: { borderColor: colors.danger, backgroundColor: colors.dangerSurface },
  controlText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  confirm: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: colors.background,
  },
  confirmText: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  confirmRow: { flexDirection: 'row', gap: 12 },
})
