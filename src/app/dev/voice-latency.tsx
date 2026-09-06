/**
 * M34-01 voice latency spike harness (#195). **Throwaway — spike branch only.**
 *
 * Answers one question: can a cached clip be made audible within a bounded,
 * low-jitter delay of the moment it was asked for, on the TB125FU?
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
import { releaseAudioPlayer } from '@audio/nativeAudioTeardown'

import { colors } from '@/theme/colors'

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

type CaseId = 'preloaded' | 'cold' | 'tts-phrase' | 'tts-number'

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

  const run = useCallback(
    async (mode: 'duckOthers' | 'mixWithOthers') => {
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
        methodRef.current = samplingSupported ? 'sampling' : 'playhead'
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
