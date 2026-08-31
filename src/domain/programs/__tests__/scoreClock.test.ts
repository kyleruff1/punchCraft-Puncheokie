/**
 * Score clock — round-relative session time onto the score's axis.
 *
 * GH #305 blocker 2. The regression these pin is not subtle once you
 * simulate a whole workout: with no round offset, every round-1 slot
 * fires in one burst at the end of round 0 and rounds 2+ never fire at
 * all. The last test walks a real three-round score minute by minute
 * and asserts each round's slots land inside their own round.
 */

import { roundStartTicksFrom, scoreTickAt } from '../scoreClock'
import { compileWorkoutScore, type WorkoutScoreConfig } from '../workoutScore'
import { threeRoundFundamentals } from '../../workout/samples/threeRoundFundamentals'
import { SlotDispatcher } from '@/audio/SlotDispatcher'

function config(overrides: Partial<WorkoutScoreConfig> = {}): WorkoutScoreConfig {
  return {
    stance: 'orthodox',
    bpm: 120,
    revision: 1,
    compiledAtEpochMs: 1_700_000_000_000,
    // Without a resolver the score emits ZERO coach slots and every
    // assertion below would pass vacuously.
    coachAssets: (contentKind, vocabulary) => ({
      assetId: `stub:${contentKind}:${vocabulary}`,
      mappedDurationTicks: vocabulary === 'numeric' ? 240 : 480,
    }),
    ...overrides,
  }
}

const SCORE = compileWorkoutScore(threeRoundFundamentals, config())

describe('roundStartTicksFrom', () => {
  it('reads one entry per round, in round order, strictly increasing', () => {
    const ticks = roundStartTicksFrom(SCORE)
    expect(ticks.length).toBe(threeRoundFundamentals.schedule.length)
    expect(ticks[0]).toBe(0)
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!)
    }
  })

  it('agrees with the score\'s own round-start boundaries', () => {
    const ticks = roundStartTicksFrom(SCORE)
    for (const boundary of SCORE.phaseBoundaries) {
      if (boundary.kind !== 'round-start') continue
      expect(ticks[boundary.roundIndex]).toBe(boundary.atTick)
    }
  })
})

describe('scoreTickAt', () => {
  const starts = [0, 1000, 2000]

  // 960 ticks per beat at 60 BPM = 0.96 ticks/ms.
  const ticksIn100Ms = Math.round(100 / (60_000 / (60 * 960)))

  it('offsets by the round, not just the elapsed time', () => {
    expect(scoreTickAt(starts, 0, 0)).toBe(0)
    expect(scoreTickAt(starts, 0, 1)).toBe(1000)
    expect(scoreTickAt(starts, 100, 1)).toBe(1000 + ticksIn100Ms)
  })

  it('falls back to no offset for a round the score does not know', () => {
    expect(scoreTickAt(starts, 100, 9)).toBe(ticksIn100Ms)
  })
})

describe('multi-round dispatch (the blocker-2 regression)', () => {
  /** Walk the whole workout at 50 ms, as the runner's tick does. */
  function runWorkout(useOffset: boolean): Map<number, number[]> {
    const starts = roundStartTicksFrom(SCORE)
    /** roundIndex the dispatcher was in when each slot fired. */
    const firedInRound = new Map<number, number[]>()
    let currentRound = 0
    const dispatcher = new SlotDispatcher({
      getCurrentVocabulary: () => 'numeric',
      play: () => {
        const list = firedInRound.get(currentRound) ?? []
        list.push(currentRound)
        firedInRound.set(currentRound, list)
      },
    })
    dispatcher.enqueueAll(SCORE.coachSlots)

    for (const [roundIndex, round] of threeRoundFundamentals.schedule.entries()) {
      currentRound = roundIndex
      // `workElapsedMs` restarts at 0 every round — that is the whole
      // point of the bug.
      for (let workElapsedMs = 0; workElapsedMs <= round.workDurationMs; workElapsedMs += 50) {
        dispatcher.advance(
          useOffset
            ? scoreTickAt(starts, workElapsedMs, roundIndex)
            : scoreTickAt([], workElapsedMs, roundIndex),
        )
      }
    }
    return firedInRound
  }

  it('fires slots in every round when the round offset is applied', () => {
    const fired = runWorkout(true)
    for (let round = 0; round < threeRoundFundamentals.schedule.length; round += 1) {
      expect(fired.get(round)?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('WITHOUT the offset, later rounds are starved — the shape of the bug', () => {
    const fired = runWorkout(false)
    const lastRound = threeRoundFundamentals.schedule.length - 1
    // The final round never fires a single slot — its band sits far
    // above anything a round-relative clock can reach.
    expect(fired.get(lastRound)?.length ?? 0).toBe(0)
    // And round 0 fires MORE than its own share, because its cursor
    // runs up into round 1's band before its work phase ends.
    const ownedByRound0 = SCORE.coachSlots.filter((s) => s.roundIndex === 0).length
    expect(fired.get(0)?.length ?? 0).toBeGreaterThan(ownedByRound0)
  })

  it('every slot fires exactly once across the workout', () => {
    const fired = runWorkout(true)
    const total = [...fired.values()].reduce((sum, list) => sum + list.length, 0)
    expect(total).toBe(SCORE.coachSlots.length)
  })

  it('with the round-band clamp on, every slot still fires — in its OWN round', () => {
    // The clamp (GH #305 precall bleed) holds a slot until its round
    // starts. The risk it introduces is the opposite of the bug: a slot
    // held and then never released. This walks the whole workout with the
    // clamp engaged and asserts nothing is lost AND nothing leaks across
    // a boundary.
    const starts = roundStartTicksFrom(SCORE)
    const firedIn = new Map<string, number>()
    let currentRound = 0
    const dispatcher = new SlotDispatcher({
      getCurrentVocabulary: () => 'numeric',
      play: (_assetId, _atTick, slotId) => firedIn.set(slotId, currentRound),
    })
    dispatcher.enqueueAll(SCORE.coachSlots)

    for (const [roundIndex, round] of threeRoundFundamentals.schedule.entries()) {
      currentRound = roundIndex
      for (let ms = 0; ms <= round.workDurationMs; ms += 50) {
        dispatcher.advance(scoreTickAt(starts, ms, roundIndex), roundIndex)
      }
    }

    expect(firedIn.size).toBe(SCORE.coachSlots.length)
    expect(dispatcher.getStaleSkippedCount()).toBe(0)
    // The whole point: every slot sounded during the round it belongs to.
    for (const slot of SCORE.coachSlots) {
      expect(firedIn.get(slot.slotId)).toBe(slot.roundIndex)
    }
  })
})
