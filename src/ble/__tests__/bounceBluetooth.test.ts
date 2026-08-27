/**
 * bounceBluetoothAndReconnect — the last-resort "Fix tracker connection" flow.
 *
 * The properties worth pinning: it opens the settings once, waits for a real
 * off→on transition (not just an `on` observed at rest), reconnects after,
 * and never throws whatever the platform does.
 */

import { bounceBluetoothAndReconnect } from '../bounceBluetooth'

type AdapterState = 'unknown' | 'off' | 'on' | 'unauthorized'

const mockOpenSettings = jest.fn<Promise<void>, []>()
const mockAutoConnect = jest.fn<Promise<unknown>, []>()

type Listener = (s: AdapterState) => void
const listeners = new Set<Listener>()

const mockOnAdapterStateChange = jest.fn((cb: Listener): (() => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
})

function pushState(s: AdapterState): void {
  // Copy the set so a listener that removes itself inside the callback
  // doesn't skip the next one.
  for (const l of [...listeners]) l(s)
}

jest.mock('@ble/BleManagerFacade', () => ({
  getBleManager: () => ({
    onAdapterStateChange: (cb: Listener) => mockOnAdapterStateChange(cb),
  }),
}))

jest.mock('../autoConnectTrackers', () => ({
  autoConnectKnownTrackers: () => mockAutoConnect(),
  // bounceBluetooth arms the retry scheduler after a successful bounce;
  // the mock treats it as one pass, which is what the assertions count.
  armAutoRetry: () => mockAutoConnect(),
}))

beforeEach(() => {
  jest.useFakeTimers()
  mockOpenSettings.mockReset().mockResolvedValue(undefined)
  mockAutoConnect.mockReset().mockResolvedValue(undefined)
  mockOnAdapterStateChange.mockClear()
  listeners.clear()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('bounceBluetoothAndReconnect', () => {
  it('opens settings, waits for off then on, and reconnects', async () => {
    const promise = bounceBluetoothAndReconnect({ openSettings: mockOpenSettings })

    // Give the async open time to complete and the subscription to attach.
    await Promise.resolve()
    await Promise.resolve()

    pushState('off')
    pushState('on')

    const result = await promise
    expect(result.status).toBe('ok')
    expect(result.observedBounce).toBe(true)
    expect(mockOpenSettings).toHaveBeenCalledTimes(1)
    expect(mockAutoConnect).toHaveBeenCalledTimes(1)
  })

  it('does not settle on an `on` that was never preceded by an `off`', async () => {
    // The adapter is already on when the flow starts — pushing `on` again
    // must not count as a bounce, because nothing was cleared.
    const promise = bounceBluetoothAndReconnect({ openSettings: mockOpenSettings })
    await Promise.resolve()
    await Promise.resolve()

    pushState('on')
    pushState('on')

    jest.advanceTimersByTime(60_000)
    const result = await promise
    expect(result.status).toBe('never-turned-off')
    expect(result.observedBounce).toBe(false)
    expect(mockAutoConnect).not.toHaveBeenCalled()
  })

  it('times out after the deadline when off was seen but on never followed', async () => {
    const promise = bounceBluetoothAndReconnect({
      openSettings: mockOpenSettings,
      timeoutMs: 5_000,
    })
    await Promise.resolve()
    await Promise.resolve()
    pushState('off')

    jest.advanceTimersByTime(5_000)
    const result = await promise
    expect(result.status).toBe('timed-out')
    expect(result.observedBounce).toBe(false)
    expect(mockAutoConnect).not.toHaveBeenCalled()
  })

  it('reports settings-unavailable when the intent fails to open', async () => {
    mockOpenSettings.mockRejectedValueOnce(new Error('no such activity'))
    const result = await bounceBluetoothAndReconnect({ openSettings: mockOpenSettings })
    expect(result.status).toBe('settings-unavailable')
    expect(mockAutoConnect).not.toHaveBeenCalled()
  })

  it('reports unauthorized rather than pretending it is a timing issue', async () => {
    const promise = bounceBluetoothAndReconnect({ openSettings: mockOpenSettings })
    await Promise.resolve()
    await Promise.resolve()
    pushState('unauthorized')

    const result = await promise
    expect(result.status).toBe('unauthorized')
    expect(mockAutoConnect).not.toHaveBeenCalled()
  })

  it('unsubscribes from state changes on the way out', async () => {
    const promise = bounceBluetoothAndReconnect({ openSettings: mockOpenSettings })
    await Promise.resolve()
    await Promise.resolve()
    expect(listeners.size).toBe(1)

    pushState('off')
    pushState('on')
    await promise

    expect(listeners.size).toBe(0)
  })
})
