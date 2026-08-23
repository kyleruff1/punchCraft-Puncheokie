/**
 * CaptureSink — the seam that lets the decode path persist raw frames without
 * knowing that SQLite exists.
 *
 * PunchStream depends on THIS interface, never on a repository, so
 * `src/protocol/**` stays pure TypeScript (§15.1). The real implementation
 * (`BleCaptureService`) lives in this package and owns the batching and the
 * database handle.
 *
 * The contract that matters: `capture()` is SYNCHRONOUS and must not throw.
 * It is called immediately before `adapter.decodeFrame`, so anything slow or
 * failure-prone inside it would either stall the notification callback or —
 * far worse — let a persistence error abort the decode path and lose the
 * payload. Implementations buffer in memory and flush out-of-band.
 */

import type { RawBleFrame } from '@ble/bleTypes'

export interface CaptureSink {
  /**
   * Record a raw frame. Called BEFORE any decoder touches the bytes
   * (CLAUDE.md §1, spec §11.9 / §12.4).
   *
   * Must never throw: a storage problem is reported through
   * `pendingCount` / the service's own logging, never by breaking the
   * caller's decode loop.
   */
  capture(frame: RawBleFrame): void

  /** Frames buffered but not yet written. Drives the backlog indicator (M06). */
  pendingCount(): number
}

/**
 * No-op sink used when no capture is open. Keeps call sites free of null
 * checks; frames handed to it are genuinely discarded, which is why the app
 * should open a real capture before streaming.
 */
export const NULL_CAPTURE_SINK: CaptureSink = {
  capture: () => {},
  pendingCount: () => 0,
}
