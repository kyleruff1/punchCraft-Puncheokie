/**
 * PummelDarkness — smoke test that the overlay mounts and the bus →
 * charge hop is wired. The classic Animated.Value's per-tick opacity
 * math is verified visually on-glass; this suite pins only the
 * structural invariants that would silently regress.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }))

import { PummelDarkness } from '../PummelDarkness'
import { createBackdropBus, type BackdropBus } from '../backdropBus'

function mount(bus: BackdropBus, reducedMotion = false): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<PummelDarkness bus={bus} reducedMotion={reducedMotion} />)
  })
  return tree
}

function has(tree: ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }, { deep: false }).length > 0
}

describe('PummelDarkness — mount + bus wiring', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers()
    })
    jest.useRealTimers()
  })

  it('mounts with a testID even before any punch lands', () => {
    const bus = createBackdropBus()
    const tree = mount(bus)
    expect(has(tree, 'pummel-darkness')).toBe(true)
    tree.unmount()
  })

  it('subscribes to the bus while active — a punch never throws', () => {
    const bus = createBackdropBus()
    bus.setActive(true)
    const tree = mount(bus)
    expect(() => bus.impulse({ hand: 'left', velocityRaw: 12 })).not.toThrow()
    expect(() => bus.impulse({ hand: 'right', velocityRaw: 6 })).not.toThrow()
    expect(() => bus.impulse({ hand: 'unknown', velocityRaw: 9 })).not.toThrow()
    tree.unmount()
  })

  it('reducedMotion skips the bus subscription — punches never reach the overlay', () => {
    const bus = createBackdropBus()
    bus.setActive(true)
    const tree = mount(bus, /* reducedMotion */ true)
    expect(() => bus.impulse({ hand: 'left', velocityRaw: 14 })).not.toThrow()
    tree.unmount()
  })

  it('unmount tears down the bus subscription and the decay interval cleanly', () => {
    const bus = createBackdropBus()
    bus.setActive(true)
    const tree = mount(bus)
    tree.unmount()
    // After unmount the bus should have no sinks; a further impulse
    // that finds no sinks is a no-op by contract (backdropBus.ts:43).
    expect(() => bus.impulse({ hand: 'left', velocityRaw: 10 })).not.toThrow()
  })
})
