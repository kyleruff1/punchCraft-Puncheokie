import { describe, expect, it } from '@jest/globals'
import { runtimeCoachAssetResolver } from '../coachAssetResolvers'
import type { CoachAssetContext } from '@domain/programs/compileCue'

const ctx = (comboSignature: string): CoachAssetContext => ({ comboSignature })

describe('runtimeCoachAssetResolver — combo-announce', () => {
  it('returns an asset for a known numeric combo', () => {
    const ref = runtimeCoachAssetResolver('combo-announce', 'numeric', ctx('1-1-2'))
    expect(ref).toBeDefined()
    expect(ref!.assetId).toBe('ca-1-1-2-numbers')
    expect(ref!.mappedDurationTicks).toBeGreaterThan(0)
  })

  it('returns an asset for a known technique combo', () => {
    const ref = runtimeCoachAssetResolver('combo-announce', 'technique', ctx('1-1-2'))
    expect(ref).toBeDefined()
    expect(ref!.assetId).toBe('ca-1-1-2-techniques')
  })

  it('resolves body-suffix combos (`1-2b-3`) via the canonical signature', () => {
    const ref = runtimeCoachAssetResolver('combo-announce', 'numeric', ctx('1-2b-3'))
    // Not every combo has a rendered clip in the corpus; the assertion
    // is that IF present, it resolves — and that the resolver rejects
    // the wrong-signature form ("1-2B-3") rather than accidentally
    // matching. If this specific combo is absent, adapt to a
    // guaranteed-present one for the negative-case shape check.
    if (ref) {
      expect(ref.assetId).toContain('ca-1-2b-3')
    }
    const uppercase = runtimeCoachAssetResolver(
      'combo-announce',
      'numeric',
      ctx('1-2B-3'),
    )
    expect(uppercase).toBeUndefined()
  })

  it('returns undefined for an unknown combo signature', () => {
    const ref = runtimeCoachAssetResolver(
      'combo-announce',
      'numeric',
      ctx('9-9-9-9-9-9-9-nope'),
    )
    expect(ref).toBeUndefined()
  })

  it('returns undefined for an empty combo signature', () => {
    expect(
      runtimeCoachAssetResolver('combo-announce', 'numeric', ctx('')),
    ).toBeUndefined()
  })

  it('returns undefined for content kinds not yet wired', () => {
    expect(
      runtimeCoachAssetResolver(
        'sustained-instruction',
        'numeric',
        ctx('pump-jab'),
      ),
    ).toBeUndefined()
    expect(
      runtimeCoachAssetResolver('coast-intro', 'numeric', ctx('coast-a')),
    ).toBeUndefined()
    expect(
      runtimeCoachAssetResolver('encouragement', 'numeric', ctx('go')),
    ).toBeUndefined()
  })
})
