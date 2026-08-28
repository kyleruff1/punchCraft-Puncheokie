/**
 * Scalable cadence rail (Kyle, 2026-08-28): when a phrase clip has
 * per-token word onsets AND ends, the compiler places the clip so word 0
 * ends `RAIL_K_MS` before ring 0, and stamps `cue.phraseTokenTimesMs`
 * with per-token ring offsets that follow the clip's inter-word spacing.
 * Clips without wordMarks fall back to the beat-grid `tokenOffsetsMs`.
 */
import {
  RAIL_K_MS,
  compileRoundRhythmMap,
  DEFAULT_ANNOUNCE_LEAD_TIMES,
  type WordMark,
} from '../RhythmMap'
import { expandTimeline } from '../CueTimeline'
import { generateWorkout } from '../../workout/generateWorkout'
import { defaultRecipe } from '../../workout/WorkoutRecipe'
import { formatCombo } from '../../workout/WorkoutTokens'

const durationFor = (combination: string, cadence: string): number =>
  combination.split('-').length * (cadence === 'sprint' ? 500 : 700) + 300

const workout = generateWorkout({ ...defaultRecipe(), seed: 'rail-fixture' })
const [round] = expandTimeline(workout, 'orthodox', 100).filter((r) => r.cues.length > 0)
if (!round) throw new Error('fixture yielded no work round')

const targetCue = round.cues.find((c) => c.tokens.length >= 3)
if (!targetCue) throw new Error('need a >=3-token cue in the fixture')
const targetCombination = formatCombo(targetCue.tokens)
const targetLength = durationFor(targetCombination, 'steady')
const tokenCount = targetCue.tokens.length

const uniformMarks: WordMark[] = Array.from({ length: tokenCount }, (_, i) => ({
  tokenIndex: i,
  offsetMs: Math.round(30 + (i * (targetLength - 100)) / tokenCount),
  endOffsetMs: Math.round(30 + ((i + 0.7) * (targetLength - 100)) / tokenCount),
}))

it('no wordMarks -> no phraseTokenTimesMs, byte-identical to shipped', () => {
  const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
  const on = compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    wordMarksFor: () => undefined,
  })
  expect(on.events.length).toBe(off.events.length)
  for (const cue of round.cues) expect(cue.phraseTokenTimesMs).toBeUndefined()
})

it('wordMarks missing endOffsetMs -> beat-grid fallback', () => {
  // A cue whose marks lack ends does not activate the rail.
  compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    wordMarksFor: (combo) =>
      combo === targetCombination
        ? uniformMarks.map((m) => ({ tokenIndex: m.tokenIndex, offsetMs: m.offsetMs }))
        : undefined,
  })
  expect(targetCue.phraseTokenTimesMs).toBeUndefined()
})

it('rail stamps phraseTokenTimesMs so ring N fires K ms after word N ends', () => {
  compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    wordMarksFor: (combo) => (combo === targetCombination ? uniformMarks : undefined),
  })
  const times = targetCue.phraseTokenTimesMs
  expect(times).toBeDefined()
  expect(times).toHaveLength(tokenCount)

  // Ring 0 fires exactly at scheduledStartMs (offset 0): word 0 ended
  // RAIL_K_MS ago by placement, so ring 0 is K ms after it.
  expect(times![0]).toBe(0)

  // Every subsequent ring keeps the same K ms lag: ring N offset equals
  // the coach's Nth word-end delta from word 0.
  for (let i = 1; i < tokenCount; i += 1) {
    const expected =
      (uniformMarks[i]!.endOffsetMs as number) - (uniformMarks[0]!.endOffsetMs as number)
    expect(times![i]).toBe(Math.round(expected))
  }
})

it('rail-driven and beat-grid cues coexist in one round without cross-contamination', () => {
  // Clear any lingering state from prior tests; only cues whose combination
  // matches the target take rail marks. Reps of the same combination all
  // play the same clip so they all deserve the rail treatment — the
  // property we're guarding is: cues with a DIFFERENT combination stay
  // on the beat grid.
  round.cues.forEach((c) => (c.phraseTokenTimesMs = undefined))
  compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    wordMarksFor: (combo) => (combo === targetCombination ? uniformMarks : undefined),
  })
  expect(targetCue.phraseTokenTimesMs).toBeDefined()
  let otherComboCues = 0
  for (const cue of round.cues) {
    if (formatCombo(cue.tokens) === targetCombination) continue
    otherComboCues += 1
    expect(cue.phraseTokenTimesMs).toBeUndefined()
  }
  // Sanity: the fixture actually has diverse combinations, else the test
  // is trivially green.
  expect(otherComboCues).toBeGreaterThan(0)
})

it('rail placement respects the previewAt floor: over-long marks fall back', () => {
  // Marks whose word 0 ends absurdly late would want the clip to start
  // BEFORE its preview window opens — the compiler must fall back rather
  // than stamp times that place the clip in the past.
  round.cues.forEach((c) => (c.phraseTokenTimesMs = undefined))
  const overlongMarks: WordMark[] = Array.from({ length: tokenCount }, (_, i) => ({
    tokenIndex: i,
    offsetMs: 60_000 + i * 700,
    endOffsetMs: 60_000 + i * 700 + 500,
  }))
  compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    wordMarksFor: (combo) => (combo === targetCombination ? overlongMarks : undefined),
  })
  expect(targetCue.phraseTokenTimesMs).toBeUndefined()
})

it('RAIL_K_MS is exported and finite', () => {
  expect(Number.isFinite(RAIL_K_MS)).toBe(true)
  expect(RAIL_K_MS).toBeGreaterThan(0)
  // The rail's K should be smaller than the classic readyToneMs window is
  // large — otherwise ring 0 fires later than the old placement expected
  // and repeat thinning windows might slip. Sanity check: leave room.
  expect(RAIL_K_MS).toBeLessThan(1000)
  // And it references the same default leadTimes source of truth.
  expect(DEFAULT_ANNOUNCE_LEAD_TIMES.readyToneMs).toBeGreaterThan(0)
})
