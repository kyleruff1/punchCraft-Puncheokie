/**
 * DSP primitive contracts (spec §3): wav header golden, int16 edges, the
 * pinned mulberry32 stream, ADSR semantics (incl. the sustain-0 gate-clamp
 * rule), saw band limit + phase-0 start, biquad DC gain/stability, and the
 * pinned drum lengths ending at exactly 0.
 */
import {
  adsrEnvelope,
  biquadLowpass,
  DRUM_SAMPLES,
  midiToHz,
  mulberry32,
  renderCrash,
  renderKick,
  renderRim,
  renderSawStack,
  renderSnare,
  wavBytes,
} from '../src/dsp'

describe('wavBytes', () => {
  test('canonical 44-byte header for a 100-sample buffer', () => {
    const buf = wavBytes(new Float64Array(100))
    expect(buf.length).toBe(44 + 200)
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.readUInt32LE(4)).toBe(36 + 200)
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE')
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ')
    expect(buf.readUInt32LE(16)).toBe(16)
    expect(buf.readUInt16LE(20)).toBe(1) // PCM
    expect(buf.readUInt16LE(22)).toBe(1) // mono
    expect(buf.readUInt32LE(24)).toBe(48000)
    expect(buf.readUInt32LE(28)).toBe(96000) // byte rate
    expect(buf.readUInt16LE(32)).toBe(2) // block align
    expect(buf.readUInt16LE(34)).toBe(16) // bits
    expect(buf.toString('ascii', 36, 40)).toBe('data')
    expect(buf.readUInt32LE(40)).toBe(200)
  })

  test('int16 conversion rounds and clamps', () => {
    const buf = wavBytes(new Float64Array([0, 1, -1, 0.5, 2, -2]))
    const values = [0, 1, 2, 3, 4, 5].map((i) => buf.readInt16LE(44 + i * 2))
    expect(values).toEqual([0, 32767, -32767, 16384, 32767, -32768])
  })
})

describe('mulberry32', () => {
  test('seed 1001 produces the pinned stream', () => {
    const rand = mulberry32(1001)
    const values = [rand(), rand(), rand(), rand(), rand()]
    expect(values).toEqual([
      0.14117497857660055, 0.26740360795520246, 0.11109626526013017, 0.33289436250925064,
      0.6569510197732598,
    ])
  })
})

describe('adsrEnvelope', () => {
  const adsr = { attackMs: 1, decayMs: 1, sustain: 0.5, releaseMs: 1 }

  test('linear attack reaches exactly 1 at the last attack sample', () => {
    const env = adsrEnvelope(400, 300, adsr)
    expect(env[0]).toBeCloseTo(1 / 48, 12)
    expect(env[47]).toBe(1)
    for (let n = 1; n < 48; n += 1) {
      expect(env[n] ?? 0).toBeGreaterThan(env[n - 1] ?? 0)
    }
  })

  test('decay hits sustain exactly at its final sample, then holds', () => {
    const env = adsrEnvelope(400, 300, adsr)
    expect(env[95]).toBe(0.5) // attack 48 + decay 48 - 1
    expect(env[96]).toBe(0.5)
    expect(env[299]).toBe(0.5)
  })

  test('early gate releases from the current value', () => {
    // Gate lands mid-decay: attack 0, decay 480 samples, gate at 240.
    const early = { attackMs: 0, decayMs: 10, sustain: 0.2, releaseMs: 1 }
    const env = adsrEnvelope(400, 240, early)
    // Current value at the last gated sample: t = 240/480 -> 0.2 + 0.8*0.25.
    expect(env[239]).toBeCloseTo(0.4, 12)
    expect(env[240]).toBeCloseTo(0.4 * (1 - 1 / 48) ** 2, 12)
  })

  test('last release sample is exactly 0', () => {
    const env = adsrEnvelope(400, 300, adsr)
    expect(env[300 + 48 - 1]).toBe(0)
    expect(env[300 + 48]).toBe(0)
  })

  test('sustain-0 rule clamps decay inside the gate and ends at exactly 0', () => {
    const pluckish = { attackMs: 1, decayMs: 100, sustain: 0, releaseMs: 0 }
    const env = adsrEnvelope(2000, 1000, pluckish)
    // Effective decay = min(4800, 1000 - 48) = 952 -> envelope ends at 1000.
    expect(env[998] ?? 0).toBeGreaterThan(0)
    expect(env[999]).toBe(0)
    expect(env[1000]).toBe(0)
    expect(env[1999]).toBe(0)
  })
})

describe('renderSawStack', () => {
  test('sample[0] is exactly 0 (phase starts at 0)', () => {
    const out = renderSawStack(midiToHz(50), [
      { wave: 'saw', detuneCents: 0, level: 0.5 },
      { wave: 'saw', detuneCents: 6, level: 0.5 },
    ], 64)
    expect(out[0]).toBe(0)
  })

  test('band limit: K = floor(21600 / f) — nothing above 21.6 kHz', () => {
    // f > 21600 -> zero harmonics -> silence.
    const silent = renderSawStack(22000, [{ wave: 'saw', detuneCents: 0, level: 1 }], 32)
    for (let n = 0; n < 32; n += 1) expect(silent[n]).toBe(0)
    // 11000 Hz -> exactly one harmonic: a pure (2/pi)-scaled sine.
    const single = renderSawStack(11000, [{ wave: 'saw', detuneCents: 0, level: 1 }], 32)
    for (let n = 0; n < 32; n += 1) {
      expect(single[n] ?? 0).toBeCloseTo((2 / Math.PI) * Math.sin((2 * Math.PI * 11000 * n) / 48000), 12)
    }
  })
})

describe('biquadLowpass', () => {
  test('DC gain ~1 and bounded output (stable)', () => {
    const input = new Float64Array(4800).fill(1)
    const out = biquadLowpass(input, 2200, 0.9)
    expect(out[4799] ?? 0).toBeCloseTo(1, 3)
    for (let n = 0; n < out.length; n += 1) {
      expect(Math.abs(out[n] ?? 0)).toBeLessThan(2)
    }
  })
})

describe('drum renders', () => {
  test.each([
    ['kick', renderKick, DRUM_SAMPLES.kick],
    ['snare', renderSnare, DRUM_SAMPLES.snare],
    ['rim', renderRim, DRUM_SAMPLES.rim],
    ['crash', renderCrash, DRUM_SAMPLES.crash],
  ] as const)('%s has its pinned length and ends at exactly 0', (_name, render, samples) => {
    const out = render()
    expect(out.length).toBe(samples)
    expect(out[out.length - 1]).toBe(0)
    let peak = 0
    for (let n = 0; n < out.length; n += 1) peak = Math.max(peak, Math.abs(out[n] ?? 0))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(0.98)
  })
})
