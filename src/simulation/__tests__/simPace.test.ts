/**
 * Script pacing for the unattended suite (GH #291).
 *
 * The number that matters is the punch rate a looped script delivers, and
 * the invariant is that scaling to a workout's authored density lands on
 * that density — not on the call-slot grid, which is the wrong-but-
 * plausible input (240 on metronome recipes → ~5 punches/s).
 */
import { SCRIPT_NOMINAL_BPM, SIM_SCRIPTS } from '../scripts'
import { LOOP_GAP_BEATS } from '../SimulatedPunchSource'
import {
  SIM_BPM_MAX,
  SIM_BPM_MIN,
  scriptPassMs,
  scriptPunchesPerMinute,
  simBpmForWorkout,
} from '../simPace'

describe('scriptPassMs', () => {
  it('is the span plus the loop gap at nominal tempo', () => {
    const steps = SIM_SCRIPTS['alternating-1-2']
    const span = Math.max(...steps.map((s) => s.offsetMs))
    const gap = LOOP_GAP_BEATS * (60_000 / SCRIPT_NOMINAL_BPM)
    expect(scriptPassMs('alternating-1-2')).toBe(span + gap)
  })

  it('halves when the tempo doubles', () => {
    expect(scriptPassMs('captured-jam', SCRIPT_NOMINAL_BPM * 2)).toBeCloseTo(
      scriptPassMs('captured-jam') / 2,
      6,
    )
  })
})

describe('scriptPunchesPerMinute', () => {
  it('counts every step once per pass', () => {
    const steps = SIM_SCRIPTS['captured-jam']
    const expected = steps.length / (scriptPassMs('captured-jam') / 60_000)
    expect(scriptPunchesPerMinute('captured-jam')).toBeCloseTo(expected, 6)
  })

  it('is linear in tempo', () => {
    const base = scriptPunchesPerMinute('combo-1-2-3-2')
    expect(scriptPunchesPerMinute('combo-1-2-3-2', SCRIPT_NOMINAL_BPM * 1.5)).toBeCloseTo(base * 1.5, 6)
  })
})

describe('simBpmForWorkout', () => {
  it('lands on the workout density, not the call-slot grid', () => {
    // A metronome recipe's bpmForRecipe is 240; a real workout's authored
    // density is tens of punches a minute. Only the latter is the target.
    const workout = { estimatedActivePunchesPerMinute: 60 }
    const bpm = simBpmForWorkout('captured-jam', workout)
    expect(scriptPunchesPerMinute('captured-jam', bpm)).toBeCloseTo(60, 0)
  })

  it('applies the pace factor', () => {
    const workout = { estimatedActivePunchesPerMinute: 80 }
    const full = simBpmForWorkout('alternating-1-2', workout)
    const eighty = simBpmForWorkout('alternating-1-2', workout, 0.8)
    expect(eighty).toBeLessThan(full)
    expect(scriptPunchesPerMinute('alternating-1-2', eighty)).toBeCloseTo(64, -1)
  })

  it('clamps to the playable range on both sides', () => {
    expect(simBpmForWorkout('burst', { estimatedActivePunchesPerMinute: 100_000 })).toBe(SIM_BPM_MAX)
    expect(simBpmForWorkout('burst', { estimatedActivePunchesPerMinute: 0.001 })).toBe(SIM_BPM_MIN)
  })

  it('fails safe to the minimum on a zero or broken density', () => {
    expect(simBpmForWorkout('captured-jam', { estimatedActivePunchesPerMinute: 0 })).toBe(SIM_BPM_MIN)
    expect(simBpmForWorkout('captured-jam', { estimatedActivePunchesPerMinute: Number.NaN })).toBe(
      SIM_BPM_MIN,
    )
  })

  it('returns an integer, because the log line and the URL carry it', () => {
    const bpm = simBpmForWorkout('captured-jam', { estimatedActivePunchesPerMinute: 73 })
    expect(Number.isInteger(bpm)).toBe(true)
  })
})
