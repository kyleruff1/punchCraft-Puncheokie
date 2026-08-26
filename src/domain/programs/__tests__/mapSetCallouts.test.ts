/**
 * Set Ceremonies: pre-set call-outs compiled inside the fill's
 * reservation — and Kyle's constraint held as a property: the ceremony
 * NEVER moves a call, refire or phase mark. The map's audio/visual sync
 * is untouchable by personality, same contract as encouragement and
 * power mode.
 */
import {
  compileRoundRhythmMap,
  SET_CALLOUT_MIN_CLEAR_MS,
  SET_CALLOUT_QUIET_MS,
  type SetCalloutPayload,
} from '../RhythmMap'
import { expandTimeline } from '../CueTimeline'
import { coverageAudit } from '../mapValidation'
import { generateWorkout } from '../../workout/generateWorkout'
import { defaultRecipe } from '../../workout/WorkoutRecipe'
import { MANDATORY_SAME_MOVE_MS } from '../../workout/setupCallouts'
import { formatCombo } from '../../workout/WorkoutTokens'

const durationFor = (combination: string, cadence: string): number | undefined =>
  combination.includes('-') ? (cadence === 'technical' ? 1600 : 1200) : undefined

const SENTENCE_MS = 2_600
const setupCalloutDurationFor = (asset: string): number | undefined =>
  asset.startsWith('co-') ? SENTENCE_MS : undefined

/** Prices every ceremony the way live.tsx does, with fixed clip lengths. */
const reserveMsFor = (
  asset: string,
  notation: string | undefined,
  tail: string | undefined,
): number | undefined =>
  SENTENCE_MS +
  (notation !== undefined ? 1_600 + 250 : 0) +
  (tail !== undefined ? SENTENCE_MS + 250 : 0) +
  800

function generatedRounds(seed: string) {
  const workout = generateWorkout(
    { ...defaultRecipe(), seed },
    { setupCallouts: { reserveMsFor } },
  )
  return { workout, timeline: expandTimeline(workout, 'orthodox', 100) }
}

describe('set ceremonies on the rhythm map', () => {
  const { workout, timeline } = generatedRounds('ceremony-seed')
  const scored = timeline.filter((r) => r.cues.length > 0)

  it('stamps ceremonies on most sets — the coach procures them', () => {
    const stamped = scored
      .flatMap((r) => r.cues)
      .filter((c) => c.setupCallout !== undefined)
    // Near-every-set density (Kyle): several ceremonies per round.
    expect(stamped.length).toBeGreaterThanOrEqual(scored.length * 3)
    // First cue of a block only — the ceremony announces the set, not reps.
    for (const cue of stamped) expect(cue.repeatIndex).toBe(0)
  })

  it('never moves a call, refire or phase mark — sync is untouchable', () => {
    for (const round of scored) {
      const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
      const on = compileRoundRhythmMap(round, {
        cadence: 'steady',
        durationFor,
        setupCalloutDurationFor,
      })
      const times = (m: typeof off) =>
        m.events
          .filter(
            (e) => e.kind === 'call' || e.kind === 'refire' || e.kind === 'phase-announce',
          )
          .map((e) => `${e.kind}:${e.id}@${e.atMs}`)
          .sort()
      expect(times(on)).toEqual(times(off))
    }
  })

  it('finishes every ceremony inside its quiet margin, clear of neighbours', () => {
    let ceremonies = 0
    for (const round of scored) {
      const map = compileRoundRhythmMap(round, {
        cadence: 'steady',
        durationFor,
        setupCalloutDurationFor,
      })
      const byCue = new Map<string, typeof map.events>()
      for (const e of map.events) {
        if (e.kind !== 'set-callout') continue
        byCue.set(e.cueId, [...(byCue.get(e.cueId) ?? []), e])
      }
      for (const [cueId, parts] of byCue) {
        ceremonies += 1
        const cueIndex = round.cues.findIndex((c) => c.id === cueId)
        const call = map.events.find((e) => e.kind === 'call' && e.cueId === cueId)!
        const ordered = [...parts].sort((a, b) => a.atMs - b.atMs)
        // The whole chain ends before the set's own call, with the margin.
        const last = ordered.at(-1)!
        const lastMs =
          'recite' in (last.payload as SetCalloutPayload) ? 1_600 : SENTENCE_MS
        expect(last.atMs + lastMs).toBeLessThanOrEqual(call.atMs - SET_CALLOUT_QUIET_MS)
        // And starts clear of the previous cue's window.
        const prev = round.cues[cueIndex - 1]
        if (prev) {
          expect(ordered[0]!.atMs).toBeGreaterThanOrEqual(
            prev.scheduledEndMs + SET_CALLOUT_MIN_CLEAR_MS,
          )
        }
        // Sentence first; any recitation before any tail.
        expect('asset' in (ordered[0]!.payload as SetCalloutPayload)).toBe(true)
      }
    }
    expect(ceremonies).toBeGreaterThan(0)
  })

  it('emits nothing when the sentence clip has no measured duration', () => {
    for (const round of scored.slice(0, 1)) {
      const map = compileRoundRhythmMap(round, {
        cadence: 'steady',
        durationFor,
        setupCalloutDurationFor: () => undefined,
      })
      expect(map.events.filter((e) => e.kind === 'set-callout')).toHaveLength(0)
    }
  })

  it('still covers the round and keeps its punch goal honest', () => {
    for (const round of workout.schedule.filter((r) => r.countsTowardGoal)) {
      expect(coverageAudit(round.blocks, round.workDurationMs).ok).toBe(true)
    }
    // The reservations cost punches; D26 keeps targets honest as OUTPUTS —
    // the drift warning must not trip on the default recipe.
    expect(
      workout.warnings.filter((w) => w.toLowerCase().includes('drift')),
    ).toHaveLength(0)
  })

  it('announces every same-move stretch longer than a minute', () => {
    for (const seed of ['a', 'b', 'c', 'long-tail', 'grind']) {
      const { workout: w } = generatedRounds(`mandatory-${seed}`)
      for (const round of w.schedule.filter((r) => r.countsTowardGoal)) {
        let runStart = 0
        const blocks = round.blocks
        while (runStart < blocks.length) {
          const first = blocks[runStart]!
          const notation = formatCombo(first.tokens)
          let runEnd = runStart + 1
          while (
            runEnd < blocks.length &&
            formatCombo(blocks[runEnd]!.tokens) === notation &&
            blocks[runEnd]!.kind === 'repeated-combo' &&
            first.kind === 'repeated-combo'
          ) {
            runEnd += 1
          }
          const last = blocks[runEnd - 1]!
          const runMs = last.startOffsetMs + last.durationMs - first.startOffsetMs
          if (runMs > MANDATORY_SAME_MOVE_MS) {
            expect([round.id, notation, first.setupCallout !== undefined]).toEqual([
              round.id,
              notation,
              true,
            ])
          }
          runStart = runEnd
        }
      }
    }
  })

  it('is deterministic per seed', () => {
    const a = generatedRounds('same-seed').workout
    const b = generatedRounds('same-seed').workout
    expect(JSON.stringify(a.schedule)).toBe(JSON.stringify(b.schedule))
  })
})
