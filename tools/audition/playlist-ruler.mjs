/**
 * The ceremony playlist's ruler (plan 5b), read back from logcat.
 *
 * `probePlaylistRuler` already prints its verdict on the tablet. This exists
 * because a number a probe computed about itself is not evidence: every derived
 * value here is recomputed from the RAW transition timestamps the probe logs,
 * and the two are compared. A disagreement means one of them is wrong, which is
 * worth far more than either number alone.
 *
 * ## What the run is measuring
 *
 * Two things, and the second is the reason the first got built.
 *
 * **The onset skew.** `OBSERVER_ONSET_SKEW_MS = 95` was measured on
 * `createAudioPlayer`. The walkout, round warning and rest scripts run on
 * `createAudioPlaylist`, so `SKEW_CORRECTED_KINDS` leaves them raw rather than
 * borrowing a constant from a path it was never measured on.
 *
 * **The dead air.** Field captures show a playlist's end-event residual growing
 * 121 → 343 → 790 ms at 1 → 3 → 7 tracks while its onset latency stays flat at
 * 15.5 → 24 → 25 ms. A long playlist starts as fast as a short one and loses
 * the time at the boundaries — about 111 ms each. The suspect is a sample-rate
 * change: all 18 silence tracks are 24 kHz, all 25 intro clips and all 26 warn
 * openers are 48 kHz, and `silenceManifest.ts` documents the opposite as the
 * reason for its own design.
 *
 * ## Why the headline is a difference of dwells
 *
 * Between two consecutive `trackChanged` events the playlist dwells on exactly
 * one track plus one boundary:
 *
 *     dwell(k) = trueLength(track k) + boundaryCost
 *
 * Run the same clip homogeneous and heterogeneous and subtract, and
 * `trueLength` cancels — along with the onset skew and the end-event lag,
 * neither of which appears in a difference of two mid-playlist stamps. It also
 * does not matter which instant `trackChanged` marks (media3 plausibly fires it
 * when the OUTGOING audio ends rather than when the incoming starts): any
 * consistent instant cancels in a difference.
 *
 * That matters because the alternative — comparing against each track's stated
 * duration — needs a decoded length that may differ from the manifest's, and
 * would differ DIFFERENTLY for 24 kHz and 48 kHz files, which is the contrast
 * under test.
 *
 *   node tools/audition/playlist-ruler.mjs --log=<logcat file>
 */
import { existsSync, readFileSync } from 'node:fs'

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)

/** Below this a median is one or two samples wearing a statistic's clothes. */
const MIN_DWELLS = 6

const median = (v) => {
  if (v.length === 0) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mad = (v) => {
  if (v.length === 0) return null
  const m = median(v)
  return median(v.map((x) => Math.abs(x - m)))
}
const r1 = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)

/** One `puncheokie.plruler.rep` block per play, gathered across continuation lines. */
export function parseRepBlocks(text) {
  const reps = []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('puncheokie.plruler.rep')) continue
    let block = lines[i]
    for (let j = i + 1; j < lines.length && !block.includes('}') && j - i < 24; j += 1) block += ' ' + lines[j]
    // Word-anchored: `rep` must not match inside `reps`, and a bare `arm` must
    // not match inside `arms`.
    const str = (k) => block.match(new RegExp(`\\b${k}:\\s*'([^']*)'`))?.[1] ?? null
    const num = (k) => {
      const m = block.match(new RegExp(`\\b${k}:\\s*(-?\\d+(?:\\.\\d+)?)`))
      return m ? Number(m[1]) : null
    }
    const arm = str('arm')
    if (arm === null) continue
    reps.push({
      arm,
      rates: str('rates'),
      runId: num('runId'),
      rep: num('rep'),
      tracks: num('tracks'),
      plannedMs: num('plannedMs'),
      skewMs: num('skewMs'),
      residualMs: num('residualMs'),
      /** `1@1180|2@1533|…` — index@ms, the raw material for every dwell below. */
      transitions: (str('transitionsMs') ?? '')
        .split('|')
        .filter(Boolean)
        .map((t) => {
          const [idx, at] = t.split('@')
          return { index: Number(idx), atMs: Number(at) }
        }),
      /** The probe's own dwells, kept only to check this file against it. */
      statedDwells: (str('dwellsMs') ?? '')
        .split('|')
        .filter(Boolean)
        .map((d) => {
          const m = d.match(/^(\d+)([cs]):(-?\d+)$/)
          return m ? { index: Number(m[1]), isClip: m[2] === 'c', ms: Number(m[3]) } : null
        })
        .filter(Boolean),
    })
  }
  return reps
}

/**
 * Which tracks are clips, from the arm's shape rather than from the log.
 * A 4-clip arm is [C,C,C,C] without silence and [C,S,C,S,C,S,C] with it.
 */
function trackIsClipFor(tracks, hasSilence) {
  const out = []
  for (let i = 0; i < tracks; i += 1) out.push(hasSilence ? i % 2 === 0 : true)
  return out
}

export function analyze(logText) {
  const reps = parseRepBlocks(logText)
  const problems = []
  const notes = []
  if (reps.length === 0) {
    return { ok: false, problems: ['no puncheokie.plruler.rep records — did the probe run?'], arms: {}, verdicts: [] }
  }

  // One run only. Two overlapping runs interleave in the log and their stamps
  // are from different origins, so mixing them would be silent nonsense.
  const runIds = [...new Set(reps.map((r) => r.runId).filter((v) => v !== null))]
  if (runIds.length > 1) {
    problems.push(`${runIds.length} distinct runIds in this log (${runIds.join(', ')}) — analysing only the newest`)
  }
  const runId = runIds.length ? Math.max(...runIds) : null
  const mine = runId === null ? reps : reps.filter((r) => r.runId === runId)

  const arms = {}
  for (const rep of mine) {
    const hasSilence = /\+ sil/.test(rep.arm)
    const isClip = trackIsClipFor(rep.tracks ?? 0, hasSilence)
    const a = (arms[rep.arm] ??= { arm: rep.arm, rates: rep.rates, reps: 0, skew: [], residual: [], clipDwell: [], silDwell: [], recomputeMismatch: 0 })
    a.reps += 1
    if (rep.skewMs !== null) a.skew.push(rep.skewMs)
    if (rep.residualMs !== null) a.residual.push(rep.residualMs)

    // RECOMPUTE the dwells from the raw stamps rather than reading the probe's.
    for (let i = 0; i + 1 < rep.transitions.length; i += 1) {
      const p = rep.transitions[i]
      const q = rep.transitions[i + 1]
      if (q.index !== p.index + 1) continue
      const ms = q.atMs - p.atMs
      ;(isClip[p.index] ? a.clipDwell : a.silDwell).push(ms)
      // The probe published its own value for this same dwell. They are
      // computed from the same stamps, so they must agree; if they do not, one
      // of the two is reading the arm's shape wrongly.
      const stated = rep.statedDwells.find((d) => d.index === p.index)
      if (stated && (Math.abs(stated.ms - ms) > 1 || stated.isClip !== isClip[p.index])) a.recomputeMismatch += 1
    }
  }

  for (const a of Object.values(arms)) {
    if (a.recomputeMismatch > 0) {
      problems.push(
        `${a.arm}: ${a.recomputeMismatch} dwell(s) recomputed from raw stamps disagree with the probe's own —` +
          ` one of the two has the track layout wrong, so neither number is usable`,
      )
    }
  }

  // THE VERDICT. Same clip both sides, so its true length cancels and what is
  // left is what the boundaries cost.
  const verdicts = []
  for (const [hom, het, what, role] of [
    ['call 48k x4 no-sil', 'call 48k x4 + sil 24k', 'call 48 kHz, interleaving 24 kHz silence', 'FINDING'],
    ['bell 24k x4 no-sil', 'bell 24k x4 + sil 24k', 'bell 24 kHz, interleaving 24 kHz silence', 'CONTROL'],
  ]) {
    const H = arms[hom]
    const T = arms[het]
    if (!H || !T) {
      problems.push(`missing arm for the ${role.toLowerCase()}: ${!H ? hom : het}`)
      continue
    }
    if (H.clipDwell.length < MIN_DWELLS || T.clipDwell.length < MIN_DWELLS) {
      problems.push(`${what}: only ${H.clipDwell.length}/${T.clipDwell.length} clip dwells (want ≥ ${MIN_DWELLS} each)`)
    }
    const h = median(H.clipDwell)
    const t = median(T.clipDwell)
    verdicts.push({
      role,
      what,
      homogeneousDwellMs: r1(h),
      heterogeneousDwellMs: r1(t),
      perBoundaryDeltaMs: h === null || t === null ? null : r1(t - h),
      homogeneousMadMs: r1(mad(H.clipDwell)),
      heterogeneousMadMs: r1(mad(T.clipDwell)),
      n: Math.min(H.clipDwell.length, T.clipDwell.length),
    })
  }

  const finding = verdicts.find((v) => v.role === 'FINDING')
  const control = verdicts.find((v) => v.role === 'CONTROL')
  if (finding?.perBoundaryDeltaMs !== null && control?.perBoundaryDeltaMs !== null && finding && control) {
    // The control's whole job. Both of its arms are homogeneous 24 kHz, so if
    // interleaving silence costs the SAME there, the rate is not what is being
    // paid for — the silence track itself is, and the fix is a different one.
    if (Math.abs(control.perBoundaryDeltaMs) > 25) {
      notes.push(
        `the CONTROL also moved by ${control.perBoundaryDeltaMs} ms, and both of its arms are 24 kHz —` +
          ` so interleaving a silence track costs something regardless of rate. Subtract the control from` +
          ` the finding before attributing anything to the sample rate`,
      )
    }
  }

  return { ok: problems.length === 0, problems, notes, runId, arms, verdicts }
}

function main() {
  const logPath = arg('log')
  if (!logPath || !existsSync(logPath)) {
    console.error('Usage: playlist-ruler.mjs --log=<logcat file>')
    process.exit(3)
  }
  const report = analyze(readFileSync(logPath, 'utf8'))

  console.log(`run ${report.runId ?? '(none)'}\n`)
  console.log(
    ['arm', 'rates', 'n', 'skew', 'clipDwell', 'silDwell', 'residual']
      .map((h, i) => (i === 0 ? h.padEnd(24) : i === 1 ? h.padEnd(22) : h.padStart(11)))
      .join(''),
  )
  for (const a of Object.values(report.arms)) {
    console.log(
      a.arm.padEnd(24) +
        String(a.rates ?? '').padEnd(22) +
        String(a.reps).padStart(11) +
        String(r1(median(a.skew)) ?? '-').padStart(11) +
        String(r1(median(a.clipDwell)) ?? '-').padStart(11) +
        String(r1(median(a.silDwell)) ?? '-').padStart(11) +
        String(r1(median(a.residual)) ?? '-').padStart(11),
    )
  }

  console.log('')
  for (const v of report.verdicts) {
    console.log(
      `${v.role}: ${v.what}\n` +
        `  homogeneous ${v.homogeneousDwellMs} ms (MAD ${v.homogeneousMadMs}) vs ` +
        `heterogeneous ${v.heterogeneousDwellMs} ms (MAD ${v.heterogeneousMadMs}), n=${v.n}\n` +
        `  => ${v.perBoundaryDeltaMs} ms per boundary`,
    )
  }

  if (report.notes?.length) console.log('\n' + report.notes.map((n) => 'NOTE: ' + n).join('\n'))
  if (!report.ok) {
    console.error('\n' + report.problems.map((p) => 'PROBLEM: ' + p).join('\n'))
    process.exit(2)
  }
}

if (process.argv[1]?.endsWith('playlist-ruler.mjs')) main()
