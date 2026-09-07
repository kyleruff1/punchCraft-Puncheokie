/**
 * Logcat record parsing shared by every analyzer in this directory
 * (GH #292, plan C5 — factored out of verify-first-round.mjs so
 * verify-suite.mjs and observed-summary.mjs read the same shapes).
 *
 * `adb logcat -v time` lines look like
 *   `MM-DD HH:MM:SS.mmm I/ReactNativeJS(pid): '[puncheokie.x] message', { field: 1,`
 * and React Native's ConsoleSink wraps an object payload across several
 * lines with the SAME prefix. `stitchLogRecords` collapses those into one
 * body per record so `extractField` can see a field that sits two lines
 * below its event tag.
 */

/** `adb logcat -v time` prefix: date, time, level/tag(pid), body. */
export const LOG_PREFIX = /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+\w\/\w+\(\s*\d+\):\s*(.*)$/

/**
 * Milliseconds since midnight for a `-v time` timestamp. Only DIFFERENCES
 * are ever used, so a capture that crosses midnight is the caller's problem
 * (none of the archived ones do).
 */
export function parseTimestampMs(dateStr, timeStr) {
  const [hh, mm, ss] = timeStr.split(':')
  const [ssI, ms] = ss.split('.')
  return Number(hh) * 3600_000 + Number(mm) * 60_000 + Number(ssI) * 1000 + Number(ms)
}

/** Extract one field from a JSON-like body: `key: 'str'`, `key: "str"` or `key: 12.5`. */
export function extractField(body, key) {
  const re = new RegExp(`${key}:\\s*'([^']*)'|${key}:\\s*"([^"]*)"|${key}:\\s*([0-9.eE+-]+)`)
  const m = body.match(re)
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

/** `extractField`, coerced to a number. `undefined` stays `undefined`. */
export function numField(body, key) {
  const v = extractField(body, key)
  return v === undefined ? undefined : Number(v)
}

/** `extractField` for a boolean printed bare (`dev: false`) or quoted. */
export function boolField(body, key) {
  const m = body.match(new RegExp(`${key}:\\s*'?(true|false)'?`))
  return m ? m[1] === 'true' : undefined
}

/**
 * Stitch multi-line records into `{ dateStr, timeStr, body }` triples.
 *
 * A body that starts with `'[` opens a new record; any other prefixed line
 * is a continuation of the record in progress. A line without the prefix
 * ENDS the record in progress — it is flushed, never discarded (the last
 * record of every archived capture was lost before that rule existed).
 */
export function stitchLogRecords(logcatText) {
  const lines = logcatText.split(/\r?\n/)
  const records = []
  let current = null
  for (const rawLine of lines) {
    const m = LOG_PREFIX.exec(rawLine)
    if (!m) {
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
 * The event code of a stitched record, or undefined.
 *
 * `ConsoleSink` (src/diagnostics/logger.ts) writes
 * `console.info('[INFO] puncheokie.voice.play', 'clip playing', {…})`, which
 * reaches logcat as `'[INFO] puncheokie.voice.play', 'clip playing', { … }` —
 * the LEVEL is what sits in the brackets and the code follows it. A matcher
 * built on `'[<code>]` finds nothing on a real capture while passing happily
 * against a fixture written the same wrong way; that cost one release drive.
 */
export function recordTag(body) {
  const m = body.match(/^'\[[A-Z]+\]\s+([a-zA-Z0-9_.-]+)'/)
  return m ? m[1] : undefined
}

/**
 * Stitched records whose code is EXACTLY `tag`, each with its `ts` (ms since
 * midnight). Exact, so `puncheokie.qa.run` never swallows
 * `puncheokie.qa.run.blocked` or `.duplicate`.
 */
export function recordsWithTag(logcatText, tag) {
  return stitchLogRecords(logcatText)
    .filter((r) => recordTag(r.body) === tag)
    .map((r) => ({ ts: parseTimestampMs(r.dateStr, r.timeStr), body: r.body }))
}
