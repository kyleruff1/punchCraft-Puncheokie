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
import {
  AudioContext as OboeAudioContext,
  type AnalyserNode as OboeAnalyser,
  type AudioBuffer as OboeBuffer,
} from 'react-native-audio-api'
import { releaseAudioPlayer } from '@audio/nativeAudioTeardown'
import { logger, safe } from '@/diagnostics/logger'
import { findClickScript } from '@audio/voiceAssets/clickScriptManifest'

import { colors } from '@/theme/colors'
import { INSTRUMENT_KIT_DRUMS } from '@audio/voiceAssets/instrumentBankManifest'
import { SIM_SCRIPTS } from '@simulation/scripts'
import {
  createRollingScaler,
  HIGH_SENSITIVITY_ACCELERATION_DEFAULTS,
} from '@domain/instrument/rollingScale'

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
/** The round bell — the only coach asset rendered at 24 kHz, and the slowest measured. */
const BELL_MODULE = require('../../../assets/voice/numbers/standalone/bell.wav')
/* eslint-enable @typescript-eslint/no-require-imports */

type CaseId =
  | 'preloaded'
  | 'armed'
  | 'armed-kit'
  | 'armed-oboe'
  | 'cold'
  | 'tts-phrase'
  | 'tts-number'

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
/**
 * RULER CALIBRATION (2026-09-07). Fire ONE play and time it two ways at once.
 *
 * Why this exists: the shipping coach observer calls a play's onset the moment
 * `playbackStatusUpdate` reports `playing: true`. Across two full release
 * sessions that event arrived with `positionAtOnsetMs === 0` in 296 of 296
 * observations — media3 asserts "playing" with the playhead still at zero, on
 * a buffer floored at 250 ms. So the number every coach latency figure in this
 * project is built on does not measure sound leaving the device.
 *
 * This measures the same play against the playhead actually MOVING. The gap is
 * the skew our reported onsets are optimistic by. It is a LOWER bound on the
 * true skew, twice over: the playhead crossing zero is itself earlier than
 * audio reaching the speaker, and `currentTime` is a blocking `runOnMain` hop
 * resolved to one JS loop turn, so it reads late and compresses the gap.
 *
 * The third candidate instrument, `audioSampleUpdate` (real PCM frames), is
 * NOT usable here: it reports `supported: true` on this tablet and delivers no
 * samples above the silence threshold — every rep times out
 * (docs/puncheokie-voice-spike.md:396). It is also post-volume, so it could
 * never work on the muted unattended runs.
 */
async function timeBothClocks(
  player: AudioPlayer,
  timeoutMs = 3_000,
): Promise<{ statusMs: number | null; playheadMs: number | null; startedEpochMs: number }> {
  let statusMs: number | null = null
  const startedAt = performance.now()
  // Wall epoch of the SAME instant as `startedAt`, so a mic recording made on
  // another machine can be placed against these plays. `performance.now()`
  // alone is a device-local origin with no meaning off the device; the two are
  // read back-to-back so the pair is good to well under a millisecond, and the
  // window they anchor is ~3 s, far too short for the two clocks to diverge.
  const startedEpochMs = Date.now()
  // Attached BEFORE play() so the transition cannot be missed. This is the
  // exact predicate PlaybackObserver.onStatus uses for onset.
  const subscription = player.addListener('playbackStatusUpdate', (status: { playing?: boolean }) => {
    if (statusMs === null && status.playing === true) statusMs = performance.now() - startedAt
  })
  player.play()
  let playheadMs: number | null = null
  for (;;) {
    if (player.currentTime > 0) {
      playheadMs = performance.now() - startedAt
      break
    }
    if (performance.now() - startedAt > timeoutMs) break
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  // Give a status event that is merely slow a fair chance to land before the
  // pair is scored — otherwise a late callback would read as "never fired".
  if (statusMs === null) await new Promise<void>((resolve) => setTimeout(resolve, 120))
  subscription.remove()
  return { statusMs, playheadMs, startedEpochMs }
}

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
 * Time one Oboe trigger, by the SAME class of measurement as `armed-kit`.
 *
 * There is no playhead to poll here — Web Audio source nodes are fire-and-
 * forget — so an AnalyserNode is tapped instead and polled for the first
 * non-silent frame. That keeps the comparison honest: both this and the
 * expo-audio `armed-kit` figure are JS-polled at one loop turn of resolution,
 * so the DIFFERENCE between them is meaningful even though neither is a true
 * acoustic latency.
 *
 * A fresh source node per trigger is mandatory, not a choice: `.buffer` may be
 * set once and `start()` called once (AudioBufferSourceNode.ts:39-48, :101-107).
 * That is also why this path cannot truncate a still-sounding hit the way the
 * expo-audio pool does.
 */
async function timeArmedOboe(
  ctx: OboeAudioContext,
  buffer: OboeBuffer,
  analyser: OboeAnalyser,
  data: Uint8Array,
  timeoutMs = 3_000,
): Promise<number | null> {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(analyser)
  const startedAt = performance.now()
  src.start(0)
  for (;;) {
    analyser.getByteTimeDomainData(data)
    let peak = 0
    for (let i = 0; i < data.length; i += 1) {
      peak = Math.max(peak, Math.abs((data[i] ?? 128) - 128))
    }
    // 128 is silence for byte time-domain data; >2 clears dither/noise.
    if (peak > 2) return performance.now() - startedAt
    if (performance.now() - startedAt > timeoutMs) return null
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
}

  /**
   * Read the RENDERED amplitude of each captured punch — silently.
   *
   * The analyser sits upstream of `destination`, so it sees the graph's own
   * samples regardless of output volume: the tablet can be muted and this
   * still measures real audio. No microphone, no noise, no ear required.
   *
   * What it proves: that the acceleration retune actually spreads dynamics in
   * the audio, not merely in the numbers. Before the retune a quarter of these
   * punches pinned at MIDI 127; if the fix works, the measured peaks should
   * spread instead of clustering at the top.
   */
  /**
   * RULER CALIBRATION — how optimistic is the coach's reported onset?
   *
   * Runs on REAL shipped coach clips (the click-script bank the workouts
   * actually play), on the ARMED path the runner uses, and logs every pair so
   * an unattended drive can read the result out of logcat.
   */
  const probeRuler = useCallback(async () => {
    const REPS = 40
    try {
      // Real coach assets, not a synthetic tone: the question is about the
      // clips the workouts actually play. Two lengths, because the bell (the
      // one asset that is 24 kHz, and the slowest thing measured) may behave
      // differently from a 48 kHz call.
      const call = findClickScript('call/1-2-.-.', 'numbers') ?? findClickScript('call/1-1-2-.', 'numbers')
      const cases: { label: string; module: number }[] = [
        ...(call ? [{ label: `call ${call.id} (48k)`, module: call.module }] : []),
        { label: 'bell (24k)', module: BELL_MODULE },
      ]
      say(`ruler: ${cases.length} asset(s) x ${REPS} reps — status event vs playhead moving`)

      for (const c of cases) {
        const player = createAudioPlayer(c.module, PLAYER_OPTIONS)
        const pairs: { statusMs: number; playheadMs: number }[] = []
        // Arm once, then reuse — the runner's hot path is a bare play() on an
        // already-loaded player, and that is what we are calibrating.
        await new Promise<void>((resolve) => setTimeout(resolve, 400))
        for (let i = 0; i < REPS; i += 1) {
          player.seekTo(0)
          // RANDOMISED, and that is the whole point rather than a detail.
          //
          // With a fixed gap the plays and the recorded sounds are two
          // periodic sequences of the SAME period, so nothing in the data
          // says which sound belongs to which play — every candidate
          // alignment fits equally well, and the analysis is left picking one
          // by whether the answer looks reasonable. That is circular, and it
          // reported a clean, plausible 20 ms on a session where the clock
          // correction had been omitted entirely.
          //
          // An irregular gap makes the interval pattern unique, so exactly
          // one alignment produces tightly clustered residuals and the rest
          // scatter by the randomisation. The alignment then follows from the
          // data, and "is the answer plausible" goes back to being an
          // independent check instead of the selector.
          await new Promise<void>((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 300)))
          const { statusMs, playheadMs, startedEpochMs } = await timeBothClocks(player)
          if (statusMs !== null && playheadMs !== null) pairs.push({ statusMs, playheadMs })
          // One line per rep, carrying the WALL epoch of each event. The
          // aggregate below answers "how far does the status event understate
          // the playhead"; this answers "when, in a clock a microphone can
          // also be placed on, did each of those happen" — which is what
          // PLAYHEAD_TO_SPEAKER_MS needs, since the remaining unknown is
          // entirely off-device.
          logger.info('puncheokie.ruler.rep', 'rep timing', {
            asset: safe(c.label),
            rep: safe(i),
            startedEpochMs: safe(startedEpochMs),
            statusEpochMs: safe(statusMs === null ? null : Math.round(startedEpochMs + statusMs)),
            playheadEpochMs: safe(playheadMs === null ? null : Math.round(startedEpochMs + playheadMs)),
            statusMs: safe(statusMs === null ? null : Math.round(statusMs * 10) / 10),
            playheadMs: safe(playheadMs === null ? null : Math.round(playheadMs * 10) / 10),
          })
          player.pause()
          await new Promise<void>((resolve) => setTimeout(resolve, 150))
        }
        releaseAudioPlayer(player)

        if (pairs.length === 0) {
          say(`  ${c.label}: no paired samples (both clocks must fire)`)
          logger.info('puncheokie.ruler', 'no paired samples', { asset: safe(c.label) })
          continue
        }
        const med = (v: number[]): number => {
          const s = [...v].sort((a, b) => a - b)
          const m = Math.floor(s.length / 2)
          return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
        }
        const st = pairs.map((p) => p.statusMs)
        const ph = pairs.map((p) => p.playheadMs)
        const skew = pairs.map((p) => p.playheadMs - p.statusMs)
        const r = (v: number): number => Math.round(v * 10) / 10
        say(`  ${c.label}: n=${pairs.length} status=${r(med(st))} playhead=${r(med(ph))} SKEW=${r(med(skew))} ms`)
        logger.info('puncheokie.ruler', 'paired onset calibration', {
          asset: safe(c.label),
          n: safe(pairs.length),
          statusMedianMs: safe(r(med(st))),
          playheadMedianMs: safe(r(med(ph))),
          skewMedianMs: safe(r(med(skew))),
          skewMinMs: safe(r(Math.min(...skew))),
          skewMaxMs: safe(r(Math.max(...skew))),
        })
      }
      say('ruler: done — skew is how much our reported onsets UNDERSTATE, and it is a lower bound')
      logger.info('puncheokie.ruler.done', 'ruler calibration complete', { reps: safe(REPS) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      say(`ruler FAILED: ${message}`)
      logger.warn('puncheokie.ruler', 'calibration failed', { error: safe(message) })
    }
  }, [say])

  const probeDynamics = useCallback(async () => {
    try {
      const ctx = new OboeAudioContext({ sampleRate: 48000 })
      const buffer = await ctx.decodeAudioData(INSTRUMENT_KIT_DRUMS['snare-center'].module)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      // Silent by construction. A Web Audio node is only PULLED if it has a
      // path to `destination`, so the analyser cannot simply be left dangling
      // — it would never be fed. Routing it through a zero gain keeps the
      // graph rendering (so the analyser sees real samples) while nothing
      // reaches the speaker. That is what makes this measurable with the room
      // quiet and no microphone involved.
      const mute = ctx.createGain()
      mute.gain.value = 0
      analyser.connect(mute)
      mute.connect(ctx.destination)
      const frame = new Uint8Array(analyser.fftSize)

      const scaler = createRollingScaler(HIGH_SENSITIVITY_ACCELERATION_DEFAULTS)
      const captured = SIM_SCRIPTS['captured-jam']
      const peaks: number[] = []

      for (const step of captured) {
        const accel01 = scaler.scale('right', step.accelerationRaw)
        // The §9 uppercut lane, the same curve the kit uses.
        const midi = Math.round(75 + 52 * Math.pow(accel01, 0.72))
        const source = ctx.createBufferSource()
        source.buffer = buffer
        const level = ctx.createGain()
        level.gain.value = midi / 127
        source.connect(level)
        level.connect(analyser)
        source.start(0)

        // Sample the graph across the clip's attack and keep the loudest frame.
        let peak = 0
        for (let i = 0; i < 24; i += 1) {
          analyser.getByteTimeDomainData(frame)
          for (let n = 0; n < frame.length; n += 1) {
            peak = Math.max(peak, Math.abs((frame[n] ?? 128) - 128))
          }
          await sleep(4)
        }
        peaks.push(peak)
        say(`aRaw ${String(step.accelerationRaw).padStart(3)} → midi ${midi} → peak ${peak}`)
        await sleep(120)
      }

      const pinned = peaks.filter((p) => p >= Math.max(...peaks) - 1).length
      say(`RENDERED peaks: min ${Math.min(...peaks)} max ${Math.max(...peaks)} distinct ${new Set(peaks).size}/${peaks.length}, at-max ${pinned}`)
      void ctx.close().catch(() => undefined)
    } catch (err) {
      say(`dynamics probe FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [say])

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
    // Closed on every exit path: the probe's whole job is to prove a stream
    // opens, and leaving each proof running defeats the screen it sits on.
    let ctx: OboeAudioContext | null = null
    try {
      ctx = new OboeAudioContext()
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
    } finally {
      void ctx?.close().catch(() => undefined)
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

        // --- (a4) ARMED via OBOE — the migration's decisive comparison ----
        // Same clip as (a3), same JS-polled measurement class, so the delta
        // against armed-kit is the engine and nothing else. This is where
        // kill-criterion K3 fires: if this still lands near 100 ms or jitters
        // above ~25 ms, the audio engine was never the bottleneck and the
        // migration should stop here.
        // Held outside the try so every exit path can close it. An Oboe
        // context owns a live output stream; dropping the reference leaves
        // that stream open under whatever the jam or live screen opens next
        // — the same exhaustion class as the AudioTrack ceiling, on the
        // engine the app now ships on by default.
        let oboeCtx: OboeAudioContext | null = null
        try {
          oboeCtx = new OboeAudioContext()
          say(`oboe ctx sampleRate=${oboeCtx.sampleRate}`)
          const oboeBuffer = await oboeCtx.decodeAudioData(
            INSTRUMENT_KIT_DRUMS['snare-center'].module,
          )
          say(`oboe decoded snare-center: ${oboeBuffer.duration.toFixed(3)}s`)
          const analyser = oboeCtx.createAnalyser()
          analyser.fftSize = 2048
          analyser.connect(oboeCtx.destination)
          const probe = new Uint8Array(analyser.fftSize)
          // Open the stream BEFORE the first timed rep, or rep 1 measures the
          // Oboe stream-open cost instead of a trigger.
          const warm = oboeCtx.createBufferSource()
          warm.buffer = oboeCtx.createBuffer(1, 1, oboeCtx.sampleRate)
          warm.connect(oboeCtx.destination)
          warm.start(0)
          await sleep(400)
          say(`oboe stream state=${oboeCtx.state}`)

          const oboe: number[] = []
          for (let i = 0; i < REPS; i += 1) {
            const ms = await timeArmedOboe(oboeCtx, oboeBuffer, analyser, probe)
            if (ms !== null) oboe.push(ms)
            say(`armed-oboe ${i + 1}/${REPS}: ${ms === null ? 'TIMEOUT' : `${ms.toFixed(1)} ms`}`)
            await sleep(REP_GAP_MS)
          }
          setResults((r) => [
            ...r,
            summarize(
              'armed-oboe',
              'ARMED via OBOE — snare-center',
              oboe,
              'fresh source node per hit; analyser tap, JS-polled like the others',
            ),
          ])
        } catch (err) {
          say(`armed-oboe FAILED: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          void oboeCtx?.close().catch(() => undefined)
        }

        // --- (b) cold -----------------------------------------------------
        const cold: number[] = []
        for (let i = 0; i < REPS; i += 1) {
          // A brand new player each rep: this is the cost of *not* preloading.
          const player = createAudioPlayer(LONG_CLIP, PLAYER_OPTIONS)
          if (methodRef.current === 'sampling') player.setAudioSamplingEnabled(true)
          const ms = await timeOne(player)
          if (ms !== null) cold.push(ms)
          say(`cold ${i + 1}/${REPS}: ${ms === null ? 'TIMEOUT' : `${ms.toFixed(1)} ms`}`)
          // `remove()` is a registry map-delete that frees no AudioTrack, so
          // this loop used to strand one live ExoPlayer per rep — REPS of them
          // per press. That does not merely leak: each rep then measured cold
          // loading against a progressively more starved audio stack, so the
          // number this harness exists to report was a function of its own
          // leak, and the tail reps could TIMEOUT for that reason alone.
          releaseAudioPlayer(player)
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
          accessibilityLabel="Calibrate ruler"
          testID="probe-ruler"
          onPress={() => void probeRuler()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Calibrate ruler (status vs playhead)</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={probeOboe}
          style={styles.button}
          testID="probe-oboe"
        >
          <Text style={styles.buttonText}>Probe Oboe</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void probeDynamics()}
          style={styles.button}
          testID="probe-dynamics"
        >
          <Text style={styles.buttonText}>Probe Dynamics (silent)</Text>
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
