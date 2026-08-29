import { createBackdropBus, type BackdropSinkImpulse } from '../backdropBus'
import { HAND_LEFT, HAND_NEUTRAL, HAND_RIGHT } from '@domain/effects/membraneMath'

describe('backdropBus', () => {
  function activeBus() {
    const bus = createBackdropBus()
    bus.setActive(true)
    return bus
  }

  it('delivers impulses to a subscribed sink with hand codes and a 0..1 magnitude', () => {
    const bus = activeBus()
    const seen: BackdropSinkImpulse[] = []
    bus.subscribe((impulse) => seen.push(impulse))

    bus.impulse({ hand: 'left', velocityRaw: 9 })
    bus.impulse({ hand: 'right', velocityRaw: 14 })
    bus.impulse({ hand: 'unknown', velocityRaw: 9 })

    expect(seen.map((s) => s.handCode)).toEqual([HAND_LEFT, HAND_RIGHT, HAND_NEUTRAL])
    for (const impulse of seen) {
      expect(impulse.v01).toBeGreaterThanOrEqual(0)
      expect(impulse.v01).toBeLessThanOrEqual(1)
    }
    // Seeds distinct, so particle hashes differ per impulse.
    expect(new Set(seen.map((s) => s.seed)).size).toBe(3)
  })

  it('drops silently while inactive and with no subscriber', () => {
    const bus = createBackdropBus()
    const seen: BackdropSinkImpulse[] = []
    const unsubscribe = bus.subscribe((impulse) => seen.push(impulse))

    bus.impulse({ hand: 'left', velocityRaw: 9 }) // inactive
    bus.setActive(true)
    unsubscribe()
    expect(() => bus.impulse({ hand: 'left', velocityRaw: 9 })).not.toThrow() // no sink
    expect(seen).toHaveLength(0)
  })

  it('swallows a throwing sink — a decorative splash may vanish, never propagate', () => {
    const bus = activeBus()
    const after: BackdropSinkImpulse[] = []
    bus.subscribe(() => {
      throw new Error('scene exploded')
    })
    bus.subscribe((impulse) => after.push(impulse))

    expect(() => bus.impulse({ hand: 'left', velocityRaw: 9 })).not.toThrow()
    // The sink after the throwing one still heard it.
    expect(after).toHaveLength(1)
  })

  it('treats a reading-less punch as a mid splash', () => {
    const bus = activeBus()
    const seen: BackdropSinkImpulse[] = []
    bus.subscribe((impulse) => seen.push(impulse))
    bus.impulse({ hand: 'left' })
    expect(seen[0]?.v01).toBe(0.5)
  })
})
