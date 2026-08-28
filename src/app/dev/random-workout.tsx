/**
 * Random-workout launcher — dev-only test entry point.
 *
 * Deep-link `punchcraft://dev/random-workout` to roll a fully randomized
 * recipe (never the defaults) and land on the live screen ready to start.
 * Built for automated shakedown runs: exercising the generator, voice
 * corpus, ceremonies and BLE path across the settings space instead of
 * re-testing the same default 20-minute steady recipe every time.
 *
 * Voice deliberately never rolls 'off' — the voice pipeline is the thing
 * under test on these runs. Everything else is a fair draw. The chosen
 * settings are logged (dev.randomWorkout.rolled) and shown briefly so a
 * failing run can be reproduced by hand.
 *
 * Plain Math.random is fine here: this is an app-layer dev tool, not
 * domain code — determinism comes from the recipe seed that
 * startNewBuild() mints, which IS logged.
 */
import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { logger, safe } from '@diagnostics/logger'
import { GOAL_TIERS, type IntensityTier } from '@domain/workout/punchGoals'
import type { WorkoutRecipe } from '@domain/workout/WorkoutRecipe'
import type { WorkoutDurationMinutes } from '@domain/workout/roundSchedule'
import { useWorkoutStore } from '@state/useWorkoutStore'
import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!

const DURATIONS: readonly WorkoutDurationMinutes[] = [20, 20, 30, 30, 40, 60]
const TIERS = ['beginner', 'intermediate', 'advanced'] as const
const FOCUS = ['hands', 'movement', 'balanced'] as const
const STANCE = ['orthodox', 'southpaw', 'switch-by-round', 'switch-on-command'] as const
const BIAS = ['balanced', 'lead', 'rear', 'left', 'right'] as const
const VOICE_MODES = ['minimal', 'standard', 'standard', 'full', 'full'] as const
const VOCAB = ['numbers', 'techniques-implied'] as const
const PLAN = ['fixed', 'adaptive', 'goal-seeking'] as const
const GOAL_TIER: readonly IntensityTier[] = ['technique', 'steady', 'steady', 'hard', 'high-volume']

function rollRecipe(): Partial<WorkoutRecipe> {
  const durationMinutes = pick(DURATIONS)
  const stance = pick(STANCE)
  const goalTier = pick(GOAL_TIER)
  // Jitter the tier preset by up to ±200 in goal-step increments so runs
  // exercise off-preset goals too.
  const jitter = (Math.floor(Math.random() * 9) - 4) * 50
  const totalPunchGoal = Math.max(50, GOAL_TIERS[goalTier][durationMinutes] + jitter)
  const stancePatch: Partial<WorkoutRecipe> =
    stance === 'orthodox' || stance === 'southpaw'
      ? { defaultStance: stance, stanceMode: 'fixed' }
      : { defaultStance: pick(['orthodox', 'southpaw'] as const), stanceMode: stance }
  return {
    durationMinutes,
    totalPunchGoal,
    tier: pick(TIERS),
    focus: pick(FOCUS),
    bias: pick(BIAS),
    voiceMode: pick(VOICE_MODES),
    voiceVocabulary: pick(VOCAB) === 'numbers' ? 'numbers' : 'names',
    adaptationMode: pick(PLAN),
    ...stancePatch,
  }
}

const NAVIGATE_AFTER_MS = 2_000

export default function RandomWorkoutLauncher(): React.JSX.Element {
  const router = useRouter()
  const startNewBuild = useWorkoutStore((s) => s.startNewBuild)
  const setRecipe = useWorkoutStore((s) => s.setRecipe)
  const [rolled, setRolled] = useState<Partial<WorkoutRecipe> | null>(null)
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    // Fresh seed + no library pick, then the randomized patch on top.
    startNewBuild()
    const patch = rollRecipe()
    setRecipe(patch)
    setRolled(patch)
    const { seed } = useWorkoutStore.getState().recipe
    logger.info('dev.randomWorkout.rolled', 'randomized recipe for shakedown run', {
      seed: safe(seed),
      ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, safe(String(v))])),
    })
    const timer = setTimeout(() => {
      router.replace('/(tabs)/punchcraft/live')
    }, NAVIGATE_AFTER_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [router, setRecipe, startNewBuild])

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Rolling a randomized workout…</Text>
      {rolled ? (
        <Text style={styles.detail}>
          {`${rolled.durationMinutes} min · goal ${rolled.totalPunchGoal} · ${rolled.tier} · ${rolled.focus}\n` +
            `${rolled.stanceMode === 'fixed' ? rolled.defaultStance : rolled.stanceMode} · bias ${rolled.bias}\n` +
            `voice ${rolled.voiceMode} / ${rolled.voiceVocabulary} · plan ${rolled.adaptationMode}`}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  title: {
    fontSize: sizes.title,
    fontFamily: fonts.heading,
    color: colors.textPrimary,
  },
  detail: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
})
