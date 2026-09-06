/**
 * Render a Punch Kit audition to a wav you can just play.
 *
 *   npx tsx tools/tablet-voice/src/render-kit-audition.ts
 *   npx tsx tools/tablet-voice/src/render-kit-audition.ts --sequence 3,4,3,2 --gap 400
 *
 * Why offline rather than on the tablet: the app already holds about 70
 * AudioTracks against a ~48 ceiling past which everything goes silent with
 * no error (#356), so putting eleven more resident players on glass is the
 * one thing that must NOT happen before that is fixed. A mixdown needs no
 * players at all — and it exercises the real path anyway, because it drives
 * the shipping `compileDrumGesture` and the shipping rendered bank. What
 * you hear here is what the tablet will play.
 *
 * Two files:
 *   audition-twelve.wav    all twelve signatures at CONSTANT intensity,
 *                          in §5.1 table order — the identity test
 *   audition-scenario.wav  §35's decisive scenario, 1-1-2-3-2-5-6-2B, with
 *                          a natural combination contour
 *
 * Deterministic: same inputs, byte-identical wav.
 */
import fs from 'fs'
import path from 'path'

import {
  compileDrumGesture,
  type CompiledDrumGesture,
} from '../../../src/domain/instrument/drums/compileDrumGesture'
import {
  emptyDrumEnergy,
  type DrumEnergyState,
} from '../../../src/domain/instrument/drums/drumFamilyEnergy'
import type { StrikeToken } from '../../../src/domain/instrument/gestureSchema'
import {
  STRIKE_TOKENS,
  strikeSignatureKeyOf,
} from '../../../src/domain/instrument/strikeArticulationCatalog'
import { renderDrumArticulation } from './drumKit'
import { SAMPLE_RATE, wavBytes } from './dsp'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

/** One punch in an audition. */
interface AuditionStrike {
  token: StrikeToken
  velocity01: number
  acceleration01: number
  isNewPeak?: boolean
  isPhraseEnding?: boolean
}

/** Sum one-shots onto a timeline. Nothing is scheduled — this is arithmetic. */
class Mixdown {
  private readonly buffer: Float64Array

  constructor(lengthSamples: number) {
    this.buffer = new Float64Array(lengthSamples)
  }

  add(source: Float64Array, atSample: number, gain: number): void {
    const limit = Math.min(source.length, this.buffer.length - atSample)
    for (let n = 0; n < limit; n += 1) {
      this.buffer[atSample + n] = (this.buffer[atSample + n] ?? 0) + (source[n] ?? 0) * gain
    }
  }

  peak(): number {
    let peak = 0
    for (let n = 0; n < this.buffer.length; n += 1) {
      peak = Math.max(peak, Math.abs(this.buffer[n] ?? 0))
    }
    return peak
  }

  /**
   * Scale so the mix peaks at `ceiling`, but only DOWNWARD — a quiet
   * audition stays quiet rather than being pumped up to look loud, which
   * would hide exactly the velocity differences we are auditioning.
   */
  normalized(ceiling = 0.94): Float64Array {
    const peak = this.peak()
    if (peak <= ceiling || peak === 0) return this.buffer
    const gain = ceiling / peak
    const out = new Float64Array(this.buffer.length)
    for (let n = 0; n < this.buffer.length; n += 1) out[n] = (this.buffer[n] ?? 0) * gain
    return out
  }
}

const clipCache = new Map<string, Float64Array>()
function clipFor(articulation: string): Float64Array {
  const cached = clipCache.get(articulation)
  if (cached) return cached
  const buffer = renderDrumArticulation(articulation as never)
  clipCache.set(articulation, buffer)
  return buffer
}

interface RenderedAudition {
  samples: Float64Array
  key: readonly string[]
  gestures: readonly CompiledDrumGesture[]
}

const FAMILY_LABEL: Readonly<Record<string, string>> = {
  jab: 'JAB',
  cross: 'CROSS',
  hook: 'HOOK',
  uppercut: 'UPPERCUT',
}

function renderAudition(strikes: readonly AuditionStrike[], gapMs: number): RenderedAudition {
  // Enough tail for the longest clip (the 1.5 s crash) plus a breath.
  const tailSamples = 2 * SAMPLE_RATE
  const gapSamples = Math.round((gapMs / 1000) * SAMPLE_RATE)
  const mix = new Mixdown(strikes.length * gapSamples + tailSamples)

  let energy: DrumEnergyState = emptyDrumEnergy()
  const key: string[] = []
  const gestures: CompiledDrumGesture[] = []

  for (const [index, strike] of strikes.entries()) {
    const atMs = index * gapMs
    const result = compileDrumGesture({
      eventId: `aud-${index}`,
      identity: { source: 'guided-score', token: strike.token, confidence: 1 },
      hand: strikeSignatureKeyOf(strike.token).hand === 'physical-left' ? 'left' : 'right',
      acceleration01: strike.acceleration01,
      velocity01: strike.velocity01,
      nowMs: atMs,
      energy,
      isNewPeak: strike.isNewPeak,
      isPhraseEnding: strike.isPhraseEnding,
    })
    energy = result.energy
    gestures.push(result.gesture)

    for (const hit of result.gesture.hits) {
      mix.add(clipFor(hit.articulation), index * gapSamples, hit.midiVelocity / 127)
    }

    const label = FAMILY_LABEL[result.gesture.family ?? ''] ?? 'GENERIC'
    const body = result.gesture.target === 'body' ? ' BODY' : ''
    const pieces = result.gesture.hits.map((h) => `${h.articulation}@${h.midiVelocity}`).join(' + ')
    key.push(
      `${String(index + 1).padStart(2)}  ${strike.token.padEnd(2)}  ${(label + body).padEnd(13)} ${pieces}`,
    )
  }

  return { samples: mix.normalized(), key, gestures }
}

/** All twelve at fixed intensity: a signature that needs full power is not one. */
function twelveSignatures(): AuditionStrike[] {
  return STRIKE_TOKENS.map((token) => ({
    token,
    velocity01: 0.5,
    acceleration01: 0.6,
  }))
}

/** §35's decisive scenario, with the contour a real combination has. */
function decisiveScenario(): AuditionStrike[] {
  const tokens: StrikeToken[] = ['1', '1', '2', '3', '2', '5', '6', '2B']
  return tokens.map((token, index) => {
    const last = index === tokens.length - 1
    return {
      token,
      // Combinations build: the setup jabs are light, the finish is hard.
      velocity01: last ? 0.92 : 0.42 + index * 0.06,
      acceleration01: last ? 0.95 : 0.5 + index * 0.05,
      // "The final strike of a completed eight-hit phrase" is a §4 crash
      // trigger — this is the scenario that proves the reservation works.
      isPhraseEnding: last,
    }
  })
}

function write(outDir: string, name: string, audition: RenderedAudition, title: string): void {
  const file = path.join(outDir, `${name}.wav`)
  fs.writeFileSync(file, wavBytes(audition.samples))
  const seconds = (audition.samples.length / SAMPLE_RATE).toFixed(1)
  console.log('')
  console.log(`  ${title}`)
  console.log(`  ${file}  (${seconds}s)`)
  console.log('  ── key ──')
  for (const line of audition.key) console.log(`  ${line}`)
}

function main(): void {
  const repoRoot = path.resolve(__dirname, '..', '..', '..')
  const outDir = path.join(repoRoot, 'tools', 'analysis', 'kit-audition')
  fs.mkdirSync(outDir, { recursive: true })

  const gapMs = Number.parseInt(arg('--gap') ?? '0', 10)
  const sequenceArg = arg('--sequence')

  if (sequenceArg) {
    const tokens = sequenceArg.split(',').map((t) => t.trim().toUpperCase() as StrikeToken)
    const strikes: AuditionStrike[] = tokens.map((token) => ({
      token,
      velocity01: 0.5,
      acceleration01: 0.6,
    }))
    write(outDir, 'audition-custom', renderAudition(strikes, gapMs || 500), `CUSTOM  ${sequenceArg}`)
    return
  }

  write(
    outDir,
    'audition-twelve',
    renderAudition(twelveSignatures(), gapMs || 1200),
    'TWELVE SIGNATURES — fixed intensity, §5.1 table order',
  )
  write(
    outDir,
    'audition-scenario',
    renderAudition(decisiveScenario(), gapMs || 480),
    'DECISIVE SCENARIO §35 — 1-1-2-3-2-5-6-2B',
  )
  console.log('')
}

if (require.main === module) {
  main()
}

export { decisiveScenario, renderAudition, twelveSignatures, type AuditionStrike }
