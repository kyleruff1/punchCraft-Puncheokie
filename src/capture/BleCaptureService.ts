/**
 * BleCaptureService — opens a capture, buffers every raw frame, and flushes
 * batches to SQLite.
 *
 * This is the concrete `CaptureSink`. It sits between the transport and the
 * decoder: `capture()` is called before `adapter.decodeFrame` runs, so a frame
 * the decoder later rejects is already durable (CLAUDE.md §1, §11.9, §12.4).
 *
 * Device identity: `RawBleFrame.deviceId` is the BLE address the transport
 * reported, which is not `tracker_devices.id`. We resolve the address to a
 * surrogate key once per address via DeviceRepository and cache it, so the
 * `ble_frames.device_id` foreign key holds without a lookup per frame. If
 * resolution fails we still write the frame with a null `device_id` and the
 * address intact — losing the join is acceptable, losing the payload is not.
 */

import type { RawBleFrame } from '@ble/bleTypes'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import { logger, safe } from '@/diagnostics/logger'
import type { CaptureSink } from '@capture/CaptureSink'
import { FrameBuffer } from '@capture/FrameBuffer'
import type {
  CaptureRepository,
  FrameInsertInput,
  OpenCaptureInput,
} from '@storage/repositories/CaptureRepository'
import type { DeviceRepository } from '@storage/repositories/DeviceRepository'
import type {
  PunchEventInsertInput,
  PunchEventRepository,
} from '@storage/repositories/PunchEventRepository'

/** Flush when this many frames are buffered. */
const FRAME_BATCH_SIZE = 25
/** ...or when the oldest buffered frame is this old, whichever comes first. */
const FRAME_MAX_LATENCY_MS = 1_000
/** Last-resort cap. At ~10 frames/s this is well over a minute of backlog. */
const FRAME_MAX_BUFFERED = 2_000
/** How often the latency-based flush is evaluated. */
const TICK_INTERVAL_MS = 500

export interface BleCaptureServiceDeps {
  captures: CaptureRepository
  punchEvents: PunchEventRepository
  devices?: DeviceRepository | undefined
}

export class BleCaptureService implements CaptureSink {
  private captureId: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly deviceIdByAddress = new Map<string, string | null>()
  /** Frames handed to capture() with no capture open. Should always be 0. */
  private droppedNoCapture = 0

  private readonly frames: FrameBuffer<FrameInsertInput>
  private readonly events: FrameBuffer<PunchEventInsertInput>

  constructor(private readonly deps: BleCaptureServiceDeps) {
    this.frames = new FrameBuffer<FrameInsertInput>({
      batchSize: FRAME_BATCH_SIZE,
      maxLatencyMs: FRAME_MAX_LATENCY_MS,
      maxBuffered: FRAME_MAX_BUFFERED,
      flush: async (batch) => {
        this.deps.captures.insertFrames(batch)
      },
      onDrop: (n, total) => {
        logger.error('capture.frames.dropped', 'frame buffer overflow — frames lost', {
          dropped: safe(n),
          totalDropped: safe(total),
        })
      },
      onFlushError: (err, requeued) => {
        logger.warn('capture.frames.flush.retry', 'frame flush failed; will retry', {
          requeued: safe(requeued),
          error: safe(String(err)),
        })
      },
    })

    this.events = new FrameBuffer<PunchEventInsertInput>({
      batchSize: FRAME_BATCH_SIZE,
      maxLatencyMs: FRAME_MAX_LATENCY_MS,
      maxBuffered: FRAME_MAX_BUFFERED,
      flush: async (batch) => {
        this.deps.punchEvents.insertMany(batch)
      },
      onDrop: (n, total) => {
        logger.error('capture.events.dropped', 'punch buffer overflow — events lost', {
          dropped: safe(n),
          totalDropped: safe(total),
        })
      },
      onFlushError: (err, requeued) => {
        logger.warn('capture.events.flush.retry', 'punch flush failed; will retry', {
          requeued: safe(requeued),
          error: safe(String(err)),
        })
      },
    })
  }

  /** Id of the open capture, or null when none is running. */
  currentCaptureId(): string | null {
    return this.captureId
  }

  /**
   * Open a capture and start the flush timer. Returns the capture id.
   *
   * Re-entrant: if a capture is already open this returns the existing id
   * rather than orphaning it, which keeps a screen that re-runs its effect
   * from fragmenting one session into many captures.
   */
  start(input: OpenCaptureInput = {}): string {
    if (this.captureId) return this.captureId
    this.captureId = this.deps.captures.open(input)
    this.deviceIdByAddress.clear()
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.frames.tick()
        this.events.tick()
      }, TICK_INTERVAL_MS)
    }
    return this.captureId
  }

  /**
   * Flush everything still buffered, close the capture, and stop the timer.
   * Awaiting this before teardown is what keeps the tail of a session from
   * being lost when the user leaves the screen.
   *
   * The capture is released SYNCHRONOUSLY, before the async drain. That
   * ordering is the whole point: a React effect cleanup fires stop() without
   * awaiting it and the replacement effect calls start() immediately after.
   * If we held the id until after the drain, that start() would see a capture
   * still open, early-return, and then this call would null the id out from
   * under it — which is exactly how 19 punch events ended up on-device with
   * no stored source frames. Releasing first means the late start() opens a
   * fresh capture and nothing here can clobber it.
   *
   * Frames already buffered carry their own capture id, so a drain that spans
   * the handover still writes each row against the capture it belonged to.
   */
  async stop(): Promise<void> {
    const id = this.captureId
    this.captureId = null

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    await this.frames.drain()
    await this.events.drain()

    if (id) {
      try {
        this.deps.captures.close(id)
      } catch (err) {
        logger.warn('capture.close.failed', 'closing capture failed', {
          captureId: safe(id),
          error: safe(String(err)),
        })
      }
    }
  }

  // -- CaptureSink -----------------------------------------------------------

  /**
   * Buffer a raw frame. Synchronous and non-throwing by contract — the caller
   * is about to run the decoder and must not be disrupted by a storage issue.
   */
  capture(frame: RawBleFrame): void {
    const captureId = this.captureId
    if (!captureId) {
      // Never silent. A frame arriving with no capture open means the
      // lifecycle is wrong somewhere, and quietly discarding it is exactly
      // the failure this module exists to prevent (CLAUDE.md §1). Log the
      // first one loudly, then rate-limit so a stuck stream cannot flood.
      this.droppedNoCapture += 1
      if (this.droppedNoCapture === 1 || this.droppedNoCapture % 100 === 0) {
        logger.error('capture.frame.no_capture', 'frame discarded — no capture open', {
          totalDropped: safe(this.droppedNoCapture),
          characteristicUuid: safe(frame.characteristicUuid),
        })
      }
      return
    }
    try {
      this.frames.add({
        id: frame.id,
        captureId,
        deviceId: this.resolveDeviceId(frame.deviceId),
        deviceAddress: frame.deviceId,
        monotonicTimeMs: frame.monotonicTimeMs,
        wallTimeIso: frame.wallTimeIso,
        direction: frame.direction,
        serviceUuid: frame.serviceUuid,
        characteristicUuid: frame.characteristicUuid,
        valueBase64: frame.valueBase64,
        valueHex: frame.valueHex,
        connectionGeneration: frame.connectionGeneration,
      })
    } catch (err) {
      // Contract says never throw. Log and keep the decode path alive.
      logger.error('capture.frame.enqueue.failed', 'could not buffer frame', {
        error: safe(String(err)),
      })
    }
  }

  pendingCount(): number {
    return this.frames.pendingCount()
  }

  /** Frames lost to the overflow valve. Non-zero means a real problem. */
  droppedFrameCount(): number {
    return this.frames.droppedCount()
  }

  // -- Decoded events --------------------------------------------------------

  /**
   * Buffer a decoded punch event. Separate from `capture()` because raw frames
   * are non-negotiable while decoded events are derived — if the decoder
   * changes, these can be rebuilt from `ble_frames`.
   */
  recordEvent(event: TrackerPunchEvent): void {
    const captureId = this.captureId
    if (!captureId) {
      // Symmetry with capture(). Storing a decoded event whose source frame
      // was NOT stored inverts the raw-before-parsed rule: we would be
      // keeping the interpretation while discarding the evidence, and the
      // event could never be re-derived after a decoder change (§3.2, §8.6).
      // If the raw frame did not survive, neither does its event.
      logger.error('capture.event.no_capture', 'punch event discarded — no capture open', {
        sourceFrameId: safe(event.sourceFrameId),
      })
      return
    }
    try {
      this.events.add({
        id: event.id,
        sourceFrameId: event.sourceFrameId,
        captureId,
        deviceId: this.resolveDeviceId(event.deviceId),
        deviceAddress: event.deviceId,
        hand: event.hand,
        trackerTimestampMs: event.trackerTimestampMs,
        receivedMonotonicTimeMs: event.receivedMonotonicTimeMs,
        receivedWallTimeIso: event.receivedWallTimeIso,
        sequence: event.sequence,
        punchTypeRaw: event.punchTypeRaw,
        punchType: event.punchType,
        velocityRaw: event.velocityRaw,
        velocityCalibrated: event.velocityCalibrated,
        velocityUnit: event.velocityUnit,
        recovered: event.recovered,
        decoderId: event.decoderId,
        decoderVersion: event.decoderVersion,
        qualityFlags: event.qualityFlags,
      })
    } catch (err) {
      logger.error('capture.event.enqueue.failed', 'could not buffer punch event', {
        error: safe(String(err)),
      })
    }
  }

  pendingEventCount(): number {
    return this.events.pendingCount()
  }

  // -- internals -------------------------------------------------------------

  /**
   * Map a BLE address to `tracker_devices.id`, caching per address (including
   * failures, as null) so a hot notification path never repeats the lookup.
   */
  private resolveDeviceId(address: string): string | null {
    const cached = this.deviceIdByAddress.get(address)
    if (cached !== undefined) return cached

    let resolved: string | null = null
    const devices = this.deps.devices
    if (devices) {
      try {
        resolved = devices.upsertByAndroidId({ androidDeviceId: address }).id
      } catch (err) {
        logger.warn('capture.device.resolve.failed', 'could not resolve device row', {
          error: safe(String(err)),
        })
        resolved = null
      }
    }
    this.deviceIdByAddress.set(address, resolved)
    return resolved
  }
}
