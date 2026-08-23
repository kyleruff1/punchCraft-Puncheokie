/**
 * Recipe summary (M31-04, doc §8.2).
 *
 * R15 requires the summary to exist before the workout starts, and spec
 * §4.3 constrains its vocabulary — so both the content and the wording are
 * asserted here.
 */

import { summarizeRecipe } from '../recipeSummary'
import { defaultRecipe, type WorkoutRecipe } from '../WorkoutRecipe'
import { buildRoundSchedule } from '../roundSchedule'
import { GOAL_TIERS } from '../punchGoals'

const recipe = (over: Partial<WorkoutRecipe> = {}): WorkoutRecipe => ({ ...defaultRecipe(), ...over })
const summarize = (over: Partial<WorkoutRecipe> = {}) => {
  const r = recipe(over)
  return summarizeRecipe(r, buildRoundSchedule(r.durationMinutes))
}

describe('summarizeRecipe — doc §8.2 line classes', () => {
  it('produces no placeholder text for the default recipe', () => {
    const { lines } = summarize()
    expect(lines.length).toBeGreaterThanOrEqual(5)
    for (const line of lines) {
      expect(line.trim().length).toBeGreaterThan(0)
      expect(line).not.toMatch(/TODO|TBD|undefined|NaN|\[object/i)
    }
  })

  it('opens with duration, rounds and goal', () => {
    const { lines } = summarize({ durationMinutes: 30, totalPunchGoal: 1800 })
    expect(lines[0]).toContain('30 minutes')
    expect(lines[0]).toContain('7 rounds')
    expect(lines[0]).toContain('1,800')
  })

  it('states focus, stance and bias', () => {
    const { lines } = summarize({ focus: 'balanced', defaultStance: 'orthodox', bias: 'lead' })
    const line = lines.find((l) => l.includes('Orthodox'))
    expect(line).toContain('Balanced')
    expect(line).toContain('Lead-hand bias')
  })

  it('notes switch rounds in the stance line', () => {
    const { lines } = summarize({ stanceMode: 'switch-by-round' })
    expect(lines.some((l) => l.includes('switch rounds'))).toBe(true)
  })

  it('lists body-shot and command frequencies', () => {
    const { lines } = summarize({ bodyShotPercent: 18, defenseFrequency: 'moderate' })
    const line = lines.find((l) => l.startsWith('Body shots'))
    expect(line).toContain('18%')
    expect(line).toContain('5-8 calls/round')
  })

  it('states the cadence band, adaptation mode and voice mode', () => {
    const { lines } = summarize({ cadenceProfile: 'pressure', adaptationMode: 'adaptive', voiceMode: 'full' })
    const line = lines.find((l) => l.includes('cadence'))
    expect(line).toContain('110-130 BPM')
    expect(line).toContain('Adaptive pace')
    expect(line).toContain('Full Voice Coach')
  })

  it('ENDS with the expected active pace (R15)', () => {
    // The pace is the number that actually determines how hard the session
    // feels, so it is the last thing read.
    const { lines, expectedActivePace } = summarize({ durationMinutes: 20, totalPunchGoal: 1000 })
    const last = lines[lines.length - 1]
    expect(last).toBe(`Expected active pace: ${expectedActivePace} punches/minute`)
  })

  it('computes the pace against active minutes, not session minutes', () => {
    // 1000 punches over 20 session minutes is only 15 ACTIVE minutes -> 67/min.
    expect(summarize({ durationMinutes: 20, totalPunchGoal: 1000 }).expectedActivePace).toBe(67)
  })
})

describe('technique distribution estimate', () => {
  it('weights the jab highest under a balanced bias', () => {
    const { lines } = summarize({ bias: 'balanced' })
    const line = lines.find((l) => l.startsWith('Jab'))
    expect(line).toBeDefined()
  })

  it('lists only enabled punches', () => {
    const { lines } = summarize({ enabledPunches: [1, 2] })
    const line = lines.find((l) => l.includes('Jab'))
    expect(line).toContain('Cross')
    expect(line).not.toContain('uppercut')
  })

  it('omits the distribution line entirely when nothing is enabled', () => {
    // Better an absent line than "NaN%" — the validator already reports the
    // real problem, and the summary should not restate it as garbage.
    const { lines } = summarize({ enabledPunches: [] })
    expect(lines.every((l) => !l.includes('NaN'))).toBe(true)
  })

  it('shares sum to roughly 100%', () => {
    const { lines } = summarize()
    const line = lines.find((l) => l.startsWith('Jab')) ?? ''
    const percentages = [...line.matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
    const total = percentages.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(97)
    expect(total).toBeLessThanOrEqual(103)
  })
})

describe('the Extreme warning surfaces in the summary', () => {
  it('appends the warning when the goal is at the Extreme tier', () => {
    const { lines } = summarize({ durationMinutes: 20, totalPunchGoal: GOAL_TIERS.extreme[20] })
    expect(lines.some((l) => /high-volume/i.test(l))).toBe(true)
  })

  it('does not append it for a steady goal', () => {
    const { lines } = summarize({ durationMinutes: 20, totalPunchGoal: GOAL_TIERS.steady[20] })
    expect(lines.some((l) => /specialized high-volume/i.test(l))).toBe(false)
  })
})

describe('terminology (spec §4.3)', () => {
  it('never labels anything force, power or energy', () => {
    // The velocity-terminology guard covers the source; this covers the
    // GENERATED text, which the guard cannot see.
    const variants: Array<Partial<WorkoutRecipe>> = [
      {},
      { bias: 'rear' },
      { focus: 'hands' },
      { cadenceProfile: 'sprint', adaptationMode: 'goal-seeking', voiceMode: 'off' },
      { durationMinutes: 60, totalPunchGoal: GOAL_TIERS.extreme[60] },
    ]
    for (const over of variants) {
      for (const line of summarize(over).lines) {
        expect(line).not.toMatch(/\b(force|energy)\b/i)
        expect(line).not.toMatch(/power punch/i)
        expect(line).not.toMatch(/impact speed|punch strength/i)
      }
    }
  })

  it('uses rear-hand phrasing rather than technique-strength phrasing', () => {
    const { lines } = summarize({ bias: 'rear' })
    expect(lines.some((l) => l.includes('Rear-hand bias'))).toBe(true)
  })
})
