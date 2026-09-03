/**
 * Generate docs/click-workout-scripts.md — the scripting bible for the
 * click-track library (Kyle, 2026-09-01).
 *
 * Emits, for all 10 predetermined workouts, straight from CLICK_MAPS so
 * the document cannot drift from what runs: every section labeled by
 * kind, its scripted coach lead-in, every hit as an ASCII bar flow, the
 * unique walkout (name + details, quickly, before the bell), and the
 * between-round rest scripts. Every spoken element is bracket-tagged for
 * the corpus bank:
 *
 *   <<SINGLE CLIP>>   one unique rendered utterance
 *   [[COMPONENT HITS]] token-component audio (numbers / fused-bees)
 *
 * Usage:
 *   node --import ./tools/analysis/wav-stub.mjs --import tsx \
 *        tools/analysis/gen-workout-scripts.ts > docs/click-workout-scripts.md
 */
import { CLICK_MAPS, SETUP_GAP_MEASURES, breathBeats, measuresPerRep, rowMeasures, type ClickRate } from '../../src/domain/workout/samples/clickMaps'
import { parseCombo, punchTokens } from '../../src/domain/workout/WorkoutTokens'

const NAMES: Record<string, string> = {
  'three-round-fundamentals': 'Three-Round Fundamentals',
  'establish-the-jab-20': 'Establish the Jab',
  'switch-by-round': 'Switch by Round',
  'heavy-hands': 'Heavy Hands',
  'speed-combos': 'Speed Combos',
  'uppercut-clinic': 'Uppercut Clinic',
  'progressive-buildup': 'Progressive Buildup',
  'body-work': 'Body Work',
  'pace-pusher': 'Pace Pusher',
  'pump-and-coast': 'Pump & Coast',
}

const WALKOUTS: Record<string, string> = {
  'three-round-fundamentals':
    'Three-Round Fundamentals. Three rounds, four minutes each, one-twenty on the click. The basics, done right — jabs, crosses, hooks, walked to the beat. Find your rhythm and keep it. On the bell.',
  'establish-the-jab-20':
    'Establish the Jab. Four rounds at one hundred beats. Tonight the jab is home — everything starts there, everything comes back there. Own the range. On the bell.',
  'switch-by-round':
    'Switch by Round. Four rounds, eighty-five on the click — orthodox, southpaw, orthodox, southpaw. Same hands, opposite world. Stay honest in both. On the bell.',
  // Tempo words track the 2026-09-01 pace sweep (180/240 → 120): the copy
  // must never name a click the workout no longer runs.
  'heavy-hands':
    'Heavy Hands. Four rounds, one-twenty on the click. Hooks and crosses with weight behind them — sit down on every shot. On the bell.',
  'speed-combos':
    'Speed Combos. Four rounds at one-twenty on the click. Short combinations, quick hands, no wasted motion. Breathe between bars. On the bell.',
  'uppercut-clinic':
    'Uppercut Clinic. Four rounds, eighty-five on the click. Fives and sixes up the middle — bend the knees, rip them short. On the bell.',
  'progressive-buildup':
    'Progressive Buildup. Four rounds at one hundred. We build it one punch at a time — one, then one-two, then one-two-three, then the whole phrase. On the bell.',
  'body-work':
    'Body Work. Four rounds at one hundred. Downstairs tonight — body jabs, body crosses, dig to the ribs. Elbows in. On the bell.',
  'pace-pusher':
    'Pace Pusher. Four rounds, one-twenty on the click. Same combination, three speeds — straight time, time-and-a-half, then double-time on the same beat. The ladder never lies. On the bell.',
  'pump-and-coast':
    'Pump and Coast. Four rounds at one hundred. Bursts and breathers — when we pump, you empty it; when we coast, you recover on your feet. On the bell.',
}

const WORDS: Record<string, string> = {
  '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six',
  '1b': 'one-bee', '2b': 'two-bee', '3b': 'three-bee', '4b': 'four-bee', '5b': 'five-bee', '6b': 'six-bee',
}

function sectionKind(motif: string): string {
  const toks = motif.split('-')
  const punches = toks.filter((t) => t !== '.')
  const rests = toks.length - punches.length
  const uniq = new Set(punches)
  if (toks.length === 8) return 'TWO-PAGE SET (8 slots, paged as 2 bars)'
  if (uniq.size === 1 && rests === 0) return 'PUMP BAR (single punch, four slots)'
  if (rests >= 2) return 'COAST BAR (rest-heavy — recovery in rhythm)'
  if (rests === 1) return 'PUNCTUATED BAR (breath baked into slot 4)'
  return 'COMBO BAR'
}

/** Render fractional beats cleanly (4/3 → "1 1/3"). */
function beatsWord(b: number): string {
  if (Number.isInteger(b)) return String(b)
  const whole = Math.floor(b)
  const frac = b - whole
  const third = Math.abs(frac - 1 / 3) < 1e-6 ? '1/3' : Math.abs(frac - 2 / 3) < 1e-6 ? '2/3' : Math.abs(frac - 0.5) < 1e-6 ? '1/2' : frac.toFixed(2)
  return whole > 0 ? `${whole} ${third}` : third
}

function barAscii(motif: string, rate: number): string {
  const cells = motif.split('-').map((t) => (t === '.' ? '[ . ]' : `[ ${t.padEnd(2)}]`)).join('')
  return `${cells}  @${rate}x`
}

/** Spoken corpus rows collected during the walk — `--corpus` emits these as JSON. */
const corpusLeadIns: Array<{ slot: string; text: string }> = []
const corpusRests: Array<{ slot: string; text: string }> = []
/**
 * Loop-call corpus: one entry per unique motif across every map — the
 * [[COMPONENT HITS]] rows realized as per-bar calls ("One, two, one,
 * two!"). `minStrideMs` is the tightest stride any occurrence runs at;
 * the render tool fits the clip under it so call N+1 can never pile on
 * call N.
 */
const corpusCalls = new Map<string, { motif: string; text: string; minStrideMs: number }>()

/**
 * The per-bar call text for a motif — punches only, urgent, no "go!".
 * Pump bars read the FULL bar too — "One, one, one, one!" — not the
 * single punch (Kyle, on-glass 2026-09-01, reversing the earlier
 * single-word reading).
 */
function callText(motif: string): string {
  const words = motif
    .split('-')
    .filter((t) => t !== '.')
    .map((t) => WORDS[t] ?? t)
  const joined = words.join(', ')
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}!`
}

function noteCall(motif: string, rate: ClickRate, bpm: number): void {
  const slots = motif.split('-').length
  const strideMs = measuresPerRep(slots, rate) * 4 * (60_000 / bpm)
  const existing = corpusCalls.get(motif)
  if (existing) {
    existing.minStrideMs = Math.min(existing.minStrideMs, strideMs)
    return
  }
  corpusCalls.set(motif, { motif, text: callText(motif), minStrideMs: strideMs })
}

const out: string[] = []
out.push('# punchCraft — Click-Track Workout Scripts (all 10 predetermined sets)')
out.push('')
out.push('> Generated from `CLICK_MAPS` (the running library) by `tools/analysis/gen-workout-scripts.ts` — the maps ARE these tables; regenerate after any map edit.')
out.push('>')
out.push('> Every spoken element is bracket-tagged for the corpus bank:')
out.push('>')
out.push('> - `<<SINGLE CLIP>>` — one unique full utterance: render as ONE clip (walkouts, section lead-ins, rest scripts).')
out.push("> - `[[COMPONENT HITS]]` — the per-bar layer, REALIZED as loop calls: after a section's first bar, the coach calls the motif every bar (\"One, two, one, two!\"), fitted under the bar's stride. Pump bars call the single punch. Lead-ins and rest scripts are wired; each round's FIRST lead-in is voiced PRE-BELL (walkout for round one, warn ceremony for the rest), so the bell releases straight into punches.")
out.push('>')
out.push('> Bar notation: `[ n ]` = punch slot, `[ . ]` = rest slot. Slot width: `@1x` = 1 beat · `@1.5x` = 2/3 beat · `@2x` = 1/2 beat (double-time under the same click). Stride: 4-slot @1x = 2 measures/rep · @1.5x/@2x = 1 m/rep · 8-slot @1x = 3 m/rep · 8-slot @2x = 1.5 m/rep. The breath after each bar is part of the stride and doubles as the visual page-clear.')
out.push('')
out.push('---')
out.push('')

for (const [key, map] of Object.entries(CLICK_MAPS)) {
  out.push(`## ${NAMES[key]}  \`${key}\``)
  out.push('')
  out.push(`**${map.bpm} BPM · ${map.rounds.length} rounds × 4:00 work · ${map.bpm} measures/round · click audible, coach-guided**`)
  out.push('')
  out.push('### Walkout — name + details, quickly, before the bell')
  out.push('')
  out.push('```text')
  out.push(`<<SINGLE CLIP  walkout/${key}>>`)
  out.push(WALKOUTS[key]!)
  out.push('```')
  out.push('')
  map.rounds.forEach((round, ri) => {
    const stanceNote = round.stance ? `  ·  stance: **${round.stance.toUpperCase()}**` : ''
    out.push(`### Round ${ri + 1} — “${round.theme}”${stanceNote}`)
    out.push('')
    let punchTotal = 0
    round.rows.forEach((row, i) => {
      const kind = sectionKind(row.motif)
      const perBar = punchTokens(parseCombo(row.motif)).length
      punchTotal += perBar * row.reps
      if (i > 0) {
        out.push(`_⏸ setup pause — ${SETUP_GAP_MEASURES} measures on the click, no tokens (lead-in room)_`)
        out.push('')
      }
      out.push(`**§${ri + 1}.${i + 1} ${kind}** — ${rowMeasures(row)} measures`)
      out.push('')
      const leadText = row.leadIn
      corpusLeadIns.push({ slot: `lead-in/${key}/r${ri + 1}s${i + 1}`, text: leadText })
      noteCall(row.motif, row.rate, map.bpm)
      out.push('```text')
      out.push(`<<SINGLE CLIP  lead-in/${key}/r${ri + 1}s${i + 1}>>`)
      out.push(`"${leadText}"`)
      out.push('')
      out.push(`  ${barAscii(row.motif, row.rate)}   x ${row.reps}   (${perBar} punches/bar -> ${perBar * row.reps} punches)`)
      out.push(`  breath after every bar: ${beatsWord(breathBeats(row.motif.split('-').length, row.rate))} beats`)
      out.push('')
      out.push(`[[COMPONENT HITS]] per bar: ${row.motif.split('-').map((t) => (t === '.' ? '(rest)' : WORDS[t] ?? t)).join(' | ')}`)
      out.push('```')
      out.push('')
    })
    const gapMeasures = SETUP_GAP_MEASURES * Math.max(0, round.rows.length - 1)
    out.push(`_Round ${ri + 1} totals: ${round.rows.reduce((a, r) => a + rowMeasures(r), 0)} row measures + ${gapMeasures} setup-pause measures · **${punchTotal} punches**_`)
    out.push('')
    if (round.rest) {
      out.push(`### Rest ${ri + 1} → ${ri + 2}  (1:00)`)
      out.push('')
      const restText = round.rest
      corpusRests.push({ slot: `rest/${key}/r${ri + 1}`, text: restText })
      out.push('```text')
      out.push(`<<SINGLE CLIP  rest/${key}/r${ri + 1}>>`)
      out.push(restText)
      out.push('```')
      out.push('')
    }
  })
  out.push('---')
  out.push('')
}

let leads = 0
let rests = 0
for (const map of Object.values(CLICK_MAPS)) {
  map.rounds.forEach((r, ri) => {
    leads += r.rows.length
    if (ri < map.rounds.length - 1) rests += 1
  })
}
out.push('## Corpus-bank tally (what this document orders up)')
out.push('')
out.push('| family | count | bracket |')
out.push('|---|---|---|')
out.push(`| walkouts | ${Object.keys(CLICK_MAPS).length} | \`<<SINGLE CLIP>>\` |`)
out.push(`| section lead-ins | ${leads} | \`<<SINGLE CLIP>>\` |`)
out.push(`| rest scripts | ${rests} | \`<<SINGLE CLIP>>\` |`)
out.push('| token components (1-6, fused 1b-6b) | 12 (+ silence) | `[[COMPONENT HITS]]` |')
out.push('')
out.push('Fused-body rule rides along: every `-bee` component renders from hyphenated text (`"Two-bee"`), never spaced, per the settled A/B/C.')

if (process.argv.includes('--corpus')) {
  // Machine-readable spoken corpus for the render run — same strings the
  // markdown shows, so the script bible and the clips can never drift.
  console.log(
    JSON.stringify(
      {
        leadIns: corpusLeadIns,
        rests: corpusRests,
        calls: [...corpusCalls.values()].map((c) => ({
          ...c,
          minStrideMs: Math.round(c.minStrideMs),
        })),
      },
      null,
      2,
    ),
  )
} else {
  console.log(out.join('\n'))
}
