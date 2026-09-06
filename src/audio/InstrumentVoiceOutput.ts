/**
 * The tablet instrument voice (M40-15 #319) — plays the Dorian Brass Cube
 * from the tablet speaker off the same `CompiledPunchGesture` the bridge
 * receives.
 *
 * ## Native loops only — never a JS-scheduled tick (R1)
 *
 * `MetronomePlayer.ts`'s doc comment carries the measured lesson:
 * `IntroPlayer` lost 25 s to JS-side sequencing under workout load. So the
 * SUSTAINED material — the arp bed and the bass — is pre-rendered loop wavs
 * on the native player (`createAudioPlaylist`, `loop: 'single'`), and JS
 * only decides WHICH loop plays. Punch-triggered one-shots (accent stab,
 * drum) are event-driven and safe: they fire once per gesture, they do not
 * tick.
 *
 * ## v1 deviations from the PC rig (documented per spec §6)
 *
 * 1. Rotation is voiced by the accent stab only — the beds are rendered at
 *    rotation 0 (the natural pool), so the right hand colors the entry tone
 *    but not the arp voicing.
 * 2. Selection swaps commit IMMEDIATELY (Hard-Retrigger feel), not on a
 *    step boundary like the bridge's quantized-rotate.
 * 3. No glide/whammy pitch on samples — the PC rig stays the expressive rig.
 * 4. No idle activity decay — the bed holds its last committed layer until
 *    the next punch, panic, or teardown.
 * 5. A fast chord-alternating flurry pays one `createAudioPlaylist` per
 *    swap (selection-changed gating is the only throttle) — flagged for
 *    on-device listening.
 *
 * ## Failure posture — MetronomePlayer verbatim
 *
 * A throw from `setAudioMode` or `createAudioPlaylist` (preload or swap
 * path) sets `available = false`, tears everything down, logs ONE
 * `puncheokie.instrument.unavailable` warning, and every public method
 * no-ops thereafter — the jam keeps running silently, never blocked. An
 * INDIVIDUAL one-shot clip failing to load is log-and-continue (the
 * `playerFor` posture): the instrument loses one note, not its voice.
 *
 * ## One-shot pool mechanics (the hard-won VoiceOutputExpo patterns)
 *
 * - Pooled preloaded players for the ACTIVE texture only (25 stabs +
 *   5 drums = 30 players + 2 playlists — under the ~48 AudioTrack ceiling
 *   that broke this device; the jam screen runs no coach stack).
 *   The stab pool still wears an LRU cap (`MAX_STAB_PLAYERS`) for defense.
 * - `seekTo` is ASYNC — never `play()` after an unawaited rewind (the
 *   shllck lesson). An armed player (parked at 0) plays instantly; a
 *   retrigger-while-sounding pauses FIRST, rewinds, and plays on the seek's
 *   resolution, with a stalled-seek fallback that plays anyway (degraded,
 *   never silent).
 * - Re-arms are generation-guarded (the `clickScriptGen` pattern) and
 *   pause-before-seek (the voice-storm lesson), so a stale timer never
 *   touches a re-dispatched player.
 */
import {
  createAudioPlayer,
  createAudioPlaylist,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioPlaylist,
} from 'expo-audio'

import { logger, safe } from '@/diagnostics/logger'
import type { CompiledPunchGesture } from '@domain/instrument/gestureSchema'

import { INSTRUMENT_DRUM_KEYS } from './instrumentBankKeys'
import { selectInstrumentSamples, type InstrumentVoiceMode } from './instrumentSelection'
import {
  INSTRUMENT_BANKS,
  type InstrumentBankClip,
  type InstrumentTextureId,
} from './voiceAssets/instrumentBankManifest'

/**
 * LRU cap on the stab pool, sized to hold the whole bank with headroom.
 * The bank grew from 18 to 25 stabs when body shots gained their
 * octave-down notes (M40-28) — at the old cap of 24 preload EVICTED one
 * note, so that stab took the slow recreate path on every hit. The cap
 * still exists so a future, much larger bank cannot recreate the
 * 48-AudioTrack exhaustion (see `MAX_RESIDENT_PLAYERS` in VoiceOutputExpo);
 * 32 stabs + 5 drums + 2 playlists stays comfortably under it.
 */
export const MAX_STAB_PLAYERS = 32

/**
 * Gap after a one-shot's own duration before its player is parked back at
 * 0 for the next punch — the `CLICK_SCRIPT_PREARM_PAD_MS` pattern.
 */
export const ONE_SHOT_REARM_PAD_MS = 200

/**
 * How long a retrigger waits on its rewind before playing anyway — the
 * `playClickScript` degraded-not-silent race, simplified.
 */
export const STALLED_SEEK_FALLBACK_MS = 250

/** Seams mirror `VoiceOutputExpoOptions` so tests need no native binding. */
export interface InstrumentVoiceOutputOptions {
  createPlayer?: (source: number) => AudioPlayer
  createPlaylist?: (opts: {
    sources: number[]
    loop: 'single'
    updateInterval: number
  }) => AudioPlaylist
  schedule?: (fn: () => void, delayMs: number) => unknown
  cancelScheduled?: (handle: unknown) => void
  clock?: () => number
  setAudioMode?: typeof setAudioModeAsync
}

/** One pooled one-shot player and its dispatch bookkeeping. */
interface PooledOneShot {
  player: AudioPlayer
  clip: InstrumentBankClip
  /** True while parked at 0 and ready to play instantly. */
  armed: boolean
  /** Bumped per dispatch; a stale re-arm or seek callback no-ops. */
  gen: number
  /** Pending re-arm timer, cancelled on re-dispatch and on teardown. */
  rearmHandle: unknown
}

export class InstrumentVoiceOutput {
  private readonly makePlayer: (source: number) => AudioPlayer
  private readonly makePlaylist: (opts: {
    sources: number[]
    loop: 'single'
    updateInterval: number
  }) => AudioPlaylist
  private readonly schedule: (fn: () => void, delayMs: number) => unknown
  private readonly cancelScheduled: (handle: unknown) => void
  private readonly clock: () => number
  private readonly setAudioMode: typeof setAudioModeAsync

  private availableFlag = true
  private texture: InstrumentTextureId = 'brass'
  private mode: InstrumentVoiceMode = 'arp'

  /** Pooled one-shots, in least-recently-used order (Map re-insertion). */
  private readonly oneShots = new Map<string, PooledOneShot>()

  private bedPlaylist: AudioPlaylist | null = null
  private bassPlaylist: AudioPlaylist | null = null
  private currentBedKey: string | null = null
  private currentBassKey: string | null = null

  constructor(opts: InstrumentVoiceOutputOptions = {}) {
    this.makePlayer = opts.createPlayer ?? ((source) => createAudioPlayer(source))
    this.makePlaylist = opts.createPlaylist ?? ((o) => createAudioPlaylist(o))
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancelScheduled = opts.cancelScheduled ?? ((h) => clearTimeout(h as never))
    this.clock = opts.clock ?? (() => performance.now())
    this.setAudioMode = opts.setAudioMode ?? setAudioModeAsync
  }

  /** False means permanent no-instrument mode — the jam runs without it. */
  get available(): boolean {
    return this.availableFlag
  }

  /**
   * Set the audio mode and warm the one-shot pools for `textureId`.
   * Called once from the jam screen's lifecycle effect; a texture change
   * afterwards goes through `setTexture`.
   */
  async preload(textureId: InstrumentTextureId): Promise<void> {
    if (!this.availableFlag) return
    this.texture = textureId
    try {
      // VoiceOutputExpo's mode: silent-switch-proof, never ducks the
      // athlete's music while nothing is audible.
      await this.setAudioMode({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' })
    } catch (err) {
      this.fail('audio stack failed to initialise', err)
      return
    }
    const loaded = this.preloadPools(textureId)
    if (loaded === 0) {
      this.fail('no instrument clips loaded', undefined)
    }
  }

  /**
   * Swap the sample-bank texture. Tears down and re-preloads the one-shot
   * pools; if a bed/bass groove is sounding, both playlists are rebuilt
   * from the NEW texture's modules for the same keys — the groove survives
   * the flip.
   */
  setTexture(textureId: InstrumentTextureId): void {
    if (!this.availableFlag) return
    if (textureId === this.texture) return
    this.texture = textureId
    this.releasePools()
    this.preloadPools(textureId)
    const bank = INSTRUMENT_BANKS[textureId]
    if (this.currentBedKey !== null) {
      this.swapLoop('bed', this.currentBedKey, bank.beds[this.currentBedKey])
    }
    if (!this.availableFlag) return
    if (this.currentBassKey !== null) {
      this.swapLoop('bass', this.currentBassKey, bank.basses[this.currentBassKey])
    }
  }

  /**
   * Switch between the sustained-arp voice and the single-notes voice.
   * Entering 'notes' silences the running bed/bass immediately (the stabs
   * ARE the instrument there); returning to 'arp' stays quiet until the
   * next punch commits a cell — the loops restart on a punch, never on a
   * settings tap.
   */
  setMode(mode: InstrumentVoiceMode): void {
    if (!this.availableFlag) return
    if (mode === this.mode) return
    this.mode = mode
    if (mode === 'notes') this.destroyPlaylists()
  }

  /**
   * The per-punch entry point. One-shots first (punch feel), then the
   * loop swaps — and a loop is only touched when its selection CHANGED
   * (R4); a legacy gesture's null bed/bass leaves the sounding loops
   * alone. In 'notes' mode the selection never carries a bed/bass, so
   * only the stab + drum sound.
   */
  handleGesture(gesture: CompiledPunchGesture): void {
    if (!this.availableFlag) return
    const sel = selectInstrumentSamples(gesture, this.texture, this.mode)
    const bank = INSTRUMENT_BANKS[this.texture]
    if (sel.stab !== null) {
      this.fireOneShot(stabPoolKey(sel.stab), bank.stabs[sel.stab], sel.stabGain)
    }
    if (sel.drum !== null) {
      this.fireOneShot(drumPoolKey(sel.drum), bank.drums[sel.drum], sel.drumGain)
    }
    if (sel.bed !== null && sel.bed !== this.currentBedKey) {
      this.swapLoop('bed', sel.bed, bank.beds[sel.bed])
    }
    if (!this.availableFlag) return
    if (sel.bass !== null && sel.bass !== this.currentBassKey) {
      this.swapLoop('bass', sel.bass, bank.basses[sel.bass])
    }
  }

  /**
   * Silence everything now. Playlists are destroyed (a restart begins on
   * the downbeat, the MetronomePlayer stop posture) and pooled players
   * are paused — the pools stay resident and preloaded.
   */
  panic(): void {
    if (!this.availableFlag) return
    this.destroyPlaylists()
    for (const slot of this.oneShots.values()) {
      // Invalidate every in-flight dispatch: a pending retrigger's
      // seekTo(0).then(play) — and its closure-local stalled-seek fallback
      // timer, which panic cannot cancel — must never sound a one-shot
      // after the user demanded silence. Same epoch bump `releaseSlot`
      // documents, minus the remove (pools stay resident); the next
      // dispatch finds the slot un-armed, takes the retrigger path, and
      // re-arms itself.
      slot.gen += 1
      if (slot.rearmHandle !== null) {
        this.cancelScheduled(slot.rearmHandle)
        slot.rearmHandle = null
      }
      try {
        slot.player.pause()
      } catch {
        // Already stopped.
      }
    }
  }

  /** Full teardown — called on unmount. The instance is done after this. */
  release(): void {
    if (!this.availableFlag) return
    this.destroyPlaylists()
    this.releasePools()
  }

  // -------------------------------------------------------------------------

  /** Warm one pooled player per stab and drum of `textureId`. */
  private preloadPools(textureId: InstrumentTextureId): number {
    const bank = INSTRUMENT_BANKS[textureId]
    let loaded = 0
    for (const key of Object.keys(bank.stabs)) {
      if (this.pooledFor(stabPoolKey(key), bank.stabs[key])) loaded += 1
    }
    for (const key of INSTRUMENT_DRUM_KEYS) {
      if (this.pooledFor(drumPoolKey(key), bank.drums[key])) loaded += 1
    }
    return loaded
  }

  /**
   * The pooled player for one one-shot key, created on demand and kept in
   * the pool (the `playerFor` posture: a create failure loses one note,
   * not the voice). Re-insertion keeps the Map in LRU order.
   */
  private pooledFor(
    poolKey: string,
    clip: InstrumentBankClip | undefined,
  ): PooledOneShot | undefined {
    if (clip === undefined) {
      logger.warn('puncheokie.instrument.clipMissing', 'no bank entry for one-shot', {
        key: safe(poolKey),
        texture: safe(this.texture),
      })
      return undefined
    }
    const existing = this.oneShots.get(poolKey)
    if (existing) {
      this.oneShots.delete(poolKey)
      this.oneShots.set(poolKey, existing)
      return existing
    }
    // Defensive LRU cap on the STAB pool — never reached by the launch
    // bank (18 stabs). Drums are never evicted: every punch needs one.
    if (poolKey.startsWith('stab:')) {
      const stabKeys = [...this.oneShots.keys()].filter((k) => k.startsWith('stab:'))
      for (let i = 0; stabKeys.length - i >= MAX_STAB_PLAYERS; i += 1) {
        this.releaseSlot(stabKeys[i]!)
      }
    }
    try {
      const player = this.makePlayer(clip.module)
      const slot: PooledOneShot = { player, clip, armed: true, gen: 0, rearmHandle: null }
      this.oneShots.set(poolKey, slot)
      return slot
    } catch (err) {
      logger.warn('puncheokie.instrument.clipMissing', 'one-shot did not load', {
        key: safe(poolKey),
        texture: safe(this.texture),
        error: safe(String(err)),
      })
      return undefined
    }
  }

  /**
   * Play one one-shot at `gain`. An armed player plays instantly; a
   * retrigger pauses first, rewinds, and plays when the seek lands (or
   * when the stalled-seek fallback fires — degraded, never silent). Either
   * path schedules a generation-guarded re-arm after the clip's tail.
   */
  private fireOneShot(poolKey: string, clip: InstrumentBankClip | undefined, gain: number): void {
    const slot = this.pooledFor(poolKey, clip)
    if (slot === undefined) return
    slot.gen += 1
    const gen = slot.gen
    if (slot.rearmHandle !== null) {
      this.cancelScheduled(slot.rearmHandle)
      slot.rearmHandle = null
    }
    const player = slot.player
    const scheduleRearm = (): void => {
      slot.rearmHandle = this.schedule(() => {
        slot.rearmHandle = null
        if (slot.gen !== gen) return
        // Pause FIRST, then seek — a player parked "playing" at
        // end-of-stream resumes on a lone seekTo(0) (the voice-storm
        // lesson). Pausing makes the rewind a silent reposition.
        try {
          player.pause()
        } catch {
          // Already stopped at EOS.
        }
        void Promise.resolve(player.seekTo(0))
          .catch(() => undefined)
          .then(() => {
            if (slot.gen === gen) slot.armed = true
          })
      }, slot.clip.durationMs + ONE_SHOT_REARM_PAD_MS)
    }
    try {
      player.volume = gain
      if (slot.armed) {
        slot.armed = false
        player.play()
        scheduleRearm()
        return
      }
      // Retrigger while (possibly) still sounding: `seekTo` is async, so
      // pause, rewind, and play on resolution — with a fallback that
      // plays anyway if the seek stalls (playClickScript's race,
      // simplified). Gen-guarded: a newer dispatch owns the player.
      try {
        player.pause()
      } catch {
        // Already stopped.
      }
      const dispatchedAt = this.clock()
      let played = false
      const playOnce = (path: string): void => {
        if (played) return
        played = true
        if (slot.gen !== gen) return
        try {
          player.play()
        } catch (err) {
          logger.warn('puncheokie.instrument.playFailed', 'one-shot did not play', {
            key: safe(poolKey),
            path: safe(path),
            error: safe(String(err)),
          })
          return
        }
        if (path === 'seek-stalled') {
          logger.warn('puncheokie.instrument.seekStalled', 'one-shot rewind stalled — played anyway', {
            key: safe(poolKey),
            waitedMs: safe(Math.round(this.clock() - dispatchedAt)),
          })
        }
        scheduleRearm()
      }
      const fallback = this.schedule(() => playOnce('seek-stalled'), STALLED_SEEK_FALLBACK_MS)
      void Promise.resolve(player.seekTo(0))
        .catch(() => undefined)
        .then(() => {
          this.cancelScheduled(fallback)
          playOnce('rewound')
        })
    } catch (err) {
      logger.warn('puncheokie.instrument.playFailed', 'one-shot did not play', {
        key: safe(poolKey),
        error: safe(String(err)),
      })
    }
  }

  /**
   * Replace one native loop. All level trims are baked into the wavs, so
   * the playlist always runs at volume 1. A `createAudioPlaylist` throw is
   * fatal for the session (MetronomePlayer verbatim).
   */
  private swapLoop(kind: 'bed' | 'bass', key: string, clip: InstrumentBankClip | undefined): void {
    if (clip === undefined) {
      logger.warn('puncheokie.instrument.clipMissing', 'no bank entry for loop', {
        kind: safe(kind),
        key: safe(key),
        texture: safe(this.texture),
      })
      return
    }
    const previous = kind === 'bed' ? this.bedPlaylist : this.bassPlaylist
    if (previous !== null) {
      try {
        previous.pause()
        previous.destroy()
      } catch {
        // Already gone.
      }
    }
    if (kind === 'bed') {
      this.bedPlaylist = null
    } else {
      this.bassPlaylist = null
    }
    try {
      const playlist = this.makePlaylist({
        sources: [clip.module],
        loop: 'single',
        updateInterval: 500,
      })
      playlist.volume = 1
      playlist.play()
      if (kind === 'bed') {
        this.bedPlaylist = playlist
        this.currentBedKey = key
      } else {
        this.bassPlaylist = playlist
        this.currentBassKey = key
      }
    } catch (err) {
      this.fail(`${kind} playlist creation failed`, err)
    }
  }

  /** Pause+destroy both playlists and clear the committed keys. */
  private destroyPlaylists(): void {
    for (const playlist of [this.bedPlaylist, this.bassPlaylist]) {
      if (playlist === null) continue
      try {
        playlist.pause()
        playlist.destroy()
      } catch {
        // Already gone.
      }
    }
    this.bedPlaylist = null
    this.bassPlaylist = null
    this.currentBedKey = null
    this.currentBassKey = null
  }

  /** Remove one pooled player and cancel its pending re-arm. */
  private releaseSlot(poolKey: string): void {
    const slot = this.oneShots.get(poolKey)
    if (!slot) return
    this.oneShots.delete(poolKey)
    if (slot.rearmHandle !== null) {
      this.cancelScheduled(slot.rearmHandle)
      slot.rearmHandle = null
    }
    // A now-orphaned seek callback must never re-arm a removed player.
    slot.gen += 1
    try {
      slot.player.remove()
    } catch {
      // Already gone.
    }
  }

  /** Remove every pooled player. */
  private releasePools(): void {
    for (const poolKey of [...this.oneShots.keys()]) {
      this.releaseSlot(poolKey)
    }
  }

  /**
   * Permanent no-instrument mode: tear everything down, warn ONCE, no-op
   * forever after. Never throws to the caller; never blocks the jam.
   */
  private fail(reason: string, error: unknown): void {
    this.availableFlag = false
    this.destroyPlaylists()
    this.releasePools()
    logger.warn('puncheokie.instrument.unavailable', reason, {
      texture: safe(this.texture),
      ...(error === undefined ? {} : { error: safe(String(error)) }),
    })
  }
}

/** Pool-map keys — stabs and drums share one LRU map, prefixed apart. */
function stabPoolKey(stabKey: string): string {
  return `stab:${stabKey}`
}

function drumPoolKey(drumKey: string): string {
  return `drum:${drumKey}`
}
