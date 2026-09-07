/**
 * M34-01 voice latency spike harness (#195), extended for the instrument.
 *
 * Answers one question: can a cached clip be made audible within a bounded,
 * low-jitter delay of the moment it was asked for, on the TB125FU?
 *
 * ## The ARMED cases, and why they were added
 *
 * The original `preloaded` case measured 149.9 ms median on this tablet
 * (docs/puncheokie-voice-spike.md:92) — a number since used to argue that
 * expo-audio is too slow to monitor a live instrument on. But that case
 * calls `seekTo(0)` and then starts the clock BEFORE `play()`, and `seekTo`
 * is async, so the seek is still in flight while the clock runs. The
 * shipping instrument never does that: `fireOneShot` arms its pooled player
 * ahead of time and its hot path is a bare `player.play()` with zero awaits
 * (InstrumentVoiceOutput.ts:400-407).
 *
 * `armed` reproduces that faithfully — same player, same clip, same timing
 * method, with the arming AWAITED before the clock starts. The gap between
 * `preloaded` and `armed` is therefore the cost of the seek, not of the
 * audio engine. `armed-kit` repeats it on a real rendered kit one-shot so
 * the figure includes the shipped file's decode and attack.
 *
 * ## What the answer decides
 *
 * Whether the tablet can host silent live monitoring on expo-audio, or
 * whether the instrument needs a low-latency engine (Oboe/AAudio). The
 * tablet declares `android.hardware.audio.low_latency` and AudioFlinger
 * shows a fast path at ~10 ms sitting COLD_IDLE, but media3 floors its PCM
 * buffer at 250 ms, so our tracks run at Flags 0x000 and never reach it.
 *
 *   armed median <= 40 ms and jitter <= 15 ms  -> ship on expo-audio
 *   armed median >  60 ms or  jitter >  25 ms  -> migrate the instrument
 *
 * Jitter is still the gate, not the median: a constant offset cancels out
 * of p95 - median, and for an instrument bounded jitter matters more than a
 * low average.
 *
 * ## What is actually being timed
 *
 * `trigger → first audio sample rendered`, measured with the player's own
 * `audioSampleUpdate` callback. That callback fires when PCM frames are
 * flowing through the render pipeline, which is the closest thing the JS
 * side can observe to "the sound started".
 *
 * It is **not** the full acoustic latency: the DAC, the mixer and the
 * speaker add a further constant that no in-app measurement can see. That
 * matters less than it sounds, because the go/no-go gate is **jitter**
 * (p95 − median), and a constant offset cancels out of a difference. The
 * offset itself is a one-time calibration with an external recorder, and it
 * only sets the lead-time constant — it cannot change the GO/NO-GO.
 *
 * Every number this screen reports is therefore labelled for what it is.
 *
 * ## Why tones rather than words
 *
 * A synthetic tone starts at full amplitude on sample zero. A spoken word
 * ramps in, and the ramp is indistinguishable from latency. See
 * `tools/spike/make-voice-test-assets.mjs`.
 */
import React, { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useFocusEffect } from 'expo-router'
import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioSample,
} from 'expo-audio'
import * as Speech from 'expo-speech'
import { AudioContext as OboeAudioContext } from 'react-native-audio-api'
import { releaseAudioPlayer } from '@audio/nativeAudioTeardown'

import { colors } from '@/theme/colors'
import { INSTRUMENT_KIT_DRUMS } from '@audio/voiceAssets/instrumentBankManifest'

/** Doc §19.2: report p95, never an average. */
const REPS = 30
/** Gap between reps, long enough that the previous clip has finished. */
const REP_GAP_MS = 1_200

/**
 * Status updates as fast as the module allows.
 *
 * The default is 500 ms. `currentTime` reads through to native rather than
 * waiting on a status event, but pinning this low removes the doubt
 * entirely — otherwise every number here could be the polling interval
 * wearing a latency costume.
 */
const PLAYER_OPTIONS = { updateInterval: 10 } as const

// Metro resolves static assets through `require`; there is no import form
// that yields the module id `expo-audio` needs. M34-04's manifest will hit
// the same rule for every clip and should carry a scoped override.
/* eslint-disable @typescript-eslint/no-require-imports */
const SHORT_CLIP = require('../../../assets/spike-voice/tone-short.wav')
const LONG_CLIP = require('../../../assets/spike-voice/tone-long.wav')
/* eslint-enable @typescript-eslint/no-require-imports */

type CaseId = 'preloaded' | 'armed' | 'armed-kit' | 'cold' | 'tts-phrase' | 'tts-number'

interface CaseResult {
  id: CaseId
  label: string
  samples: number[]
  medianMs: number
  p95Ms: number
  jitterMs: number
  note?: string
}

/** Nearest-rank percentile — no interpolation, so every value is a real one. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? NaN
}

function summarize(id: CaseId, label: string, samples: number[], note?: string): CaseResult {
  const sorted = [...samples].sort((a, b) => a - b)
  const medianMs = percentile(sorted, 50)
  const p95Ms = percentile(sorted, 95)
  return {
    id,
    label,
    samples,
    medianMs: Math.round(medianMs * 10) / 10,
    p95Ms: Math.round(p95Ms * 10) / 10,
    jitterMs: Math.round((p95Ms - medianMs) * 10) / 10,
    ...(note ? { note } : {}),
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Fallback timing: poll `currentTime` until the playhead moves.
 *
 * Used when audio sampling is unavailable. It observes a different thing —
 * the playhead advancing, rather than PCM frames being rendered — and its
 * resolution is one JS loop turn, so it is reported as its own method
 * rather than mixed into the sampling numbers.
 */
async function timeToPlayheadMove(player: AudioPlayer, timeoutMs = 3_000): Promise<number | null> {
  player.seekTo(0)
  const startedAt = performance.now()
  player.play()
  for (;;) {
    if (player.currentTime > 0) return performance.now() - startedAt
    if (performance.now() - startedAt > timeoutMs) return null
    // Yield to the event loop; a tight spin would block the very update
    // being waited for.
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
}

/**
 * Park a player at zero the way `InstrumentVoiceOutput` arms its pool
 * (InstrumentVoiceOutput.ts:383-399), and AWAIT it.
 *
 * Pause FIRST, then seek: a player parked "playing" at end-of-stream resumes
 * on a lone `seekTo(0)` — the voice-storm lesson. Awaiting the seek is the
 * whole point: arming must be finished before the clock starts, or the
 * measurement swallows it.
 */
async function armPlayer(player: AudioPlayer): Promise<void> {
  try {
    player.pause()
  } catch {
    // Already stopped at end-of-stream.
  }
  await Promise.resolve(player.seekTo(0)).catch(() => undefined)
  // seekTo resolving is not proof the playhead landed; give the native side
  // a beat, then verify. Bounded so a stalled seek cannot hang the run.
  for (let i = 0; i < 40 && player.currentTime > 0.001; i += 1) await sleep(5)
}

/**
 * Time the INSTRUMENT's real hot path: one bare `play()` on an ALREADY-ARMED
 * player, with no seek inside the measurement.
 *
 * This is the case the original harness never covered. Its `preloaded` case
 * calls `seekTo(0)` and then starts the clock before `play()` (see
 * `timeToFirstSample`), and `seekTo` is async — so the seek is still in
 * flight when the clock is running and its cost lands in the number. The
 * shipping instrument does not do that: `fireOneShot` arms the player ahead
 * of time and the hot path is `player.play()` alone, zero awaits
 * (InstrumentVoiceOutput.ts:400-407).
 *
 * The gap between this and `preloaded` is therefore the cost of the seek,
 * not of the engine — which is exactly what has to be separated before
 * deciding whether the audio engine needs replacing at all.
 */
async function timeArmedPlay(
  player: AudioPlayer,
  method: 'sampling' | 'playhead',
  timeoutMs = 3_000,
): Promise<number | null> {
  if (method === 'playhead') {
    const startedAt = performance.now()
    player.play()
    for (;;) {
      if (player.currentTime > 0) return performance.now() - startedAt
      if (performance.now() - startedAt > timeoutMs) return null
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
    }
  }
  return new Promise((resolve) => {
    let settled = false
    const subscription = player.addListener('audioSampleUpdate', (sample: AudioSample) => {
      if (settled) return
      const peak = sample.channels[0]?.frames.reduce((m, f) => Math.max(m, Math.abs(f)), 0) ?? 0
      if (peak < 0.01) return
      settled = true
      const elapsed = performance.now() - startedAt
      subscription.remove()
      resolve(elapsed)
    })
    setTimeout(() => {
      if (settled) return
      settled = true
      subscription.remove()
      resolve(null)
    }, timeoutMs)
    // NOTHING between the clock and play(). That is the measurement.
    const startedAt = performance.now()
    player.play()
  })
}

/**
 * Time one playback: trigger, then wait for the first rendered sample.
 *
 * Resolves `null` on timeout rather than recording a wrong number — a
 * missing measurement is honest, an invented one is not.
 */
async function timeToFirstSample(player: AudioPlayer, timeoutMs = 3_000): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    const subscription = player.addListener('audioSampleUpdate', (sample: AudioSample) => {
      if (settled) return
      // Ignore the silent lead-in some pipelines emit before real audio.
      const peak = sample.channels[0]?.frames.reduce((m, f) => Math.max(m, Math.abs(f)), 0) ?? 0
      if (peak < 0.01) return
      settled = true
      const elapsed = performance.now() - startedAt
      subscription.remove()
      resolve(elapsed)
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      subscription.remove()
      resolve(null)
    }, timeoutMs)

    player.seekTo(0)
    const startedAt = performance.now()
    player.play()
    void timer
  })
}

/** Time an `expo-speech` utterance from trigger to its `onStart`. */
async function timeSpeech(text: string, timeoutMs = 5_000): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    const startedAt = performance.now()
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(null)
      }
    }, timeoutMs)
    Speech.speak(text, {
      onStart: () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(performance.now() - startedAt)
      },
      onError: () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(null)
      },
    })
  })
}

export default function VoiceLatencySpike(): React.JSX.Element {
  const [log, setLog] = useState<string[]>([])
  const [results, setResults] = useState<CaseResult[]>([])
  const [running, setRunning] = useState(false)
  const preloadedRef = useRef<AudioPlayer | null>(null)

  // This screen had NO cleanup at all: the preloaded sampling player was
  // created once and never freed, so one visit held a native handle (and an
  // enabled audio-sampling callback) for the rest of the session
  // (GH #357 audit).
  useFocusEffect(
    useCallback(
      () => () => {
        releaseAudioPlayer(preloadedRef.current)
        preloadedRef.current = null
      },
      [],
    ),
  )
  /** Which timing method the run actually used; they measure different things. */
  const methodRef = useRef<'sampling' | 'playhead'>('playhead')

  const say = useCallback((line: string) => {
    setLog((prev) => [...prev, line])
  }, [])

  /**
   * Step 0 probe (audio-engine-migration.md): does the Oboe native module
   * actually resolve, and will it open a stream?
   *
   * A dev client only carries native code compiled into it, so this failing
   * with "native module could not be found" means the APK is stale rather
   * than the code being wrong. Reporting the sample rate proves the stream
   * opened: 48000 matches the rendered bank, and anything else means decode
   * would resample on every hit.
   */
  const probeOboe = useCallback(() => {
    try {
      const ctx = new OboeAudioContext()
      say(`OBOE ok — sampleRate=${ctx.sampleRate} state=${ctx.state}`)
      // A zero-length silent source forces the driver to start, which is
      // what actually opens the Oboe stream; constructing the context alone
      // does not.
      const src = ctx.createBufferSource()
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      src.connect(ctx.destination)
      src.start(0)
      say(`OBOE stream started — state=${ctx.state}`)
    } catch (err) {
      say(`OBOE FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [say])

  const run = useCallback(
    async (mode: 'duckOthers' | 'mixWithOthers', forceMethod?: 'sampling' | 'playhead') => {
      setRunning(true)
      setResults([])
      setLog([])
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          // 'duckOthers' is the transient may-duck focus request. It asks the
          // platform to lower other apps; it never touches their audio.
          interruptionMode: mode,
          shouldPlayInBackground: false,
        })
        say(`audio mode: interruptionMode=${mode}`)

        // Audio sampling needs RECORD_AUDIO on Android. Without it the
        // callback simply never fires, which looks exactly like a hang —
        // so ask, and say plainly which method the numbers came from.
        const permission = await requestRecordingPermissionsAsync()
        say(`record permission: ${permission.status}`)

        // --- (a) preloaded ------------------------------------------------
        const preloaded = preloadedRef.current ?? createAudioPlayer(SHORT_CLIP, PLAYER_OPTIONS)
        preloadedRef.current = preloaded
        const samplingSupported = preloaded.isAudioSamplingSupported && permission.granted
        if (samplingSupported) preloaded.setAudioSamplingEnabled(true)
        // `audioSampleUpdate` reports supported=true on this tablet but has
        // been observed delivering no samples above the silence threshold,
        // which turns every rep into a TIMEOUT and yields no data at all.
        // The playhead override trades resolution for numbers that exist:
        // it observes the playhead advancing rather than PCM frames, so it
        // is coarser (one JS loop turn) and is labelled as its own method
        // rather than mixed into the sampling figures.
        methodRef.current = forceMethod ?? (samplingSupported ? 'sampling' : 'playhead')
        if (forceMethod !== undefined) say(`method FORCED to ${forceMethod}`)
        say(
          `sampling supported=${String(preloaded.isAudioSamplingSupported)} ` +
            `→ method=${methodRef.current}`,
        )
        const timeOne = (p: AudioPlayer): Promise<number | null> =>
          methodRef.current === 'sampling' ? timeToFirstSample(p) : timeToPlayheadMove(p)
        // Let it finish loading before the first timed rep, or rep 1 would
        // measure the load and skew the median.
        for (let i = 0; i < 50 && !preloaded.isLoaded; i += 1) await sleep(50)
        say(`preloaded player loaded=${String(preloaded.isLoaded)}`)

        const warm: number[] = []
        for (let i = 0; i < REPS; i += 1) {
          const ms = await timeOne(preloaded)
          if (ms !== null) warm.push(ms)
          say(`preloaded ${i + 1}/${REPS}: ${ms === null ? 'TIMEOUT' : `${ms.toFixed(1)} ms`}`)
          await sleep(REP_GAP_MS)
        }
        setResults((r) => [
          ...r,
          summarize('preloaded', 'Preloaded clip', warm, `method: ${methodRef.current}`),
        ])

        // --- (a2) ARMED — the instrument's real hot path -------------------
        // Same player, same clip, same timing method as (a). The ONLY
        // difference is that the seek happens BEFORE the clock rather than
        // inside it. Any gap between (a) and (a2) is the seek, not the
        // engine — and that distinction decides whether expo-audio needs
        // replacing for live monitoring at all.
        const armedWarm: number[] = []
        for (let i = 0; i < REPS; i += 1) {
          await armPlayer(preloaded)
          const ms = await timeArmedPlay(preloaded, methodRef.current)
          if (ms !== null) armedWarm.push(ms)
          say(`armed ${i + 1}/${REPS}: ${ms === null ? 'TIMEOUT' : `${ms.toFixed(1)} ms`}`)
          await sleep(REP_GAP_MS)
        }
        setResults((r) => [
          ...r,
          summarize(
            'armed',
            'ARMED player — instrument hot path',
            armedWarm,
            `bare play(), no seek in the measurement; method: ${methodRef.current}`,
          ),
        ])

        // --- (a3) ARMED, real kit one-shot --------------------------------
        // (a2) uses the spike's synthetic tone, which starts at full
        // amplitude on sample zero — ideal for isolating latency, but not
        // what ships. This repeats it on an actual rendered kit clip so the
        // number includes the real file's decode and its attack ramp.
        const kitClip = INSTRUMENT_KIT_DRUMS['snare-center']
        const kitPlayer = createAudioPlayer(kitClip.module, PLAYER_OPTIONS)
        if (methodRef.current === 'sampling') kitPlayer.setAudioSamplingEnabled(true)
        for (let i = 0; i < 50 && !kitPlayer.isLoaded; i += 1) await sleep(50)
        say(`kit player (snare-center) loaded=${String(kitPlayer.isLoaded)}`)
        const armedKit: number[] = []
        for (let i = 0; i < REPS; i += 1) {
          await armPlayer(kitPlayer)
          const ms = await timeArmedPlay(kitPlayer, methodRef.current)
          if (ms !== null) armedKit.push(ms)
          say(`armed-kit ${i + 1}/${REPS}: ${ms === null ? 'TIMEOUT' : `${ms.toFixed(1)} ms`}`)
          await sleep(REP_GAP_MS)
        }
        releaseAudioPlayer(kitPlayer)
        setResults((r) => [
          ...r,
          summarize(
            'armed-kit',
            'ARMED player — real kit one-shot',
            armedKit,
            `snare-center from the shipped bank; method: ${methodRef.current}`,
          ),
        ])

        // --- (b) cold -----------------------------------------------------
        const cold: number[] = []
        for (let i = 0; i < REPS; i += 1) {
          // A brand new player each rep: this is the cost of *not* preloading.
          const player = createAudioPlayer(LONG_CLIP, PLAYER_OPTIONS)
          if (methodRef.current === 'sampling') player.setAudioSamplingEnabled(true)
          const ms = await timeOne(player)
          if (ms !== null) cold.push(ms)
          say(`cold ${i + 1}/${REPS}: ${ms === null ? 'TIMEOUT' : `${ms.toFixed(1)} ms`}`)
          player.remove()
          await sleep(REP_GAP_MS)
        }
        setResults((r) => [
          ...r,
          summarize(
            'cold',
            'Cold clip (new player each rep)',
            cold,
            `includes load + decode; method: ${methodRef.current}`,
          ),
        ])

        // --- (c) TTS phrase ----------------------------------------------
        const phrase: number[] = []
        for (let i = 0; i < REPS; i += 1) {
          const ms = await timeSpeech('one two three two')
          if (ms !== null) phrase.push(ms)
          say(`tts phrase ${i + 1}/${REPS}: ${ms === null ? 'TIMEOUT' : `${ms.toFixed(1)} ms`}`)
          await sleep(REP_GAP_MS)
        }
        setResults((r) => [
          ...r,
          summarize('tts-phrase', 'expo-speech phrase', phrase, 'onStart, not acoustic onset'),
        ])

        // --- (d) TTS single number ---------------------------------------
        const single: number[] = []
        for (let i = 0; i < REPS; i += 1) {
          const ms = await timeSpeech('one')
          if (ms !== null) single.push(ms)
          say(`tts number ${i + 1}/${REPS}: ${ms === null ? 'TIMEOUT' : `${ms.toFixed(1)} ms`}`)
          await sleep(REP_GAP_MS)
        }
        setResults((r) => [
          ...r,
          summarize('tts-number', 'expo-speech single number', single, 'onStart, not acoustic'),
        ])

        say('done')
      } catch (err) {
        say(`FAILED: ${String(err)}`)
      } finally {
        setRunning(false)
      }
    },
    [say],
  )

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'M34-01 voice latency spike' }} />

      <Text style={styles.heading}>Voice latency spike (#195)</Text>
      <Text style={styles.note}>
        Measures trigger to first rendered audio sample. Not acoustic latency — the DAC and speaker
        add a constant this cannot see. The go/no-go gate is jitter, which a constant does not
        affect.
      </Text>

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={running}
          onPress={() => void run('mixWithOthers')}
          style={[styles.button, running && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Run (mix)</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={running}
          onPress={() => void run('duckOthers')}
          style={[styles.button, running && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Run (duck others)</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={running}
          onPress={() => void run('mixWithOthers', 'playhead')}
          style={[styles.button, running && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Run (mix, playhead)</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={probeOboe}
          style={styles.button}
          testID="probe-oboe"
        >
          <Text style={styles.buttonText}>Probe Oboe</Text>
        </Pressable>
      </View>

      {results.map((r) => (
        <View key={r.id} style={styles.result}>
          <Text style={styles.resultLabel}>{r.label}</Text>
          <Text style={styles.resultValue}>
            {`n=${r.samples.length}  median ${r.medianMs} ms  p95 ${r.p95Ms} ms  jitter ${r.jitterMs} ms`}
          </Text>
          {r.note ? <Text style={styles.note}>{r.note}</Text> : null}
        </View>
      ))}

      <Text style={styles.logHeading}>Log</Text>
      {log.map((line, i) => (
        <Text key={`${i}-${line}`} style={styles.log}>
          {line}
        </Text>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 12, paddingBottom: 60 },
  heading: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  note: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  row: { flexDirection: 'row', gap: 12, marginVertical: 8 },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 15, fontWeight: '700', color: colors.textOnAccent },
  result: { gap: 2, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  resultLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  resultValue: { fontSize: 13, color: colors.textSecondary, fontFamily: 'monospace' },
  logHeading: { marginTop: 16, fontSize: 12, fontWeight: '700', color: colors.textMuted },
  log: { fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' },
})
