/**
 * The click-track maps — MVP v2 Part B (Kyle, 2026-08-31).
 *
 * Every predefined workout rewritten to the 4-slot bar format, coach
 * voice capped at 'minimal' (bells + stance + countdown survive; punch
 * calls belong to the visuals), metronome on everywhere: **the walk is
 * the product, the click is the audio.**
 *
 * ## The measure rule
 *
 * A measure (m) = 4 beats. At rate r a slot = 1/r beat, so a bar of n
 * slots spans n/r beats. The breath (gapBeats) is chosen so each rep's
 * STRIDE is a whole number of measures — Kyle: "based on number of
 * measures, we can cut up into ways to equal our denominator over the
 * right number of repetitions":
 *
 *   4-slot @1x   → 2 m/rep   (bar 4 + breath 4)
 *   4-slot @1.5x → 1 m/rep   (bar 8/3 + breath 4/3)
 *   4-slot @2x   → 1 m/rep   (bar 2 + breath 2)  — double-time under the
 *                              same BPM overlay; the click IS half-time
 *   8-slot @1x   → 3 m/rep   (bar 8 + breath 4)  — two chunks of 4, paged
 *   8-slot @2x   → 1.5 m/rep (bar 4 + breath 2)  — authored even reps
 *
 * Every round's rows sum EXACTLY to its measure budget (240 s of work:
 * beats = BPM × 4, measures = beats / 4). The final breath doubles as
 * the bell margin. `clickMapsSelfCheck` recomputes every sum so a map
 * edit that breaks a denominator fails tests, not a drive.
 *
 * ## Row → BlockSpec
 *
 * Each row lowers to one `repeated-combo` BlockSpec: notation as
 * written ('.' = rest slot), offsets at 1/r-beat spacing, gapBeats =
 * the breath, repeat = reps. No count-scored blocks remain — pumps are
 * `1-1-1-1 ×N`, never `1 ×4N` (Kyle), which also puts every block on
 * the worklet walk.
 */

import { parseCombo } from '../WorkoutTokens'
import type { BlockSpec } from './authoring'

export type ClickRate = 1 | 1.5 | 2

export interface ClickRow {
  /** Bar notation — 4 or 8 segments, '.' for a rest slot. */
  motif: string
  rate: ClickRate
  reps: number
}

export interface ClickRound {
  theme: string
  rows: ClickRow[]
  /** Per-round stance override (switch-by-round). */
  stance?: 'orthodox' | 'southpaw'
}

/** Slots in a row's motif (rest slots count — they hold width and time). */
function slotCount(motif: string): number {
  return motif.split('-').length
}

/** Measures one rep occupies — the stride table above. */
export function measuresPerRep(slots: number, rate: ClickRate): number {
  if (slots === 8) return rate === 1 ? 3 : 1.5
  return rate === 1 ? 2 : 1
}

/** Breath (gapBeats) = stride beats − bar beats. */
export function breathBeats(slots: number, rate: ClickRate): number {
  return measuresPerRep(slots, rate) * 4 - slots / rate
}

/** Measures a whole row occupies. */
export function rowMeasures(row: ClickRow): number {
  return measuresPerRep(slotCount(row.motif), row.rate) * row.reps
}

/** Lower one round's rows to BlockSpecs. */
export function clickSpecs(prefix: string, roundIndex: number, round: ClickRound): BlockSpec[] {
  return round.rows.map((row, i) => {
    const slots = slotCount(row.motif)
    const step = 1 / row.rate
    return {
      id: `${prefix}${roundIndex + 1}-b${i + 1}`,
      kind: 'repeated-combo' as const,
      notation: row.motif,
      offsets: Array.from({ length: slots }, (_, k) => k * step),
      gapBeats: breathBeats(slots, row.rate),
      repeat: row.reps,
      ...(round.stance ? { stance: round.stance } : {}),
    }
  })
}

/**
 * Recompute every round's measure sum against its budget. Returns a list
 * of violations (empty = every denominator resolves). Also validates the
 * notation parses and that 8-slot rows at 2x author even reps.
 */
export function clickMapsSelfCheck(): string[] {
  const problems: string[] = []
  for (const [key, map] of Object.entries(CLICK_MAPS)) {
    const budget = (map.bpm * 4) / 4 // beats per 240s round / beats per measure
    map.rounds.forEach((round, r) => {
      let sum = 0
      for (const row of round.rows) {
        const slots = slotCount(row.motif)
        if (slots !== 4 && slots !== 8) {
          problems.push(`${key} R${r + 1} '${row.motif}': ${slots} slots (must be 4 or 8)`)
        }
        if (slots === 8 && row.rate === 2 && row.reps % 2 !== 0) {
          problems.push(`${key} R${r + 1} '${row.motif}': 8-slot @2x needs even reps`)
        }
        if (row.rate === 1.5 && slots === 8) {
          problems.push(`${key} R${r + 1} '${row.motif}': 8-slot @1.5x not in the stride table`)
        }
        try {
          parseCombo(row.motif)
        } catch (e) {
          problems.push(`${key} R${r + 1} '${row.motif}': ${(e as Error).message}`)
        }
        sum += rowMeasures(row)
      }
      if (sum !== budget) {
        problems.push(`${key} R${r + 1}: ${sum} measures, budget ${budget}`)
      }
    })
  }
  return problems
}

export interface ClickMap {
  bpm: number
  rounds: ClickRound[]
}

/** The plan's B2-MAPS tables, verbatim. */
export const CLICK_MAPS: Record<string, ClickMap> = {
  'three-round-fundamentals': {
    bpm: 120,
    rounds: [
      { theme: 'Find the rhythm', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 10 },
        { motif: '1-2-1-2', rate: 1, reps: 15 },
        { motif: '1-1-2-.', rate: 1, reps: 10 },
        { motif: '1-2-1-2', rate: 2, reps: 20 },
        { motif: '1-2-3-.', rate: 1.5, reps: 15 },
        { motif: '3-2-3-2', rate: 1, reps: 5 },
        { motif: '2-3-2-.', rate: 1.5, reps: 5 },
      ]},
      { theme: 'Stack the pages', rows: [
        { motif: '1-2-1-2-3-2-3-2', rate: 1, reps: 10 },
        { motif: '1-1-1-1', rate: 2, reps: 10 },
        { motif: '2-3-2-.', rate: 1, reps: 15 },
        { motif: '1-2-3-2', rate: 1.5, reps: 20 },
        { motif: '1-4-3-2', rate: 1, reps: 10 },
        { motif: '1-1-1-1', rate: 1.5, reps: 10 },
      ]},
      { theme: 'Put it together', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 20 },
        { motif: '5-2-5-2', rate: 1, reps: 11 },
        { motif: '1-1-1-1', rate: 2, reps: 20 },
        { motif: '1-2-3-.', rate: 1.5, reps: 20 },
        { motif: '1-1-2-3-2-3-2-.', rate: 1, reps: 6 },
      ]},
    ],
  },
  'establish-the-jab-20': {
    bpm: 100,
    rounds: [
      { theme: 'The jab is home', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 15 },
        { motif: '1-1-2-.', rate: 1, reps: 10 },
        { motif: '1-1-1-1', rate: 2, reps: 20 },
        { motif: '1-2-1-1', rate: 1.5, reps: 15 },
        { motif: '1-1-1-1', rate: 1.5, reps: 15 },
      ]},
      { theme: 'Doubling up', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 10 },
        { motif: '1-1-1-1', rate: 2, reps: 20 },
        { motif: '1-1-2-.', rate: 1, reps: 15 },
        { motif: '1-1-1-2', rate: 1.5, reps: 30 },
      ]},
      { theme: 'Jab into the cross', rows: [
        { motif: '1-1-1-1-1-1-2-.', rate: 1, reps: 10 },
        { motif: '1-1-1-1', rate: 2, reps: 30 },
        { motif: '1-2-1-1', rate: 1, reps: 10 },
        { motif: '1-1-2-.', rate: 1.5, reps: 20 },
      ]},
      { theme: 'Own the range', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 20 },
        { motif: '1-1-1-1', rate: 2, reps: 40 },
        { motif: '1-1-2-.', rate: 1.5, reps: 20 },
      ]},
    ],
  },
  'switch-by-round': {
    bpm: 85,
    rounds: [
      { theme: 'Orthodox base', stance: 'orthodox', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 16 },
        { motif: '2-3-2-.', rate: 1, reps: 10 },
        { motif: '1-2-1-2', rate: 2, reps: 16 },
        { motif: '1-2-3-.', rate: 1.5, reps: 17 },
      ]},
      { theme: 'Southpaw mirror', stance: 'southpaw', rows: [
        { motif: '3-2-3-2', rate: 1, reps: 14 },
        { motif: '1-2-1-2', rate: 1.5, reps: 20 },
        { motif: '1-1-2-.', rate: 1, reps: 10 },
        { motif: '2-1-2-1', rate: 2, reps: 17 },
      ]},
      { theme: 'Orthodox pressure', stance: 'orthodox', rows: [
        { motif: '1-2-1-2-2-3-2-.', rate: 1, reps: 9 },
        { motif: '1-2-1-2', rate: 2, reps: 18 },
        { motif: '2-3-2-.', rate: 1, reps: 10 },
        { motif: '3-2-3-.', rate: 1.5, reps: 20 },
      ]},
      { theme: 'Southpaw finish', stance: 'southpaw', rows: [
        { motif: '1-2-3-2', rate: 1, reps: 16 },
        { motif: '2-3-2-3', rate: 1.5, reps: 16 },
        { motif: '1-2-1-2', rate: 1, reps: 8 },
        { motif: '1-1-2-.', rate: 2, reps: 21 },
      ]},
    ],
  },
  'heavy-hands': {
    bpm: 180,
    rounds: [
      { theme: 'Sit down on the cross', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 25 },
        { motif: '3-2-3-2', rate: 1, reps: 20 },
        { motif: '2-3-2-.', rate: 1.5, reps: 30 },
        { motif: '1-2-1-2', rate: 2, reps: 40 },
        { motif: '1-1-2-.', rate: 1, reps: 10 },
      ]},
      { theme: 'Hooks off the cross', rows: [
        { motif: '1-2-3-2-3-2-3-2', rate: 1, reps: 15 },
        { motif: '2-3-2-3', rate: 1.5, reps: 25 },
        { motif: '1-2-1-2', rate: 2, reps: 35 },
        { motif: '3-2-3-.', rate: 1, reps: 20 },
        { motif: '1-1-1-1', rate: 1.5, reps: 35 },
      ]},
      { theme: 'Double up', rows: [
        { motif: '1-2-3-2', rate: 1, reps: 30 },
        { motif: '3-2-3-2', rate: 2, reps: 30 },
        { motif: '2-3-2-.', rate: 1, reps: 30 },
        { motif: '1-2-1-2', rate: 1.5, reps: 30 },
      ]},
      { theme: 'Heavy finish', rows: [
        { motif: '1-1-2-3-2-3-2-.', rate: 1, reps: 20 },
        { motif: '1-2-1-2', rate: 2, reps: 40 },
        { motif: '3-2-3-2', rate: 1, reps: 20 },
        { motif: '2-3-2-.', rate: 1.5, reps: 40 },
      ]},
    ],
  },
  'speed-combos': {
    bpm: 240,
    rounds: [
      { theme: 'Fast hands', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 30 },
        { motif: '1-1-2-.', rate: 1.5, reps: 40 },
        { motif: '1-2-1-2', rate: 2, reps: 60 },
        { motif: '2-3-2-.', rate: 2, reps: 40 },
        { motif: '1-1-1-1', rate: 1, reps: 20 },
      ]},
      { theme: 'Doubles at pace', rows: [
        { motif: '1-2-1-2-1-1-2-.', rate: 1, reps: 20 },
        { motif: '1-2-1-2', rate: 2, reps: 80 },
        { motif: '1-1-1-1', rate: 1.5, reps: 40 },
        { motif: '2-1-2-1', rate: 1, reps: 30 },
      ]},
      { theme: 'Pages at speed', rows: [
        { motif: '1-1-1-1', rate: 2, reps: 40 },
        { motif: '1-2-1-2', rate: 1, reps: 40 },
        { motif: '1-2-3-.', rate: 1.5, reps: 60 },
        { motif: '1-2-1-2-2-3-2-.', rate: 2, reps: 20 },
        { motif: '1-1-2-.', rate: 2, reps: 30 },
      ]},
      { theme: 'Empty the tank', rows: [
        { motif: '1-2-1-2', rate: 2, reps: 50 },
        { motif: '1-1-2-.', rate: 1.5, reps: 50 },
        { motif: '1-2-1-2', rate: 1, reps: 35 },
        { motif: '2-3-2-.', rate: 2, reps: 70 },
      ]},
    ],
  },
  'uppercut-clinic': {
    bpm: 85,
    rounds: [
      { theme: 'Up the middle', rows: [
        { motif: '5-2-5-2', rate: 1, reps: 16 },
        { motif: '1-6-1-6', rate: 1, reps: 10 },
        { motif: '6-5-6-.', rate: 1.5, reps: 16 },
        { motif: '5-2-5-2', rate: 2, reps: 17 },
      ]},
      { theme: 'Uppercut off the jab', rows: [
        { motif: '1-2-5-2', rate: 1, reps: 14 },
        { motif: '5-6-5-6', rate: 1.5, reps: 20 },
        { motif: '2-5-2-.', rate: 1, reps: 10 },
        { motif: '1-6-1-6', rate: 2, reps: 17 },
      ]},
      { theme: 'Pairs and pages', rows: [
        { motif: '5-2-5-2-6-5-6-.', rate: 1, reps: 9 },
        { motif: '5-6-5-6', rate: 2, reps: 18 },
        { motif: '1-6-3-2', rate: 1, reps: 10 },
        { motif: '6-5-6-.', rate: 1.5, reps: 20 },
      ]},
      { theme: 'Clinic finish', rows: [
        { motif: '5-6-5-6', rate: 1, reps: 16 },
        { motif: '1-2-5-6', rate: 1.5, reps: 16 },
        { motif: '6-5-2-.', rate: 1, reps: 8 },
        { motif: '5-2-5-2', rate: 2, reps: 21 },
      ]},
    ],
  },
  'progressive-buildup': {
    bpm: 100,
    rounds: [
      { theme: 'One', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 25 },
        { motif: '1-1-1-1', rate: 1.5, reps: 30 },
        { motif: '1-1-1-1', rate: 2, reps: 20 },
      ]},
      { theme: 'One-two', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 20 },
        { motif: '1-2-.-.', rate: 1, reps: 15 },
        { motif: '1-2-1-2', rate: 1.5, reps: 30 },
      ]},
      { theme: 'One-two-three', rows: [
        { motif: '1-2-3-.', rate: 1, reps: 25 },
        { motif: '1-2-3-2', rate: 1.5, reps: 30 },
        { motif: '1-2-3-.', rate: 2, reps: 20 },
      ]},
      { theme: 'The whole phrase', rows: [
        { motif: '1-2-3-2-1-2-3-.', rate: 1, reps: 10 },
        { motif: '1-2-3-2', rate: 1, reps: 20 },
        { motif: '1-2-3-2-1-2-3-.', rate: 2, reps: 20 },
      ]},
    ],
  },
  'body-work': {
    bpm: 100,
    rounds: [
      { theme: 'Downstairs', rows: [
        { motif: '1-2b-1-2b', rate: 1, reps: 15 },
        { motif: '1b-2b-.-.', rate: 1, reps: 10 },
        { motif: '1-2b-1-2b', rate: 1.5, reps: 30 },
        { motif: '1-1b-2-.', rate: 2, reps: 20 },
      ]},
      { theme: 'Dig to the body', rows: [
        { motif: '2b-3b-2b-.', rate: 1, reps: 15 },
        { motif: '1-2-3b-.', rate: 1.5, reps: 30 },
        { motif: '1b-2b-1b-2b', rate: 2, reps: 20 },
        { motif: '1-2b-3-.', rate: 1, reps: 10 },
      ]},
      { theme: 'Mixing floors', rows: [
        { motif: '1-2b-1-2b-3-2b-3-.', rate: 1, reps: 10 },
        { motif: '2-3b-2-.', rate: 1, reps: 15 },
        { motif: '1-2b-1-2b', rate: 1.5, reps: 20 },
        { motif: '2b-2b-2b-2b', rate: 2, reps: 20 },
      ]},
      { theme: 'Body finish', rows: [
        { motif: '1-2b-3-2b', rate: 1, reps: 20 },
        { motif: '1b-2b-.-.', rate: 1.5, reps: 20 },
        { motif: '1-6-3b-.', rate: 1, reps: 10 },
        { motif: '1-2b-1-2b', rate: 2, reps: 20 },
      ]},
    ],
  },
  'pace-pusher': {
    bpm: 180,
    rounds: [
      { theme: 'The ladder', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 30 },
        { motif: '1-2-1-2', rate: 1.5, reps: 60 },
        { motif: '1-2-1-2', rate: 2, reps: 60 },
      ]},
      { theme: 'Ladder the jab', rows: [
        { motif: '1-1-2-.', rate: 1, reps: 25 },
        { motif: '1-1-2-.', rate: 1.5, reps: 50 },
        { motif: '1-1-2-.', rate: 2, reps: 50 },
        { motif: '1-1-1-1', rate: 1, reps: 15 },
      ]},
      { theme: 'Ladder the hook', rows: [
        { motif: '2-3-2-.', rate: 1, reps: 30 },
        { motif: '2-3-2-3', rate: 1.5, reps: 40 },
        { motif: '2-3-2-3', rate: 2, reps: 40 },
        { motif: '1-2-1-2', rate: 1, reps: 20 },
      ]},
      { theme: 'All rates at once', rows: [
        { motif: '1-2-3-2-3-2-3-2', rate: 1, reps: 12 },
        { motif: '1-2-3-2', rate: 1.5, reps: 36 },
        { motif: '1-2-3-2', rate: 2, reps: 36 },
        { motif: '1-2-1-2', rate: 1.5, reps: 36 },
        { motif: '1-1-1-1', rate: 2, reps: 36 },
      ]},
    ],
  },
  'pump-and-coast': {
    bpm: 100,
    rounds: [
      { theme: 'Pump, then breathe', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 10 },
        { motif: '1-.-.-.', rate: 1, reps: 10 },
        { motif: '2-2-2-2', rate: 2, reps: 10 },
        { motif: '1-.-2-.', rate: 1, reps: 15 },
        { motif: '1-1-1-1', rate: 1.5, reps: 20 },
      ]},
      { theme: 'Coast is a choice', rows: [
        { motif: '1-1-1-1', rate: 2, reps: 15 },
        { motif: '1-.-.-.', rate: 1, reps: 15 },
        { motif: '2-2-2-2', rate: 1, reps: 10 },
        { motif: '1-2-.-.', rate: 1, reps: 10 },
        { motif: '1-1-2-.', rate: 1.5, reps: 15 },
      ]},
      { theme: 'Two-page pump', rows: [
        { motif: '1-1-1-1-2-2-2-2', rate: 1, reps: 10 },
        { motif: '1-.-2-.', rate: 1, reps: 10 },
        { motif: '1-1-1-1', rate: 2, reps: 30 },
        { motif: '1-2-.-.', rate: 1.5, reps: 20 },
      ]},
      { theme: 'Big pump home', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 20 },
        { motif: '1-.-.-.', rate: 1, reps: 10 },
        { motif: '1-1-1-1', rate: 2, reps: 20 },
        { motif: '1-1-1-1', rate: 1.5, reps: 20 },
      ]},
    ],
  },
}
