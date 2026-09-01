/**
 * The Voice Coach's audio implementation (M34-04, doc §18, §25).
 *
 * Implements `VoiceOutputPort` over `expo-audio` (cached clips) and
 * `expo-speech` (descriptive text only).
 *
 * ## This is the layer that owns timers, and only this layer
 *
 * D3 puts the cue clock in charge: the announcer computes deadlines and never
 * schedules. Honouring those deadlines is a transport problem, and it lives
 * here. `playAsset(id, atMs)` holds the clip until `atMs` and then plays it.
 *
 * **A deadline already past is played late, never dropped.** A punch command
 * that arrives 20 ms behind is still the punch the athlete is being asked
 * for; silence would be a worse answer than lateness. Only an explicit
 * `cancel` removes something.
 *
 * ## Preloading is mandatory, not an optimisation
 *
 * M34-01 measured 34.4 ms of jitter for a preloaded clip against 63.1 ms cold,
 * and ~24 ms more median latency. `preload()` runs during the countdown so no
 * clip is ever played cold mid-round.
 *
 * ## No-audio mode is a first-class state
 *
 * If the audio stack fails to initialise, `available` goes false, every call
 * becomes a no-op, and exactly one warning is logged. The workout stays fully
 * usable on visuals and haptics (doc §25) — a coach that cannot speak must
 * not be a workout that cannot run.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Speech from 'expo-speech'

import { logger, safe } from '@/diagnostics/logger'
import { assetPriority } from '@domain/coach/assetPriority'
import {
  AUDIO_PRIORITY,
  DEFAULT_VOLUMES,
  type AudioPriority,
  type CombinationVoice,
  type ToneKind,
  type VoiceAssetId,
  type VoiceOutputPort,
  type Volumes,
} from '@domain/coach/VoiceOutputPort'
import type { VoiceVocabulary } from '@domain/coach/VoiceCoachPolicy'
import {
  voiceAssetManifest,
  type PhraseForm,
  type VoiceAssetManifest,
} from './voiceAssets/manifest'
import { CALLOUT_CLIPS, type CalloutClipId } from './voiceAssets/calloutManifest'
import { MetronomePlayer, type MetronomePlayerObserver } from './MetronomePlayer'
import { MetronomeTransport } from './MetronomeTransport'

const TONE_ASSETS: Record<ToneKind, VoiceAssetId> = {
  ready: 'tone-ready',
  repeat: 'tone-repeat',
  warning: 'tone-warning',
}

/**
 * Chime-ins (Kyle): a coach interjection — the 30-second closer, an
 * encouragement line, a power call, a ceremony sentence — MUTES the main
 * shot-calling track while it sounds, and the calls come back at the same
 * volume after. Two takes of the same voice at once read as chaos; a
 * 0.35 duck (the first attempt) still left the finisher fighting the
 * calls under it. `co-` covers every ceremony/closer/thirty sentence.
 */
const CHIME_IN_PREFIXES = [
  'co-',
  'power-strikes',
  'double-up',
  'hands-up',
  'put-it-on-em',
  'breathe',
  'touch-and-go',
] as const

export const isChimeInAsset = (id: string): boolean =>
  CHIME_IN_PREFIXES.some((prefix) => id.startsWith(prefix))

/** Clearance after a chime-in before the calls come back. */
export const CHIME_IN_RELEASE_MS = 250

/**
 * Conservative default for the calibrated audio-output latency
 * (M39-V2 Phase 4-iii, Kyle amended blueprint §Latency-compensated
 * audio dispatch).
 *
 * Every Android device inserts a small delay between "audio player
 * asked to play" and "athlete's ear hears the first sample". The
 * dispatcher subtracts this from the desired-audible-start tick's
 * wall time so the OUTPUT lands on the tick, not the DISPATCH:
 *
 *   dispatchAtMs = timeAtTick(desiredAudibleStartTick) - calibratedLatencyMs
 *
 * Overrides ship per device family (tablet vs phone; hardware output
 * profile). This default is deliberately conservative — most Android
 * devices measure 20-60 ms; a pinch of preload compensation on a
 * device faster than expected is imperceptible, while a late clip
 * on a device slower than expected is exactly the drift Phase 4
 * exists to remove.
 */
export const DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS = 40

/**
 * Pure helper: given the wall-clock ms at which a coach event's
 * desired audible start would land ideally (`tickTimeMs`, derived
 * from `MetronomeTransport.timeAtTick(event.desiredAudibleStartTick)`),
 * and a per-device calibration, return the ms at which the dispatch
 * should FIRE. Never negative; clamped to zero so a mis-calibrated
 * negative latency can't tell the dispatcher to fire in the past.
 */
export function latencyCompensatedDispatchMs(
  tickTimeMs: number,
  calibratedLatencyMs: number,
): number {
  if (!Number.isFinite(tickTimeMs)) {
    throw new Error(`latencyCompensatedDispatchMs: tickTimeMs must be finite, got ${tickTimeMs}`)
  }
  if (!Number.isFinite(calibratedLatencyMs) || calibratedLatencyMs < 0) {
    throw new Error(
      `latencyCompensatedDispatchMs: calibratedLatencyMs must be ≥ 0, got ${calibratedLatencyMs}`,
    )
  }
  return Math.max(0, tickTimeMs - calibratedLatencyMs)
}

/**
 * Grace after a coach clip's audible end during which the coach lane
 * still reports itself busy (M39-V2 Phase 4-ii, Kyle amended blueprint
 * §Fix release grace).
 *
 * Without a small grace, the next coach event arms exactly when the
 * previous clip's last audible sample finishes — and the next clip's
 * onset can collide with the tail decay of the previous one (the
 * "extra muted measure" bug where the coach effectively skips a beat
 * because the following armed clip immediately dropped it). 50 ms is
 * short enough to be inaudible as a pause but long enough that the
 * audio graph's own release ramp completes before the next start.
 *
 * Applied via `markBusy(durationMs)`, which advances `busyUntilMs` by
 * `durationMs + COACH_LANE_RELEASE_GRACE_MS`.
 */
export const COACH_LANE_RELEASE_GRACE_MS = 50

/** Clips carried on the bells volume rather than the voice volume (doc §25). */
const BELL_ASSETS: ReadonlySet<VoiceAssetId> = new Set<VoiceAssetId>([
  'bell',
  'tone-ready',
  'tone-repeat',
  'tone-warning',
])

/**
 * The full arm record for one coach event (M39-V2 Phase 4-iv, Kyle
 * amended blueprint §Vocabulary switch at the next unarmed coach
 * event).
 *
 * An armed event carries THREE identities so the dispatcher and any
 * deferred callback can reason about it correctly:
 *
 *   - `eventId` — the compiled coach event's stable id.
 *   - `runId` — the coach-lane arm token; a stale runId no-ops.
 *   - `lockedVocabulary` — the dialect the event will play in.
 *     Mid-play the user cannot hijack this: a `setVocabulary` call
 *     records into `pendingVocabulary` and takes effect at the NEXT
 *     `armCoachEvent`.
 */
export interface ArmedCoachEvent {
  eventId: string
  runId: string
  lockedVocabulary: VoiceVocabulary
}

export interface VoiceOutputExpoOptions {
  manifest?: VoiceAssetManifest
  vocabulary?: VoiceVocabulary
  /** Monotonic clock. Injectable so a test can drive deadlines exactly. */
  clock?: () => number
  /** Timer seam, for the same reason. */
  schedule?: (fn: () => void, delayMs: number) => unknown
  cancelScheduled?: (handle: unknown) => void
  /** Player factory, so tests need no native binding. */
  createPlayer?: (source: number) => AudioPlayer
  speaker?: Pick<typeof Speech, 'speak' | 'stop'>
  setAudioMode?: typeof setAudioModeAsync
  /**
   * Calibrated audio-output latency in milliseconds — subtracted from
   * a coach event's desired dispatch time so the audible ONSET lands
   * on the intended tick, not the dispatch call (M39-V2 Phase 4-iii,
   * Kyle amended blueprint). Defaults to
   * `DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS`. Override per device
   * family. Must be ≥ 0.
   */
  calibratedAudioOutputLatencyMs?: number
}

/**
 * Clips sharing one deadline — a phrase.
 *
 * Grouped rather than scheduled individually because a combination is one
 * utterance made of several files. Emitting them separately at the same
 * instant plays them all at once: "one, one, two" becomes a single overlapped
 * noise, and the repeated "one" restarts its own player mid-word so only one
 * of them is ever heard.
 */
interface PendingGroup {
  atMs: number
  ids: VoiceAssetId[]
  priority: AudioPriority
  form: PhraseForm
  tightness: number
  handle: unknown
}

/** A clip waiting its turn inside a phrase that is already sounding. */
interface SequenceStep {
  id: VoiceAssetId
  priority: AudioPriority
  form: PhraseForm
  tightness: number
}

/**
 * Floor on the gap between clips in a phrase.
 *
 * Tightness can compress a combination a long way, but two words need some
 * separation to stay countable. Below this they stop sounding like a call and
 * start sounding like a stutter.
 */
export const MIN_CLIP_GAP_MS = 130

/**
 * Assumed clip length when the player has not reported one.
 *
 * Only reached if `duration` is still zero after load. Short enough that a
 * wrong guess runs the phrase slightly fast rather than stalling it.
 */
export const FALLBACK_CLIP_MS = 320

/**
 * How many clip players stay resident.
 *
 * Android caps how many `AudioTrack` objects an app may hold, and preloading
 * every clip in every form blew straight through it: with 48 players open,
 * creating one more failed with "Cannot create AudioTrack" and **the whole
 * app went silent** — including clips that had loaded fine. Nothing reported
 * a problem, because each individual play still looked successful.
 *
 * So players are pooled. The least recently used one is released when the cap
 * is reached, which costs that clip a cold start next time it is needed
 * (M34-01 measured cold at roughly twice the jitter of warm) and costs
 * nothing at all for the clips actually in rotation.
 *
 * Raised 16 → 24 for the live vocabulary switch: BOTH vocabularies'
 * opening clips stay warm (~20 players) so flipping numbers ⇄ techniques
 * mid-workout costs no cold start. Still far under the ~48 that broke.
 */
export const MAX_RESIDENT_PLAYERS = 24

export class VoiceOutputExpo implements VoiceOutputPort {
  private readonly manifest: VoiceAssetManifest
  private vocabulary: VoiceVocabulary
  private readonly clock: () => number
  private readonly schedule: (fn: () => void, delayMs: number) => unknown
  private readonly cancelScheduled: (handle: unknown) => void
  private readonly makePlayer: (source: number) => AudioPlayer
  private readonly speaker: Pick<typeof Speech, 'speak' | 'stop'>
  private readonly setAudioMode: typeof setAudioModeAsync

  /**
   * Resident players, in least-recently-used order.
   *
   * A `Map` iterates in insertion order, so re-inserting on use keeps the
   * oldest key first and makes eviction a single `keys().next()`.
   */
  private readonly players = new Map<string, AudioPlayer>()
  private readonly durations = new Map<string, number>()
  private pending: PendingGroup[] = []
  /** Clips still to play in the phrase currently sounding. */
  private sequence: SequenceStep[] = []
  private sequenceHandle: unknown = null
  private volumes: Volumes = { ...DEFAULT_VOLUMES }
  private failed = false
  private focusHeld = false
  /**
   * The player for the combination currently being called.
   *
   * Held outside the clip pool and replaced each time: a phrase is one file
   * played once, so keeping a resident player per combination would consume
   * the very AudioTrack budget the pool exists to protect.
   */
  private phrasePlayer: AudioPlayer | null = null
  /**
   * Scheduled-but-unstarted combination calls, fired by `advance()` — the
   * runner's tick — NOT by wall timers.
   *
   * Two hard lessons live here. First, a SET of pending calls, not a single
   * handle: the announcer pre-schedules a burst's periodic re-calls all at
   * once (it owns no timers, D3), and a single-handle version cancelled
   * each pending call when the next was scheduled — a 30-second burst got
   * its opener and then silence. Second, no `setTimeout`: a monitored live
   * session measured RN timers stretching ~2.3x under workout load, so
   * calls scheduled 6 s out fired 60-140 s late — the coach yelling a
   * combination the screen had long moved past. The screen keeps time
   * because the session tick samples the real clock; audio joins the same
   * tick via `advance()` so the two surfaces read one rhythm map and
   * cannot drift apart.
   */
  private scheduledPhrases: Array<{ at: number; run: () => void }> = []

  /**
   * A15 (#256): "audible until" — the clock instant a coach clip that
   * is playing right now is expected to fall silent.
   *
   * Every call path that starts audible sound (`emit`, `playSequence`,
   * `playCombination.start`) advances this to `now + measuredMs` when
   * it knows the length; `markBusy` centralises that so the invariant
   * is enforced in one place. Schedulers read it through
   * `audibleUntilMs()` to defer follow-up traffic (metric flushes,
   * gap-fillers) past the current clip, and the mic-analyzer can use
   * it to distinguish an overlap from a legitimately long clip.
   *
   * NOT a mute — a chime-in is still allowed to start over a
   * combination (that is the whole point of the duck), and priorities
   * still decide what gets queued. This is timing information, not a
   * gate.
   */
  private busyUntilMs = 0

  /**
   * The current coach-lane arm id (M39-V2 Phase 4-ii). Every `arm` mints
   * a fresh id; any late finish callback that carries a stale id is
   * dropped without side effect. Null when no coach event is armed.
   *
   * The lane is EXCLUSIVE per Kyle's plan §Phase 4 — only one coach
   * event is armed at a time. Superseding an armed event is legal
   * (a chime-in or a mid-cue interrupt) — the new arm mints a new
   * runId, the old runId becomes stale, and any deferred callback
   * tied to the old runId no-ops.
   */
  private armedRunId: string | null = null

  /** Monotonic counter feeding `mintCoachRunId`. */
  private runIdCounter = 0

  /**
   * The full record of the currently-armed coach event (M39-V2
   * Phase 4-iv). Extends `armedRunId` with the vocabulary the arm
   * FROZE at — a mid-play user vocab switch reads this to know NOT
   * to hijack the in-flight event. See `armCoachEvent`.
   *
   * Null when no coach event is armed. When set, its `runId` matches
   * `armedRunId` exactly (invariant enforced at set/clear time).
   */
  private armedEvent: ArmedCoachEvent | null = null

  /**
   * The vocabulary the next UNARMED coach event will resolve into.
   * A user-facing "swap vocabulary" call sets this without touching
   * `armedEvent` — the in-flight event finishes in its own dialect,
   * the next one arms in the new dialect. No recompilation, no
   * strike-timing change (compiled timeline covers both tracks).
   */
  private pendingVocabulary: VoiceVocabulary | null = null

  /**
   * Calibrated audio-output latency for THIS device (M39-V2 Phase 4-iii).
   * Set from `VoiceOutputExpoOptions.calibratedAudioOutputLatencyMs`
   * at construction; the default is
   * `DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS`. Read by
   * `dispatchAtMsForTickTime` when scheduling a coach event so the
   * audible onset lands on the intended tick.
   */
  private readonly calibratedLatencyMs: number

  /**
   * The 3rd audio track — a boxing-flavored one-bar loop that anchors
   * every ring and voice call to the master pulse (M39-V1b / #280).
   * Constructed once per session, shared across every round; the runner
   * calls `.start()` on `work-entered` and `.stop()` on the phase
   * transitions that end work. Public via the `metronome` port method,
   * which is optional so any pre-V1b test double compiles unchanged.
   */
  private readonly metronomePlayer = new MetronomePlayer()

  /**
   * The logical tick clock — the sole timing authority for score
   * dispatch, ring rendering, avatar frames, and tracker acceptance
   * windows (M39-V2 Phase W0-a, Kyle 2026-08-30). Held by reference
   * inside the `metronome` port so a domain consumer can read
   * `port.transport.snapshot()` without ever needing to import the
   * class.
   *
   * The transport is a pure LOGICAL clock — it has no native
   * playback and cannot touch the metronome's playlist. The coach
   * lane's `playAsset` / `playPhrase` / `playCallout` /
   * `playInstruction` paths never see this transport OR the
   * metronomePlayer: they can only affect their own player pool.
   * Isolation is preserved by construction (principle #20 of the
   * amended Timing Engine v2 plan).
   *
   * Shares the same injected clock as the rest of `VoiceOutputExpo`
   * (M39-V2 Phase W0-c-ii) so audio-position observations and the
   * transport's own `absoluteTickAt` interpretation live in one
   * time domain — the position-observer wire relies on this. The
   * transport ignores the clock's `schedule` field.
   *
   * The lambda in the constructor uses a late-bound `this.clock`
   * so the transport reads the current clock value at each call
   * rather than a snapshot from construction time — matters because
   * `this.clock` is set in the constructor body before this field
   * gets touched via the `metronome` port below.
   */
  private readonly metronomeTransport: MetronomeTransport = new MetronomeTransport({
    now: () => this.clock(),
    schedule: () => () => {},
  })

  /**
   * Port hook for the metronome track (M39-V1b, transport added
   * M39-V2 Phase W0-a). The runner calls `start`/`stop`/`setVolume`
   * on this from its `applyTransitions` dispatch; `metronomePlayer`
   * owns the native loop underneath and `metronomeTransport` owns
   * the logical clock. When `start` is called with a `baseBpm`, the
   * transport starts alongside the loop and consumers reading
   * `transport.snapshot()` see the fresh generation. Volume defaults
   * to `Volumes.metronome` at start, and `setVolume` carries slider
   * changes without restarting the loop OR the transport.
   */
  /**
   * Monotonic timestamp at which the metronome transport last
   * started (M39-V2 Phase W0-c-ii). Zero while stopped.
   */
  private metronomeStartMonotonicMs = 0
  /**
   * Monotonic loop counter for the metronome playlist (M39-V2
   * Phase W0-c-ii hotfix). The audio backend reports a WRAPPED
   * `currentTime` per callback; the ambiguity — is loop 3 near
   * its end (currentTime ≈ 0.95) or loop 4 near its start
   * (currentTime ≈ 0.05)? — killed the translator's
   * `Math.round`-based inference under real audio load
   * (observed 60+ spurious re-anchors in 8 seconds on-tablet).
   * We track the loop count explicitly: increment when
   * `currentTime` drops sharply (from > 0.7s to < 0.3s of a
   * 1-second loop). Zero while stopped; reset on start.
   */
  private metronomeLoopCount = 0
  private metronomeLastWrappedSec = 0
  /**
   * Monotonic stamp of the previous position report. v5 counts wraps from
   * the gap BETWEEN callbacks, so it needs the previous sample time; zero
   * means "no baseline yet" (fresh start, or after stop).
   */
  private metronomeLastSampleMs = 0

  metronome = {
    start: (
      loop: { module: number; division: 1 | 2 | 3 | 4; swing: number; durationMs: number },
      volume: number,
      baseBpm?: number,
    ): void => {
      // Start the transport FIRST so a status callback firing during
      // playlist creation (unlikely but possible) sees the fresh
      // generation and non-zero ticksPerSecond.
      if (baseBpm !== undefined) {
        this.metronomeStartMonotonicMs = this.clock()
        this.metronomeLoopCount = 0
        this.metronomeLastWrappedSec = 0
        this.metronomeLastSampleMs = 0
        this.metronomeTransport.start(baseBpm)
      }
      const observer: MetronomePlayerObserver | undefined =
        baseBpm === undefined
          ? undefined
          : {
              now: () => this.clock(),
              onPositionReport: (report) => {
                const snap = this.metronomeTransport.snapshot()
                if (snap.state !== 'running' || snap.ticksPerSecond <= 0) return
                if (!Number.isFinite(report.loopDurationSec) || report.loopDurationSec <= 0) return
                // Anchor-storm fix v2 (2026-08-31, per
                // .claude/plans/anchor-storm-notes.md).
                //
                // Attempt v1 (`floor(wallElapsedSec / loopDurationSec)`)
                // made things worse — audio startup latency (~50-200 ms)
                // caused wall time to run ahead of audio time; my
                // wall-derived loop count over-shot by 1 per loop
                // whenever cumulative drift crossed a loop boundary.
                // Result: 650 re-anchors instead of 371.
                //
                // v2: keep position-based wrap detection (audio-
                // authoritative) but fix the condition. The old
                // detector required BOTH `wrappedPositionSec < 0.4`
                // AND `lastWrapped > 0.6`. Under JS-scheduling load
                // the ~500 ms callback cadence became irregular; a
                // callback landing mid-loop-after-wrap
                // (e.g. lastWrapped=0.8 → current=0.55) DIDN'T
                // satisfy `< 0.4` and the counter fell behind.
                //
                // New condition: any BACKWARDS jump in
                // wrappedPositionSec is a wrap. Small backwards
                // jumps (< 10 % of loop, JS reordering glitches)
                // are ignored — the position keeps its last value
                // and no correction fires. Large backwards jumps
                // ARE wraps. Multi-loop skips (JS thread pause
                // longer than one loop): detect via wall time — if
                // wall elapsed since last callback > 1.5 loops, add
                // the extra loops beyond the single wrap.
                // v5 — wall-time DELTA wrap counting.
                //
                // Four previous attempts failed:
                //   v1 absolute wall time      → 650 re-anchors (worse)
                //   v2 position + wall floor   → 340
                //   v3 pure position           → 332
                //   v4 threshold 0.1 + hold    → 1954 (reverted)
                //
                // v1 and v2 both used wall time measured from
                // `metronome.start`, which is poisoned by audio-startup
                // latency: wall time crosses a loop boundary before audio
                // does, so the count runs ahead. v3/v4 used position
                // deltas alone, which the ~500 ms callback cadence on a
                // 1000 ms loop fools — a wrap observed exactly half a loop
                // backwards is ambiguous.
                //
                // The DELTA form dodges both traps. It trusts only the gap
                // BETWEEN two consecutive callbacks, never elapsed time
                // since start, so startup latency cancels out:
                //
                //   a wrap turns a forward advance A into (A − loop), so
                //   wraps = round((expectedAdvance − observedAdvance) / loop)
                //
                // `round()` gives ±half-loop tolerance — far wider than any
                // real audio-vs-wall drift — and multi-loop JS stalls fall
                // out of the same formula instead of needing a special case.
                if (this.metronomeLastSampleMs === 0) {
                  // First report of this run: establish the baseline. No
                  // delta exists yet, so no wrap can be inferred.
                  this.metronomeLastWrappedSec = report.wrappedPositionSec
                  this.metronomeLastSampleMs = report.sampleMonotonicMs
                  return
                }
                const gapMs = report.sampleMonotonicMs - this.metronomeLastSampleMs
                // Duplicate or out-of-order callback — nothing to measure.
                if (gapMs <= 0) return
                const expectedAdvanceSec = gapMs / 1000
                const observedAdvanceSec =
                  report.wrappedPositionSec - this.metronomeLastWrappedSec
                // Guard against counting a wrap on ordinary jitter: only
                // consider one when the position actually went BACKWARDS,
                // or when more than a full loop of wall time has passed
                // (which forces at least one wrap regardless of position).
                // Without this, float noise on a forward step would round
                // to 1 and over-count — the failure mode that sank v1/v2.
                const wraps =
                  observedAdvanceSec < 0 || expectedAdvanceSec > report.loopDurationSec
                    ? Math.round(
                        (expectedAdvanceSec - observedAdvanceSec) / report.loopDurationSec,
                      )
                    : 0
                if (wraps > 0) {
                  this.metronomeLoopCount += wraps
                } else if (wraps < 0) {
                  // Audio ran backwards past a whole loop — impossible for
                  // a looping playlist. Treat as a stale callback and drop
                  // it rather than corrupt the counter.
                  return
                }
                this.metronomeLastSampleMs = report.sampleMonotonicMs
                this.metronomeLastWrappedSec = report.wrappedPositionSec
                const absoluteSec =
                  this.metronomeLoopCount * report.loopDurationSec + report.wrappedPositionSec
                const observedAbsoluteTick = absoluteSec * snap.ticksPerSecond
                this.metronomeTransport.correct({
                  observedAbsoluteTick,
                  observedAtMonotonicMs: report.sampleMonotonicMs,
                  observedGeneration: snap.generation,
                })
              },
            }
      this.metronomePlayer.start(loop, volume, observer)
    },
    stop: (): void => {
      this.metronomePlayer.stop()
      this.metronomeTransport.stop()
      this.metronomeStartMonotonicMs = 0
      this.metronomeLoopCount = 0
      this.metronomeLastWrappedSec = 0
      this.metronomeLastSampleMs = 0
    },
    setVolume: (volume: number): void => {
      this.metronomePlayer.setVolume(volume)
    },
    transport: this.metronomeTransport,
    notifyDisruption: (reason: string): void => {
      // Pass-through to the transport (M39-V2 Phase W0-d).
      // Caller decides whether to also re-play the metronome
      // loop — this method only invalidates the JS-side
      // timeline. If the caller does restart the loop, the
      // observer wire will re-anchor via the normal correct()
      // path.
      this.metronomeTransport.notifyDisruption(reason)
    },
  }

  constructor(opts: VoiceOutputExpoOptions = {}) {
    this.manifest = opts.manifest ?? voiceAssetManifest
    this.vocabulary = opts.vocabulary ?? 'numbers'
    this.clock = opts.clock ?? (() => performance.now())
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancelScheduled = opts.cancelScheduled ?? ((h) => clearTimeout(h as never))
    this.makePlayer = opts.createPlayer ?? ((source) => createAudioPlayer(source))
    this.speaker = opts.speaker ?? Speech
    this.setAudioMode = opts.setAudioMode ?? setAudioModeAsync
    const latency = opts.calibratedAudioOutputLatencyMs
    if (latency !== undefined && (!Number.isFinite(latency) || latency < 0)) {
      throw new Error(
        `VoiceOutputExpo: calibratedAudioOutputLatencyMs must be ≥ 0, got ${latency}`,
      )
    }
    this.calibratedLatencyMs = latency ?? DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS
  }

  /**
   * The calibrated audio-output latency this instance was constructed
   * with — the number the dispatcher subtracts to align audible onset
   * with the intended tick. Read-only after construction.
   */
  get calibratedAudioOutputLatencyMs(): number {
    return this.calibratedLatencyMs
  }

  /**
   * Compute the ms at which a coach event should FIRE so its audible
   * onset lands at `tickTimeMs`, honoring this instance's calibrated
   * latency. Thin wrapper around `latencyCompensatedDispatchMs` — kept
   * as an instance method so callers pipe the calibration through
   * without importing the module-level default.
   */
  dispatchAtMsForTickTime(tickTimeMs: number): number {
    return latencyCompensatedDispatchMs(tickTimeMs, this.calibratedLatencyMs)
  }

  /** False means permanent no-audio mode — the workout runs without a coach. */
  get available(): boolean {
    return !this.failed
  }

  /**
   * The instant, on `clock()`, at which the coach track is expected to
   * fall silent. Never returns a past value — a quiet coach reports 0.
   * See `busyUntilMs` and A15/#256.
   */
  audibleUntilMs(): number {
    const now = this.clock()
    return this.busyUntilMs > now ? this.busyUntilMs : 0
  }

  /**
   * Advance `busyUntilMs` to cover a clip of `durationMs` starting now,
   * plus a `COACH_LANE_RELEASE_GRACE_MS` tail so the next armed event
   * doesn't collide with the previous clip's decay (M39-V2 Phase 4-ii
   * "extra muted measure" fix).
   *
   * A shorter clip does NOT shorten the window — if a longer clip is
   * already sounding, the earlier deadline stands.
   */
  private markBusy(durationMs: number | undefined): void {
    if (!durationMs || durationMs <= 0) return
    const end = this.clock() + durationMs + COACH_LANE_RELEASE_GRACE_MS
    if (end > this.busyUntilMs) this.busyUntilMs = end
  }

  /**
   * Mint a fresh coach-lane arm id and store it as the current
   * armed run. Every previously issued runId becomes stale and any
   * deferred callback carrying it will fail `isArmedRunId` — the
   * exclusive-lane guarantee (M39-V2 Phase 4-ii).
   *
   * Returns the new runId string. Caller passes it into any timer or
   * finish-callback that must self-check its liveness.
   */
  mintCoachRunId(): string {
    this.runIdCounter += 1
    this.armedRunId = `coach-${this.runIdCounter}`
    return this.armedRunId
  }

  /**
   * Whether the given runId is still the armed coach-lane owner. A
   * finish callback whose runId is stale should return without
   * modifying any lane state (marking busy, releasing focus, etc.);
   * see the coach-lane exclusivity contract in the plan.
   */
  isArmedRunId(runId: string): boolean {
    return this.armedRunId === runId
  }

  /**
   * Drop the current coach-lane arm without minting a new one. Used
   * when a coach event finishes cleanly and no follow-up is queued;
   * the next arm must be minted via `mintCoachRunId`. Idempotent.
   */
  clearCoachRunId(): void {
    this.armedRunId = null
    this.armedEvent = null
  }

  /**
   * Arm a compiled coach event on the exclusive lane (M39-V2 Phase 4-iv).
   *
   * Mints a fresh runId (via `mintCoachRunId`), resolves the dialect
   * from `pendingVocabulary` if a swap has been queued (else the
   * current `vocabulary`), and stores the full arm as `armedEvent`.
   * The arm's `lockedVocabulary` is FROZEN — a subsequent
   * `setVocabulary` call goes into `pendingVocabulary` and only
   * takes effect on the NEXT `armCoachEvent`. This is what preserves
   * "rep 0 finishes numbers even if the user tapped 'names' mid-play"
   * while letting rep 1 start in the new dialect.
   *
   * Returns the full `ArmedCoachEvent` so the caller can thread the
   * runId through any timers or finish callbacks that need to
   * self-check via `isArmedRunId`.
   */
  armCoachEvent(spec: { eventId: string }): ArmedCoachEvent {
    // Take the pending vocab (a user-requested swap) if one is queued
    // — the swap "commits" at the next arm. Otherwise keep the current.
    if (this.pendingVocabulary !== null) {
      this.vocabulary = this.pendingVocabulary
      this.pendingVocabulary = null
    }
    const runId = this.mintCoachRunId()
    const armed: ArmedCoachEvent = {
      eventId: spec.eventId,
      runId,
      lockedVocabulary: this.vocabulary,
    }
    this.armedEvent = armed
    return armed
  }

  /**
   * The currently-armed coach event, or null when nothing is armed.
   * Useful for dispatchers that need to inspect the frozen vocab of
   * the in-flight event without racing on it.
   */
  activeCoachArm(): ArmedCoachEvent | null {
    return this.armedEvent
  }

  /**
   * Switch the coach vocabulary. If no event is armed, the switch
   * takes effect immediately (matches V1c behaviour). If an event IS
   * armed, the switch is DEFERRED: `pendingVocabulary` records the
   * user's choice and the swap commits at the next `armCoachEvent`.
   * The in-flight event finishes in its own dialect — no mid-clip
   * hijack, no strike-timing change (M39-V2 Phase 4-iv).
   */
  setVocabulary(vocabulary: VoiceVocabulary): void {
    if (this.armedEvent !== null) {
      this.pendingVocabulary = vocabulary
      return
    }
    this.vocabulary = vocabulary
  }

  /**
   * The vocabulary the NEXT armed coach event will resolve into. When
   * a swap has been queued (armed-event-in-flight case) this reports
   * the queued dialect; otherwise it reports the current one.
   */
  nextArmVocabulary(): VoiceVocabulary {
    return this.pendingVocabulary ?? this.vocabulary
  }

  /**
   * Preload an asset in BOTH vocabularies so the runtime vocab swap
   * is free (M39-V2 Phase 4-v, Kyle amended blueprint §Preload both
   * tracks for the currently-armed cue).
   *
   * The V1c preload path already warms the opening set in both
   * dialects (see `preload()` below). This method extends the same
   * pattern to arbitrary clips: a cue about to arm calls this for
   * each of its coach events so both dialects are resident when the
   * arm fires. Idempotent — already-loaded clips are moved to the
   * MRU position of the resident pool but not re-created.
   *
   * The current vocabulary is preserved across the call; a caller
   * warming clips is not doing a real vocab switch.
   */
  preloadBothVocabsFor(id: VoiceAssetId, form: PhraseForm = 'standalone'): void {
    if (this.failed) return
    const original = this.vocabulary
    try {
      this.vocabulary = 'numbers'
      this.playerFor(id, form)
      this.vocabulary = 'names'
      this.playerFor(id, form)
    } finally {
      this.vocabulary = original
    }
  }

  /**
   * Load every clip into a player.
   *
   * Called during the countdown. A single clip that fails does not fail the
   * workout: it is logged and left absent, so the coach loses one word rather
   * than its voice.
   */
  async preload(): Promise<void> {
    try {
      // 'mixWithOthers' until something is actually audible — asking for
      // focus while silent would duck the athlete's music for nothing.
      await this.setAudioMode({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' })
    } catch (err) {
      this.failed = true
      logger.warn('puncheokie.voice.unavailable', 'audio stack failed to initialise', {
        error: safe(String(err)),
      })
      return
    }

    // Warm the clips a round actually opens with, not every clip in every
    // form: the pool cap means preloading everything would only evict most of
    // it again, and holding that many tracks is what exhausted the device.
    const warm: Array<[VoiceAssetId, PhraseForm]> = [
      ['bell', 'standalone'],
      ['tone-ready', 'standalone'],
      ['tone-repeat', 'standalone'],
      ['tone-warning', 'standalone'],
      ...(['1', '2', '3', '4', '5', '6'] as VoiceAssetId[]).map(
        (id) => [id, 'combo'] as [VoiceAssetId, PhraseForm],
      ),
    ]

    let loaded = 0
    for (const [id, form] of warm) {
      if (this.playerFor(id, form)) loaded += 1
    }

    // Both tracks loaded (Kyle's live vocabulary switch): warm the OTHER
    // vocabulary's same opening set, so the radio flip is instant. The
    // pool is keyed by vocabulary, so these coexist with the primary's.
    const primary = this.vocabulary
    this.vocabulary = primary === 'numbers' ? 'names' : 'numbers'
    for (const [id, form] of warm) this.playerFor(id, form)
    this.vocabulary = primary

    if (loaded === 0) {
      this.failed = true
      logger.warn('puncheokie.voice.unavailable', 'no clips loaded; running without voice', {})
    }
  }

  /**
   * The player for one clip, created on demand and kept in the pool.
   *
   * Returns `undefined` when the clip cannot be created at all, which is a
   * missing asset rather than a full pool — eviction happens first, so a
   * failure here is about the file.
   */
  private playerFor(id: VoiceAssetId, form: PhraseForm): AudioPlayer | undefined {
    const key = this.keyFor(id, form)
    const existing = this.players.get(key)
    if (existing) {
      // Re-insert so this key is now the most recently used.
      this.players.delete(key)
      this.players.set(key, existing)
      return existing
    }

    while (this.players.size >= MAX_RESIDENT_PLAYERS) {
      const oldest = this.players.keys().next()
      if (oldest.done) break
      const evicted = this.players.get(oldest.value)
      this.players.delete(oldest.value)
      try {
        evicted?.remove()
      } catch {
        // Already gone; the point was to stop holding the track.
      }
    }

    try {
      const module = this.manifest.assets[this.vocabulary][form][id]
      if (module === undefined) {
        // Only fused-body ids (`1b..6b`) can be absent from a slot:
        // they ship only in numbers/standalone. Reaching here means
        // an announcer tried to play a fused-body id under
        // names/* or numbers/combo, which never happens today —
        // logging + throw lets the existing "clip did not load"
        // path handle it uniformly.
        throw new Error(`no manifest entry for ${this.vocabulary}/${form}/${id}`)
      }
      const player = this.makePlayer(module)
      this.players.set(key, player)
      // Duration is read lazily, not here. A player reports 0 until its asset
      // has loaded, and reading it at construction meant every clip fell back
      // to the assumed length.
      this.cacheDuration(key, player)
      return player
    } catch (err) {
      logger.warn('puncheokie.voice.clipMissing', 'clip did not load', {
        asset: safe(id),
        form: safe(form),
        error: safe(String(err)),
      })
      return undefined
    }
  }

  /**
   * Play a block-level cornerman instruction (WS4 / A23). Instructions
   * live outside the vocabulary manifest — the compile pipeline resolves
   * text → Metro module → `InstructionPayload`, and we play that module
   * directly. Chimes down like every other coach line via the standard
   * duck flow: instructions carry the same "call" volume envelope as a
   * ceremony, but they never mute other calls (they're not chime-ins;
   * they're standalone asides).
   */
  playInstruction(clip: { text: string; module: number; durationMs: number }): void {
    if (this.failed) return
    this.requestFocus()
    try {
      const player = this.makePlayer(clip.module)
      player.volume = this.callsMuted() ? 0 : this.volumes.voice
      player.seekTo(0)
      player.play()
      this.markBusy(clip.durationMs)
      logger.info('puncheokie.voice.play', 'instruction playing', {
        kind: safe('instruction'),
        text: safe(clip.text),
        durationMs: safe(clip.durationMs),
      })
    } catch (err) {
      logger.warn('puncheokie.voice.playFailed', 'instruction did not play', {
        text: safe(clip.text),
        error: safe(String(err)),
      })
    }
  }

  /**
   * Play a combo-announce clip (M39-V1c Phase B).
   *
   * Mechanically identical to `playInstruction` — one-shot playback of
   * a pre-rendered wav under the voice envelope — but tagged as
   * `combo-announce` in the log stream so the analyzer/audit trail
   * can separate "coach's aside" from "coach's block-start command."
   * Same duck posture, same bus advance.
   */
  playComboAnnounce(clip: { text: string; module: number; durationMs: number }): void {
    if (this.failed) return
    this.requestFocus()
    try {
      const player = this.makePlayer(clip.module)
      player.volume = this.callsMuted() ? 0 : this.volumes.voice
      player.seekTo(0)
      player.play()
      this.markBusy(clip.durationMs)
      logger.info('puncheokie.voice.play', 'combo-announce playing', {
        kind: safe('combo-announce'),
        text: safe(clip.text),
        durationMs: safe(clip.durationMs),
      })
    } catch (err) {
      logger.warn('puncheokie.voice.playFailed', 'combo-announce did not play', {
        text: safe(clip.text),
        error: safe(String(err)),
      })
    }
  }

  playAsset(id: VoiceAssetId, atMs?: number): void {
    if (this.failed) return
    const priority = assetPriority(id)

    if (atMs === undefined) {
      this.emit(id, priority)
      return
    }

    const delay = atMs - this.clock()
    if (delay <= 0) {
      // Late, not dropped. The call is still the call.
      this.emit(id, priority)
      return
    }

    // Same deadline as something already waiting means the same phrase, so it
    // joins that group rather than becoming a second thing that fires at the
    // identical instant.
    const existing = this.pending.find((g) => g.atMs === atMs)
    if (existing) {
      existing.ids.push(id)
      if (priority < existing.priority) existing.priority = priority
      return
    }

    this.queueGroup({ atMs, ids: [id], priority, form: 'standalone', tightness: 1, handle: undefined }, delay)
  }

  /**
   * Play several clips as one call.
   *
   * A combination is one utterance, so it is delivered in the `combo` form —
   * clipped, quicker renderings of the same words — and the gap between clips
   * is scaled by `tightness` so the numbers run together the way a coach
   * calls them. A single command keeps the `standalone` form and its full
   * spacing, which is what makes one punch sound like a command rather than
   * an orphaned fragment of a combination.
   */
  playPhrase(ids: readonly VoiceAssetId[], atMs?: number, tightness = 1): void {
    if (this.failed || ids.length === 0) return
    const form: PhraseForm = ids.length > 1 ? 'combo' : 'standalone'
    const priority = ids
      .map(assetPriority)
      .reduce((lowest, each) => (each < lowest ? each : lowest), AUDIO_PRIORITY.coachingReminder)

    const steps = ids.map((id) => ({ id, priority: assetPriority(id), form, tightness }))
    const delay = atMs === undefined ? 0 : atMs - this.clock()
    if (delay <= 0) {
      // Late, not dropped. The call is still the call.
      this.playSequence(steps)
      return
    }

    this.queueGroup({ atMs: atMs as number, ids: [...ids], priority, form, tightness, handle: undefined }, delay)
  }

  /**
   * Length of a rendered combination, from its sidecar.
   *
   * Read from the manifest rather than from a player, so the announcer can
   * place a phrase before anything has been loaded — the timing was measured
   * at render time by the synthesizer itself.
   */
  combinationDurationMs(
    _combination: string,
    _cadence: string,
    _voice?: CombinationVoice,
  ): number | undefined {
    // Phase 5-iv retired the per-punch phrase corpus. Combination-length
    // lookups on this port now always return undefined — the announcer
    // falls through to the announce clip path (comboAnnounceManifest)
    // or leaves the block silent when no announce clip is rendered.
    return undefined
  }

  /**
   * Play a whole combination as one utterance.
   *
   * Returns false when nothing has been rendered for it, which tells the
   * announcer to fall back to the per-word path rather than leaving the
   * combination uncalled.
   */
  playCombination(
    _combination: string,
    _cadence: string,
    _atMs?: number,
    _voice?: CombinationVoice,
  ): boolean {
    // Phase 5-iv retired the per-punch phrase corpus. Announces now come
    // through `playComboAnnounce` (comboAnnounceManifest) or the
    // announcer's per-word fallback (playAsset per token). This method
    // always returns false so the announcer knows to take one of those
    // paths; the old body — including its phrase-player lifecycle,
    // launch-late telemetry, and delayed-start scheduling — is gone
    // with the corpus that fed it.
    return false
  }

  /**
   * How long a clip takes to say, once it has been loaded.
   *
   * Measured from the file rather than estimated. `CueAnnouncer` uses this to
   * place a phrase so it finishes before the combination starts, and a guessed
   * number there would misplace every call.
   */
  assetDurationMs(id: VoiceAssetId, form: PhraseForm = 'standalone'): number | undefined {
    const key = this.keyFor(id, form)
    const cached = this.durations.get(key)
    if (cached !== undefined) return cached
    // Only a resident player can be measured; asking for one here would
    // create a track just to read a number.
    const player = this.players.get(key)
    return player ? this.cacheDuration(key, player) : undefined
  }

  /**
   * Read a player's length, caching it once it becomes real.
   *
   * `duration` is in seconds and reads 0 until the asset has loaded, so a
   * zero is "not yet known" rather than "instantaneous" and must not be
   * cached — caching it would freeze every clip at the fallback length for
   * the life of the session.
   */
  private cacheDuration(key: string, player: AudioPlayer): number | undefined {
    const seconds = player.duration
    if (typeof seconds !== 'number' || !(seconds > 0)) return undefined
    const ms = Math.round(seconds * 1000)
    this.durations.set(key, ms)
    return ms
  }

  private fireGroup(group: PendingGroup): void {
    this.pending = this.pending.filter((g) => g !== group)
    this.playSequence(
      group.ids.map((each) => ({
        id: each,
        priority: assetPriority(each),
        form: group.form,
        tightness: group.tightness,
      })),
    )
  }

  private queueGroup(group: PendingGroup, delay: number): void {
    group.handle = this.schedule(() => this.fireGroup(group), delay)
    this.pending.push(group)
  }

  speak(text: string, priority: AudioPriority): void {
    if (this.failed) return
    // Descriptive only (D16). Nothing time-critical reaches this path.
    this.requestFocus()
    this.speaker.speak(text, { volume: this.volumes.voice })
    void priority
  }

  tone(kind: ToneKind): void {
    this.playAsset(TONE_ASSETS[kind])
  }

  /** Drop every scheduled-but-unstarted combination call. See the port note. */
  cancelScheduledCombinations(): void {
    this.scheduledPhrases = []
  }

  /**
   * The conductor's beat: fire every scheduled combination whose time has
   * come. Called from the workout runner's tick — the same sample that
   * advances the cue engine and the screen — so scheduled audio keeps the
   * screen's clock rather than a wall timer's (see `scheduledPhrases`).
   */
  advance(): void {
    const now = this.clock()
    if (this.scheduledPhrases.length > 0) {
      const due = this.scheduledPhrases.filter((p) => p.at <= now)
      if (due.length > 0) {
        this.scheduledPhrases = this.scheduledPhrases.filter((p) => p.at > now)
        due.sort((a, b) => a.at - b.at)
        // A13 (#267): the same synchronous loop used to fire every due
        // scheduled phrase back-to-back — each start() removed the
        // previous phrasePlayer, so of N same-tick phrases only the
        // last was audible. Now: run the earliest, and once busyUntilMs
        // has been advanced by its start() the rest re-arm for the next
        // tick. That gives phrases scheduled within the same 50 ms
        // window a chance to actually be heard in order, rather than
        // being silently swallowed.
        const first = due[0]
        if (first) {
          first.run()
          // Requeue the rest at their original time — advance() runs
          // every tick, so they'll retry immediately after busyUntilMs
          // catches up.
          const later = due.slice(1)
          if (later.length > 0) this.scheduledPhrases.push(...later)
        }
      }
    }
    // Pending groups (tones, per-word phrases) ride the tick too: the timer
    // stays as a fallback for callers with no conductor, and whichever
    // fires first removes the group so the other is a no-op.
    const dueGroups = this.pending.filter((g) => g.atMs <= now)
    for (const group of dueGroups) {
      this.cancelScheduled(group.handle)
      this.fireGroup(group)
    }
  }

  /**
   * Play clips back to back, each starting when the previous finishes.
   *
   * The whole point of grouping: a combination is one utterance. Starting the
   * next clip on a timer set from the current clip's measured length is what
   * makes "one, one, two" three audible words instead of one overlapped
   * noise — and it is what lets the same asset be said twice in a row, since
   * the second play no longer interrupts the first on the shared player.
   */
  private playSequence(steps: SequenceStep[]): void {
    if (steps.length === 0) return
    // 2026-08-31 anchor-storm loop, TRF audio-doubling fix.
    //
    // Old behaviour: `clearSequence()` unconditionally, then seed +
    // start. That killed IN-FLIGHT clips from the OWNING cue's own
    // phrase whenever a next-cue's `playPhrase(...)` fired. TRF's
    // `1-2` opening was heard as `1, 1` (r1-b1 rep 0 fired `'1'`,
    // scheduled `'2'`; r1-b1 rep 1 or the next cue fired
    // `playPhrase(...)` → clearSequence dropped pending `'2'`).
    // r1-b2 `slip-2-3-2` heard only `slip` for the same reason —
    // r1-b3's phrase call clearSequence'd the pending `2/3/2`.
    //
    // A6 (#260) worried about a DOUBLE-TIMER bug — two shift()s
    // racing on the shared sequence array producing double clip
    // rate. That risk is real IF two `advanceSequence()` calls
    // are ever concurrently active on the same array. We prevent
    // it by construction here: only start a new advanceSequence()
    // when NO timer is currently armed. If a timer is running, the
    // new steps just get appended to the queue; the running timer
    // will pick them up naturally when it next advances.
    const timerActive = this.sequenceHandle !== null
    const queueEmpty = this.sequence.length === 0
    if (timerActive || !queueEmpty) {
      // A sequence is running — append. Existing timer walks the
      // enlarged queue.
      this.sequence.push(...steps)
      return
    }
    // Idle state — seed the queue and start advancing.
    this.sequence = [...steps]
    this.advanceSequence()
  }

  private advanceSequence(): void {
    const next = this.sequence.shift()
    if (!next) {
      this.sequenceHandle = null
      return
    }
    this.emit(next.id, next.priority, next.form)
    if (this.sequence.length === 0) {
      this.sequenceHandle = null
      return
    }
    // Tightness trims the tail of each clip so the words run together. The
    // floor keeps two numbers countable — below it a fast call stops being a
    // call and becomes a stutter.
    const clipMs = this.assetDurationMs(next.id, next.form) ?? FALLBACK_CLIP_MS
    const holdMs = Math.max(Math.round(clipMs * next.tightness), MIN_CLIP_GAP_MS)
    this.sequenceHandle = this.schedule(() => {
      this.advanceSequence()
    }, holdMs)
  }

  private clearSequence(): void {
    if (this.sequenceHandle !== null) this.cancelScheduled(this.sequenceHandle)
    this.sequenceHandle = null
    this.sequence = []
  }

  /**
   * Drop anything queued that is less urgent than `belowPriority`.
   *
   * Only queued items — a clip already sounding is left alone. Cutting a word
   * off mid-syllable to make room for a lower-stakes one is worse than letting
   * it finish, and the priority order exists to decide what gets *queued*, not
   * to chop audio.
   */
  cancel(belowPriority: AudioPriority): void {
    const kept: PendingGroup[] = []
    for (const entry of this.pending) {
      if (entry.priority > belowPriority) this.cancelScheduled(entry.handle)
      else kept.push(entry)
    }
    this.pending = kept
    // A phrase mid-flight is a queue as much as a sound: the clips not yet
    // started are exactly what `cancel` is for.
    if (this.sequence.some((step) => step.priority > belowPriority)) this.clearSequence()
    // A scheduled combination has not started yet, so it is queue too —
    // including every pending burst re-call.
    if (belowPriority <= AUDIO_PRIORITY.punchCommand) this.scheduledPhrases = []
    if (belowPriority <= AUDIO_PRIORITY.metric) {
      try {
        this.speaker.stop()
      } catch {
        // A speech engine that will not stop is not worth failing over.
      }
    }
    // A10 (#264): at safety priority (pause/cancel of the session)
    // cancel() must also silence the sounding combination phrase —
    // otherwise up to 8.7 s of coach continues over a paused workout.
    // Anything above safety keeps the previous "chop mid-syllable is
    // worse than late-and-heard" contract.
    if (belowPriority <= AUDIO_PRIORITY.safety) {
      try {
        this.phrasePlayer?.remove()
      } catch {
        // Already gone.
      }
      this.phrasePlayer = null
      this.busyUntilMs = 0
    }
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v }
    for (const [key, player] of this.players) {
      // key is `<vocabulary>/<form>/<id>`.
      const id = key.split('/')[2] as VoiceAssetId
      player.volume = BELL_ASSETS.has(id) ? this.volumes.bells : this.volumes.voice
    }
    // The metronome loop is its own player and its own volume axis
    // — carry the slider change through without restarting the loop.
    this.metronomePlayer.setVolume(this.volumes.metronome)
  }

  /** Release players and any held focus. */
  release(): void {
    for (const group of this.pending) this.cancelScheduled(group.handle)
    this.pending = []
    this.clearSequence()
    this.scheduledPhrases = []
    try {
      this.phrasePlayer?.remove()
    } catch {
      // Already gone.
    }
    this.phrasePlayer = null
    for (const player of this.players.values()) {
      try {
        player.remove()
      } catch {
        // Already gone; nothing to do.
      }
    }
    this.players.clear()
    // Tear the metronome loop down alongside every other native
    // handle — a stranded loop after `release()` would keep clicking
    // over the summary screen.
    try {
      this.metronomePlayer.stop()
    } catch {
      // Already gone.
    }
    this.focusHeld = false
  }

  // ------------------------------------------------------------- internals

  private keyFor(id: VoiceAssetId, form: PhraseForm = 'standalone'): string {
    return `${this.vocabulary}/${form}/${id}`
  }

  private emit(id: VoiceAssetId, priority: AudioPriority, form: PhraseForm = 'standalone'): void {
    const player = this.playerFor(id, form)
    if (!player) return
    this.requestFocus()
    try {
      // Bells carry their own volume; a chime-in always sounds at full
      // voice; a shot-call word inside a chime-in's mute window is born
      // silent (it out-lives no window — word clips are shorter).
      player.volume = BELL_ASSETS.has(id)
        ? this.volumes.bells
        : !isChimeInAsset(id) && this.callsMuted()
          ? 0
          : this.volumes.voice
      // Rewind first: a clip played twice in a row would otherwise resume from
      // its own end and produce silence.
      player.seekTo(0)
      player.play()
      // A15: advance the busy window so schedulers know the coach is
      // audible for the length of this clip. `assetDurationMs` reads
      // from the runtime cache; `CALLOUT_CLIPS` fills the co- gap the
      // same way it does for the duck.
      //
      // BELLS EXCLUDED (GH #305): the coach lane models SPEECH — two
      // voices must not stack. A bell is percussion, and marking the
      // lane busy for its ~2.5 s ring made the round-open bell "talk
      // over" every round's opening combo-announce: the precall's
      // audible window (authored to END by the first strike) closed
      // entirely inside the bell, so the collision gate declined it and
      // the retry expired on the same tick. Measured on-glass: both
      // heavy-hands and pace-pusher lost their opener to
      // `retry-expired` while the lane was "busy" with the bell.
      // Speaking over a bell tail is the pre-gate behaviour Kyle
      // signed off by ear.
      if (!BELL_ASSETS.has(id)) {
        this.markBusy(
          this.assetDurationMs(id, form)
            ?? CALLOUT_CLIPS[id as CalloutClipId]?.durationMs,
        )
      }
      if (isChimeInAsset(id)) {
        // A1 (fixed): the runtime durations cache is never populated for
        // `co-` assets (playerFor's create branch reads player.duration
        // before it is measured), so this used to fall through to a
        // 2500 ms guess. 41 of 67 ceremony clips exceed that fallback —
        // the largest is `co-pressure-03` at 8373 ms — and any coach
        // call launched inside the too-short duck was then restored to
        // full volume while the ceremony was still speaking, producing
        // the doubled-voice overlap Kyle heard within 15 s of a round
        // start. The compiled `CALLOUT_CLIPS` manifest carries the true
        // measured length; consult it before the cache and the fallback.
        const key = this.keyFor(id, form)
        const measured = this.durations.get(key)
          ?? CALLOUT_CLIPS[id as CalloutClipId]?.durationMs
        this.muteCallsFor(measured ?? 2_500)
      }
      // Success-path record for the QA loop — see playCombination's note.
      logger.info('puncheokie.voice.play', 'clip playing', {
        asset: safe(id),
        form: safe(form),
        vocabulary: safe(this.vocabulary),
        priority: safe(priority),
      })
    } catch (err) {
      logger.warn('puncheokie.voice.playFailed', 'clip did not play', {
        asset: safe(id),
        priority: safe(priority),
        error: safe(String(err)),
      })
    }
  }

  /** Restore handle for the chime-in mute — cosmetic, not a scheduler. */
  private muteRestore: unknown = null
  /** End of the current chime-in mute window, on the injected clock. */
  private callsMutedUntil = 0

  /** Whether the shot-calling track is muted under a chime-in right now. */
  private callsMuted(): boolean {
    return this.clock() < this.callsMutedUntil
  }

  /**
   * Mute the shot-calling track under a chime-in, restoring after the
   * clip's measured length. A timer is acceptable here: it only restores
   * VOLUME — a late restore leaves the calls quiet a moment longer, it
   * never moves any scheduled sound. Pooled word players started inside
   * the window are born at volume 0 and are shorter than the window, so
   * only the phrase player needs the explicit restore.
   */
  private muteCallsFor(durationMs: number): void {
    this.callsMutedUntil = this.clock() + durationMs + CHIME_IN_RELEASE_MS
    try {
      if (this.phrasePlayer) this.phrasePlayer.volume = 0
    } catch {
      return
    }
    if (this.muteRestore !== null) this.cancelScheduled(this.muteRestore)
    this.muteRestore = this.schedule(() => {
      this.muteRestore = null
      try {
        if (this.phrasePlayer) this.phrasePlayer.volume = this.volumes.voice
      } catch {
        // Player already gone.
      }
    }, durationMs + CHIME_IN_RELEASE_MS)
  }

  /**
   * Ask for transient may-duck focus, once, on first audible output.
   *
   * A platform request and nothing more: the app never reads, alters, records
   * or analyses another app's audio (spec §14.6). `doNotMix` is never used —
   * it would pause the athlete's music rather than dip it.
   */
  private requestFocus(): void {
    if (this.focusHeld) return
    this.focusHeld = true
    void this.setAudioMode({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch(
      (err: unknown) => {
        logger.warn('puncheokie.voice.focusFailed', 'audio focus request failed', {
          error: safe(String(err)),
        })
      },
    )
  }
}
