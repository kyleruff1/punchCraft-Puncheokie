/**
 * autoConnectTrackers — scan-once, bind-both behaviour.
 *
 * The properties worth pinning: it never throws on a failed scan, it does not
 * disturb slots that are already live, it binds each address to its permanent
 * hand, it connects SERIALLY (overlapping connects wedge the tablet's BLE
 * stack — H04, observed as the left tracker failing mid-handshake), and
 * concurrent callers share one scan. Plus the persistent auto-retry
 * scheduler: up to five automatic attempts, then dormant until re-armed.
 */

import {
  AUTO_RETRY_BUDGET,
  RETRY_DELAY_MS,
  armAutoRetry,
  autoConnectKnownTrackers,
  getAutoRetryState,
  resetAutoRetryForTest,
  setAutoRetrySuspended,
} from '../autoConnectTrackers'
import { KNOWN_TRACKERS } from '../knownTrackers'

const blue = KNOWN_TRACKERS.find((t) => t.hand === 'left')!
const red = KNOWN_TRACKERS.find((t) => t.hand === 'right')!

// `jest.mock` factories are hoisted above these declarations, so Jest only
// permits references whose names begin with `mock`.
const mockScan = jest.fn()
const mockConnectSlot = jest.fn()
const mockDisconnectSlot = jest.fn()
const mockEvictSlot = jest.fn()
const mockIsDeviceConnected = jest.fn()
let mockSlots: { left: unknown; right: unknown } = { left: null, right: null }

jest.mock('@ble/TrackerCoordinator', () => ({
  getTrackerCoordinator: () => ({
    scan: (...a: unknown[]) => mockScan(...a),
    connectSlot: (...a: unknown[]) => mockConnectSlot(...a),
    disconnectSlot: (...a: unknown[]) => mockDisconnectSlot(...a),
    evictSlot: (...a: unknown[]) => mockEvictSlot(...a),
    isDeviceConnected: (...a: unknown[]) => mockIsDeviceConnected(...a),
  }),
}))

jest.mock('@state/useTrackerStore', () => ({
  getTrackerSlots: () => mockSlots,
}))

/** A slot in a connected-looking state; whether it counts as "connected to
 * the current session" is decided by the native probe (mockIsDeviceConnected),
 * which is the whole point of the precise rule. */
const liveSlot = (deviceId: string, state: string) => ({ deviceId, state })

const ad = (deviceId: string) => ({ deviceId })

beforeEach(() => {
  mockScan.mockReset()
  mockConnectSlot.mockReset()
  mockDisconnectSlot.mockReset()
  mockEvictSlot.mockReset()
  mockIsDeviceConnected.mockReset()
  mockConnectSlot.mockResolvedValue(undefined)
  mockDisconnectSlot.mockResolvedValue(undefined)
  mockEvictSlot.mockResolvedValue(undefined)
  // Default: the native stack knows nothing — every hand is pending.
  mockIsDeviceConnected.mockResolvedValue(false)
  mockSlots = { left: null, right: null }
  resetAutoRetryForTest()
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

  it('leaves a slot alone when it is ready AND the native stack confirms it', async () => {
    // "Ready" is not enough (D24) — the state can outlive the actual GATT
    // link. The native probe is what proves the connection is live.
    mockIsDeviceConnected.mockResolvedValue(true)
    mockSlots = { left: liveSlot(blue.address, 'streaming'), right: null }
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])

    const result = await autoConnectKnownTrackers()

    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('already-connected')
    expect(mockConnectSlot).toHaveBeenCalledTimes(1)
    expect(mockConnectSlot).toHaveBeenCalledWith('right', red.address, red.displayName)
    expect(mockEvictSlot).not.toHaveBeenCalledWith('left', expect.anything())
  })

  it('does not scan or connect when both hands are connected to this session', async () => {
    mockIsDeviceConnected.mockResolvedValue(true)
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
    // The store says `'ready'` but the native stack says the device is not
    // connected: the phantom-connection case. Without the reclaim path,
    // auto-connect used to skip such slots and there was no way back onto
    // the bag (D24).
    mockIsDeviceConnected.mockResolvedValue(false)
    mockSlots = {
      left: { deviceId: blue.address, state: 'ready' },
      right: null,
    }
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])

    const result = await autoConnectKnownTrackers()

    expect(mockEvictSlot).toHaveBeenCalledWith('left', blue.address)
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

  it('connects SERIALLY — the second connect waits for the first (H04)', async () => {
    // Overlapping direct connects are the observed left-tracker killer on
    // the tablet: the handshake in flight loses when the second lands.
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])
    let leftInFlight = false
    let overlapped = false
    let releaseLeft: () => void = () => {}
    // Resolves the moment the LEFT connect actually starts — the pass has
    // evictions, permission checks and the scan ahead of it, so a fixed
    // number of microtask turns cannot time the release reliably.
    const leftStarted = new Promise<void>((started) => {
      mockConnectSlot.mockImplementation((hand: string) => {
        if (hand === 'left') {
          leftInFlight = true
          started()
          return new Promise<void>((resolve) => {
            releaseLeft = () => {
              leftInFlight = false
              resolve()
            }
          })
        }
        if (leftInFlight) overlapped = true
        return Promise.resolve()
      })
    })

    const pass = autoConnectKnownTrackers()
    await leftStarted
    releaseLeft()
    await pass

    expect(overlapped).toBe(false)
    expect(mockConnectSlot).toHaveBeenCalledTimes(2)
  })

  it('a failed first connect still lets the second proceed', async () => {
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])
    mockConnectSlot.mockImplementation((hand: string) =>
      hand === 'left' ? Promise.reject(new Error('was disconnected')) : Promise.resolve(),
    )

    const result = await autoConnectKnownTrackers()

    expect(result.outcomes.find((o) => o.hand === 'right')?.status).toBe('connected')
  })

  it("evicts an 'error' slot down to the radio before rescanning", async () => {
    // A failed handshake leaves the slot in 'error' with no JS binding —
    // and an OS-level half-open handle that keeps the device off the air.
    // The eviction pass must clear it or the retry can never succeed.
    mockSlots = {
      left: { deviceId: blue.address, state: 'error' },
      right: null,
    }
    mockScan.mockResolvedValue([ad(blue.address)])

    const result = await autoConnectKnownTrackers()

    expect(mockEvictSlot).toHaveBeenCalledWith('left', blue.address)
    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('connected')
  })

  it('a hand connected to this session is untouchable while the other is chased', async () => {
    // The precise rule: store ready + native confirms = leave it alone,
    // on every pass. The other hand still gets evicted, scanned and
    // connected.
    mockIsDeviceConnected.mockImplementation((deviceId: string) =>
      Promise.resolve(deviceId === red.address),
    )
    mockSlots = {
      right: { deviceId: red.address, state: 'ready' },
      left: null,
    }
    mockScan.mockResolvedValue([ad(blue.address)])

    const result = await autoConnectKnownTrackers()

    expect(mockEvictSlot).not.toHaveBeenCalledWith('right', expect.anything())
    expect(mockConnectSlot).not.toHaveBeenCalledWith('right', expect.anything(), expect.anything())
    expect(result.outcomes.find((o) => o.hand === 'right')?.status).toBe('already-connected')
    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('connected')
  })

  it('reclaims a reload orphan — store empty, native still connected', async () => {
    // After a JS reload the store forgets the slots while the NATIVE
    // connections survive. A natively-connected tracker does not advertise,
    // so without the by-address eviction every scan comes back empty and
    // the retry budget burns on a device that was attached all along.
    mockSlots = { left: null, right: null }
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])

    const result = await autoConnectKnownTrackers()

    // Both hands evicted by their permanent addresses before the scan.
    expect(mockEvictSlot).toHaveBeenCalledWith('left', blue.address)
    expect(mockEvictSlot).toHaveBeenCalledWith('right', red.address)
    expect(result.connectedCount).toBe(2)
  })
})

describe('persistent auto-retry', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  /** Flush the microtask queue so a scheduled pass's promise chain settles. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  }

  it('retries an incomplete pass every RETRY_DELAY_MS until both hands connect', async () => {
    // First pass: left not advertising. Later passes: it appears.
    mockScan.mockResolvedValueOnce([ad(red.address)])
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])

    await armAutoRetry()
    expect(getAutoRetryState().retrying).toBe(true)

    jest.advanceTimersByTime(RETRY_DELAY_MS)
    await flush()

    expect(mockScan).toHaveBeenCalledTimes(2)
    expect(getAutoRetryState().retrying).toBe(false)
    expect(getAutoRetryState().exhausted).toBe(false)
  })

  it('goes dormant after the budget is spent, until re-armed', async () => {
    mockScan.mockResolvedValue([ad(red.address)]) // left never shows

    await armAutoRetry()
    for (let i = 0; i < AUTO_RETRY_BUDGET; i += 1) {
      // Async advancement interleaves timer firing with the pass's own
      // microtasks, so each cycle's `.then(scheduleRetryIfNeeded)` lands
      // before the next advance.
      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS)
      await flush()
    }

    // 1 manual + AUTO_RETRY_BUDGET automatic passes, then silence.
    expect(mockScan).toHaveBeenCalledTimes(1 + AUTO_RETRY_BUDGET)
    expect(getAutoRetryState().exhausted).toBe(true)
    expect(getAutoRetryState().retrying).toBe(false)

    jest.advanceTimersByTime(RETRY_DELAY_MS * 3)
    await flush()
    expect(mockScan).toHaveBeenCalledTimes(1 + AUTO_RETRY_BUDGET)

    // Manual press re-arms the budget and passes resume.
    await armAutoRetry()
    expect(getAutoRetryState().exhausted).toBe(false)
    expect(getAutoRetryState().retrying).toBe(true)
  })

  it('a complete pass stops the chain immediately', async () => {
    mockScan.mockResolvedValue([ad(blue.address), ad(red.address)])

    await armAutoRetry()

    expect(getAutoRetryState().retrying).toBe(false)
    jest.advanceTimersByTime(RETRY_DELAY_MS * 3)
    await flush()
    expect(mockScan).toHaveBeenCalledTimes(1)
  })

  it('suspension freezes the chain mid-workout and resume picks it back up', async () => {
    mockScan.mockResolvedValue([ad(red.address)]) // left keeps hiding

    await armAutoRetry()
    expect(getAutoRetryState().retrying).toBe(true)

    // The workout starts: no retry may scan or evict while punches stream.
    setAutoRetrySuspended(true)
    jest.advanceTimersByTime(RETRY_DELAY_MS * 4)
    await flush()
    expect(mockScan).toHaveBeenCalledTimes(1) // only the arming pass ran

    // Workout over: the interrupted chase resumes immediately.
    setAutoRetrySuspended(false)
    await flush()
    expect(mockScan).toHaveBeenCalledTimes(2)
  })
})
