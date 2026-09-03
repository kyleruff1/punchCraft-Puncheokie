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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ScreenOrientation from 'expo-screen-orientation'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

import { TAB_BAR_STYLE } from '../_layout'
import { armAutoRetry, setAutoRetrySuspended } from '@ble/autoConnectTrackers'
import { useReducedMotion, useSharedValue } from 'react-native-reanimated'
import { ActionButton } from '@components/branding/ActionButton'
import { BackdropRenderer } from '@components/workout/backdrop/BackdropRenderer'
import { createBackdropBus } from '@components/workout/backdrop/backdropBus'
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
import { useBackdropQuality } from '@state/useBackdropSettingsStore'
import { useLivePunchSource } from './_useLivePunchSource'
import { useWorkoutRunner, type SessionEndOutcome } from './_useWorkoutRunner'
import { useSharedTransportAnchor } from '@audio/useSharedTransportAnchor'
import {
  SHARED_WORK_CLOCK_STOPPED,
  type SharedWorkClock,
} from '@domain/timing/SharedWorkClock'
import { VoiceOutputExpo } from '@audio/VoiceOutputExpo'
import { findComboAnnounce } from '@audio/voiceAssets/comboAnnounceManifest'
import { IntroPlayer } from '@audio/IntroPlayer'
import { RecoveryPlayer } from '@audio/RecoveryPlayer'
import { CALLOUT_CLIPS, themeClipFor } from '@audio/voiceAssets/calloutManifest'
import { INTRO_SEGMENTS } from '@audio/voiceAssets/introManifest'
import { RECOVERY_SCRIPTS, type RecoveryScript } from '@audio/voiceAssets/recoveryManifest'
import { findClickScript } from '@audio/voiceAssets/clickScriptManifest'
import { RoundWarningPlayer } from '@audio/RoundWarningPlayer'
import { planRecoverySequence } from '@domain/coach/recoveryPlan'
import {
  INTRO_COUNTDOWN_SLACK_MS,
  INTRO_TAIL_PAD_MS,
  planIntro,
} from '@audio/introPlan'
import { HapticOutputExpo } from '@audio/HapticOutputExpo'
import {
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
  // The reactive backdrop's bus, built once per mount so its rolling
  // scaling window is naturally session-scoped. Dormant unless a scene
  // subscribes AND the phase is work.
  const backdropBus = React.useMemo(() => createBackdropBus(), [])
  const backdropQuality = useBackdropQuality()
  const reducedMotion = useReducedMotion()

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

  // Shared transport anchor (M39-V2 Phase W0-b-iii). Publishes on
  // every metronome start/stop/pause/resume; consumers (currently
  // just PunchAvatarCard's flip via CueStage) read it inside
  // `useFrameCallback` worklets. The port may not have exposed a
  // metronome yet on very old test doubles — the hook accepts
  // undefined and stays at SHARED_ANCHOR_STOPPED until one appears.
  const avatarAnchor = useSharedTransportAnchor(output.metronome?.transport)
  // UI-thread work clock (MVP v2, GH #305) — the runner re-anchors it at
  // phase boundaries; `useRingBeatClock` projects the walk from it per frame.
  const workClock = useSharedValue<SharedWorkClock>(SHARED_WORK_CLOCK_STOPPED)

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

  // Backdrop impulses only while punches are being thrown; between
  // phases the water calms rather than cutting — a bell stills it over
  // a second (the scene eases toward `calm`), pause leaves a near-still
  // sheen under the overlay.
  React.useEffect(() => {
    backdropBus.setActive(live.phase === 'work')
  }, [backdropBus, live.phase])
  const backdropCalm =
    live.phase === 'work' ? 1 : live.phase === 'countdown' || live.phase === 'rest' ? 0.35 : 0.15

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
      // M39-V2 Phase 5-iv: the per-punch phrase corpus retired; the
      // gate now reads from the combo-announce library, which is the
      // V2 source of truth for "coach can speak this combination."
      voiceReady: (notation) => findComboAnnounce(notation, vocabulary) !== undefined,
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
                  // Phase 5-iv: read the announce clip's measured length
                  // instead of the retired per-punch phrase clip.
                  const recite = findComboAnnounce(notation, vocabulary)?.durationMs
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
    workClock,
    stance: workout.recipe.defaultStance,
    clock,
    countdownMs: introMs,
    // `setEndOutcome` is stable, which the runner requires — an unstable
    // callback here would rebuild the cue engine on every render.
    onSessionEnded: setEndOutcome,
    voice,
    haptics,
    backdrop: backdropBus,
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
    // A pause holds the walkout in place (resume-in-place: the playlist
    // keeps its position, the completion deadline shifts by the pause);
    // any other departure from idle/countdown is the bell's authority —
    // a still-talking intro is cut, never waited on.
    if (live.phase === 'paused') {
      introRef.current?.pause()
      return
    }
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
    if (live.phase === 'paused') {
      // Resume-in-place: hold a talking warning where it is — replaying
      // it from the top on resume would run into the bell.
      warnRef.current?.pause()
      return
    }
    if (live.phase !== 'rest') {
      warnRef.current?.stop()
      return
    }
    warnRef.current ??= new RoundWarningPlayer()
    // During rest, roundIndex still names the round just finished; the
    // athlete is being readied for the NEXT one (1-based: index + 2).
    // The next round's theme ("Coming up — the Square Builder!") joins
    // the ceremony when a clip exists for it.
    // Pre-bell opener (Script Bible v2): the next round's first lead-in
    // joins the warn ceremony — theme, then the opening combo call, then
    // "get ready… three, two, one" onto the bell. The runner's in-round
    // scheduler skips s1 to match.
    const nextLead = findClickScript(`lead-in/${workout.id}/r${live.roundIndex + 2}s1`)
    warnRef.current.prepare(
      live.roundIndex + 2,
      workout.schedule[live.roundIndex + 1]?.theme,
      nextLead ? { module: nextLead.module, durationMs: nextLead.durationMs } : undefined,
    )
    warnRef.current.playIfDue(live.roundRemainingMs, volumes.voice)
  }, [live.phase, live.roundIndex, live.roundRemainingMs, policy.mode, volumes.voice, workout.id, workout.schedule])
  React.useEffect(() => () => warnRef.current?.stop(), [])

  // Inter-round recovery walkthrough — the cornerman works the corner
  // between rounds. One recovery script per rest, chosen deterministically
  // from the workout's seed; every rest gets a bell-clearance pause then
  // ~40s of guided mobility/breathing that finishes before the next-round
  // warning starts. Same doctrine as the warn effect: prepare on rest
  // entry, run every store tick, stop when the phase leaves rest.
  const recoveryPlan = React.useMemo(() => {
    const restCount = Math.max(0, workout.schedule.length - 1)
    // The warning owns the rest's tail; leave it worst-case room.
    const openerMax = Math.max(
      ...Array.from({ length: 15 }, (_, i) => {
        const key = `warn-opener-${String(i + 1).padStart(2, '0')}`
        return INTRO_SEGMENTS[key]?.durationMs ?? 0
      }),
    )
    const maxTotalMsFor = (restIndex: number): number => {
      const upcoming = workout.schedule[restIndex + 1]
      const coreKey = upcoming ? `warn-round-${restIndex + 2}` : ''
      const coreMs = INTRO_SEGMENTS[coreKey]?.durationMs ?? 0
      // The ACTUAL upcoming theme's clip, not the corpus-wide worst case:
      // the theme is known at plan time (it is the very value handed to
      // warnRef.prepare below), and budgeting the 8.7s outlier clip for
      // every rest starved the fit filter until exactly one recovery
      // script (R13) survived — every rest of every workout played the
      // same walkthrough, with the other twelve scripts unreachable.
      const themeMs =
        upcoming?.theme === undefined ? 0 : themeClipFor(upcoming.theme)?.durationMs ?? 0
      // The ACTUAL pre-bell opener clip for this rest's next round (same
      // known-at-plan-time reasoning as the theme above) — the warn
      // playlist now carries it between theme and countdown core.
      const leadMs =
        findClickScript(`lead-in/${workout.id}/r${restIndex + 2}s1`)?.durationMs ?? 0
      // openerMax + 350 breath + theme + 350 breath + lead(+350 when
      // present) + core + 400 slack + 500 margin.
      const warnWorstMs =
        openerMax + 350 + themeMs + 350 + (leadMs > 0 ? leadMs + 350 : 0) + coreMs + 400 + 500
      const restMs = upcoming ? workout.schedule[restIndex]?.restAfterMs ?? 0 : 0
      return Math.max(0, restMs - 1_000 - warnWorstMs)
    }
    return planRecoverySequence(
      RECOVERY_SCRIPTS,
      restCount,
      workout.recipe.seed,
      { maxTotalMsFor },
    )
  }, [workout.id, workout.recipe.seed, workout.schedule])

  // Pre-bell hold indicator (Script Bible v2): HOW a round starts — its
  // opening bar's slots + rate — shown while the coach calls it out
  // (countdown for round 1, the rest header for rounds 2+).
  const holdForRound = React.useCallback(
    (roundIndex: number): { tokens: string[]; rateWord: string } | undefined => {
      const block = workout.schedule[roundIndex]?.blocks[0]
      if (!block || block.tokens.length === 0) return undefined
      const tokens = block.tokens.map((t) =>
        t.kind === 'punch' ? `${t.number}${t.body ? 'b' : ''}` : '.',
      )
      const first = block.tokens[0]?.beatOffset ?? 0
      const second = block.tokens[1]?.beatOffset
      const step = second === undefined ? 1 : second - first
      const rateWord =
        step <= 0.55 ? 'double-time' : step <= 0.75 ? 'time-and-a-half' : 'straight time'
      return { tokens, rateWord }
    },
    [workout.schedule],
  )
  const upNextHold = React.useMemo(() => holdForRound(0), [holdForRound])

  const recoveryRef = useRef<RecoveryPlayer | null>(null)
  React.useEffect(() => {
    if (policy.mode === 'off') return
    if (live.phase === 'paused') {
      // Resume-in-place: hold the walkthrough where it is rather than
      // restarting it from the top over the round warning.
      recoveryRef.current?.pause()
      return
    }
    if (live.phase !== 'rest') {
      recoveryRef.current?.stop()
      return
    }
    // Script Bible v2 (Kyle, 2026-09-01): a click workout carries its own
    // AUTHORED rest script per rest — coach copy naming the next round's
    // opening set. When one exists it REPLACES the generic recovery
    // walkthrough for that rest (swap, not stack: the rest window's head
    // belongs to exactly one voice; the warn-round countdown keeps the
    // tail either way). Wrapped as a one-segment RecoveryScript so the
    // whole bell-clearance / pause-in-place / playIfDue machinery is
    // inherited rather than duplicated.
    const clickRest = findClickScript(`rest/${workout.id}/r${live.roundIndex + 1}`)
    const script: RecoveryScript | undefined = clickRest
      ? {
          scriptId: clickRest.id,
          title: 'Round rest script',
          category: 'click-script',
          tags: [],
          hydrationPrompt: false,
          requiresStableBag: false,
          avoidIfDizzy: false,
          segments: [{ module: clickRest.module, durationMs: clickRest.durationMs, pauseAfterMs: 0 }],
          measuredTotalMs: clickRest.durationMs,
          corpusVersion: 'click-scripts',
        }
      : RECOVERY_SCRIPTS.find((s) => s.scriptId === recoveryPlan[live.roundIndex])
    if (!script) return
    recoveryRef.current ??= new RecoveryPlayer()
    recoveryRef.current.prepare(script)
    // Rest elapsed from the same monotonic timer the rest phase reads —
    // never a wall clock, never a timer of its own (D6). Duplicated
    // rather than lifted from the render body: this effect fires on
    // every store tick and the derivation is a single subtraction.
    const restMs = workout.schedule[Math.max(0, live.roundIndex)]?.restAfterMs ?? 0
    const elapsedMs = Math.max(0, restMs - live.roundRemainingMs)
    recoveryRef.current.playIfDue(elapsedMs, volumes.voice)
  }, [
    live.phase,
    live.roundIndex,
    live.roundRemainingMs,
    policy.mode,
    volumes.voice,
    recoveryPlan,
    workout.id,
    workout.schedule,
  ])
  React.useEffect(() => () => recoveryRef.current?.stop(), [])

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

  // The tab bar is hidden on this screen, so nothing holds the content off
  // the Android system bar any more — without this inset the entire
  // control strip (Stop/Pause/Skip/Repeat) laid out UNDER the taskbar:
  // present in the accessibility tree, invisible on the glass, untappable.
  const insets = useSafeAreaInsets()

  // Rest presentation (M33-04). Elapsed is derived from the remaining time
  // the session clock already publishes — the sub-phases read the same
  // monotonic timer as the rest itself, never a timer of their own (D6).
  const frozen = live.frozenRoundResult
  const restDurationMs = workout.schedule[Math.max(0, live.roundIndex)]?.restAfterMs ?? 0
  const restElapsedMs = Math.max(0, restDurationMs - live.roundRemainingMs)
  const preview = nextRoundPreview(workout.schedule[live.roundIndex + 1], live.stance)

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]} testID="live-screen">
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
        {/* The reactive layer draws OVER the art and UNDER the scrim, so
            the §31.3 contrast floor caps everything it can ever do. */}
        {/* EXPERIMENT (GH #305): the walk census shows ~20 UI-thread frame
            gaps per round (max ~0.9s) swallowing walk steps, and the Skia
            membrane repaints every frame on that same thread. Click sets
            (voiceMode minimal — the walk IS the product) run without the
            reactive layer for one verdict round: multi-jumps -> ~0
            convicts the backdrop; unchanged exonerates it. Static art +
            scrim remain either way. */}
        {workout.recipe.voiceMode === 'minimal' ? null : (
          <BackdropRenderer
            bus={backdropBus}
            quality={backdropQuality}
            calm={backdropCalm}
            reducedMotion={reducedMotion}
          />
        )}
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
          // Idle only: tapping the glove chips re-arms the auto-connect
          // chase with a fresh budget — the manual push Kyle's retry rule
          // requires once the budget goes dormant, reachable without
          // leaving the screen. Mid-workout the chips stay display-only
          // (no radio churn while punches stream).
          {...(live.phase === 'idle'
            ? {
                onReconnectPress: () => {
                  void armAutoRetry({ timeoutMs: 10_000 })
                },
              }
            : {})}
        />
      </View>

      <View style={styles.body}>
        <View style={styles.stage}>
          {live.phase === 'idle' ? (
            // "Hit it!" begins the rounds — the recipe screen's
            // start_workout art is the doorway, this is the bell.
            <ActionButton action="hitIt" onPress={handleStart} testID="start-workout" />
          ) : live.phase === 'rest' && frozen ? (
            <RestPhases
              frozen={frozen}
              {...(preview ? { nextRound: preview } : {})}
              {...(() => {
                const hold = holdForRound(live.roundIndex + 1)
                return hold ? { upNext: hold } : {}
              })()}
              restElapsedMs={restElapsedMs}
              restDurationMs={restDurationMs}
              onSkipRest={runner.skipRest}
              reducedMotion={reducedMotion}
            />
          ) : (
            <CueStage
              {...(cues.current ? { current: cues.current } : {})}
              {...(cues.next ? { next: cues.next } : {})}
              {...(live.phase === 'countdown' && upNextHold ? { upNext: upNextHold } : {})}
              {...(cues.avatar ? { avatar: cues.avatar } : {})}
              {...(cues.freeWork ? { idleLabel: 'Free work — keep your hands moving' } : {})}
              reducedMotion={reducedMotion}
              avatarAnchor={avatarAnchor}
        workClock={workClock}
        {...(cues.walkPlan ? { walkPlan: cues.walkPlan } : {})}
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
            ...(live.peakVelocity ? { 'peak-velocity': live.peakVelocity.value.toFixed(2) } : {}),
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
  saveNote: {
    marginTop: 6,
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
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
    paddingHorizontal: 18,
    // Pill + chrome-rim motif, matching the authored button art.
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderTopColor: colors.textMuted,
    borderBottomColor: colors.background,
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
