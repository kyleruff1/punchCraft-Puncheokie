/**
 * VoicePolicy — the three-property split (M39-V2 Phase 3).
 *
 * The module is data + types; the tests pin the DEFAULT presets since
 * those are the behavioral defaults Kyle spec'd for the compiler to
 * hand out:
 *
 *   Discrete combo drill → pre-call each rep.
 *   Sustained pump → one intro, silent interior.
 *   Coasting → one intro, authored check-ins.
 */
import {
  DEFAULT_COAST_POLICY,
  DEFAULT_COMBO_POLICY,
  DEFAULT_SUSTAINED_POLICY,
  type VoicePolicy,
} from '../VoicePolicy'

describe('VoicePolicy default presets', () => {
  it('DEFAULT_COMBO_POLICY pre-calls each rep', () => {
    expect(DEFAULT_COMBO_POLICY.contentKind).toBe('combo-announce')
    expect(DEFAULT_COMBO_POLICY.defaultTiming).toBe('precall')
    expect(DEFAULT_COMBO_POLICY.repeatFrequency).toBe('once-per-rep')
  })

  it('DEFAULT_SUSTAINED_POLICY fires once and stays silent through the block', () => {
    expect(DEFAULT_SUSTAINED_POLICY.contentKind).toBe('sustained-instruction')
    expect(DEFAULT_SUSTAINED_POLICY.defaultTiming).toBe('precall')
    expect(DEFAULT_SUSTAINED_POLICY.repeatFrequency).toBe('once-per-cue')
  })

  it('DEFAULT_COAST_POLICY intro + authored check-ins', () => {
    expect(DEFAULT_COAST_POLICY.contentKind).toBe('coast-intro')
    expect(DEFAULT_COAST_POLICY.defaultTiming).toBe('precall')
    expect(DEFAULT_COAST_POLICY.repeatFrequency).toBe('authored-events')
  })

  it('presets are frozen so a caller cannot mutate them in place', () => {
    // `Object.freeze` is the runtime backstop — a JS caller casting
    // through `any` still cannot leave the presets dirty. Strict
    // mode raises TypeError on assignment to a frozen property; if
    // strict mode is off, the assignment silently fails. Test both
    // by checking the value is unchanged after a `try` that swallows
    // the potential throw.
    const asAny = DEFAULT_COMBO_POLICY as unknown as { contentKind: string }
    try {
      asAny.contentKind = 'coast-intro'
    } catch {
      /* strict-mode TypeError — swallowed */
    }
    expect(DEFAULT_COMBO_POLICY.contentKind).toBe('combo-announce')
    expect(Object.isFrozen(DEFAULT_COMBO_POLICY)).toBe(true)
  })
})

describe('VoicePolicy authored variants', () => {
  it('accepts selected-reps with an explicit index list', () => {
    const p: VoicePolicy = {
      contentKind: 'strike-call',
      defaultTiming: 'synchronized',
      repeatFrequency: 'selected-reps',
      selectedRepIndexes: [0, 2],
    }
    expect(p.selectedRepIndexes).toEqual([0, 2])
  })

  it('accepts a coast check-in as a strike-call with synchronized timing', () => {
    const p: VoicePolicy = {
      contentKind: 'coast-checkin',
      defaultTiming: 'synchronized',
      repeatFrequency: 'authored-events',
    }
    expect(p.defaultTiming).toBe('synchronized')
  })
})
