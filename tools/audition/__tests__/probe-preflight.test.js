/**
 * The pre-flight exists to stop a mic session being spent on a probe that
 * cannot be resolved. So the tests are two fixtures: one probe whose gaps
 * carry a signal, and one whose gaps do not — the exact shape of the dry run
 * that cost a full session before anyone could tell.
 */
import { judge } from '../probe-preflight.mjs'

/** Deterministic PRNG, so an irregular fixture is still a repeatable one. */
function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const repLine = (rep, playheadEpochMs, asset) =>
  [
    `08-31 12:00:00.000 I/ReactNativeJS( 100): '[INFO] puncheokie.ruler.rep', 'rep timing', { asset: '${asset}',`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   rep: ${rep},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   statusEpochMs: ${playheadEpochMs - 95},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   playheadEpochMs: ${playheadEpochMs},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   playheadMs: 120 }`,
  ].join('\n')

/** A probe log with the given inter-play gaps, across two assets. */
function probeLog({ gapLo, gapSpan, reps = 40, seed = 3 }) {
  const rnd = lcg(seed)
  const lines = []
  let t = 1_700_000_000_000
  for (const asset of ['call cc-e08318c0 (48k)', 'bell (24k)']) {
    for (let i = 0; i < reps; i += 1) {
      lines.push(repLine(i, Math.round(t), asset))
      t += gapLo + (gapSpan === 0 ? 0 : rnd() * gapSpan)
    }
    t += 4_000 // the pause between assets, which is not a play gap
  }
  return lines.join('\n')
}

describe('probe pre-flight', () => {
  it('passes a probe whose gaps carry a signal', () => {
    // What the tablet actually produced after the randomisation was widened:
    // gaps 500–1150 ms, spread 650.
    const r = judge(probeLog({ gapLo: 500, gapSpan: 650 }))
    expect(r.problems).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.spreadMs).toBeGreaterThan(450)
    for (const s of r.simulations) expect(s.decisive).toBe(true)
  })

  it('REFUSES the evenly spaced probe that cost the dry run a session', () => {
    // 555 ms apart, every time. The recording of this is unresolvable, and
    // that was only discovered after the rig was packed away.
    const r = judge(probeLog({ gapLo: 555, gapSpan: 0 }))
    expect(r.ok).toBe(false)
    expect(r.spreadMs).toBe(0)
    expect(r.problems.join(' ')).toMatch(/vary by only/)
    expect(r.simulations.some((s) => !s.decisive)).toBe(true)
  })

  it('REFUSES a spread too thin to survive the path’s own jitter', () => {
    // The gaps vary, but not by enough. This is the case that looks fine and
    // is not — and it is why the simulation is run WITH jitter: a rigid
    // simulation makes the winning cluster artificially tight and would sign
    // off on a session that a real recording then fails to resolve.
    const r = judge(probeLog({ gapLo: 550, gapSpan: 60 }))
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/vary by only|not decisive/)
  })

  it('does not count the pause BETWEEN assets as a play gap', () => {
    // A 4 s gap sits between the two assets in every one of these fixtures.
    // Counting it would report a spread the probe does not have, and sign off
    // on an evenly spaced probe on the strength of one pause.
    const r = judge(probeLog({ gapLo: 555, gapSpan: 0 }))
    expect(r.spreadMs).toBe(0)
    expect(r.perAsset).toHaveLength(2)
    for (const a of r.perAsset) expect(a.maxMs).toBeLessThan(1_000)
  })

  it('says the probe did not run rather than judging an empty log', () => {
    const r = judge('08-31 12:00:00.000 I/ReactNativeJS( 100): nothing to see here')
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/did the probe actually run/)
  })
})
