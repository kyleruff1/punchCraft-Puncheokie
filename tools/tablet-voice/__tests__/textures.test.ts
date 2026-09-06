/**
 * Texture registry contracts (spec §4): exactly the two launch textures,
 * the ruling-pinned brass bed ADSR, the pluck sustain-0 discipline, the
 * bass modes, the no-detune brass bass, and sane trims.
 */
import { TEXTURES } from '../src/textures'

describe('TEXTURES registry', () => {
  test('has exactly {brass, pluck} at launch', () => {
    expect(Object.keys(TEXTURES).sort()).toEqual(['brass', 'pluck'])
    expect(TEXTURES.brass?.id).toBe('brass')
    expect(TEXTURES.pluck?.id).toBe('pluck')
  })

  test('brass bed ADSR is the ruling-pinned A14/D280/S0.64/R190', () => {
    expect(TEXTURES.brass?.bed.adsr).toEqual({
      attackMs: 14,
      decayMs: 280,
      sustain: 0.64,
      releaseMs: 190,
    })
  })

  test('pluck roles all decay to silence (sustain 0, release 0)', () => {
    const pluck = TEXTURES.pluck
    if (!pluck) throw new Error('pluck texture missing')
    for (const role of [pluck.bed, pluck.bass, pluck.stab]) {
      expect(role.adsr.sustain).toBe(0)
      expect(role.adsr.releaseMs).toBe(0)
    }
  })

  test('bass modes: brass sustain-loop, pluck restruck-decay', () => {
    expect(TEXTURES.brass?.bass.mode).toBe('sustain-loop')
    expect(TEXTURES.pluck?.bass.mode).toBe('restruck-decay')
  })

  test('brass bass oscillators carry no detune (integer-period fit constraint)', () => {
    for (const osc of TEXTURES.brass?.bass.oscillators ?? []) {
      expect(osc.detuneCents).toBe(0)
    }
  })

  test('all trims are in (0, 1]', () => {
    for (const texture of Object.values(TEXTURES)) {
      for (const role of [texture.bed, texture.bass, texture.stab]) {
        expect(role.trim).toBeGreaterThan(0)
        expect(role.trim).toBeLessThanOrEqual(1)
      }
    }
  })
})
