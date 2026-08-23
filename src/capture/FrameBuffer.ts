/**
 * FrameBuffer — the pure batching core behind BleCaptureService.
 *
 * Split out from the service so the tricky part (when to flush, what happens
 * when the writer is slower than the stream, what happens when a flush fails)
 * is unit-testable on Windows with no SQLite and no Bluetooth (§21).
 *
 * Policy:
 *   - `add()` is synchronous, never throws, and never blocks the caller.
 *   - A flush is triggered when the buffer reaches `batchSize`, or when
 *     `tick()` observes that `maxLatencyMs` has passed since the oldest
 *     un-flushed item arrived. The latency bound matters because a slow
 *     trickle of punches must still reach disk promptly.
 *   - Only one flush is in flight at a time. Items added during a flush queue
 *     up for the next one.
 *   - A failed flush puts its items BACK at the front of the buffer and
 *     retries on the next trigger. Frames are never dropped for a transient
 *     write error — that is the persist-before-parse guarantee (CLAUDE.md §1).
 *   - If the backlog exceeds `maxBuffered`, the OLDEST items are dropped and
 *     counted in `droppedCount`. This is the last-resort valve so a wedged
 *     writer cannot exhaust memory; it is surfaced loudly rather than hidden.
 */

export interface FrameBufferOptions<T> {
  /** Flush once this many items are buffered. */
  batchSize: number
  /** Flush if the oldest buffered item is older than this. */
  maxLatencyMs: number
  /** Hard cap on buffered items before the oldest are dropped. */
  maxBuffered: number
  /** Performs the write. Rejecting means "retry these". */
  flush: (items: T[]) => Promise<void>
  /** Injected clock so tests need no timers. Defaults to Date.now. */
  now?: () => number
  /** Called when the cap forces a drop, so the UI can shout about it. */
  onDrop?: (droppedCount: number, totalDropped: number) => void
  /** Called when a flush attempt fails and its items are requeued. */
  onFlushError?: (error: unknown, requeued: number) => void
}

export class FrameBuffer<T> {
  private buffer: T[] = []
  private oldestAtMs: number | null = null
  private flushing = false
  private dropped = 0
  private readonly now: () => number

  constructor(private readonly opts: FrameBufferOptions<T>) {
    this.now = opts.now ?? (() => Date.now())
  }

  /** Buffer an item. Synchronous, non-throwing. */
  add(item: T): void {
    this.buffer.push(item)
    if (this.oldestAtMs == null) this.oldestAtMs = this.now()

    if (this.buffer.length > this.opts.maxBuffered) {
      const overflow = this.buffer.length - this.opts.maxBuffered
      this.buffer.splice(0, overflow)
      this.dropped += overflow
      this.opts.onDrop?.(overflow, this.dropped)
    }

    if (this.buffer.length >= this.opts.batchSize) void this.flushNow()
  }

  /**
   * Give the buffer a chance to flush on latency grounds. Safe to call on a
   * timer; does nothing when there is nothing old enough to send.
   */
  tick(): void {
    if (this.buffer.length === 0) return
    const oldest = this.oldestAtMs
    if (oldest != null && this.now() - oldest >= this.opts.maxLatencyMs) void this.flushNow()
  }

  /**
   * Flush everything buffered. Resolves once the in-flight write settles.
   * Concurrent callers are coalesced — a flush already running wins and this
   * returns without starting a second one.
   */
  async flushNow(): Promise<void> {
    if (this.flushing) return
    if (this.buffer.length === 0) return

    this.flushing = true
    const batch = this.buffer
    this.buffer = []
    this.oldestAtMs = null

    try {
      await this.opts.flush(batch)
    } catch (err) {
      // Put them back at the FRONT so ordering survives a retry.
      this.buffer = [...batch, ...this.buffer]
      if (this.oldestAtMs == null) this.oldestAtMs = this.now()
      this.opts.onFlushError?.(err, batch.length)
    } finally {
      this.flushing = false
    }
  }

  /** Drain repeatedly until empty or no further progress is made. */
  async drain(maxAttempts = 5): Promise<void> {
    for (let i = 0; i < maxAttempts && this.buffer.length > 0; i++) {
      const before = this.buffer.length
      await this.flushNow()
      if (this.buffer.length >= before) break // not making progress; stop retrying
    }
  }

  /** Items buffered but not yet written. */
  pendingCount(): number {
    return this.buffer.length
  }

  /** Items lost to the overflow valve since construction. */
  droppedCount(): number {
    return this.dropped
  }
}
