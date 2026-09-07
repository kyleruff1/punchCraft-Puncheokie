/**
 * Guards for the unattended suite driver (GH #292, plan B3): the pure parts
 * — URL and device-shell quoting, budget math, the volume and AudioTrack
 * parsers, verdict aggregation, the GitHub ledger row — plus the observed
 * summary it prints beside every verdict.
 */

import {
  aggregateVerdicts,
  appendLedgerRow,
  budgetMs,
  buildRunUrl,
  closerThan,
  compactStats,
  END_SLACK_MS,
  findLoopIssue,
  launchIntentArgs,
  ledgerRows,
  parseArgs,
  parseAudioTrackReading,
  parseCompactStats,
  parseVolumeGet,
  planJobs,
  quoteForDeviceShell,
  verdictFromVerifyExit,
  WALKOUT_ALLOWANCE_MS,
} from '../verify-suite.mjs'
import { latencyStats, summarizeObserved } from '../observed-summary.mjs'

describe('run URL', () => {
  it('carries every QA param, autostart and qa=1, URL-encoded', () => {
    const url = buildRunUrl({ workout: 'quick-one-two', vocab: 'techniques', sim: 'captured-jam', simForce: true, simBpm: 120, nonce: 'suite 1' })
    expect(url).toBe(
      'punchcraft://qa/run?workout=quick-one-two&vocab=techniques&sim=captured-jam&simForce=1&simBpm=120&autostart=1&qa=1&nonce=suite%201',
    )
  })

  it('quotes for the device shell so & does not fork, and never leaks a single quote', () => {
    expect(quoteForDeviceShell('punchcraft://qa/run?a=1&b=2')).toBe("'punchcraft://qa/run?a=1&b=2'")
    expect(quoteForDeviceShell("x'y")).toBe("'x%27y'")
  })

  it('builds the scheme-resolved intent, never a component name', () => {
    const argv = launchIntentArgs('punchcraft://qa/run?a=1&b=2', 'serial-1')
    expect(argv).toEqual([
      '-s', 'serial-1', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
      "'punchcraft://qa/run?a=1&b=2'", 'com.kyleruff.punchcraft',
    ])
    expect(argv.join(' ')).not.toContain('-n ')
  })
})

describe('budget', () => {
  const quick = { scheduleMs: [{ workMs: 240_000, restMs: 60_000 }, { workMs: 240_000, restMs: 0 }], workDurationMs: 240_000 }
  it('sums walkout + every work and rest + slack for a full session', () => {
    expect(budgetMs(quick)).toBe(WALKOUT_ALLOWANCE_MS + 540_000 + END_SLACK_MS)
  })
  it('caps a first-round-only drive at round 1', () => {
    expect(budgetMs(quick, { firstRoundOnly: true })).toBe(WALKOUT_ALLOWANCE_MS + 240_000 + END_SLACK_MS)
  })
  it('falls back to workDurationMs for a manifest without the session shape', () => {
    expect(budgetMs({ workDurationMs: 180_000 })).toBe(WALKOUT_ALLOWANCE_MS + 180_000 + END_SLACK_MS)
  })
})

describe('device parsers', () => {
  it('reads the media_session volume line as printed on the tablet', () => {
    const text = '[V] will control stream=3 (STREAM_MUSIC)\n[V] will get volume\n[V] Connecting to AudioService\n[V] volume is 13 in range [0..15]\n'
    expect(parseVolumeGet(text)).toEqual({ level: 13, min: 0, max: 15 })
    expect(parseVolumeGet('garbage')).toBeNull()
  })
  it('reads one audiotrack-count.sh line', () => {
    expect(parseAudioTrackReading('14:02:11  ours=12   others=3    system=15   pid=1234    at-arm')).toEqual({ ours: 12, others: 3, system: 15, pid: 1234 })
    expect(parseAudioTrackReading('app not running (com.kyleruff.punchcraft)')).toBeNull()
  })
})

describe('verdicts', () => {
  it('maps the verifier exit codes', () => {
    expect([0, 2, 1, 4, 3, null].map(verdictFromVerifyExit)).toEqual(['PASS', 'WARN', 'FAIL', 'STALE', 'ERROR', 'ERROR'])
  })
  it('aggregates: FAIL/ERROR → 1, STALE → 4, WARN → 2, else 0', () => {
    expect(aggregateVerdicts(['PASS', 'PASS'])).toBe(0)
    expect(aggregateVerdicts(['PASS', 'WARN'])).toBe(2)
    expect(aggregateVerdicts(['WARN', 'STALE'])).toBe(4)
    expect(aggregateVerdicts(['STALE', 'FAIL'])).toBe(1)
    expect(aggregateVerdicts(['ERROR'])).toBe(1)
    expect(aggregateVerdicts([])).toBe(0)
  })
})

describe('ledger', () => {
  const report = {
    verdicts: [{ status: 'matched' }, { status: 'matched' }, { status: 'late' }, { status: 'missing' }],
    extras: [{}, {}],
    reanchorCount: 7,
  }
  const TEMPLATE = [
    '## Context',
    '',
    '**Workout id**: `body-work`',
    '',
    '## Test-drive results',
    '',
    '| Drive | Timestamp | Commit | Verdict | Top mismatches | Closer? |',
    '|---|---|---|---|---|---|',
    '',
    '## Analysis',
    '_Per-drive summary._',
  ].join('\n')

  it('compacts a verify report to stats the next row can parse back', () => {
    const stats = compactStats(report)
    expect(stats).toBe('late=1 matched=2 missing=1 extras=2 reanchor=7')
    expect(parseCompactStats(stats)).toEqual({ late: 1, matched: 2, missing: 1, extras: 2, reanchor: 7 })
  })

  it('computes Closer? from the mismatch total, ignoring matched/extras/reanchor', () => {
    expect(closerThan(null, { late: 1 })).toBe('first')
    expect(closerThan({ late: 2, missing: 1, matched: 5 }, { late: 1, matched: 3, reanchor: 99 })).toBe('closer')
    expect(closerThan({ late: 1 }, { late: 1, missing: 1 })).toBe('farther')
    expect(closerThan({ late: 1, extras: 9 }, { late: 1 })).toBe('same')
  })

  it('appends numbered rows under the table header, Closer? from the previous row', () => {
    const once = appendLedgerRow(TEMPLATE, { timestamp: '2026-09-07 21:00', sha: 'abc1234', verdict: 'WARN', stats: 'late=2 matched=2 extras=0 reanchor=3' })
    expect(ledgerRows(once)).toEqual(['| 1 | 2026-09-07 21:00 | abc1234 | WARN | late=2 matched=2 extras=0 reanchor=3 | first |'])
    const twice = appendLedgerRow(once, { timestamp: '2026-09-07 22:00', sha: 'def5678', verdict: 'PASS', stats: 'matched=4 extras=0 reanchor=1' })
    expect(ledgerRows(twice)).toHaveLength(2)
    expect(ledgerRows(twice)[1]).toBe('| 2 | 2026-09-07 22:00 | def5678 | PASS | matched=4 extras=0 reanchor=1 | closer |')
    // The rest of the body is untouched.
    expect(twice).toContain('## Analysis\n_Per-drive summary._')
    expect(twice.split('## Test-drive results')).toHaveLength(2)
  })

  it('refuses a body without the table', () => {
    expect(() => appendLedgerRow('## Context only', { timestamp: 't', sha: 's', verdict: 'PASS', stats: '' })).toThrow(/no Test-drive results table/)
  })

  it('finds the LOOP issue by its Workout id line, not its title', () => {
    const issues = [
      { number: 302, title: '[LOOP] Body Work — first-round audio verification', body: TEMPLATE },
      { number: 999, title: '[LOOP] quick-one-two', body: '**Workout id**: `quick-one-two`' },
    ]
    expect(findLoopIssue(issues, 'body-work')?.number).toBe(302)
    expect(findLoopIssue(issues, 'quick-one-two')?.number).toBe(999)
    expect(findLoopIssue(issues, 'body')).toBeNull()
  })
})

describe('job planning', () => {
  const files = ['body-work.json', 'body-work.techniques.json', 'heavy-hands.json', 'heavy-hands.techniques.json', 'quick-jab-school.json']
  it('lists every numeric manifest once, sorted', () => {
    expect(planJobs(files, { vocab: 'numbers' }).map((j) => j.workoutId)).toEqual(['body-work', 'heavy-hands', 'quick-jab-school'])
  })
  it('--vocab=both doubles each workout, numbers first', () => {
    const jobs = planJobs(['body-work.json', 'body-work.techniques.json'], { vocab: 'both' })
    expect(jobs.map((j) => `${j.workoutId}/${j.vocab}/${j.dirName}`)).toEqual(['body-work/numbers/body-work', 'body-work/techniques/body-work.techniques'])
  })
  it('--only filters and names a missing manifest', () => {
    expect(planJobs(files, { only: ['heavy-hands'], vocab: 'numbers' })).toHaveLength(1)
    expect(() => planJobs(files, { only: ['nope'], vocab: 'numbers' })).toThrow(/no manifest for: nope/)
    expect(() => planJobs(files, { only: ['quick-jab-school'], vocab: 'techniques' })).toThrow(/no techniques manifest/)
  })
})

describe('args', () => {
  it('derives the launch mode from --expect-release', () => {
    expect(parseArgs(['--all']).launch).toBe('warm')
    expect(parseArgs(['--all', '--expect-release']).launch).toBe('cold')
    expect(parseArgs(['--all', '--launch=cold']).launch).toBe('cold')
  })
  it('rejects a run with nothing selected, a bad vocab, or an unknown flag', () => {
    expect(() => parseArgs([])).toThrow(/--all or --only/)
    expect(() => parseArgs(['--all', '--vocab=loud'])).toThrow(/--vocab/)
    expect(() => parseArgs(['--all', '--wat'])).toThrow(/unknown argument/)
  })
})

describe('observed summary', () => {
  const PID = '( 8286)'
  // The REAL ConsoleSink shape, copied from a device capture:
  //   '[INFO] puncheokie.voice.play', 'clip playing', { asset: 'bell',
  // The level is what sits in the brackets; the event code follows it. A
  // fixture written as '[<code>] …' passes against a matcher built the same
  // wrong way and finds nothing in the field — that is exactly what happened
  // on the first release drive, so this helper is the shape contract.
  const rec = (time, tag, fields) => {
    const entries = Object.entries(fields)
    const [first, ...rest] = entries
    const fmt = (v) => (typeof v === 'string' ? `'${v}'` : String(v))
    return [
      `08-31 ${time} I/ReactNativeJS${PID}: '[INFO] ${tag}', 'message', { ${first[0]}: ${fmt(first[1])},`,
      ...rest.map(([k, v]) => `08-31 ${time} I/ReactNativeJS${PID}:   ${k}: ${fmt(v)},`),
      `08-31 ${time} I/ReactNativeJS${PID}: }`,
    ].join('\n')
  }

  it('parses a line copied verbatim from a device capture', () => {
    const real = [
      "09-07 15:10:43.596 I/ReactNativeJS(15660): '[INFO] puncheokie.voice.observed', 'clip observed', { playId: 'ab12-1',",
      '09-07 15:10:43.596 I/ReactNativeJS(15660):   kind: \'click-script\',',
      '09-07 15:10:43.596 I/ReactNativeJS(15660):   outcome: \'ok\',',
      '09-07 15:10:43.596 I/ReactNativeJS(15660):   onsetLatencyMs: 12,',
      '09-07 15:10:43.596 I/ReactNativeJS(15660):   observedDurationMs: 1000,',
      '09-07 15:10:43.596 I/ReactNativeJS(15660):   expectedDurationMs: 1000,',
      '09-07 15:10:43.596 I/ReactNativeJS(15660):   silentByVolume: false }',
    ].join('\n')
    const s = summarizeObserved(real)
    expect(s.present).toBe(true)
    expect(s.byKind['click-script']).toMatchObject({ n: 1, outcomes: { ok: 1 } })
    expect(s.byKind['click-script'].onset.medianMs).toBe(12)
  })

  it('does not confuse a code with one that extends it', () => {
    const blocked = rec('10:00:00.000', 'puncheokie.qa.run.blocked', { workout: 'body-work', nonce: 'n1' })
    const staged = rec('10:00:01.000', 'puncheokie.qa.run', { workout: 'body-work', dev: false, nonce: 'n1' })
    const { recordsWithTag } = require('../logcat.mjs')
    expect(recordsWithTag(`${blocked}\n${staged}`, 'puncheokie.qa.run')).toHaveLength(1)
    expect(recordsWithTag(`${blocked}\n${staged}`, 'puncheokie.qa.run')[0].body).toContain('dev: false')
    expect(recordsWithTag(`${blocked}\n${staged}`, 'puncheokie.qa.run.blocked')).toHaveLength(1)
  })

  it('reports coverage, per-kind onset stats, truncation, silent births and the instrument tap', () => {
    const text = [
      rec('10:00:01.000', 'puncheokie.voice.play', { asset: 'a', playId: 'ab12-1' }),
      rec('10:00:01.100', 'puncheokie.voice.observed', { playId: 'ab12-1', kind: 'click-script', path: 'armed', outcome: 'ok', onsetLatencyMs: 12, observedDurationMs: 900, expectedDurationMs: 1000, silentByVolume: false }),
      rec('10:00:02.000', 'puncheokie.voice.play', { asset: 'b', playId: 'ab12-2' }),
      rec('10:00:02.100', 'puncheokie.voice.observed', { playId: 'ab12-2', kind: 'click-script', path: 'fresh', outcome: 'ok', onsetLatencyMs: 40, observedDurationMs: 1000, expectedDurationMs: 1000, silentByVolume: true }),
      rec('10:00:03.000', 'puncheokie.voice.play', { asset: 'c', playId: 'ab12-3' }),
      rec('10:00:03.100', 'puncheokie.voice.observed', { playId: 'intro-1', kind: 'intro', outcome: 'released', onsetLatencyMs: 30, observedDurationMs: 500, expectedDurationMs: 9000, silentByVolume: false }),
      rec('10:00:04.000', 'puncheokie.instrument.observed', { eventId: 'e1', outcome: 'ok', latencyMs: 1.1, pipelineMs: 4 }),
      rec('10:00:04.010', 'puncheokie.instrument.observed', { eventId: 'e2', outcome: 'masked', latencyMs: null, pipelineMs: 4 }),
      rec('10:00:05.000', 'puncheokie.observer.stats', { watched: 3, openAtRelease: 0, maxHandlerMs: 0.4 }),
    ].join('\n')
    const s = summarizeObserved(text)
    expect(s.present).toBe(true)
    expect(s.playsWithId).toBe(3)
    expect(s.voiceObserved).toBe(3)
    // Three plays, but only two of them were observed — the third observation
    // is the INTRO, a ceremony that mints its own playId and writes no
    // `voice.play`. Counting it toward coverage hid the missing play (and
    // produced "1/0 plays" on a capture that was all ceremony).
    expect(s.coverage).toBeCloseTo(2 / 3, 3)
    expect(s.ceremonyObserved).toBe(1)
    expect(s.byKind['click-script']).toMatchObject({ n: 2, outcomes: { ok: 2 }, truncated: 0, silentBirths: 1 })
    expect(s.byKind['click-script'].onset).toEqual({ n: 2, medianMs: 26, p95Ms: 40, jitterMs: 14 })
    expect(s.byKind['click-script'].byPath.armed.medianMs).toBe(12)
    expect(s.byKind.intro).toMatchObject({ n: 1, outcomes: { released: 1 } })
    expect(s.instrument).toMatchObject({ n: 2, outcomes: { ok: 1, masked: 1 }, maskedRatio: 0.5, busyRatio: 0 })
    expect(s.instrument.latency.medianMs).toBe(1.1)
    expect(s.observer).toEqual({ watched: 3, openAtRelease: 0, maxHandlerMs: 0.4 })
  })

  it('counts a play cut short of its planned length as truncated', () => {
    const text = rec('10:00:01.100', 'puncheokie.voice.observed', { playId: 'x', kind: 'clip', outcome: 'ok', onsetLatencyMs: 5, observedDurationMs: 600, expectedDurationMs: 1000, silentByVolume: false })
    expect(summarizeObserved(text).byKind.clip.truncated).toBe(1)
  })

  it('is honest about a capture with no observer records', () => {
    const s = summarizeObserved('08-31 10:00:00.000 I/ReactNativeJS( 1): \'[puncheokie.voice.play] clip playing\', { asset: \'a\' }')
    expect(s).toMatchObject({ present: false, playsWithId: 0, coverage: null, voiceObserved: 0 })
  })

  it('latencyStats ignores non-numbers and reports jitter as p95 − median', () => {
    expect(latencyStats([10, undefined, 20, null, 30, 100])).toEqual({ n: 4, medianMs: 25, p95Ms: 100, jitterMs: 75 })
    expect(latencyStats([])).toEqual({ n: 0, medianMs: null, p95Ms: null, jitterMs: null })
  })
})
