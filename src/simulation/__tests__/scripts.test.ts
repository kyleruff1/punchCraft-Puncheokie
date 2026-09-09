/**
 * The `captured-jam` replay script.
 *
 * Its values are real tracker signatures recorded on 2026-09-06, kept so an
 * instrument change can be compared audibly run to run without anyone
 * throwing a punch. That makes the numbers themselves the contract, which is
 * why they are asserted rather than merely present.
 */
import { SIM_SCRIPTS } from '../scripts'

describe('captured-jam — real signatures replayed', () => {
  // These pairs were logged off the gloves on 2026-09-06. The point of the
  // script is that an instrument change can be A/B'd audibly without anyone
  // throwing a punch, so the values themselves are the contract.
  const steps = SIM_SCRIPTS['captured-jam']

  it('carries an acceleration for every step — the drum velocity axis', () => {
    // drum-kit-design §8: MIDI hit velocity comes from ACCELERATION, not
    // velocity. A step without it cannot reproduce how the punch sounded,
    // which is the entire reason this script exists.
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) {
      expect(step.accelerationRaw).toBeDefined()
      expect(step.velocityRaw).toBeDefined()
    }
  })

  it('spans the full range the trackers actually reported that night', () => {
    const accels = steps.map((s) => s.accelerationRaw as number)
    expect(Math.min(...accels)).toBe(41)
    expect(Math.max(...accels)).toBe(796)
  })

  it('covers both hands', () => {
    const hands = new Set(steps.map((s) => s.hand))
    expect(hands.has('left')).toBe(true)
    expect(hands.has('right')).toBe(true)
  })

  it('is strictly ordered in time', () => {
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!.offsetMs).toBeGreaterThan(steps[i - 1]!.offsetMs)
    }
  })

  it('reaches past the scaler’s warm ceiling, which is the point', () => {
    // HIGH_SENSITIVITY_ACCELERATION_DEFAULTS.warmHigh is 350. Half these
    // punches exceed it, which is exactly the saturation this script is
    // meant to make audible and repeatable.
    const over = steps.filter((s) => (s.accelerationRaw as number) > 350)
    expect(over.length).toBeGreaterThan(5)
  })
})
