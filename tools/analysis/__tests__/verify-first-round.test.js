/**
 * Guards for the log-only correlator (GH #305).
 *
 * Every fixture here is written in the REAL React Native `ConsoleSink`
 * shape as it appears in `tools/analysis/sessions/*\/logcat.txt`: a tag
 * line carrying the event name, the message, and the object's first
 * property, then 2-space-indented continuation lines, then a closing `}`.
 * Getting that shape wrong is how a parser passes its tests and drops
 * events in the field.
 *
 * Two of these (playFailed ordering, last-record flush) FAIL against the
 * pre-GH#305 parser. They exist because both defects were silent: the
 * correlator reported a clean parse while discarding events.
 */

import { parseLogcat, verify } from '../verify-first-round.mjs'

const PID = '( 8286)'
const line = (time, body) => `08-31 ${time} I/ReactNativeJS${PID}: ${body}`
const warn = (time, body) => `08-31 ${time} W/ReactNativeJS${PID}: ${body}`

/** A minimal manifest with one combo-announce expectation at 5559ms. */
function manifestWith(coachEvents, overrides = {}) {
  return {
    workoutId: 'speed-combos',
    workoutName: 'Speed Combos',
    roundIndex: 0,
    workDurationMs: 240_000,
    bpm: 240,
    identity: { workoutId: 'speed-combos', revision: 1, timelineHash: 'v2:921449d5' },
    coachEvents,
    strikes: [],
    ...overrides,
  }
}

const COMBO_EXPECTATION = {
  kind: 'combo-announce',
  slotId: 'sp1-b1#0:rep-0:combo-announce:before:e1,e2',
  cueId: 'sp1-b1#0',
  repId: 'rep-0',
  assetId: 'ca-1-1-numbers',
  text: 'One, One, go!',
  expectedStartTick: 5336,
  expectedStartMs: 5559,
  expectedEndTick: 7000,
  expectedEndMs: 7290,
  source: 'score.coachSlot',
}

/** t0 for these fixtures: metronome 'loop started' at 13:49:47.342. */
const T0_LINE = line(
  '13:49:47.342',
  "'[INFO] puncheokie.metronome', 'loop started', { bpm: 240 }",
)

describe('parseLogcat — defects that were silent', () => {
  it('parses voice.playFailed rather than swallowing it in the voice.play branch', () => {
    // 'puncheokie.voice.playFailed' CONTAINS 'puncheokie.voice.play'. Tested
    // in the wrong order it matches the play branch, satisfies neither inner
    // arm, and hits that branch's unconditional `continue` — parsed to
    // nothing at all, with no error anywhere.
    const text = [
      warn(
        '13:49:50.100',
        "'[WARN] puncheokie.voice.playFailed', 'clip failed to play', { asset: '1',",
      ),
      warn('13:49:50.100', "  text: 'One' }"),
      '',
    ].join('\n')
    const events = parseLogcat(text)
    expect(events.filter((e) => e.type === 'voice.playFailed')).toHaveLength(1)
    expect(events.find((e) => e.type === 'voice.playFailed').asset).toBe('1')
    // and it must NOT have been mistaken for a real play
    expect(events.filter((e) => e.type === 'voice.clip')).toHaveLength(0)
  })

  it('keeps the FINAL record of a file (trailing newline used to discard it)', () => {
    // Files end with a content line plus a newline; `split` yields a final
    // empty string that fails LOG_PREFIX. The old parser nulled the record
    // in progress without pushing it, losing one event per logcat.
    const text = [
      T0_LINE,
      line('13:49:48.000', "'[INFO] puncheokie.voice.play', 'clip playing', { asset: '1',"),
      line('13:49:48.000', '  priority: 2 }'),
      '', // trailing newline
    ].join('\n')
    const clips = parseLogcat(text).filter((e) => e.type === 'voice.clip')
    expect(clips).toHaveLength(1)
    expect(clips[0].asset).toBe('1')
  })

  it('extracts every field of a multi-line slotDispatcher.armed record', () => {
    const text = [
      line(
        '13:49:19.038',
        "'[INFO] puncheokie.slotDispatcher.armed', 'armed', { workout: 'speed-combos',",
      ),
      line('13:49:19.038', '  totalCompiledSlots: 98,'),
      line('13:49:19.038', '  enqueuedSlots: 23,'),
      line('13:49:19.038', '  announceThenWorkCues: 31,'),
      line('13:49:19.038', "  timelineHash: 'v2:d404ea55' }"),
      '',
    ].join('\n')
    const armed = parseLogcat(text).find((e) => e.type === 'slotDispatcher.armed')
    expect(armed).toMatchObject({
      workout: 'speed-combos',
      totalCompiledSlots: 98,
      enqueuedSlots: 23,
      announceThenWorkCues: 31,
      timelineHash: 'v2:d404ea55',
    })
  })

  it('tags the bell ADDITIVELY — it is still a voice.clip', () => {
    const text = [
      line('13:49:47.000', "'[INFO] puncheokie.voice.play', 'clip playing', { asset: 'bell' }"),
      '',
    ].join('\n')
    const events = parseLogcat(text)
    expect(events.filter((e) => e.type === 'bell')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'voice.clip')).toHaveLength(1)
  })

  it('parses a round.boundary record with its transition and round', () => {
    const text = [
      line(
        '13:49:47.342',
        "'[INFO] puncheokie.round.boundary', 'session phase boundary', { transition: 'rest-entered',",
      ),
      line('13:49:47.342', '  roundIndex: 0,'),
      line('13:49:47.342', '  workElapsedMs: 240000 }'),
      '',
    ].join('\n')
    const b = parseLogcat(text).find((e) => e.type === 'round.boundary')
    expect(b).toMatchObject({ transition: 'rest-entered', roundIndex: 0, workElapsedMs: 240_000 })
  })
})

describe('verify — a drifted event is labelled by the SIGN of its drift', () => {
  /** The combo announce sounding at `time`, matched to COMBO_EXPECTATION by text. */
  const announceAt = (time) =>
    [
      line(
        time,
        "'[INFO] puncheokie.voice.play', 'combo-announce playing', { kind: 'combo-announce',",
      ),
      line(time, `  text: '${COMBO_EXPECTATION.text}',`),
      line(time, '  durationMs: 900 }'),
    ].join('\n')

  // t0 = 13:49:47.342; the expectation sits at +5559 ms, i.e. 13:49:52.901.

  it('calls an event that fired BEFORE its mark early, not late', () => {
    // 13:49:50.901 is +3559 ms — 2000 ms EARLY, outside the ±1000 ms match
    // window. This is the shape every quick workout's lead-ins had while the
    // manifest anchored them to the first strike: deltas of −1.9 to −2.4 s,
    // every one of them reported as 'late' because the bucketing was on
    // |delta| and threw away the sign that named the cause.
    const result = verify(manifestWith([COMBO_EXPECTATION]), [T0_LINE, announceAt('13:49:50.901'), ''].join('\n'))
    expect(result.verdicts[0].verdict).toBe('early')
    expect(result.verdicts[0].deltaMs).toBe(-2000)
    expect(result.health.early).toBe(1)
    expect(result.health.late).toBe(0)
    // Still a warning — outside the match window is drift either way; only
    // the direction it points has changed.
    expect(result.health.softWarn).toBe(true)
    expect(result.health.hardFail).toBe(false)
  })

  it('still calls an event that fired AFTER its mark late', () => {
    // 13:49:54.901 is +7559 ms — 2000 ms late.
    const result = verify(manifestWith([COMBO_EXPECTATION]), [T0_LINE, announceAt('13:49:54.901'), ''].join('\n'))
    expect(result.verdicts[0].verdict).toBe('late')
    expect(result.verdicts[0].deltaMs).toBe(2000)
    expect(result.health.late).toBe(1)
    expect(result.health.early).toBe(0)
  })

  it('inside the match window neither label applies', () => {
    // 13:49:52.401 is −500 ms: early, but within ±1000 ms, so matched.
    const result = verify(manifestWith([COMBO_EXPECTATION]), [T0_LINE, announceAt('13:49:52.401'), ''].join('\n'))
    expect(result.verdicts[0].verdict).toBe('matched')
    expect(result.health.early).toBe(0)
    expect(result.health.late).toBe(0)
  })
})

describe('verify — deferral join', () => {
  const deferredAt = (time, slotId) =>
    [
      line(
        time,
        `'[INFO] puncheokie.slotDispatcher.deferred', 'coach lane busy', { slotId: '${slotId}',`,
      ),
      line(time, '  audibleUntilMs: 1200 }'),
    ].join('\n')

  it('re-labels a missing expectation as DEFERRED when a deferral names its slot', () => {
    // t0 = 13:49:47.342, so 13:49:52.903 is +5561ms — within
    // DEFER_JOIN_WINDOW_MS of the 5559ms expectation.
    const text = [T0_LINE, deferredAt('13:49:52.903', COMBO_EXPECTATION.slotId), ''].join('\n')
    const result = verify(manifestWith([COMBO_EXPECTATION]), text)
    expect(result.verdicts[0].verdict).toBe('deferred')
    expect(result.health.deferred).toBe(1)
    expect(result.health.missing).toBe(0)
  })

  it('does NOT join a deferral that is far from the expectation', () => {
    // 13:49:19.038 is 28.3s BEFORE t0 — mid-intro, nowhere near the
    // expectation. It must stay unattributed rather than silently
    // excusing the missing call.
    const text = [T0_LINE, deferredAt('13:49:19.038', COMBO_EXPECTATION.slotId), ''].join('\n')
    const result = verify(manifestWith([COMBO_EXPECTATION]), text)
    expect(result.verdicts[0].verdict).toBe('missing')
    expect(result.health.deferredUnattributed).toBe(1)
  })

  it('does not join a deferral naming a different cue', () => {
    const text = [
      T0_LINE,
      deferredAt('13:49:52.903', 'sp2-b9#0:rep-0:combo-announce:before:e9'),
      '',
    ].join('\n')
    const result = verify(manifestWith([COMBO_EXPECTATION]), text)
    expect(result.verdicts[0].verdict).toBe('missing')
    expect(result.health.deferredUnattributed).toBe(1)
  })
})

describe('verify — provenance gating', () => {
  const armedWith = (hash) =>
    [
      line(
        '13:49:19.038',
        "'[INFO] puncheokie.slotDispatcher.armed', 'armed', { workout: 'speed-combos',",
      ),
      line('13:49:19.038', `  timelineHash: '${hash}' }`),
    ].join('\n')

  it('reports STALE when the app compiled a different timeline', () => {
    const text = [armedWith('v2:d404ea55'), T0_LINE, ''].join('\n')
    const result = verify(manifestWith([]), text)
    expect(result.provenance.state).toBe('mismatch')
    expect(result.health.stale).toBe(true)
  })

  it('reports match when the hashes agree', () => {
    const text = [armedWith('v2:921449d5'), T0_LINE, ''].join('\n')
    const result = verify(manifestWith([]), text)
    expect(result.provenance.state).toBe('match')
    expect(result.health.stale).toBe(false)
  })

  it('reports unavailable — NOT match — when there is no armed record', () => {
    const result = verify(manifestWith([]), [T0_LINE, ''].join('\n'))
    expect(result.provenance.state).toBe('unavailable')
  })

  it('suppresses the new gates to a warning when provenance is unproven', () => {
    // A deferral on a stale pair must not hard-fail: on a mismatched
    // timeline its absence or presence proves nothing about the app.
    const text = [
      armedWith('v2:d404ea55'),
      T0_LINE,
      line(
        '13:49:52.903',
        `'[INFO] puncheokie.slotDispatcher.deferred', 'coach lane busy', { slotId: '${COMBO_EXPECTATION.slotId}',`,
      ),
      line('13:49:52.903', '  audibleUntilMs: 1200 }'),
      '',
    ].join('\n')
    const result = verify(manifestWith([COMBO_EXPECTATION]), text)
    expect(result.health.deferred).toBe(1)
    expect(result.health.hardFail).toBe(false)
    expect(result.health.softWarn).toBe(true)
  })
})
