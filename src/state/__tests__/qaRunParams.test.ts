/**
 * The `punchcraft://qa/run` contract (GH #291).
 *
 * The suite composes this URL and the route parses it; every field the
 * suite relies on is pinned here so a drift between the two is a red test,
 * not a workout that silently never autostarts.
 */
import { parseQaRunParams, SIM_BPM_MAX, SIM_BPM_MIN } from '../qaRunParams'

describe('parseQaRunParams', () => {
  it('parses a full suite link', () => {
    const r = parseQaRunParams({
      workout: 'body-work',
      vocab: 'techniques',
      sim: 'captured-jam',
      autostart: '1',
      qa: '1',
      nonce: 'suite-1-body-work-0',
      simBpm: '180',
      simForce: 'true',
      seed: 's1',
    })
    expect(r).toEqual({
      ok: true,
      request: {
        workout: 'body-work',
        vocab: 'techniques',
        sim: 'captured-jam',
        simForce: true,
        simBpm: 180,
        autostart: true,
        seed: 's1',
        qa: true,
        nonce: 'suite-1-body-work-0',
      },
    })
  })

  it('defaults: numbers vocabulary, no sim, no autostart, flag untouched', () => {
    const r = parseQaRunParams({ workout: 'three-round-fundamentals' })
    expect(r).toEqual({
      ok: true,
      request: {
        workout: 'three-round-fundamentals',
        vocab: 'numbers',
        sim: 'none',
        simForce: false,
        autostart: false,
      },
    })
  })

  it('accepts the hidden diagnostic rig and "generated"', () => {
    expect(parseQaRunParams({ workout: 'diagnostic-token-sequence' }).ok).toBe(true)
    expect(parseQaRunParams({ workout: 'generated', seed: 'abc' })).toMatchObject({
      ok: true,
      request: { workout: 'generated', seed: 'abc' },
    })
  })

  it('requires a workout and rejects an unknown one', () => {
    expect(parseQaRunParams({})).toEqual({
      ok: false,
      errors: ['workout: required (a sample key or "generated")'],
    })
    const r = parseQaRunParams({ workout: 'no-such-workout' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/unknown sample 'no-such-workout'/)
  })

  it('rejects an unknown sim script but names the known ones', () => {
    const r = parseQaRunParams({ workout: 'body-work', sim: 'chaos' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/captured-jam/)
  })

  it('rejects a bad vocabulary or boolean rather than guessing', () => {
    const r = parseQaRunParams({ workout: 'body-work', vocab: 'names', autostart: 'maybe' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toEqual([
        "vocab: expected numbers|techniques, got 'names'",
        "autostart: expected a boolean, got 'maybe'",
      ])
    }
  })

  it('bounds simBpm', () => {
    expect(parseQaRunParams({ workout: 'body-work', simBpm: String(SIM_BPM_MIN - 1) }).ok).toBe(false)
    expect(parseQaRunParams({ workout: 'body-work', simBpm: String(SIM_BPM_MAX + 1) }).ok).toBe(false)
    expect(parseQaRunParams({ workout: 'body-work', simBpm: 'fast' }).ok).toBe(false)
    expect(parseQaRunParams({ workout: 'body-work', simBpm: '120' })).toMatchObject({
      ok: true,
      request: { simBpm: 120 },
    })
  })

  it('takes the first value of a repeated key and treats empty strings as absent', () => {
    const r = parseQaRunParams({ workout: ['body-work', 'heavy-hands'], seed: '', nonce: '' })
    expect(r).toEqual({
      ok: true,
      request: {
        workout: 'body-work',
        vocab: 'numbers',
        sim: 'none',
        simForce: false,
        autostart: false,
      },
    })
  })

  it('reads every boolean spelling the shell is likely to send', () => {
    for (const on of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(parseQaRunParams({ workout: 'body-work', autostart: on })).toMatchObject({
        request: { autostart: true },
      })
    }
    for (const off of ['0', 'false', 'no', 'off']) {
      expect(parseQaRunParams({ workout: 'body-work', qa: off })).toMatchObject({
        request: { qa: false },
      })
    }
  })
})
