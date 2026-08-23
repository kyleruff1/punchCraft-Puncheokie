/**
 * Live punch-source selection (M33-01).
 *
 * No Bluetooth and no hardware: a fake facade is registered with the
 * `BleManagerFacade` factory, and its GATT discovery simply rejects — which
 * is enough to prove the tracker source was chosen and armed without ever
 * touching a radio. What matters here is the choice and what the top bar is
 * told, not what comes down the wire.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

import {
  registerBleManagerFactory,
  resetBleManagerSingleton,
  type BleManagerFacade,
} from '@ble/BleManagerFacade'
import { replaceSinks } from '@diagnostics/logger'
import { createFakeClock } from '@testing/fakeClock'
import { useTrackerStore, type SlotState } from '@state/useTrackerStore'
import { getLive, useLiveStore } from '@state/useWorkoutStore'
import { degradedText, useLivePunchSource, type LivePunchSource } from '../useLivePunchSource'

const LEFT_DEVICE = 'D7:34:B4:27:D5:84'
const RIGHT_DEVICE = 'EA:69:2D:9C:FD:53'

/**
 * Enough facade for the source to arm. `discoverAllServicesAndCharacteristics`
 * rejecting is a normal path in `PunchStream` — it records an init error and
 * returns a controller — so the hook is exercised end to end with no radio.
 */
function fakeFacade(): BleManagerFacade {
  return {
    onConnectionChange: () => () => undefined,
    discoverAllServicesAndCharacteristics: () => Promise.reject(new Error('no radio in jest')),
  } as unknown as BleManagerFacade
}

let captured: LivePunchSource | null = null

function Probe(): null {
  captured = useLivePunchSource(createFakeClock())
  return null
}

const mounted: ReactTestRenderer[] = []

function render(): void {
  act(() => {
    mounted.push(create(<Probe />))
  })
}

function slot(deviceId: string, state: SlotState['state']): SlotState {
  return { deviceId, state }
}

function setSlots(left: SlotState | null, right: SlotState | null): void {
  act(() => {
    useTrackerStore.setState({ slots: { left, right } })
  })
}

beforeAll(() => {
  replaceSinks([])
})

beforeEach(() => {
  captured = null
  resetBleManagerSingleton()
  registerBleManagerFactory(() => fakeFacade())
  act(() => {
    useTrackerStore.setState({ slots: { left: null, right: null } })
    useLiveStore.getState().resetLive()
  })
})

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount()
  })
})

// ---------------------------------------------------------------------------

describe('source selection', () => {
  it('uses the simulator when no tracker is connected', () => {
    render()
    expect(captured?.kind).toBe('simulated')
    expect(captured?.source.id).toBe('sim')
    expect(captured?.sim).not.toBeNull()
  })

  it('uses the simulator when only one glove is connected', () => {
    // Half the combinations would be unmatchable; simulated counts are the
    // honest answer, and the chips say so.
    setSlots(slot(LEFT_DEVICE, 'ready'), null)
    render()
    expect(captured?.kind).toBe('simulated')
    expect(captured?.connection).toEqual({ left: 'simulated', right: 'simulated' })
  })

  it('uses the real trackers when both gloves are connected', () => {
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'streaming'))
    render()
    expect(captured?.kind).toBe('tracker')
    expect(captured?.source.id).toBe('tracker')
    // No sim API on the tracker path — nothing to fake into a real session.
    expect(captured?.sim).toBeNull()
  })

  it('treats a still-initializing glove as not connected', () => {
    setSlots(slot(LEFT_DEVICE, 'initializing'), slot(RIGHT_DEVICE, 'ready'))
    render()
    expect(captured?.kind).toBe('simulated')
  })

  it('declares hand + timestamp + velocity on the tracker path (D12)', () => {
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'ready'))
    render()
    expect(captured?.source.capability).toEqual({
      hand: true,
      timestamp: true,
      punchType: 'none',
      velocity: true,
    })
  })
})

describe('connection states reach the top bar', () => {
  it('reports the real per-glove state on the tracker path', () => {
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'ready'))
    render()
    setSlots(slot(LEFT_DEVICE, 'recovering'), slot(RIGHT_DEVICE, 'streaming'))
    expect(captured?.connection).toEqual({ left: 'recovering', right: 'streaming' })
  })

  it('reports simulated for both gloves on the simulated path', () => {
    render()
    expect(captured?.connection).toEqual({ left: 'simulated', right: 'simulated' })
  })
})

describe('the source is latched on entry (spec §19.3)', () => {
  it('keeps the same source instance when a glove drops mid-workout', () => {
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'ready'))
    render()
    const before = captured?.source

    setSlots(slot(LEFT_DEVICE, 'recovering'), slot(RIGHT_DEVICE, 'ready'))
    // Swapping the source would rebuild the cue engine and restart the
    // workout; only the top bar may change.
    expect(captured?.source).toBe(before)
    expect(captured?.kind).toBe('tracker')
  })

  it('does not upgrade to trackers if they connect after the screen opens', () => {
    render()
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'ready'))
    expect(captured?.kind).toBe('simulated')
  })
})

describe('degraded warning (spec §19.4, doc §19)', () => {
  it('is silent while both gloves are live', () => {
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'streaming'))
    render()
    expect(getLive().degraded).toBeUndefined()
  })

  it('goes through the existing live-slice degraded string', () => {
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'ready'))
    render()
    setSlots(slot(LEFT_DEVICE, 'recovering'), slot(RIGHT_DEVICE, 'ready'))
    expect(getLive().degraded).toBe(
      'Left glove reconnecting — those punches are not being counted',
    )
  })

  it('clears once the glove comes back', () => {
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'ready'))
    render()
    setSlots(slot(LEFT_DEVICE, 'recovering'), slot(RIGHT_DEVICE, 'ready'))
    setSlots(slot(LEFT_DEVICE, 'ready'), slot(RIGHT_DEVICE, 'ready'))
    expect(getLive().degraded).toBeUndefined()
  })

  it('stays quiet on the simulated path', () => {
    render()
    expect(getLive().degraded).toBeUndefined()
  })

  it('names both gloves when both are gone', () => {
    expect(degradedText(null, null)).toBe(
      'Both gloves not connected — punches are not being counted',
    )
  })

  it('distinguishes two different failures', () => {
    expect(degradedText(slot(LEFT_DEVICE, 'recovering'), slot(RIGHT_DEVICE, 'error'))).toBe(
      'Left glove reconnecting, right glove not responding — punches are not being counted',
    )
  })

  it('names the right glove when only it is affected', () => {
    expect(degradedText(slot(LEFT_DEVICE, 'streaming'), slot(RIGHT_DEVICE, 'error'))).toBe(
      'Right glove not responding — those punches are not being counted',
    )
  })
})
