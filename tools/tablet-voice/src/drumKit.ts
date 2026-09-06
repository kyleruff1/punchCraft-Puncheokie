/**
 * The Punch Kit's sixteen rendered articulations (drum-kit-design §6).
 *
 * Kyle's constraint on this whole mode: "we're going to need to render the
 * wave files that we're using." The tablet is the only shipping output and
 * Superior Drummer is a desktop plugin, so every logical articulation the
 * domain can name needs an actual WAV behind it here.
 *
 * Three engines cover all sixteen, because the existing five drums already
 * contained all three:
 *
 *   pitched membrane   sine sweep + amplitude decay   kicks, toms
 *   noise + body       tonal fundamental + noise, LP  snares, rim
 *   metal              high-passed noise + partials   ride, crash, hats
 *
 * The high-pass is the one primitive that looks missing and isn't:
 * `renderCrash` already builds it by subtraction (noise minus its own
 * low-pass), so the hats and ride get their band by composing that with a
 * second low-pass rather than by adding a new filter.
 *
 * FAITHFULNESS GATE: the five drums the bank ships today are five of these
 * sixteen specs — `kick-main`, `snare-center`, `rim-click`, `floor-tom-high`
 * and `crash-main` reproduce `renderKick`/`renderSnare`/`renderRim`/
 * `renderTom`/`renderCrash` SAMPLE FOR SAMPLE. The test asserts it. That is
 * what makes this a generalisation of the shipped sound rather than a
 * plausible-sounding rewrite of it.
 *
 * Deterministic and side-effect free, like the rest of the tool: seeded
 * mulberry32 is the only noise source, no Date.now(), no Math.random().
 */
import type { LogicalDrumArticulation } from '../../../src/domain/instrument/drums/logicalDrumArticulations'
import { biquadLowpass, mulberry32, SAMPLE_RATE } from './dsp'

const MS = SAMPLE_RATE / 1000 // 48 samples per millisecond

/** Linear fade over the final `fadeSamples`, ending EXACTLY at 0. */
function applyEndFade(buffer: Float64Array, fadeSamples: number): void {
  const len = buffer.length
  for (let i = len - fadeSamples; i < len; i += 1) {
    buffer[i] = (buffer[i] ?? 0) * ((len - 1 - i) / fadeSamples) + 0
  }
}

function finish(buffer: Float64Array, fadeSamples: number, trim: number): Float64Array {
  applyEndFade(buffer, fadeSamples)
  for (let n = 0; n < buffer.length; n += 1) buffer[n] = (buffer[n] ?? 0) * trim + 0
  return buffer
}

function seededNoise(seed: number, length: number): Float64Array {
  const out = new Float64Array(length)
  const rand = mulberry32(seed)
  for (let n = 0; n < length; n += 1) out[n] = 2 * rand() - 1
  return out
}

// ---------------------------------------------------------------------------
// Engine 1 · pitched membrane — kicks and toms.
// ---------------------------------------------------------------------------

export interface MembraneSpec {
  kind: 'membrane'
  lengthSamples: number
  /** Sweep start; the transient's perceived pitch. */
  startHz: number
  /** Sweep destination; the note the drum settles on. */
  endHz: number
  /** How fast the pitch falls — the drum's "thump" vs its "boom". */
  pitchTauS: number
  /** Amplitude decay. */
  ampTauS: number
  fadeSamples: number
  trim: number
}

function renderMembrane(spec: MembraneSpec): Float64Array {
  const out = new Float64Array(spec.lengthSamples)
  const sweep = spec.startHz - spec.endHz
  let phase = 0
  for (let n = 0; n < spec.lengthSamples; n += 1) {
    const t = n / SAMPLE_RATE
    const f = spec.endHz + sweep * Math.exp(-t / spec.pitchTauS)
    out[n] = Math.sin(phase) * Math.exp(-t / spec.ampTauS)
    phase += (2 * Math.PI * f) / SAMPLE_RATE
  }
  return finish(out, spec.fadeSamples, spec.trim)
}

// ---------------------------------------------------------------------------
// Engine 2 · noise + tonal body — snares and the rim click.
// ---------------------------------------------------------------------------

export interface NoiseBodySpec {
  kind: 'noise-body'
  lengthSamples: number
  seed: number
  /** The shell's fundamental. */
  bodyHz: number
  bodyLevel: number
  bodyTauS: number
  noiseLevel: number
  noiseTauS: number
  /** Post-mix low-pass — how bright the snares are. */
  lowpassHz: number
  lowpassQ: number
  fadeSamples: number
  trim: number
}

function renderNoiseBody(spec: NoiseBodySpec): Float64Array {
  const raw = new Float64Array(spec.lengthSamples)
  const noise = seededNoise(spec.seed, spec.lengthSamples)
  for (let n = 0; n < spec.lengthSamples; n += 1) {
    const t = n / SAMPLE_RATE
    raw[n] =
      spec.bodyLevel * Math.sin(2 * Math.PI * spec.bodyHz * t) * Math.exp(-t / spec.bodyTauS) +
      spec.noiseLevel * (noise[n] ?? 0) * Math.exp(-t / spec.noiseTauS)
  }
  const out = biquadLowpass(raw, spec.lowpassHz, spec.lowpassQ)
  return finish(out, spec.fadeSamples, spec.trim)
}

// ---------------------------------------------------------------------------
// Engine 3 · metal — ride, crash, hats.
// ---------------------------------------------------------------------------

export interface MetalPartial {
  hz: number
  level: number
  tauS: number
}

export interface MetalSpec {
  kind: 'metal'
  lengthSamples: number
  seed: number
  /** High-pass by subtraction: noise minus its own low-pass at this cutoff. */
  highpassHz: number
  highpassQ: number
  /** Optional band limit above the high-pass — what closes a hi-hat. */
  bandLimitHz?: number
  bandLimitQ?: number
  noiseTauS: number
  /**
   * Inharmonic partials. These are what separate a ride from a crash: the
   * crash is pure wash, the ride has a defined stick ping over its wash.
   */
  partials: readonly MetalPartial[]
  fadeSamples: number
  trim: number
}

function renderMetal(spec: MetalSpec): Float64Array {
  const noise = seededNoise(spec.seed, spec.lengthSamples)
  const low = biquadLowpass(noise, spec.highpassHz, spec.highpassQ)
  const wash = new Float64Array(spec.lengthSamples)
  for (let n = 0; n < spec.lengthSamples; n += 1) {
    wash[n] = (noise[n] ?? 0) - (low[n] ?? 0)
  }
  const banded =
    spec.bandLimitHz === undefined
      ? wash
      : biquadLowpass(wash, spec.bandLimitHz, spec.bandLimitQ ?? 0.707)
  const out = new Float64Array(spec.lengthSamples)
  for (let n = 0; n < spec.lengthSamples; n += 1) {
    const t = n / SAMPLE_RATE
    let sample = (banded[n] ?? 0) * Math.exp(-t / spec.noiseTauS)
    for (const partial of spec.partials) {
      sample += partial.level * Math.sin(2 * Math.PI * partial.hz * t) * Math.exp(-t / partial.tauS)
    }
    out[n] = sample
  }
  return finish(out, spec.fadeSamples, spec.trim)
}

export type DrumKitSpec = MembraneSpec | NoiseBodySpec | MetalSpec

/**
 * The sixteen. Register order is deliberate and audible: the rack toms sit
 * above the floor toms so a hook-to-uppercut phrase descends (§16), and the
 * ride family shares a partial series so the bell reads as the same cymbal
 * struck differently rather than as a second instrument.
 */
export const DRUM_KIT_SPECS: Readonly<Record<LogicalDrumArticulation, DrumKitSpec>> = {
  // -- ride family: one cymbal, three ways to hit it -------------------------
  'ride-bow': {
    kind: 'metal',
    lengthSamples: 700 * MS,
    seed: 2001,
    highpassHz: 2000,
    highpassQ: 0.707,
    noiseTauS: 0.22, // the wash ducks away and leaves the ping
    partials: [
      { hz: 523, level: 0.24, tauS: 0.5 },
      { hz: 781, level: 0.13, tauS: 0.42 },
      { hz: 1174, level: 0.08, tauS: 0.34 },
    ],
    fadeSamples: 960,
    trim: 0.4,
  },
  'ride-bell': {
    kind: 'metal',
    lengthSamples: 800 * MS,
    seed: 2002,
    highpassHz: 2600,
    highpassQ: 0.707,
    noiseTauS: 0.16, // less wash, more bell
    partials: [
      { hz: 622, level: 0.34, tauS: 0.62 },
      { hz: 933, level: 0.2, tauS: 0.52 },
      { hz: 1397, level: 0.12, tauS: 0.4 },
    ],
    fadeSamples: 960,
    trim: 0.46,
  },
  'ride-tight': {
    // §18: what a jab flurry falls back to when the ride tail piles up.
    kind: 'metal',
    lengthSamples: 300 * MS,
    seed: 2003,
    highpassHz: 2400,
    highpassQ: 0.707,
    noiseTauS: 0.1,
    partials: [
      { hz: 523, level: 0.2, tauS: 0.16 },
      { hz: 781, level: 0.1, tauS: 0.13 },
    ],
    fadeSamples: 480,
    trim: 0.38,
  },
  // -- snare family ----------------------------------------------------------
  'snare-center': {
    // Reproduces renderSnare() exactly.
    kind: 'noise-body',
    lengthSamples: 250 * MS,
    seed: 1001,
    bodyHz: 190,
    bodyLevel: 0.5,
    bodyTauS: 0.06,
    noiseLevel: 0.5,
    noiseTauS: 0.08,
    lowpassHz: 6500,
    lowpassQ: 0.707,
    fadeSamples: 480,
    trim: 0.7,
  },
  'snare-rimshot': {
    // §9's cross peak: brighter, shorter, and it CRACKS.
    kind: 'noise-body',
    lengthSamples: 225 * MS,
    seed: 1011,
    bodyHz: 330,
    bodyLevel: 0.42,
    bodyTauS: 0.035,
    noiseLevel: 0.58,
    noiseTauS: 0.05,
    lowpassHz: 9000,
    lowpassQ: 0.9,
    fadeSamples: 480,
    trim: 0.78,
  },
  'snare-body': {
    // §5.1's "lower/darker snare hit" for the body cross.
    kind: 'noise-body',
    lengthSamples: 275 * MS,
    seed: 1012,
    bodyHz: 150,
    bodyLevel: 0.58,
    bodyTauS: 0.075,
    noiseLevel: 0.42,
    noiseTauS: 0.09,
    lowpassHz: 4200,
    lowpassQ: 0.707,
    fadeSamples: 480,
    trim: 0.68,
  },
  // -- toms: a descending ladder, rack above floor (§4) ----------------------
  'rack-tom-high': {
    kind: 'membrane',
    lengthSamples: 350 * MS,
    startHz: 260,
    endHz: 150,
    pitchTauS: 0.1,
    ampTauS: 0.15,
    fadeSamples: 480,
    trim: 0.6,
  },
  'rack-tom-mid': {
    kind: 'membrane',
    lengthSamples: 400 * MS,
    startHz: 210,
    endHz: 120,
    pitchTauS: 0.11,
    ampTauS: 0.17,
    fadeSamples: 480,
    trim: 0.61,
  },
  'floor-tom-high': {
    // Reproduces renderTom() exactly.
    kind: 'membrane',
    lengthSamples: 450 * MS,
    startHz: 165,
    endHz: 88,
    pitchTauS: 0.13,
    ampTauS: 0.19,
    fadeSamples: 480,
    trim: 0.62,
  },
  'floor-tom-low': {
    kind: 'membrane',
    lengthSamples: 550 * MS,
    startHz: 130,
    endHz: 66,
    pitchTauS: 0.15,
    ampTauS: 0.23,
    fadeSamples: 480,
    trim: 0.64,
  },
  // -- kicks -----------------------------------------------------------------
  'kick-main': {
    // Reproduces renderKick() exactly.
    kind: 'membrane',
    lengthSamples: 400 * MS,
    startHz: 110,
    endHz: 42,
    pitchTauS: 0.075,
    ampTauS: 0.12,
    fadeSamples: 480,
    trim: 0.7,
  },
  'kick-sub': {
    // Groove low-end reinforcement: deeper and longer than the main kick.
    kind: 'membrane',
    lengthSamples: 500 * MS,
    startHz: 80,
    endHz: 33,
    pitchTauS: 0.09,
    ampTauS: 0.17,
    fadeSamples: 480,
    trim: 0.72,
  },
  // -- hats: the generated backbone (§4, §12) --------------------------------
  'hihat-closed': {
    kind: 'metal',
    lengthSamples: 100 * MS,
    seed: 2011,
    highpassHz: 6000,
    highpassQ: 0.707,
    bandLimitHz: 12000,
    noiseTauS: 0.028,
    partials: [],
    fadeSamples: 240,
    trim: 0.5,
  },
  'hihat-open': {
    kind: 'metal',
    lengthSamples: 450 * MS,
    seed: 2012,
    highpassHz: 5500,
    highpassQ: 0.707,
    bandLimitHz: 13000,
    noiseTauS: 0.22,
    partials: [],
    fadeSamples: 480,
    trim: 0.45,
  },
  // -- crash: reserved for genuine peaks (§4) --------------------------------
  'crash-main': {
    // Reproduces renderCrash() exactly.
    kind: 'metal',
    lengthSamples: 1500 * MS,
    seed: 1003,
    highpassHz: 800,
    highpassQ: 0.707,
    noiseTauS: 0.35,
    partials: [],
    fadeSamples: 960,
    trim: 0.45,
  },
  // -- percussion ------------------------------------------------------------
  'rim-click': {
    // Reproduces renderRim() exactly.
    kind: 'noise-body',
    lengthSamples: 120 * MS,
    seed: 1002,
    bodyHz: 820,
    bodyLevel: 0.4,
    bodyTauS: 0.03,
    noiseLevel: 0.7,
    noiseTauS: 0.025,
    lowpassHz: 7000,
    lowpassQ: 1.0,
    fadeSamples: 240,
    trim: 0.7,
  },
}

/** Render one logical articulation. Deterministic. */
export function renderDrumArticulation(articulation: LogicalDrumArticulation): Float64Array {
  const spec = DRUM_KIT_SPECS[articulation]
  switch (spec.kind) {
    case 'membrane':
      return renderMembrane(spec)
    case 'noise-body':
      return renderNoiseBody(spec)
    case 'metal':
      return renderMetal(spec)
  }
}

export function drumArticulationLength(articulation: LogicalDrumArticulation): number {
  return DRUM_KIT_SPECS[articulation].lengthSamples
}
