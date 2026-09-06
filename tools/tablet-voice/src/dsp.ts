/**
 * Pure DSP primitives for the tablet instrument bank renderer (M40-15 #319).
 *
 * Everything here is deterministic and side-effect free: no fs, no
 * Date.now(), no Math.random() — noise comes from the seeded mulberry32
 * PRNG, so rendering the bank twice yields byte-identical wavs (the
 * determinism test's contract is same-machine byte-identity; Math.sin/exp
 * are fine under it).
 *
 * All rendering happens in Float64Array at 48 kHz; conversion to 16-bit
 * PCM happens only in `wavBytes`.
 */
import type { AdsrSpec, OscSpec } from './textures'

export const SAMPLE_RATE = 48000

/** Pinned drum one-shot lengths, in samples (spec §3). */
export const DRUM_SAMPLES = {
  kick: 19200,
  snare: 12000,
  rim: 5760,
  crash: 72000,
} as const

export function midiToHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12)
}

/** The standard mulberry32 PRNG, pinned verbatim — the tool's only noise source. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Additive band-limited saw stack. For each oscillator:
 * `f_o = frequencyHz * 2 ** (detuneCents / 1200)`, harmonics
 * `k = 1..K` with `K = floor(21600 / f_o)` (21600 = 0.45 * 48000 — nothing
 * above 21.6 kHz), summed as `level * (2/pi) * sin(2*pi*k*f_o*n/48000) / k`.
 * Phase starts at 0, so sample[0] is EXACTLY 0 — load-bearing for the
 * zero-amplitude loop boundaries. Naive form on purpose (offline tool):
 * per-harmonic recurrences would have to be byte-identical to this.
 */
export function renderSawStack(
  frequencyHz: number,
  oscillators: readonly OscSpec[],
  numSamples: number,
): Float64Array {
  const out = new Float64Array(numSamples)
  for (const osc of oscillators) {
    const f = frequencyHz * 2 ** (osc.detuneCents / 1200)
    const harmonics = Math.floor(21600 / f)
    for (let n = 0; n < numSamples; n += 1) {
      let sum = 0
      for (let k = 1; k <= harmonics; k += 1) {
        sum += Math.sin((2 * Math.PI * k * f * n) / SAMPLE_RATE) / k
      }
      out[n] = (out[n] ?? 0) + osc.level * (2 / Math.PI) * sum
    }
  }
  return out
}

/**
 * RBJ cookbook low-pass biquad, Direct Form I, fresh (zero) state per call.
 */
export function biquadLowpass(input: Float64Array, cutoffHz: number, q: number): Float64Array {
  const w0 = (2 * Math.PI * cutoffHz) / SAMPLE_RATE
  const alpha = Math.sin(w0) / (2 * q)
  const cosW0 = Math.cos(w0)
  const a0 = 1 + alpha
  const b0 = (1 - cosW0) / 2 / a0
  const b1 = (1 - cosW0) / a0
  const b2 = (1 - cosW0) / 2 / a0
  const a1 = (-2 * cosW0) / a0
  const a2 = (1 - alpha) / a0
  const out = new Float64Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let n = 0; n < input.length; n += 1) {
    const x0 = input[n] ?? 0
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    out[n] = y0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
  }
  return out
}

/**
 * ADSR envelope over `totalSamples`, gated at `gateSamples`.
 *
 * Semantics (normative, spec §3):
 * - linear attack 0 -> 1 over `round(attackMs*48)` samples (last attack
 *   sample is exactly 1);
 * - decay from 1 toward `sustain` over `round(decayMs*48)` samples with
 *   `level = sustain + (1-sustain)*(1-t)^2`, t in (0,1] — hits sustain
 *   EXACTLY at the final decay sample;
 * - hold `sustain` until `gateSamples`; if the gate lands mid-attack or
 *   mid-decay, release starts FROM THE CURRENT VALUE;
 * - release over `round(releaseMs*48)` samples (truncated to what fits in
 *   `totalSamples` — this is how the bed final-step release clamp bites)
 *   with `level = startLevel*(1-t)^2`, t = (n+1)/releaseSamples, so the
 *   LAST release sample is exactly 0;
 * - sustain-0 rule: when `sustain === 0 && releaseMs === 0`, effective
 *   decay = `min(decaySamples, gateSamples - attackSamples)` and the
 *   envelope ends at attack+decayEff — decay-to-silence INSIDE the gate
 *   (the pluck-bed contract; the quadratic hits 0 exactly at its final
 *   sample). Everything after an envelope's end is 0.
 */
export function adsrEnvelope(
  totalSamples: number,
  gateSamples: number,
  adsr: AdsrSpec,
): Float64Array {
  const out = new Float64Array(totalSamples)
  const attackSamples = Math.round(adsr.attackMs * 48)
  const decaySamplesNominal = Math.round(adsr.decayMs * 48)
  const sustain0 = adsr.sustain === 0 && adsr.releaseMs === 0
  const decaySamples = sustain0
    ? Math.max(0, Math.min(decaySamplesNominal, gateSamples - attackSamples))
    : decaySamplesNominal

  /** Envelope value while the gate is open (attack -> decay -> sustain hold). */
  const preReleaseLevel = (n: number): number => {
    if (n < 0) return 0
    if (n < attackSamples) return (n + 1) / attackSamples
    if (n < attackSamples + decaySamples) {
      const t = (n - attackSamples + 1) / decaySamples
      return adsr.sustain + (1 - adsr.sustain) * (1 - t) * (1 - t)
    }
    return adsr.sustain
  }

  if (sustain0) {
    const end = Math.min(totalSamples, attackSamples + decaySamples)
    for (let n = 0; n < end; n += 1) {
      out[n] = preReleaseLevel(n)
    }
    return out
  }

  const gateEnd = Math.min(gateSamples, totalSamples)
  for (let n = 0; n < gateEnd; n += 1) {
    out[n] = preReleaseLevel(n)
  }
  const releaseSamples = Math.min(
    Math.round(adsr.releaseMs * 48),
    Math.max(0, totalSamples - gateSamples),
  )
  if (releaseSamples > 0) {
    const startLevel = preReleaseLevel(gateSamples - 1)
    for (let i = 0; i < releaseSamples; i += 1) {
      const t = (i + 1) / releaseSamples
      out[gateSamples + i] = startLevel * (1 - t) * (1 - t)
    }
  }
  return out
}

/**
 * Canonical 44-byte-header 48 kHz 16-bit mono PCM WAV.
 * int16 = round(x * 32767) clamped to [-32768, 32767].
 */
export function wavBytes(samples: Float64Array): Buffer {
  const dataBytes = samples.length * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // fmt chunk size
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  for (let n = 0; n < samples.length; n += 1) {
    const clamped = Math.max(-32768, Math.min(32767, Math.round((samples[n] ?? 0) * 32767)))
    buf.writeInt16LE(clamped, 44 + n * 2)
  }
  return buf
}

/** Linear fade over the final `fadeSamples`, ending EXACTLY at 0 (`+ 0` normalizes -0). */
function applyEndFade(buffer: Float64Array, fadeSamples: number): void {
  const len = buffer.length
  for (let i = len - fadeSamples; i < len; i += 1) {
    buffer[i] = (buffer[i] ?? 0) * ((len - 1 - i) / fadeSamples) + 0
  }
}

/** Kick (MIDI 36): sine sweep 110 -> 42 Hz, phase-accumulated; 400 ms. */
export function renderKick(): Float64Array {
  const len = DRUM_SAMPLES.kick
  const out = new Float64Array(len)
  let phase = 0
  for (let n = 0; n < len; n += 1) {
    const t = n / SAMPLE_RATE
    const f = 42 + 68 * Math.exp(-t / 0.075)
    out[n] = Math.sin(phase) * Math.exp(-t / 0.12)
    phase += (2 * Math.PI * f) / SAMPLE_RATE
  }
  applyEndFade(out, 480)
  for (let n = 0; n < len; n += 1) out[n] = (out[n] ?? 0) * 0.7 + 0
  return out
}

/** Snare (MIDI 38): 190 Hz body + seeded noise, low-passed; 250 ms. */
export function renderSnare(): Float64Array {
  const len = DRUM_SAMPLES.snare
  const raw = new Float64Array(len)
  const rand = mulberry32(1001)
  for (let n = 0; n < len; n += 1) {
    const t = n / SAMPLE_RATE
    const noise = 2 * rand() - 1
    raw[n] =
      0.5 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.06) +
      0.5 * noise * Math.exp(-t / 0.08)
  }
  const out = biquadLowpass(raw, 6500, 0.707)
  applyEndFade(out, 480)
  for (let n = 0; n < len; n += 1) out[n] = (out[n] ?? 0) * 0.7 + 0
  return out
}

/** Rim (MIDI 37): noise burst + 820 Hz ping, low-passed; 120 ms. */
export function renderRim(): Float64Array {
  const len = DRUM_SAMPLES.rim
  const raw = new Float64Array(len)
  const rand = mulberry32(1002)
  for (let n = 0; n < len; n += 1) {
    const t = n / SAMPLE_RATE
    const noise = 2 * rand() - 1
    raw[n] =
      0.7 * noise * Math.exp(-t / 0.025) + 0.4 * Math.sin(2 * Math.PI * 820 * t) * Math.exp(-t / 0.03)
  }
  const out = biquadLowpass(raw, 7000, 1.0)
  applyEndFade(out, 240)
  for (let n = 0; n < len; n += 1) out[n] = (out[n] ?? 0) * 0.7 + 0
  return out
}

/** Crash (MIDI 49): high-passed noise (noise minus its LP-800) with a long tail; 1.5 s. */
export function renderCrash(): Float64Array {
  const len = DRUM_SAMPLES.crash
  const noise = new Float64Array(len)
  const rand = mulberry32(1003)
  for (let n = 0; n < len; n += 1) {
    noise[n] = 2 * rand() - 1
  }
  const low = biquadLowpass(noise, 800, 0.707)
  const out = new Float64Array(len)
  for (let n = 0; n < len; n += 1) {
    const t = n / SAMPLE_RATE
    out[n] = ((noise[n] ?? 0) - (low[n] ?? 0)) * Math.exp(-t / 0.35)
  }
  applyEndFade(out, 960)
  for (let n = 0; n < len; n += 1) out[n] = (out[n] ?? 0) * 0.45 + 0
  return out
}
