/**
 * TrackerPunchEventSource (M33-01).
 *
 * Runs on Windows with no Bluetooth hardware and no BLE library loaded:
 * `startPunchStream` is injected, and the facade is a hand-written fake
 * whose only real job is to hand back connection-change callbacks. That is
 * the whole point of the seam — everything below `PunchStream` is already
 * covered by the decoder and fixture suites.
 *
 * What is asserted here is the contract, not the plumbing: the port's
 * lifecycle semantics, the slot→hand guarantee (H11), the capability the
 * source is allowed to claim (D12), and the fact that this class issues no
 * GATT operation of its own (CLAUDE.md §4).
 */
import type { BleManagerFacade } from '@ble/BleManagerFacade'
import type { ConnectionStatus } from '@ble/bleTypes'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import { resolveCapabilityTier } from '@domain/workout/capabilityTier'
import { replaceSinks } from '@diagnostics/logger'
import type { PunchStreamController, PunchStreamOptions } from '@protocol/PunchStream'
import type { TrackerProtocolAdapter } from '@protocol/TrackerProtocolAdapter'
import {
  FIGHTCAMP_V1_SOURCE_CAPABILITY,
  TrackerPunchEventSource,
  type StartPunchStreamFn,
} from '@protocol/TrackerPunchEventSource'

const LEFT_DEVICE = 'D7:34:B4:27:D5:84'
const RIGHT_DEVICE = 'EA:69:2D:9C:FD:53'

/** Silence the console sink; these suites assert behaviour, not logging. */
beforeAll(() => {
  replaceSinks([])
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface FakeStream {
  options: PunchStreamOptions
  controller: PunchStreamController & { stop: jest.Mock }
  /** Deliver a decoded event as PunchStream would. */
  emit(patch?: Partial<TrackerPunchEvent>): TrackerPunchEvent
  /** Resolve the pending `startPunchStream` promise (manual mode only). */
  release(): void
}

interface Harness {
  facade: BleManagerFacade
  adapter: TrackerProtocolAdapter
  startStream: StartPunchStreamFn
  streams: FakeStream[]
  /** Push a connection-state change for a device, as the facade would. */
  setConnection(deviceId: string, state: ConnectionStatus['state']): void
  connectionWatchers(deviceId: string): number
  writeCalls(): number
}

let eventSeq = 0

/**
 * A decoded event shaped like FightCamp v1's: hand from the slot, a tracker
 * timestamp, and a tracker-reported velocity in tracker units. `punchType`
 * is 'unknown' because the type byte carries no portable meaning (H12).
 */
function fightcampEvent(hand: 'left' | 'right', patch: Partial<TrackerPunchEvent> = {}): TrackerPunchEvent {
  const n = eventSeq++
  return {
    id: `frame-${n}-r0`,
    sourceFrameId: `frame-${n}`,
    deviceId: hand === 'left' ? LEFT_DEVICE : RIGHT_DEVICE,
    hand,
    trackerTimestampMs: 1_000 + n,
    receivedMonotonicTimeMs: 5_000 + n,
    receivedWallTimeIso: '2026-08-23T12:00:00.000Z',
    punchTypeRaw: 3,
    punchType: 'unknown',
    velocityRaw: 42,
    velocityUnit: 'tracker-unit',
    recovered: false,
    decoderId: 'fightcamp-v1',
    decoderVersion: '1.0.0',
    qualityFlags: [],
    ...patch,
  }
}

function createHarness(opts: { manual?: boolean } = {}): Harness {
  const streams: FakeStream[] = []
  const watchers = new Map<string, Set<(status: ConnectionStatus) => void>>()
  let writes = 0

  const startStream: StartPunchStreamFn = (options) => {
    const controller = {
      stop: jest.fn(async () => undefined),
      getState: () => ({
        subscribedCount: 1,
        subscribedChars: [],
        initErrors: [],
        deviceInfo: {},
      }),
    }
    let release = (): void => undefined
    const promise = opts.manual
      ? new Promise<PunchStreamController>((resolve) => {
          release = () => {
            resolve(controller)
          }
        })
      : Promise.resolve<PunchStreamController>(controller)

    streams.push({
      options,
      controller,
      emit: (patch) => {
        const event = fightcampEvent(options.hand, patch)
        options.onEvent(event)
        return event
      },
      release: () => {
        release()
      },
    })
    return promise
  }

  const facade = {
    onConnectionChange: (deviceId: string, cb: (status: ConnectionStatus) => void) => {
      const set = watchers.get(deviceId) ?? new Set()
      set.add(cb)
      watchers.set(deviceId, set)
      return () => {
        set.delete(cb)
      }
    },
    writeCharacteristic: () => {
      writes += 1
      return Promise.resolve({ success: true })
    },
  } as unknown as BleManagerFacade

  const adapter = {
    id: 'fightcamp-v1',
    version: '1.0.0',
  } as unknown as TrackerProtocolAdapter

  return {
    facade,
    adapter,
    startStream,
    streams,
    setConnection: (deviceId, state) => {
      const status: ConnectionStatus = {
        deviceId,
        state,
        generation: 1,
        lastChangeMonotonicMs: 0,
      }
      for (const cb of watchers.get(deviceId) ?? []) cb(status)
    },
    connectionWatchers: (deviceId) => watchers.get(deviceId)?.size ?? 0,
    writeCalls: () => writes,
  }
}

function bothSlots(h: Harness): TrackerPunchEventSource {
  return new TrackerPunchEventSource({
    facade: h.facade,
    adapter: h.adapter,
    slots: { left: { deviceId: LEFT_DEVICE }, right: { deviceId: RIGHT_DEVICE } },
    startStream: h.startStream,
  })
}

/** Let the injected `startPunchStream` promises settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

// ---------------------------------------------------------------------------

describe('capability honesty (D12, doc §3)', () => {
  it('declares hand, timestamp and velocity — and no technique', () => {
    expect(FIGHTCAMP_V1_SOURCE_CAPABILITY).toEqual({
      hand: true,
      timestamp: true,
      punchType: 'none',
      velocity: true,
    })
  })

  it('resolves to hand-timestamp, not hand-broad-type', () => {
    // #187 was written before H12 refuted the vendor type flag on hardware.
    // D12 supersedes it: there is no broad technique family to match on.
    const source = bothSlots(createHarness())
    expect(resolveCapabilityTier({ capability: source.capability })).toEqual({
      tier: 'hand-timestamp',
      velocityAvailable: true,
    })
  })

  it('resolves the same tier from observed traffic', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    source.start()
    await flush()

    h.streams[0]?.emit()
    h.streams[1]?.emit()

    expect(source.observedCapability()).toEqual({
      tier: 'hand-timestamp',
      velocityAvailable: true,
    })
  })

  it('claims nothing before the first punch arrives', () => {
    const source = bothSlots(createHarness())
    source.start()
    // An empty sample tells you nothing (spec §4.2).
    expect(source.observedCapability()).toEqual({
      tier: 'hand-only',
      velocityAvailable: false,
    })
  })

  it('identifies itself as the tracker source', () => {
    expect(bothSlots(createHarness()).id).toBe('tracker')
  })
})

describe('start()', () => {
  it('opens one stream per assigned slot, with the hand from the slot', () => {
    const h = createHarness()
    bothSlots(h).start()

    expect(h.streams).toHaveLength(2)
    expect(h.streams.map((s) => [s.options.hand, s.options.deviceId])).toEqual([
      ['left', LEFT_DEVICE],
      ['right', RIGHT_DEVICE],
    ])
  })

  it('streams only the slots that are assigned', () => {
    const h = createHarness()
    new TrackerPunchEventSource({
      facade: h.facade,
      adapter: h.adapter,
      slots: { right: { deviceId: RIGHT_DEVICE } },
      startStream: h.startStream,
    }).start()

    expect(h.streams).toHaveLength(1)
    expect(h.streams[0]?.options.hand).toBe('right')
  })

  it('is idempotent', () => {
    const h = createHarness()
    const source = bothSlots(h)
    source.start()
    source.start()
    source.start()
    expect(h.streams).toHaveLength(2)
  })
})

describe('hand comes from the slot, never the payload (H11)', () => {
  it('re-stamps an event whose decoded hand disagrees with its slot', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    const seen: TrackerPunchEvent[] = []
    source.subscribe((e) => seen.push(e))
    source.start()
    await flush()

    // A decoder that guessed from bytes would produce exactly this.
    h.streams[0]?.emit({ hand: 'right' })
    h.streams[1]?.emit({ hand: 'unknown' })

    expect(seen.map((e) => e.hand)).toEqual(['left', 'right'])
  })

  it('leaves everything else on the event untouched', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    const seen: TrackerPunchEvent[] = []
    source.subscribe((e) => seen.push(e))
    source.start()
    await flush()

    const emitted = h.streams[0]?.emit()
    expect(seen[0]).toEqual(emitted)
    // §4.3: tracker units pass through as they were decoded. Never rescaled,
    // never relabelled.
    expect(seen[0]?.velocityUnit).toBe('tracker-unit')
    expect(seen[0]?.velocityRaw).toBe(42)
  })
})

describe('subscribe()', () => {
  it('fans out to every listener and returns an unsubscribe', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    const a: TrackerPunchEvent[] = []
    const b: TrackerPunchEvent[] = []
    const offA = source.subscribe((e) => a.push(e))
    source.subscribe((e) => b.push(e))
    source.start()
    await flush()

    h.streams[0]?.emit()
    offA()
    h.streams[0]?.emit()

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
  })
})

describe('stop()', () => {
  it('stops every controller and ends delivery', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    const seen: TrackerPunchEvent[] = []
    source.subscribe((e) => seen.push(e))
    source.start()
    await flush()

    source.stop()

    for (const stream of h.streams) expect(stream.controller.stop).toHaveBeenCalled()
    h.streams[0]?.emit()
    expect(seen).toHaveLength(0)
  })

  it('tears down a stream that was still starting when stop() fired', async () => {
    const h = createHarness({ manual: true })
    const source = bothSlots(h)
    source.start()
    source.stop()

    // The init plan finishes after the screen has gone.
    for (const stream of h.streams) stream.release()
    await flush()

    for (const stream of h.streams) expect(stream.controller.stop).toHaveBeenCalled()
  })

  it('releases the connection watchers', () => {
    const h = createHarness()
    const source = bothSlots(h)
    source.start()
    expect(h.connectionWatchers(LEFT_DEVICE)).toBe(1)

    source.stop()
    expect(h.connectionWatchers(LEFT_DEVICE)).toBe(0)
  })

  it('is safe to call before start and twice in a row', () => {
    const source = bothSlots(createHarness())
    expect(() => {
      source.stop()
      source.start()
      source.stop()
      source.stop()
    }).not.toThrow()
  })

  it('can be restarted, and a stale stream from the old run is discarded', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    const seen: TrackerPunchEvent[] = []
    source.subscribe((e) => seen.push(e))

    source.start()
    await flush()
    const stale = h.streams[0]
    source.stop()

    source.start()
    await flush()
    stale?.emit()

    expect(seen).toHaveLength(0)
  })
})

describe('a glove that drops and comes back (spec §19.3, #110)', () => {
  it('drops the stream when the slot leaves ready', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    source.start()
    await flush()

    h.setConnection(LEFT_DEVICE, 'recovering')
    expect(h.streams[0]?.controller.stop).toHaveBeenCalled()
  })

  it('rebuilds the stream on reconnect without the session restarting', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    const seen: TrackerPunchEvent[] = []
    source.subscribe((e) => seen.push(e))
    source.start()
    await flush()

    h.setConnection(LEFT_DEVICE, 'recovering')
    h.setConnection(LEFT_DEVICE, 'ready')
    await flush()

    // Left re-armed; right was never touched.
    expect(h.streams).toHaveLength(3)
    expect(h.streams[2]?.options.hand).toBe('left')
    expect(h.streams[1]?.controller.stop).not.toHaveBeenCalled()

    // Counting resumes on the same source — no new subscription needed.
    h.streams[2]?.emit()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.hand).toBe('left')
  })

  it('does not re-arm a slot that is already streaming', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    source.start()
    await flush()

    h.setConnection(LEFT_DEVICE, 'ready')
    h.setConnection(LEFT_DEVICE, 'streaming')
    expect(h.streams).toHaveLength(2)
  })

  it('ignores connection changes after stop()', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    source.start()
    await flush()
    source.stop()

    h.setConnection(LEFT_DEVICE, 'ready')
    expect(h.streams).toHaveLength(2)
  })
})

describe('no GATT writes of its own (CLAUDE.md §4, spec §12.1)', () => {
  it('never touches the facade write path', async () => {
    const h = createHarness()
    const source = bothSlots(h)
    source.start()
    await flush()
    h.streams[0]?.emit()
    h.setConnection(LEFT_DEVICE, 'recovering')
    h.setConnection(LEFT_DEVICE, 'ready')
    await flush()
    source.stop()

    // Initialization writes belong to adapter.buildInitializationPlan, which
    // PunchStream executes. This class adds none.
    expect(h.writeCalls()).toBe(0)
  })
})
