/**
 * Workout session clock (M32-08 support).
 *
 * The property that matters most: a pause freezes the work clock and does
 * not shift the round. Everything the CueEngine schedules against comes
 * from here, so drift introduced at this level would be invisible until it
 * showed up as cues firing at the wrong time.
 */
import {
  WorkoutSessionClock,
  type SessionRoundSpec,
  type SessionTransition,
} from '../WorkoutSessionClock'
import { createFakeClock, type FakeClock } from '@testing/fakeClock'

const ROUNDS: SessionRoundSpec[] = [
  { workDurationMs: 10_000, restAfterMs: 5_000 },
  { workDurationMs: 10_000, restAfterMs: 5_000 },
  { workDurationMs: 10_000, restAfterMs: 0 },
]

function harness(rounds: SessionRoundSpec[] = ROUNDS, countdownMs = 0) {
  const clock: FakeClock = createFakeClock()
  const session = new WorkoutSessionClock(rounds, { clock, countdownMs })
  const seen: SessionTransition[] = []

  const run = (ms: number, stepMs = 100): void => {
    for (let i = 0; i < Math.ceil(ms / stepMs); i++) {
      clock.advance(stepMs)
      seen.push(...session.advance())
    }
  }

  return { clock, session, seen, run }
}

const types = (seen: SessionTransition[]): string[] => seen.map((t) => t.type)

describe('start', () => {
  it('goes straight to work when there is no countdown', () => {
    const h = harness()
    expect(h.session.start()).toEqual([{ type: 'work-entered', roundIndex: 0 }])
    expect(h.session.snapshot().phase).toBe('work')
  })

  it('runs a countdown first when configured', () => {
    const h = harness(ROUNDS, 3_000)
    expect(h.session.start()).toEqual([{ type: 'countdown-entered' }])
    expect(h.session.snapshot().phase).toBe('countdown')

    h.run(3_100)
    expect(types(h.seen)).toContain('work-entered')
    expect(h.session.snapshot().phase).toBe('work')
  })

  it('is idempotent', () => {
    const h = harness()
    h.session.start()
    expect(h.session.start()).toEqual([])
  })
})

describe('phase progression', () => {
  it('walks work → rest → work across the schedule', () => {
    const h = harness()
    h.session.start()
    h.run(10_100)
    expect(h.session.snapshot().phase).toBe('rest')

    h.run(5_100)
    expect(h.session.snapshot().phase).toBe('work')
    expect(h.session.snapshot().roundIndex).toBe(1)
  })

  it('completes after the final round when it has no rest', () => {
    const h = harness()
    h.session.start()
    h.run(60_000)
    expect(h.session.snapshot().phase).toBe('completed')
    expect(types(h.seen)).toContain('completed')
  })

  it('emits every transition even when one step crosses several boundaries', () => {
    // A dropped frame must not skip a phase silently — the runner needs each
    // work-entered to load the right round into the cue engine.
    const h = harness()
    h.session.start()
    // 10s work + 5s rest per round, so 31s lands 1s into round 3's work.
    h.clock.advance(31_000)
    expect(types(h.session.advance())).toEqual([
      'rest-entered',
      'work-entered',
      'rest-entered',
      'work-entered',
    ])
    expect(h.session.snapshot().roundIndex).toBe(2)
    expect(h.session.snapshot().workElapsedMs).toBe(1_000)

    // The last round has no rest, so finishing it ends the session.
    h.clock.advance(9_100)
    expect(types(h.session.advance())).toEqual(['completed'])
  })

  it('carries overflow into the next phase rather than discarding it', () => {
    const h = harness()
    h.session.start()
    h.clock.advance(10_250)
    h.session.advance()
    // 250ms past the bell belongs to the rest that just began.
    expect(h.session.snapshot().phase).toBe('rest')
    expect(h.session.snapshot().phaseElapsedMs).toBe(250)
  })

  it('skips a zero-length rest between rounds', () => {
    const h = harness([
      { workDurationMs: 1_000, restAfterMs: 0 },
      { workDurationMs: 1_000, restAfterMs: 0 },
    ])
    h.session.start()
    h.clock.advance(1_100)
    expect(types(h.session.advance())).toEqual(['work-entered'])
    expect(h.session.snapshot().roundIndex).toBe(1)
  })
})

describe('the work clock', () => {
  it('tracks elapsed time inside the work interval', () => {
    const h = harness()
    h.session.start()
    h.run(4_000)
    expect(h.session.snapshot().workElapsedMs).toBe(4_000)
  })

  it('resets at the start of each round', () => {
    const h = harness()
    h.session.start()
    h.run(15_100) // through round 1's work and rest
    expect(h.session.snapshot().phase).toBe('work')
    expect(h.session.snapshot().workElapsedMs).toBeLessThan(1_000)
  })

  it('freezes across a pause and does not shift the round', () => {
    // This is the property the CueEngine depends on: it schedules against
    // workElapsedMs and does no pause arithmetic of its own.
    const h = harness()
    h.session.start()
    h.run(4_000)
    const frozen = h.session.snapshot().workElapsedMs

    h.session.pause()
    h.run(30_000) // half a minute of wall time while paused
    expect(h.session.snapshot().workElapsedMs).toBe(frozen)
    expect(h.session.snapshot().phase).toBe('paused')

    h.session.resume()
    h.run(1_000)
    expect(h.session.snapshot().workElapsedMs).toBe(frozen + 1_000)
    // Still round 0: the pause consumed none of the round.
    expect(h.session.snapshot().roundIndex).toBe(0)
    expect(h.session.snapshot().phase).toBe('work')
  })

  it('survives repeated pause/resume without drift', () => {
    const h = harness()
    h.session.start()
    for (let i = 0; i < 5; i++) {
      h.run(1_000)
      h.session.pause()
      h.run(3_000)
      h.session.resume()
    }
    expect(h.session.snapshot().workElapsedMs).toBe(5_000)
  })
})

describe('pause and resume', () => {
  it('restores the phase it was in', () => {
    const h = harness()
    h.session.start()
    h.run(10_100)
    expect(h.session.snapshot().phase).toBe('rest')

    h.session.pause()
    h.session.resume()
    expect(h.session.snapshot().phase).toBe('rest')
  })

  it('ignores a pause when not running and a resume when not paused', () => {
    const h = harness()
    expect(h.session.pause()).toEqual([])
    h.session.start()
    expect(h.session.resume()).toEqual([])
  })
})

describe('cancel (doc §25)', () => {
  it('stops immediately and accumulates nothing further', () => {
    const h = harness()
    h.session.start()
    h.run(3_000)
    expect(h.session.cancel()).toEqual([{ type: 'cancelled' }])

    h.run(30_000)
    expect(h.session.snapshot().phase).toBe('cancelled')
    expect(types(h.seen)).not.toContain('completed')
  })

  it('is idempotent', () => {
    const h = harness()
    h.session.start()
    h.session.cancel()
    expect(h.session.cancel()).toEqual([])
  })
})

describe('snapshot', () => {
  it('reports remaining time in the current phase, floored at zero', () => {
    const h = harness()
    h.session.start()
    h.run(3_000)
    expect(h.session.snapshot().phaseRemainingMs).toBe(7_000)
  })

  it('reports the round count', () => {
    const h = harness()
    expect(h.session.snapshot().roundCount).toBe(3)
  })

  it('starts idle with no round', () => {
    const h = harness()
    expect(h.session.snapshot().phase).toBe('idle')
    expect(h.session.snapshot().roundIndex).toBe(-1)
  })
})
