/**
 * Type concordance (form bonus).
 *
 * The property that matters most is structural: **there is no path by
 * which this signal reduces anything.** H12 showed the type byte is
 * device-local, so it cannot be used to accuse anyone — but within one
 * device it is not random, so it can still be used to congratulate.
 */
import {
  FORM_BONUS_PER_AGREEMENT,
  H12_DEVICE_PROFILES,
  familyOf,
  formBonus,
  profileFor,
  typeConcordance,
  type DeviceTypeProfile,
} from '../typeConcordance'
import type { PunchType } from '../PunchEvent'

const RED = 'EA:69:2D:9C:FD:53'
const BLUE = 'D7:34:B4:27:D5:84'

const ev = (deviceId: string, punchTypeRaw?: number) => ({ deviceId, punchTypeRaw })

// ---------------------------------------------------------------------------

describe('the profiles record only discriminating bytes', () => {
  it('keeps red\'s hook and straight bytes', () => {
    const red = profileFor(RED)!
    expect(red.discriminatingBytes[2]).toBe('hook')
    expect(red.discriminatingBytes[3]).toBe('straight')
  })

  it('drops red\'s byte 4, which is modal for jabs AND uppercuts', () => {
    // A bonus on an ambiguous byte would congratulate the athlete for
    // throwing either of two different things.
    expect(profileFor(RED)!.discriminatingBytes[4]).toBeUndefined()
  })

  it('keeps only blue\'s uppercut byte', () => {
    const blue = profileFor(BLUE)!
    expect(blue.discriminatingBytes[3]).toBe('uppercut')
    // Byte 1 is modal for jabs, crosses and hooks alike on this device.
    expect(blue.discriminatingBytes[1]).toBeUndefined()
  })

  it('marks every shipped profile provisional', () => {
    // One athlete, one sitting. H12's own next test is whether the mapping
    // is stable across sessions.
    for (const profile of H12_DEVICE_PROFILES) {
      expect(profile.provisional).toBe(true)
      expect(profile.sampleSize).toBeGreaterThan(0)
      expect(profile.notes.length).toBeGreaterThan(0)
    }
  })

  it('never maps one byte to two families on a device', () => {
    for (const profile of H12_DEVICE_PROFILES) {
      const entries = Object.entries(profile.discriminatingBytes)
      expect(new Set(entries.map(([byte]) => byte)).size).toBe(entries.length)
    }
  })
})

describe('concordance', () => {
  it('agrees when the byte matches the prescribed family on that device', () => {
    expect(typeConcordance(ev(RED, 2), 'hook')).toBe('agree')
    expect(typeConcordance(ev(BLUE, 3), 'uppercut')).toBe('agree')
  })

  it('disagrees when the byte maps to a different family', () => {
    expect(typeConcordance(ev(RED, 2), 'straight')).toBe('disagree')
  })

  it('is unknown for an ambiguous byte', () => {
    expect(typeConcordance(ev(BLUE, 1), 'straight')).toBe('unknown')
    expect(typeConcordance(ev(RED, 4), 'straight')).toBe('unknown')
  })

  it('is unknown for an unrecognised device', () => {
    // A tracker with no profile earns nothing rather than borrowing
    // another device's mapping — which is the exact mistake H12 refuted.
    expect(typeConcordance(ev('AA:BB:CC:DD:EE:FF', 2), 'hook')).toBe('unknown')
  })

  it('is unknown when the event carries no type byte', () => {
    expect(typeConcordance(ev(RED), 'hook')).toBe('unknown')
  })

  it('is unknown when the cue prescribed no technique', () => {
    expect(typeConcordance(ev(RED, 2), undefined)).toBe('unknown')
    expect(typeConcordance(ev(RED, 2), 'unknown')).toBe('unknown')
  })

  it('does not treat the vendor power flag as a family', () => {
    // 'power' is a vendor classification, not a technique.
    expect(typeConcordance(ev(RED, 2), 'power')).toBe('unknown')
  })

  it('never agrees across devices for the same technique', () => {
    // The refuted claim, asserted as a guard: red's hook byte must not
    // register as a hook on blue.
    expect(typeConcordance(ev(BLUE, 2), 'hook')).toBe('unknown')
  })
})

describe('the bonus can only add', () => {
  it('adds for an agreement', () => {
    expect(formBonus([{ event: ev(RED, 2), expectedType: 'hook' }])).toBe(
      FORM_BONUS_PER_AGREEMENT,
    )
  })

  it('adds nothing — and subtracts nothing — for a disagreement', () => {
    // The asymmetry the whole design rests on: a false negative costs the
    // athlete nothing.
    expect(formBonus([{ event: ev(RED, 2), expectedType: 'straight' }])).toBe(0)
  })

  it('never returns a negative total, whatever the input', () => {
    const hostile = [
      { event: ev(RED, 2), expectedType: 'straight' as PunchType },
      { event: ev(BLUE, 3), expectedType: 'hook' as PunchType },
      { event: ev(RED, 4), expectedType: 'uppercut' as PunchType },
      { event: ev('unknown-device', 9), expectedType: 'hook' as PunchType },
    ]
    expect(formBonus(hostile)).toBe(0)
    expect(formBonus(hostile)).toBeGreaterThanOrEqual(0)
  })

  it('scales with the number of agreements', () => {
    const pairs = [
      { event: ev(RED, 2), expectedType: 'hook' as PunchType },
      { event: ev(RED, 3), expectedType: 'straight' as PunchType },
      { event: ev(BLUE, 3), expectedType: 'uppercut' as PunchType },
    ]
    expect(formBonus(pairs)).toBe(3 * FORM_BONUS_PER_AGREEMENT)
  })

  it('is zero for an empty set', () => {
    expect(formBonus([])).toBe(0)
  })

  it('keeps the per-agreement value small', () => {
    // A signal this provisional should feel like a flourish, not like the
    // thing the athlete is playing for.
    expect(FORM_BONUS_PER_AGREEMENT).toBeLessThanOrEqual(2)
  })
})

describe('custom profiles', () => {
  it('accepts a caller-supplied table', () => {
    const custom: DeviceTypeProfile[] = [
      {
        deviceAddress: 'TEST',
        label: 'test',
        discriminatingBytes: { 7: 'hook' },
        sampleSize: 1,
        capturedAt: '2026-01-01',
        provisional: true,
        notes: 'test',
      },
    ]
    expect(typeConcordance(ev('TEST', 7), 'hook', custom)).toBe('agree')
    // And the shipped profiles do not leak in.
    expect(typeConcordance(ev(RED, 2), 'hook', custom)).toBe('unknown')
  })
})

describe('familyOf', () => {
  it.each([
    ['straight', 'straight'],
    ['hook', 'hook'],
    ['uppercut', 'uppercut'],
  ] as const)('maps %s through', (input, expected) => {
    expect(familyOf(input)).toBe(expected)
  })

  it.each(['power', 'unknown', undefined] as const)('treats %s as no family', (input) => {
    expect(familyOf(input)).toBeUndefined()
  })
})
