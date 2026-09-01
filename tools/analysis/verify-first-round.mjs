/**
 * Log-only first-round audio correlator.
 *
 * Loop Stage 3a of the 10-Workout Audio Verification Loop
 * (see .claude/plans/it-s-time-to-build-linked-deer.md).
 *
 * Reads an expected manifest emitted by first-round-manifest.ts +
 * a captured logcat.txt from a drive session, categorizes every
 * expected coach event as matched / missing / late / wrong-asset /
 * duplicated, counts transport re-anchor events (health indicator),
 * and emits a verdict.
 *
 * Fast-fails on the "hard-zero" categories per the Loop plan
 * principle #15:
 *   - duplicated coach events (any)
 *   - wrong-asset matches (any)
 *   - missing required combo-announces (any)
 *   - deferred combo-announces (the coach lane was busy and the call
 *     was DROPPED rather than stacked — silence the athlete notices)
 *   - assetMissing (the dispatcher had no clip for a compiled slot)
 *   - notArmed (the score path never armed on a workout whose manifest
 *     expects score slots)
 * The last three are provenance-gated: they are suppressed to soft
 * warnings when the capture and the manifest cannot be proven to be the
 * same timeline, because on a stale pair their absence proves nothing.
 *
 * Anchor storm is a health flag, never a hard fail — it is a diagnostic
 * signal for Stage 3b (acoustic) to prove the audio-visual disconnect.
 *
 * Usage:
 *   node tools/analysis/verify-first-round.mjs \
 *     --manifest tools/analysis/manifests/<id>.json \
 *     --session <sessionDir>
 *
 * Exit codes: 0=pass, 1=hard-fail, 2=soft-warn (audible but drifted),
 *             3=usage/missing input, 4=STALE (manifest/capture provenance
 *               mismatch — correlation ran but its rows are advisory)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

// The announcer's `announce()` path fires the phrase EARLIER than the
// strike beat (call-ahead), while `onTokenDue` fires AT the strike beat.
// The manifest anchors every per-word event to the strike beat (the
// engine's `token-due` moment), so the observed event may lead the
// expected by up to a phrase's duration. Widen the windows accordingly:
// matched = "same second"; late = "within the following combo's window".
const MATCH_WINDOW_MS = 1000
const LATE_WINDOW_MS = 2500

// Re-anchor REGRESSION ceiling, scoped to the OBSERVED round-1 window.
// Measured across the 17 full-length archived sessions:
//   154 170 184 251 255 259 263 266 274 280 283 285 295 404 423 553 1575
//   (min 154 / p50 274 / p75 285 / max 1575)
// The previous budget of 20 was never met by any capture and cannot be
// while the anchor storm is open, so it fired on every run and carried no
// information. 300 fires on the four genuine outliers only.
//
// Deliberately excluded from that band: three-round-fundamentals-1788189840859,
// whose capture ends 55s after t0 where every other runs ~346s. Its raw count
// of 78 looks best-in-fleet but its RATE is 1.42/s — the worst measured —
// so including it would invert the argument.
const RE_ANCHOR_REGRESSION_CEILING = 300

/**
 * How far a `slotDispatcher.deferred` record may sit from the expectation
 * it is claimed to explain. Expectation-relative, NOT an absolute window:
 * heavy-hands and pace-pusher both open with an expectation at
 * `expectedStartMs = -2355` (the coach leads the bell), which leaves almost
 * no headroom under an absolute lower bound and would silently downgrade a
 * real dropped first-announce to an unattributed warning.
 */
const DEFER_JOIN_WINDOW_MS = 5000

// ---------------------------------------------------------------------------
// Logcat parser
// ---------------------------------------------------------------------------

/**
 * Match a logcat line prefix + puncheokie event.
 * `adb logcat -v time` format: `MM-DD HH:MM:SS.mmm I/ReactNativeJS(pid): 'msg', ...'`
 */
const LOG_PREFIX = /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+\w\/\w+\(\s*\d+\):\s*(.*)$/

function parseTimestampMs(dateStr, timeStr) {
  // Return an absolute epoch-like ms — we only care about DIFFERENCES,
  // so relative to an arbitrary base is fine.
  const [hh, mm, ss] = timeStr.split(':')
  const [ssI, ms] = ss.split('.')
  return (
    Number(hh) * 3600_000 +
    Number(mm) * 60_000 +
    Number(ssI) * 1000 +
    Number(ms)
  )
}

/** Extract a specific field from a JSON-like body inside a log line. */
function extractField(body, key) {
  const re = new RegExp(`${key}:\\s*'([^']*)'|${key}:\\s*"([^"]*)"|${key}:\\s*([0-9.eE+-]+)`)
  const m = body.match(re)
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

/** `extractField`, coerced to a number. `undefined` stays `undefined`. */
function numField(body, key) {
  const v = extractField(body, key)
  return v === undefined ? undefined : Number(v)
}

/**
 * Stitch multi-line logcat records. React Native's logger emits object
 * payloads across multiple lines, all with the same timestamp+prefix.
 * We collapse them into single body strings so a `text:` field ~2 lines
 * below the `puncheokie.voice.play` tag is visible to `extractField`.
 *
 * Continuation heuristic: a line whose body starts with whitespace + a
 * field name (`text:`, `durationMs:`, `asset:`, etc.) or a closing `}`
 * is appended to the previous record's body.
 */
function stitchLogRecords(logcatText) {
  const lines = logcatText.split(/\r?\n/)
  const records = []
  let current = null
  for (const rawLine of lines) {
    const m = LOG_PREFIX.exec(rawLine)
    if (!m) {
      // A non-prefix line ENDS the record in progress — it must be
      // flushed, not discarded. Dropping it lost the final record of
      // every logcat in the archive (files end with a content line plus
      // a trailing newline, and `split` yields a last empty string that
      // fails LOG_PREFIX), so 1663 `clip playing` lines parsed to 1656
      // events. Benign in the archive because the casualty always sat in
      // round 3, but this is exactly the silent-dropper class every
      // verdict downstream is sensitive to.
      if (current) records.push(current)
      current = null
      continue
    }
    const [, dateStr, timeStr, body] = m
    const startsWithTag = body.startsWith("'[")
    if (startsWithTag || current === null) {
      if (current) records.push(current)
      current = { dateStr, timeStr, body }
    } else {
      current.body += ' ' + body.trim()
    }
  }
  if (current) records.push(current)
  return records
}

/**
 * Parse a whole logcat file into a stream of typed events we care about.
 */
export function parseLogcat(logcatText) {
  const events = []
  const records = stitchLogRecords(logcatText)
  for (const { dateStr, timeStr, body } of records) {
    const ts = parseTimestampMs(dateStr, timeStr)
    if (body.includes('puncheokie.runner.start')) {
      events.push({ type: 'runner.start', ts, raw: body })
      continue
    }
    if (body.includes('puncheokie.round.boundary')) {
      events.push({
        type: 'round.boundary',
        ts,
        transition: extractField(body, 'transition'),
        roundIndex: numField(body, 'roundIndex'),
        workElapsedMs: numField(body, 'workElapsedMs'),
        raw: body,
      })
      continue
    }
    if (body.includes('puncheokie.slotDispatcher.armed')) {
      events.push({
        type: 'slotDispatcher.armed',
        ts,
        workout: extractField(body, 'workout'),
        totalCompiledSlots: numField(body, 'totalCompiledSlots'),
        enqueuedSlots: numField(body, 'enqueuedSlots'),
        announceThenWorkCues: numField(body, 'announceThenWorkCues'),
        timelineHash: extractField(body, 'timelineHash'),
        raw: body,
      })
      continue
    }
    if (body.includes('puncheokie.slotDispatcher.deferred')) {
      events.push({
        type: 'slotDispatcher.deferred',
        ts,
        slotId: extractField(body, 'slotId'),
        audibleUntilMs: numField(body, 'audibleUntilMs'),
        raw: body,
      })
      continue
    }
    if (body.includes('puncheokie.slotDispatcher.assetMissing')) {
      events.push({
        type: 'slotDispatcher.assetMissing',
        ts,
        assetId: extractField(body, 'assetId'),
        slotId: extractField(body, 'slotId'),
        raw: body,
      })
      continue
    }
    if (body.includes("'intro playing'")) {
      events.push({ type: 'intro.playing', ts, raw: body })
      continue
    }
    if (body.includes("'intro complete'")) {
      events.push({ type: 'intro.complete', ts, raw: body })
      continue
    }
    if (body.includes("puncheokie.metronome") && body.includes("loop started")) {
      events.push({ type: 'metronome.started', ts, raw: body })
      continue
    }
    if (body.includes('puncheokie.transport') && body.includes('re-anchored')) {
      events.push({ type: 'transport.reanchor', ts, raw: body })
      continue
    }
    // ORDERING IS LOAD-BEARING: 'puncheokie.voice.playFailed' CONTAINS
    // 'puncheokie.voice.play'. Below the play branch these match it, fall
    // through both inner arms, and hit its unconditional `continue` —
    // parsed to nothing at all. They must be tested first.
    if (body.includes('puncheokie.voice.playFailed')) {
      events.push({
        type: 'voice.playFailed',
        ts,
        asset: extractField(body, 'asset'),
        text: extractField(body, 'text'),
        raw: body,
      })
      continue
    }
    if (body.includes('puncheokie.voice.clipMissing')) {
      events.push({ type: 'voice.clipMissing', ts, asset: extractField(body, 'asset'), raw: body })
      continue
    }
    if (body.includes("puncheokie.voice.play")) {
      if (body.includes("'combo-announce playing'")) {
        const text = extractField(body, 'text')
        const durationMs = extractField(body, 'durationMs')
        events.push({
          type: 'voice.combo-announce',
          ts,
          text,
          durationMs: durationMs !== undefined ? Number(durationMs) : undefined,
          raw: body,
        })
      } else if (body.includes("'click-script playing'")) {
        // Script Bible v2 (2026-09-01): section lead-in or rest script.
        events.push({
          type: 'voice.click-script',
          ts,
          text: extractField(body, 'text'),
          durationMs: numField(body, 'durationMs'),
          raw: body,
        })
      } else if (body.includes("'clip playing'")) {
        const asset = extractField(body, 'asset')
        // Bell tagging is ADDITIVE — the bell is still a voice.clip. Retyping
        // it would quietly remove three events per session from `observed`
        // and shift the extras count for no stated reason.
        if (asset === 'bell') events.push({ type: 'bell', ts, asset, raw: body })
        events.push({
          type: 'voice.clip',
          ts,
          asset,
          form: extractField(body, 'form'),
          vocabulary: extractField(body, 'vocabulary'),
          priority: numField(body, 'priority'),
          raw: body,
        })
      }
      continue
    }
    if (body.includes('puncheokie.clickScript.skipped')) {
      events.push({ type: 'clickScript.skipped', ts, slot: extractField(body, 'slot'), raw: body })
      continue
    }
    if (body.includes('puncheokie.clickScript.dispatch')) {
      events.push({
        type: 'clickScript.dispatch',
        ts,
        slot: extractField(body, 'slot'),
        dispatchAtMs: numField(body, 'dispatchAtMs'),
        lateMs: numField(body, 'lateMs'),
        raw: body,
      })
      continue
    }
    if (body.includes("puncheokie.cue.tokenDue")) {
      events.push({
        type: 'cue.tokenDue',
        ts,
        roundIndex: numField(body, 'roundIndex'),
        workElapsedMs: numField(body, 'workElapsedMs'),
        raw: body,
      })
      continue
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

/**
 * Anchor observed events to workElapsedMs=0.
 *
 * Order matters and was chosen by measurement, not preference:
 *
 * 1. `round.boundary` work-entered IS the transition — the truest zero.
 *    Available only on bundles carrying the GH #305 instrumentation.
 * 2. `metronome.started` ('loop started') is the archive's anchor. It lags
 *    the work bell by 262-369ms, but it stays SECOND so that re-running
 *    this tool over archived captures does not shift their time axis and
 *    silently re-baseline every stored verdict.
 * 3. The bell is third. It is the only universal marker, and it matters for
 *    the six workouts with `metronome.enabled: false`, where t0 otherwise
 *    degrades all the way to `runner.start` — 19.4-35.8s off, which reports
 *    literally everything as missing.
 *
 * Promoting the bell to second was tried and rejected: it moves t0 in 15 of
 * 17 complete sessions and makes four of them WORSE on hard-fail metrics.
 */
function findT0(events) {
  const boundary = events.find(
    (e) => e.type === 'round.boundary' && e.transition === 'work-entered',
  )
  if (boundary) return { ts: boundary.ts, source: 'round.boundary work-entered' }
  const metronome = events.find((e) => e.type === 'metronome.started')
  if (metronome) return { ts: metronome.ts, source: 'metronome.started' }
  const bell = events.find((e) => e.type === 'bell')
  if (bell) return { ts: bell.ts, source: 'bell' }
  const runnerStart = events.find((e) => e.type === 'runner.start')
  if (runnerStart) return { ts: runnerStart.ts, source: 'runner.start' }
  return null
}

/**
 * Is this capture and this manifest provably the same compiled timeline?
 *
 * The app logs the hash it actually compiled in `slotDispatcher.armed`. The
 * report printed the MANIFEST's hash beside it and let the reader assume the
 * two agreed; they need not, and after any compiler change they do not.
 *
 * Three states:
 *   `match`       — the app compiled exactly what the manifest describes.
 *   `mismatch`    — it did not. The per-event rows are advisory, NOT wrong:
 *                   `hashTimelineContent` covers {strikes, coachSlots,
 *                   phaseBoundaries}, while per-word expectations derive
 *                   from `expandTimeline`. Across 83cc51a, TRF's strikes
 *                   moved while all 56 per-word coachEvents stayed
 *                   byte-identical — so a mismatch does not imply the
 *                   expectations moved. Hence STALE, not FAIL.
 *   `unavailable` — no armed record. Means coach-off, a truncated capture,
 *                   or a pre-instrumentation build. It does NOT mean
 *                   "per-word workout": the armed log sits inside
 *                   `if (announcer && voice)` with no slot-count guard, so
 *                   even a zero-slot workout carries a hash.
 */
function checkProvenance(events, manifest) {
  const armed = events.filter((e) => e.type === 'slotDispatcher.armed')
  if (armed.length === 0) {
    return { state: 'unavailable', reason: 'no slotDispatcher.armed record in capture', armedCount: 0 }
  }
  const last = armed[armed.length - 1]
  const distinctHashes = [...new Set(armed.map((a) => a.timelineHash).filter(Boolean))]
  const deviceHash = last.timelineHash
  const manifestHash = manifest.identity?.timelineHash
  const workoutMismatch = Boolean(last.workout) && last.workout !== manifest.workoutId
  return {
    state: deviceHash && manifestHash && deviceHash === manifestHash ? 'match' : 'mismatch',
    deviceHash,
    manifestHash,
    deviceWorkout: last.workout,
    workoutMismatch,
    distinctHashes,
    armedCount: armed.length,
    totalCompiledSlots: last.totalCompiledSlots,
    enqueuedSlots: last.enqueuedSlots,
    announceThenWorkCues: last.announceThenWorkCues,
  }
}

/**
 * The wall-clock span this report should judge: from t0 to the first rest
 * boundary after it, falling back to the manifest's authored work duration
 * when the capture predates the boundary instrumentation.
 *
 * Without this the re-anchor count and the extras list span every round the
 * capture happened to cover (~346s of a 240s round), which is why long
 * sessions reported inflated numbers against a single-round manifest.
 */
function findRoundWindow(events, t0, manifest) {
  const fallbackMs = manifest.workDurationMs ?? 0
  if (!t0) return { endMs: fallbackMs, bounded: false, truncated: false }
  const rest = events.find(
    (e) => e.type === 'round.boundary' && e.transition === 'rest-entered' && e.ts >= t0.ts,
  )
  if (rest) return { endMs: rest.ts - t0.ts, bounded: true, truncated: false }
  const lastTs = events.length > 0 ? events[events.length - 1].ts : t0.ts
  const observedMs = lastTs - t0.ts
  return {
    endMs: fallbackMs,
    bounded: false,
    // The capture ended before the round did — counts are not comparable
    // with a full-length session's.
    truncated: observedMs < fallbackMs * 0.9,
    observedMs,
  }
}

/**
 * Correlate observed audio events against expected coach events. Handles
 * two expected kinds:
 *   - `combo-announce`: matched to `voice.combo-announce` observed
 *     events by TEXT (log emits text but not assetId today).
 *   - `per-word`: matched to `voice.clip` observed events by ASSET id
 *     (log fields the asset name for clip plays).
 *
 * Categories per expected event: matched / late / missing.
 * Categories per unmatched observed event: extra / duplicated.
 */
/**
 * The compiled slotId prefix an expectation owns. Slot ids are minted in
 * `workoutScore.ts` as
 *   `${cueId}:${repId ?? 'cue'}:${contentKind}:${relation}:${strikeEventIds}`
 * so the prefix through `contentKind` identifies the expectation even when
 * the manifest predates the `slotId` field. Verified to have zero prefix
 * collisions across every compiled coach slot of all 10 workouts.
 */
function slotKeyPrefix(exp) {
  return `${exp.cueId}:${exp.repId ?? 'cue'}:combo-announce:`
}

/**
 * The deferral record that explains this missing expectation, if any.
 * A deferred call is a call the app deliberately DROPPED because the coach
 * lane was still sounding — materially different from one it never
 * attempted, and the only way to tell them apart from the outside.
 */
function findDeferralFor(exp, deferrals) {
  const prefix = slotKeyPrefix(exp)
  for (const d of deferrals) {
    if (!d.slotId) continue
    const hit = exp.slotId ? d.slotId === exp.slotId : d.slotId.startsWith(prefix)
    if (!hit) continue
    if (Math.abs(d.elapsedMs - exp.expectedStartMs) > DEFER_JOIN_WINDOW_MS) continue
    return d
  }
  return null
}

function correlateCoachEvents(expected, observed, deferrals = []) {
  const observedByText = new Map()
  const observedByAsset = new Map()
  const observedClickByText = new Map()
  for (const e of observed) {
    if (e.type === 'voice.click-script' && e.text) {
      if (!observedClickByText.has(e.text)) observedClickByText.set(e.text, [])
      observedClickByText.get(e.text).push(e)
    } else if (e.type === 'voice.combo-announce' && e.text) {
      if (!observedByText.has(e.text)) observedByText.set(e.text, [])
      observedByText.get(e.text).push(e)
    } else if (e.type === 'voice.clip' && e.asset) {
      if (!observedByAsset.has(e.asset)) observedByAsset.set(e.asset, [])
      observedByAsset.get(e.asset).push(e)
    }
  }
  const usedObservedIndex = new Set()
  const verdicts = []
  // A PRECALL is authored BEFORE the bell (expectedStartMs < 0), but the
  // runner only advances the dispatcher during `work` — the earliest a
  // precall can physically fire is the first work tick. Judging it
  // against its authored pre-bell moment scored a perfectly good opener
  // (played at +1108ms, over the bell tail) as missing-plus-extra, with
  // the play 3.4s "off" a target the system is structurally unable to
  // hit. Floor the comparison point at round start; the authored value
  // stays in the manifest as intent. Firing precalls during the
  // countdown for real is a runtime follow-up, at which point this floor
  // becomes a no-op.
  const comparisonStartMs = (exp) =>
    exp.kind === 'combo-announce' ? Math.max(0, exp.expectedStartMs) : exp.expectedStartMs
  for (const exp of expected) {
    let candidates = []
    if (exp.kind === 'combo-announce') {
      candidates = observedByText.get(exp.text ?? '') ?? []
    } else if (exp.kind === 'per-word') {
      candidates = observedByAsset.get(exp.assetId) ?? []
    } else if (exp.kind === 'lead-in') {
      candidates = observedClickByText.get(exp.text ?? '') ?? []
    }
    let bestIdx = -1
    let bestDelta = Number.POSITIVE_INFINITY
    for (let i = 0; i < candidates.length; i += 1) {
      const globalIdx = observed.indexOf(candidates[i])
      if (usedObservedIndex.has(globalIdx)) continue
      const delta = candidates[i].elapsedMs - comparisonStartMs(exp)
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta
        bestIdx = globalIdx
      }
    }
    if (bestIdx === -1 || Math.abs(bestDelta) > LATE_WINDOW_MS) {
      const deferral =
        exp.kind === 'combo-announce' ? findDeferralFor(exp, deferrals) : null
      verdicts.push({
        expected: exp,
        verdict: deferral ? 'deferred' : 'missing',
        observed: null,
        deltaMs: deferral ? deferral.elapsedMs - exp.expectedStartMs : null,
        ...(deferral
          ? {
              reason: 'deferred (coach lane busy)',
              deferredAtMs: Math.round(deferral.elapsedMs),
              audibleUntilMs: deferral.audibleUntilMs,
              slotId: deferral.slotId,
            }
          : {}),
      })
    } else if (Math.abs(bestDelta) <= MATCH_WINDOW_MS) {
      usedObservedIndex.add(bestIdx)
      verdicts.push({
        expected: exp,
        verdict: 'matched',
        observed: observed[bestIdx],
        deltaMs: bestDelta,
      })
    } else {
      usedObservedIndex.add(bestIdx)
      verdicts.push({
        expected: exp,
        verdict: 'late',
        observed: observed[bestIdx],
        deltaMs: bestDelta,
      })
    }
  }
  // Anything observed that didn't get claimed = 'extra' initially, then
  // reclassify as 'duplicated' if it matches an expected event's identity
  // within the late window.
  const extras = []
  observed.forEach((e, i) => {
    if (usedObservedIndex.has(i)) return
    if (
      e.type !== 'voice.combo-announce' &&
      e.type !== 'voice.clip' &&
      e.type !== 'voice.click-script'
    )
      return
    extras.push({ observed: e, verdict: 'extra' })
  })
  for (const ex of extras) {
    const isCombo = ex.observed.type === 'voice.combo-announce'
    const nearby = expected.find((exp) => {
      if (isCombo && exp.kind === 'combo-announce' && exp.text === ex.observed.text) {
        return Math.abs(ex.observed.elapsedMs - comparisonStartMs(exp)) <= LATE_WINDOW_MS
      }
      if (
        ex.observed.type === 'voice.click-script' &&
        exp.kind === 'lead-in' &&
        exp.text === ex.observed.text
      ) {
        return Math.abs(ex.observed.elapsedMs - exp.expectedStartMs) <= LATE_WINDOW_MS
      }
      if (!isCombo && exp.kind === 'per-word' && exp.assetId === ex.observed.asset) {
        return Math.abs(ex.observed.elapsedMs - exp.expectedStartMs) <= LATE_WINDOW_MS
      }
      return false
    })
    if (nearby) {
      ex.verdict = 'duplicated'
      ex.expected = nearby
    }
  }
  return { verdicts, extras }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function classifyRunHealth(t0, reanchor, verdicts, extras, dispatcher, provenance, manifest) {
  const count = (k) => verdicts.filter((v) => v.verdict === k).length
  const matched = count('matched')
  const late = count('late')
  const missing = count('missing')
  const deferred = count('deferred')
  // Still 0, and honestly so. The candidate pool is pre-filtered on the
  // expected event's OWN identity (text for combo-announces, assetId for
  // per-word), so no code path here can produce a right-time/wrong-asset
  // pairing. Detecting it needs a sequence-alignment matcher; one was
  // prototyped and measured to invent 4-10 false substitutions per session,
  // so it was rejected rather than shipped. See the commit message.
  const wrongAsset = 0
  const duplicated = extras.filter((e) => e.verdict === 'duplicated').length
  const extra = extras.filter((e) => e.verdict === 'extra').length
  const total = verdicts.length

  const comboEvents = (manifest.coachEvents ?? []).filter((e) => e.kind === 'combo-announce')
  const comboExpected = comboEvents.length
  const expectsScoreSlots = comboExpected > 0

  // A deferral we could not tie to any expectation. Still worth surfacing —
  // it means the coach dropped a call we did not predict.
  const deferredUnattributed = Math.max(0, dispatcher.deferredCount - deferred)
  const assetMissing = dispatcher.assetMissingCount
  const notArmed = expectsScoreSlots && !dispatcher.armed

  const stale = provenance.state === 'mismatch'
  const identityUnknown = provenance.state === 'unavailable'
  // The three NEW gates fire on records never once captured. Suppress them to
  // warnings when the capture and manifest are not provably the same
  // timeline; `missing`/`duplicated` keep hard-failing, because a stale pair
  // can still surface a genuine coach bug.
  const gateSuppressed = stale || identityUnknown
  const newGates = deferred > 0 || assetMissing > 0 || notArmed
  const reanchorRegression = reanchor.inRound1 > RE_ANCHOR_REGRESSION_CEILING

  const hardFail =
    !t0 ||
    provenance.workoutMismatch ||
    missing > 0 ||
    duplicated > 0 ||
    (!gateSuppressed && newGates)
  const softWarn =
    late > 0 ||
    extra > 0 ||
    deferredUnattributed > 0 ||
    reanchorRegression ||
    (gateSuppressed && newGates)

  return {
    total,
    comboExpected,
    matched,
    late,
    missing,
    deferred,
    deferredUnattributed,
    assetMissing,
    wrongAsset,
    duplicated,
    extra,
    reanchorInRound1: reanchor.inRound1,
    reanchorTotal: reanchor.total,
    reanchorCount: reanchor.total, // back-compat JSON key
    observedWindowMs: reanchor.observedWindowMs,
    truncated: reanchor.truncated,
    reanchorRegression,
    notArmed,
    expectsScoreSlots,
    stale,
    provenance: provenance.state,
    hardFail,
    softWarn,
    // STALE is checked AFTER hardFail so it can never mask a real failure,
    // and BEFORE softWarn so a stale-but-clean pair can never report green.
    verdict: hardFail ? 'FAIL' : stale ? 'STALE' : softWarn ? 'WARN' : 'PASS',
  }
}

function renderReport(
  manifestPath,
  sessionDir,
  manifest,
  t0,
  health,
  verdicts,
  extras,
  dispatcher,
  provenance,
) {
  const lines = []
  lines.push(`# First-round verification — ${manifest.workoutName}`)
  lines.push('')
  lines.push(`- Manifest: \`${manifestPath}\``)
  lines.push(`- Session: \`${sessionDir}\``)
  lines.push(`- Manifest timeline hash: \`${manifest.identity.timelineHash}\``)
  if (provenance.state === 'match') {
    lines.push(`- Provenance: **verified** — the app compiled this exact timeline.`)
  } else if (provenance.state === 'mismatch') {
    lines.push(
      `- Provenance: **STALE** — the app compiled \`${provenance.deviceHash}\`, ` +
        `the manifest describes \`${provenance.manifestHash}\`. Per-event rows below ` +
        `are ADVISORY: per-word expectations may still be valid (they derive from ` +
        `\`expandTimeline\`, not from the hashed score), but nothing here is proof.`,
    )
    lines.push(
      `  Regenerate with: \`node --import ./tools/analysis/wav-stub.mjs --import tsx ` +
        `tools/analysis/first-round-manifest.ts --workout=${manifest.workoutId}\` and re-drive.`,
    )
  } else {
    lines.push(
      `- Provenance: **UNVERIFIED** — ${provenance.reason}. The capture carries no ` +
        `compiled-timeline hash, so it cannot be tied to this manifest at all.`,
    )
  }
  if (provenance.workoutMismatch) {
    lines.push(
      `- **FATAL: workout mismatch** — the device ran \`${provenance.deviceWorkout}\`, ` +
        `this manifest is for \`${manifest.workoutId}\`.`,
    )
  }
  if ((provenance.distinctHashes?.length ?? 0) > 1) {
    lines.push(
      `- Note: the dispatcher armed ${provenance.armedCount}× with ` +
        `${provenance.distinctHashes.length} distinct hashes — the capture spans a ` +
        `re-arm (${provenance.distinctHashes.join(', ')}).`,
    )
  }
  lines.push(`- BPM: ${manifest.bpm} · Work duration: ${manifest.workDurationMs / 1000}s`)
  lines.push(`- t0 anchor: ${t0 ? t0.source + ' @ ' + t0.ts + 'ms' : 'MISSING (fatal)'}`)
  lines.push('')
  lines.push(`## Verdict: **${health.verdict}**`)
  lines.push('')
  lines.push(`| Metric | Count |`)
  lines.push(`|---|---|`)
  lines.push(`| Total expected coach events | ${health.total} |`)
  lines.push(`| Matched (within ±${MATCH_WINDOW_MS}ms) | ${health.matched} |`)
  lines.push(`| Late (${MATCH_WINDOW_MS}–${LATE_WINDOW_MS}ms drift) | ${health.late} |`)
  lines.push(`| Missing | ${health.missing} |`)
  lines.push(`| Deferred (coach lane busy — DROPPED) | ${health.deferred} |`)
  lines.push(`| Duplicated | ${health.duplicated} |`)
  lines.push(`| Extra (stray) | ${health.extra} |`)
  const windowSec = Math.round((health.observedWindowMs ?? 0) / 1000)
  const rate =
    health.observedWindowMs > 0
      ? (health.reanchorInRound1 / (health.observedWindowMs / 1000)).toFixed(2)
      : '—'
  lines.push(
    `| Transport re-anchors (round 1) | ${health.reanchorInRound1} ` +
      `(ceiling: ${RE_ANCHOR_REGRESSION_CEILING}) |`,
  )
  lines.push(
    `| Transport re-anchors (whole capture) | ${health.reanchorTotal} — ${rate}/s over ${windowSec}s` +
      `${health.truncated ? ' — capture truncated, count not comparable' : ''} |`,
  )
  lines.push('')
  lines.push(`## Dispatcher (score path)`)
  lines.push('')
  lines.push(`| Field | Value |`)
  lines.push(`|---|---|`)
  lines.push(`| Armed | ${dispatcher.armed ? 'yes' : '**no**'} |`)
  lines.push(`| totalCompiledSlots | ${dispatcher.totalCompiledSlots ?? '—'} |`)
  lines.push(`| enqueuedSlots | ${dispatcher.enqueuedSlots ?? '—'} |`)
  lines.push(`| announceThenWorkCues | ${dispatcher.announceThenWorkCues ?? '—'} |`)
  lines.push(`| manifest round-0 combo-announce expectations | ${health.comboExpected} |`)
  lines.push(`| deferred (dropped, lane busy) | ${dispatcher.deferredCount} |`)
  lines.push(`| ...of those, unattributed | ${health.deferredUnattributed} |`)
  lines.push(`| assetMissing | ${dispatcher.assetMissingCount} |`)
  lines.push('')
  if (health.notArmed) {
    lines.push(
      `> **The score path never armed**, yet this manifest expects ` +
        `${health.comboExpected} combo-announce(s) from it.`,
    )
    lines.push('')
  }
  if (verdicts.length > 0) {
    lines.push(`## Per-event verdicts`)
    lines.push('')
    lines.push(`| # | Expected text | Expected @ ms | Verdict | Observed @ ms | Δ ms |`)
    lines.push(`|---|---|---|---|---|---|`)
    verdicts.forEach((v, i) => {
      const text = (v.expected.text ?? v.expected.assetId ?? '').slice(0, 40)
      const obsMs = v.observed ? Math.round(v.observed.elapsedMs) : '—'
      const dMs = v.deltaMs !== null && v.deltaMs !== undefined ? Math.round(v.deltaMs) : '—'
      lines.push(
        `| ${i + 1} | ${text} | ${Math.round(v.expected.expectedStartMs)} | ${v.verdict} | ${obsMs} | ${dMs} |`,
      )
    })
    lines.push('')
  }
  if (extras.length > 0) {
    lines.push(`## Extra / duplicated observed events`)
    lines.push('')
    lines.push(`| # | Text | Observed @ ms | Verdict |`)
    lines.push(`|---|---|---|---|`)
    extras.forEach((e, i) => {
      lines.push(
        `| ${i + 1} | ${(e.observed.text ?? '').slice(0, 40)} | ${Math.round(e.observed.elapsedMs)} | ${e.verdict} |`,
      )
    })
    lines.push('')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { manifest: undefined, session: undefined }
  for (const a of argv) {
    if (a.startsWith('--manifest=')) args.manifest = a.slice('--manifest='.length)
    else if (a === '--manifest') args._nextManifest = true
    else if (args._nextManifest) {
      args.manifest = a
      args._nextManifest = false
    } else if (a.startsWith('--session=')) args.session = a.slice('--session='.length)
    else if (a === '--session') args._nextSession = true
    else if (args._nextSession) {
      args.session = a
      args._nextSession = false
    }
  }
  if (!args.manifest || !args.session) {
    throw new Error(
      'Usage: node tools/analysis/verify-first-round.mjs --manifest <path.json> --session <sessionDir>',
    )
  }
  return args
}

export function verify(manifest, logcatText) {
  const events = parseLogcat(logcatText)
  const t0 = findT0(events)
  const provenance = checkProvenance(events, manifest)
  const window = findRoundWindow(events, t0, manifest)
  const elapsed = (e) => (t0 ? e.ts - t0.ts : 0)
  // Scope observations to the round this manifest describes. Captures run
  // long (~346s against a 240s round), so without the bound a single-round
  // manifest was being judged against two-plus rounds of traffic and the
  // surplus all landed in `extra`.
  const inWindow = (e) => {
    const ms = elapsed(e)
    return ms >= -LATE_WINDOW_MS && ms <= window.endMs + LATE_WINDOW_MS
  }
  const observed = events
    .filter(
      (e) =>
        e.type === 'voice.combo-announce' ||
        e.type === 'voice.clip' ||
        e.type === 'voice.click-script',
    )
    .map((e) => ({ ...e, elapsedMs: elapsed(e) }))
    .filter(inWindow)
  const deferrals = events
    .filter((e) => e.type === 'slotDispatcher.deferred')
    .map((e) => ({ ...e, elapsedMs: elapsed(e) }))
  const reanchorAll = events.filter((e) => e.type === 'transport.reanchor')
  const reanchor = {
    total: reanchorAll.length,
    inRound1: reanchorAll.filter(inWindow).length,
    observedWindowMs: window.bounded ? window.endMs : (window.observedMs ?? window.endMs),
    truncated: window.truncated,
    bounded: window.bounded,
  }
  const dispatcher = {
    armed: events.some((e) => e.type === 'slotDispatcher.armed'),
    deferredCount: deferrals.length,
    assetMissingCount: events.filter((e) => e.type === 'slotDispatcher.assetMissing').length,
    totalCompiledSlots: provenance.totalCompiledSlots,
    enqueuedSlots: provenance.enqueuedSlots,
    announceThenWorkCues: provenance.announceThenWorkCues,
  }
  const { verdicts, extras } = correlateCoachEvents(
    manifest.coachEvents ?? [],
    observed,
    deferrals,
  )
  const health = classifyRunHealth(t0, reanchor, verdicts, extras, dispatcher, provenance, manifest)
  return {
    t0,
    verdicts,
    extras,
    health,
    provenance,
    dispatcher,
    reanchorCount: reanchor.total,
    observedCount: observed.length,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.manifest)) {
    console.error(`manifest not found: ${args.manifest}`)
    process.exit(3)
  }
  const sessionLogPath = join(args.session, 'logcat.txt')
  if (!existsSync(sessionLogPath)) {
    console.error(`session logcat not found: ${sessionLogPath}`)
    process.exit(3)
  }
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
  const logcatText = readFileSync(sessionLogPath, 'utf8')
  const result = verify(manifest, logcatText)
  const md = renderReport(
    basename(args.manifest),
    args.session,
    manifest,
    result.t0,
    result.health,
    result.verdicts,
    result.extras,
    result.dispatcher,
    result.provenance,
  )
  const reportPath = join(args.session, 'verify-report.md')
  const jsonPath = join(args.session, 'verify-report.json')
  writeFileSync(reportPath, md, 'utf8')
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        workoutId: manifest.workoutId,
        timelineHash: manifest.identity.timelineHash,
        provenance: result.provenance,
        dispatcher: result.dispatcher,
        t0: result.t0,
        health: result.health,
        reanchorCount: result.reanchorCount,
        observedCount: result.observedCount,
        verdicts: result.verdicts,
        extras: result.extras,
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(md)
  console.log(`\nWrote ${reportPath}`)
  console.log(`Wrote ${jsonPath}`)
  process.exit(
    result.health.hardFail ? 1 : result.health.stale ? 4 : result.health.softWarn ? 2 : 0,
  )
}

const invokedDirectly = process.argv[1]?.endsWith('verify-first-round.mjs')
if (invokedDirectly) {
  main()
}
