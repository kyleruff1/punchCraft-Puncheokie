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
import { spokenFor } from '../voice/prosody.mjs'

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

// ---------------------------------------------------------------------------
// Technique vocabulary (Kyle, 2026-09-02) — the same authored copy with the
// numeric cue words translated through prosody's technique tables. Full
// forms in lead-ins/rests ("Lead uppercut"), compact in per-bar calls
// ("Lead upper") — shouts compress, setup copy stays articulate.
// ---------------------------------------------------------------------------

const NUM_TO_DIGIT: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
}
const NUM_WORD = '(?:one|two|three|four|five|six)'

/** Full technique name for a numeric cue word ("two" → "cross"). */
const techFull = (numWord: string): string =>
  spokenFor(NUM_TO_DIGIT[numWord.toLowerCase()]!, { vocabulary: 'techniques', cadence: 'steady' }).toLowerCase()

/** Compact technique name for a motif token ("5" → "Lead upper", "2b" → "Body cross"). */
const techCompact = (token: string): string =>
  spokenFor(token, { vocabulary: 'techniques', cadence: 'sprint' })

const matchCase = (replacement: string, original: string): string =>
  /^[A-Z]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement

/**
 * Translate one authored numeric text into the technique vocabulary.
 *
 * The copy embeds cue words inside coaching prose, so translation is
 * rule-scoped, not blanket — a bare number word is only a cue when the
 * text uses it like one:
 *
 *   1. "head X"        → "head <technique>"        (level qualifier kept)
 *   2. "body X-bee"    → "body <technique>"        (qualifier absorbed —
 *                         never "body body cross")
 *   3. comma-runs of 2+ cue words → member-wise    ("one, two-bee, three")
 *   4. residual "X-bee" anywhere  → "body <technique>" (-bee is only ever a cue)
 *   5. "the X" prose references   → "the <technique>" ("let the two arrive
 *                         behind the one") — flagged for review, since "the
 *                         one" can be a pronoun in other copy.
 *
 * Everything else ("thirteen bars", "page two", "four-count") stays. Any
 * leftover bare cue word is reported for Kyle's read — the transform
 * would rather under-translate loudly than mis-translate silently.
 */
function techniqueText(text: string, notes: string[]): string {
  let result = text

  // 1. "head X"
  result = result.replace(new RegExp(`\\b(head)(\\s+)(${NUM_WORD})\\b`, 'gi'), (_, head, ws, num) => `${head}${ws}${techFull(num)}`)

  // 2. "body X-bee" — absorb the existing qualifier.
  result = result.replace(new RegExp(`\\b(body)(\\s+)(${NUM_WORD})-bee\\b`, 'gi'), (_, body, ws, num) => `${body}${ws}${techFull(num)}`)

  // 2b. Plural cue groups — the pump copy's "ones only" / "one-bees only".
  //     Pluralize the technique's last word: "jabs", "body jabs", "lead hooks".
  result = result.replace(new RegExp(`\\b(${NUM_WORD})-bees\\b`, 'gi'), (m, num) => matchCase(`body ${techFull(num)}s`, m))
  result = result.replace(new RegExp(`\\b(${NUM_WORD})s\\b`, 'gi'), (m, num) => {
    notes.push(`plural: "${m}" → "${techFull(num)}s"`)
    return matchCase(`${techFull(num)}s`, m)
  })

  // 3. Comma-separated cue runs (members numeric or -bee).
  const CUE = `${NUM_WORD}(?:-bee)?`
  result = result.replace(new RegExp(`\\b${CUE}(?:,\\s+${CUE})+`, 'gi'), (run) =>
    run
      .split(/,\s+/)
      .map((member, i) => {
        const bee = /-bee$/i.test(member)
        const num = member.replace(/-bee$/i, '')
        const word = bee ? `body ${techFull(num)}` : techFull(num)
        return i === 0 ? matchCase(word, member) : word
      })
      .join(', '),
  )

  // 4. Residual "-bee" forms outside runs.
  result = result.replace(new RegExp(`\\b(${NUM_WORD})-bee\\b`, 'gi'), (m, num) => matchCase(`body ${techFull(num)}`, m))

  // 5. "the X" prose references (guarded against "the four-count").
  result = result.replace(new RegExp(`\\b(the)(\\s+)(${NUM_WORD})\\b(?!-)`, 'gi'), (m, the, ws, num) => {
    notes.push(`prose-ref: "${m.trim()}" → "${the} ${techFull(num)}"`)
    return `${the}${ws}${techFull(num)}`
  })

  // Residual bare cue words — report, don't guess. Counting prose stays
  // numeric ("thirteen bars", "two slow breaths", "six times through");
  // the whitelist tolerates one adjective between the number and its noun.
  const residual = result.match(new RegExp(`\\b${NUM_WORD}\\b`, 'gi')) ?? []
  const COUNT_NOUN =
    '(?:count|minute|minutes|round|rounds|bar|bars|beat|beats|hundred|twenty|page|pages|slot|slots|speed|speeds|punch|punches|breath|breaths|shot|shots|time|times|more|straight|set|sets)'
  const PROSE_OK = new RegExp(
    `\\b${NUM_WORD}[- ](?:\\w+ )?${COUNT_NOUN}|(?:page|round|slot|speed)s?\\s+${NUM_WORD}\\b`,
    'gi',
  )
  const proseHits = new Set((result.match(PROSE_OK) ?? []).flatMap((m) => m.toLowerCase().match(new RegExp(NUM_WORD, 'g')) ?? []))
  for (const word of residual) {
    if (!proseHits.has(word.toLowerCase())) notes.push(`RESIDUAL numeric "${word}" — review`)
  }
  return result
}

/** Compact-form call text for a motif ("1-2b" → "Jab, body cross!"). */
function callTextTechnique(motif: string): string {
  const words = motif
    .split('-')
    .filter((t) => t !== '.')
    .map((t) => techCompact(t))
    .map((w, i) => (i === 0 ? w : w.toLowerCase()))
  return `${words.join(', ')}!`
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
const techLeadIns: Array<{ slot: string; text: string }> = []
const techRests: Array<{ slot: string; text: string }> = []
/** Per-slot transform record for Kyle's read — every prose-ref and residual. */
const techniqueReview: Array<{ slot: string; numeric: string; technique: string; notes: string[] }> = []

function collectTechnique(slot: string, numeric: string, into: Array<{ slot: string; text: string }>): void {
  const notes: string[] = []
  const technique = techniqueText(numeric, notes)
  into.push({ slot, text: technique })
  techniqueReview.push({ slot, numeric, technique, notes })
}
/**
 * Loop-call corpus: one entry per unique motif across every map — the
 * [[COMPONENT HITS]] rows realized as per-bar calls ("One, two, one,
 * two!"). `minStrideMs` is the tightest stride any occurrence runs at;
 * the render tool fits the clip under it so call N+1 can never pile on
 * call N.
 */
const corpusCalls = new Map<string, { motif: string; text: string; techniqueText: string; minStrideMs: number }>()

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
  corpusCalls.set(motif, { motif, text: callText(motif), techniqueText: callTextTechnique(motif), minStrideMs: strideMs })
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
      collectTechnique(`lead-in/${key}/r${ri + 1}s${i + 1}`, leadText, techLeadIns)
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
      collectTechnique(`rest/${key}/r${ri + 1}`, restText, techRests)
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
  // `techniques` mirrors the numeric families slot-for-slot in the
  // technique vocabulary (calls carry both texts on the same row).
  console.log(
    JSON.stringify(
      {
        leadIns: corpusLeadIns,
        rests: corpusRests,
        calls: [...corpusCalls.values()].map((c) => ({
          ...c,
          minStrideMs: Math.round(c.minStrideMs),
        })),
        techniques: { leadIns: techLeadIns, rests: techRests },
        techniqueReview,
      },
      null,
      2,
    ),
  )
} else if (process.argv.includes('--technique-review')) {
  // Human-readable transform audit — Kyle's checkpoint before the render.
  for (const r of techniqueReview) {
    const flagged = r.notes.length > 0
    console.log(`${flagged ? '⚑' : ' '} ${r.slot}`)
    console.log(`    N: ${r.numeric}`)
    console.log(`    T: ${r.technique}`)
    for (const n of r.notes) console.log(`    ! ${n}`)
  }
  const flaggedCount = techniqueReview.filter((r) => r.notes.length > 0).length
  console.log(`\n${techniqueReview.length} slots translated, ${flaggedCount} flagged for review`)
  for (const c of corpusCalls.values()) console.log(`call ${c.motif}: "${c.text}" → "${c.techniqueText}"`)
} else {
  console.log(out.join('\n'))
}
