/**
 * The Twelve-Signature blind audition (Kyle's listening protocol, M40-28).
 *
 * The question this answers is NOT "does the instrument sound good" — it is
 * "can a listener name the strike family without looking, and does that
 * survive when the drums are muted". Family identity that only exists in
 * the drum channel is not family identity: Toontrack gets muted, drums get
 * busy, and the same family gets played across different chords.
 *
 * Protocol, verbatim from the ruling:
 *   · fix the chord, velocity, acceleration and activity layer
 *   · play the diagnostic sequence blind — the console prints slot numbers
 *     only, and the answer key after the pass
 *   · repeat in four passes, adding one layer at a time:
 *       1 brass stab only      2 + arpeggiator
 *       3 + drums              4 complete mix (expression on)
 *
 * Targets (product-audition gates, not statistics): ≥80% four-family blind
 * recognition BEFORE drums, ≥85% cross-vs-hook, ≥90% head-vs-body.
 *
 * Run: npm run audition                 (blind, re-ordered per pass)
 *      npm run audition -- --fixed      (the printed diagnostic order)
 *      npm run audition -- --seed 1234  (reproduce a specific blind run)
 */
import { compileBrassCube } from '../../../src/domain/instrument/brassCube'
import { compilePunchPatch } from '../../../src/domain/instrument/cubeCompiler'
import {
  compileGesture,
  emptySessionState,
  type InstrumentSessionState,
} from '../../../src/domain/instrument/gestureCompiler'
import type { MusicalPunchInput, StrikeToken } from '../../../src/domain/instrument/gestureSchema'
import { compileHarmonicField } from '../../../src/domain/instrument/harmonicField'
import { launchPatchById } from '../../../src/domain/instrument/punchPatch'
import { strikeSignatureKeyOf } from '../../../src/domain/instrument/strikeArticulationCatalog'
import { VoiceRenderer } from './gestureToMidi'
import { openBestBackend, type MidiOutputBackend } from './midiBackend'

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

// Wire channels (0-based), per the launch template.
const BASS = 1
const ARP = 2
const ACCENT = 3
const DRUMS = 9

interface AuditionPass {
  label: string
  /** Channels allowed to sound. */
  channels: readonly number[]
  /** Whether expression (wah CC) passes through. */
  expression: boolean
}

const PASSES: readonly AuditionPass[] = [
  { label: '1/4  BRASS STAB ONLY  — the honest test: no drums, no arp', channels: [ACCENT], expression: false },
  { label: '2/4  + ARPEGGIATOR', channels: [ACCENT, ARP, BASS], expression: false },
  { label: '3/4  + DRUMS', channels: [ACCENT, ARP, BASS, DRUMS], expression: false },
  { label: '4/4  COMPLETE MIX  — expression on', channels: [ACCENT, ARP, BASS, DRUMS], expression: true },
]

/**
 * A backend that drops anything outside the pass's layer set. Filtering at
 * the PORT means the compiler and renderer run exactly as they do in a
 * real jam — the audition tests the shipping path, not a special one.
 */
class LayerFilteredMidi implements MidiOutputBackend {
  readonly portName: string
  readonly isReal: boolean
  private allowed: Set<number> = new Set()
  private expression = true
  /** Messages that actually reached the port this pass, per channel. */
  readonly passCounts = new Map<number, number>()

  constructor(private readonly inner: MidiOutputBackend) {
    this.portName = inner.portName
    this.isReal = inner.isReal
  }

  setPass(pass: AuditionPass): void {
    this.allowed = new Set(pass.channels)
    this.expression = pass.expression
    this.passCounts.clear()
    // Never leave a note hanging across a pass change.
    this.inner.allNotesOff()
  }

  send(bytes: readonly number[]): void {
    const status = bytes[0] ?? 0
    const kind = status & 0xf0
    const channel = status & 0x0f
    if (!this.allowed.has(channel)) return
    // 0xB0 control change carries the wah; 0xE0 is the bend that performs
    // the scoop and the settle, which are part of the STAB and stay on.
    if (!this.expression && kind === 0xb0) return
    this.passCounts.set(channel, (this.passCounts.get(channel) ?? 0) + 1)
    this.inner.send(bytes)
  }

  allNotesOff(): void {
    this.inner.allNotesOff()
  }

  close(): void {
    this.inner.close()
  }
}

/** Kyle's compact diagnostic sequence. */
const DIAGNOSTIC: readonly StrikeToken[] = ['1', '3', '2', '5', '2', '1', '5', '3', '2B', '2']

const FAMILY_LABEL: Readonly<Record<string, string>> = {
  straight: 'STRAIGHT',
  hook: 'HOOK',
  uppercut: 'UPPERCUT',
}

function describe(token: StrikeToken): string {
  const key = strikeSignatureKeyOf(token)
  const hand = key.hand === 'physical-left' ? 'L' : 'R'
  const body = key.target === 'body' ? ' BODY' : ''
  return `${token.padEnd(2)}  ${FAMILY_LABEL[key.family]}${body} (${hand})`
}

/** Deterministic shuffle so a run can be reproduced from its printed seed. */
function shuffled(tokens: readonly StrikeToken[], seed: number): StrikeToken[] {
  const out = [...tokens]
  let state = seed >>> 0
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

const STRIKE_GAP_MS = 1900
const PASS_GAP_MS = 3500

async function main(): Promise<void> {
  const midiArg = arg('--midi')
  const raw = openBestBackend([...(midiArg ? [midiArg] : []), 'punchbridge', 'loopmidi', 'wavetable'])
  const midi = new LayerFilteredMidi(raw)
  const renderer = new VoiceRenderer(midi)
  renderer.prepareVoices()

  const patch = launchPatchById('dorian-brass-v2')
  const cubeMap = compilePunchPatch(patch)
  const brassMap = compileBrassCube(patch)
  const field = compileHarmonicField(patch.id, patch.harmonicField!, brassMap)

  const seedArg = arg('--seed')
  // A FRESH seed per run by default, printed so any run can be replayed
  // with --seed. A constant default would make "run it again" replay the
  // identical order, which is worthless once you have heard it once.
  const seed = seedArg ? Number.parseInt(seedArg, 10) : Date.now() % 100000
  // Blind by DEFAULT, and re-ordered per pass: one shared order would mean
  // that after pass 1 the listener knows every answer, and passes 2-4 stop
  // testing anything. `--fixed` restores the printed diagnostic order for
  // A/B comparison across runs.
  const fixedOrder = process.argv.includes('--fixed')
  const orderFor = (passIndex: number): StrikeToken[] =>
    fixedOrder ? [...DIAGNOSTIC] : shuffled(DIAGNOSTIC, seed + passIndex * 7919)

  console.log('')
  console.log('  TWELVE-SIGNATURE BLIND AUDITION')
  console.log(`  port "${midi.portName}"  ·  ${DIAGNOSTIC.length} strikes × ${PASSES.length} passes`)
  console.log('  Fixed chord, velocity, acceleration and activity layer.')
  console.log('  Name the family as each number plays; the key follows the pass.')
  console.log(
    fixedOrder ? '  FIXED diagnostic order' : `  blind: each pass re-ordered independently (seed ${seed})`,
  )
  console.log('  Targets: >=80% four-family before drums, >=85% cross-vs-hook, >=90% head-vs-body.')
  console.log('')

  const started = Date.now()
  let clock = 0
  const wait = (untilMs: number): Promise<void> =>
    new Promise((r) => setTimeout(r, Math.max(0, untilMs - (Date.now() - started))))

  let state: InstrumentSessionState = emptySessionState()

  // Prime both hands so the harmonic CELL is settled and identical for
  // every strike — the protocol fixes the chord, so only technique varies.
  for (const hand of ['left', 'right'] as const) {
    clock += 400
    const primed = compileGesture(
      {
        eventId: `prime-${hand}`,
        hand,
        receivedMonotonicTimeMs: clock,
        velocityRaw: 55,
        recovered: false,
      },
      state,
      { sessionId: 'audition', patch, cubeMap, brassMap, field, velocity01: 0.5, acceleration01: 0.6 },
    )
    if (primed) state = primed.state
  }

  for (const [passIndex, pass] of PASSES.entries()) {
    midi.setPass(pass)
    console.log(`  ${pass.label}`)
    const sequence = orderFor(passIndex)
    const key: string[] = []
    for (const [index, token] of sequence.entries()) {
      clock += STRIKE_GAP_MS
      await wait(clock)
      const hand = strikeSignatureKeyOf(token).hand === 'physical-left' ? 'left' : 'right'
      const input: MusicalPunchInput = {
        eventId: `aud-${pass.label}-${index}`,
        hand,
        receivedMonotonicTimeMs: clock,
        // Fixed velocity + acceleration: a signature that only survives at
        // full power is not a signature.
        velocityRaw: 55,
        recovered: false,
        expectedStrikeToken: token,
      }
      const result = compileGesture(input, state, {
        sessionId: 'audition',
        patch,
        cubeMap,
        brassMap,
        field,
        velocity01: 0.5,
        acceleration01: 0.6,
      })
      if (!result) continue
      state = result.state
      renderer.renderGesture(result.gesture)
      process.stdout.write(`    ${String(index + 1).padStart(2)} ...\n`)
      key.push(`${String(index + 1).padStart(2)}  ${describe(token)}`)
    }
    clock += PASS_GAP_MS
    await wait(clock)
    console.log('    ── key ──')
    for (const line of key) console.log(`    ${line}`)
    // Proof the layer filter actually did something this pass.
    const NAME: Record<number, string> = { 1: 'bass', 2: 'arp', 3: 'stab', 9: 'drums' }
    const sounded = [...midi.passCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ch, n]) => `${NAME[ch] ?? `ch${ch}`} ${n}`)
      .join(' · ')
    console.log(`    layers sounded: ${sounded}`)
    console.log('')
  }

  renderer.panic()
  await new Promise((r) => setTimeout(r, 300))
  midi.close()
  console.log('  audition complete — score each pass against the targets above.')
}

void main()
