/**
 * The instrument's voice on Oboe/AAudio (audio-engine-migration.md, step 3).
 *
 * Measured reason this exists, on the TB125FU: the expo-audio path lands a kit
 * one-shot at 119.4 ms median with 50.6 ms of jitter, and its AudioFlinger
 * track carries `Flags 0x000` with a 15104-frame buffer because media3 floors
 * its PCM buffer at 250 ms and is never admitted to the fast mixer. The same
 * clip through this engine measured 1.1 ms graph latency, and its track shows
 * up as fast-track index 1 at 48 kHz with a 512-frame buffer — 20.33 against
 * the old path's 101.25.
 *
 * ## What is different, structurally
 *
 * expo-audio gives you a stateful STREAM per sound: to play it twice you must
 * rewind it, which is why the old `fireOneShot` is 90 lines of pause / async
 * seek / re-arm / stalled-seek fallback / generation guard. Web Audio gives
 * you an immutable BUFFER plus a disposable source node: `.buffer` may be set
 * once and `start()` called once, so every hit allocates a fresh node and the
 * whole rewind problem disappears.
 *
 * That also fixes a musical defect rather than only a latency one. The old
 * pool cannot overlap a sample with itself — a fast repeat of the same stab
 * pauses and rewinds the sounding note, truncating it. Here both ring out.
 *
 * ## Why one AudioTrack instead of thirty
 *
 * Every stab and drum is a node inside ONE Oboe stream's graph, not a separate
 * native player. The instrument's footprint drops from 30 pooled players plus
 * 2 playlists to a single stream, which relieves rather than adds to the ~48
 * AudioTrack ceiling behind #356/#357.
 *
 * ## Loops (step 5)
 *
 * Bed and bass are looping source nodes in the same graph, not playlists on a
 * carried expo-audio delegate. That delegate is gone, and with it two costs
 * step 3 had to accept: it preloaded a 37-player pool it never used, and every
 * punch fired a silent legacy drum through it purely because
 * `selectInstrumentSamples` always names one.
 *
 * The bank's loops are rendered to be seamless by PERIODICITY and by
 * zero-amplitude boundaries (see tools/tablet-voice), so `loop = true` over
 * the whole buffer needs no crossfade — the loop point is already silent or
 * already phase-continuous.
 */
import {
  AudioContext,
  type AnalyserNode,
  type AudioBuffer,
  type AudioBufferSourceNode,
} from 'react-native-audio-api'

import { logger, safe } from '@diagnostics/logger'
import { isTimingObserverEnabled } from '@diagnostics/qaFlags'
import type { CompiledPunchGesture } from '@domain/instrument/gestureSchema'
import type { InstrumentVoice } from './InstrumentVoice'
import { kitDrumKey } from './instrumentBankKeys'
import { selectInstrumentSamples, type InstrumentVoiceMode } from './instrumentSelection'
import {
  INSTRUMENT_BANKS,
  INSTRUMENT_KIT_DRUMS,
  type InstrumentTextureId,
} from './voiceAssets/instrumentBankManifest'

/** The bank is rendered at 48 kHz; matching it means decode never resamples. */
const BANK_SAMPLE_RATE = 48000

/**
 * The silent timing tap (GH #291, plan C3) — the technique `voice-latency.tsx`
 * proved on this tablet, moved into the shipping engine behind the QA flag.
 *
 * An analyser sits beside `destination` behind a zero gain: a Web Audio node is
 * only pulled when it has a path to the output, so the mute keeps the analyser
 * fed while nothing extra reaches the speaker. Every one-shot's per-hit gain
 * fans out into it (loops never do), and a 1 ms poll from the trigger until
 * the frame turns non-silent measures trigger → first rendered frame — the
 * 1.1 ms the header quotes — at any volume, with no microphone. The speaker
 * follows by the fast-path output latency, a per-route constant (plan C4).
 */
const TAP_FFT_SIZE = 1024
const TAP_POLL_MS = 1
/** No rendered audio within this of the trigger is `timeout`; every kit attack is under 10 ms. */
const TAP_TIMEOUT_MS = 250
/** 128 is silence for byte time-domain data; above this clears dither and noise. */
const TAP_SILENCE_PEAK = 2

type TapOutcome = 'ok' | 'timeout' | 'masked' | 'busy' | 'released'

/** The fields every tap record carries, fixed at the trigger. */
interface TapDispatch {
  eventId: string
  hand: string
  /** Pool keys fired by this trigger, in order. */
  keys: string
  receivedMonotonicTimeMs: number
  dispatchMs: number
  /** Tracker event → trigger, on the same clock. */
  pipelineMs: number
  ctxTimeAtDispatch: number
}

export interface InstrumentVoiceOutputOboeOptions {
  /**
   * The clock every tap field is stamped on. Default `performance.now()` —
   * the punch event's own `receivedMonotonicTimeMs` domain, so `pipelineMs`
   * is a plain subtraction.
   */
  clock?: () => number
  /** Arm the silent timing tap. Default: the persisted QA flag, read when the graph is built. */
  timingTap?: boolean | (() => boolean)
}

/**
 * Buffer-map key for the legacy five-piece drum. Prefixed for the same
 * reason the expo pool prefixes: the bank's drum keys are bare words
 * (`kick`, `snare`) sharing one map with stab and kit keys.
 */
const drumPoolKey = (drumKey: string): string => `drum:${drumKey}`

/** Two decimals: the tap resolves sub-millisecond onsets and the log prints primitives. */
const round2 = (ms: number): number => Math.round(ms * 100) / 100

/** Stop and detach a source; never throws, so a teardown loop cannot abort. */
function stopSource(source: AudioBufferSourceNode | undefined): void {
  if (source === undefined) return
  try {
    source.stop()
  } catch {
    // Already ended.
  }
  try {
    source.disconnect()
  } catch {
    // Already detached.
  }
}

export class InstrumentVoiceOutputOboe implements InstrumentVoice {
  private ctx: AudioContext | null = null
  private readonly buffers = new Map<string, AudioBuffer>()
  private availableFlag = true
  private texture: InstrumentTextureId = 'brass'

  /**
   * Bumped by `release()` and by every `preload()`. Decoding is async, so a
   * teardown or a texture change landing mid-decode must not have its pool
   * refilled by the continuation — the same defect that cost a whole
   * debugging session on the expo path (GH #356).
   */
  private generation = 0

  private mode: InstrumentVoiceMode = 'arp'

  /**
   * One persistent gain per loop lane, so a swap replaces the SOURCE under a
   * stable node rather than rebuilding the connection each time.
   */
  private bedLane: { source: AudioBufferSourceNode; key: string } | null = null
  private bassLane: { source: AudioBufferSourceNode; key: string } | null = null

  /**
   * What each lane is HEADING TOWARD. Set before the decode await, so a
   * second swap arriving mid-decode can abandon the first — without this a
   * fast chord change would land the older loop on top of the newer one.
   *
   * This is an intent, not a commitment: every path that returns without
   * starting a source rolls it back to whatever is actually sounding
   * (`rollbackLane`). It used to be both at once, which meant a single
   * failed decode left the lane's key permanently claimed — `handleGesture`
   * gates on this field, so that chord was then gated out forever and the
   * lane stayed silent for the rest of the session with nothing logged.
   */
  private pendingBedKey: string | null = null
  private pendingBassKey: string | null = null

  /**
   * One-shots that may still be sounding, with the context time each should
   * finish at.
   *
   * `panic()` has to genuinely cut these: the expo sibling pauses every
   * pooled player, so an Oboe panic that stopped only the loops would
   * silence LESS than the engine it replaces.
   *
   * Pruned by time rather than by an `onEnded` callback — registering one
   * per hit costs a JSI round trip in the trigger path, and cheapening that
   * path is the entire reason this engine exists.
   */
  private liveOneShots: { source: AudioBufferSourceNode; endsAt: number }[] = []

  private readonly clock: () => number
  private readonly tapOption: boolean | (() => boolean) | undefined
  /** The zero-gain analyser branch, built with the context when the tap is armed. */
  private tap: { analyser: AnalyserNode; frame: Uint8Array } | null = null
  /** The one in-flight onset measurement; a trigger arriving inside it is `busy`. */
  private pending: { handle: ReturnType<typeof setTimeout>; dispatch: TapDispatch } | null = null

  constructor(opts: InstrumentVoiceOutputOboeOptions = {}) {
    this.clock = opts.clock ?? (() => performance.now())
    this.tapOption = opts.timingTap
  }

  get available(): boolean {
    return this.availableFlag
  }

  async preload(textureId: InstrumentTextureId): Promise<void> {
    if (!this.availableFlag) return
    const generation = (this.generation += 1)
    this.texture = textureId

    try {
      this.ctx ??= new AudioContext({ sampleRate: BANK_SAMPLE_RATE })
      const ctx = this.ctx
      // Once per context: `release()` and `fail()` drop the tap with it.
      if (this.tap === null && this.tapArmed()) this.buildTap(ctx)
      const bank = INSTRUMENT_BANKS[textureId]

      // One decode per clip, all in flight together. A buffer costs memory,
      // not an AudioTrack, so there is no pool cap to respect here.
      const wanted: [string, number][] = [
        // The bank's own keys ARE the selection keys (`stab-<midi>`), which
        // is the whole point of instrumentBankKeys sharing one vocabulary.
        ...Object.entries(bank.stabs).map(
          ([key, clip]) => [key, clip.module] as [string, number],
        ),
        ...Object.entries(INSTRUMENT_KIT_DRUMS).map(
          ([articulation, clip]) => [kitDrumKey(articulation), clip.module] as [string, number],
        ),
        // The legacy five-piece layer, for the patches that never compile a
        // kit block. Five more buffers, no extra AudioTrack.
        ...Object.entries(bank.drums).map(
          ([key, clip]) => [drumPoolKey(key), clip.module] as [string, number],
        ),
      ]

      const decoded = await Promise.all(
        wanted.map(async ([key, module]) => {
          try {
            return [key, await ctx.decodeAudioData(module)] as const
          } catch (error) {
            // One unreadable clip loses one note, never the instrument.
            logger.warn('puncheokie.instrument.clipMissing', 'oboe decode failed', {
              key: safe(key),
              error: safe(String(error)),
            })
            return null
          }
        }),
      )
      if (generation !== this.generation) return

      this.buffers.clear()
      for (const entry of decoded) {
        if (entry !== null) this.buffers.set(entry[0], entry[1])
      }
      if (this.buffers.size === 0) {
        this.fail('no clips decoded', undefined)
        return
      }

      // Open the stream BEFORE the first punch, or hit one measures the
      // Oboe stream-open cost instead of a trigger.
      const warm = ctx.createBufferSource()
      warm.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      warm.connect(ctx.destination)
      warm.start(0)

      logger.info('puncheokie.instrument.oboeReady', 'oboe voice warmed', {
        texture: safe(textureId),
        buffers: safe(this.buffers.size),
        sampleRate: safe(ctx.sampleRate),
      })
    } catch (error) {
      this.fail('audio graph failed to initialise', error)
    }
  }

  setTexture(textureId: InstrumentTextureId): void {
    if (!this.availableFlag || textureId === this.texture) return
    void this.preload(textureId)
  }

  setMode(mode: InstrumentVoiceMode): void {
    if (mode === this.mode) return
    this.mode = mode
    // 'notes' is the alternating-note instrument: no beds, no bass. Entering
    // it silences the loops rather than leaving them droning underneath.
    if (mode === 'notes') this.stopLoops()
  }

  handleGesture(gesture: CompiledPunchGesture): void {
    if (!this.availableFlag || this.ctx === null) return
    // `mode` matters: without it 'notes' still resolves bed/bass and enters
    // swapLoop for lanes it will never sound. The expo sibling passes it, and
    // the A/B is only honest while both engines select identically.
    const selection = selectInstrumentSamples(gesture, this.texture, this.mode)

    // The tap reads the graph BEFORE this trigger renders anything, so a
    // one-shot still ringing from the last punch is recognised as masking
    // this measurement rather than being reported as a 0 ms onset.
    const armed =
      this.tap === null
        ? null
        : { peakBefore: this.readPeak(), dispatchMs: this.clock(), ctxTime: this.ctx.currentTime }
    const fired: string[] = []

    if (selection.stab !== null) {
      if (this.fire(selection.stab, selection.stabGain)) fired.push(selection.stab)
    }

    // The kit supersedes the legacy five-piece layer whenever a compiled drum
    // block is present — same rule as the expo path, so the A/B is honest.
    // The `else` matters as much as the `if`: only a field patch compiles a
    // drum block, so without the fallback every legacy and plain-brassCube
    // patch lost its drum on this engine — and a latch-only patch, which has
    // no stab either, went completely silent while expo still sounded.
    if (gesture.drums !== undefined && gesture.drums.hits.length > 0) {
      for (const hit of gesture.drums.hits) {
        const key = kitDrumKey(hit.articulation)
        if (this.fire(key, Math.max(0, Math.min(1, hit.midiVelocity / 127)))) fired.push(key)
      }
    } else if (selection.drum !== null) {
      const key = drumPoolKey(selection.drum)
      if (this.fire(key, selection.drumGain)) fired.push(key)
    }

    if (armed !== null && fired.length > 0) {
      this.measure(
        {
          eventId: gesture.eventId,
          hand: gesture.source.hand,
          keys: fired.join(','),
          receivedMonotonicTimeMs: gesture.source.receivedMonotonicTimeMs,
          dispatchMs: armed.dispatchMs,
          pipelineMs: round2(armed.dispatchMs - gesture.source.receivedMonotonicTimeMs),
          ctxTimeAtDispatch: armed.ctxTime,
        },
        armed.peakBefore,
      )
    }

    // A lane is only touched when its selection CHANGED — a legacy gesture's
    // null bed/bass leaves the sounding loops alone.
    if (selection.bed !== null && selection.bed !== this.pendingBedKey) {
      void this.swapLoop('bed', selection.bed)
    }
    if (selection.bass !== null && selection.bass !== this.pendingBassKey) {
      void this.swapLoop('bass', selection.bass)
    }
  }

  panic(): void {
    this.stopLoops()
    this.stopOneShots()
    // Deliberately NOT `ctx.suspend()`. That is what this did, on a comment
    // claiming "the next trigger resumes it" — but nothing in the app ever
    // calls resume(), and starting a source node does not resume a suspended
    // context. One panic (or one tap on FREEDOM / NAVIGATION / WINDOW, which
    // bump the harmonic generation) left the instrument silent for the rest
    // of the screen visit while every later trigger still reported success.
  }

  release(): void {
    this.generation += 1
    this.stopLoops()
    this.stopOneShots()
    this.dropTap()
    this.buffers.clear()
    const ctx = this.ctx
    this.ctx = null
    void ctx?.close().catch(() => undefined)
  }

  /**
   * Point one loop lane at `key`, decoding it on first use.
   *
   * Lazy rather than eager: the bank holds 24 beds and 6 basses per texture
   * and a session touches a handful. Decoding all of them would cost seconds
   * of preload — and in a dev client each decode is an HTTP fetch from Metro —
   * to warm loops that will never sound.
   */
  private async swapLoop(kind: 'bed' | 'bass', key: string): Promise<void> {
    const ctx = this.ctx
    if (ctx === null) return
    // Claim the lane BEFORE awaiting, so a newer swap wins the race.
    if (kind === 'bed') this.pendingBedKey = key
    else this.pendingBassKey = key
    const generation = this.generation

    let buffer = this.buffers.get(key)
    if (buffer === undefined) {
      const bank = INSTRUMENT_BANKS[this.texture]
      const clip = kind === 'bed' ? bank.beds[key] : bank.basses[key]
      if (clip === undefined) {
        logger.warn('puncheokie.instrument.clipMissing', 'no bank entry for loop', {
          key: safe(key),
        })
        this.rollbackLane(kind, key)
        return
      }
      try {
        buffer = await ctx.decodeAudioData(clip.module)
      } catch (error) {
        // In a dev client this is an HTTP fetch from Metro, so a single
        // transient failure is expected. Roll the claim back or this chord
        // is gated out of `handleGesture` forever.
        logger.warn('puncheokie.instrument.clipMissing', 'loop decode failed', {
          key: safe(key),
          error: safe(String(error)),
        })
        this.rollbackLane(kind, key)
        return
      }
      // Released, texture-changed, or superseded while we decoded.
      if (generation !== this.generation) return
      this.buffers.set(key, buffer)
    }

    // Superseded by a newer swap, which now owns the claim — rolling back
    // here would clobber ITS intent, so this path deliberately does not.
    const stillWanted = kind === 'bed' ? this.pendingBedKey : this.pendingBassKey
    if (stillWanted !== key) return
    if (this.mode === 'notes') {
      this.rollbackLane(kind, key)
      return
    }

    const previous = kind === 'bed' ? this.bedLane : this.bassLane
    try {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      // The bank's loops are rendered seamless — sample-exact lengths, and
      // either zero-amplitude boundaries or an integer number of cycles — so
      // looping the whole buffer needs no crossfade.
      source.loop = true
      source.connect(ctx.destination)
      source.start(0)
      if (kind === 'bed') this.bedLane = { source, key }
      else this.bassLane = { source, key }
    } catch (error) {
      logger.warn('puncheokie.instrument.oboeFire', 'loop start failed', {
        key: safe(key),
        error: safe(String(error)),
      })
      this.rollbackLane(kind, key)
      return
    }
    // Stop the old one only once the new one is running, so the lane never
    // falls silent between them.
    stopSource(previous?.source)
  }

  /**
   * Give up a claim this swap could not honour, handing the lane back to
   * whatever is actually sounding so the next punch retries instead of
   * being gated out.
   *
   * No-ops when a newer swap already owns the claim — losing a race is not
   * a failure, and that swap's intent must survive.
   */
  private rollbackLane(kind: 'bed' | 'bass', key: string): void {
    if (kind === 'bed') {
      if (this.pendingBedKey === key) this.pendingBedKey = this.bedLane?.key ?? null
    } else if (this.pendingBassKey === key) {
      this.pendingBassKey = this.bassLane?.key ?? null
    }
  }

  private stopLoops(): void {
    stopSource(this.bedLane?.source)
    stopSource(this.bassLane?.source)
    this.bedLane = null
    this.bassLane = null
    this.pendingBedKey = null
    this.pendingBassKey = null
  }

  /** Cut every one-shot that may still be ringing. */
  private stopOneShots(): void {
    for (const entry of this.liveOneShots) stopSource(entry.source)
    this.liveOneShots = []
  }

  /** Fire one clip. Fully synchronous — no await, no seek, no rewind. True once the source has started. */
  private fire(poolKey: string, gain: number): boolean {
    const ctx = this.ctx
    const buffer = this.buffers.get(poolKey)
    if (ctx === null || buffer === undefined) return false
    try {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      // Per-HIT gain, never shared: two overlapping hits of the same clip
      // would otherwise share one node and the second's velocity would
      // retroactively change the first's.
      const level = ctx.createGain()
      level.gain.value = gain
      source.connect(level)
      level.connect(ctx.destination)
      // The tap hears the same node the speaker does — one extra edge after
      // the real one, never instead of it: a refused edge disarms the tap and
      // the hit still sounds.
      if (this.tap !== null) {
        try {
          level.connect(this.tap.analyser)
        } catch (error) {
          this.dropTap()
          logger.warn('puncheokie.instrument.tapFailed', 'tap edge refused — tap disarmed', {
            key: safe(poolKey),
            error: safe(String(error)),
          })
        }
      }
      source.start(0)
      // Remember it so `panic()` can cut it, dropping the ones that have
      // already finished. Bounded by clip length × hit rate — a handful even
      // at the fastest playable tempo.
      const now = ctx.currentTime
      if (this.liveOneShots.length > 0) {
        this.liveOneShots = this.liveOneShots.filter((entry) => entry.endsAt > now)
      }
      this.liveOneShots.push({ source, endsAt: now + buffer.duration })
      return true
    } catch (error) {
      logger.warn('puncheokie.instrument.oboeFire', 'trigger failed', {
        key: safe(poolKey),
        error: safe(String(error)),
      })
      return false
    }
  }

  // ------------------------------------------------------------ timing tap

  private tapArmed(): boolean {
    return typeof this.tapOption === 'function'
      ? this.tapOption()
      : (this.tapOption ?? isTimingObserverEnabled())
  }

  private buildTap(ctx: AudioContext): void {
    try {
      const analyser = ctx.createAnalyser()
      analyser.fftSize = TAP_FFT_SIZE
      const mute = ctx.createGain()
      mute.gain.value = 0
      analyser.connect(mute)
      mute.connect(ctx.destination)
      this.tap = { analyser, frame: new Uint8Array(TAP_FFT_SIZE) }
      logger.info('puncheokie.instrument.tapArmed', 'silent timing tap armed', {
        fftSize: safe(TAP_FFT_SIZE),
        pollMs: safe(TAP_POLL_MS),
      })
    } catch (error) {
      // The instrument sounds without its tap; the run is simply unmeasured.
      this.tap = null
      logger.warn('puncheokie.instrument.tapFailed', 'silent timing tap could not be built', {
        error: safe(String(error)),
      })
    }
  }

  /** Loudest sample in the analyser's current frame, 0 = silence. */
  private readPeak(): number {
    const tap = this.tap
    if (tap === null) return 0
    tap.analyser.getByteTimeDomainData(tap.frame)
    let peak = 0
    for (let i = 0; i < tap.frame.length; i += 1) {
      peak = Math.max(peak, Math.abs((tap.frame[i] ?? 128) - 128))
    }
    return peak
  }

  /**
   * Arm one onset measurement for the trigger just fired: a bounded 1 ms
   * chain reading the analyser until the graph turns non-silent. One at a
   * time — a trigger landing inside an open measurement is `busy`, and one
   * whose graph was already sounding at the trigger is `masked`; both are
   * data (the analyzer reports their ratio), never a fake onset.
   */
  private measure(dispatch: TapDispatch, peakBefore: number): void {
    if (this.pending !== null) {
      this.observed(dispatch, 'busy', { peak: peakBefore })
      return
    }
    if (peakBefore > TAP_SILENCE_PEAK) {
      this.observed(dispatch, 'masked', { peak: peakBefore })
      return
    }
    const poll = (): void => {
      this.pending = null
      const peak = this.readPeak()
      const now = this.clock()
      if (peak > TAP_SILENCE_PEAK) {
        this.observed(dispatch, 'ok', {
          peak,
          firstSampleMs: now,
          latencyMs: round2(now - dispatch.dispatchMs),
          ctxTimeAtFirstSample: this.ctx?.currentTime ?? null,
        })
        return
      }
      if (now - dispatch.dispatchMs >= TAP_TIMEOUT_MS) {
        this.observed(dispatch, 'timeout', { peak })
        return
      }
      this.pending = { handle: setTimeout(poll, TAP_POLL_MS), dispatch }
    }
    this.pending = { handle: setTimeout(poll, TAP_POLL_MS), dispatch }
  }

  /** Stop the poll and forget the analyser; an open measurement closes as `released`. */
  private dropTap(): void {
    if (this.pending !== null) {
      clearTimeout(this.pending.handle)
      const { dispatch } = this.pending
      this.pending = null
      this.observed(dispatch, 'released', { peak: null })
    }
    this.tap = null
  }

  private observed(
    dispatch: TapDispatch,
    outcome: TapOutcome,
    extra: {
      peak: number | null
      firstSampleMs?: number
      latencyMs?: number
      ctxTimeAtFirstSample?: number | null
    },
  ): void {
    logger.info('puncheokie.instrument.observed', 'instrument onset observed', {
      eventId: safe(dispatch.eventId),
      hand: safe(dispatch.hand),
      keys: safe(dispatch.keys),
      receivedMonotonicTimeMs: safe(dispatch.receivedMonotonicTimeMs),
      dispatchMs: safe(dispatch.dispatchMs),
      pipelineMs: safe(dispatch.pipelineMs),
      ctxTimeAtDispatch: safe(dispatch.ctxTimeAtDispatch),
      firstSampleMs: safe(extra.firstSampleMs ?? null),
      latencyMs: safe(extra.latencyMs ?? null),
      ctxTimeAtFirstSample: safe(extra.ctxTimeAtFirstSample ?? null),
      peak: safe(extra.peak),
      outcome: safe(outcome),
    })
  }

  private fail(reason: string, error: unknown): void {
    this.availableFlag = false
    this.dropTap()
    this.buffers.clear()
    const ctx = this.ctx
    this.ctx = null
    void ctx?.close().catch(() => undefined)
    logger.warn('puncheokie.instrument.unavailable', reason, {
      ...(error === undefined ? {} : { error: safe(String(error)) }),
    })
  }
}
