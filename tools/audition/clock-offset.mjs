/**
 * Host ↔ device clock offset, measured rather than assumed.
 *
 * The mic rig stamps `capture.wav` in PC epoch and `logcat -v epoch` in DEVICE
 * epoch, and `call_offset_analysis.py` aligns the two directly:
 *
 *     offset = -t0  # audioMs = devEpochMs + offset
 *
 * That is only correct if the two clocks agree. Measured on 2026-09-09 the
 * tablet was **1 565 ms behind** this host — so every mic-anchored number from
 * that path is a second and a half out. Nothing warns, because the error is a
 * constant: the shapes still look right, they just sit in the wrong place.
 *
 * Method. Each sample brackets one `adb shell date` between two host reads:
 *
 *     t1 ── (adb round trip) ── device reads its clock ── (rtt) ── t2
 *
 * The device's read happened somewhere inside [t1, t2], so the offset is
 * `device − (t1 + t2) / 2` with an uncertainty of ±rtt/2. Taking many samples
 * and keeping only the fastest round trips shrinks that: a slow adb call is
 * pure noise, and the minimum-rtt sample is the least contaminated estimate
 * available — the same reason NTP keeps its best-delay packets. This reports
 * the median of the fastest quartile and the residual spread, so a caller can
 * see whether the number deserves the precision it is about to be used at.
 *
 *   node tools/audition/clock-offset.mjs [--samples=N] [--json]
 *
 * `offsetMs` is DEVICE − HOST, so: hostEpoch = deviceEpoch − offsetMs.
 */
import { execFileSync } from 'node:child_process'

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const SAMPLES = Number(arg('samples') ?? 25)
const asJson = process.argv.includes('--json')

/** One bracketed read. Returns null if adb hiccups rather than poisoning the set. */
function sample(device) {
  const args = device ? ['-s', device, 'shell', 'date', '+%s%3N'] : ['shell', 'date', '+%s%3N']
  const t1 = Date.now()
  let out
  try {
    out = execFileSync('adb', args, { encoding: 'utf8', timeout: 5_000 })
  } catch {
    return null
  }
  const t2 = Date.now()
  const deviceMs = Number(String(out).trim())
  if (!Number.isFinite(deviceMs)) return null
  // The device read its clock somewhere inside [t1, t2], so the true offset
  // is bounded by [deviceMs - t2, deviceMs - t1]. Keeping the bracket, not
  // just its midpoint, is what lets many samples INTERSECT into a real bound.
  return { offsetMs: deviceMs - (t1 + t2) / 2, rttMs: t2 - t1, lo: deviceMs - t2, hi: deviceMs - t1 }
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function measureClockOffset({ samples = SAMPLES, device } = {}) {
  const taken = []
  for (let i = 0; i < samples; i += 1) {
    const s = sample(device)
    if (s) taken.push(s)
  }
  if (taken.length < 3) throw new Error(`only ${taken.length} usable samples — is the device connected?`)

  // Fastest quartile: a long round trip means the device's read sits further
  // from our midpoint guess, so those samples are wider, not merely noisier.
  const byRtt = [...taken].sort((a, b) => a.rttMs - b.rttMs)
  const keep = byRtt.slice(0, Math.max(3, Math.ceil(byRtt.length / 4)))
  const offsets = keep.map((s) => s.offsetMs)
  const offsetMs = Math.round(median(offsets))
  const spreadMs = Math.round(Math.max(...offsets) - Math.min(...offsets))
  const bestRttMs = keep[0].rttMs

  // Every sample is a hard bracket on the same constant, so their
  // INTERSECTION bounds it — the standard NTP argument. This is a guarantee
  // rather than a heuristic: a wide sample simply fails to narrow the band,
  // it cannot bias it. Use ALL samples, not just the fast ones; a slow round
  // trip still constrains one side.
  const lower = Math.max(...taken.map((s) => s.lo))
  const upper = Math.min(...taken.map((s) => s.hi))
  const bounded = lower <= upper

  return {
    /** Hard bracket from intersecting every sample. Null if they disagree,
     *  which would mean the clocks drifted measurably DURING the run. */
    boundLoMs: bounded ? Math.round(lower) : null,
    boundHiMs: bounded ? Math.round(upper) : null,
    boundWidthMs: bounded ? Math.round(upper - lower) : null,
    /** DEVICE − HOST. hostEpoch = deviceEpoch − offsetMs. */
    offsetMs,
    /** Half the best round trip: the floor on how well this can be known. */
    uncertaintyMs: Math.round(bestRttMs / 2),
    spreadMs,
    bestRttMs,
    samples: taken.length,
    kept: keep.length,
    measuredAt: new Date().toISOString(),
  }
}

if (process.argv[1]?.endsWith('clock-offset.mjs')) {
  const r = measureClockOffset()
  if (asJson) {
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.log(`device − host = ${r.offsetMs} ms  (±${r.uncertaintyMs} from best rtt ${r.bestRttMs} ms)`)
    console.log(`spread across the kept quartile: ${r.spreadMs} ms over ${r.kept}/${r.samples} samples`)
    if (r.boundWidthMs !== null) {
      console.log(`hard bracket from intersecting all ${r.samples} samples: [${r.boundLoMs}, ${r.boundHiMs}] — width ${r.boundWidthMs} ms`)
    } else {
      console.log(`WARNING: sample brackets do not intersect — the clocks drifted during the run; re-measure closer to use.`)
    }
    console.log(`→ hostEpoch = deviceEpoch − (${r.offsetMs})`)
    if (Math.abs(r.offsetMs) > 50) {
      console.log(`\nNOTE: ${Math.abs(r.offsetMs)} ms is far larger than any latency being measured.`)
      console.log(`Any tool that aligns logcat epochs against a PC-stamped wav WITHOUT this correction`)
      console.log(`is wrong by that much — see tools/audition/call_offset_analysis.py:106.`)
    }
  }
}
