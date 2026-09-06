/**
 * The Punch Kit render (drum-kit-design §6), and the gate that keeps it
 * honest.
 *
 * The sixteen articulations are rendered by three parameterised engines
 * that generalise the five drums the bank already ships. "Generalise" is a
 * claim that is easy to make and easy to get wrong — a spec that merely
 * SOUNDS like the old kick is a silent regression for every existing
 * texture. So the first block asserts sample-for-sample reproduction of all
 * five originals. If a spec drifts, it fails here rather than on the tablet.
 */
import {
  LOGICAL_DRUM_ARTICULATIONS,
  type LogicalDrumArticulation,
} from '../../../src/domain/instrument/drums/logicalDrumArticulations'
import {
  renderCrash,
  renderKick,
  renderRim,
  renderSnare,
  renderTom,
  wavBytes,
} from '../src/dsp'
import { DRUM_KIT_SPECS, renderDrumArticulation } from '../src/drumKit'

jest.setTimeout(120000)

const cache = new Map<LogicalDrumArticulation, Float64Array>()
function render(articulation: LogicalDrumArticulation): Float64Array {
  const cached = cache.get(articulation)
  if (cached) return cached
  const buffer = renderDrumArticulation(articulation)
  cache.set(articulation, buffer)
  return buffer
}

function peakOf(buffer: Float64Array): number {
  let peak = 0
  for (let n = 0; n < buffer.length; n += 1) peak = Math.max(peak, Math.abs(buffer[n] ?? 0))
  return peak
}

describe('faithfulness to the shipped five', () => {
  const PAIRS: readonly [LogicalDrumArticulation, () => Float64Array][] = [
    ['kick-main', renderKick],
    ['snare-center', renderSnare],
    ['rim-click', renderRim],
    ['floor-tom-high', renderTom],
    ['crash-main', renderCrash],
  ]

  test.each(PAIRS)('%s reproduces its original sample for sample', (articulation, original) => {
    const expected = original()
    const actual = render(articulation)
    expect(actual.length).toBe(expected.length)
    for (let n = 0; n < expected.length; n += 1) {
      // Exact equality, not closeness: the engines must be the same
      // arithmetic, not an approximation of it.
      if (actual[n] !== expected[n]) {
        throw new Error(
          `${articulation} diverged at sample ${n}: ${actual[n]} !== ${expected[n]}`,
        )
      }
    }
  })

  test('and therefore render byte-identical wavs', () => {
    for (const [articulation, original] of PAIRS) {
      expect(wavBytes(render(articulation)).equals(wavBytes(original()))).toBe(true)
    }
  })
})

describe('render gates', () => {
  test.each(LOGICAL_DRUM_ARTICULATIONS)('%s: audible, ends at silence, peak <= 0.98', (a) => {
    const buffer = render(a)
    expect(buffer.length).toBe(DRUM_KIT_SPECS[a].lengthSamples)
    const peak = peakOf(buffer)
    expect(peak).toBeGreaterThan(0.02) // not accidentally silent
    expect(peak).toBeLessThanOrEqual(0.98) // no clipping in the bank
    // A one-shot that does not land on zero clicks when the player stops.
    expect(buffer[buffer.length - 1]).toBe(0)
  })

  test.each(LOGICAL_DRUM_ARTICULATIONS)('%s renders deterministically', (a) => {
    const first = wavBytes(renderDrumArticulation(a))
    const second = wavBytes(renderDrumArticulation(a))
    expect(second.equals(first)).toBe(true)
  })

  test('all sixteen have a spec — the domain can name nothing unrenderable', () => {
    // The catalog is the contract. An articulation the domain can emit but
    // the bank cannot render is a silent hit on the tablet, which is the
    // exact failure mode that made body shots inaudible last time.
    for (const articulation of LOGICAL_DRUM_ARTICULATIONS) {
      expect(DRUM_KIT_SPECS[articulation]).toBeDefined()
    }
    expect(Object.keys(DRUM_KIT_SPECS).sort()).toEqual([...LOGICAL_DRUM_ARTICULATIONS].sort())
  })
})

describe('the kit reads as a kit', () => {
  /** Dominant frequency by zero-crossing rate over the first 60 ms. */
  function brightness(buffer: Float64Array): number {
    const window = Math.min(buffer.length, 60 * 48)
    let crossings = 0
    for (let n = 1; n < window; n += 1) {
      const previous = buffer[n - 1] ?? 0
      const current = buffer[n] ?? 0
      if (previous <= 0 && current > 0) crossings += 1
    }
    return crossings / (window / 48000)
  }

  test('the tom ladder descends: rack high > rack mid > floor high > floor low', () => {
    // §4's kit layout is what makes a hook-into-uppercut phrase read as
    // travelling DOWN the kit (§16). If two toms invert, the movement
    // metaphor inverts with them.
    const ladder = (['rack-tom-high', 'rack-tom-mid', 'floor-tom-high', 'floor-tom-low'] as const).map(
      (a) => brightness(render(a)),
    )
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!).toBeLessThan(ladder[i - 1]!)
    }
  })

  test('the four families land in four different brightness regions', () => {
    // The ear test in miniature: ride, snare, rack tom and floor tom must
    // be separable without the drum channel doing all the work.
    const ride = brightness(render('ride-bow'))
    const snare = brightness(render('snare-center'))
    const rackTom = brightness(render('rack-tom-high'))
    const floorTom = brightness(render('floor-tom-low'))
    expect(ride).toBeGreaterThan(snare)
    expect(snare).toBeGreaterThan(rackTom)
    expect(rackTom).toBeGreaterThan(floorTom)
  })

  test('the body snare is darker than the center, and the rimshot brighter', () => {
    // §5.1's "lower/darker snare hit" and §9's rimshot peak, as measurements.
    const center = brightness(render('snare-center'))
    expect(brightness(render('snare-body'))).toBeLessThan(center)
    expect(brightness(render('snare-rimshot'))).toBeGreaterThan(center)
  })

  test('the sub kick sits below the main kick', () => {
    expect(brightness(render('kick-sub'))).toBeLessThan(brightness(render('kick-main')))
  })

  test('the closed hat is shorter than the open hat, and both are short vs the crash', () => {
    const lengthOf = (a: LogicalDrumArticulation): number => DRUM_KIT_SPECS[a].lengthSamples
    expect(lengthOf('hihat-closed')).toBeLessThan(lengthOf('hihat-open'))
    expect(lengthOf('hihat-open')).toBeLessThan(lengthOf('crash-main'))
  })

  test('the tight ride is the short one — §18 density control', () => {
    const lengthOf = (a: LogicalDrumArticulation): number => DRUM_KIT_SPECS[a].lengthSamples
    expect(lengthOf('ride-tight')).toBeLessThan(lengthOf('ride-bow'))
    expect(lengthOf('ride-bow')).toBeLessThan(lengthOf('ride-bell'))
  })

  test('the ride has a tonal ping the crash does not', () => {
    // What separates a ride from a crash is defined partials over the wash.
    // Without them a "ride" is just a short crash and the timekeeper lane
    // turns to mush under a jab flurry.
    const rideSpec = DRUM_KIT_SPECS['ride-bow']
    const crashSpec = DRUM_KIT_SPECS['crash-main']
    expect(rideSpec.kind).toBe('metal')
    expect(crashSpec.kind).toBe('metal')
    if (rideSpec.kind !== 'metal' || crashSpec.kind !== 'metal') throw new Error('spec kind')
    expect(rideSpec.partials.length).toBeGreaterThan(0)
    expect(crashSpec.partials).toHaveLength(0)
  })
})

describe('bank size', () => {
  test('the whole kit stays under 1 MB of 16-bit PCM', () => {
    // Drums are texture-independent (§4: one coherent acoustic kit), so
    // this is ONE set of files shared by every texture, not one per.
    const bytes = LOGICAL_DRUM_ARTICULATIONS.reduce(
      (sum, a) => sum + DRUM_KIT_SPECS[a].lengthSamples * 2 + 44,
      0,
    )
    expect(bytes).toBeLessThan(1024 * 1024)
  })
})
