/**
 * `SimulatedPunchSource.stopScript()` (GH #291) — the phase-driven driver's
 * primitive.
 *
 * The distinction it exists for: `stop()` cancels the schedule AND flips
 * `started` off, so a `stop()` at rest-entered would leave the next
 * `playScript()` at work-entered silently doing nothing. `stopScript()`
 * must empty the schedule — including a looping script's re-arm — and
 * leave the source armed.
 */
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import { createFakeClock } from '@testing/fakeClock'

import { SIM_SCRIPTS } from '../scripts'
import { SimulatedPunchSource } from '../SimulatedPunchSource'

function harness(loop: boolean) {
  const clock = createFakeClock()
  const events: TrackerPunchEvent[] = []
  const source = new SimulatedPunchSource({
    clock,
    seed: 'stop-script',
    loop,
    wallClockIso: () => '2026-09-07T00:00:00.000Z',
  })
  source.subscribe((event) => events.push(event))
  source.start()
  return { clock, source, events }
}

const STEPS = SIM_SCRIPTS['alternating-1-2']

describe('stopScript', () => {
  it('halts a looping script, and playScript can start it again', () => {
    const h = harness(true)
    h.source.playScript('alternating-1-2')
    h.clock.advance(60_000)
    const afterFirstMinute = h.events.length
    // A looping script keeps delivering: well past one pass by now.
    expect(afterFirstMinute).toBeGreaterThan(STEPS.length)

    h.source.stopScript()
    h.clock.advance(60_000)
    // Nothing more arrives — the re-arm was cancelled too, not just the
    // steps already on the clock.
    expect(h.events.length).toBe(afterFirstMinute)

    // Still armed: the next phase can play again without a fresh start().
    h.source.playScript('alternating-1-2')
    h.clock.advance(60_000)
    expect(h.events.length).toBeGreaterThan(afterFirstMinute)
  })

  it('is what stop() is not: the source stays started', () => {
    const h = harness(false)
    h.source.stop()
    h.source.playScript('alternating-1-2')
    h.clock.advance(60_000)
    expect(h.events.length).toBe(0) // stop() disarmed it — playScript is a no-op

    const g = harness(false)
    g.source.stopScript()
    g.source.playScript('alternating-1-2')
    g.clock.advance(60_000)
    expect(g.events.length).toBe(STEPS.length) // one non-looping pass
  })

  it('is safe with nothing scheduled', () => {
    const h = harness(true)
    expect(() => h.source.stopScript()).not.toThrow()
    expect(() => h.source.stopScript()).not.toThrow()
  })
})
