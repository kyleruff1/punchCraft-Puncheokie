/**
 * Block-level cornerman instructions on the rhythm map (WS4 / A23).
 *
 * The invariants:
 *   1. `instructionClipFor` absent → zero instruction events (byte-identical
 *      to the pre-WS4 compile).
 *   2. `instructionClipFor` present but returns undefined → still zero
 *      instruction events (the manifest was consulted and had nothing).
 *   3. `instructionClipFor` returns a clip → one event on the FIRST cue of
 *      the block set (repeatIndex 0), at `scheduledStartMs +
 *      INSTRUCTION_START_PAD_MS`. Later reps inherit the text on
 *      `CueInstance.instruction` but do NOT re-fire.
 *   4. A cue that also has a setupCallout ceremony gets NO instruction
 *      event — the ceremony IS the block's opening line.
 *   5. Instructions never move a call, refire or phase-announce.
 */
import {
  compileRoundRhythmMap,
  INSTRUCTION_START_PAD_MS,
  type InstructionPayload,
} from '../RhythmMap'
import { expandTimeline } from '../CueTimeline'
import { bodyWork } from '../../workout/samples/bodyWork'
import { pacePusher } from '../../workout/samples/pacePusher'

const durationFor = (combination: string, cadence: string): number | undefined =>
  combination.includes('-') ? (cadence === 'technical' ? 1600 : 1200) : undefined

const SENTENCE_MS = 2_600
const setupCalloutDurationFor = (asset: string): number | undefined =>
  asset.startsWith('co-') ? SENTENCE_MS : undefined

// A stub that says every block-level instruction has a rendered clip
// with a fixed synthetic module id (17) and fixed duration (1500ms).
const stubInstructionClip = (): { module: number; durationMs: number } => ({
  module: 17,
  durationMs: 1500,
})

const bodyWorkTimeline = expandTimeline(bodyWork, 'orthodox', 100)
const pacePusherTimeline = expandTimeline(pacePusher, 'orthodox', 100)

describe('block-level instructions on the rhythm map', () => {
  it('emits no instruction events when instructionClipFor is absent', () => {
    for (const round of bodyWorkTimeline) {
      const map = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
      expect(map.events.filter((e) => e.kind === 'instruction')).toEqual([])
    }
  })

  it('emits no instruction events when instructionClipFor returns undefined', () => {
    for (const round of bodyWorkTimeline) {
      const map = compileRoundRhythmMap(round, {
        cadence: 'steady',
        durationFor,
        instructionClipFor: () => undefined,
      })
      expect(map.events.filter((e) => e.kind === 'instruction')).toEqual([])
    }
  })

  it('emits ONE instruction event per block set, on the first cue only', () => {
    for (const round of bodyWorkTimeline) {
      const map = compileRoundRhythmMap(round, {
        cadence: 'steady',
        durationFor,
        instructionClipFor: stubInstructionClip,
      })
      const insEvents = map.events.filter((e) => e.kind === 'instruction')
      // Every instruction event's cueId matches a cue with repeatIndex 0.
      for (const ev of insEvents) {
        const cue = round.cues.find((c) => c.id === ev.cueId)
        expect(cue?.repeatIndex).toBe(0)
        expect(cue?.instruction).toBeDefined()
      }
      // No cue with an instruction and repeatIndex > 0 got a re-fire.
      const rerepeats = round.cues.filter(
        (c) => c.repeatIndex > 0 && c.instruction !== undefined,
      )
      const rerepeatIds = new Set(rerepeats.map((c) => c.id))
      const rerepeatIns = insEvents.filter((e) => rerepeatIds.has(e.cueId))
      expect(rerepeatIns).toEqual([])
    }
  })

  it('positions the event at scheduledStartMs + INSTRUCTION_START_PAD_MS', () => {
    for (const round of bodyWorkTimeline) {
      const map = compileRoundRhythmMap(round, {
        cadence: 'steady',
        durationFor,
        instructionClipFor: stubInstructionClip,
      })
      for (const ev of map.events.filter((e) => e.kind === 'instruction')) {
        const cue = round.cues.find((c) => c.id === ev.cueId)
        expect(cue).toBeDefined()
        expect(ev.atMs).toBe(cue!.scheduledStartMs + INSTRUCTION_START_PAD_MS)
      }
    }
  })

  it('carries the exact text + module + durationMs in the payload', () => {
    for (const round of bodyWorkTimeline) {
      const map = compileRoundRhythmMap(round, {
        cadence: 'steady',
        durationFor,
        instructionClipFor: stubInstructionClip,
      })
      for (const ev of map.events.filter((e) => e.kind === 'instruction')) {
        const payload = ev.payload as InstructionPayload
        const cue = round.cues.find((c) => c.id === ev.cueId)
        expect(payload.text).toBe(cue!.instruction)
        expect(payload.module).toBe(17)
        expect(payload.durationMs).toBe(1500)
      }
    }
  })

  it('skips the instruction when a set-callout ceremony is booked on the same cue', () => {
    // pacePusher's open-pressure blocks carry both `instruction` AND a
    // setupCallout ceremony; the compiler must pick the ceremony and
    // suppress the instruction so the block's opening isn't spoken
    // twice.
    for (const round of pacePusherTimeline) {
      const map = compileRoundRhythmMap(round, {
        cadence: 'pressure',
        durationFor,
        setupCalloutDurationFor,
        instructionClipFor: stubInstructionClip,
      })
      const withCeremony = new Set(
        map.events.filter((e) => e.kind === 'set-callout').map((e) => e.cueId),
      )
      const insCueIds = new Set(
        map.events.filter((e) => e.kind === 'instruction').map((e) => e.cueId),
      )
      for (const cueId of insCueIds) {
        expect(withCeremony.has(cueId)).toBe(false)
      }
    }
  })

  it('never moves a call, refire or phase-announce — same sync contract as ceremony', () => {
    for (const round of bodyWorkTimeline) {
      const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
      const on = compileRoundRhythmMap(round, {
        cadence: 'steady',
        durationFor,
        instructionClipFor: stubInstructionClip,
      })
      const times = (m: typeof off): string[] =>
        m.events
          .filter(
            (e) => e.kind === 'call' || e.kind === 'refire' || e.kind === 'phase-announce',
          )
          .map((e) => `${e.kind}:${e.id}@${e.atMs}`)
          .sort()
      expect(times(on)).toEqual(times(off))
    }
  })
})
