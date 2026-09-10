/**
 * The playlist ruler's read-back, checked against logs whose answer is known.
 *
 * The probe computes its own verdict on the tablet; this file exists because a
 * number a probe computed about itself is not evidence. Every dwell here is
 * recomputed from the raw transition stamps, so the tests are mostly about the
 * cases where that recomputation must REFUSE rather than produce a figure.
 */
import { analyze, parseRepBlocks } from '../playlist-ruler.mjs'

/**
 * One rep's log block, in the shape the logger emits.
 *
 * `transitions` are absolute ms from the play() origin. A dwell is the gap
 * between two consecutive ones, so a caller plants dwells by spacing these.
 */
const repBlock = ({ arm, rates = 'x', runId = 1, rep = 0, tracks, transitions, skewMs = 95, residualMs = 20, dwells = null }) => {
  const t = transitions.map(([i, at]) => `${i}@${at}`).join('|')
  // The probe's own dwell view, which analyze() cross-checks against its
  // recomputation. Default to agreeing.
  const hasSil = /\+ sil/.test(arm)
  const d =
    dwells ??
    transitions
      .slice(0, -1)
      .map(([i, at], k) => {
        const [ni, nat] = transitions[k + 1]
        if (ni !== i + 1) return null
        return `${i}${(hasSil ? i % 2 === 0 : true) ? 'c' : 's'}:${Math.round(nat - at)}`
      })
      .filter(Boolean)
      .join('|')
  return [
    `08-31 12:00:00.000 I/ReactNativeJS( 100): '[INFO] puncheokie.plruler.rep', 'playlist rep timing', { runId: ${runId},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   arm: '${arm}',`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   rates: '${rates}',`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   rep: ${rep},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   tracks: ${tracks},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   plannedMs: 4754,`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   skewMs: ${skewMs},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   residualMs: ${residualMs},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   transitionsMs: '${t}',`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   dwellsMs: '${d}' }`,
  ].join('\n')
}

/** A homogeneous 4-clip arm: tracks [C,C,C,C], clip length `clipMs`, gap `gapMs`. */
const homArm = (arm, clipMs, gapMs, reps = 8) => {
  const out = []
  for (let r = 0; r < reps; r += 1) {
    const t = [[1, 1000]]
    for (let i = 2; i <= 3; i += 1) t.push([i, t[t.length - 1][1] + clipMs + gapMs])
    out.push(repBlock({ arm, rep: r, tracks: 4, transitions: t }))
  }
  return out
}

/** A heterogeneous arm: tracks [C,S,C,S,C,S,C] — even indices are clips. */
const hetArm = (arm, clipMs, silMs, gapIntoClip, gapIntoSil, reps = 8) => {
  const out = []
  for (let r = 0; r < reps; r += 1) {
    const t = [[1, 1000]]
    for (let i = 2; i <= 6; i += 1) {
      // Dwell on track i-1: its true length plus the boundary entering track i.
      const prevIsClip = (i - 1) % 2 === 0
      const len = prevIsClip ? clipMs : silMs
      const gap = prevIsClip ? gapIntoSil : gapIntoClip
      t.push([i, t[t.length - 1][1] + len + gap])
    }
    out.push(repBlock({ arm, rep: r, tracks: 7, transitions: t, residualMs: 900 }))
  }
  return out
}

describe('parseRepBlocks', () => {
  it('reads the multi-line record and its raw transition stamps', () => {
    const reps = parseRepBlocks(repBlock({ arm: 'call 48k x1', tracks: 1, transitions: [[1, 1000], [2, 2100]] }))
    expect(reps).toHaveLength(1)
    expect(reps[0]).toMatchObject({ arm: 'call 48k x1', tracks: 1, skewMs: 95 })
    expect(reps[0].transitions).toEqual([{ index: 1, atMs: 1000 }, { index: 2, atMs: 2100 }])
  })
})

describe('analyze — recovers a planted boundary cost', () => {
  const log = [
    ...homArm('call 48k x4 no-sil', 926, 0),
    ...hetArm('call 48k x4 + sil 24k', 926, 350, 193, 95),
    ...homArm('bell 24k x4 no-sil', 1181, 0),
    ...hetArm('bell 24k x4 + sil 24k', 1181, 350, 0, 0),
  ].join('\n')

  it('reports the difference in clip dwell, not the absolute dwell', () => {
    const r = analyze(log)
    const finding = r.verdicts.find((v) => v.role === 'FINDING')
    // Planted: the clip dwell carries the boundary INTO the following silence
    // (95 ms) in the heterogeneous arm and nothing in the homogeneous one.
    expect(finding.perBoundaryDeltaMs).toBeCloseTo(95, 0)
    expect(finding.homogeneousDwellMs).toBeCloseTo(926, 0)
  })

  it('the control reads ~zero when both arms are the same rate', () => {
    const r = analyze(log)
    const control = r.verdicts.find((v) => v.role === 'CONTROL')
    expect(Math.abs(control.perBoundaryDeltaMs)).toBeLessThan(3)
    expect(r.problems).toEqual([])
  })

  it('the clip length cancels — a different clip gives the same answer', () => {
    // The whole reason the estimator is a DIFFERENCE. Same planted boundary
    // cost, a clip 400 ms longer: the answer must not move.
    const other = [
      ...homArm('call 48k x4 no-sil', 1326, 0),
      ...hetArm('call 48k x4 + sil 24k', 1326, 350, 193, 95),
    ].join('\n')
    const r = analyze(other)
    expect(r.verdicts.find((v) => v.role === 'FINDING').perBoundaryDeltaMs).toBeCloseTo(95, 0)
  })
})

describe('analyze — refuses what it cannot trust', () => {
  it('says the probe did not run rather than analysing an empty log', () => {
    const r = analyze('08-31 12:00:00.000 I/ReactNativeJS( 100): nothing here')
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/did the probe run/)
  })

  it('flags a recomputation that disagrees with the probe’s own dwells', () => {
    // Both are derived from the same stamps, so they cannot legitimately
    // differ. If they do, one of the two has the track layout wrong and
    // neither number means anything.
    const log = [
      ...homArm('call 48k x4 no-sil', 926, 0),
      ...hetArm('call 48k x4 + sil 24k', 926, 350, 193, 95),
      repBlock({
        arm: 'call 48k x4 + sil 24k',
        rep: 99,
        tracks: 7,
        transitions: [[1, 1000], [2, 1445], [3, 2564]],
        dwells: '1s:9999|2c:9999',
      }),
    ].join('\n')
    const r = analyze(log)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/disagree with the probe/)
  })

  it('refuses a verdict built on too few dwells instead of reporting one', () => {
    const log = [...homArm('call 48k x4 no-sil', 926, 0, 1), ...hetArm('call 48k x4 + sil 24k', 926, 350, 193, 95, 1)].join('\n')
    const r = analyze(log)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/clip dwells/)
  })

  it('analyses one run, not two interleaved ones', () => {
    // Two overlapping runs stamp against different origins; mixing them would
    // be silent nonsense rather than a visible error.
    const a = homArm('call 48k x4 no-sil', 926, 0).join('\n')
    const b = homArm('call 48k x4 no-sil', 926, 0)
      .join('\n')
      .replace(/runId: 1,/g, 'runId: 2,')
    const r = analyze(a + '\n' + b)
    expect(r.runId).toBe(2)
    expect(r.problems.join(' ')).toMatch(/distinct runIds/)
  })

  it('notes when the CONTROL also moved, because then the rate is not the cause', () => {
    const log = [
      ...homArm('call 48k x4 no-sil', 926, 0),
      ...hetArm('call 48k x4 + sil 24k', 926, 350, 193, 95),
      ...homArm('bell 24k x4 no-sil', 1181, 0),
      // The control moving means interleaving a silence track costs something
      // regardless of rate — a different defect, and a different fix.
      ...hetArm('bell 24k x4 + sil 24k', 1181, 350, 90, 90),
    ].join('\n')
    const r = analyze(log)
    expect(r.notes.join(' ')).toMatch(/CONTROL also moved/)
  })
})
