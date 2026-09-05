/**
 * Audible Brass Cube bench — replays the design doc's example-performance
 * narrative through the REAL domain compiler and the REAL renderer into the
 * live MIDI port, no tablet required. This is the desk-side rehearsal for
 * the on-glass decisive test: establish Dm9, hard-left to G9, right re-entry
 * from A, a flurry that wakes the ladder, a peak-punch whammy, then decay
 * and panic.
 *
 * Run: npm run bench   (add --midi "<port>" to target a specific port)
 */
import { compileBrassCube } from '../../../src/domain/instrument/brassCube'
import { compilePunchPatch } from '../../../src/domain/instrument/cubeCompiler'
import {
  compileGesture,
  emptySessionState,
  type InstrumentSessionState,
} from '../../../src/domain/instrument/gestureCompiler'
import type { MusicalPunchInput } from '../../../src/domain/instrument/gestureSchema'
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

async function main(): Promise<void> {
  const midiArg = arg('--midi')
  const midi = openBestBackend([...(midiArg ? [midiArg] : []), 'punchbridge', 'loopmidi', 'wavetable'])
  const renderer = new VoiceRenderer(midi)
  renderer.prepareVoices()

  const patch = launchPatchById('dorian-brass-cube')
  const cubeMap = compilePunchPatch(patch)
  const brassMap = compileBrassCube(patch)
  let state: InstrumentSessionState = emptySessionState()

  const started = Date.now()
  const wait = (untilMs: number): Promise<void> =>
    new Promise((r) => setTimeout(r, Math.max(0, untilMs - (Date.now() - started))))

  console.log(`punchbridge bench: Dorian Brass Cube via "${midi.portName}" — ~${PANIC_AT_MS / 1000}s`)
  for (const p of script) {
    await wait(p.atMs)
    const input: MusicalPunchInput = {
      eventId: `bench-${p.hand}-${p.atMs}`,
      hand: p.hand,
      receivedMonotonicTimeMs: p.atMs,
      velocityRaw: p.velocityRaw,
      recovered: false,
    }
    const result = compileGesture(input, state, {
      sessionId: 'bench-brass',
      patch,
      cubeMap,
      brassMap,
      velocity01: p.velocity01,
      acceleration01: p.acceleration01,
    })
    if (!result) continue
    state = result.state
    renderer.renderGesture(result.gesture)
    if (p.note) console.log(`  [${(p.atMs / 1000).toFixed(1)}s] ${p.note}`)
  }

  await wait(PANIC_AT_MS)
  console.log('  panic — silence, wheel centered, wah settled')
  renderer.panic()
  await new Promise((r) => setTimeout(r, 300))
  midi.close()
  console.log('punchbridge bench: done')
}

void main()
