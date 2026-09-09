/**
 * Audible Brass Cube bench — replays the design doc's example-performance
 * narrative through the REAL domain compiler and the REAL renderer into the
 * live MIDI port, no tablet required. This is the desk-side rehearsal for
 * the on-glass decisive test: establish Dm9, hard-left to G9, right re-entry
 * from A, a flurry that wakes the ladder, a peak-punch whammy, then decay
 * and panic.
 *
 * Run: npm run bench   (add --midi "<port>" to target a specific port)
 *
 * `--v2` runs the HARMONIC COMMIT GRID scenario instead (M40-17): the
 * dorian-brass-v2 field patch, where punches stage into 500 ms windows,
 * flurries coalesce into ONE canonical commit, a rate-raising commit lands
 * on the SOUNDING grid's boundary (the am.-4 case, audible), and the
 * telemetry summary prints at the end.
 */
import { compileBrassCube } from '../../../src/domain/instrument/brassCube'
import { compilePunchPatch } from '../../../src/domain/instrument/cubeCompiler'
import {
  compileGesture,
  emptySessionState,
  type InstrumentSessionState,
} from '../../../src/domain/instrument/gestureCompiler'
import type { MusicalPunchInput, StrikeToken } from '../../../src/domain/instrument/gestureSchema'
import { strikeSignatureKeyOf } from '../../../src/domain/instrument/strikeArticulationCatalog'
import { compileHarmonicField } from '../../../src/domain/instrument/harmonicField'
import { launchPatchById } from '../../../src/domain/instrument/punchPatch'
import { openBestBackend } from './midiBackend'
import { VoiceRenderer } from './gestureToMidi'

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/** One scripted punch: bench-relative ms + the tablet-side scaled values. */
interface BenchPunch {
  atMs: number
  hand: 'left' | 'right'
  velocity01: number
  acceleration01: number
  velocityRaw: number
  /** Guided-score identity (M40-20): drives the twelve signatures. */
  token?: StrikeToken
  note?: string
}

const script: BenchPunch[] = [
  { atMs: 0, hand: 'left', velocity01: 0.05, acceleration01: 0.4, velocityRaw: 12, note: 'establish Dm9 (zone 0) — bass D1 lands' },
  { atMs: 1500, hand: 'right', velocity01: 0.05, acceleration01: 0.4, velocityRaw: 14, note: 'arp enters from D3 — Punch Weave at idle rate' },
  // ...the pattern breathes alone for a while...
  { atMs: 8000, hand: 'left', velocity01: 0.45, acceleration01: 0.85, velocityRaw: 55, note: 'HARD LEFT → zone 2: immediate G stab, chord commits to G9 on the boundary' },
  { atMs: 14000, hand: 'right', velocity01: 0.75, acceleration01: 0.6, velocityRaw: 72, note: 'medium right → zone 4: A accent, phrase re-enters from A4' },
]

// The flurry: 12 alternating punches, ~280 ms apart — the ladder should
// climb toward Z3 (240 notes/min, full 8-step Punch Weave) while the chord
// stays G9 and the rotation stays wherever the newest right punch put it.
for (let i = 0; i < 12; i += 1) {
  const left = i % 2 === 0
  script.push({
    atMs: 21000 + i * 280,
    hand: left ? 'left' : 'right',
    velocity01: left ? 0.45 : 0.75,
    acceleration01: 0.7,
    velocityRaw: left ? 52 + (i % 3) : 70 + (i % 3),
    note: i === 0 ? 'flurry begins — rate/density wake up, harmony holds G9' : undefined,
  })
}

// The peak event: a raw strictly above every prior right-hand raw, with the
// right hand well past its 6-punch warm-up — the +12 whammy should ride the
// WHOLE running pattern up and settle while it keeps stepping.
script.push({
  atMs: 30000,
  hand: 'right',
  velocity01: 0.99,
  acceleration01: 0.95,
  velocityRaw: 99,
  note: 'PEAK PUNCH — octave whammy over the arp',
})

// ...then nothing: the ladder decays 240 → 180 → 120 → 60 while the last
// chord and rotation stay latched. Panic closes the session.
const PANIC_AT_MS = 45000

/**
 * The M40-17 commit-grid rehearsal: every harmonic change should land ON
 * the 500 ms grid (or the sounding arp boundary right after it) while
 * stabs + transients stay punch-time.
 */
const v2Script: BenchPunch[] = [
  { atMs: 0, hand: 'left', velocity01: 0.05, acceleration01: 0.4, velocityRaw: 12, note: 'downbeat — first punch IS boundary 0, Dm world opens' },
  { atMs: 1300, hand: 'right', velocity01: 0.4, acceleration01: 0.5, velocityRaw: 40, note: 'right tone move staged mid-window → lands on the NEXT 500 ms boundary' },
  { atMs: 4200, hand: 'left', velocity01: 0.85, acceleration01: 0.85, velocityRaw: 60, note: 'hard left staged at 4.2s: stab NOW, chord commits at 4.5s on the grid' },
]

// Coalescing: five punches inside ONE window (10.05–10.45 s) → exactly one
// harmonic change at 10.5 s carrying all five eventIds (watch the bass).
for (let i = 0; i < 5; i += 1) {
  v2Script.push({
    atMs: 10050 + i * 100,
    hand: i % 2 === 0 ? 'left' : 'right',
    velocity01: 0.5 + 0.08 * i,
    acceleration01: 0.7,
    velocityRaw: 50 + i,
    note: i === 0 ? 'five-punch flurry in one window → ONE coalesced commit at 10.5s' : undefined,
  })
}

// The am.-4 moment: a sustained flurry raises the ladder; the rate change
// applies ATOMICALLY with the chord at the sounding grid's boundary.
for (let i = 0; i < 10; i += 1) {
  v2Script.push({
    atMs: 15000 + i * 260,
    hand: i % 2 === 0 ? 'left' : 'right',
    velocity01: i % 2 === 0 ? 0.5 : 0.75,
    acceleration01: 0.75,
    velocityRaw: 55 + (i % 4),
    note: i === 0 ? 'flurry — commits stay on-grid while the rate climbs with them' : undefined,
  })
}

const V2_PANIC_AT_MS = 30000

/**
 * The TECHNIQUE rehearsal (M40-20/21/22): guided-score tokens through the
 * real catalog, motif compiler, and bridge — the desk-side version of the
 * Twelve-Signature Audition. Each family is played twice in a row so its
 * contour is unmistakable before the next one arrives, then a real
 * combination shows the phrase becoming ONE motif rather than four
 * unrelated hits.
 *
 * Every punch of a hand uses the SAME velocity, so the harmonic cell stays
 * as still as the orbit allows and what changes is the TECHNIQUE.
 */
const techniqueScript: BenchPunch[] = []
let tAt = 0
const say = (token: StrikeToken, note?: string): void => {
  const hand = strikeSignatureKeyOf(token).hand === 'physical-left' ? 'left' : 'right'
  techniqueScript.push({
    atMs: tAt,
    hand,
    // Constant per hand: the cell holds still, the technique does the work.
    velocity01: hand === 'left' ? 0.42 : 0.58,
    acceleration01: 0.7,
    velocityRaw: hand === 'left' ? 48 : 62,
    token,
    ...(note ? { note } : {}),
  })
  tAt += 1400
}

// Establish the world, then the four families, twice each.
say('1', 'JAB (1) — entry-tone stab, tight snap, two adjacent steps')
say('1')
say('2', 'CROSS (2) — fifth/anchor stab, skip and LAND, harder accent')
say('2')
say('3', 'HOOK (3) — lateral wah sweep, reverse into a pendulum arc')
say('3')
say('5', 'UPPERCUT (5) — rising scoop, octave lift, settles in the pool')
say('5')
// Body shots: the SAME ideas an octave lower and darker — never a new scale.
say('2B', 'BODY CROSS (2B) — the same idea an octave down, darker, heavier')
say('2B')
// The combination: ONE coherent motif at phrase close, not four hits.
// A phrase window is 960 ticks = 1000 ms, so the four punches must sit
// inside a single window — start on a window boundary and space them
// 220 ms apart, or the phrase splits and compiles as two motifs.
tAt = Math.ceil((tAt + 800) / 1000) * 1000
const comboStart = tAt
const combo: StrikeToken[] = ['1', '2', '3', '2']
combo.forEach((token, i) => {
  tAt = comboStart + i * 220
  say(token, i === 0 ? 'COMBINATION 1-2-3-2 — four punches become ONE eight-step motif' : undefined)
})
// Let the committed motif play for a couple of pulses before the panic.
tAt = comboStart + 4000

const TECHNIQUE_PANIC_AT_MS = tAt + 2000

async function main(): Promise<void> {
  const midiArg = arg('--midi')
  const techniqueMode = process.argv.includes('--technique')
  const v2 = techniqueMode || process.argv.includes('--v2')
  const midi = openBestBackend([...(midiArg ? [midiArg] : []), 'punchbridge', 'loopmidi', 'wavetable'])
  const renderer = new VoiceRenderer(midi)
  renderer.prepareVoices()

  const patch = launchPatchById(v2 ? 'dorian-brass-v2' : 'dorian-brass-cube')
  const cubeMap = compilePunchPatch(patch)
  const brassMap = compileBrassCube(patch)
  const field =
    v2 && patch.harmonicField
      ? compileHarmonicField(patch.id, patch.harmonicField, brassMap)
      : undefined
  let state: InstrumentSessionState = emptySessionState()

  const runScript = techniqueMode ? techniqueScript : v2 ? v2Script : script
  const panicAt = techniqueMode
    ? TECHNIQUE_PANIC_AT_MS
    : v2
      ? V2_PANIC_AT_MS
      : PANIC_AT_MS

  const started = Date.now()
  const wait = (untilMs: number): Promise<void> =>
    new Promise((r) => setTimeout(r, Math.max(0, untilMs - (Date.now() - started))))

  console.log(
    `punchbridge bench: ${techniqueMode ? 'Twelve-Signature technique' : v2 ? 'Harmonic Field v2 commit grid' : 'Dorian Brass Cube'} via "${midi.portName}" — ~${Math.round(panicAt / 1000)}s`,
  )
  for (const p of runScript) {
    await wait(p.atMs)
    const input: MusicalPunchInput = {
      eventId: `bench-${p.hand}-${p.atMs}`,
      hand: p.hand,
      receivedMonotonicTimeMs: p.atMs,
      velocityRaw: p.velocityRaw,
      recovered: false,
      // A guided score's token is what licenses the full signature; without
      // one the compiler stays deliberately generic (M40-20 policy).
      ...(p.token ? { expectedStrikeToken: p.token } : {}),
    }
    const result = compileGesture(input, state, {
      sessionId: 'bench-brass',
      patch,
      cubeMap,
      brassMap,
      ...(field ? { field } : {}),
      velocity01: p.velocity01,
      acceleration01: p.acceleration01,
    })
    if (!result) continue
    state = result.state
    renderer.renderGesture(result.gesture)
    if (p.note) console.log(`  [${(p.atMs / 1000).toFixed(1)}s] ${p.note}`)
  }

  await wait(panicAt)
  const telemetry = renderer.brassTelemetry()
  console.log('  panic — silence, wheel centered, wah settled')
  renderer.panic()
  if (telemetry) {
    console.log(
      `punchbridge bench telemetry: commits ${telemetry.commits}, last commit lag ${String(telemetry.lastCommitLagTicks)} ticks, skipped steps ${telemetry.skippedArpSteps}, max scheduler lateness ${telemetry.maxLatenessMs.toFixed(1)} ms`,
    )
    console.log(
      `punchbridge bench technique: mutated steps ${telemetry.mutatedSteps}, superseded mutations ${telemetry.supersededMutations}, pattern commits ${telemetry.patternCommits}, scene changes ${telemetry.sceneChanges}, final scene ${telemetry.scene}`,
    )
  }
  await new Promise((r) => setTimeout(r, 300))
  midi.close()
  console.log('punchbridge bench: done')
}

void main()
