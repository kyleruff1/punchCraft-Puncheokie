/**
 * autoConnectTrackers — scan-once, bind-both behaviour.
 *
 * The properties worth pinning: it never throws on a failed scan, it does not
 * disturb slots that are already live, it binds each address to its permanent
 * hand, and concurrent callers share one scan (two simultaneous scans wedge
 * the Android BLE stack — H04).
 */

import { autoConnectKnownTrackers } from '../autoConnectTrackers'
import { KNOWN_TRACKERS } from '../knownTrackers'

const blue = KNOWN_TRACKERS.find((t) => t.hand === 'left')!
const red = KNOWN_TRACKERS.find((t) => t.hand === 'right')!

// `jest.mock` factories are hoisted above these declarations, so Jest only
// permits references whose names begin with `mock`.
const mockScan = jest.fn()
const mockConnectSlot = jest.fn()
const mockDisconnectSlot = jest.fn()
let mockSlots: { left: unknown; right: unknown } = { left: null, right: null }

jest.mock('@ble/TrackerCoordinator', () => ({
  getTrackerCoordinator: () => ({
    scan: (...a: unknown[]) => mockScan(...a),
    connectSlot: (...a: unknown[]) => mockConnectSlot(...a),
    disconnectSlot: (...a: unknown[]) => mockDisconnectSlot(...a),
  }),
}))

jest.mock('@state/useTrackerStore', () => ({
  getTrackerSlots: () => mockSlots,
}))

/**
 * The freshness stamp the auto-connect probe treats as evidence of a live
 * connection. Any positive number that is at most a few seconds behind
 * `systemMonotonicClock().now()` reads as fresh; using the same clock keeps
 * the test in sync with the fresh-window logic (10s in production).
 */
const nowMs = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}
/** A slot object annotated as freshly live. */
const liveSlot = (deviceId: string, state: string) => ({
  deviceId,
  state,
  lastEventAtMs: nowMs(),
})

const ad = (deviceId: string) => ({ deviceId })

beforeEach(() => {
  mockScan.mockReset()
  mockConnectSlot.mockReset()
  mockDisconnectSlot.mockReset()
  mockConnectSlot.mockResolvedValue(undefined)
  mockDisconnectSlot.mockResolvedValue(undefined)
  mockSlots = { left: null, right: null }
})

describe('autoConnectKnownTrackers', () => {
  it('binds each advertising tracker to its permanent hand', async () => {
    mockScan.mockResolvedValue([ad(red.address), ad(blue.address)])

    const result = await autoConnectKnownTrackers()

    expect(result.connectedCount).toBe(2)
    expect(mockConnectSlot).toHaveBeenCalledWith('left', blue.address, blue.displayName)
    expect(mockConnectSlot).toHaveBeenCalledWith('right', red.address, red.displayName)
  })

  it('reports not-found for a tracker that is not advertising', async () => {
    mockScan.mockResolvedValue([ad(blue.address)])

    const result = await autoConnectKnownTrackers()

    expect(result.connectedCount).toBe(1)
    expect(result.outcomes.find((o) => o.hand === 'right')?.status).toBe('not-found')
    expect(mockConnectSlot).toHaveBeenCalledTimes(1)
  })

  it('ignores devices that are not known trackers', async () => {
    mockScan.mockResolvedValue([ad('00:11:22:33:44:55')])

    const result = await autoConnectKnownTrackers()

    expect(result.connectedCount).toBe(0)
    expect(mockConnectSlot).not.toHaveBeenCalled()
  })

  it('leaves a slot alone when it is ready AND has fresh liveness evidence', async () => {
    // "Ready" is not enough (D24) — the state can survive a killed process
    // while the actual GATT link is gone. A recent `lastEventAtMs` is what
    // proves the connection is live.
    mockSlots = { left: liveSlot(blue.address, 'streaming'), right: null }
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])

    const result = await autoConnectKnownTrackers()

    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('already-connected')
    expect(mockConnectSlot).toHaveBeenCalledTimes(1)
    expect(mockConnectSlot).toHaveBeenCalledWith('right', red.address, red.displayName)
    expect(mockDisconnectSlot).not.toHaveBeenCalledWith('left')
  })

  it('does not touch the radio at all when both slots are live and fresh', async () => {
    mockSlots = {
      left: liveSlot(blue.address, 'ready'),
      right: liveSlot(red.address, 'streaming'),
    }

    const result = await autoConnectKnownTrackers()

    expect(mockScan).not.toHaveBeenCalled()
    expect(result.connectedCount).toBe(0)
    expect(result.outcomes.every((o) => o.status === 'already-connected')).toBe(true)
  })

  it('evicts a phantom ready slot — the very bug that stranded the athlete', async () => {
    // A slot the store still says is `'ready'` but with no `lastEventAtMs`
    // and no recent event is exactly the phantom-connection case: a killed
    // process left the state behind while the tracker returned to slow-blink
    // advertising. Without the reclaim path, auto-connect used to skip such
    // slots and there was no way back onto the bag (D24).
    mockSlots = {
      left: { deviceId: blue.address, state: 'ready' }, // no lastEventAtMs
      right: null,
    }
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])

    const result = await autoConnectKnownTrackers()

    expect(mockDisconnectSlot).toHaveBeenCalledWith('left')
    expect(mockScan).toHaveBeenCalled()
    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('connected')
  })

  it('treats a slot bound to a DIFFERENT device as needing reconnection', async () => {
    mockSlots = { left: { deviceId: '00:11:22:33:44:55', state: 'ready' }, right: null }
    mockScan.mockResolvedValue([ad(blue.address)])

    const result = await autoConnectKnownTrackers()

    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('connected')
  })

  it('returns a scanError instead of throwing when the scan fails', async () => {
    mockScan.mockRejectedValue(new Error('bluetooth off'))

    const result = await autoConnectKnownTrackers()

    expect(result.scanError).toBe('bluetooth off')
    expect(result.connectedCount).toBe(0)
    expect(mockConnectSlot).not.toHaveBeenCalled()
  })

  it('reports a failed connect without failing the whole pass', async () => {
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])
    mockConnectSlot.mockImplementation((hand: string) =>
      hand === 'left' ? Promise.reject(new Error('gatt 133')) : Promise.resolve(),
    )

    const result = await autoConnectKnownTrackers()

    expect(result.connectedCount).toBe(1)
    const left = result.outcomes.find((o) => o.hand === 'left')
    expect(left?.status).toBe('failed')
    expect(left?.errorMessage).toBe('gatt 133')
    expect(result.outcomes.find((o) => o.hand === 'right')?.status).toBe('connected')
  })

  it('coalesces concurrent calls into a single scan', async () => {
    let release: (v: unknown[]) => void = () => {}
    mockScan.mockReturnValue(new Promise((r) => { release = r }))

    const a = autoConnectKnownTrackers()
    const b = autoConnectKnownTrackers()

    release([ad(blue.address), ad(red.address)])
    const [ra, rb] = await Promise.all([a, b])

    expect(mockScan).toHaveBeenCalledTimes(1)
    expect(ra).toBe(rb) // same in-flight promise, not a duplicate pass
  })
})
