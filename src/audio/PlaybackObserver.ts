/**
 * PlaybackObserver — silent, event-driven timing of expo-audio playback
 * (GH #291, plan C1).
 *
 * The unattended timing suite runs with the tablet at volume 0 and no
 * microphone. What it can still observe is WHEN each coach clip actually
 * started and ended, on the same `performance.now()` clock that stamps
 * `cue.tokenDue` and every `voice.play` dispatchMs — so a ring's lateness
 * against a word, a bell's onset against its boundary, and a whisper's
 * truncation are all one subtraction away with no anchoring.
 *
 * Why events and not a playhead poll: reading `player.currentTime` is a
 * `runOnMain` = `runBlocking` hop to the main looper (expo-audio's
 * AudioModule.kt). A 1 ms poll across several players is exactly the
 * perturbation this must not cause. media3 flips `isPlaying` in the same
 * internal pass that starts the renderers, and expo-audio pushes that as a
 * `playbackStatusUpdate {playing: true}` asynchronously — that IS the
 * "playhead started" signal, delivered without blocking. Periodic statuses
 * (every `updateInterval` ms, only while playing) feed a stall check.
 * Polling exists only as a fallback for a player with no `addListener`.
 *
 * Contract with the owner (`VoiceOutputExpo`): `watch()` right after
 * `play()`, `forget()` before every `releaseAudioPlayer`, `release()` on
 * teardown. The observer never creates players, never calls into a player
 * it has been told to forget, and holds one listener and one timer at a
 * time — flag off, it is never constructed at all.
 */

export type ObservedKind =
  | 'clip'
  | 'instruction'
  | 'combo-announce'
  | 'click-script'
  | 'intro'
  | 'round-warning'
  | 'recovery'
  | 'metronome'

export type ObservedOutcome = 'ok' | 'timeout' | 'superseded' | 'released' | 'evicted' | 'stalled'

/** The subset of expo-audio's AudioStatus / AudioPlaylistStatus this reads. Every field optional. */
export interface StatusLike {
  currentTime?: number
  playing?: boolean
  didJustFinish?: boolean
  isLoaded?: boolean
  duration?: number
  currentIndex?: number
}

type Subscription = { remove?: () => void } | (() => void) | undefined | void

/**
 * Structural: expo-audio's AudioPlayer and AudioPlaylist both satisfy this.
 * `addListener` is declared as a METHOD on purpose — a property signature is
 * checked contravariantly under strictFunctionTypes and rejects expo-audio's
 * generic, `keyof AudioEvents`-keyed declaration; a method is bivariant.
 */
export interface ObservablePlayer {
  currentTime?: number
  playing?: boolean
  volume?: number
  addListener?(event: string, cb: (status: StatusLike) => void): Subscription
}

export interface WatchMeta {
  playId: string
  kind: ObservedKind
  /** asset id, clip text, slot or script id — whatever names the sound in the log. */
  label: string
  expectedDurationMs?: number
  /** `clock()` taken immediately before `play()`. */
  dispatchMs: number
  volumeAtDispatch: number
  positionAtDispatchMs?: number
  path?: string
  traceId?: string
}

export interface ObservedRecord extends WatchMeta {
  method: 'status' | 'poll'
  onsetMs: number | null
  endMs: number | null
  observedDurationMs: number | null
  onsetLatencyMs: number | null
  positionAtOnsetMs: number | null
  silentByVolume: boolean
  outcome: ObservedOutcome
}

export interface PlaybackObserverOptions {
  clock: () => number
  schedule: (fn: () => void, delayMs: number) => unknown
  cancelScheduled: (handle: unknown) => void
  /** Sink for the closed observation. Defaults to a no-op so tests can pass their own. */
  onObserved?: (record: ObservedRecord) => void
  /** No `playing:true` within this after dispatch → `timeout`. Default 4000 (dev-client downloads). */
  onsetTimeoutMs?: number
  /** Grace beyond `expectedDurationMs` before an open entry is `timeout`. Default 2000. */
  endGraceMs?: number
  /** Poll period when a player exposes no `addListener`. Default 25. */
  pollIntervalMs?: number
  /** Which event carries status on this player kind. Default `playbackStatusUpdate`. */
  statusEvent?: string
}

interface Entry {
  meta: WatchMeta
  method: 'status' | 'poll'
  onsetMs: number | null
  positionAtOnsetMs: number | null
  /** The last position seen in a periodic status, and when it was FIRST seen. */
  lastPosition: number | null
  lastPositionSinceMs: number | null
  closed: boolean
}

interface PlayerState {
  subscription: Subscription
  entry: Entry | null
  /** Non-null only on the poll fallback. */
  pollHandle: unknown
  lastPolledPosition: number | null
}

/**
 * How long a position may sit unchanged, while the player still reports
 * `playing`, before the play is called stalled.
 *
 * Measured on the tablet (release build, 2026-09-07): a count of consecutive
 * identical positions is NOT a stall signal. At the observed 40 ms cadence
 * media3 reports the same `currentTime` several times in a row while it
 * spins up — so a 3-sample rule closed the walkout 101 ms into a 25 s
 * playlist and 51 of 68 click-script plays early, and every duration built
 * on those observations was fiction. A stall has to be measured in TIME, and
 * the window has to be longer than any legitimate reporting gap.
 */
const STALL_WINDOW_MS = 1_500
const ONSET_POSITION_EPSILON_S = 0.01

/**
 * Status cadence for an observed playlist (the ceremony players): onset and
 * end are transition events, so this only feeds the stall check. The
 * unobserved default stays 500.
 */
export const OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS = 40

function removeSubscription(sub: Subscription): void {
  if (typeof sub === 'function') {
    try {
      sub()
    } catch {
      // Already gone.
    }
    return
  }
  if (sub && typeof sub === 'object' && typeof sub.remove === 'function') {
    try {
      sub.remove()
    } catch {
      // Already gone.
    }
  }
}

export class PlaybackObserver {
  private readonly clock: () => number
  private readonly schedule: (fn: () => void, delayMs: number) => unknown
  private readonly cancelScheduled: (handle: unknown) => void
  private readonly onObserved: (record: ObservedRecord) => void
  private readonly onsetTimeoutMs: number
  private readonly endGraceMs: number
  private readonly pollIntervalMs: number
  private readonly statusEvent: string

  private readonly players = new Map<ObservablePlayer, PlayerState>()
  /** The one deadline timer, re-armed to the earliest pending deadline. */
  private deadlineHandle: unknown = null
  private deadlineAtMs: number | null = null

  private watched = 0
  private minted = 0
  private maxHandlerMs = 0

  constructor(opts: PlaybackObserverOptions) {
    this.clock = opts.clock
    this.schedule = opts.schedule
    this.cancelScheduled = opts.cancelScheduled
    this.onObserved = opts.onObserved ?? (() => undefined)
    this.onsetTimeoutMs = opts.onsetTimeoutMs ?? 4_000
    this.endGraceMs = opts.endGraceMs ?? 2_000
    this.pollIntervalMs = opts.pollIntervalMs ?? 25
    this.statusEvent = opts.statusEvent ?? 'playbackStatusUpdate'
  }

  /**
   * Begin observing one play on `player`. A second watch on an open entry
   * supersedes it. `statusEvent` names the event this player kind emits —
   * `playbackStatusUpdate` for an AudioPlayer (the default),
   * `playlistStatusUpdate` for an AudioPlaylist; it is fixed at the first
   * watch, when the listener is attached.
   */
  watch(player: ObservablePlayer, meta: WatchMeta, opts: { statusEvent?: string } = {}): void {
    this.watched += 1
    let state = this.players.get(player)
    if (state === undefined) {
      state = { subscription: undefined, entry: null, pollHandle: null, lastPolledPosition: null }
      this.players.set(player, state)
      this.attach(player, state, opts.statusEvent ?? this.statusEvent)
    } else if (state.entry !== null && !state.entry.closed) {
      // The pooled re-trigger case — "1, 1" on the same player — is data,
      // not an error: the first play was cut short by the second.
      this.close(state.entry, 'superseded')
    }
    state.entry = {
      meta,
      method: state.subscription !== undefined ? 'status' : 'poll',
      onsetMs: null,
      positionAtOnsetMs: null,
      lastPosition: null,
      lastPositionSinceMs: null,
      closed: false,
    }
    this.rearm()
  }

  /** Called from EVERY release/evict site BEFORE the native release. */
  forget(player: ObservablePlayer, reason: 'released' | 'evicted' = 'released'): void {
    const state = this.players.get(player)
    if (state === undefined) return
    if (state.entry !== null && !state.entry.closed) this.close(state.entry, reason)
    this.detach(state)
    this.players.delete(player)
    this.rearm()
  }

  /** Close everything as released, drop every listener and the timer. */
  release(): void {
    for (const [player] of [...this.players]) this.forget(player, 'released')
    if (this.deadlineHandle !== null) {
      this.cancelScheduled(this.deadlineHandle)
      this.deadlineHandle = null
      this.deadlineAtMs = null
    }
  }

  /** The observer's clock — owners stamp `dispatchMs` here so every field shares one domain. */
  nowMs(): number {
    return this.clock()
  }

  /** A playId for an owner without its own minting (the ceremony players). */
  mintPlayId(prefix: string): string {
    this.minted += 1
    return `${prefix}-${this.minted}`
  }

  stats(): { watched: number; open: number; listeners: number; maxHandlerMs: number } {
    let open = 0
    let listeners = 0
    for (const state of this.players.values()) {
      if (state.entry !== null && !state.entry.closed) open += 1
      if (state.subscription !== undefined) listeners += 1
    }
    return { watched: this.watched, open, listeners, maxHandlerMs: this.maxHandlerMs }
  }

  // --------------------------------------------------------------- internals

  private attach(player: ObservablePlayer, state: PlayerState, statusEvent: string): void {
    if (typeof player.addListener === 'function') {
      try {
        state.subscription = player.addListener(statusEvent, (status) => {
          this.onStatus(state, status)
        })
        if (state.subscription !== undefined) return
      } catch {
        // Fall through to polling.
      }
    }
    // Poll fallback — only for a player with no event surface. Reads are
    // blocking hops on the native platform; the period stays coarse.
    const poll = (): void => {
      state.pollHandle = null
      const entry = state.entry
      if (entry === null || entry.closed) return
      const position = typeof player.currentTime === 'number' ? player.currentTime : undefined
      const playing =
        typeof player.playing === 'boolean'
          ? player.playing
          : position !== undefined &&
            state.lastPolledPosition !== null &&
            position > state.lastPolledPosition
      this.onStatus(state, { currentTime: position, playing })
      if (position !== undefined) state.lastPolledPosition = position
      if (state.entry !== null && !state.entry.closed) {
        state.pollHandle = this.schedule(poll, this.pollIntervalMs)
      }
    }
    state.pollHandle = this.schedule(poll, this.pollIntervalMs)
  }

  private detach(state: PlayerState): void {
    removeSubscription(state.subscription)
    state.subscription = undefined
    if (state.pollHandle !== null) {
      this.cancelScheduled(state.pollHandle)
      state.pollHandle = null
    }
  }

  private onStatus(state: PlayerState, status: StatusLike): void {
    const started = this.clock()
    const entry = state.entry
    if (entry === null || entry.closed) return
    const now = started
    const position = status.currentTime

    if (entry.onsetMs === null) {
      const advanced =
        typeof position === 'number' &&
        typeof entry.meta.positionAtDispatchMs === 'number' &&
        position > entry.meta.positionAtDispatchMs / 1000 + ONSET_POSITION_EPSILON_S
      if (status.playing === true || advanced) {
        entry.onsetMs = now
        entry.positionAtOnsetMs = typeof position === 'number' ? Math.round(position * 1000) : null
        this.rearm()
      }
    } else {
      if (status.didJustFinish === true || status.playing === false) {
        this.close(entry, 'ok', now)
      } else if (typeof position === 'number') {
        // A playlist's `currentTime` is per-TRACK, so it legitimately steps
        // backwards at every track change; treat any change as progress.
        if (entry.lastPosition === null || position !== entry.lastPosition) {
          entry.lastPosition = position
          entry.lastPositionSinceMs = now
        } else if (entry.lastPositionSinceMs !== null && now - entry.lastPositionSinceMs >= STALL_WINDOW_MS) {
          this.close(entry, 'stalled', now)
        }
      }
    }
    const took = this.clock() - started
    if (took > this.maxHandlerMs) this.maxHandlerMs = took
  }

  private close(entry: Entry, outcome: ObservedOutcome, atMs: number = this.clock()): void {
    if (entry.closed) return
    entry.closed = true
    const endMs = outcome === 'ok' || outcome === 'stalled' ? atMs : entry.onsetMs !== null ? atMs : null
    const record: ObservedRecord = {
      ...entry.meta,
      method: entry.method,
      onsetMs: entry.onsetMs,
      endMs,
      observedDurationMs: entry.onsetMs !== null && endMs !== null ? Math.round(endMs - entry.onsetMs) : null,
      onsetLatencyMs: entry.onsetMs !== null ? Math.round(entry.onsetMs - entry.meta.dispatchMs) : null,
      positionAtOnsetMs: entry.positionAtOnsetMs,
      silentByVolume: entry.meta.volumeAtDispatch === 0,
      outcome,
    }
    this.onObserved(record)
  }

  /** Re-arm the single deadline timer to the earliest open deadline. */
  private rearm(): void {
    let earliest: number | null = null
    for (const state of this.players.values()) {
      const entry = state.entry
      if (entry === null || entry.closed) continue
      const deadline =
        entry.onsetMs === null
          ? entry.meta.dispatchMs + this.onsetTimeoutMs
          : entry.onsetMs + (entry.meta.expectedDurationMs ?? 0) + this.endGraceMs
      if (earliest === null || deadline < earliest) earliest = deadline
    }
    if (earliest === this.deadlineAtMs) return
    if (this.deadlineHandle !== null) {
      this.cancelScheduled(this.deadlineHandle)
      this.deadlineHandle = null
    }
    this.deadlineAtMs = earliest
    if (earliest === null) return
    const delay = Math.max(0, earliest - this.clock())
    this.deadlineHandle = this.schedule(() => {
      this.deadlineHandle = null
      this.deadlineAtMs = null
      this.sweep()
    }, delay)
  }

  private sweep(): void {
    const now = this.clock()
    for (const state of this.players.values()) {
      const entry = state.entry
      if (entry === null || entry.closed) continue
      const deadline =
        entry.onsetMs === null
          ? entry.meta.dispatchMs + this.onsetTimeoutMs
          : entry.onsetMs + (entry.meta.expectedDurationMs ?? 0) + this.endGraceMs
      if (now >= deadline) this.close(entry, 'timeout', now)
    }
    this.rearm()
  }
}
