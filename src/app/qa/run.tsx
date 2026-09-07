/**
 * QA run launcher — `punchcraft://qa/run` (GH #291).
 *
 * The machine entry point for the unattended timing suite: one intent
 * selects a workout, sets the vocabulary, stages an autostart and a
 * simulated punch script, and lands on the live screen — no coordinate
 * taps, no uiautomator, no launcher picker.
 *
 * It lives at the root (like `dev/random-workout`, whose shape this
 * copies) and NOT under `(tabs)`: the store must be staged BEFORE the live
 * screen mounts, because the live screen compiles its whole timeline from
 * the recipe on mount — including the round-1 walkout opener, which reads
 * `recipe.voiceVocabulary` and which the on-screen vocabulary radio can
 * never reach. Patching the recipe here is therefore strictly better than
 * the tap the old driver performed.
 *
 * Privilege: `autostart` and `sim` only take effect when the persisted QA
 * flag is on (or this very link flips it on with `qa=1`). Without it the
 * link merely selects a workout — a public URL scheme must not be able to
 * start a workout throwing phantom punches on its own. Nothing here is
 * gated on `__DEV__`: the suite runs against a release build.
 */
import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { getBuildInfo } from '@diagnostics/buildInfo'
import { logger, safe } from '@diagnostics/logger'
import { getSampleWorkout } from '@domain/workout/samples'
import { parseQaRunParams, type QaRunRequest } from '@state/qaRunParams'
import { useQaStore } from '@state/useQaStore'
import { useWorkoutStore } from '@state/useWorkoutStore'
import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'

/** One store-commit tick before navigating, so the live screen reads the staged state. */
const NAVIGATE_AFTER_MS = 250

/**
 * The last nonce this process handled. The driver re-sends an intent when
 * the first one was swallowed by the dev launcher; a repeat must not stage
 * a second run (which would re-arm autostart on a screen that already
 * started) — it only re-navigates.
 */
let lastNonce: string | undefined

export default function QaRunLauncher(): React.JSX.Element {
  const router = useRouter()
  const params = useLocalSearchParams()
  const firedRef = useRef(false)
  const navigateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [outcome, setOutcome] = useState<
    { kind: 'staged'; request: QaRunRequest } | { kind: 'invalid'; errors: string[] } | null
  >(null)

  // Unmount-only cleanup for the navigation timer. Kept apart from the
  // one-shot effect below on purpose: a cleanup attached to THAT effect ran
  // on the re-render `setOutcome` causes (both `useLocalSearchParams()` and,
  // in tests, `useRouter()` hand back fresh objects), cleared the timer, and
  // the screen staged the run correctly and then sat on itself forever —
  // observed on the tablet, 2026-09-07.
  useEffect(
    () => () => {
      if (navigateTimer.current !== null) clearTimeout(navigateTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true

    const parsed = parseQaRunParams(params as Record<string, string | string[] | undefined>)
    if (!parsed.ok) {
      logger.warn('puncheokie.qa.run.invalid', 'QA run link rejected', {
        errors: safe(parsed.errors.join(' | ')),
      })
      setOutcome({ kind: 'invalid', errors: parsed.errors })
      return
    }
    const request = parsed.request

    if (request.nonce !== undefined && request.nonce === lastNonce) {
      logger.info('puncheokie.qa.run.duplicate', 'QA run re-sent; re-navigating only', {
        nonce: safe(request.nonce),
      })
      router.replace('/(tabs)/punchcraft/live')
      return
    }
    lastNonce = request.nonce

    const qa = useQaStore.getState()
    if (request.qa !== undefined) qa.setEnabled(request.qa)
    const qaEnabled = useQaStore.getState().enabled

    // Select the workout. A sample pins the catalogue entry; 'generated'
    // mints a fresh build and, when a seed is given, makes it reproducible.
    const workoutStore = useWorkoutStore.getState()
    let sampleName: string | undefined
    if (request.workout === 'generated') {
      workoutStore.startNewBuild()
      if (request.seed !== undefined) workoutStore.setRecipe({ seed: request.seed })
    } else {
      workoutStore.selectSample(request.workout)
      sampleName = getSampleWorkout(request.workout).name
    }
    // The recipe is the single source of truth for the vocabulary — and the
    // only thing that reaches the round-1 opener.
    workoutStore.setRecipe({ voiceVocabulary: request.vocab === 'techniques' ? 'names' : 'numbers' })

    // Downgrade the privileged actions when the flag is off.
    const autostart = request.autostart && qaEnabled
    const sim = qaEnabled ? request.sim : 'none'
    if (autostart !== request.autostart || sim !== request.sim) {
      logger.warn('puncheokie.qa.run.blocked', 'QA mode is off; autostart/sim ignored', {
        requestedAutostart: safe(request.autostart),
        requestedSim: safe(request.sim),
      })
    }

    qa.stageRun({
      workout: request.workout,
      vocab: request.vocab,
      sim,
      simForce: request.simForce,
      ...(request.simBpm !== undefined ? { simBpm: request.simBpm } : {}),
      autostart,
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.nonce !== undefined ? { nonce: request.nonce } : {}),
      requestedAtMs: performance.now(),
      autostartConsumed: false,
    })

    const build = getBuildInfo()
    const { seed } = useWorkoutStore.getState().recipe
    logger.info('puncheokie.qa.run', 'QA run staged from deep link', {
      workout: safe(request.workout),
      sampleName: safe(sampleName ?? 'generated'),
      vocab: safe(request.vocab),
      sim: safe(sim),
      simForce: safe(request.simForce),
      simBpm: safe(request.simBpm ?? null),
      autostart: safe(autostart),
      seed: safe(seed),
      nonce: safe(request.nonce ?? null),
      qaEnabled: safe(qaEnabled),
      dev: safe(__DEV__),
      gitSha: safe(build.gitSha),
      appVersion: safe(build.appVersion),
      releaseChannel: safe(build.releaseChannel),
      expoSdk: safe(build.expoSdk),
      reactNative: safe(build.reactNative),
      platformVersion: safe(String(build.platformVersion)),
      installationId: safe(build.installationId ?? null),
    })
    setOutcome({ kind: 'staged', request: { ...request, autostart, sim } })

    navigateTimer.current = setTimeout(() => {
      navigateTimer.current = null
      router.replace('/(tabs)/punchcraft/live')
    }, NAVIGATE_AFTER_MS)
    // One-shot by construction (`firedRef`), so no dependencies: it reads the
    // params and router it was mounted with, and nothing that re-renders this
    // screen may re-run or clean it up. See the unmount effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View style={styles.root}>
      {outcome?.kind === 'invalid' ? (
        <>
          <Text style={styles.title}>QA run link rejected</Text>
          {outcome.errors.map((e) => (
            <Text key={e} style={styles.detail}>
              {e}
            </Text>
          ))}
        </>
      ) : (
        <>
          <Text style={styles.title}>Staging QA run…</Text>
          {outcome?.kind === 'staged' ? (
            <Text style={styles.detail}>
              {`${outcome.request.workout} · ${outcome.request.vocab}\n` +
                `sim ${outcome.request.sim} · autostart ${outcome.request.autostart ? 'on' : 'off'}`}
            </Text>
          ) : null}
        </>
      )}
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
