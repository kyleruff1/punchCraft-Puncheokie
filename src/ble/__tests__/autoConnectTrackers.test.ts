/**
 * autoConnectTrackers — direct-by-address, bind-both behaviour.
 *
 * The properties worth pinning: it connects each permanent address
 * DIRECTLY (no scan — scanning beside a live glove was the idle-drop
 * radio pressure, 2026-08-29), it does not disturb slots that are
 * already live, it binds each address to its permanent hand, it
 * connects SERIALLY (overlapping connects wedge the tablet's BLE
 * stack — H04), a connect timeout reads as not-found (asleep glove),
 * and concurrent callers share one pass. Plus the persistent
 * auto-retry scheduler: up to five automatic attempts, then dormant
 * until re-armed.
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

/** The direct-connect spelling of "asleep / not in range". */
const asleep = () => Promise.reject(new Error('Operation timed out'))
/** A real connect failure — never mistaken for a sleeping glove. */
const hardFail = () => Promise.reject(new Error('gatt 133'))
/** A pending (autoConnect) request: settles only when the glove wakes. */
const neverBinds = () => new Promise<void>(() => {})

/** Fast-path attempts only — pending-connect arms are not attempts. */
const fastAttempts = (hand: string): number =>
  mockConnectSlot.mock.calls.filter(
    (c) => c[0] === hand && (c[3] as { autoConnect?: boolean } | undefined)?.autoConnect !== true,
  ).length

/** Was this hand's address handed to the OS to chase? */
const armedPending = (hand: string): boolean =>
  mockConnectSlot.mock.calls.some(
    (c) => c[0] === hand && (c[3] as { autoConnect?: boolean } | undefined)?.autoConnect === true,
  )

/**
 * Wire the mock so pending arms hang (as the real OS request does) and
 * the fast path behaves as the test dictates.
 */
const withFastPath = (fast: (hand: string) => Promise<void>): void => {
  mockConnectSlot.mockImplementation(
    (hand: string, _id: string, _name: string, opts?: { autoConnect?: boolean }) =>
      opts?.autoConnect === true ? neverBinds() : fast(hand),
  )
}

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
  it('binds each reachable tracker to its permanent hand, by address, no scan', async () => {
    const result = await autoConnectKnownTrackers()

    expect(result.connectedCount).toBe(2)
    expect(mockScan).not.toHaveBeenCalled()
    expect(mockConnectSlot).toHaveBeenCalledTimes(2)
    expect(mockConnectSlot).toHaveBeenCalledWith('left', blue.address, blue.displayName, {
      timeoutMs: expect.any(Number),
    })
    expect(mockConnectSlot).toHaveBeenCalledWith('right', red.address, red.displayName, {
      timeoutMs: expect.any(Number),
    })
  })

  it('hands a sleeping glove to the OS as a pending connect, by address', async () => {
    withFastPath((hand) => (hand === 'right' ? asleep() : Promise.resolve()))

    const result = await autoConnectKnownTrackers()

    expect(result.connectedCount).toBe(1)
    expect(result.outcomes.find((o) => o.hand === 'right')?.status).toBe('not-found')
    // The button's real job: keep chasing the known address so the glove
    // binds whenever it wakes, with no scan and no repeated passes.
    expect(mockConnectSlot).toHaveBeenCalledWith('right', red.address, red.displayName, {
      autoConnect: true,
    })
  })

  it('leaves a chased hand alone on later passes — re-arming would cancel the chase', async () => {
    withFastPath((hand) => (hand === 'right' ? asleep() : Promise.resolve()))

    await autoConnectKnownTrackers()
    mockEvictSlot.mockClear()
    await autoConnectKnownTrackers()

    // Second pass: no eviction of the chased hand, no second fast attempt,
    // and no duplicate pending request.
    expect(mockEvictSlot).not.toHaveBeenCalledWith('right', expect.anything())
    expect(fastAttempts('right')).toBe(1)
    expect(
      mockConnectSlot.mock.calls.filter(
        (c) =>
          c[0] === 'right' && (c[3] as { autoConnect?: boolean } | undefined)?.autoConnect === true,
      ),
    ).toHaveLength(1)
  })

  it('leaves a slot alone when it is ready AND the native stack confirms it', async () => {
    // "Ready" is not enough (D24) — the state can outlive the actual GATT
    // link. The native probe is what proves the connection is live.
    mockIsDeviceConnected.mockResolvedValue(true)
    mockSlots = { left: liveSlot(blue.address, 'streaming'), right: null }

    const result = await autoConnectKnownTrackers()

    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('already-connected')
    expect(mockConnectSlot).toHaveBeenCalledTimes(1)
    expect(mockConnectSlot).toHaveBeenCalledWith('right', red.address, red.displayName, {
      timeoutMs: expect.any(Number),
    })
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

  it('leaves a slot alone mid-bring-up when the native stack confirms it', async () => {
    // The live screen arms a fresh pass on mount; if it lands while the
    // landing's pass is still INITIALIZING a glove, evicting that slot
    // cancels a healthy connection mid-handshake — observed 2026-08-29
    // as the right glove dying on its init writes whenever both gloves
    // came up together.
    mockIsDeviceConnected.mockResolvedValue(true)
    mockSlots = {
      left: liveSlot(blue.address, 'initializing'),
      right: liveSlot(red.address, 'connecting'),
    }

    const result = await autoConnectKnownTrackers()

    expect(mockScan).not.toHaveBeenCalled()
    expect(mockEvictSlot).not.toHaveBeenCalled()
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

    const result = await autoConnectKnownTrackers()

    expect(mockEvictSlot).toHaveBeenCalledWith('left', blue.address)
    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('connected')
  })

  it('treats a slot bound to a DIFFERENT device as needing reconnection', async () => {
    mockSlots = { left: { deviceId: '00:11:22:33:44:55', state: 'ready' }, right: null }

    const result = await autoConnectKnownTrackers()

    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('connected')
  })

  it('reports a failed connect without failing the whole pass', async () => {
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

  it('coalesces concurrent calls into a single pass', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = () => r()
    })
    mockConnectSlot.mockReturnValue(gate)

    const a = autoConnectKnownTrackers()
    const b = autoConnectKnownTrackers()

    release()
    const [ra, rb] = await Promise.all([a, b])

    expect(mockConnectSlot).toHaveBeenCalledTimes(2) // one pass, two hands
    expect(ra).toBe(rb) // same in-flight promise, not a duplicate pass
  })

  it('connects SERIALLY — the second connect waits for the first (H04)', async () => {
    // Overlapping direct connects are the observed left-tracker killer on
    // the tablet: the handshake in flight loses when the second lands.
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

    const result = await autoConnectKnownTrackers()

    expect(mockEvictSlot).not.toHaveBeenCalledWith('right', expect.anything())
    expect(mockConnectSlot).not.toHaveBeenCalledWith('right', expect.anything(), expect.anything())
    expect(result.outcomes.find((o) => o.hand === 'right')?.status).toBe('already-connected')
    expect(result.outcomes.find((o) => o.hand === 'left')?.status).toBe('connected')
  })

  it('reclaims a reload orphan — store empty, native still connected', async () => {
    // After a JS reload the store forgets the slots while the NATIVE
    // connections survive. A natively-connected tracker is not
    // connectable again until the stale link is severed, so without the
    // by-address eviction the retry budget burns on a device that was
    // attached all along.
    mockSlots = { left: null, right: null }

    const result = await autoConnectKnownTrackers()

    // Both hands evicted by their permanent addresses before connecting.
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

  /** Passes are counted by fast-path attempts on the left hand. */
  const leftAttempts = (): number => fastAttempts('left')

  it('does not retry a hand the OS is chasing — the pending connect IS the retry', async () => {
    withFastPath((hand) => (hand === 'left' ? asleep() : Promise.resolve()))

    await armAutoRetry()

    // Left is asleep, so a pending connect is armed — and that ends the
    // chain rather than re-passing every RETRY_DELAY_MS.
    expect(armedPending('left')).toBe(true)
    expect(getAutoRetryState().retrying).toBe(false)
    jest.advanceTimersByTime(RETRY_DELAY_MS * 3)
    await flush()
    expect(leftAttempts()).toBe(1)
  })

  it('retries a hard failure every RETRY_DELAY_MS until it connects', async () => {
    // A gatt error is not a sleeping glove: no pending connect is armed,
    // so the scheduler keeps its job.
    let attempts = 0
    withFastPath((hand) => {
      if (hand !== 'left') return Promise.resolve()
      attempts += 1
      return attempts === 1 ? hardFail() : Promise.resolve()
    })

    await armAutoRetry()
    expect(getAutoRetryState().retrying).toBe(true)

    jest.advanceTimersByTime(RETRY_DELAY_MS)
    await flush()

    expect(attempts).toBe(2)
    expect(getAutoRetryState().retrying).toBe(false)
    expect(getAutoRetryState().exhausted).toBe(false)
  })

  it('goes dormant after the budget is spent, until re-armed', async () => {
    withFastPath((hand) => (hand === 'left' ? hardFail() : Promise.resolve()))

    await armAutoRetry()
    for (let i = 0; i < AUTO_RETRY_BUDGET; i += 1) {
      // Async advancement interleaves timer firing with the pass's own
      // microtasks, so each cycle's `.then(scheduleRetryIfNeeded)` lands
      // before the next advance.
      await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS)
      await flush()
    }

    // 1 manual + AUTO_RETRY_BUDGET automatic passes, then silence.
    expect(leftAttempts()).toBe(1 + AUTO_RETRY_BUDGET)
    expect(getAutoRetryState().exhausted).toBe(true)
    expect(getAutoRetryState().retrying).toBe(false)

    jest.advanceTimersByTime(RETRY_DELAY_MS * 3)
    await flush()
    expect(leftAttempts()).toBe(1 + AUTO_RETRY_BUDGET)

    // Manual press re-arms the budget and passes resume.
    await armAutoRetry()
    expect(getAutoRetryState().exhausted).toBe(false)
    expect(getAutoRetryState().retrying).toBe(true)
  })

  it('a complete pass stops the chain immediately', async () => {
    await armAutoRetry()

    expect(getAutoRetryState().retrying).toBe(false)
    jest.advanceTimersByTime(RETRY_DELAY_MS * 3)
    await flush()
    expect(leftAttempts()).toBe(1)
  })

  it('suspension freezes the chain mid-workout and resume picks it back up', async () => {
    withFastPath((hand) => (hand === 'left' ? hardFail() : Promise.resolve()))

    await armAutoRetry()
    expect(getAutoRetryState().retrying).toBe(true)

    // The workout starts: no retry may connect or evict while punches
    // stream.
    setAutoRetrySuspended(true)
    jest.advanceTimersByTime(RETRY_DELAY_MS * 4)
    await flush()
    expect(leftAttempts()).toBe(1) // only the arming pass ran

    // Workout over: the interrupted chase resumes immediately.
    setAutoRetrySuspended(false)
    await flush()
    expect(leftAttempts()).toBe(2)
  })
})
