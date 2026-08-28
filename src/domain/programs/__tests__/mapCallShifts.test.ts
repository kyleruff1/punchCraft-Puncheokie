/**
 * Cadence-lab per-clip placement shift (Kyle: ~75 % clean, drift is
 * set/combo-dependent). The knob is `CompileOptions.phraseShiftFor`; a
 * positive shift for a clip starts it EARLIER, a negative starts it later,
 * and every other event in the round must be byte-identical. If a blanket
 * lead-time change were shipped instead, the aligned 75 % would drift too.
 */
import { compileRoundRhythmMap } from '../RhythmMap'
import { expandTimeline } from '../CueTimeline'
import { generateWorkout } from '../../workout/generateWorkout'
import { defaultRecipe } from '../../workout/WorkoutRecipe'

const durationFor = (combination: string, cadence: string): number =>
  combination.split('-').length * (cadence === 'sprint' ? 500 : 700) + 300

const workout = generateWorkout({ ...defaultRecipe(), seed: 'shift-fixture' })
const [round] = expandTimeline(workout, 'orthodox', 100).filter((r) => r.cues.length > 0)

if (!round) throw new Error('fixture yielded no work round')

const eventKey = (e: { kind: string; atMs: number; cueId: string; payload: unknown }) => {
  const combo =
    e.payload && typeof e.payload === 'object' && 'combination' in e.payload
      ? String((e.payload as { combination: unknown }).combination)
      : ''
  return `${e.kind}:${e.cueId}@${e.atMs}${combo ? `:${combo}` : ''}`
}

it('undefined phraseShiftFor is byte-identical to no shift function', () => {
  const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
  const on = compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    phraseShiftFor: () => undefined,
  })
  expect(on.events.map(eventKey)).toEqual(off.events.map(eventKey))
})

it('a zero shift is byte-identical to the shipped placement', () => {
  const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
  const on = compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    phraseShiftFor: () => 0,
  })
  expect(on.events.map(eventKey)).toEqual(off.events.map(eventKey))
})

it('shifts ONLY the target clip; every other event stays put', () => {
  const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
  const targetCue = round.cues.find((c) => c.tokens.length >= 2)
  if (!targetCue) throw new Error('need a multi-token cue in the fixture')
  const targetCombination = targetCue.tokens.join('-')
  const SHIFT_MS = 250

  const on = compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    phraseShiftFor: (combo) => (combo === targetCombination ? SHIFT_MS : undefined),
  })

  // Same event count / kind / cueId ordering.
  expect(on.events.length).toBe(off.events.length)
  for (let i = 0; i < off.events.length; i += 1) {
    const o = off.events[i]!
    const n = on.events[i]!
    expect(n.kind).toBe(o.kind)
    expect(n.cueId).toBe(o.cueId)
    const payloadCombo =
      o.payload && typeof o.payload === 'object' && 'combination' in o.payload
        ? String((o.payload as { combination: string }).combination)
        : null
    const moved = (o.kind === 'call' || o.kind === 'refire') && payloadCombo === targetCombination
    if (moved) {
      expect(n.atMs).toBe(o.atMs - SHIFT_MS)
    } else {
      expect(n.atMs).toBe(o.atMs)
    }
  }
})

it('a shift never runs a call before its preview window opens', () => {
  const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
  const targetCue = round.cues.find((c) => c.tokens.length >= 2)!
  const targetCombination = targetCue.tokens.join('-')
  // A shift bigger than the whole preview window would clamp — verify it does.
  const on = compileRoundRhythmMap(round, {
    cadence: 'steady',
    durationFor,
    phraseShiftFor: (combo) => (combo === targetCombination ? 60_000 : undefined),
  })
  for (const cue of round.cues) {
    const callOn = on.events.find((e) => e.cueId === cue.id && e.kind === 'call')
    if (callOn) expect(callOn.atMs).toBeGreaterThanOrEqual(cue.previewAt)
  }
  // And events for OTHER cues are still where they were.
  const otherOff = off.events.filter((e) => e.cueId !== targetCue.id)
  const otherOn = on.events.filter((e) => e.cueId !== targetCue.id)
  expect(otherOn.map(eventKey)).toEqual(otherOff.map(eventKey))
})
