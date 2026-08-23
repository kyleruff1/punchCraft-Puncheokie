/**
 * BleCaptureService — capture lifecycle invariants.
 *
 * These exist because on-device testing caught two real defects that the
 * FrameBuffer tests could not see:
 *
 *  1. A React effect cleanup calls stop() WITHOUT awaiting it, then the
 *     replacement effect calls start() synchronously. The late stop used to
 *     null the new capture's id, after which every frame was dropped.
 *  2. capture() refused to store a frame with no capture open, while
 *     recordEvent() happily stored the derived event anyway — leaving 19
 *     punch_events rows whose source frames did not exist. That inverts the
 *     raw-before-parsed rule.
 */

import type { RawBleFrame } from '@ble/bleTypes'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import { BleCaptureService } from '../BleCaptureService'
import type { FrameInsertInput } from '@storage/repositories/CaptureRepository'
import type { PunchEventInsertInput } from '@storage/repositories/PunchEventRepository'

class FakeCaptures {
  opened: string[] = []
  closed: string[] = []
  frames: FrameInsertInput[] = []
  private n = 0
  open(): string {
    const id = `cap_${++this.n}`
    this.opened.push(id)
    return id
  }
  close(id: string): void {
    this.closed.push(id)
  }
  insertFrames(batch: readonly FrameInsertInput[]): number {
    this.frames.push(...batch)
    return batch.length
  }
  countFrames(): number {
    return this.frames.length
  }
  listRecent(): [] {
    return []
  }
}

class FakePunchEvents {
  rows: PunchEventInsertInput[] = []
  insertMany(batch: readonly PunchEventInsertInput[]) {
    this.rows.push(...batch)
    return { submitted: batch.length, inserted: batch.length, duplicates: 0 }
  }
  countForCapture(): number {
    return this.rows.length
  }
}

const frame = (id: string): RawBleFrame => ({
  id,
  captureId: 'ignored',
  deviceId: 'EA:69:2D:9C:FD:53',
  handAtCapture: 'right',
  monotonicTimeMs: 1,
  wallTimeIso: '2026-08-23T05:00:00.000Z',
  direction: 'notification',
  serviceUuid: 'svc',
  characteristicUuid: 'ca281069',
  valueBase64: 'AQ==',
  valueHex: '01',
  connectionGeneration: 1,
})

const event = (id: string): TrackerPunchEvent => ({
  id,
  sourceFrameId: `${id}-src`,
  deviceId: 'EA:69:2D:9C:FD:53',
  hand: 'right',
  receivedMonotonicTimeMs: 1,
  receivedWallTimeIso: '2026-08-23T05:00:00.000Z',
  velocityUnit: 'tracker-unit',
  recovered: false,
  decoderId: 'fightcamp-v1',
  decoderVersion: '1.0.0',
  qualityFlags: [],
})

/**
 * start() installs a flush interval that only stop() clears, so any test
 * leaving a service running would keep Jest's event loop alive and hang the
 * run. Every built service is registered here and torn down in afterEach.
 */
const built: BleCaptureService[] = []

function build() {
  const captures = new FakeCaptures()
  const punchEvents = new FakePunchEvents()
  const service = new BleCaptureService({
    captures: captures as never,
    punchEvents: punchEvents as never,
  })
  built.push(service)
  return { service, captures, punchEvents }
}

describe('BleCaptureService lifecycle', () => {
  afterEach(async () => {
    while (built.length) await built.pop()!.stop()
  })

  it('buffers frames against the open capture', async () => {
    const { service, captures } = build()
    service.start()
    service.capture(frame('f1'))
    await service.stop()

    expect(captures.frames).toHaveLength(1)
    expect(captures.frames[0]!.captureId).toBe('cap_1')
    expect(captures.frames[0]!.deviceAddress).toBe('EA:69:2D:9C:FD:53')
  })

  it('does NOT store a decoded event when no capture is open', () => {
    const { service, punchEvents } = build()
    // No start() — the raw frame would be discarded, so its event must be too.
    service.recordEvent(event('e1'))
    expect(punchEvents.rows).toHaveLength(0)
  })

  it('keeps raw frames and decoded events symmetric — neither survives alone', async () => {
    const { service, captures, punchEvents } = build()

    service.capture(frame('before')) // dropped, no capture
    service.recordEvent(event('before')) // must ALSO be dropped

    service.start()
    service.capture(frame('during'))
    service.recordEvent(event('during'))
    await service.stop()

    expect(captures.frames.map((f) => f.id)).toEqual(['during'])
    expect(punchEvents.rows.map((r) => r.id)).toEqual(['during'])
  })

  it('a late stop() does not tear down a capture that started while it drained', async () => {
    const { service, captures } = build()

    service.start() // cap_1
    const pendingStop = service.stop() // released synchronously, drain begins

    // The replacement effect starts a new capture before the stop settles.
    // This is the exact on-device sequence that dropped 19 frames: React
    // fires the cleanup without awaiting it, then re-runs the effect.
    const second = service.start()
    expect(second).toBe('cap_2') // a genuinely new capture, not the old id

    await pendingStop

    // The capture that started mid-drain must still be live and usable.
    expect(service.currentCaptureId()).toBe('cap_2')
    service.capture(frame('after-race'))
    await service.stop()

    expect(captures.frames.map((f) => f.id)).toEqual(['after-race'])
    expect(captures.frames[0]!.captureId).toBe('cap_2')
    expect(captures.closed).toEqual(['cap_1', 'cap_2'])
    expect(service.currentCaptureId()).toBeNull()
  })

  it('start() is re-entrant — one screen visit is one capture', () => {
    const { service, captures } = build()
    const a = service.start()
    const b = service.start()
    expect(a).toBe(b)
    expect(captures.opened).toEqual(['cap_1'])
  })

  it('stop() flushes buffered frames rather than discarding them', async () => {
    const { service, captures } = build()
    service.start()
    // Well under the batch size, so only the drain in stop() can write these.
    for (let i = 0; i < 3; i++) service.capture(frame(`f${i}`))
    expect(captures.frames).toHaveLength(0)

    await service.stop()
    expect(captures.frames.map((f) => f.id)).toEqual(['f0', 'f1', 'f2'])
    expect(captures.closed).toEqual(['cap_1'])
  })

  it('capture() never throws even when the buffer path fails', () => {
    const { service } = build()
    service.start()
    const broken = { ...frame('bad') }
    Object.defineProperty(broken, 'characteristicUuid', {
      get() {
        throw new Error('exploding frame')
      },
    })
    expect(() => service.capture(broken as RawBleFrame)).not.toThrow()
  })
})
