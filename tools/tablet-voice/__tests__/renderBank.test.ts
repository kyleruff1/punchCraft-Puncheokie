/**
 * Bank plan + render contracts (spec §5): computed plan shape, sample-exact
 * loop math, stab completeness vs the COMPILED cube map, zero-amplitude bed
 * boundaries, the brass bass integer-period fit + warmup convergence, the
 * pluck bass silent tail, and byte determinism.
 */
import { BRASS_ACTIVITY_LAYERS, compileBrassCube } from '../../../src/domain/instrument/brassCube'
import { LAUNCH_PATCHES } from '../../../src/domain/instrument/punchPatch'
import { biquadLowpass, renderSawStack, wavBytes } from '../src/dsp'
import {
  buildBankPlan,
  renderEntry,
  type BankPlan,
  type BankPlanEntry,
  type BassPlanEntry,
  type BedPlanEntry,
} from '../src/render-brass-bank'
import { TEXTURES } from '../src/textures'

jest.setTimeout(300000)

const plan: BankPlan = buildBankPlan()

const brassPatch = LAUNCH_PATCHES.find((p) => p.id === 'dorian-brass-cube')
if (!brassPatch) throw new Error('dorian-brass-cube launch patch missing')
const compiledMap = compileBrassCube(brassPatch)

function textureIn(planUnder: BankPlan, id: string) {
  const texture = planUnder.textures.find((t) => t.textureId === id)
  if (!texture) throw new Error(`plan missing texture ${id}`)
  return texture
}

function bedIn(textureId: string, key: string): BedPlanEntry {
  const bed = textureIn(plan, textureId).beds.find((b) => b.key === key)
  if (!bed) throw new Error(`plan missing ${textureId} bed ${key}`)
  return bed
}

function bassIn(textureId: string, key: string): BassPlanEntry {
  const bass = textureIn(plan, textureId).basses.find((b) => b.key === key)
  if (!bass) throw new Error(`plan missing ${textureId} bass ${key}`)
  return bass
}

/** Cache renders — several assertions share the same expensive buffer. */
const renderCache = new Map<string, Float64Array>()
function renderOnce(entry: BankPlanEntry): Float64Array {
  const cacheKey = `${'textureId' in entry ? entry.textureId : 'shared'}/${entry.key}`
  const cached = renderCache.get(cacheKey)
  if (cached) return cached
  const buffer = renderEntry(entry)
  renderCache.set(cacheKey, buffer)
  return buffer
}

function peakOf(buffer: Float64Array): number {
  let peak = 0
  for (let n = 0; n < buffer.length; n += 1) peak = Math.max(peak, Math.abs(buffer[n] ?? 0))
  return peak
}

describe('buildBankPlan', () => {
  test('24 beds + 6 basses + 25 stabs per texture, 5 drums', () => {
    expect(plan.textureIds).toEqual(['brass', 'pluck'])
    expect(plan.textures).toHaveLength(2)
    for (const texture of plan.textures) {
      expect(texture.beds).toHaveLength(24)
      expect(texture.basses).toHaveLength(6)
      // 18 head notes + octave-down body twins, deduped (M40-28).
      expect(texture.stabs).toHaveLength(25)
    }
    // Low tom added with M40-28: the uppercut's piece, so the crash can
    // be reserved for a velocity peak instead of firing on every one.
    expect(plan.drums.map((d) => d.key)).toEqual(['kick', 'snare', 'rim', 'tom', 'crash'])
  })

  test('bed loop math is sample-exact per the activity ladder', () => {
    for (const texture of plan.textures) {
      for (const bed of texture.beds) {
        const ladder = BRASS_ACTIVITY_LAYERS.find((l) => l.layer === bed.layer)
        if (!ladder) throw new Error(`no ladder layer ${bed.layer}`)
        expect(bed.stepSamples).toBe((48000 * 60) / ladder.notesPerMinute)
        expect(Number.isInteger(bed.stepSamples)).toBe(true)
        expect(bed.notes).toHaveLength(ladder.patternDepth)
        expect(bed.loopSamples).toBe(ladder.patternDepth * bed.stepSamples)
        expect(bed.loopSamples).toBe(bed.layer === 0 ? 144000 : 96000)
        expect(bed.gateSamples).toBe(Math.round(bed.stepSamples * ladder.gateRatio))
      }
    }
  })

  test('stab keys are the cube cells’ entry tones PLUS their octave-down body twins', () => {
    const heads = [...new Set(compiledMap.cells.map((cell) => cell.startMidiNote))].sort(
      (a, b) => a - b,
    )
    expect(heads).toEqual([
      48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 72, 74, 77, 79, 81,
    ])
    // A body shot drops an octave (M40-25); without these the body stab
    // would find no clip and sound silent on the tablet.
    const expected = [...new Set([...heads, ...heads.map((n) => n - 12)])]
      .filter((n) => n >= 0 && n <= 127)
      .sort((a, b) => a - b)
    expect(expected).toHaveLength(25)
    for (const texture of plan.textures) {
      expect(texture.stabs.map((s) => s.midiNote)).toEqual(expected)
      expect(texture.stabs.map((s) => s.key)).toEqual(expected.map((m) => `stab-${m}`))
    }
  })
})

describe('rendered beds', () => {
  test.each([
    ['brass', 'bed-L0-A0'],
    ['brass', 'bed-L0-A3'],
    ['pluck', 'bed-L0-A3'],
  ])('%s %s: zero boundaries, exact length, peak <= 0.98', (textureId, key) => {
    const bed = bedIn(textureId, key)
    const buffer = renderOnce(bed)
    expect(buffer.length).toBe(bed.loopSamples) // nothing written at index >= loopSamples
    expect(buffer[0]).toBe(0)
    expect(buffer[bed.loopSamples - 1]).toBe(0)
    const peak = peakOf(buffer)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(0.98)
  })

  test('bed note starts land on k * stepSamples (first sample of each step is 0)', () => {
    const bed = bedIn('pluck', 'bed-L0-A3')
    const buffer = renderOnce(bed)
    for (let k = 0; k < bed.notes.length; k += 1) {
      // The saw starts at phase 0 on every step boundary, so the mixed
      // buffer is exactly 0 there unless an earlier tail overlaps — pluck
      // steps decay to silence inside their own gate, so no tail reaches.
      expect(buffer[k * bed.stepSamples]).toBe(0)
      expect(Math.abs(buffer[k * bed.stepSamples + 100] ?? 0)).toBeGreaterThan(0)
    }
  })
})

describe('brass bass integer-period fit', () => {
  test('loopSamples match the computed goldens per bass note', () => {
    const goldens: Record<number, number> = {
      24: 95404,
      26: 95456,
      29: 95662,
      31: 96001,
      33: 96000,
    }
    const brass = textureIn(plan, 'brass')
    expect(brass.basses.map((b) => b.midiNote)).toEqual([26, 29, 31, 33, 24, 26])
    for (const bass of brass.basses) {
      expect(bass.loopSamples).toBe(goldens[bass.midiNote])
      if (bass.renderHz === null || bass.cycles === null) throw new Error('missing fit fields')
      // Exact integer number of cycles per loop by construction.
      const cyclesPerLoop = (bass.renderHz * bass.loopSamples) / 48000
      expect(Math.abs(cyclesPerLoop - bass.cycles)).toBeLessThan(1e-6)
    }
  })

  test('warmup pass converges: window 2 vs window 3 within 1/32767', () => {
    const bass = bassIn('brass', 'bass-L3') // midi 33 — the cheapest render
    if (bass.renderHz === null) throw new Error('missing renderHz')
    const role = TEXTURES.brass?.bass
    if (!role) throw new Error('brass texture missing')
    const filtered = biquadLowpass(
      renderSawStack(bass.renderHz, role.oscillators, 3 * bass.loopSamples),
      role.filter.cutoffHz,
      role.filter.q,
    )
    let maxDiff = 0
    for (let n = 0; n < bass.loopSamples; n += 1) {
      const w2 = filtered[bass.loopSamples + n] ?? 0
      const w3 = filtered[2 * bass.loopSamples + n] ?? 0
      maxDiff = Math.max(maxDiff, Math.abs(w2 - w3))
    }
    expect(maxDiff).toBeLessThanOrEqual(1 / 32767)
    // renderEntry keeps exactly the second window (trimmed).
    const rendered = renderOnce(bass)
    for (const n of [0, 1, 1000, bass.loopSamples - 1]) {
      expect(rendered[n]).toBe((filtered[bass.loopSamples + n] ?? 0) * role.trim)
    }
  })
})

describe('pluck bass', () => {
  test('silent from sample 80000 on (strike ends ~72144)', () => {
    const bass = bassIn('pluck', 'bass-L0')
    const buffer = renderOnce(bass)
    expect(buffer.length).toBe(96000)
    for (let n = 80000; n < buffer.length; n += 1) {
      expect(buffer[n]).toBe(0)
    }
  })
})

describe('determinism', () => {
  test('renderEntry twice -> byte-identical wavs', () => {
    const entries: BankPlanEntry[] = [
      bedIn('pluck', 'bed-L0-A3'),
      bassIn('brass', 'bass-L3'),
      ...plan.drums,
    ]
    const brassStabs = textureIn(plan, 'brass').stabs
    const stab81 = brassStabs.find((s) => s.midiNote === 81)
    if (!stab81) throw new Error('stab-81 missing')
    entries.push(stab81)
    for (const entry of entries) {
      const first = wavBytes(renderOnce(entry))
      const second = wavBytes(renderEntry(entry))
      expect(second.equals(first)).toBe(true)
    }
  })
})
