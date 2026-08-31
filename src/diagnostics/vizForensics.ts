/**
 * Visual-forensics transition buffer (token-order investigation,
 * 2026-08-31).
 *
 * ## Why this exists
 *
 * Kyle's core defect is repeating / backtracking node-token lighting in
 * combos. Drive-8 measurement showed the mechanism is TIME, not ordering
 * logic: the runner's 50 ms interval blocks (a 2.87 s wall-clock freeze
 * with only 20 log lines in it), then `CueEngine.fireDueTokens` finds a
 * backlog and several cues advance inside ONE `engine.tick(...)`. The
 * rings replay history in milliseconds.
 *
 * Ordinary `logger.info` per transition cannot measure that: at the rate
 * the row changes, the logging IS the stall (M39-V2 principle #18 —
 * heavy diagnostics cause the timing problem being measured).
 *
 * So transitions accumulate in a bounded in-memory ring buffer with a
 * sub-ms monotonic stamp each, and flush as ONE batched log line on a
 * cadence. Cost per transition is an object push; cost per flush is one
 * log line carrying up to `FLUSH_BATCH` records.
 *
 * ## What it records
 *
 * - `token` — a ring's visual state changed. `source` names WHICH code
 *   path caused it, which is what discriminates the hypotheses (a
 *   per-render recompute looks nothing like a token-due dispatch).
 * - `avatar` — the stop-motion frame flipped.
 * - `clock` — the runner tick regressed or jumped beyond
 *   `CLOCK_ANOMALY_MS`. Cheap because it fires only on anomalies, and it
 *   is the direct signal for "the thread was blocked here".
 *
 * Pure TypeScript — no React, no Expo, no timers of its own. The caller
 * owns when to flush (the runner's tick), so this module can never
 * introduce a timer that perturbs the thing it measures.
 */

/** Which code path produced a token transition. */
export type VizTokenSource =
  | 'token-due'
  | 'cue-active'
  | 'matcher-credit'
  | 'sync-recompute'
  | 'cue-settled'

export interface VizTokenRecord {
  kind: 'token'
  cueId: string
  repeatIndex: number
  tokenIndex: number
  /** Ordinal among the cue's PUNCH tokens; -1 for movement tokens. */
  ordinal: number
  prev: string
  next: string
  source: VizTokenSource
  workElapsedMs: number
  monotonicMs: number
}

export interface VizAvatarRecord {
  kind: 'avatar'
  /** Punch art key — '1', '2b', … */
  frameKey: string
  step: string
  /** Strike occurrence the flip belongs to (`${cueId}:${tokenIndex}`). */
  occurrence: string
  monotonicMs: number
}

export interface VizClockRecord {
  kind: 'clock'
  /** Work-clock delta since the previous tick. */
  workDeltaMs: number
  /** Wall/monotonic delta since the previous tick — the stall measure. */
  wallDeltaMs: number
  workElapsedMs: number
  monotonicMs: number
}

export type VizRecord = VizTokenRecord | VizAvatarRecord | VizClockRecord

/**
 * A tick gap beyond this is an anomaly worth a record. The runner's
 * interval is 50 ms; 250 ms means at least four missed ticks, which is
 * already enough to burst a combo.
 */
export const CLOCK_ANOMALY_MS = 250

/** Records per flushed batch. Keeps one log line a reasonable size. */
export const FLUSH_BATCH = 64

/**
 * Hard cap on buffered records. If a consumer stops flushing (a freeze
 * exactly like the one under investigation), the buffer must not grow
 * without bound — it drops the OLDEST, because the records nearest the
 * recovery are the ones that explain the burst.
 */
export const MAX_BUFFERED = 512

/**
 * Minimum wall-clock spacing between emitted batches.
 *
 * The runner calls `flush()` on its 50 ms tick. Emitting there every
 * time means ~20 log lines/second, each carrying a serialized batch —
 * and that cost lands INSIDE the interval whose lateness we are trying
 * to measure. A first forensic drive wired that way reported 574 stalls
 * totalling 215.9 s in a 240 s round, which is self-inflicted: the
 * observer became the disturbance (M39-V2 principle #18).
 *
 * 500 ms keeps the buffer well inside MAX_BUFFERED at realistic
 * transition rates while cutting emit cost by 10x.
 */
export const FLUSH_INTERVAL_MS = 500

export interface VizForensicsOptions {
  /** Emit a batch. Wired to the structured logger by the caller. */
  emit: (batch: readonly VizRecord[]) => void
  /** Sub-ms monotonic source. Injectable so tests are deterministic. */
  now: () => number
  /** Master switch — dev builds / forensic drives only. */
  enabled: boolean
  /** Override the emit cadence. Defaults to `FLUSH_INTERVAL_MS`. */
  flushIntervalMs?: number
}

/**
 * Bounded, batched recorder. Not a singleton: the runner owns one
 * instance per armed workout so a new arm starts with a clean buffer.
 */
export class VizForensics {
  private readonly emit: VizForensicsOptions['emit']
  private readonly now: VizForensicsOptions['now']
  private readonly enabled: boolean
  private readonly flushIntervalMs: number
  private buffer: VizRecord[] = []
  private lastFlushMs: number | null = null
  private lastTickWorkMs: number | null = null
  private lastTickMonotonicMs: number | null = null
  /** Dropped because the buffer was full — surfaced so a gap is never silent. */
  private dropped = 0

  constructor(opts: VizForensicsOptions) {
    this.emit = opts.emit
    this.now = opts.now
    this.enabled = opts.enabled
    this.flushIntervalMs = opts.flushIntervalMs ?? FLUSH_INTERVAL_MS
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Buffered record count — test seam. */
  get pending(): number {
    return this.buffer.length
  }

  /** Records dropped to the cap since construction — test seam. */
  get droppedCount(): number {
    return this.dropped
  }

  private push(record: VizRecord): void {
    if (!this.enabled) return
    if (this.buffer.length >= MAX_BUFFERED) {
      this.buffer.shift()
      this.dropped += 1
    }
    this.buffer.push(record)
  }

  token(
    input: Omit<VizTokenRecord, 'kind' | 'monotonicMs'>,
  ): void {
    this.push({ ...input, kind: 'token', monotonicMs: this.now() })
  }

  avatar(input: Omit<VizAvatarRecord, 'kind' | 'monotonicMs'>): void {
    this.push({ ...input, kind: 'avatar', monotonicMs: this.now() })
  }

  /**
   * Called once per runner tick. Records an anomaly ONLY when the wall
   * clock jumped beyond `CLOCK_ANOMALY_MS` or the work clock went
   * backwards — so a healthy round costs one comparison per tick and
   * writes nothing.
   */
  tick(workElapsedMs: number): void {
    if (!this.enabled) return
    const monotonicMs = this.now()
    const prevWork = this.lastTickWorkMs
    const prevWall = this.lastTickMonotonicMs
    this.lastTickWorkMs = workElapsedMs
    this.lastTickMonotonicMs = monotonicMs
    if (prevWork === null || prevWall === null) return

    const workDeltaMs = workElapsedMs - prevWork
    const wallDeltaMs = monotonicMs - prevWall
    if (wallDeltaMs < CLOCK_ANOMALY_MS && workDeltaMs >= 0) return

    this.push({
      kind: 'clock',
      workDeltaMs,
      wallDeltaMs,
      workElapsedMs,
      monotonicMs,
    })
  }

  /**
   * Flush buffered records in batches.
   *
   * Safe to call every tick: it returns immediately when the buffer is
   * empty OR when less than `flushIntervalMs` has elapsed since the last
   * emit, so the steady-state cost is a length check and a subtraction.
   * Rate-limiting here (rather than at the call site) keeps the guarantee
   * with the thing being guarded.
   *
   * `force` bypasses the interval — used on teardown so a stall at the
   * very end of a round is not lost, and by tests.
   */
  flush(force = false): void {
    if (!this.enabled || this.buffer.length === 0) return
    const now = this.now()
    if (!force && this.lastFlushMs !== null && now - this.lastFlushMs < this.flushIntervalMs) {
      return
    }
    this.lastFlushMs = now
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, FLUSH_BATCH)
      this.emit(batch)
    }
  }

  /** Drop everything without emitting — used on teardown. */
  reset(): void {
    this.buffer = []
    this.lastFlushMs = null
    this.lastTickWorkMs = null
    this.lastTickMonotonicMs = null
    this.dropped = 0
  }
}
