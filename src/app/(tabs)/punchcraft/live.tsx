/**
 * Landscape live screen (M32-08, doc §19).
 *
 * Assembles the three zone components around the runner. It holds no
 * workout logic of its own — the session clock and cue engine live in the
 * runner, and everything here either reads the store or calls a control.
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
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import * as ScreenOrientation from 'expo-screen-orientation'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

import { CueStage } from '@components/workout/CueStage'
import { MetricsRail } from '@components/workout/MetricsRail'
import { RoundTopBar } from '@components/workout/RoundTopBar'
import { SimControls } from '@components/workout/SimControls'
import { colors } from '@/theme/colors'
import { SimulatedPunchSource } from '@simulation/SimulatedPunchSource'
import { systemMonotonicClock } from '@domain/time/MonotonicClock'
import { threeRoundFundamentals } from '@domain/workout/samples'
import { useLive, useRecipe } from '@state/useWorkoutStore'
import { useWorkoutRunner } from './useWorkoutRunner'
import type { SimScriptId } from '@simulation/scripts'

/** Tag for the keep-awake lock this screen owns; see the header note. */
const LIVE_KEEP_AWAKE_TAG = 'punchcraft-live'

export default function LiveScreen(): React.JSX.Element {
  const router = useRouter()
  const recipe = useRecipe()
  const live = useLive()
  const [confirmingStop, setConfirmingStop] = useState(false)

  const clock = useMemo(() => systemMonotonicClock(), [])
  const source = useMemo(
    () => new SimulatedPunchSource({ clock, seed: 'live-screen', velocity: true }),
    [clock],
  )

  // The workout under test until the generator (M35) and the library picker
  // hand one in. The recipe's stance still drives hand resolution.
  const workout = threeRoundFundamentals
  const runner = useWorkoutRunner({
    workout,
    source,
    stance: recipe.defaultStance,
    clock,
  })

  const startedRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      void activateKeepAwakeAsync(LIVE_KEEP_AWAKE_TAG)

      return () => {
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
    }, []),
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
        connection={{ left: 'simulated', right: 'simulated' }}
        {...(live.degraded ? { degraded: live.degraded } : {})}
      />

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
            </View>
          ) : null}
        </View>

        <MetricsRail
          counts={{ total: live.counts.total, left: live.counts.left, right: live.counts.right }}
          {...(roundGoal === undefined ? {} : { roundGoal })}
          {...(live.avgVelocity ? { avgVelocity: live.avgVelocity } : {})}
          {...(live.lastVelocity ? { lastVelocity: live.lastVelocity } : {})}
          velocityAvailable={live.velocityAvailable}
          capabilityTier={live.capabilityTier}
          tiles={live.tiles}
          tileValues={{
            'combo-completion': `${live.counts.inCue}/${live.counts.inCueExpected}`,
          }}
        />
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

      {__DEV__ ? (
        <SimControls
          onTap={(hand) => source.emitTap(hand)}
          onPlayScript={(id: SimScriptId) => source.playScript(id)}
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
  pausedText: { fontSize: 40, fontWeight: '800', color: colors.textPrimary },
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
