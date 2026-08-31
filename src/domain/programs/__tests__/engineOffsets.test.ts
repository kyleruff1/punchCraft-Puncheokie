/**
 * M39-V1c plumbing seam (2026-08-30).
 *
 * `CueInstance` gained two optional engine-authored fields
 * (`visualOffsetsMs`, `expectedStrikeOffsetsMs`). This suite pins the
 * two guarantees that make the seam safe:
 *
 * 1. **Absence is a no-op.** When neither field is set, the runtime
 *    behaves BYTE-IDENTICALLY to the pre-M39 path. Every downstream
 *    computation — ring-fire in `CueEngine.fireDueTokens`, signed match
 *    offset in `CueMatcher.scheduledMomentMs` — falls back to
 *    `tokenOffsetsMs` (with the rail's `phraseTokenTimesMs` still in
 *    the middle for rings, exactly as before).
 * 2. **Presence takes over.** When the fields ARE populated (the V1c
 *    corpus + sample-flip batch will do this), rings fire at
 *    `visualOffsetsMs` (winning over the rail too — the engine is the
 *    authoritative grid), and match offsets are measured against
 *    `expectedStrikeOffsetsMs`.
 *
 * The population step (block-authoring migration in `CueTimeline`) is
 * NOT wired yet; this suite exercises the seam directly on
 * hand-constructed cues so the plumbing is proven independently of the
 * blocked corpus work.
 */
import { CueEngine, DEFAULT_LEAD_TIMES } from '../CueEngine'
import { CueMatcher } from '../CueMatcher'
import type { CueEvent } from '../CueState'
import type { CueInstance, RoundTimeline } from '../CueTimeline'
import { createFakeClock, type FakeClock } from '@testing/fakeClock'
import type { TrackerPunchEvent } from '../../punch/PunchEvent'
import type { WorkoutToken } from '../../workout/WorkoutTokens'

const TOKENS: WorkoutToken[] = [
  { kind: 'punch', number: 1, body: false, beatOffset: 0 },
  { kind: 'punch', number: 2, body: false, beatOffset: 1 },
]

// A single cue with two punch tokens on the beat grid at 120 BPM
// (500 ms per beat) so token 0 lands at scheduledStart and token 1
// lands 500 ms later.
function cueAt(t0: number, over: Partial<CueInstance> = {}): CueInstance {
  return {
    id: 'cue-under-test',
    blockId: 'b1',
    repeatIndex: 0,
    scoring: 'sequence',
    tokens: TOKENS,
    tokenOffsetsMs: [0, 500],
    expectedPunches: [
      { tokenIndex: 0, hand: 'left' },
      { tokenIndex: 1, hand: 'right' },
    ],
    displayOnlyTokenIndexes: [],
    previewAt: Math.max(0, t0 - DEFAULT_LEAD_TIMES.previewMs),
    announceAt: Math.max(0, t0 - DEFAULT_LEAD_TIMES.announceMs),
    scheduledStartMs: t0,
    scheduledEndMs: t0 + 500,
    windowStartMs: Math.max(0, t0 - 500),
    windowEndMs: t0 + 1_000,
    ...over,
  }
}

function roundOf(cue: CueInstance): RoundTimeline[] {
  return [
    {
      roundIndex: 0,
      workDurationMs: 60_000,
      cues: [cue],
      stanceChanges: [],
      deferredBlockIds: [],
    },
  ]
}

interface Harness {
  events: CueEvent[]
  engine: CueEngine
  clock: FakeClock
  tick(t: number): void
}

function harness(cue: CueInstance): Harness {
  const clock = createFakeClock()
  const engine = new CueEngine(roundOf(cue), { leadTimes: DEFAULT_LEAD_TIMES, clock })
  const events: CueEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
  return {
    events,
    engine,
    clock,
    tick(t: number) {
      clock.advance(t - clock.now())
      engine.tick(t)
    },
  }
}

function tokenDueTimes(events: CueEvent[]): number[] {
  return events
    .filter((e) => e.type === 'token-due')
    .map((e) => (e as Extract<CueEvent, { type: 'token-due' }>).workElapsedMs)
    .sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------

describe('CueEngine.fireDueTokens — V1c ring-fire priority', () => {
  const t0 = 10_000

  it('absent engine field: falls back to tokenOffsetsMs (pre-M39 behavior)', () => {
    const h = harness(cueAt(t0))
    h.tick(t0)
    h.tick(t0 + 500)
    h.tick(t0 + 1_000)

    expect(tokenDueTimes(h.events)).toEqual([t0, t0 + 500])
  })

  it('rail alone (phraseTokenTimesMs) still overrides the beat grid (pre-M39 behavior)', () => {
    const cue = cueAt(t0, { phraseTokenTimesMs: [50, 600] })
    const h = harness(cue)
    for (let t = t0; t <= t0 + 1_500; t += 25) h.tick(t)

    expect(tokenDueTimes(h.events)).toEqual([t0 + 50, t0 + 600])
  })

  it('visualOffsetsMs wins over both rail and beat grid', () => {
    // Engine says token 1 lands at +540 ms (swing 0.54 alternating pair).
    // Rail says +600, beat grid says +500. The engine grid should win.
    const cue = cueAt(t0, {
      visualOffsetsMs: [0, 540],
      phraseTokenTimesMs: [50, 600],
    })
    const h = harness(cue)
    for (let t = t0; t <= t0 + 1_500; t += 20) h.tick(t)

    expect(tokenDueTimes(h.events)).toEqual([t0, t0 + 540])
  })

  it('a partial visualOffsetsMs entry falls back per-token (not all-or-nothing)', () => {
    // Token 0 has an engine offset; token 1 does not — the runtime
    // resolves each token independently so a partial fill during the
    // migration doesn't drop rings.
    const cue = cueAt(t0, {
      visualOffsetsMs: [100],
      phraseTokenTimesMs: [50, 600],
    })
    const h = harness(cue)
    for (let t = t0; t <= t0 + 1_500; t += 20) h.tick(t)

    // Token 0 from engine (+100), token 1 from rail (+600).
    expect(tokenDueTimes(h.events)).toEqual([t0 + 100, t0 + 600])
  })
})

// ---------------------------------------------------------------------------

function trackerEventAt(id: string, hand: 'left' | 'right', atMs: number): TrackerPunchEvent {
  return {
    id,
    sourceFrameId: id,
    deviceId: hand === 'left' ? 'blue' : 'red',
    hand,
    receivedMonotonicTimeMs: atMs,
    trackerTimestampMs: atMs,
    receivedWallTimeIso: '2026-08-30T00:00:00.000Z',
    velocityUnit: 'unknown',
    recovered: false,
    decoderId: 'test',
    decoderVersion: 'test-1',
    qualityFlags: [],
  }
}

describe('CueMatcher.scheduledMomentMs — V1c expected-strike priority', () => {
  const t0 = 10_000
  const matcher = new CueMatcher('hand-only')

  it('absent engine field: scores against tokenOffsetsMs (pre-M39 behavior)', () => {
    const cue = cueAt(t0)
    const events = [
      trackerEventAt('e0', 'left', t0 + 20), // 20 ms LATE relative to token 0
      trackerEventAt('e1', 'right', t0 + 500 - 30), // 30 ms early relative to token 1
    ]
    const result = matcher.match(cue, events)

    expect(result.assignments.map((a) => a.offsetMs)).toEqual([20, -30])
  })

  it('expectedStrikeOffsetsMs shifts the reference for the signed match offset', () => {
    // Engine mode: expected strike lands at token+140. An event at t0+140
    // is on time, not 140 ms late.
    const cue = cueAt(t0, { expectedStrikeOffsetsMs: [140, 640] })
    const events = [
      trackerEventAt('e0', 'left', t0 + 140),
      trackerEventAt('e1', 'right', t0 + 640),
    ]
    const result = matcher.match(cue, events)

    expect(result.assignments.map((a) => a.offsetMs)).toEqual([0, 0])
  })

  it('partial expectedStrikeOffsetsMs falls back per-token to tokenOffsetsMs', () => {
    const cue = cueAt(t0, { expectedStrikeOffsetsMs: [140] })
    const events = [
      trackerEventAt('e0', 'left', t0 + 140), // on time under engine (140-140)
      trackerEventAt('e1', 'right', t0 + 500), // on time under fallback (500-500)
    ]
    const result = matcher.match(cue, events)

    expect(result.assignments.map((a) => a.offsetMs)).toEqual([0, 0])
  })
})
