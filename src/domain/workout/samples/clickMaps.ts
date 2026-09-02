/**
 * The click-track maps — Script Bible v2 (Kyle, 2026-09-01).
 *
 * Every predefined workout in the 4-slot bar format, refreshed for
 * beginner-to-intermediate bag work: clearer progression, more body/head
 * level changes, less single-strike filler. Durations, BPM, round
 * counts, per-round measure totals, section counts (164) and rest count
 * (29) are all preserved from v1.
 *
 * New in v2: every row carries its AUTHORED spoken lead-in (`leadIn`) and
 * every non-final round its authored rest script (`rest`) — bespoke
 * coaching copy, no longer template-derived. Numerals in spoken copy are
 * spelled out ("ten bars") so the script bible's text IS the rendered
 * clip's text (the settled doc==clip invariant). Walkouts are NOT here —
 * they live in the generator and are unchanged (Kyle: keep as-is; the
 * refactor shows only after the bell).
 *
 * ## The measure rule
 *
 * A measure (m) = 4 beats. At rate r a slot = 1/r beat, so a bar of n
 * slots spans n/r beats. The breath (gapBeats) is chosen so each rep's
 * STRIDE is a whole number of measures:
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
  /** Authored spoken lead-in for this section (numerals spelled out). */
  leadIn: string
}

export interface ClickRound {
  theme: string
  rows: ClickRow[]
  /** Per-round stance override (switch-by-round). */
  stance?: 'orthodox' | 'southpaw'
  /** Authored rest script for the rest AFTER this round; absent on last rounds. */
  rest?: string
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

/**
 * Setup pause before every section after a round's first (Kyle, on-glass
 * 2026-09-02): full measures on the SAME click with no tokens, so the
 * coach's lead-in has authored breathing room instead of fighting the
 * previous section's bars. Combined with the outgoing bar's trailing
 * breath this clears ~6-9 s per transition. Round openers need none —
 * they are voiced PRE-BELL.
 */
export const SETUP_GAP_MEASURES = 2

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
      ...(i > 0 ? { leadInBeats: SETUP_GAP_MEASURES * 4 } : {}),
      ...(round.stance ? { stance: round.stance } : {}),
    }
  })
}

/**
 * Achievability ceilings (Kyle, on-glass 2026-09-01: speed-combos at 240
 * was "double an achievable pace"). BURST caps the instantaneous rate of
 * adjacent punches (interval ≥ 250 ms); SUSTAINED caps a full rep
 * averaged over its stride, breath included. Beginner-to-intermediate
 * bag work — the bible's stated audience.
 */
export const MAX_BURST_PUNCHES_PER_SEC = 4
export const MAX_SUSTAINED_PUNCHES_PER_SEC = 2.5

/**
 * Recompute every round's measure sum against its budget. Returns a list
 * of violations (empty = every denominator resolves). Also validates the
 * notation parses, 8-slot rows at 2x author even reps, every row carries
 * authored spoken copy, every non-final round carries a rest script, and
 * every row sits under the achievability ceilings above.
 */
export function clickMapsSelfCheck(): string[] {
  const problems: string[] = []
  for (const [key, map] of Object.entries(CLICK_MAPS)) {
    const budget = (map.bpm * 4) / 4 // beats per 240s round / beats per measure
    map.rounds.forEach((round, r) => {
      let sum = 0
      const isLast = r === map.rounds.length - 1
      if (!isLast && !round.rest) {
        problems.push(`${key} R${r + 1}: missing rest script (not the last round)`)
      }
      if (isLast && round.rest) {
        problems.push(`${key} R${r + 1}: rest script on the last round (no rest follows)`)
      }
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
        if (!row.leadIn.trim()) {
          problems.push(`${key} R${r + 1} '${row.motif}': empty leadIn`)
        }
        if (/\d/.test(row.leadIn)) {
          problems.push(`${key} R${r + 1} '${row.motif}': digits in spoken leadIn (spell them out)`)
        }
        try {
          parseCombo(row.motif)
        } catch (e) {
          problems.push(`${key} R${r + 1} '${row.motif}': ${(e as Error).message}`)
        }
        // Pace lint. Slot duration = 60/(bpm×rate) s; burst rate between
        // consecutive punches g slots apart = bpm×rate/(60×g).
        const tokens = row.motif.split('-')
        const punchSlots = tokens
          .map((t, idx) => (t === '.' ? -1 : idx))
          .filter((idx) => idx >= 0)
        let minGapSlots = Infinity
        for (let p = 1; p < punchSlots.length; p += 1) {
          minGapSlots = Math.min(minGapSlots, punchSlots[p]! - punchSlots[p - 1]!)
        }
        if (Number.isFinite(minGapSlots)) {
          const burstPerSec = (map.bpm * row.rate) / (60 * minGapSlots)
          if (burstPerSec > MAX_BURST_PUNCHES_PER_SEC + 1e-9) {
            problems.push(
              `${key} R${r + 1} '${row.motif}' @${row.rate}x: burst ${burstPerSec.toFixed(2)}/s > ${MAX_BURST_PUNCHES_PER_SEC}/s at ${map.bpm} BPM`,
            )
          }
        }
        const strideSec = (measuresPerRep(slots, row.rate) * 4 * 60) / map.bpm
        const sustainedPerSec = punchSlots.length / strideSec
        if (sustainedPerSec > MAX_SUSTAINED_PUNCHES_PER_SEC + 1e-9) {
          problems.push(
            `${key} R${r + 1} '${row.motif}' @${row.rate}x: sustained ${sustainedPerSec.toFixed(2)}/s > ${MAX_SUSTAINED_PUNCHES_PER_SEC}/s at ${map.bpm} BPM`,
          )
        }
        sum += rowMeasures(row)
      }
      if (round.rest && /\d/.test(round.rest)) {
        problems.push(`${key} R${r + 1}: digits in spoken rest script (spell them out)`)
      }
      // Budget now includes the setup pauses: rows + 2 measures per
      // section transition must land EXACTLY on the round's measures.
      const gaps = SETUP_GAP_MEASURES * Math.max(0, round.rows.length - 1)
      if (sum + gaps !== budget) {
        problems.push(
          `${key} R${r + 1}: ${sum} row measures + ${gaps} setup-gap measures = ${sum + gaps}, budget ${budget}`,
        )
      }
    })
  }
  return problems
}

export interface ClickMap {
  bpm: number
  rounds: ClickRound[]
}

/** Script Bible v2 tables, verbatim (spoken numerals spelled out). */
export const CLICK_MAPS: Record<string, ClickMap> = {
  'three-round-fundamentals': {
    bpm: 120,
    rounds: [
      { theme: 'Build the base', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 9, leadIn: 'Pump: ones only, straight time — nine bars. Set the range. Every one comes home.' },
        { motif: '1-2-1-2', rate: 1, reps: 13, leadIn: 'One, two, one, two — straight time, thirteen bars. Loose shoulders. Let the two arrive behind the one.' },
        { motif: '1-1-2-.', rate: 1, reps: 9, leadIn: 'One, one, two — straight time, nine bars. Leave the fourth slot open. Reset there.' },
        { motif: '1-2-1-.', rate: 2, reps: 18, leadIn: 'One, two, one — double-time, eighteen bars. Three quick shots, then clear the page.' },
        { motif: '1-2-3-.', rate: 1.5, reps: 13, leadIn: 'One, two, three — time-and-a-half, thirteen bars. Turn the three and take the empty slot.' },
        { motif: '3-2-3-2', rate: 1, reps: 5, leadIn: 'Three, two, three, two — straight time, five bars. Short and balanced. Finish each pair back in guard.' },
        { motif: '1-3-2-.', rate: 1.5, reps: 5, leadIn: 'One, three, two — time-and-a-half, five bars. One, three, two. Let the last two land together.' },
      ], rest: 'Good first round. Let the arms hang for a breath, then bring the hands back home. Round two changes levels: first set is one, two, one, two — then one-bee, two, three, two on page two. Stay loose and be ready on the bell.' },
      { theme: 'Change levels', rows: [
        { motif: '1-2-1-2-1b-2-3-2', rate: 1, reps: 9, leadIn: 'Big phrase — two pages: one, two, one, two, one-bee, two, three, two. Straight time, nine times through. Page one stays upstairs. Page two drops the one-bee, then comes right back up.' },
        { motif: '1b-1b-1b-1b', rate: 2, reps: 9, leadIn: 'Pump: one-bees only, double-time — nine bars. Touch the body and get the hand straight back.' },
        { motif: '1-2b-3-.', rate: 1, reps: 14, leadIn: 'One, two-bee, three — straight time, fourteen bars. One, two-bee, three. Leave the last slot empty.' },
        { motif: '1-2-3-2', rate: 1.5, reps: 18, leadIn: 'One, two, three, two — time-and-a-half, eighteen bars. Four clean beats. Do not rush the three.' },
        { motif: '1-4-2-3', rate: 1, reps: 9, leadIn: 'One, four, two, three — straight time, nine bars. Trace the square: one, four, two, three.' },
        { motif: '1b-2-1-2', rate: 1.5, reps: 10, leadIn: 'One-bee, two, one, two — time-and-a-half, ten bars. Start low, finish high. Keep the rhythm even.' },
      ], rest: 'That round added the floor change. Take two slow breaths and shake out the shoulders. Last round puts the pieces together; first set is one, two, three, two in straight time. Hear the four-count before the bell.' },
      { theme: 'Put it together', rows: [
        { motif: '1-2-3-2', rate: 1, reps: 18, leadIn: 'One, two, three, two — straight time, eighteen bars. This is your home combination. Smooth first, strong finish.' },
        { motif: '1-5-2-3', rate: 1, reps: 10, leadIn: 'One, five, two, three — straight time, ten bars. Bring the five up the middle, then turn the three.' },
        { motif: '1-1-2-.', rate: 2, reps: 18, leadIn: 'One, one, two — double-time, eighteen bars. Fast double one into two. Fourth slot is your reset.' },
        { motif: '1-6-3-.', rate: 1.5, reps: 20, leadIn: 'One, six, three — time-and-a-half, twenty bars. One, six, three. Stay compact and breathe on the empty slot.' },
        { motif: '1-1-2-3-2-5-2-.', rate: 1, reps: 6, leadIn: 'Big phrase — two pages: one, one, two, three, two, five, two, breathe. Straight time, six times through. Page one builds the entry. Page two finishes two, five, two, then breathe.' },
      ]},
    ],
  },
  'establish-the-jab-20': {
    bpm: 100,
    rounds: [
      { theme: 'The jab is home', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 13, leadIn: 'Pump: ones only, straight time — thirteen bars. Touch, recover, touch again. No reaching.' },
        { motif: '1-1-2-.', rate: 1, reps: 9, leadIn: 'One, one, two — straight time, nine bars. Double one, then two. Fourth slot is quiet.' },
        { motif: '1b-1b-1b-1b', rate: 2, reps: 18, leadIn: 'Long set: one-bees only, double-time — eighteen bars. Same lead hand, lower target. Keep your eyes up.' },
        { motif: '1-2-1-3', rate: 1.5, reps: 15, leadIn: 'One, two, one, three — time-and-a-half, fifteen bars. The one comes back before the three turns.' },
        { motif: '1-1-1-1', rate: 1.5, reps: 15, leadIn: 'Pump: ones only, time-and-a-half — fifteen bars. Finish the round owning the lead hand. Crisp, not tense.' },
      ], rest: 'Good. You found the lead hand upstairs and downstairs. Next round doubles it and starts turning the corner. First set is one, one, two, three in straight time. Roll the shoulders once and meet the bell ready.' },
      { theme: 'Double and angle', rows: [
        { motif: '1-1-2-3', rate: 1, reps: 9, leadIn: 'One, one, two, three — straight time, nine bars. Two ones open the door. Two, three closes it.' },
        { motif: '1-1-2-.', rate: 2, reps: 18, leadIn: 'One, one, two — double-time, eighteen bars. Quick double one, two, then an empty slot.' },
        { motif: '1b-1-2-.', rate: 1, reps: 14, leadIn: 'One-bee, one, two — straight time, fourteen bars. Low one, high one, two. Reset on four.' },
        { motif: '1-1-3-2', rate: 1.5, reps: 30, leadIn: 'One, one, three, two — time-and-a-half, thirty bars. Double one, three, two. Keep the feet underneath you.' },
      ], rest: 'The jab is starting to create openings now. Breathe out long and let the forearms relax. Round three mixes head and body: two pages starting one, one, two, one-bee. Keep the lead hand busy without getting stiff.' },
      { theme: 'Jab to body and head', rows: [
        { motif: '1-1-2-1b-1-2-3-.', rate: 1, reps: 9, leadIn: 'Big phrase — two pages: one, one, two, one-bee, one, two, three, breathe. Straight time, nine times through. Page one ends downstairs. Page two climbs back up one, two, three, then breathe.' },
        { motif: '1b-1b-1b-1b', rate: 2, reps: 29, leadIn: 'Long set: one-bees only, double-time — twenty-nine bars. Fast body ones. Small bend, fast return.' },
        { motif: '1-2-1b-2', rate: 1, reps: 10, leadIn: 'One, two, one-bee, two — straight time, ten bars. High, high, low, high. Keep every line straight.' },
        { motif: '1-1-2-.', rate: 1.5, reps: 18, leadIn: 'One, one, two — time-and-a-half, eighteen bars. Double one, two, breathe. Same rhythm every time.' },
      ], rest: 'Three rounds in, the jab should feel like a steering wheel. Last round is range control. First set is ones only in straight time; after that we speed the double one into two. Take a sip if you want it, then hands home.' },
      { theme: 'Own the range', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 19, leadIn: 'Long set: ones only, straight time — nineteen bars. Long, clean ones. Make the bag meet the end of the punch.' },
        { motif: '1-1-2-.', rate: 2, reps: 40, leadIn: 'One, one, two — double-time, forty bars. Double one, two, reset. Fast hands without falling in.' },
        { motif: '1b-1-2-.', rate: 1.5, reps: 18, leadIn: 'One-bee, one, two — time-and-a-half, eighteen bars. Finish low-high-high. Leave the fourth slot empty and finish balanced.' },
      ]},
    ],
  },
  'switch-by-round': {
    bpm: 85,
    rounds: [
      { theme: 'Orthodox base', stance: 'orthodox', rows: [
        { motif: '1-2-3-2', rate: 1, reps: 15, leadIn: 'One, two, three, two — straight time, fifteen bars. Build it from the lead side and finish behind the rear hand.' },
        { motif: '1-1-2-.', rate: 1, reps: 8, leadIn: 'One, one, two — straight time, eight bars. Double one, two. Fourth slot is your stance check.' },
        { motif: '1-2-3-.', rate: 2, reps: 16, leadIn: 'One, two, three — double-time, sixteen bars. Three quick shots. Stop clean before the next bar.' },
        { motif: '1-2b-3-.', rate: 1.5, reps: 17, leadIn: 'One, two-bee, three — time-and-a-half, seventeen bars. One upstairs, two-bee downstairs, three back upstairs.' },
      ], rest: 'Orthodox round is banked. Square up for a moment, breathe, then put the right foot forward for southpaw. The numbers do not change. First set is still one, two, three, two — make the mirror feel just as honest.' },
      { theme: 'Southpaw mirror', stance: 'southpaw', rows: [
        { motif: '1-2-3-2', rate: 1, reps: 13, leadIn: 'One, two, three, two — straight time, thirteen bars. Same four numbers, new stance. Do not let the rear foot trail.' },
        { motif: '1-1-2-3', rate: 1.5, reps: 18, leadIn: 'One, one, two, three — time-and-a-half, eighteen bars. Double one, two, three. Let the stance do the work.' },
        { motif: '1b-1-2-.', rate: 1, reps: 9, leadIn: 'One-bee, one, two — straight time, nine bars. Body one, head one, two. Reset your base on four.' },
        { motif: '1-2-3-.', rate: 2, reps: 17, leadIn: 'One, two, three — double-time, seventeen bars. Fast one, two, three. Stay centered when the speed rises.' },
      ], rest: 'Good mirror round. Switch back to orthodox and let the hips settle before the bell. Pressure round next: two pages beginning one, two, three, two. Page two changes level and keeps the same lead-rear logic.' },
      { theme: 'Orthodox pressure', stance: 'orthodox', rows: [
        { motif: '1-2-3-2-1b-2-3-.', rate: 1, reps: 8, leadIn: 'Big phrase — two pages: one, two, three, two, one-bee, two, three, breathe. Straight time, eight times through. Page one is the clean four. Page two goes body one, two, three, then breathe.' },
        { motif: '1-1-2-.', rate: 2, reps: 17, leadIn: 'One, one, two — double-time, seventeen bars. Double one, two. Quick burst, clean stop.' },
        { motif: '2-3-2-.', rate: 1, reps: 9, leadIn: 'Two, three, two — straight time, nine bars. Two, three, two. Compact and balanced.' },
        { motif: '1-6-3-.', rate: 1.5, reps: 20, leadIn: 'One, six, three — time-and-a-half, twenty bars. One, six, three. Let the six rise, then turn the three.' },
      ], rest: 'One more stance change. Southpaw for the finish. First set is one, two, three, two in straight time, then we add the square and the uppercut entry. Take one slow breath in, long breath out, and set the feet.' },
      { theme: 'Southpaw finish', stance: 'southpaw', rows: [
        { motif: '1-2-3-2', rate: 1, reps: 14, leadIn: 'One, two, three, two — straight time, fourteen bars. Own the familiar four from the opposite stance.' },
        { motif: '1-4-2-3', rate: 1.5, reps: 14, leadIn: 'One, four, two, three — time-and-a-half, fourteen bars. One, four, two, three. Trace the square without crossing the feet.' },
        { motif: '1-2-5-2', rate: 1, reps: 8, leadIn: 'One, two, five, two — straight time, eight bars. One, two, five, two. Short five, straight finish.' },
        { motif: '1-1-2-.', rate: 2, reps: 21, leadIn: 'One, one, two — double-time, twenty-one bars. Double one, two, breathe. Finish fast and disciplined.' },
      ]},
    ],
  },
  'heavy-hands': {
    // 180 → 120 (Kyle, 2026-09-01 pace sweep): 180 put double-time bursts at
    // 6 punches/s — heavy shots at sprint spacing is a contradiction. At 120
    // the same rows sit down: 2/s straight, 4/s short bursts.
    bpm: 120,
    rounds: [
      { theme: 'Build the power line', rows: [
        { motif: '1-2-3-.', rate: 1, reps: 15, leadIn: 'One, two, three — straight time, fifteen bars. One, two, three. Give the power room to land, then reset.' },
        { motif: '1-2-3-2', rate: 1, reps: 12, leadIn: 'One, two, three, two — straight time, twelve bars. One, two, three, two. Stay heavy without getting slow.' },
        { motif: '2-3-2-.', rate: 1.5, reps: 18, leadIn: 'Two, three, two — time-and-a-half, eighteen bars. Two, three, two. Sit down, then get back under yourself.' },
        { motif: '1-2-3-.', rate: 2, reps: 26, leadIn: 'One, two, three — double-time, twenty-six bars. Three fast power shots, one empty slot. Do not chase the bag.' },
        { motif: '1-1-2-.', rate: 1, reps: 7, leadIn: 'One, one, two — straight time, seven bars. Double one, two. Finish the round behind the straight shot.' },
      ], rest: 'Good power round. Heavy does not mean tight — open the hands inside the gloves and breathe. Next is hooks off the straight line. First set is two pages: one, two, three, two; then one, four, three, two.' },
      { theme: 'Hooks off the line', rows: [
        { motif: '1-2-3-2-1-4-3-2', rate: 1, reps: 9, leadIn: 'Big phrase — two pages: one, two, three, two, one, four, three, two. Straight time, nine times through. Page one finishes three, two. Page two brings the four before the three-two.' },
        { motif: '1-4-3-2', rate: 1.5, reps: 15, leadIn: 'One, four, three, two — time-and-a-half, fifteen bars. One, four, three, two. Turn the threes and fours; do not swing them.' },
        { motif: '1-2-3-.', rate: 2, reps: 22, leadIn: 'One, two, three — double-time, twenty-two bars. Fast one, two, three, then space. Power stays organized.' },
        { motif: '3-2-3-.', rate: 1, reps: 12, leadIn: 'Three, two, three — straight time, twelve bars. Three, two, three. Keep the threes short and bring the two straight home.' },
        { motif: '1-3-2-.', rate: 1.5, reps: 24, leadIn: 'One, three, two — time-and-a-half, twenty-four bars. One, three, two. Turn the corner and finish through the middle.' },
      ], rest: 'That was the hook round. Let the shoulders drop and breathe through the nose if you can. Round three adds uppercuts to the heavy combinations. First set stays one, two, three, two — then we bring the five into the finish.' },
      { theme: 'Power in layers', rows: [
        { motif: '1-2-3-2', rate: 1, reps: 18, leadIn: 'One, two, three, two — straight time, eighteen bars. Four strong shots, same shape every rep.' },
        { motif: '3-2-3-.', rate: 2, reps: 20, leadIn: 'Three, two, three — double-time, twenty bars. Three, two, three. Quick power, then settle.' },
        { motif: '2-3-2-.', rate: 1, reps: 19, leadIn: 'Two, three, two — straight time, nineteen bars. Two, three, two. Keep the chin behind the shoulders.' },
        { motif: '1-2-5-2', rate: 1.5, reps: 20, leadIn: 'One, two, five, two — time-and-a-half, twenty bars. One, two, five, two. Drive the five short and finish straight.' },
      ], rest: 'Three done. Shake the arms once and let them get heavy again. Final round starts with a seven-shot two-page chain: one, one, two, three; then two, five, two, breathe. Build pressure without losing form.' },
      { theme: 'Heavy finish', rows: [
        { motif: '1-1-2-3-2-5-2-.', rate: 1, reps: 12, leadIn: 'Big phrase — two pages: one, one, two, three, two, five, two, breathe. Straight time, twelve times through. Page one gets you in. Page two is two, five, two, then breathe.' },
        { motif: '1-2-3-.', rate: 2, reps: 26, leadIn: 'One, two, three — double-time, twenty-six bars. Fast one, two, three. Leave the fourth slot for balance.' },
        { motif: '1-4-3-2', rate: 1, reps: 13, leadIn: 'One, four, three, two — straight time, thirteen bars. Square it up: one, four, three, two. Heavy and compact.' },
        { motif: '2-3-2-.', rate: 1.5, reps: 26, leadIn: 'Two, three, two — time-and-a-half, twenty-six bars. Two, three, two. Keep landing clean until the bell.' },
      ]},
    ],
  },
  'speed-combos': {
    // 240 → 120 (Kyle, on-glass 2026-09-01): "this round is incredibly fast,
    // I think we've done double an achievable pace" — 240 @1x was 4 punches/s
    // SUSTAINED and @2x 8/s. At 120 the same shapes run 2/s straight with
    // 4/s double-time bursts; speed now lives in the bursts, not the grid.
    bpm: 120,
    rounds: [
      { theme: 'Fast hands, clean stops', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 14, leadIn: 'One, two, one, two — straight time, fourteen bars. Fast does not mean wild. Four straight slots and back to guard.' },
        { motif: '1-1-2-.', rate: 1.5, reps: 18, leadIn: 'One, one, two — time-and-a-half, eighteen bars. Double one, two, empty fourth slot. Let the reset stay visible.' },
        { motif: '1-2-.-.', rate: 2, reps: 28, leadIn: 'Coast bar — one, two, empty, empty, double-time, twenty-eight bars. One, two, then two empty slots. Speed lives inside the pair.' },
        { motif: '2-3-2-.', rate: 2, reps: 18, leadIn: 'Two, three, two — double-time, eighteen bars. Two, three, two. Three fast hits, then clear the page.' },
        { motif: '1-1-1-1', rate: 1, reps: 10, leadIn: 'Long set: ones only, straight time — ten bars. Finish with fast clean ones. No reaching.' },
      ], rest: 'Good speed, now let the hands loosen. Next round is doubles at pace. First set is two pages: one, one, two, one; then two, three, two, breathe. The empty slots matter just as much as the fast ones.' },
      { theme: 'Doubles at pace', rows: [
        { motif: '1-1-2-1-2-3-2-.', rate: 1, reps: 10, leadIn: 'Big phrase — two pages: one, one, two, one, two, three, two, breathe. Straight time, ten times through. Page one doubles the lead and reloads it. Page two finishes two, three, two, then breathe.' },
        { motif: '1-1-2-.', rate: 2, reps: 36, leadIn: 'One, one, two — double-time, thirty-six bars. Double one, two. One slot off, then do it again.' },
        { motif: '1b-1-2-.', rate: 1.5, reps: 18, leadIn: 'One-bee, one, two — time-and-a-half, eighteen bars. Body one, head one, two. Fast level change, clean exit.' },
        { motif: '1-2-3-2', rate: 1, reps: 15, leadIn: 'One, two, three, two — straight time, fifteen bars. One, two, three, two. Let the four-count breathe even at speed.' },
      ], rest: 'Two rounds down. Drop the shoulders and slow your breathing. Round three makes you read longer pages at speed. First up is double one, two with the fourth slot open; then the one-two-three-two comes back in straight time.' },
      { theme: 'Pages at speed', rows: [
        { motif: '1-1-2-.', rate: 2, reps: 18, leadIn: 'One, one, two — double-time, eighteen bars. Quick double one, two. Stop on the empty slot.' },
        { motif: '1-2-3-2', rate: 1, reps: 19, leadIn: 'One, two, three, two — straight time, nineteen bars. Four clean slots. Make speed look calm.' },
        { motif: '1-2-3-.', rate: 1.5, reps: 27, leadIn: 'One, two, three — time-and-a-half, twenty-seven bars. One, two, three, breathe. Keep the three compact.' },
        { motif: '1-2-1-2-3-2-.-.', rate: 2, reps: 10, leadIn: 'Big phrase — two pages: one, two, one, two, three, two, breathe, breathe. Double-time, ten times through. Page one is four straight slots. Page two is three, two, then two empty slots.' },
        { motif: '1-1-2-.', rate: 2, reps: 14, leadIn: 'One, one, two — double-time, fourteen bars. Double one, two, reset. Stay sharp late.' },
      ], rest: 'Last round coming. You do not need to outrun the click; you need to own the openings. First set is one, two, three with the fourth slot empty at double-time. Then we change the shape without changing the discipline.' },
      { theme: 'Empty the tank cleanly', rows: [
        { motif: '1-2-3-.', rate: 2, reps: 24, leadIn: 'One, two, three — double-time, twenty-four bars. One, two, three, stop. Fast burst, clean recovery.' },
        { motif: '1-1-2-.', rate: 1.5, reps: 24, leadIn: 'One, one, two — time-and-a-half, twenty-four bars. Double one, two. Keep the lead hand alive.' },
        { motif: '1-2-5-2', rate: 1, reps: 17, leadIn: 'One, two, five, two — straight time, seventeen bars. One, two, five, two. Speed up the hands, not the posture.' },
        { motif: '2-3-2-.', rate: 2, reps: 32, leadIn: 'Two, three, two — double-time, thirty-two bars. Two, three, two, empty slot. Last push — stay accurate.' },
      ]},
    ],
  },
  'uppercut-clinic': {
    bpm: 85,
    rounds: [
      { theme: 'Find the short line', rows: [
        { motif: '1-2-5-2', rate: 1, reps: 15, leadIn: 'One, two, five, two — straight time, fifteen bars. One, two, five, two. Keep the five short.' },
        { motif: '1-6-3-2', rate: 1, reps: 8, leadIn: 'One, six, three, two — straight time, eight bars. One, six, three, two. Rise through the six, turn the three.' },
        { motif: '5-6-5-.', rate: 1.5, reps: 16, leadIn: 'Five, six, five — time-and-a-half, sixteen bars. Five, six, five. Three short shots and a reset.' },
        { motif: '1-5-2-.', rate: 2, reps: 17, leadIn: 'One, five, two — double-time, seventeen bars. One, five, two. Fast and compact, then stop.' },
      ], rest: 'Good. The uppercuts should feel short, not scooped. Next round brings the body into the same lines. First set is one, two, five, two; after that the five-bee starts showing up. Breathe and keep the elbows close.' },
      { theme: 'Change the level', rows: [
        { motif: '1-2-5-2', rate: 1, reps: 13, leadIn: 'One, two, five, two — straight time, thirteen bars. Same home combination. Let the five split the straight shots.' },
        { motif: '1-2-5b-2', rate: 1.5, reps: 18, leadIn: 'One, two, five-bee, two — time-and-a-half, eighteen bars. One, two, five-bee, two. Small level change, fast finish.' },
        { motif: '2-5-2-.', rate: 1, reps: 9, leadIn: 'Two, five, two — straight time, nine bars. Two, five, two. Stay over the knees.' },
        { motif: '1-6-3-.', rate: 2, reps: 17, leadIn: 'One, six, three — double-time, seventeen bars. One, six, three. Quick up the middle and around the side.' },
      ], rest: 'Now you have the head and body uppercut lines. Round three turns them into longer phrases. First set is two pages: one, two, five-bee, two; then one, six-bee, three, breathe. Keep the punches short enough to repeat.' },
      { theme: 'Pairs and pages', rows: [
        { motif: '1-2-5b-2-1-6b-3-.', rate: 1, reps: 8, leadIn: 'Big phrase — two pages: one, two, five-bee, two, one, six-bee, three, breathe. Straight time, eight times through. Page one works the five-bee. Page two works the six-bee into three, then breathe.' },
        { motif: '5-6-3-.', rate: 2, reps: 17, leadIn: 'Five, six, three — double-time, seventeen bars. Five, six, three. Tight burst, clean reset.' },
        { motif: '1-6-3-2', rate: 1, reps: 9, leadIn: 'One, six, three, two — straight time, nine bars. One, six, three, two. Finish straight.' },
        { motif: '6-5-2-.', rate: 1.5, reps: 20, leadIn: 'Six, five, two — time-and-a-half, twenty bars. Six, five, two. Keep the six and five underneath the shoulders.' },
      ], rest: 'One round left. Let the elbows hang for a breath and loosen the forearms. Clinic finish starts one, two, five, two, then one, six-bee, three, two. Short punches, strong posture, ready on the bell.' },
      { theme: 'Clinic finish', rows: [
        { motif: '1-2-5-2', rate: 1, reps: 14, leadIn: 'One, two, five, two — straight time, fourteen bars. One, two, five, two. Make it automatic.' },
        { motif: '1-6b-3-2', rate: 1.5, reps: 14, leadIn: 'One, six-bee, three, two — time-and-a-half, fourteen bars. One, six-bee, three, two. Body to head without standing tall.' },
        { motif: '2-5-2-.', rate: 1, reps: 8, leadIn: 'Two, five, two — straight time, eight bars. Two, five, two. Three compact shots.' },
        { motif: '5-2-3-.', rate: 2, reps: 21, leadIn: 'Five, two, three — double-time, twenty-one bars. Five, two, three. Fast finish, then breathe.' },
      ]},
    ],
  },
  'progressive-buildup': {
    bpm: 100,
    rounds: [
      { theme: 'Build the entry', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 24, leadIn: 'Long set: ones only, straight time — twenty-four bars. Start with the one and make every rep look the same.' },
        { motif: '1-1-2-.', rate: 1.5, reps: 28, leadIn: 'One, one, two — time-and-a-half, twenty-eight bars. Now double the one and add the two. Fourth slot stays open.' },
        { motif: '1-1-2-3', rate: 2, reps: 20, leadIn: 'One, one, two, three — double-time, twenty bars. Add the three to the end. Keep the build connected.' },
      ], rest: 'That is the idea: add without losing what came before. Round two starts with one, two, one, two in straight time, then gives you a coast bar to feel the spacing. Breathe easy and remember the shape.' },
      { theme: 'Add the two', rows: [
        { motif: '1-2-1-2', rate: 1, reps: 18, leadIn: 'One, two, one, two — straight time, eighteen bars. One, two, one, two. Establish the straight rhythm.' },
        { motif: '1-2-.-.', rate: 1, reps: 15, leadIn: 'Coast bar — one, two, empty, empty, straight time, fifteen bars. One, two, then two empty slots. Let the rhythm keep moving while you reset.' },
        { motif: '1-1-2-3', rate: 1.5, reps: 30, leadIn: 'One, one, two, three — time-and-a-half, thirty bars. Double one, two, three. Carry the entry cleanly into the three.' },
      ], rest: 'Good. Now the three becomes part of the chain. First set next round is one, two, three with the fourth slot empty; then we close it with one, two, three, two. Keep building, never scrambling.' },
      { theme: 'Add the three', rows: [
        { motif: '1-2-3-.', rate: 1, reps: 23, leadIn: 'One, two, three — straight time, twenty-three bars. One, two, three, breathe. Own the three-count.' },
        { motif: '1-2-3-2', rate: 1.5, reps: 30, leadIn: 'One, two, three, two — time-and-a-half, thirty bars. Now close it with the two. Same first three, one more finish.' },
        { motif: '1-2-3-.', rate: 2, reps: 20, leadIn: 'One, two, three — double-time, twenty bars. Run the three-count faster, then stop on the empty slot.' },
      ], rest: 'Last round is where the pieces become phrases. First two-page set is one, two, three, two; then one, two, five, breathe. After that the square shows up. Take a breath and see the pages before the bell.' },
      { theme: 'Build the chain', rows: [
        { motif: '1-2-3-2-1-2-5-.', rate: 1, reps: 10, leadIn: 'Big phrase — two pages: one, two, three, two, one, two, five, breathe. Straight time, ten times through. Page one is the familiar four. Page two keeps one, two and changes the finish to five.' },
        { motif: '1-4-2-3', rate: 1, reps: 18, leadIn: 'One, four, two, three — straight time, eighteen bars. Trace the square: one, four, two, three. New shape, same calm rhythm.' },
        { motif: '1-2-3-2-1-6-3-.', rate: 2, reps: 20, leadIn: 'Big phrase — two pages: one, two, three, two, one, six, three, breathe. Double-time, twenty times through. Page one is one, two, three, two. Page two is one, six, three, breathe. Finish the build strong.' },
      ]},
    ],
  },
  'body-work': {
    bpm: 100,
    rounds: [
      { theme: 'Find the downstairs line', rows: [
        { motif: '1-2b-1-2b', rate: 1, reps: 13, leadIn: 'One, two-bee, one, two-bee — straight time, thirteen bars. One, two-bee, one, two-bee. Change level without reaching.' },
        { motif: '1b-2b-.-.', rate: 1, reps: 9, leadIn: 'Coast bar — one-bee, two-bee, empty, empty, straight time, nine bars. One-bee, two-bee, then two empty slots. Come back tall and balanced.' },
        { motif: '1-2b-3b-2', rate: 1.5, reps: 30, leadIn: 'One, two-bee, three-bee, two — time-and-a-half, thirty bars. Head one, body two-bee, body three-bee, head two. Move between floors smoothly.' },
        { motif: '1-1b-2-.', rate: 2, reps: 20, leadIn: 'One, one-bee, two — double-time, twenty bars. One, one-bee, two. Quick level change, then reset.' },
      ], rest: 'Good body work starts with your balance, not with reaching down. Round two digs deeper: first set is two-bee, three-bee, two-bee with the fourth slot open. Keep the elbows close and take a drink only if you need it.' },
      { theme: 'Dig and come back up', rows: [
        { motif: '2b-3b-2b-.', rate: 1, reps: 14, leadIn: 'Two-bee, three-bee, two-bee — straight time, fourteen bars. Two-bee, three-bee, two-bee. Stay compact downstairs.' },
        { motif: '1-2-3b-.', rate: 1.5, reps: 28, leadIn: 'One, two, three-bee — time-and-a-half, twenty-eight bars. One, two, three-bee. Head first, then dig.' },
        { motif: '1b-2b-3b-2b', rate: 2, reps: 18, leadIn: 'One-bee, two-bee, three-bee, two-bee — double-time, eighteen bars. One-bee, two-bee, three-bee, two-bee. Short body burst, no big swings.' },
        { motif: '1-2b-3-.', rate: 1, reps: 10, leadIn: 'One, two-bee, three — straight time, ten bars. One, two-bee, three. Drop the level and come right back upstairs.' },
      ], rest: 'You have the basic body lines. Next round mixes floors and sides. First two pages are one, two-bee, three, two; then one-bee, four-bee, three, breathe. Keep your eyes up while the targets change.' },
      { theme: 'Mix the floors', rows: [
        { motif: '1-2b-3-2-1b-4b-3-.', rate: 1, reps: 9, leadIn: 'Big phrase — two pages: one, two-bee, three, two, one-bee, four-bee, three, breathe. Straight time, nine times through. Page one goes head-body-head-head. Page two opens body one-bee, four-bee, three, then breathe.' },
        { motif: '2-3b-2-.', rate: 1, reps: 14, leadIn: 'Two, three-bee, two — straight time, fourteen bars. Two, three-bee, two. Dig and get out.' },
        { motif: '1-2b-5b-2', rate: 1.5, reps: 19, leadIn: 'One, two-bee, five-bee, two — time-and-a-half, nineteen bars. One, two-bee, five-bee, two. Straight, body, up the middle, finish.' },
        { motif: '1b-2b-3b-.', rate: 2, reps: 20, leadIn: 'One-bee, two-bee, three-bee — double-time, twenty bars. One-bee, two-bee, three-bee. Three body shots, then breathe.' },
      ], rest: 'Last round. Let the ribs expand on a long inhale and keep the hands relaxed. First set is one, two-bee, three, four-bee in straight time. Then we coast briefly before the six-bee and five-bee finishes.' },
      { theme: 'Body finish', rows: [
        { motif: '1-2b-3-4b', rate: 1, reps: 17, leadIn: 'One, two-bee, three, four-bee — straight time, seventeen bars. One, two-bee, three, four-bee. Alternate floors without losing the stance.' },
        { motif: '1b-2b-.-.', rate: 1.5, reps: 20, leadIn: 'Coast bar — one-bee, two-bee, empty, empty, time-and-a-half, twenty bars. One-bee, two-bee, then empty beats. Recover while you stay in rhythm.' },
        { motif: '1-6b-3b-.', rate: 1, reps: 10, leadIn: 'One, six-bee, three-bee — straight time, ten bars. One, six-bee, three-bee. Stay compact through all three numbers.' },
        { motif: '1-2b-5b-2', rate: 2, reps: 20, leadIn: 'One, two-bee, five-bee, two — double-time, twenty bars. One, two-bee, five-bee, two. Finish the body round with clean lines.' },
      ]},
    ],
  },
  'pace-pusher': {
    // 180 → 120 (Kyle, 2026-09-01 pace sweep): the ladder survives intact —
    // at 120 the three rungs are 2/s, 3/s, 4/s, an actually climbable ladder
    // instead of 3/s → 4.5/s → 6/s.
    bpm: 120,
    rounds: [
      { theme: 'The one-two ladder', rows: [
        { motif: '1-2-.-.', rate: 1, reps: 19, leadIn: 'Coast bar — one, two, empty, empty, straight time, nineteen bars. One, two, then space. Learn the pair before you accelerate it.' },
        { motif: '1-2-.-.', rate: 1.5, reps: 39, leadIn: 'Coast bar — one, two, empty, empty, time-and-a-half, thirty-nine bars. Same one-two, quicker slots, same empty finish.' },
        { motif: '1-2-.-.', rate: 2, reps: 39, leadIn: 'Coast bar — one, two, empty, empty, double-time, thirty-nine bars. Same pair at double-time. Two fast shots, two empty slots. Stay clean.' },
      ], rest: 'First ladder is done. The next one adds a second one before the two. First set is one, one, two with the fourth slot empty in straight time; then the exact same shape climbs the rates. Breathe and keep the shoulders loose.' },
      { theme: 'Ladder the double one', rows: [
        { motif: '1-1-2-.', rate: 1, reps: 16, leadIn: 'One, one, two — straight time, sixteen bars. One, one, two. Establish the spacing.' },
        { motif: '1-1-2-.', rate: 1.5, reps: 31, leadIn: 'One, one, two — time-and-a-half, thirty-one bars. Same three shots, time-and-a-half. Do not compress the last two together.' },
        { motif: '1-1-2-.', rate: 2, reps: 31, leadIn: 'One, one, two — double-time, thirty-one bars. Same double one, two at double-time. Fast but readable.' },
        { motif: '1b-1b-1b-1b', rate: 1, reps: 10, leadIn: 'Pump: one-bees only, straight time — ten bars. Close the round with body ones. Change the target, keep the clock.' },
      ], rest: 'Good. Round three changes the ladder shape to one, two, three, then an empty slot. Same rule: straight, time-and-a-half, double. The hook should arrive on time, not early.' },
      { theme: 'Ladder the hook', rows: [
        { motif: '1-2-3-.', rate: 1, reps: 19, leadIn: 'One, two, three — straight time, nineteen bars. One, two, three. Let the three finish the phrase.' },
        { motif: '1-2-3-.', rate: 1.5, reps: 25, leadIn: 'One, two, three — time-and-a-half, twenty-five bars. Same one, two, three. Quicker grid, same shape.' },
        { motif: '1-2-3-.', rate: 2, reps: 25, leadIn: 'One, two, three — double-time, twenty-five bars. Same three at double-time. Fast hands, empty fourth slot.' },
        { motif: '1-2-3-2', rate: 1, reps: 13, leadIn: 'One, two, three, two — straight time, thirteen bars. Add the final two and settle back into straight time.' },
      ], rest: 'Final ladder mixes everything you have used. First is two pages: one, two, three, two; then one, two, five, two. After that the same four-shot ideas move through the faster grids. Hear the tempo and let it pull you, not rush you.' },
      { theme: 'All rates at once', rows: [
        { motif: '1-2-3-2-1-2-5-2', rate: 1, reps: 8, leadIn: 'Big phrase — two pages: one, two, three, two, one, two, five, two. Straight time, eight times through. Page one is one, two, three, two. Page two changes only the middle to five.' },
        { motif: '1-2-3-2', rate: 1.5, reps: 22, leadIn: 'One, two, three, two — time-and-a-half, twenty-two bars. One, two, three, two at time-and-a-half. Stay smooth.' },
        { motif: '1-2-3-.', rate: 2, reps: 22, leadIn: 'One, two, three — double-time, twenty-two bars. One, two, three at double-time, then an empty slot.' },
        { motif: '1-2-5-2', rate: 1.5, reps: 22, leadIn: 'One, two, five, two — time-and-a-half, twenty-two bars. One, two, five, two. Same rate, different finish.' },
        { motif: '1-1-2-.', rate: 2, reps: 22, leadIn: 'One, one, two — double-time, twenty-two bars. Double one, two at double-time. Finish the ladder clean.' },
      ]},
    ],
  },
  'pump-and-coast': {
    bpm: 100,
    rounds: [
      { theme: 'Pump, then breathe', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 9, leadIn: 'Pump: ones only, straight time — nine bars. Pump the ones. Stay long and keep them coming.' },
        { motif: '1-.-.-.', rate: 1, reps: 8, leadIn: 'Coast bar — one, empty, empty, empty, straight time, eight bars. One touch, three empty slots. Move, breathe, stay ready.' },
        { motif: '2-2-2-2', rate: 2, reps: 10, leadIn: 'Pump: twos only, double-time — ten bars. Pump the twos in a short burst. Keep the shoulder behind them.' },
        { motif: '1-.-2-.', rate: 1, reps: 14, leadIn: 'Coast bar — one, empty, two, empty, straight time, fourteen bars. One, empty, two, empty. Let the coast stay active.' },
        { motif: '1b-1b-1b-1b', rate: 1.5, reps: 20, leadIn: 'Long set: one-bees only, time-and-a-half — twenty bars. Pump the one-bees. Small level change, fast return.' },
      ], rest: 'That is the rhythm: work, recover, stay alive. Round two changes the pump targets. First is threes only at double-time, then a long one-touch coast. Let the breathing come down without standing still.' },
      { theme: 'Change the pump', rows: [
        { motif: '3-3-3-3', rate: 2, reps: 13, leadIn: 'Pump: threes only, double-time — thirteen bars. Pump the threes. Short turn, fast recovery.' },
        { motif: '1-.-.-.', rate: 1, reps: 14, leadIn: 'Coast bar — one, empty, empty, empty, straight time, fourteen bars. One touch, three empty slots. Circle in place and breathe.' },
        { motif: '5-5-5-5', rate: 1, reps: 9, leadIn: 'Pump: fives only, straight time — nine bars. Pump the fives. Keep them short and underneath you.' },
        { motif: '1-2-.-.', rate: 1, reps: 9, leadIn: 'Coast bar — one, two, empty, empty, straight time, nine bars. One, two, then two empty slots. Recover behind the pair.' },
        { motif: '1-1-2-.', rate: 1.5, reps: 15, leadIn: 'One, one, two — time-and-a-half, fifteen bars. Double one, two, breathe. Bring the round back together.' },
      ], rest: 'Good. Round three turns the pump into a two-page sequence. First page is one, one, one, two; second page is three, two, three, two. Then we coast and come back to a fast body-one pump.' },
      { theme: 'Two-page pump', rows: [
        { motif: '1-1-1-2-3-2-3-2', rate: 1, reps: 9, leadIn: 'Big phrase — two pages: one, one, one, two, three, two, three, two. Straight time, nine times through. Page one builds behind the ones. Page two rolls three, two, three, two.' },
        { motif: '1-.-2-.', rate: 1, reps: 9, leadIn: 'Coast bar — one, empty, two, empty, straight time, nine bars. One, empty, two, empty. Let the heartbeat come down.' },
        { motif: '1b-1b-1b-1b', rate: 2, reps: 29, leadIn: 'Long set: one-bees only, double-time — twenty-nine bars. Pump the one-bees. Fast touch downstairs, eyes up.' },
        { motif: '1-2-.-.', rate: 1.5, reps: 20, leadIn: 'Coast bar — one, two, empty, empty, time-and-a-half, twenty bars. One, two, then space. Stay loose in the coast.' },
      ], rest: 'One last round. We start with steady ones, coast, then turn the final half into combinations. First set is ones only in straight time. Save enough to make the last one-two-three-two look clean.' },
      { theme: 'Big pump home', rows: [
        { motif: '1-1-1-1', rate: 1, reps: 17, leadIn: 'Long set: ones only, straight time — seventeen bars. Long steady ones. Build pressure without squeezing the shoulders.' },
        { motif: '1-.-.-.', rate: 1, reps: 10, leadIn: 'Coast bar — one, empty, empty, empty, straight time, ten bars. One touch, three empty slots. Get your breath back on your feet.' },
        { motif: '1-1-2-.', rate: 2, reps: 20, leadIn: 'One, one, two — double-time, twenty bars. Double one, two, reset. Short fast burst.' },
        { motif: '1-2-3-2', rate: 1.5, reps: 20, leadIn: 'One, two, three, two — time-and-a-half, twenty bars. One, two, three, two. Finish the workout with a full combination.' },
      ]},
    ],
  },
}
