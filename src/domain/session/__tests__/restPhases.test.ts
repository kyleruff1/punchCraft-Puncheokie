/**
 * Rest sub-phases and the freeze at the bell (M33-04, doc §23, D6).
 *
 * Two properties carry this suite:
 *
 * 1. **The phase is a pure function of elapsed time**, so it can never
 *    disagree with the clock — and the boundaries land exactly where doc
 *    §23 says they do for a 60 s rest, and proportionally for any other.
 * 2. **The result stops at the bell.** A punch delivered during rest — a
 *    stray one at the bag, a late recovered event — must not move a number
 *    the athlete is already reading.
 *
 * The `skipRest` block lives here rather than in `WorkoutSessionClock.test`
 * because it is the D6 rule under test, not the phase machine: one call
 * ends the rest, and the three presentation phases have nothing of their
 * own to skip.
 */
import {
  REST_PHASE_ORDER,
  REST_PREVIEW_FRACTION,
  REST_RECOVERY_FRACTION,
  RoundResultFreeze,
  nextRoundPreview,
  restPhaseAt,
  restPhaseStep,
  restProgress,
  type RestPhase,
} from '../restPhases'
import { WorkoutSessionClock, type SessionRoundSpec } from '../WorkoutSessionClock'
import { createFakeClock } from '@testing/fakeClock'
import type { ProgramRound, WorkoutBlock, WorkoutToken } from '@domain/workout/WorkoutTokens'

const MINUTE = 60_000

describe('restPhaseAt — the doc §23 boundaries for a 60 s rest', () => {
  const cases: Array<[number, RestPhase]> = [
    [0, 'result'],
    [11_999, 'result'],
    [12_000, 'recovery'],
    [44_999, 'recovery'],
    [45_000, 'preview'],
    [59_999, 'preview'],
  ]

  it.each(cases)('is %s ms into the rest → %s', (elapsed, expected) => {
    expect(restPhaseAt(elapsed, MINUTE)).toBe(expected)
  })

  it('puts the boundaries at exactly 12 s and 45 s', () => {
    expect(REST_RECOVERY_FRACTION * MINUTE).toBe(12_000)
    expect(REST_PREVIEW_FRACTION * MINUTE).toBe(45_000)
  })
})

describe('restPhaseAt — a non-standard rest keeps the same shape', () => {
  it('scales the boundaries proportionally for a 30 s rest', () => {
    expect(restPhaseAt(5_999, 30_000)).toBe('result')
    expect(restPhaseAt(6_000, 30_000)).toBe('recovery')
    expect(restPhaseAt(22_499, 30_000)).toBe('recovery')
    expect(restPhaseAt(22_500, 30_000)).toBe('preview')
  })

  it('still reaches all three phases in a very short rest', () => {
    const seen = new Set<RestPhase>()
    for (let ms = 0; ms < 10_000; ms += 100) seen.add(restPhaseAt(ms, 10_000))
    expect(seen).toEqual(new Set(REST_PHASE_ORDER))
  })

  it('never goes backwards as time advances', () => {
    let lowest = 0
    for (let ms = 0; ms <= MINUTE; ms += 250) {
      const step = restPhaseStep(restPhaseAt(ms, MINUTE))
      expect(step).toBeGreaterThanOrEqual(lowest)
      lowest = step
    }
  })
})

describe('restPhaseAt — nonsense resolves rather than throws', () => {
  // A render is the worst place to raise: a bad number must not blank the
  // screen the athlete is resting in front of.
  it('clamps a negative elapsed to the start', () => {
    expect(restPhaseAt(-5_000, MINUTE)).toBe('result')
  })

  it('clamps an overrun to the last phase', () => {
    expect(restPhaseAt(MINUTE * 5, MINUTE)).toBe('preview')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'resolves a %p duration to the last phase without throwing',
    (duration) => {
      expect(() => restPhaseAt(1_000, duration)).not.toThrow()
      expect(restPhaseAt(1_000, duration)).toBe('preview')
    },
  )

  it('keeps progress inside 0…1', () => {
    expect(restProgress(-1, MINUTE)).toBe(0)
    expect(restProgress(MINUTE * 3, MINUTE)).toBe(1)
  })
})

// ---------------------------------------------------------------------------

describe('RoundResultFreeze — the numbers stop at the bell', () => {
  const openRound = (): RoundResultFreeze => {
    const freeze = new RoundResultFreeze()
    freeze.beginRound(1)
    return freeze
  }

  it('totals the round it was opened for, not the session', () => {
    const freeze = openRound()
    for (let i = 0; i < 3; i++) freeze.observePunch({ hand: 'left' })
    for (let i = 0; i < 2; i++) freeze.observePunch({ hand: 'right' })

    const result = freeze.freeze(240)
    expect(result).toMatchObject({ roundIndex: 1, actual: 5, left: 3, right: 2, target: 240 })
  })

  it('ignores every punch that lands after the freeze', () => {
    const freeze = openRound()
    freeze.observePunch({ hand: 'left', velocityRaw: 40 })
    const frozen = freeze.freeze(240)

    // The rest interval: a stray punch at the bag, a late recovered event.
    for (let i = 0; i < 20; i++) freeze.observePunch({ hand: 'right', velocityRaw: 99 })

    expect(frozen?.actual).toBe(1)
    expect(frozen?.right).toBe(0)
    expect(frozen?.avgVelocity?.value).toBe(40)
    expect(frozen?.bestVelocity?.value).toBe(40)
    expect(freeze.isOpen).toBe(false)
  })

  it('cannot be frozen twice, so a duplicate bell keeps the first result', () => {
    const freeze = openRound()
    freeze.observePunch({ hand: 'left' })
    expect(freeze.freeze(240)?.actual).toBe(1)
    expect(freeze.freeze(240)).toBeUndefined()
  })

  it('starts a new round from zero', () => {
    const freeze = openRound()
    freeze.observePunch({ hand: 'left' })
    freeze.freeze(240)

    freeze.beginRound(2)
    freeze.observePunch({ hand: 'right' })
    const second = freeze.freeze(200)
    expect(second).toMatchObject({ roundIndex: 2, actual: 1, left: 0, right: 1 })
  })

  it('counts an unknown hand into the total without inventing a side', () => {
    const freeze = openRound()
    freeze.observePunch({ hand: 'unknown' })
    const result = freeze.freeze(10)
    expect(result).toMatchObject({ actual: 1, left: 0, right: 0 })
  })
})

describe('RoundResultFreeze — velocity is absent, never zero (spec §4.2)', () => {
  it('omits both velocity readings when the source reports none', () => {
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    freeze.observePunch({ hand: 'left' })
    const result = freeze.freeze(100)
    expect(result?.avgVelocity).toBeUndefined()
    expect(result?.bestVelocity).toBeUndefined()
  })

  it('labels every reading as tracker-reported velocity (spec §4.3)', () => {
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    freeze.observePunch({ hand: 'left', velocityRaw: 10 })
    freeze.observePunch({ hand: 'right', velocityRaw: 20 })
    const result = freeze.freeze(100)

    expect(result?.avgVelocity).toEqual({
      value: 15,
      unit: 'tracker-unit',
      label: 'tracker-reported velocity',
    })
    expect(result?.bestVelocity?.value).toBe(20)
  })

  it('ignores a non-finite reading rather than poisoning the average', () => {
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    freeze.observePunch({ hand: 'left', velocityRaw: 10 })
    freeze.observePunch({ hand: 'right', velocityRaw: Number.NaN })
    expect(freeze.freeze(100)?.avgVelocity?.value).toBe(10)
  })
})

describe('RoundResultFreeze — a dropped tracker is recorded, not hidden', () => {
  it('is sticky for the round once a glove has dropped (doc §23)', () => {
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    expect(freeze.freeze(100)?.trackerDropped).toBe(false)

    freeze.beginRound(1)
    freeze.noteTrackerDropped()
    // Reconnected — but the count still under-reports.
    freeze.observePunch({ hand: 'left' })
    expect(freeze.freeze(100)?.trackerDropped).toBe(true)
  })

  it('does not carry the flag into the next round', () => {
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    freeze.noteTrackerDropped()
    freeze.freeze(100)
    freeze.beginRound(1)
    expect(freeze.freeze(100)?.trackerDropped).toBe(false)
  })
})

describe('RoundResultFreeze — precision counts confirmed technique matches (D25)', () => {
  it('reports zero when no precision hits landed', () => {
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    freeze.observePunch({ hand: 'left' })
    expect(freeze.freeze(100)?.precision).toBe(0)
  })

  it('accumulates across the round rather than clearing per cue', () => {
    // The runner clears per-cue affirmed markers on every new cue-active so
    // the stage does not carry old marks; the freeze counter must not care.
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    freeze.notePrecisionHit()
    freeze.notePrecisionHit()
    freeze.notePrecisionHit()
    expect(freeze.freeze(100)?.precision).toBe(3)
  })

  it('resets between rounds', () => {
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    freeze.notePrecisionHit()
    freeze.freeze(100)
    freeze.beginRound(1)
    expect(freeze.freeze(100)?.precision).toBe(0)
  })

  it('goes silent once the round has frozen', () => {
    // Same rule as observePunch: after the bell the number stops moving.
    // A late `notePrecisionHit` from an in-flight settled match must not
    // reopen the round's grade.
    const freeze = new RoundResultFreeze()
    freeze.beginRound(0)
    freeze.notePrecisionHit()
    const first = freeze.freeze(100)
    freeze.notePrecisionHit()
    expect(first?.precision).toBe(1)
  })
})

// ---------------------------------------------------------------------------

function block(id: string, tokens: WorkoutToken[]): WorkoutBlock {
  return {
    id,
    kind: 'repeated-combo',
    stance: 'inherit',
    startOffsetMs: 0,
    durationMs: 1_000,
    gapBeats: 1,
    tokens,
  }
}

function round(blocks: WorkoutBlock[], theme = 'Jab into the counter'): ProgramRound {
  return {
    id: 'r',
    order: 1,
    kind: 'round',
    countsTowardGoal: true,
    theme,
    workDurationMs: 180_000,
    restAfterMs: MINUTE,
    targetPunches: 240,
    blocks,
  }
}

const punch = (number: 1 | 2 | 3, beatOffset: number): WorkoutToken => ({
  kind: 'punch',
  number,
  body: false,
  beatOffset,
})

describe('nextRoundPreview', () => {
  it('takes the theme and two punch combinations (doc §23)', () => {
    const preview = nextRoundPreview(
      round([
        block('b1', [punch(1, 0), punch(2, 0.6)]),
        block('b2', [punch(1, 0), punch(2, 0.6), punch(3, 1.3)]),
        block('b3', [punch(1, 0), punch(1, 0.6)]),
      ]),
      'orthodox',
    )
    expect(preview?.theme).toBe('Jab into the counter')
    expect(preview?.sampleCombos).toEqual(['1-2', '1-2-3'])
  })

  it('skips blocks with no punches in them', () => {
    const preview = nextRoundPreview(
      round([
        block('b1', [{ kind: 'defense', command: 'slip', beatOffset: 0 }]),
        block('b2', [punch(1, 0), punch(2, 0.6)]),
      ]),
      'orthodox',
    )
    expect(preview?.sampleCombos).toEqual(['1-2'])
  })

  it('resolves the first block’s stance against the default (D2)', () => {
    const blocks = [block('b1', [punch(1, 0), punch(2, 0.6)])]
    blocks[0]!.stance = 'switch'
    expect(nextRoundPreview(round(blocks), 'orthodox')?.stance).toBe('southpaw')
    expect(nextRoundPreview(round(blocks), 'southpaw')?.stance).toBe('orthodox')
  })

  it('is undefined after the final round rather than an empty preview', () => {
    expect(nextRoundPreview(undefined, 'orthodox')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------

describe('skipRest — one call, all three phases (D6)', () => {
  const ROUNDS: SessionRoundSpec[] = [
    { workDurationMs: 10_000, restAfterMs: MINUTE },
    { workDurationMs: 10_000, restAfterMs: 0 },
  ]

  function inRest() {
    const clock = createFakeClock()
    const session = new WorkoutSessionClock(ROUNDS, { clock, countdownMs: 0 })
    session.start()
    clock.advance(10_000)
    session.advance()
    return { clock, session }
  }

  it('leaves rest for the next round immediately', () => {
    const { session } = inRest()
    expect(session.snapshot().phase).toBe('rest')

    expect(session.skipRest()).toEqual([{ type: 'work-entered', roundIndex: 1 }])
    expect(session.snapshot().phase).toBe('work')
    expect(session.snapshot().roundIndex).toBe(1)
  })

  it('completes the session when the skipped rest was the last one', () => {
    const clock = createFakeClock()
    const session = new WorkoutSessionClock([{ workDurationMs: 10_000, restAfterMs: MINUTE }], {
      clock,
      countdownMs: 0,
    })
    session.start()
    clock.advance(10_000)
    session.advance()

    expect(session.skipRest()).toEqual([{ type: 'completed' }])
    expect(session.snapshot().phase).toBe('completed')
  })

  it('does nothing outside rest, so it cannot shorten a work interval', () => {
    const clock = createFakeClock()
    const session = new WorkoutSessionClock(ROUNDS, { clock, countdownMs: 0 })
    session.start()
    expect(session.snapshot().phase).toBe('work')
    expect(session.skipRest()).toEqual([])
    expect(session.snapshot().phase).toBe('work')

    session.pause()
    expect(session.skipRest()).toEqual([])
    expect(session.snapshot().phase).toBe('paused')
  })

  it('adds no session state — the phase before it is plain rest (spec §18.1)', () => {
    const { session, clock } = inRest()
    for (const elapsed of [0, 12_000, 45_000]) {
      // Whichever presentation sub-phase is showing, the machine says rest.
      expect(restPhaseAt(elapsed, MINUTE)).toBeDefined()
      expect(session.snapshot().phase).toBe('rest')
      clock.advance(1_000)
      session.advance()
    }
  })
})
