/**
 * The quick catalogue — twelve designed workouts of two rounds × 4:00 with
 * one 1:00 rest, about nine minutes each (Kyle, 2026-09-07).
 *
 * Authored as chunk links (`composeFromChunks`), not as literal maps or as
 * twelve more wrapper files: `compose()` builds the same `ProgramRound[]`
 * and recipe the wrappers do, throws at module load on any round that does
 * not fill its measure budget exactly, and `resolveRound` makes the result
 * indistinguishable downstream from a hand-authored map. What is authored
 * here is therefore only what is genuinely bespoke — the chunk sequence,
 * the spoken lead-in at each spot, the rest script, and the walkout-style
 * description.
 *
 * Every round: `bpm` measures at 4:00, the opener carrying a two-measure
 * setup pad (Variant B, as all thirty-nine existing rounds do) and each
 * later section its default two-measure gap — so k sections fill exactly
 * when their chunks sum to `bpm − 2k`. BPM is 85, 100 or 120 only: those
 * are the metronome loops the bank ships.
 *
 * Copy rules (the doc==clip invariant and the lead-in's real budget):
 * numerals spelled out, never digits; the bar count names the chunk's
 * reps; body shots are `X-bee`; no "left"/"right" (lead/rear only); no
 * `the <number>` prose references; lead-ins short — today's whispers run
 * ~8 s at the median and a whisper longer than its pad walks over the
 * previous section's last bars; rest scripts name round two's opening set
 * and stay under ~15 s so the warn ceremony still fits.
 */
import { compose, resolveToClickMap, type ComposedWorkoutDef } from './composeFromChunks'
import type { ClickMap } from './clickMaps'
import type { GeneratedWorkout } from '../GeneratedWorkout'

export type QuickWorkoutKey =
  | 'quick-jab-school'
  | 'quick-one-two'
  | 'quick-hook-line'
  | 'quick-square'
  | 'quick-uppercut-lane'
  | 'quick-downstairs'
  | 'quick-level-change'
  | 'quick-southpaw-mirror'
  | 'quick-speed-burst'
  | 'quick-heavy-two'
  | 'quick-coast-reset'
  | 'quick-six-count'

/** Grid order, 11–22. */
export const QUICK_WORKOUT_ORDER: readonly QuickWorkoutKey[] = [
  'quick-jab-school',
  'quick-one-two',
  'quick-hook-line',
  'quick-square',
  'quick-uppercut-lane',
  'quick-downstairs',
  'quick-level-change',
  'quick-southpaw-mirror',
  'quick-speed-burst',
  'quick-heavy-two',
  'quick-coast-reset',
  'quick-six-count',
]

export interface QuickWorkoutMeta {
  name: string
  description: string
}

export const QUICK_WORKOUT_META: Record<QuickWorkoutKey, QuickWorkoutMeta> = {
  'quick-jab-school': {
    name: 'Jab School',
    description: 'Two rounds on the lead hand — touch, return, then double it into the two.',
  },
  'quick-one-two': {
    name: 'One-Two',
    description: 'The straight pair at three speeds, then the double jab in front of it.',
  },
  'quick-hook-line': {
    name: 'Hook Line',
    description: 'Hooks off the straight line, then both hooks back to back.',
  },
  'quick-square': {
    name: 'The Square',
    description: 'Trace the square — one, four, two, three — then close it with the four-count.',
  },
  'quick-uppercut-lane': {
    name: 'Uppercut Lane',
    description: 'Short uppercuts up the middle at teaching cadence, both hands.',
  },
  'quick-downstairs': {
    name: 'Downstairs',
    description: 'Body jabs, the cross to the ribs, the hook under the elbow — two rounds on the floor.',
  },
  'quick-level-change': {
    name: 'Level Change',
    description: 'Head, body, head — every bar changes floors without changing the stance.',
  },
  'quick-southpaw-mirror': {
    name: 'Southpaw Mirror',
    description: 'One round orthodox, the same four sets southpaw — same numbers, opposite world.',
  },
  'quick-speed-burst': {
    name: 'Speed Burst',
    description: 'Short straight flurries and quick exits — the sprint lives in the bursts.',
  },
  'quick-heavy-two': {
    name: 'Heavy Two',
    description: 'Hooks and crosses with weight behind them, two rounds, no wasted motion.',
  },
  'quick-coast-reset': {
    name: 'Coast & Reset',
    description: 'Pump, then breathe on your feet — the empty slots are where you reset.',
  },
  'quick-six-count': {
    name: 'Six Count',
    description: 'The whole alphabet: one through six in one bar, then the long phrases.',
  },
}

const OPENER = 2

export const QUICK_WORKOUT_DEFS: readonly (ComposedWorkoutDef & { id: QuickWorkoutKey })[] = [
  // ---------------------------------------------------------------- 11 --
  {
    id: 'quick-jab-school',
    prefix: 'qjs',
    bpm: 100,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Touch and return',
        sections: [
          { chunk: 'jab-jab-jab-jab-x13', setupMeasures: OPENER, leadIn: 'Pump: ones only, straight time — thirteen bars. Touch, recover, touch again. No reaching.' },
          { chunk: 'jab-jab-cross-x9', leadIn: 'One, one, two — straight time, nine bars. Double the lead, then the rear hand. The fourth slot is quiet.' },
          { chunk: 'body-jab-jab-cross-th-x18', leadIn: 'One-bee, one, two — time-and-a-half, eighteen bars. Body one-bee, head one, then the rear hand. Reset on the empty slot.' },
          { chunk: 'jab-jab-cross-dt-x30', leadIn: 'One, one, two — double-time, thirty bars. Quick double one, two. Stay long, stay loose.' },
        ],
        rest: 'Good. The lead hand is home. Round two puts the rear hand behind it — first set is one, two, one, two in straight time, then body ones at double-time. Roll the shoulders once and meet the bell ready.',
      },
      {
        theme: 'Double and go',
        sections: [
          { chunk: 'jab-cross-jab-cross-x14', setupMeasures: OPENER, leadIn: 'One, two, one, two — straight time, fourteen bars. Let the rear hand arrive behind the lead.' },
          { chunk: 'body-jab-pump-dt-x18', leadIn: 'Pump: one-bees only, double-time — eighteen bars. Small bend, fast return, eyes up.' },
          { chunk: 'jab-jab-cross-hook-th-x16', leadIn: 'One, one, two, three — time-and-a-half, sixteen bars. Double the lead to open the door; the rear hand and the hook close it.' },
          { chunk: 'jab-jab-jab-jab-th-x30', leadIn: 'Pump: ones only, time-and-a-half — thirty bars. Finish the round owning the lead hand. Crisp, not tense.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 12 --
  {
    id: 'quick-one-two',
    prefix: 'q12',
    bpm: 120,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'The pair at three speeds',
        sections: [
          { chunk: 'jab-cross-coast-x15', setupMeasures: OPENER, leadIn: 'Coast bar — one, two, empty, empty, straight time, fifteen bars. One, two, then two quiet slots. Set the range.' },
          { chunk: 'jab-cross-jab-cross-x14', leadIn: 'One, two, one, two — straight time, fourteen bars. Four straight slots and back to guard.' },
          { chunk: 'jab-cross-coast-th-x26', leadIn: 'Coast bar — one, two, empty, empty, time-and-a-half, twenty-six bars. Same pair, a little quicker. The reset stays visible.' },
          { chunk: 'jab-cross-coast-dt-x28', leadIn: 'Coast bar — one, two, empty, empty, double-time, twenty-eight bars. Speed lives inside the pair, not in the reset.' },
        ],
        rest: 'That is the pair at every speed. Round two puts the double jab in front of it — first set is one, one, two with the fourth slot open, straight time. Breathe out long and come back to guard.',
      },
      {
        theme: 'Double the lead, keep the two',
        sections: [
          { chunk: 'jab-jab-cross-x16', setupMeasures: OPENER, leadIn: 'One, one, two — straight time, sixteen bars. Double the lead, then the rear hand. Let the pause after it show.' },
          { chunk: 'jab-jab-cross-th-x24', leadIn: 'One, one, two — time-and-a-half, twenty-four bars. Same shape, quicker hands, same stance.' },
          { chunk: 'jab-jab-cross-dt-x30', leadIn: 'One, one, two — double-time, thirty bars. Quick double one, two. Stop clean on the empty slot.' },
          { chunk: 'jab-cross-jab-cross-th-x26', leadIn: 'One, two, one, two — time-and-a-half, twenty-six bars. Finish with the pair twice through. Fast, never wild.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 13 --
  {
    id: 'quick-hook-line',
    prefix: 'qhl',
    bpm: 100,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Hooks off the line',
        sections: [
          { chunk: 'jab-cross-hook-x15', setupMeasures: OPENER, leadIn: 'One, two, three — straight time, fifteen bars. Straight, straight, then turn the hook over. Pivot the lead foot.' },
          { chunk: 'jab-cross-hook-cross-x13', leadIn: 'One, two, three, two — straight time, thirteen bars. The four-count. Let the final cross land behind the hook.' },
          { chunk: 'hook-cross-hook-th-x18', leadIn: 'Three, two, three — time-and-a-half, eighteen bars. Hook, cross, hook. Keep the elbow up on both threes.' },
          { chunk: 'jab-cross-hook-rear-hook-x9', leadIn: 'One, two, three, four — straight time, nine bars. Both hooks close the bar. Turn the hips, not the shoulders.' },
        ],
        rest: 'Hooks come off the line, never instead of it. Round two is both hooks — first set is one, two, three, four in straight time, then the hooks alone. Shake the arms out and stay tall.',
      },
      {
        theme: 'Both hooks',
        sections: [
          { chunk: 'jab-cross-hook-rear-hook-x13', setupMeasures: OPENER, leadIn: 'One, two, three, four — straight time, thirteen bars. Straight line, then both hooks. Short and turned over.' },
          { chunk: 'hook-rear-hook-hook-rear-hook-x10', leadIn: 'Three, four, three, four — straight time, ten bars. Hooks only. Sit down on each hook and keep the guard.' },
          { chunk: 'jab-rear-hook-hook-cross-th-x20', leadIn: 'One, four, three, two — time-and-a-half, twenty bars. Jab, rear hook, lead hook, cross. Weight moves side to side.' },
          { chunk: 'jab-cross-hook-dt-x26', leadIn: 'One, two, three — double-time, twenty-six bars. Fast one, two, then the hook. Finish with the elbow up.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 14 --
  {
    id: 'quick-square',
    prefix: 'qsq',
    bpm: 100,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Trace the square',
        sections: [
          { chunk: 'jab-rear-hook-cross-hook-x9', setupMeasures: OPENER, leadIn: 'One, four, two, three — straight time, nine bars. Trace the square: corner, corner, corner, corner.' },
          { chunk: 'jab-cross-hook-rear-hook-x9', leadIn: 'One, two, three, four — straight time, nine bars. Same corners, walked in order. Feet under you.' },
          { chunk: 'jab-rear-hook-cross-hook-th-x14', leadIn: 'One, four, two, three — time-and-a-half, fourteen bars. The square, quicker. Do not cut the corners.' },
          { chunk: 'jab-cross-hook-cross-jab-rear-hook-hook-cross-x14', leadIn: 'Big phrase — two pages: one, two, three, two, one, four, three, two. Straight time, fourteen times through. Page one is the four-count. Page two crosses the square.' },
        ],
        rest: 'You have the square from both corners. Round two closes it — first set is one, four, three, two in straight time, then the hooks alone. Long breath in, shoulders down.',
      },
      {
        theme: 'Close the square',
        sections: [
          { chunk: 'jab-rear-hook-hook-cross-x13', setupMeasures: OPENER, leadIn: 'One, four, three, two — straight time, thirteen bars. Jab, rear hook, lead hook, cross. Close the square every bar.' },
          { chunk: 'hook-rear-hook-hook-rear-hook-x10', leadIn: 'Three, four, three, four — straight time, ten bars. Hooks only, both sides. Rotate through the floor.' },
          { chunk: 'jab-cross-hook-rear-hook-th-x20', leadIn: 'One, two, three, four — time-and-a-half, twenty bars. The corners in order, quicker. Chin down through the hooks.' },
          { chunk: 'jab-rear-hook-hook-cross-dt-x26', leadIn: 'One, four, three, two — double-time, twenty-six bars. Fast square. Finish the round with the cross landing last.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 15 --
  {
    id: 'quick-uppercut-lane',
    prefix: 'qul',
    bpm: 85,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Short line up the middle',
        sections: [
          { chunk: 'jab-cross-upper-cross-x13', setupMeasures: OPENER, leadIn: 'One, two, five, two — straight time, thirteen bars. Straight, straight, up the middle, straight. Bend the knees on the way up.' },
          { chunk: 'upper-rear-upper-upper-th-x16', leadIn: 'Five, six, five — time-and-a-half, sixteen bars. Uppercuts only, lead, rear, lead. Rip them short.' },
          { chunk: 'jab-rear-upper-hook-cross-x8', leadIn: 'One, six, three, two — straight time, eight bars. Jab, rear uppercut, hook, cross. Level up, then over.' },
          { chunk: 'jab-upper-cross-dt-x19', leadIn: 'One, five, two — double-time, nineteen bars. Jab, lead uppercut, cross. Quick up the middle, then finish long.' },
        ],
        rest: 'Uppercuts start in the legs, not the arms. Round two brings both hands up the middle — first set is one, two, five, six in straight time. Take one breath, keep the knees soft.',
      },
      {
        theme: 'Both uppercuts, then finish',
        sections: [
          { chunk: 'jab-cross-upper-rear-upper-x12', setupMeasures: OPENER, leadIn: 'One, two, five, six — straight time, twelve bars. Straight line, then both uppercuts. Stay compact on the way up.' },
          { chunk: 'rear-upper-hook-rear-upper-hook-x8', leadIn: 'Six, three, six, three — straight time, eight bars. Rear uppercut, hook, rear uppercut, hook. Up, then around.' },
          { chunk: 'cross-upper-cross-th-x18', leadIn: 'Two, five, two — time-and-a-half, eighteen bars. Cross, lead uppercut, cross. Keep the rear hand busy.' },
          { chunk: 'upper-cross-hook-dt-x19', leadIn: 'Five, two, three — double-time, nineteen bars. Up the middle, then two, three. Finish the round in the legs.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 16 --
  {
    id: 'quick-downstairs',
    prefix: 'qdn',
    bpm: 100,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Find the floor',
        sections: [
          { chunk: 'jab-body-cross-jab-body-cross-x13', setupMeasures: OPENER, leadIn: 'One, two-bee, one, two-bee — straight time, thirteen bars. Head, body, head, body. Change level without reaching.' },
          { chunk: 'body-jab-body-cross-coast-x9', leadIn: 'Coast bar — one-bee, two-bee, empty, empty, straight time, nine bars. Two body shots, then stand back up tall.' },
          { chunk: 'jab-body-cross-hook-th-x22', leadIn: 'One, two-bee, three — time-and-a-half, twenty-two bars. Head one, body two-bee, then the hook comes back upstairs.' },
          { chunk: 'body-cross-body-hook-body-cross-x13', leadIn: 'Two-bee, three-bee, two-bee — straight time, thirteen bars. All downstairs. Elbows in, eyes up.' },
        ],
        rest: 'Good body work starts with balance, not with reaching down. Round two digs and comes back up — first set is one, two, three-bee, two in straight time. Let the ribs expand on a long breath.',
      },
      {
        theme: 'Dig and come back up',
        sections: [
          { chunk: 'jab-cross-body-hook-cross-x13', setupMeasures: OPENER, leadIn: 'One, two, three-bee, two — straight time, thirteen bars. Straight line, dig under the elbow, finish high.' },
          { chunk: 'body-jab-pump-dt-x18', leadIn: 'Pump: one-bees only, double-time — eighteen bars. Short body jabs. Small bend, quick return.' },
          { chunk: 'jab-cross-body-hook-th-x26', leadIn: 'One, two, three-bee — time-and-a-half, twenty-six bars. One, two, then dig. Come back to guard on the empty slot.' },
          { chunk: 'jab-cross-body-hook-cross-th-x22', leadIn: 'One, two, three-bee, two — time-and-a-half, twenty-two bars. Dig and finish upstairs. Clean lines to the bell.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 17 --
  {
    id: 'quick-level-change',
    prefix: 'qlc',
    bpm: 100,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'High, low, high',
        sections: [
          { chunk: 'body-jab-jab-cross-x14', setupMeasures: OPENER, leadIn: 'One-bee, one, two — straight time, fourteen bars. Body one-bee, head one, then the rear hand. Both floors, every bar.' },
          { chunk: 'jab-cross-body-jab-cross-x10', leadIn: 'One, two, one-bee, two — straight time, ten bars. High, high, low, high. The stance never changes.' },
          { chunk: 'jab-body-jab-cross-dt-x20', leadIn: 'One, one-bee, two — double-time, twenty bars. Head one, body one, two. Quick level change, clean exit.' },
          { chunk: 'body-jab-cross-jab-cross-th-x24', leadIn: 'One-bee, two, one, two — time-and-a-half, twenty-four bars. Start low, finish high. Bend the knees, not the back.' },
        ],
        rest: 'Every bar changed floors and the stance held. Round two changes floors inside the phrase — first set is one, two-bee, three, four-bee in straight time. Breathe, and keep the hands up while you rest.',
      },
      {
        theme: 'Change floors in the phrase',
        sections: [
          { chunk: 'jab-body-cross-hook-body-rear-hook-x13', setupMeasures: OPENER, leadIn: 'One, two-bee, three, four-bee — straight time, thirteen bars. High, low, high, low. Alternate floors without losing the stance.' },
          { chunk: 'jab-cross-body-hook-cross-x9', leadIn: 'One, two, three-bee, two — straight time, nine bars. Straight line, dig, finish high.' },
          { chunk: 'jab-body-cross-hook-th-x22', leadIn: 'One, two-bee, three — time-and-a-half, twenty-two bars. Head, body, then the hook upstairs. Smooth between floors.' },
          { chunk: 'body-jab-jab-cross-dt-x26', leadIn: 'One-bee, one, two — double-time, twenty-six bars. Body one-bee, head one, rear hand. Finish fast and balanced.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 18 --
  {
    id: 'quick-southpaw-mirror',
    prefix: 'qsm',
    bpm: 85,
    durationMinutes: 20,
    recipe: { stanceMode: 'switch-by-round', cadenceProfile: 'technical' },
    rounds: [
      {
        theme: 'Orthodox base',
        stance: 'orthodox',
        sections: [
          { chunk: 'jab-cross-hook-cross-x13', setupMeasures: OPENER, leadIn: 'One, two, three, two — straight time, thirteen bars. The four-count in your home stance. Learn how it feels.' },
          { chunk: 'jab-jab-cross-x8', leadIn: 'One, one, two — straight time, eight bars. Double the lead, then the rear hand. Notice which foot is forward.' },
          { chunk: 'jab-cross-hook-dt-x17', leadIn: 'One, two, three — double-time, seventeen bars. Quick one, two, hook. Same shape you will mirror next round.' },
          { chunk: 'jab-body-cross-hook-th-x18', leadIn: 'One, two-bee, three — time-and-a-half, eighteen bars. Head, body, hook. Remember this set — it comes back the other way.' },
        ],
        rest: 'Now the mirror. Switch your feet — the other foot goes forward — and the same four sets come back exactly as you threw them. First set is one, two, three, two in straight time. Settle into the new stance before the bell.',
      },
      {
        theme: 'Southpaw mirror',
        stance: 'southpaw',
        sections: [
          { chunk: 'jab-cross-hook-cross-x13', setupMeasures: OPENER, leadIn: 'One, two, three, two — straight time, thirteen bars. Same four-count, opposite world. The numbers do not change; your feet did.' },
          { chunk: 'jab-jab-cross-x8', leadIn: 'One, one, two — straight time, eight bars. Double the lead, then the rear hand. The lead hand is the other hand now.' },
          { chunk: 'jab-cross-hook-dt-x17', leadIn: 'One, two, three — double-time, seventeen bars. Quick one, two, hook. Trust the mirror.' },
          { chunk: 'jab-body-cross-hook-th-x18', leadIn: 'One, two-bee, three — time-and-a-half, eighteen bars. Head, body, hook, mirrored. Finish honest in both stances.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 19 --
  {
    id: 'quick-speed-burst',
    prefix: 'qsb',
    bpm: 120,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Fast hands, clean stops',
        sections: [
          { chunk: 'jab-cross-jab-cross-x14', setupMeasures: OPENER, leadIn: 'One, two, one, two — straight time, fourteen bars. Fast does not mean wild. Four straight slots and back to guard.' },
          { chunk: 'jab-jab-cross-dt-x34', leadIn: 'One, one, two — double-time, thirty-four bars. Quick double one, two. Stop on the empty slot every time.' },
          { chunk: 'cross-hook-cross-dt-x18', leadIn: 'Two, three, two — double-time, eighteen bars. Fast triple, then clear the page.' },
          { chunk: 'jab-cross-hook-th-x32', leadIn: 'One, two, three — time-and-a-half, thirty-two bars. One, two, three, breathe. Keep the hook compact.' },
        ],
        rest: 'Speed lives in the bursts, not in the grid. Round two reads longer pages at pace — first set is one, two, three with the fourth slot open, double-time. Drop the shoulders and breathe slow.',
      },
      {
        theme: 'Pages at speed',
        sections: [
          { chunk: 'jab-cross-hook-dt-x24', setupMeasures: OPENER, leadIn: 'One, two, three — double-time, twenty-four bars. One, two, three, stop. Fast burst, clean recovery.' },
          { chunk: 'jab-cross-jab-cross-hook-cross-coast-dt-x20', leadIn: 'Big phrase — two pages: one, two, one, two, three, two, empty, empty. Double-time, twenty times through. Four straight slots, then three, two, then breathe.' },
          { chunk: 'jab-jab-cross-th-x24', leadIn: 'One, one, two — time-and-a-half, twenty-four bars. Double one, two. Keep the lead hand alive.' },
          { chunk: 'cross-hook-cross-dt-x34', leadIn: 'Two, three, two — double-time, thirty-four bars. Two, three, two, empty slot. Last push — stay accurate.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 20 --
  {
    id: 'quick-heavy-two',
    prefix: 'qh2',
    bpm: 120,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Sit down on the straight line',
        sections: [
          { chunk: 'jab-cross-hook-x15', setupMeasures: OPENER, leadIn: 'One, two, three — straight time, fifteen bars. Sit down on the cross, turn the hook over. Weight behind every shot.' },
          { chunk: 'jab-cross-hook-cross-x15', leadIn: 'One, two, three, two — straight time, fifteen bars. The four-count with the hips in it. Finish on the cross.' },
          { chunk: 'cross-hook-cross-th-x26', leadIn: 'Two, three, two — time-and-a-half, twenty-six bars. Rear hand, hook, rear hand. Heavy, not slow.' },
          { chunk: 'jab-cross-hook-dt-x26', leadIn: 'One, two, three — double-time, twenty-six bars. Quick one, two, then the hook lands with weight.' },
        ],
        rest: 'Heavy hands come from the floor, not the shoulders. Round two is the hooks with weight — first set is one, four, three, two in straight time. Breathe deep and keep the knees bent.',
      },
      {
        theme: 'Hooks with weight',
        sections: [
          { chunk: 'jab-rear-hook-hook-cross-x13', setupMeasures: OPENER, leadIn: 'One, four, three, two — straight time, thirteen bars. Jab, rear hook, lead hook, cross. Turn the hips through both hooks.' },
          { chunk: 'hook-cross-hook-dt-x22', leadIn: 'Three, two, three — double-time, twenty-two bars. Hook, cross, hook. Short arcs, full weight.' },
          { chunk: 'jab-cross-upper-cross-th-x22', leadIn: 'One, two, five, two — time-and-a-half, twenty-two bars. Straight, straight, up the middle, straight. Legs under every shot.' },
          { chunk: 'jab-jab-cross-hook-cross-upper-cross-x14', leadIn: 'Big phrase — two pages: one, one, two, three, two, five, two, breathe. Straight time, fourteen times through. Build it, sit down on it, finish it.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 21 --
  {
    id: 'quick-coast-reset',
    prefix: 'qcr',
    bpm: 100,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Work, then reset on your feet',
        sections: [
          { chunk: 'jab-jab-jab-jab-x9', setupMeasures: OPENER, leadIn: 'Pump: ones only, straight time — nine bars. Empty it. Every shot comes home.' },
          { chunk: 'jab-coast-x8', leadIn: 'Coast bar — one, then three empty slots, straight time, eight bars. One shot, then recover on your feet. The empty slots are the work.' },
          { chunk: 'cross-pump-dt-x10', leadIn: 'Pump: twos only, double-time — ten bars. Rear hand, fast and straight. Then we breathe.' },
          { chunk: 'jab-hold-cross-x14', leadIn: 'One, two — with a hold after each, straight time, fourteen bars. Punch, wait, punch, wait. Reset between every shot.' },
          { chunk: 'cross-hook-coast-x9', leadIn: 'Coast bar — two, three, empty, empty, straight time, nine bars. Cross, hook, then stand tall and breathe.' },
        ],
        rest: 'The empty slots are where you reset — use them. Round two coasts into combinations: first set is one, two with two empty slots, straight time. Breathe on your feet, and stay in rhythm.',
      },
      {
        theme: 'Coast into combinations',
        sections: [
          { chunk: 'jab-cross-coast-x9', setupMeasures: OPENER, leadIn: 'Coast bar — one, two, empty, empty, straight time, nine bars. The pair, then two quiet slots. Recover in rhythm.' },
          { chunk: 'cross-hook-coast-th-x20', leadIn: 'Coast bar — two, three, empty, empty, time-and-a-half, twenty bars. Cross, hook, breathe. Stay balanced through the quiet.' },
          { chunk: 'jab-coast-x10', leadIn: 'Coast bar — one, then three empty slots, straight time, ten bars. One clean shot a bar. Reset fully before the next.' },
          { chunk: 'jab-jab-cross-dt-x18', leadIn: 'One, one, two — double-time, eighteen bars. Now pump it. Double one, two, and out.' },
          { chunk: 'jab-cross-hook-cross-th-x14', leadIn: 'One, two, three, two — time-and-a-half, fourteen bars. Finish with the four-count. Loose to the bell.' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 22 --
  {
    id: 'quick-six-count',
    prefix: 'q6c',
    bpm: 100,
    durationMinutes: 20,
    rounds: [
      {
        theme: 'Count to six',
        sections: [
          { chunk: 'jab-cross-hook-rear-hook-x9', setupMeasures: OPENER, leadIn: 'One, two, three, four — straight time, nine bars. The first letters of the alphabet. Straight line, then both hooks.' },
          { chunk: 'jab-cross-upper-rear-upper-x12', leadIn: 'One, two, five, six — straight time, twelve bars. Straight line, then both uppercuts. Bend for the fives and sixes.' },
          { chunk: 'jab-cross-hook-rear-hook-upper-rear-upper-coast-x10', leadIn: 'Big phrase — two pages: one, two, three, four, five, six, empty, empty. Straight time, ten times through. The whole alphabet, then breathe.' },
          { chunk: 'jab-rear-upper-hook-th-x20', leadIn: 'One, six, three — time-and-a-half, twenty bars. Jab, rear uppercut, hook. Up, then around.' },
        ],
        rest: 'You have the whole alphabet. Round two reads the whole phrase — first set is one, two, three, four in straight time, then the long pages. Long breath, shoulders down, eyes up.',
      },
      {
        theme: 'The whole phrase',
        sections: [
          { chunk: 'jab-cross-hook-rear-hook-x13', setupMeasures: OPENER, leadIn: 'One, two, three, four — straight time, thirteen bars. First half of the alphabet, clean. Turn both hooks over.' },
          { chunk: 'jab-cross-hook-cross-jab-cross-upper-cross-x8', leadIn: 'Big phrase — two pages: one, two, three, two, one, two, five, two. Straight time, eight times through. The four-count, then the same line with the uppercut.' },
          { chunk: 'jab-cross-hook-rear-hook-upper-rear-upper-coast-x8', leadIn: 'Big phrase — two pages: one, two, three, four, five, six, empty, empty. Straight time, eight times through. Say the alphabet with your hands.' },
          { chunk: 'jab-cross-upper-rear-upper-x9', leadIn: 'One, two, five, six — straight time, nine bars. Straight line, both uppercuts. Finish the round in the legs.' },
        ],
      },
    ],
  },
]

/** The resolved maps — identical in shape to a hand-authored `CLICK_MAPS` entry. */
export const QUICK_CLICK_MAPS: Record<QuickWorkoutKey, ClickMap> = Object.fromEntries(
  QUICK_WORKOUT_DEFS.map((def) => [def.id, resolveToClickMap(def)]),
) as Record<QuickWorkoutKey, ClickMap>

/**
 * The composed workouts. `compose()` throws at module load on any round
 * that does not fill exactly, which fails every suite that imports the
 * registry — by design: a mis-filled round must never reach a drive.
 */
export const QUICK_WORKOUTS: Record<QuickWorkoutKey, GeneratedWorkout> = Object.fromEntries(
  QUICK_WORKOUT_DEFS.map((def) => [def.id, compose(def)]),
) as Record<QuickWorkoutKey, GeneratedWorkout>
