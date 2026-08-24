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
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, useFocusEffect, useNavigation, useRouter } from 'expo-router'
import * as ScreenOrientation from 'expo-screen-orientation'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

import { CueStage } from '@components/workout/CueStage'
import { MetricsRail } from '@components/workout/MetricsRail'
import { RestPhases } from '@components/workout/RestPhases'
import { RoundTopBar } from '@components/workout/RoundTopBar'
import { SimControls } from '@components/workout/SimControls'
import { colors } from '@/theme/colors'
import { nextRoundPreview } from '@domain/session/restPhases'
import { systemMonotonicClock } from '@domain/time/MonotonicClock'
import { getSampleWorkout } from '@domain/workout/samples'
import { generateWorkout } from '@domain/workout/generateWorkout'
import { useLive, useRecipe, useSelectedSampleKey } from '@state/useWorkoutStore'
import { useLivePunchSource } from './useLivePunchSource'
import { useWorkoutRunner, type SessionEndOutcome } from './useWorkoutRunner'
import { VoiceOutputExpo } from '@audio/VoiceOutputExpo'
import { HapticOutputExpo } from '@audio/HapticOutputExpo'
import {
  PLAYBACK_DETECTION_UNAVAILABLE_NOTICE,
  createPlaybackDetector,
} from '@audio/ThirdPartyPlaybackDetector'
import { useVoiceSettingsStore } from '@state/useVoiceSettingsStore'
import type { SimScriptId } from '@simulation/scripts'

/** Tag for the keep-awake lock this screen owns; see the header note. */
const LIVE_KEEP_AWAKE_TAG = 'punchcraft-live'

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
  const policy = useVoiceSettingsStore((s) => s.policy)
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

  React.useEffect(() => {
    // Preload during the countdown, not at the first cue: M34-01 measured a
    // cold clip at roughly twice the jitter of a preloaded one. Re-runs on a
    // vocabulary change so switching to names actually loads the names clips
    // rather than leaving the coach saying "one".
    output.setVocabulary(policy.vocabulary)
    void output.preload()
  }, [output, policy.vocabulary])

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
  const { source, sim, connection } = useLivePunchSource(clock)

  // The workout to run: a library pick when the athlete chose one, otherwise a
  // workout generated from the current recipe (M35). The generation is
  // memoized on the recipe so it stays stable for the length of a run and only
  // rebuilds when the recipe changes. Either way the workout carries its own
  // stance, so a switch-by-round sample opens in the stance it prescribes.
  const generated = useMemo(() => generateWorkout(recipe), [recipe])
  const workout = selectedSampleKey ? getSampleWorkout(selectedSampleKey).workout : generated
  const runner = useWorkoutRunner({
    workout,
    source,
    stance: workout.recipe.defaultStance,
    clock,
    // `setEndOutcome` is stable, which the runner requires — an unstable
    // callback here would rebuild the cue engine on every render.
    onSessionEnded: setEndOutcome,
    voice,
    haptics,
  })

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
        parent?.setOptions({ tabBarStyle: undefined })
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

      <RoundTopBar
        roundIndex={Math.max(0, live.roundIndex)}
        roundCount={live.roundCount || workout.schedule.length}
        roundRemainingMs={live.roundRemainingMs}
        stance={live.stance}
        connection={connection}
        {...(live.degraded ? { degraded: live.degraded } : {})}
      />

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
            <Pressable
              accessibilityRole="button"
              onPress={handleStart}
              style={styles.startButton}
              testID="start-workout"
            >
              <Text style={styles.startButtonText}>Start workout</Text>
            </Pressable>
          ) : live.phase === 'rest' && frozen ? (
            <RestPhases
              frozen={frozen}
              {...(preview ? { nextRound: preview } : {})}
              restElapsedMs={restElapsedMs}
              restDurationMs={restDurationMs}
              onSkipRest={runner.skipRest}
              capabilityTier={live.capabilityTier}
            />
          ) : (
            <CueStage
              {...(cues.current ? { current: cues.current } : {})}
              {...(cues.next ? { next: cues.next } : {})}
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
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, flexDirection: 'row' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  startButton: {
    paddingHorizontal: 32,
    paddingVertical: 20,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  startButtonText: { fontSize: 22, fontWeight: '800', color: colors.textOnAccent },
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
  pausedText: { fontSize: 40, fontWeight: '800', color: colors.textPrimary },
  scoreStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  extras: { fontSize: 13, color: colors.textSecondary },
  pacingCue: { fontSize: 13, fontWeight: '700', color: colors.accent },
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
