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
import { findPhraseAsset } from './voiceAssets/phraseManifest'

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

/** Clips carried on the bells volume rather than the voice volume (doc §25). */
const BELL_ASSETS: ReadonlySet<VoiceAssetId> = new Set<VoiceAssetId>([
  'bell',
  'tone-ready',
  'tone-repeat',
  'tone-warning',
])

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

  constructor(opts: VoiceOutputExpoOptions = {}) {
    this.manifest = opts.manifest ?? voiceAssetManifest
    this.vocabulary = opts.vocabulary ?? 'numbers'
    this.clock = opts.clock ?? (() => performance.now())
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancelScheduled = opts.cancelScheduled ?? ((h) => clearTimeout(h as never))
    this.makePlayer = opts.createPlayer ?? ((source) => createAudioPlayer(source))
    this.speaker = opts.speaker ?? Speech
    this.setAudioMode = opts.setAudioMode ?? setAudioModeAsync
  }

  /** False means permanent no-audio mode — the workout runs without a coach. */
  get available(): boolean {
    return !this.failed
  }

  /** Which clip set is playing. Changing it reloads on the next `preload`. */
  setVocabulary(vocabulary: VoiceVocabulary): void {
    this.vocabulary = vocabulary
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
      const player = this.makePlayer(this.manifest.assets[this.vocabulary][form][id])
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
    combination: string,
    cadence: string,
    voice?: CombinationVoice,
  ): number | undefined {
    return findPhraseAsset(combination, cadence, voice?.vocabulary, voice?.performance)?.durationMs
  }

  /**
   * Play a whole combination as one utterance.
   *
   * Returns false when nothing has been rendered for it, which tells the
   * announcer to fall back to the per-word path rather than leaving the
   * combination uncalled.
   */
  playCombination(
    combination: string,
    cadence: string,
    atMs?: number,
    voice?: CombinationVoice,
  ): boolean {
    if (this.failed) return false
    const asset = findPhraseAsset(combination, cadence, voice?.vocabulary, voice?.performance)
    if (!asset) return false

    const start = (): void => {
      this.requestFocus()
      try {
        this.phrasePlayer?.remove()
      } catch {
        // Already gone.
      }
      try {
        const player = this.makePlayer(asset.module)
        this.phrasePlayer = player
        // Born silent inside a chime-in's mute window; the window's
        // restore timer brings this same player back to voice volume.
        player.volume = this.callsMuted() ? 0 : this.volumes.voice
        player.play()
        // Success-path record: the QA loop aligns mic recordings of a session
        // against these lines (LogRecord carries both clocks), and a silent
        // round with no .play entries means nothing was even attempted.
        logger.info('puncheokie.voice.play', 'combination phrase playing', {
          cueId: safe(asset.cueId),
          combination: safe(combination),
          cadence: safe(cadence),
          durationMs: safe(asset.durationMs),
        })
      } catch (err) {
        logger.warn('puncheokie.voice.phraseFailed', 'combination phrase did not play', {
          combination: safe(combination),
          cadence: safe(cadence),
          error: safe(String(err)),
        })
      }
    }

    const delay = atMs === undefined ? 0 : atMs - this.clock()
    if (delay <= 0) {
      start()
      return true
    }
    this.scheduledPhrases.push({ at: atMs as number, run: start })
    return true
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
        for (const entry of due) entry.run()
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
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v }
    for (const [key, player] of this.players) {
      // key is `<vocabulary>/<form>/<id>`.
      const id = key.split('/')[2] as VoiceAssetId
      player.volume = BELL_ASSETS.has(id) ? this.volumes.bells : this.volumes.voice
    }
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
      if (isChimeInAsset(id)) {
        this.muteCallsFor(this.durations.get(this.keyFor(id, form)) ?? 2_500)
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
