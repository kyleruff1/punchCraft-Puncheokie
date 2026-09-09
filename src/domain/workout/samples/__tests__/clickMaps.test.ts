/**
 * The click-track maps' denominators (MVP v2 Part B, GH #305).
 *
 * Kyle's measure rule made every round's arithmetic checkable: reps ×
 * measures/rep must sum EXACTLY to the round's budget at its BPM. A map
 * edit that breaks a denominator fails here, not on a drive.
 */
import { CLICK_MAPS, breathBeats, clickMapsSelfCheck, clickSpecs, measuresPerRep } from '../clickMaps'
import { allClickMaps } from '../allClickMaps'
import { QUICK_WORKOUT_ORDER } from '../quickWorkouts'

describe('clickMapsSelfCheck', () => {
  it('every round of every map sums exactly to its measure budget', () => {
    expect(clickMapsSelfCheck()).toEqual([])
  })

  it('the composed quick maps pass the same copy, rest, pace and fill lint', () => {
    // compose() proves exact fill; this is the spoken-copy and pace lint
    // that only the self-check performs (digit-free lead-ins, a rest on
    // every non-final round and none on the last, burst/sustained caps).
    expect(clickMapsSelfCheck(allClickMaps())).toEqual([])
  })

  it('allClickMaps() is the ten literal maps plus the twelve quick ones', () => {
    expect(Object.keys(allClickMaps()).sort()).toEqual(
      [...Object.keys(CLICK_MAPS), ...QUICK_WORKOUT_ORDER].sort(),
    )
    expect(Object.keys(allClickMaps())).toHaveLength(22)
  })

  it('covers all 10 predefined workouts', () => {
    expect(Object.keys(CLICK_MAPS).sort()).toEqual([
      'body-work',
      'establish-the-jab-20',
      'heavy-hands',
      'pace-pusher',
      'progressive-buildup',
      'pump-and-coast',
      'speed-combos',
      'switch-by-round',
      'three-round-fundamentals',
      'uppercut-clinic',
    ])
  })
})

describe('the stride table', () => {
  it('every (slots, rate) stride is a whole number of measures', () => {
    for (const slots of [4, 8]) {
      for (const rate of [1, 1.5, 2] as const) {
        if (slots === 8 && rate === 1.5) continue // not in the table
        const strideBeats = slots / rate + breathBeats(slots, rate)
        expect(strideBeats / 4).toBe(measuresPerRep(slots, rate))
        // The breath is real — a per-rep-called block must breathe.
        expect(breathBeats(slots, rate)).toBeGreaterThan(0)
      }
    }
  })
})

describe('clickSpecs lowering', () => {
  it('offsets are 1/rate-spaced and length-match the tokens, rests included', () => {
    const round = CLICK_MAPS['pump-and-coast']!.rounds[0]!
    const specs = clickSpecs('pc', 0, round)
    expect(specs).toHaveLength(round.rows.length)
    for (const [i, spec] of specs.entries()) {
      const row = round.rows[i]!
      const slots = row.motif.split('-').length
      expect(spec.offsets).toHaveLength(slots)
      expect(spec.offsets![1]! - spec.offsets![0]!).toBeCloseTo(1 / row.rate, 10)
      expect(spec.repeat).toBe(row.reps)
      expect(spec.kind).toBe('repeated-combo')
    }
  })

  it('threads the round stance override (switch-by-round)', () => {
    const sw = CLICK_MAPS['switch-by-round']!
    const r2 = clickSpecs('sw', 1, sw.rounds[1]!)
    expect(r2.every((s) => s.stance === 'southpaw')).toBe(true)
  })
})
