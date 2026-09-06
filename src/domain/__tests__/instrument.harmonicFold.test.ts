/**
 * foldHarmonicSettings (M40-18 #322): the settings blob folds INTO the
 * section — canonical values, capability clamping, and the hash law that
 * makes effectivePatchHash trustworthy: defaults fold to the authored
 * section byte-identically (omitted ≡ stored-default), and only a REAL
 * selection change moves the patch hash.
 */
import { mapHashOf } from '@domain/instrument/gestureSchema'
import {
  DORIAN_HARMONIC_FIELD_SECTION,
  foldHarmonicSettings,
} from '@domain/instrument/harmonicField'
import { compilePunchPatch } from '@domain/instrument/cubeCompiler'
import { launchPatchById } from '@domain/instrument/punchPatch'

const DEFAULTS = {
  freedom: 'safe-3x3',
  navigation: 'orbit',
  commitIntervalTicks: 480,
} as const

it('the canonical defaults fold to the authored section byte-identically', () => {
  const folded = foldHarmonicSettings(DORIAN_HARMONIC_FIELD_SECTION, DEFAULTS)
  expect(folded).toEqual(DORIAN_HARMONIC_FIELD_SECTION)
  expect(mapHashOf(folded)).toBe(mapHashOf(DORIAN_HARMONIC_FIELD_SECTION))
})

it('values outside the capability envelope clamp to the authored value, never leak through', () => {
  const folded = foldHarmonicSettings(DORIAN_HARMONIC_FIELD_SECTION, {
    freedom: 'guided-4x4', // typed but NOT in FOUNDATION_CAPABILITIES
    navigation: 'absolute',
    commitIntervalTicks: 960,
  })
  expect(folded.freedom).toBe('safe-3x3') // clamped
  expect(folded.navigation).toBe('absolute') // supported → applied
  expect(folded.commitIntervalTicks).toBe(960)
})

it('a real selection change moves the effective patch hash; defaults do not', () => {
  const base = launchPatchById('dorian-brass-v2')
  expect(base.harmonicField).toBeDefined()
  const withDefaults = {
    ...base,
    harmonicField: foldHarmonicSettings(base.harmonicField!, DEFAULTS),
  }
  const withFull = {
    ...base,
    harmonicField: foldHarmonicSettings(base.harmonicField!, {
      ...DEFAULTS,
      freedom: 'full-6x6',
    }),
  }
  const baseHash = compilePunchPatch(base).patchHash
  expect(compilePunchPatch(withDefaults).patchHash).toBe(baseHash)
  expect(compilePunchPatch(withFull).patchHash).not.toBe(baseHash)
})
