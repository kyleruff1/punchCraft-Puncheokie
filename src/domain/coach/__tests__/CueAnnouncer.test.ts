/**
 * CueAnnouncer (M34-03, doc §18, §20, §25, D1, D3).
 *
 * Three properties carry the weight:
 *
 * 1. **The gate holds on every path.** One entry point that emits before
 *    checking is an app that talks over someone's music.
 * 2. **No timers, no clock.** Every deadline is arithmetic on timestamps
 *    that arrived with the event. A timer here would let speech latency move
 *    the workout (D3).
 * 3. **A metric never lands mid-combination.** It is held, not dropped —
 *    the number is still worth saying, just not over the next punch.
 */
import { readFileSync } from 'node:fs'

import {
  CueAnnouncer,
  DEFAULT_ANNOUNCE_LEAD_TIMES,
  FINAL_WARNING_AT_MS,
  type AnnouncerSkip,
} from '../CueAnnouncer'
import { assetPriority } from '../assetPriority'
import { defaultVoiceCoachPolicy, type VoiceCoachPolicy } from '../VoiceCoachPolicy'
import {
  AUDIO_PRIORITY,
  type ToneKind,
  type VoiceAssetId,
  type VoiceOutputPort,
  type Volumes,
} from '../VoiceOutputPort'
import type { CueEvent, CueEventType, CueStatus, CueTimestamps } from '@domain/programs/CueState'
import type { CueInstance } from '@domain/programs/CueTimeline'
import type { WorkoutToken } from '@domain/workout/WorkoutTokens'

/* ------------------------------------------------------------ fake port */

type Call =
  | { kind: 'asset'; id: VoiceAssetId; atMs?: number }
  | { kind: 'speak'; text: string; priority: number }
  | { kind: 'tone'; tone: ToneKind }
  | { kind: 'cancel'; below: number }

class RecordingPort implements VoiceOutputPort {
  readonly calls: Call[] = []

  playAsset(id: VoiceAssetId, atMs?: number): void {
    this.calls.push(atMs === undefined ? { kind: 'asset', id } : { kind: 'asset', id, atMs })
  }
  speak(text: string, priority: number): void {
    this.calls.push({ kind: 'speak', text, priority })
  }
  tone(tone: ToneKind): void {
    this.calls.push({ kind: 'tone', tone })
  }
  cancel(below: number): void {
    this.calls.push({ kind: 'cancel', below })
  }
  setVolumes(_v: Volumes): void {}

  assets(): VoiceAssetId[] {
    return this.calls.flatMap((c) => (c.kind === 'asset' ? [c.id] : []))
  }
  reset(): void {
    this.calls.length = 0
  }
}

/* ---------------------------------------------------------- fixtures */

const punch = (number: 1 | 2 | 3 | 4 | 5 | 6, body = false): WorkoutToken => ({
  kind: 'punch',
  number,
  body,
  beatOffset: 0,
})

function cue(over: Partial<CueInstance> = {}): CueInstance {
  return {
    id: 'cue-1',
    blockId: 'block-1',
    repeatIndex: 0,
    scoring: 'sequence',
    tokens: [punch(1), punch(2)],
    tokenOffsetsMs: [0, 400],
    expectedPunches: [
      { tokenIndex: 0, hand: 'left' },
      { tokenIndex: 1, hand: 'right' },
    ],
    displayOnlyTokenIndexes: [],
    previewAt: 8_500,
    announceAt: 9_250,
    scheduledStartMs: 10_000,
    scheduledEndMs: 10_400,
    windowStartMs: 9_800,
    windowEndMs: 10_700,
    ...over,
  }
}

const timestamps = (c: CueInstance): CueTimestamps => ({
  previewScheduledMs: c.previewAt,
  voiceScheduledMs: c.announceAt,
  executionScheduledMs: c.scheduledStartMs,
  windowCloseMs: c.windowEndMs,
  trackerEventTimesMs: [],
  suspensions: [],
})

function cueEvent(type: CueEventType, c: CueInstance = cue()): CueEvent {
  return {
    type,
    cue: c,
    status: 'scheduled' as CueStatus,
    timestamps: timestamps(c),
    workElapsedMs: c.scheduledStartMs,
    nowMs: c.scheduledStartMs,
  }
}

function tokenDue(c: CueInstance, tokenIndex: number): CueEvent {
  return {
    type: 'token-due',
    cue: c,
    tokenIndex,
    workElapsedMs: c.scheduledStartMs,
    nowMs: c.scheduledStartMs,
  }
}

interface Harness {
  announcer: CueAnnouncer
  port: RecordingPort
  skips: AnnouncerSkip[]
}

function harness(over: Partial<VoiceCoachPolicy> = {}, opts: { durations?: boolean } = {}): Harness {
  const port = new RecordingPort()
  const skips: AnnouncerSkip[] = []
  const announcer = new CueAnnouncer({
    policy: { ...defaultVoiceCoachPolicy(), ...over },
    output: port,
    onSkip: (s) => skips.push(s),
    // 400 ms a clip: two clips (800 ms) do not fit the 650 ms the fixture
    // leaves between the announce moment and the ready tone.
    ...(opts.durations
      ? {
          assetDurationsMs: {
            '1': 400,
            '2': 400,
            '3': 400,
            body: 400,
          } as Partial<Record<VoiceAssetId, number>>,
        }
      : {}),
  })
  return { announcer, port, skips }
}

/** Drive a cue from preview through to its window closing. */
function runCue(h: Harness, c: CueInstance = cue()): void {
  h.announcer.onCueEvent(cueEvent('cue-previewing', c))
  h.announcer.onCueEvent(cueEvent('cue-announcing', c))
  h.announcer.onCueEvent(cueEvent('cue-active', c))
  h.announcer.onCueEvent(cueEvent('cue-window-closed', c))
}

// ---------------------------------------------------------------------------

describe('the D1 gate holds on every entry point (spec §13.5)', () => {
  it('makes no port call at all while playback is active without an opt-in', () => {
    const h = harness()
    h.announcer.setThirdPartyPlayback(true)

    const c = cue()
    runCue(h, c)
    h.announcer.onCueEvent(tokenDue(c, 0))
    h.announcer.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    h.announcer.onSessionPhase({ type: 'rest-entered', nowMs: 0 })
    h.announcer.onRoundClock(1_000)
    h.announcer.onStanceChange('southpaw')
    h.announcer.announceMetric('Average velocity six point eight')

    expect(h.port.calls).toEqual([])
  })

  it('speaks again once the athlete opts in', () => {
    const h = harness({ overlayOptIn: true })
    h.announcer.setThirdPartyPlayback(true)
    runCue(h)
    expect(h.port.assets().length).toBeGreaterThan(0)
  })

  it('still prepares while the gate is shut, so it is ready the moment it opens', () => {
    // Resolving a phrase makes no sound. Refusing to prepare would mean the
    // first cue after an opt-in had nothing in hand.
    const h = harness()
    h.announcer.setThirdPartyPlayback(true)
    h.announcer.onCueEvent(cueEvent('cue-previewing'))
    expect(h.announcer.preparedCueIds()).toEqual(['cue-1'])
    expect(h.port.calls).toEqual([])
  })

  it('makes no sound in mode off', () => {
    const h = harness({ mode: 'off' })
    runCue(h)
    h.announcer.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    expect(h.port.calls).toEqual([])
  })
})

describe('the ready tone lands on the cue clock (D3, spec §18.3)', () => {
  it('is scheduled at executionScheduled − readyToneMs', () => {
    const h = harness()
    const c = cue()
    runCue(h, c)

    const tone = h.port.calls.find((x) => x.kind === 'asset' && x.id === 'tone-ready')
    expect(tone).toEqual({
      kind: 'asset',
      id: 'tone-ready',
      atMs: c.scheduledStartMs - DEFAULT_ANNOUNCE_LEAD_TIMES.readyToneMs,
    })
  })

  it('honours a tuned lead time rather than the default', () => {
    const port = new RecordingPort()
    const announcer = new CueAnnouncer({
      policy: defaultVoiceCoachPolicy(),
      output: port,
      leadTimes: { announceMs: 500, readyToneMs: 250 },
    })
    const c = cue()
    announcer.onCueEvent(cueEvent('cue-announcing', c))
    expect(port.calls).toContainEqual({ kind: 'asset', id: 'tone-ready', atMs: 9_750 })
  })

  it('sets no timer and reads no clock', () => {
    // The structural half of D3: an announcer that could schedule would
    // eventually let speech latency move the workout.
    const source = readFileSync('src/domain/coach/CueAnnouncer.ts', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ' ',
    )
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/)
    expect(source).not.toMatch(/Date\.now\(|performance\.now\(/)
  })
})

describe('each style calls the combination its own way (doc §18.1)', () => {
  it('call-and-go speaks the whole phrase at the announce moment', () => {
    const h = harness({ style: 'call-and-go' })
    const c = cue({ tokens: [punch(1), punch(2, true), punch(3)] })
    runCue(h, c)

    const phrase = h.port.calls.filter((x) => x.kind === 'asset' && x.id !== 'tone-ready')
    expect(phrase).toEqual([
      { kind: 'asset', id: '1', atMs: c.announceAt },
      { kind: 'asset', id: '2', atMs: c.announceAt },
      { kind: 'asset', id: 'body', atMs: c.announceAt },
      { kind: 'asset', id: '3', atMs: c.announceAt },
    ])
  })

  it('coach-shorthand speaks the combination once and beeps the repeats', () => {
    const h = harness({ style: 'coach-shorthand' })
    runCue(h, cue({ repeatIndex: 0 }))
    expect(h.port.assets()).toContain('1')

    h.port.reset()
    runCue(h, cue({ id: 'cue-2', repeatIndex: 1 }))
    expect(h.port.calls).toContainEqual({ kind: 'tone', tone: 'repeat' })
    expect(h.port.assets()).not.toContain('1')
  })

  it('follow-the-call says nothing up front and one token at a time', () => {
    const h = harness({ style: 'follow-the-call' })
    const c = cue()
    h.announcer.onCueEvent(cueEvent('cue-announcing', c))
    expect(h.port.assets()).toEqual(['tone-ready'])

    h.port.reset()
    h.announcer.onCueEvent(tokenDue(c, 0))
    h.announcer.onCueEvent(tokenDue(c, 1))
    // No deadline: `token-due` fires at the moment the token becomes active.
    expect(h.port.calls).toEqual([
      { kind: 'asset', id: '1' },
      { kind: 'asset', id: '2' },
    ])
  })

  it('minimal leaves punch tokens to the visuals', () => {
    const h = harness({ style: 'minimal' })
    const c = cue()
    runCue(h, c)
    h.announcer.onCueEvent(tokenDue(c, 0))
    expect(h.port.assets()).not.toContain('1')
  })

  it('does not repeat per-token calls in a style that already said the phrase', () => {
    const h = harness({ style: 'call-and-go' })
    const c = cue()
    h.announcer.onCueEvent(cueEvent('cue-announcing', c))
    h.port.reset()
    h.announcer.onCueEvent(tokenDue(c, 0))
    expect(h.port.calls).toEqual([])
  })
})

describe('a category the policy silences produces no call (doc §7)', () => {
  it('skips footwork while announcing it per token', () => {
    const h = harness({ style: 'follow-the-call', mode: 'minimal' })
    const c = cue({
      tokens: [punch(1), { kind: 'footwork', command: 'pivot', beatOffset: 1 }],
      tokenOffsetsMs: [0, 400],
    })
    h.announcer.onCueEvent(tokenDue(c, 1))
    expect(h.port.calls).toEqual([])
  })

  it('says nothing for a coach command, which has no clip', () => {
    const h = harness({ style: 'follow-the-call' })
    const c = cue({
      tokens: [{ kind: 'coach', command: 'hands-up', beatOffset: 0 }],
      tokenOffsetsMs: [0],
    })
    h.announcer.onCueEvent(tokenDue(c, 0))
    expect(h.port.calls).toEqual([])
  })
})

describe('pause and resume (doc §18)', () => {
  it('drops everything below safety on pause', () => {
    const h = harness()
    runCue(h)
    h.port.reset()
    h.announcer.onSessionPhase({ type: 'paused', nowMs: 0 })
    expect(h.port.calls).toEqual([{ kind: 'cancel', below: AUDIO_PRIORITY.safety }])
  })

  it('replays nothing queued before the pause once resumed', () => {
    const h = harness()
    runCue(h)
    h.announcer.onSessionPhase({ type: 'paused', nowMs: 0 })
    h.port.reset()
    h.announcer.onSessionPhase({ type: 'resumed', nowMs: 0 })
    expect(h.port.calls).toEqual([])
  })

  it('cancels on a cancelled session too', () => {
    const h = harness()
    h.announcer.onSessionPhase({ type: 'cancelled', nowMs: 0 })
    expect(h.port.calls).toEqual([{ kind: 'cancel', below: AUDIO_PRIORITY.safety }])
  })
})

describe('bells and the final warning', () => {
  it('rings on entering work and on entering rest', () => {
    const h = harness()
    h.announcer.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    h.announcer.onSessionPhase({ type: 'rest-entered', nowMs: 0 })
    expect(h.port.assets()).toEqual(['bell', 'bell'])
  })

  it('warns once per round on the first sample past the threshold', () => {
    const h = harness()
    h.announcer.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    h.port.reset()

    h.announcer.onRoundClock(FINAL_WARNING_AT_MS + 50)
    expect(h.port.assets()).toEqual([])

    // The tick is 50 ms, so the threshold is crossed rather than hit exactly.
    h.announcer.onRoundClock(FINAL_WARNING_AT_MS - 20)
    h.announcer.onRoundClock(FINAL_WARNING_AT_MS - 70)
    h.announcer.onRoundClock(500)
    expect(h.port.assets()).toEqual(['tone-warning'])
  })

  it('warns again in the next round', () => {
    const h = harness()
    h.announcer.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    h.announcer.onRoundClock(1_000)
    h.port.reset()

    h.announcer.onSessionPhase({ type: 'work-entered', roundIndex: 1, nowMs: 0 })
    h.port.reset()
    h.announcer.onRoundClock(1_000)
    expect(h.port.assets()).toEqual(['tone-warning'])
  })

  it('stays silent when the warning is switched off (doc §25)', () => {
    const h = harness({ finalTenSecondWarning: false })
    h.announcer.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    h.port.reset()
    h.announcer.onRoundClock(1_000)
    expect(h.port.calls).toEqual([])
  })
})

describe('a metric never interrupts a combination (doc §18)', () => {
  it('speaks straight away between combinations', () => {
    const h = harness({ mode: 'full' })
    h.announcer.announceMetric('Average velocity six point eight')
    expect(h.port.calls).toEqual([
      { kind: 'speak', text: 'Average velocity six point eight', priority: AUDIO_PRIORITY.metric },
    ])
  })

  it('holds one raised mid-combination until the window closes', () => {
    const h = harness({ mode: 'full' })
    const c = cue()
    h.announcer.onCueEvent(cueEvent('cue-active', c))
    h.announcer.announceMetric('Average velocity six point eight')
    expect(h.port.calls.some((x) => x.kind === 'speak')).toBe(false)

    h.announcer.onCueEvent(cueEvent('cue-window-closed', c))
    expect(h.port.calls).toContainEqual({
      kind: 'speak',
      text: 'Average velocity six point eight',
      priority: AUDIO_PRIORITY.metric,
    })
  })

  it('keeps only the newest held metric', () => {
    // The earlier figure is already stale by the time the combination ends.
    const h = harness({ mode: 'full' })
    const c = cue()
    h.announcer.onCueEvent(cueEvent('cue-active', c))
    h.announcer.announceMetric('Average velocity six')
    h.announcer.announceMetric('Average velocity seven')
    h.announcer.onCueEvent(cueEvent('cue-window-closed', c))

    const spoken = h.port.calls.filter((x) => x.kind === 'speak')
    expect(spoken).toEqual([
      { kind: 'speak', text: 'Average velocity seven', priority: AUDIO_PRIORITY.metric },
    ])
  })

  it('releases a held metric at the bell as well', () => {
    const h = harness({ mode: 'full' })
    h.announcer.onCueEvent(cueEvent('cue-active'))
    h.announcer.announceMetric('Average velocity six')
    h.announcer.onSessionPhase({ type: 'rest-entered', nowMs: 0 })
    expect(h.port.calls.some((x) => x.kind === 'speak')).toBe(true)
  })

  it('drops a held metric when the session is cancelled', () => {
    const h = harness({ mode: 'full' })
    h.announcer.onCueEvent(cueEvent('cue-active'))
    h.announcer.announceMetric('Average velocity six')
    h.announcer.onSessionPhase({ type: 'cancelled', nowMs: 0 })
    h.port.reset()
    h.announcer.onCueEvent(cueEvent('cue-window-closed'))
    expect(h.port.calls).toEqual([])
  })

  it('says nothing when metric announcements are off', () => {
    const h = harness({ metricAnnouncements: 'off' })
    h.announcer.announceMetric('Average velocity six')
    expect(h.port.calls).toEqual([])
  })
})

describe('a phrase that will not fit is skipped, not queued (D15)', () => {
  it('drops the phrase and reports why', () => {
    // Queuing it anyway is the failure the master-clock rule exists to
    // prevent: the queue drifts and the coach calls the wrong punch.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({ tokens: [punch(1), punch(2)] })
    runCue(h, c)

    expect(h.port.assets()).toEqual(['tone-ready'])
    expect(h.skips).toEqual([
      { cueId: c.id, reason: 'phrase-too-long', phraseMs: 800, availableMs: 650 },
    ])
  })

  it('keeps the ready tone even when the words are dropped', () => {
    // The tone is what tells the athlete the combination is starting; it is
    // short, and it matters more than the words.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    runCue(h)
    expect(h.port.assets()).toContain('tone-ready')
  })

  it('speaks a phrase that does fit', () => {
    const h = harness({ style: 'call-and-go' }, { durations: true })
    runCue(h, cue({ tokens: [punch(1)], tokenOffsetsMs: [0] }))
    expect(h.port.assets()).toEqual(['1', 'tone-ready'])
  })

  it('does not guess at an unmeasured clip', () => {
    // Skipping on a made-up duration would produce silences nobody could
    // explain from the data.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({
      tokens: [punch(1), { kind: 'defense', command: 'slip', beatOffset: 1 }],
      tokenOffsetsMs: [0, 400],
    })
    runCue(h, c)
    expect(h.port.assets()).toContain('slip')
    expect(h.skips).toEqual([])
  })

  it('checks nothing at all when no durations were measured', () => {
    const h = harness({ style: 'call-and-go' })
    runCue(h, cue({ tokens: [punch(1), punch(2), punch(3)], tokenOffsetsMs: [0, 300, 600] }))
    expect(h.port.assets()).toEqual(['1', '2', '3', 'tone-ready'])
    expect(h.skips).toEqual([])
  })
})

describe('asset priority follows doc §18.2', () => {
  it('puts a stop call on the safety rung', () => {
    expect(assetPriority('stop')).toBe(AUDIO_PRIORITY.safety)
  })

  it('ranks the bell and the warning tone above a punch command', () => {
    expect(assetPriority('bell')).toBe(AUDIO_PRIORITY.bell)
    expect(assetPriority('tone-warning')).toBe(AUDIO_PRIORITY.bell)
    expect(assetPriority('1')).toBe(AUDIO_PRIORITY.punchCommand)
  })

  it('ranks defense and footwork below the punch command', () => {
    for (const id of ['slip', 'roll', 'duck', 'pull', 'bob-weave'] as VoiceAssetId[]) {
      expect([id, assetPriority(id)]).toEqual([id, AUDIO_PRIORITY.defenseFootwork])
    }
    for (const id of ['pivot', 'step-off', 'circle', 'cut-off-ring', 'reset'] as VoiceAssetId[]) {
      expect([id, assetPriority(id)]).toEqual([id, AUDIO_PRIORITY.defenseFootwork])
    }
  })
})

describe('preparing ahead (doc §18)', () => {
  it('holds plans for several upcoming cues at once', () => {
    const h = harness()
    h.announcer.onCueEvent(cueEvent('cue-previewing', cue({ id: 'a' })))
    h.announcer.onCueEvent(cueEvent('cue-previewing', cue({ id: 'b' })))
    h.announcer.onCueEvent(cueEvent('cue-previewing', cue({ id: 'c' })))
    expect(h.announcer.preparedCueIds()).toEqual(['a', 'b', 'c'])
  })

  it('lets a plan go once its cue is finished, rather than growing forever', () => {
    const h = harness()
    const c = cue({ id: 'a' })
    h.announcer.onCueEvent(cueEvent('cue-previewing', c))
    h.announcer.onCueEvent(cueEvent('cue-completed', c))
    expect(h.announcer.preparedCueIds()).toEqual([])
  })
})

describe('a stance change is announced', () => {
  it('plays the switch call on its own category', () => {
    const h = harness({ mode: 'minimal' })
    h.announcer.onStanceChange('southpaw', 4_000)
    expect(h.port.calls).toEqual([{ kind: 'asset', id: 'switch', atMs: 4_000 }])
  })
})

describe('a policy change takes effect immediately', () => {
  it('silences a coach that was speaking', () => {
    const h = harness({ style: 'call-and-go' })
    runCue(h)
    expect(h.port.calls.length).toBeGreaterThan(0)

    h.port.reset()
    h.announcer.setPolicy({ ...defaultVoiceCoachPolicy(), mode: 'off' })
    runCue(h)
    expect(h.port.calls).toEqual([])
  })
})
