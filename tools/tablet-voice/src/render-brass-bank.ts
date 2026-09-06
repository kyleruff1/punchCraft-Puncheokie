/**
 * Render the tablet instrument sample bank (M40-15 #319).
 *
 *   npx tsx tools/tablet-voice/src/render-brass-bank.ts
 *
 * Renders, PER TEXTURE in the registry (tools/tablet-voice/src/textures.ts),
 * to assets/audio/instrument/<textureId>/:
 *   - 24 arp-bed loops (6 chords x 4 activity layers, Punch Weave over the
 *     chord's NATURAL pool — rotation 0, the documented v1 stance; rotation
 *     is voiced by the accent stab at runtime),
 *   - 6 bass loops (chord root -2 octaves),
 *   - one-shot stabs for every accent-reachable note (the union of
 *     startMidiNote over the 36 compiled cells),
 * plus 4 drum one-shots rendered ONCE to assets/audio/instrument/shared/
 * (conscious dedupe: drum synthesis is texture-independent, so per-texture
 * copies would be byte-identical bloat), and emits the static require-map
 * src/audio/voiceAssets/instrumentBankManifest.ts.
 *
 * Every musical number is COMPUTED from the shipped domain code
 * (src/domain/instrument/brassCube.ts via compileBrassCube on the
 * dorian-brass-cube launch patch) — pools, bass notes, pattern, ladder
 * rates/gates/depths, accent gate. Nothing is hardcoded here.
 *
 * Loop math is done in SAMPLES, where it is exact: stepSamples =
 * 48000*60/notesPerMinute (asserted integral — this resolves the
 * 333.33ms x 6 rounding question; 60000/180 ms is exactly 16000 samples).
 *
 * The brass bass is an integer-period fit: cycles = round(2s * f),
 * loopSamples = round(cycles * 48000 / f), rendered at fRender =
 * cycles * 48000 / loopSamples (<= 0.01 cent off nominal) — seamless by
 * PERIODICITY, not by zero amplitude. Its abrupt onset at a chord swap is
 * masked by the accent stab + drum that fire on the same punch.
 *
 * Deterministic and idempotent: running twice yields byte-identical wavs
 * and manifest.
 */
import fs from 'fs'
import path from 'path'

import {
  bassKey,
  bedKey,
  INSTRUMENT_DRUM_KEYS,
  stabKey,
  type InstrumentDrumKey,
} from '../../../src/audio/instrumentBankKeys'
import { compileBrassCube } from '../../../src/domain/instrument/brassCube'
import { launchPatchById } from '../../../src/domain/instrument/punchPatch'
import {
  adsrEnvelope,
  biquadLowpass,
  DRUM_SAMPLES,
  midiToHz,
  renderCrash,
  renderKick,
  renderRim,
  renderSawStack,
  renderSnare,
  renderTom,
  wavBytes,
} from './dsp'
import { TEXTURES, type TextureDefinition } from './textures'

export interface BedPlanEntry {
  kind: 'bed'
  textureId: string
  key: string
  fileName: string
  leftZone: number
  layer: number
  chordName: string
  stepSamples: number
  gateSamples: number
  loopSamples: number
  /** MIDI note per step k (step k starts at k * stepSamples). */
  notes: readonly number[]
}

export interface BassPlanEntry {
  kind: 'bass'
  textureId: string
  key: string
  fileName: string
  leftZone: number
  midiNote: number
  mode: 'sustain-loop' | 'restruck-decay'
  loopSamples: number
  /** sustain-loop only: whole periods per loop. */
  cycles: number | null
  /** sustain-loop only: exact-period render frequency, cycles*48000/loopSamples. */
  renderHz: number | null
}

export interface StabPlanEntry {
  kind: 'stab'
  textureId: string
  key: string
  fileName: string
  midiNote: number
  gateSamples: number
  totalSamples: number
}

export interface DrumPlanEntry {
  kind: 'drum'
  key: InstrumentDrumKey
  fileName: string
  samples: number
}

export type BankPlanEntry = BedPlanEntry | BassPlanEntry | StabPlanEntry | DrumPlanEntry

export interface TextureBankPlan {
  textureId: string
  beds: readonly BedPlanEntry[]
  basses: readonly BassPlanEntry[]
  stabs: readonly StabPlanEntry[]
}

export interface BankPlan {
  /** Registry keys, sorted — the generated manifest's texture-id union. */
  textureIds: readonly string[]
  textures: readonly TextureBankPlan[]
  drums: readonly DrumPlanEntry[]
}

function textureOf(textureId: string): TextureDefinition {
  const texture = TEXTURES[textureId]
  if (!texture) throw new Error(`unknown texture "${textureId}"`)
  return texture
}

function isSustainZero(adsr: { sustain: number; releaseMs: number }): boolean {
  return adsr.sustain === 0 && adsr.releaseMs === 0
}

/**
 * Enumerate every bank file with its synth parameters — pure, everything
 * computed from the compiled dorian-brass-cube map + the texture registry.
 */
export function buildBankPlan(): BankPlan {
  const map = compileBrassCube(launchPatchById('dorian-brass-cube'))
  const textureIds = Object.keys(TEXTURES).sort()

  // Accent-reachable notes. Every family's stab role resolves to some
  // naturalPool[k], and naturalPool[k] IS the entry tone of cell (chord,
  // Rk) — so the whole role axis is covered by the cells' startMidiNotes.
  // BODY shots then drop an octave (M40-25), and those notes are NOT in
  // that set, so a body stab would find no clip and sound silent. Include
  // the octave-down range: 18 notes becomes 25, about +0.2 MB per texture.
  const headNotes = [...new Set(map.cells.map((cell) => cell.startMidiNote))]
  const stabNotes = [...new Set([...headNotes, ...headNotes.map((n) => n - 12)])]
    .filter((n) => n >= 0 && n <= 127)
    .sort((a, b) => a - b)

  const accentGateSamples = map.accentGateMs * 48

  const textures = textureIds.map((textureId): TextureBankPlan => {
    const texture = textureOf(textureId)

    const beds: BedPlanEntry[] = []
    const basses: BassPlanEntry[] = []
    for (let leftZone = 0; leftZone < 6; leftZone += 1) {
      const cell = map.cells[leftZone * 6]
      if (!cell) throw new Error(`compiled map missing cell L${leftZone}R0`)
      const pool = cell.naturalPool

      for (const ladder of map.activityLayers) {
        if ((48000 * 60) % ladder.notesPerMinute !== 0) {
          throw new Error(
            `notesPerMinute ${ladder.notesPerMinute} does not divide 48000*60 — ` +
              'update the rounding rule before rendering',
          )
        }
        const stepSamples = (48000 * 60) / ladder.notesPerMinute
        const gateSamples = Math.round(stepSamples * ladder.gateRatio)
        const depth = ladder.patternDepth
        const effLen = Math.max(1, Math.min(depth, map.pattern.length))
        const notes: number[] = []
        for (let k = 0; k < depth; k += 1) {
          const poolIndex = map.pattern[k % effLen]
          if (poolIndex === undefined) throw new Error(`pattern index ${k % effLen} missing`)
          const note = pool[poolIndex]
          if (note === undefined) throw new Error(`pool index ${poolIndex} missing for L${leftZone}`)
          notes.push(note)
        }
        const key = bedKey(leftZone, ladder.layer)
        beds.push({
          kind: 'bed',
          textureId,
          key,
          fileName: `${key}.wav`,
          leftZone,
          layer: ladder.layer,
          chordName: cell.chordName,
          stepSamples,
          gateSamples,
          loopSamples: depth * stepSamples,
          notes,
        })
      }

      const midiNote = cell.bassMidiNote
      const key = bassKey(leftZone)
      if (texture.bass.mode === 'sustain-loop') {
        const f = midiToHz(midiNote)
        const cycles = Math.round(2.0 * f)
        const loopSamples = Math.round((cycles * 48000) / f)
        basses.push({
          kind: 'bass',
          textureId,
          key,
          fileName: `${key}.wav`,
          leftZone,
          midiNote,
          mode: 'sustain-loop',
          loopSamples,
          cycles,
          renderHz: (cycles * 48000) / loopSamples,
        })
      } else {
        basses.push({
          kind: 'bass',
          textureId,
          key,
          fileName: `${key}.wav`,
          leftZone,
          midiNote,
          mode: 'restruck-decay',
          loopSamples: 96000,
          cycles: null,
          renderHz: null,
        })
      }
    }

    const stabs = stabNotes.map((midiNote): StabPlanEntry => {
      const adsr = texture.stab.adsr
      const totalSamples = isSustainZero(adsr)
        ? Math.round(adsr.attackMs * 48) + Math.round(adsr.decayMs * 48)
        : accentGateSamples + Math.round(adsr.releaseMs * 48)
      const key = stabKey(midiNote)
      return {
        kind: 'stab',
        textureId,
        key,
        fileName: `${key}.wav`,
        midiNote,
        gateSamples: accentGateSamples,
        totalSamples,
      }
    })

    return { textureId, beds, basses, stabs }
  })

  const drums = INSTRUMENT_DRUM_KEYS.map(
    (key): DrumPlanEntry => ({
      kind: 'drum',
      key,
      fileName: `drum-${key}.wav`,
      samples: DRUM_SAMPLES[key],
    }),
  )

  return { textureIds, textures, drums }
}

function assertPeak(name: string, buffer: Float64Array): void {
  let peak = 0
  for (let n = 0; n < buffer.length; n += 1) {
    const value = Math.abs(buffer[n] ?? 0)
    if (value > peak) peak = value
  }
  if (!(peak <= 0.98)) {
    throw new Error(`${name}: peak ${peak.toFixed(4)} exceeds 0.98 — retune the texture trims`)
  }
}

function assertZero(name: string, buffer: Float64Array, index: number): void {
  if (buffer[index] !== 0) {
    throw new Error(`${name}: sample ${index} is ${buffer[index]}, expected exactly 0`)
  }
}

function renderBed(entry: BedPlanEntry): Float64Array {
  const role = textureOf(entry.textureId).bed
  const buffer = new Float64Array(entry.loopSamples)
  const attackSamples = Math.round(role.adsr.attackMs * 48)
  const decaySamples = Math.round(role.adsr.decayMs * 48)
  const releaseSamples = Math.round(role.adsr.releaseMs * 48)
  const sustainZero = isSustainZero(role.adsr)

  entry.notes.forEach((note, k) => {
    const start = k * entry.stepSamples
    // sustain-0: decay-to-silence inside the gate (attack + clamped decay).
    // sustain>0: gate + release, with the final-step boundary clamp — a
    // release that would spill past loopSamples is shortened to fit
    // (adsrEnvelope truncates its release window to totalSamples - gate, so
    // the shortened quadratic still ends at exactly 0). Tails may overlap
    // the NEXT step inside the loop (natural legato); nothing writes at
    // index >= loopSamples.
    const noteLen = sustainZero
      ? attackSamples + Math.max(0, Math.min(decaySamples, entry.gateSamples - attackSamples))
      : Math.min(entry.gateSamples + releaseSamples, entry.loopSamples - start)
    const sig = biquadLowpass(
      renderSawStack(midiToHz(note), role.oscillators, noteLen),
      role.filter.cutoffHz,
      role.filter.q,
    )
    const env = adsrEnvelope(noteLen, entry.gateSamples, role.adsr)
    for (let n = 0; n < noteLen; n += 1) {
      buffer[start + n] = (buffer[start + n] ?? 0) + (sig[n] ?? 0) * (env[n] ?? 0) * role.trim
    }
  })

  assertZero(entry.fileName, buffer, 0)
  assertZero(entry.fileName, buffer, entry.loopSamples - 1)
  return buffer
}

function renderBass(entry: BassPlanEntry): Float64Array {
  const role = textureOf(entry.textureId).bass
  if (entry.mode === 'sustain-loop') {
    if (entry.renderHz === null) throw new Error(`${entry.fileName}: sustain-loop without renderHz`)
    // Render 3 loop windows and KEEP THE SECOND: the warmup pass lets the
    // IIR filter converge to its periodic steady state (window 2 vs 3 differ
    // by <= 1/32767 peak — asserted in the tool tests).
    const total = 3 * entry.loopSamples
    const filtered = biquadLowpass(
      renderSawStack(entry.renderHz, role.oscillators, total),
      role.filter.cutoffHz,
      role.filter.q,
    )
    const out = new Float64Array(entry.loopSamples)
    for (let n = 0; n < entry.loopSamples; n += 1) {
      out[n] = (filtered[entry.loopSamples + n] ?? 0) * role.trim
    }
    return out
  }
  // restruck-decay: one enveloped strike at sample 0 in the fixed loop;
  // the remainder is silence, so the loop boundary is trivially zero.
  const attackSamples = Math.round(role.adsr.attackMs * 48)
  const decaySamples = Math.round(role.adsr.decayMs * 48)
  const noteLen = attackSamples + decaySamples
  if (noteLen > entry.loopSamples) {
    throw new Error(`${entry.fileName}: restruck strike (${noteLen}) exceeds loop`)
  }
  const sig = biquadLowpass(
    renderSawStack(midiToHz(entry.midiNote), role.oscillators, noteLen),
    role.filter.cutoffHz,
    role.filter.q,
  )
  const env = adsrEnvelope(noteLen, noteLen, role.adsr)
  const buffer = new Float64Array(entry.loopSamples)
  for (let n = 0; n < noteLen; n += 1) {
    buffer[n] = (sig[n] ?? 0) * (env[n] ?? 0) * role.trim + 0 // + 0 normalizes -0
  }
  assertZero(entry.fileName, buffer, 0)
  assertZero(entry.fileName, buffer, entry.loopSamples - 1)
  return buffer
}

function renderStab(entry: StabPlanEntry): Float64Array {
  const role = textureOf(entry.textureId).stab
  // sustain>0: gated one-shot (gate + release). sustain-0: an UNGATED
  // attack+decay one-shot — a stab is not a gated arp step, so the bed-only
  // "decay inside the gate" clamp does not apply.
  const envGate = isSustainZero(role.adsr) ? entry.totalSamples : entry.gateSamples
  const sig = biquadLowpass(
    renderSawStack(midiToHz(entry.midiNote), role.oscillators, entry.totalSamples),
    role.filter.cutoffHz,
    role.filter.q,
  )
  const env = adsrEnvelope(entry.totalSamples, envGate, role.adsr)
  const buffer = new Float64Array(entry.totalSamples)
  for (let n = 0; n < entry.totalSamples; n += 1) {
    buffer[n] = (sig[n] ?? 0) * (env[n] ?? 0) * role.trim + 0 // + 0 normalizes -0
  }
  assertZero(entry.fileName, buffer, 0)
  assertZero(entry.fileName, buffer, entry.totalSamples - 1)
  return buffer
}

function renderDrum(entry: DrumPlanEntry): Float64Array {
  switch (entry.key) {
    case 'kick':
      return renderKick()
    case 'snare':
      return renderSnare()
    case 'rim':
      return renderRim()
    case 'tom':
      return renderTom()
    case 'crash':
      return renderCrash()
  }
}

/** Render one plan entry to samples — pure and deterministic. */
export function renderEntry(entry: BankPlanEntry): Float64Array {
  let buffer: Float64Array
  switch (entry.kind) {
    case 'bed':
      buffer = renderBed(entry)
      break
    case 'bass':
      buffer = renderBass(entry)
      break
    case 'stab':
      buffer = renderStab(entry)
      break
    case 'drum':
      buffer = renderDrum(entry)
      break
  }
  assertPeak(entry.fileName, buffer)
  return buffer
}

const MANIFEST_RELATIVE_ASSET_DIR = '../../../assets/audio/instrument'

function clipLine(key: string, dir: string, fileName: string, samples: number): string {
  const quotedKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `'${key}'`
  const durationMs = Math.round(samples / 48)
  return `      ${quotedKey}: { module: require('${MANIFEST_RELATIVE_ASSET_DIR}/${dir}/${fileName}'), durationMs: ${durationMs} },`
}

/** Generated manifest source (src/audio/voiceAssets/instrumentBankManifest.ts). */
export function manifestSource(plan: BankPlan): string {
  const textureUnion = plan.textureIds.map((id) => `'${id}'`).join(' | ')
  const textureList = plan.textureIds.map((id) => `'${id}'`).join(', ')

  const banks = plan.textures
    .map((texture) => {
      const beds = texture.beds
        .map((entry) => clipLine(entry.key, texture.textureId, entry.fileName, entry.loopSamples))
        .join('\n')
      const basses = texture.basses
        .map((entry) => clipLine(entry.key, texture.textureId, entry.fileName, entry.loopSamples))
        .join('\n')
      const stabs = texture.stabs
        .map((entry) => clipLine(entry.key, texture.textureId, entry.fileName, entry.totalSamples))
        .join('\n')
      const drums = plan.drums
        .map((entry) => clipLine(entry.key, 'shared', entry.fileName, entry.samples))
        .join('\n')
      return [
        `  ${texture.textureId}: {`,
        `    textureId: '${texture.textureId}',`,
        '    beds: {',
        beds,
        '    },',
        '    basses: {',
        basses,
        '    },',
        '    stabs: {',
        stabs,
        '    },',
        '    drums: {',
        drums,
        '    },',
        '  },',
      ].join('\n')
    })
    .join('\n')

  return `/**
 * Tablet instrument sample bank (generated) — one bank per texture.
 *
 * DO NOT EDIT — produced by \`npx tsx tools/tablet-voice/src/render-brass-bank.ts\`.
 *
 * Every musical number is computed from src/domain/instrument/brassCube.ts
 * (compileBrassCube on the dorian-brass-cube launch patch) and the texture
 * registry in tools/tablet-voice/src/textures.ts. Drums are rendered ONCE
 * to assets/audio/instrument/shared/ and referenced by EVERY texture's bank
 * — drum synthesis is texture-independent, so per-texture copies would be
 * byte-identical bloat (conscious dedupe).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { InstrumentDrumKey } from '../instrumentBankKeys'

export type InstrumentTextureId = ${textureUnion}
export const INSTRUMENT_TEXTURE_IDS: readonly InstrumentTextureId[] = [${textureList}]

export interface InstrumentBankClip {
  /** Metro module id for the wav. */
  module: number
  /** Rendered clip length: round(sampleCount / 48) ms. */
  durationMs: number
}

export interface InstrumentBank {
  textureId: InstrumentTextureId
  /** \`bed-L{0..5}-A{0..3}\` — 24 entries. */
  beds: Readonly<Record<string, InstrumentBankClip>>
  /** \`bass-L{0..5}\` — 6 entries. */
  basses: Readonly<Record<string, InstrumentBankClip>>
  /** \`stab-{midi}\` — one per accent-reachable note (18 at launch). */
  stabs: Readonly<Record<string, InstrumentBankClip>>
  /** Shared modules — both textures point at assets/audio/instrument/shared/ (conscious dedupe). */
  drums: Readonly<Record<InstrumentDrumKey, InstrumentBankClip>>
}

export const INSTRUMENT_BANKS: Readonly<Record<InstrumentTextureId, InstrumentBank>> = {
${banks}
}
`
}

function main(): void {
  const repoRoot = path.resolve(__dirname, '..', '..', '..')
  const instrumentDir = path.join(repoRoot, 'assets', 'audio', 'instrument')
  const plan = buildBankPlan()

  for (const texture of plan.textures) {
    const dir = path.join(instrumentDir, texture.textureId)
    fs.mkdirSync(dir, { recursive: true })
    let bytes = 0
    let files = 0
    for (const entry of [...texture.beds, ...texture.basses, ...texture.stabs]) {
      const wav = wavBytes(renderEntry(entry))
      fs.writeFileSync(path.join(dir, entry.fileName), wav)
      bytes += wav.length
      files += 1
    }
    console.log(
      `${texture.textureId}: ${files} files, ${(bytes / 1e6).toFixed(2)} MB -> assets/audio/instrument/${texture.textureId}/`,
    )
  }

  const sharedDir = path.join(instrumentDir, 'shared')
  fs.mkdirSync(sharedDir, { recursive: true })
  let sharedBytes = 0
  for (const entry of plan.drums) {
    const wav = wavBytes(renderEntry(entry))
    fs.writeFileSync(path.join(sharedDir, entry.fileName), wav)
    sharedBytes += wav.length
  }
  console.log(
    `shared: ${plan.drums.length} files, ${(sharedBytes / 1e6).toFixed(2)} MB -> assets/audio/instrument/shared/`,
  )

  const manifestPath = path.join(repoRoot, 'src', 'audio', 'voiceAssets', 'instrumentBankManifest.ts')
  fs.writeFileSync(manifestPath, manifestSource(plan))
  console.log(`manifest -> src/audio/voiceAssets/instrumentBankManifest.ts`)
}

if (require.main === module) {
  main()
}
