import { createImpulseScaler } from '../effects/impulseScale'
import { IMPULSE_SCALE_VERSION } from '../effects/versions'

describe('impulseScale', () => {
  it('exports a semver-shaped version constant', () => {
    expect(IMPULSE_SCALE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('warm-starts: the observed hardware range maps across 0..1 before any history exists', () => {
    expect(createImpulseScaler().scale('left', 5)).toBe(0)
    expect(createImpulseScaler().scale('left', 14)).toBe(1)
    const mid = createImpulseScaler().scale('left', 9.5)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.7)
  })

  it('clamps to 0..1 and is monotone in the reading', () => {
    const outputs = [0, 2, 5, 8, 11, 14, 20, 40].map((raw) =>
      createImpulseScaler().scale('left', raw),
    )
    for (const out of outputs) {
      expect(out).toBeGreaterThanOrEqual(0)
      expect(out).toBeLessThanOrEqual(1)
    }
    for (let i = 1; i < outputs.length; i += 1) {
      expect(outputs[i]).toBeGreaterThanOrEqual(outputs[i - 1] ?? 0)
    }
  })

  it('adapts: a hard-hitting session raises the references', () => {
    const scaler = createImpulseScaler()
    for (let i = 0; i < 30; i += 1) scaler.scale('left', 16 + (i % 5))
    // 14 saturated the warm scale; against this session's own window it
    // reads as below-average effort.
    expect(scaler.scale('left', 14)).toBeLessThan(0.6)
  })

  it('adapts: a soft session stretches the top of the scale down to reachable readings', () => {
    const scaler = createImpulseScaler()
    for (let i = 0; i < 30; i += 1) scaler.scale('left', 5 + (i % 4))
    expect(scaler.scale('left', 8)).toBeGreaterThan(0.7)
  })

  it('keeps hands independent', () => {
    const scaler = createImpulseScaler()
    for (let i = 0; i < 30; i += 1) scaler.scale('left', 16 + (i % 5))
    const onHardenedLeft = scaler.scale('left', 12)
    const onWarmRight = scaler.scale('right', 12)
    expect(onWarmRight).toBeGreaterThan(onHardenedLeft)
  })

  it('never collapses the spread: identical readings stay finite and inside 0..1', () => {
    const scaler = createImpulseScaler()
    let last = 0
    for (let i = 0; i < 25; i += 1) last = scaler.scale('right', 10)
    expect(Number.isFinite(last)).toBe(true)
    expect(last).toBeGreaterThanOrEqual(0)
    expect(last).toBeLessThanOrEqual(1)
  })

  it('treats a missing or non-finite reading as a mid splash', () => {
    const scaler = createImpulseScaler()
    expect(scaler.scale('left', undefined)).toBe(0.5)
    expect(scaler.scale('left', Number.NaN)).toBe(0.5)
  })

  it('scales an unknown hand from the merged view without polluting either window', () => {
    const scaler = createImpulseScaler()
    const before = scaler.scale('unknown', 9.5)
    // Unknown readings are not recorded; the warm references still rule.
    for (let i = 0; i < 20; i += 1) scaler.scale('unknown', 20)
    expect(scaler.scale('unknown', 9.5)).toBeCloseTo(before, 10)
  })
})
