/**
 * fit-round-openers — size each round's post-bell pad so the coach can
 * call the round's FIRST bar (Variant B, Kyle 2026-09-04: "if we can
 * actually fit in the missing audio for the first rep that would truly
 * be ideal").
 *
 * For every CLICK_MAPS round, computes the minimal `setupMeasures` for
 * row 0 (clamped 1..2) that fits: bell clearance + the opener's rep-0
 * call clip (max across both vocabularies) + the widest call breath —
 * then proposes which row loses reps so the round still exact-fills
 * (`Σ rowMeasures + Σ setupMeasures === bpm`, the 4:00 law).
 *
 * PRINTS a per-round diff for hand-commit into clickMaps.ts — this
 * script never rewrites authored data (same posture as the planned
 * fit-click-pads).
 *
 * Run:
 *   node --import ./tools/analysis/wav-stub.mjs --import tsx tools/voice/fit-round-openers.mjs
 *
 * Rebalance rules:
 *  - never touch 8-slot (two-page) rows;
 *  - cut from the eligible row with the LARGEST reps; rep floor 8;
 *  - a rate-1 row costs 2 measures/rep, rate 1.5/2 cost 1 — so a 1-measure
 *    pad prefers a faster row (integer cuts only); when only rate-1 rows
 *    can pay, the pad rounds up to 2 so the cut stays whole.
 */

import { measuresPerRep, rowMeasures } from '../../src/domain/workout/samples/clickMaps.ts'
import { allClickMaps } from '../../src/domain/workout/samples/allClickMaps.ts'
import { CLICK_SCRIPT_CLIPS } from '../../src/audio/voiceAssets/clickScriptManifest.ts'

// Every map the app plays — the literal ten and the composed quick twelve.
const CLICK_MAPS = allClickMaps()

/** Widest call breath at dispatch (DENSE_BREATH_MS.techniques). */
const BREATH_MS = 750
/** Post-bell clearance so the call never fights the bell on the busy lane. */
const BELL_CLEAR_MS = 1000

const slots = (motif) => motif.split('-').length

function openerCallMaxMs(motif) {
  const slot = `call/${motif}`
  const clips = CLICK_SCRIPT_CLIPS.filter((c) => c.kind === 'call' && c.slots.includes(slot))
  if (clips.length === 0) return null
  return { maxMs: Math.max(...clips.map((c) => c.durationMs)), count: clips.length }
}

let failures = 0
const proposals = []

for (const [id, map] of Object.entries(CLICK_MAPS)) {
  const measureMs = 240000 / map.bpm
  map.rounds.forEach((round, r) => {
    const opener = round.rows[0]
    const call = openerCallMaxMs(opener.motif)
    if (!call) {
      console.log(`!! ${id} r${r + 1}: no rendered call for opener ${opener.motif} — cannot pad`)
      failures += 1
      return
    }
    const requiredMs = BELL_CLEAR_MS + call.maxMs + BREATH_MS
    let pad = Math.min(2, Math.max(1, Math.ceil(requiredMs / measureMs)))

    // Eligible payers: 4-slot rows (any position), largest reps first.
    const payers = round.rows
      .map((row, i) => ({ row, i, perRep: measuresPerRep(slots(row.motif), row.rate) }))
      .filter((p) => slots(p.row.motif) === 4)
      .sort((a, b) => b.row.reps - a.row.reps)

    let pick = null
    for (const cand of [pad, 2]) {
      // integer cuts only; try the pad as computed, else round it up to 2.
      pick = payers.find((p) => cand % p.perRep === 0 && p.row.reps - cand / p.perRep >= 8)
      if (pick) {
        pad = cand
        break
      }
    }
    if (!pick) {
      console.log(`!! ${id} r${r + 1}: no row can absorb a ${pad}-measure pad (floor 8) — hand-review`)
      failures += 1
      return
    }
    const cut = pad / pick.perRep
    proposals.push({
      id,
      round: r + 1,
      opener: `${opener.motif} @${opener.rate}x`,
      callMaxMs: call.maxMs,
      requiredMs,
      pad,
      payMotif: pick.row.motif,
      payRate: pick.row.rate,
      payIndex: pick.i,
      repsBefore: pick.row.reps,
      repsAfter: pick.row.reps - cut,
    })
    console.log(
      `${id} r${r + 1}: opener ${opener.motif}@${opener.rate}x call ${call.maxMs}ms → need ${requiredMs}ms → setupMeasures: ${pad}` +
        `  |  pay: rows[${pick.i}] ${pick.row.motif}@${pick.row.rate}x reps ${pick.row.reps} → ${pick.row.reps - cut}`,
    )
    // Sanity: the exact-fill delta is zero by construction.
    const delta = pad - cut * pick.perRep
    if (delta !== 0) {
      console.log(`!! ${id} r${r + 1}: BALANCE BUG delta=${delta}`)
      failures += 1
    }
  })
}

console.log(`\n${proposals.length} rounds sized, ${failures} failures`)
console.log(JSON.stringify(proposals, null, 2))
