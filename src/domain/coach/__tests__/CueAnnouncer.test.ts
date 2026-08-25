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
  COMBO_TIGHTNESS,
  CueAnnouncer,
  DEFAULT_ANNOUNCE_LEAD_TIMES,
  deliveryForCadence,
  FINAL_WARNING_AT_MS,
  MIN_TIGHTNESS,
  SINGLE_TIGHTNESS,
  type AnnouncerSkip,
  type CueDelivery,
} from '../CueAnnouncer'
import { assetPriority } from '../assetPriority'
import { defaultVoiceCoachPolicy, type VoiceCoachPolicy } from '../VoiceCoachPolicy'
import {
  AUDIO_PRIORITY,
  type CombinationVoice,
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
  | { kind: 'phrase'; ids: VoiceAssetId[]; atMs?: number; tightness: number }
  | { kind: 'speak'; text: string; priority: number }
  | { kind: 'tone'; tone: ToneKind }
  | { kind: 'cancel'; below: number }

class RecordingPort implements VoiceOutputPort {
  readonly calls: Call[] = []

  playAsset(id: VoiceAssetId, atMs?: number): void {
    this.calls.push(atMs === undefined ? { kind: 'asset', id } : { kind: 'asset', id, atMs })
  }
  playPhrase(ids: readonly VoiceAssetId[], atMs?: number, tightness = 1): void {
    this.calls.push({ kind: 'phrase', ids: [...ids], tightness, ...(atMs === undefined ? {} : { atMs }) })
    // Also recorded per clip so the existing assertions about which words
    // were said keep working across both call shapes.
    for (const id of ids) this.calls.push(atMs === undefined ? { kind: 'asset', id } : { kind: 'asset', id, atMs })
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
  tones(): ToneKind[] {
    return this.calls.flatMap((c) => (c.kind === 'tone' ? [c.tone] : []))
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

function harness(
  over: Partial<VoiceCoachPolicy> = {},
  opts: { durations?: boolean; delivery?: CueDelivery } = {},
): Harness {
  const port = new RecordingPort()
  const skips: AnnouncerSkip[] = []
  const announcer = new CueAnnouncer({
    policy: { ...defaultVoiceCoachPolicy(), ...over },
    output: port,
    onSkip: (s) => skips.push(s),
    ...(opts.delivery ? { delivery: opts.delivery } : {}),
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

/** The first spoken word, skipping the phrase record that precedes it. */
const firstWord = (port: RecordingPort): Call | undefined =>
  port.calls.find((c) => c.kind === 'asset' && c.id !== 'tone-ready')

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

describe('deadlines are handed over in the port clock (D3)', () => {
  // Found on the tablet: the coach was "mostly beeping, with the occasional
  // truncated One". Cue times are work-elapsed — milliseconds into the round —
  // and the port schedules against the monotonic clock, which counts from app
  // launch. Handing one to the other made every call look overdue by minutes,
  // so the whole phrase fired at announce time and the next cue cut it off.
  // Only the tones, being short, survived intact.
  const OFFSET = 500_000

  function announceAt(offsetMs: number): RecordingPort {
    const port = new RecordingPort()
    const announcer = new CueAnnouncer({
      policy: { ...defaultVoiceCoachPolicy(), style: 'call-and-go' },
      output: port,
    })
    const c = cue()
    announcer.onCueEvent({
      ...cueEvent('cue-announcing', c),
      workElapsedMs: c.announceAt,
      nowMs: c.announceAt + offsetMs,
    })
    return port
  }

  it('shifts the ready tone by the offset between the two clocks', () => {
    const c = cue()
    const readyWork = c.scheduledStartMs - DEFAULT_ANNOUNCE_LEAD_TIMES.readyToneMs
    const port = announceAt(OFFSET)
    expect(port.calls).toContainEqual({
      kind: 'asset',
      id: 'tone-ready',
      atMs: readyWork + OFFSET,
    })
  })

  it('shifts the phrase by the same offset', () => {
    const port = announceAt(OFFSET)
    const phrase = port.calls.find((x) => x.kind === 'phrase')
    expect(phrase?.kind === 'phrase' && phrase.atMs).toBe(cue().announceAt + OFFSET)
  })

  it('changes nothing when the clocks happen to agree', () => {
    // The offset is zero only at the very start of a round, which is exactly
    // why this bug survived a reading of the code.
    const port = announceAt(0)
    const phrase = port.calls.find((x) => x.kind === 'phrase')
    expect(phrase?.kind === 'phrase' && phrase.atMs).toBe(cue().announceAt)
  })

  it('never hands over a deadline already far in the past', () => {
    // The symptom to catch: a deadline behind the event that produced it
    // means the port plays everything at once.
    const c = cue()
    const port = announceAt(OFFSET)
    const nowAtEvent = c.announceAt + OFFSET
    for (const call of port.calls) {
      if (call.kind !== 'asset' && call.kind !== 'phrase') continue
      const at = call.atMs
      if (at === undefined) continue
      expect([call, at >= nowAtEvent - 2_000]).toEqual([call, true])
    }
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

  it('calls a repeated combination every time, never beeping a repetition', () => {
    // The retired `coach-shorthand` spoke a combination once and marked each
    // repetition with a tone. A beep says something is expected without saying
    // what, and generated workouts repeat a block two to four times, so most
    // calls became tones. Every repetition is now called (D22).
    const h = harness()
    runCue(h, cue({ repeatIndex: 0 }))
    expect(h.port.assets()).toContain('1')

    h.port.reset()
    runCue(h, cue({ id: 'cue-2', repeatIndex: 1 }))
    expect(h.port.assets()).toContain('1')
    expect(h.port.tones()).not.toContain('repeat')
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

describe('in-time delivery calls each punch as it lands (doc §18.1)', () => {
  it('says nothing up front, then one token at a time', () => {
    const h = harness({}, { delivery: 'in-time' })
    const c = cue()
    h.announcer.onCueEvent(cueEvent('cue-announcing', c))
    // No phrase ahead of the throw — only the ready tone.
    expect(h.port.assets()).toEqual(['tone-ready'])

    h.port.reset()
    h.announcer.onCueEvent(tokenDue(c, 0))
    h.announcer.onCueEvent(tokenDue(c, 1))
    expect(h.port.calls).toEqual([
      { kind: 'asset', id: '1' },
      { kind: 'asset', id: '2' },
    ])
  })

  it('never marks a repetition with a tone instead of calling it', () => {
    // In-time delivery says each punch as it comes due rather than calling the
    // combination up front, so the check is that no repeat tone stands in for
    // a word anywhere (D22).
    const h = harness({}, { delivery: 'in-time' })
    const rep1 = cue({ repeatIndex: 1 })
    h.announcer.onCueEvent(cueEvent('cue-announcing', rep1))
    expect(h.port.tones()).not.toContain('repeat')
  })
})

describe('deliveryForCadence maps the cadence to the delivery (doc §18.1)', () => {
  it('calls each punch in time only at the slow technical cadence', () => {
    const inTime: CueDelivery = 'in-time'
    const callAhead: CueDelivery = 'call-ahead'
    expect(deliveryForCadence('technical')).toBe(inTime)
    for (const fast of ['steady', 'pressure', 'sprint']) {
      expect(deliveryForCadence(fast)).toBe(callAhead)
    }
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

describe('a rendered combination is preferred over per-word clips', () => {
  /** A port that has a phrase for whatever it is asked for. */
  function phraseHarness(
    over: { has?: boolean; durationMs?: number } = {},
  ): { port: RecordingPort; announcer: CueAnnouncer; calls: Array<[string, string, number?]> } {
    const port = new RecordingPort()
    const calls: Array<[string, string, number?]> = []
    const has = over.has ?? true
    const announcer = new CueAnnouncer({
      policy: { ...defaultVoiceCoachPolicy(), style: 'call-and-go' },
      output: Object.assign(port, {
        playCombination: (combination: string, cadence: string, atMs?: number) => {
          if (!has) return false
          calls.push([combination, cadence, atMs])
          return true
        },
        combinationDurationMs: () => (has ? (over.durationMs ?? 600) : undefined),
      }),
      cadence: 'steady',
    })
    return { port, announcer, calls }
  }

  it('plays the whole utterance instead of the words', () => {
    const h = phraseHarness()
    h.announcer.onCueEvent(cueEvent('cue-announcing', cue({ tokens: [punch(1), punch(2)] })))

    expect(h.calls[0]?.[0]).toBe('1-2')
    // The per-word path did not also run — that would double the call.
    expect(h.port.calls.some((c) => c.kind === 'phrase')).toBe(false)
    expect(h.port.assets()).toEqual(['tone-ready'])
  })

  it('asks for the cadence it was configured with', () => {
    const h = phraseHarness()
    h.announcer.onCueEvent(cueEvent('cue-announcing'))
    expect(h.calls[0]?.[1]).toBe('steady')
  })

  it('places the phrase to finish by the ready tone', () => {
    const c = cue()
    const h = phraseHarness({ durationMs: 600 })
    h.announcer.onCueEvent(cueEvent('cue-announcing', c))
    const finishBy = c.scheduledStartMs - DEFAULT_ANNOUNCE_LEAD_TIMES.readyToneMs
    expect(h.calls[0]?.[2]).toBe(finishBy - 600)
  })

  it('still rings the ready tone', () => {
    const h = phraseHarness()
    h.announcer.onCueEvent(cueEvent('cue-announcing'))
    expect(h.port.assets()).toContain('tone-ready')
  })

  it('falls back to per-word when nothing has been rendered', () => {
    // A combination the library has not been rendered for must still be
    // called — less well, but never silently skipped.
    const h = phraseHarness({ has: false })
    h.announcer.onCueEvent(cueEvent('cue-announcing', cue({ tokens: [punch(1), punch(2)] })))

    expect(h.calls).toEqual([])
    const phrase = h.port.calls.find((x) => x.kind === 'phrase')
    expect(phrase?.kind === 'phrase' && phrase.ids).toEqual(['1', '2'])
  })

  it('starts at the preview and reports an overrun rather than trimming', () => {
    // The performance is fixed in the file; there is nothing to compress, so
    // a long phrase runs late instead of being cut into something that no
    // longer sounds like a coach.
    const c = cue()
    const skips: AnnouncerSkip[] = []
    const port = new RecordingPort()
    const announcer = new CueAnnouncer({
      policy: { ...defaultVoiceCoachPolicy(), style: 'call-and-go' },
      output: Object.assign(port, {
        playCombination: () => true,
        combinationDurationMs: () => 5_000,
      }),
      cadence: 'steady',
      onSkip: (s) => skips.push(s),
    })
    announcer.onCueEvent(cueEvent('cue-announcing', c))
    expect(skips[0]?.reason).toBe('overruns')
  })

  it('says nothing at all while the D1 gate is shut', () => {
    const h = phraseHarness()
    h.announcer.setThirdPartyPlayback(true)
    h.announcer.onCueEvent(cueEvent('cue-announcing'))
    expect(h.calls).toEqual([])
    expect(h.port.calls).toEqual([])
  })
})

describe('the callout vocabulary and performance reach the port (D15, Phase C)', () => {
  /** Records the `voice` argument handed to the phrase methods. */
  function voiceHarness(opts: {
    vocabulary?: 'numbers' | 'techniques'
    performanceFor?: (cue: CueInstance) => 'teach' | 'work' | 'push'
  }): { announcer: CueAnnouncer; play: Array<CombinationVoice | undefined>; duration: Array<CombinationVoice | undefined> } {
    const port = new RecordingPort()
    const play: Array<CombinationVoice | undefined> = []
    const duration: Array<CombinationVoice | undefined> = []
    const announcer = new CueAnnouncer({
      policy: { ...defaultVoiceCoachPolicy(), style: 'call-and-go' },
      output: Object.assign(port, {
        playCombination: (_c: string, _cad: string, _at?: number, voice?: CombinationVoice) => {
          play.push(voice)
          return true
        },
        combinationDurationMs: (_c: string, _cad: string, voice?: CombinationVoice) => {
          duration.push(voice)
          return 600
        },
      }),
      cadence: 'steady',
      ...opts,
    })
    return { announcer, play, duration }
  }

  it('passes the configured vocabulary to both phrase methods', () => {
    const h = voiceHarness({ vocabulary: 'techniques' })
    h.announcer.onCueEvent(cueEvent('cue-announcing', cue({ tokens: [punch(1), punch(2)] })))
    expect(h.play[0]?.vocabulary).toBe('techniques')
    expect(h.duration[0]?.vocabulary).toBe('techniques')
  })

  it('defaults to numbers and the work state', () => {
    const h = voiceHarness({})
    h.announcer.onCueEvent(cueEvent('cue-announcing'))
    expect(h.play[0]).toEqual({ vocabulary: 'numbers', performance: 'work' })
  })

  it('asks the injected selector for the performance state', () => {
    // The round context that decides teach/work/push lives upstream, so the
    // announcer takes a selector rather than deriving it.
    const h = voiceHarness({ performanceFor: () => 'push' })
    h.announcer.onCueEvent(cueEvent('cue-announcing'))
    expect(h.play[0]?.performance).toBe('push')
    // The duration lookup must use the *same* voice, or it would place a clip
    // whose length belongs to a different recording.
    expect(h.duration[0]?.performance).toBe('push')
  })
})

describe('a phrase is placed so it finishes before the combination (D15)', () => {
  it('starts early enough that the last word lands before the ready tone', () => {
    // This is what being in sync means for a coach: the call finishes and
    // then you throw. A fixed lead that hopes the words fit is what leaves a
    // three-punch call still talking while the first punch is due.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({ tokens: [punch(1), punch(2)] })
    runCue(h, c)

    const words = h.port.calls.filter((x) => x.kind === 'asset' && x.id !== 'tone-ready')
    const finishBy = c.scheduledStartMs - DEFAULT_ANNOUNCE_LEAD_TIMES.readyToneMs
    // 400 ms a clip. The gap before the last word is tightened; the last word
    // is never trimmed, so the phrase runs 400 × 0.72 + 400.
    const expected = Math.round(400 * COMBO_TIGHTNESS + 400)
    expect(words).toEqual([
      { kind: 'asset', id: '1', atMs: finishBy - expected },
      { kind: 'asset', id: '2', atMs: finishBy - expected },
    ])
  })

  it('calls a combination tighter than a single command', () => {
    // A combination is rattled off; one punch is an order. Calling a lone
    // punch at combination speed makes it sound like a fragment.
    const combo = harness({ style: 'call-and-go' }, { durations: true })
    combo.announcer.onCueEvent(cueEvent('cue-announcing', cue({ tokens: [punch(1), punch(2)] })))
    const comboCall = combo.port.calls.find((x) => x.kind === 'phrase')

    const single = harness({ style: 'call-and-go' }, { durations: true })
    single.announcer.onCueEvent(
      cueEvent('cue-announcing', cue({ tokens: [punch(1)], tokenOffsetsMs: [0] })),
    )
    const singleCall = single.port.calls.find((x) => x.kind === 'phrase')

    expect(comboCall?.kind === 'phrase' && comboCall.tightness).toBe(COMBO_TIGHTNESS)
    expect(singleCall?.kind === 'phrase' && singleCall.tightness).toBe(SINGLE_TIGHTNESS)
  })

  it('sends the combination as one phrase, not as separate clips', () => {
    // The output needs to know these words belong together; that is what
    // lets it run them back to back and say a repeated word twice.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    h.announcer.onCueEvent(
      cueEvent('cue-announcing', cue({ tokens: [punch(1), punch(1), punch(2)] })),
    )
    const phrase = h.port.calls.find((x) => x.kind === 'phrase')
    expect(phrase?.kind === 'phrase' && phrase.ids).toEqual(['1', '1', '2'])
  })

  it('gives every clip in the phrase one shared deadline', () => {
    // The output treats a shared deadline as a single utterance and plays the
    // clips back to back. Separate deadlines play them all at once, and a
    // repeated word restarts its own player mid-syllable — which is how
    // 1-1-2 came out as a single noise on the tablet.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({ tokens: [punch(1), punch(1), punch(2)] })
    runCue(h, c)

    const deadlines = h.port.calls
      .filter((x) => x.kind === 'asset' && x.id !== 'tone-ready')
      .map((x) => (x.kind === 'asset' ? x.atMs : undefined))
    expect(deadlines).toHaveLength(3)
    expect(new Set(deadlines).size).toBe(1)
  })

  it('shifts a short phrase later, closer to the combination', () => {
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({ tokens: [punch(1)], tokenOffsetsMs: [0] })
    runCue(h, c)
    const finishBy = c.scheduledStartMs - DEFAULT_ANNOUNCE_LEAD_TIMES.readyToneMs
    expect(h.port.calls).toContainEqual({ kind: 'asset', id: '1', atMs: finishBy - 400 })
  })

  it('never begins before the cue is on screen', () => {
    // Hearing a combination that is not yet visible is its own kind of out
    // of sync.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({ tokens: [punch(1), punch(2)] })
    runCue(h, c)
    const first = h.port.calls.find((x) => x.kind === 'asset' && x.id !== 'tone-ready')
    expect(first?.kind === 'asset' && (first.atMs ?? 0) >= c.previewAt).toBe(true)
  })

  it('compresses a long combination rather than dropping it', () => {
    // The rule the coach cares about: every combination gets called. A
    // combination nobody named is worse than one named fast.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({ tokens: [punch(1), punch(2), punch(3), punch(1), punch(2)] })
    runCue(h, c)

    const phrase = h.port.calls.find((x) => x.kind === 'phrase')
    expect(phrase?.kind === 'phrase' && phrase.ids).toEqual(['1', '2', '3', '1', '2'])
    expect(phrase?.kind === 'phrase' && phrase.tightness).toBeLessThan(COMBO_TIGHTNESS)
    expect(h.skips[0]?.reason).toBe('compressed')
  })

  it('reports the compression rather than hiding it', () => {
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({ tokens: [punch(1), punch(2), punch(3), punch(1), punch(2)] })
    runCue(h, c)
    expect(h.skips[0]).toMatchObject({ cueId: c.id, reason: 'compressed' })
    expect(h.skips[0]?.tightness).toBeGreaterThanOrEqual(MIN_TIGHTNESS)
  })

  it('still speaks a phrase that overruns even at the tightest delivery', () => {
    // Past the floor it runs long instead of vanishing. A late word is
    // recoverable; silence is not.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    const c = cue({
      tokens: [punch(1), punch(2), punch(3), punch(1), punch(2), punch(3), punch(1), punch(2)],
    })
    runCue(h, c)

    const phrase = h.port.calls.find((x) => x.kind === 'phrase')
    expect(phrase?.kind === 'phrase' && phrase.ids).toHaveLength(8)
    expect(phrase?.kind === 'phrase' && phrase.tightness).toBe(MIN_TIGHTNESS)
    expect(h.skips[0]?.reason).toBe('overruns')
  })

  it('never squeezes past the floor where numbers stop being countable', () => {
    const h = harness({ style: 'call-and-go' }, { durations: true })
    runCue(
      h,
      cue({
        tokens: [punch(1), punch(2), punch(3), punch(1), punch(2), punch(3), punch(1), punch(2)],
      }),
    )
    const phrase = h.port.calls.find((x) => x.kind === 'phrase')
    expect(phrase?.kind === 'phrase' && phrase.tightness).toBeGreaterThanOrEqual(MIN_TIGHTNESS)
  })

  it('keeps the ready tone alongside the words', () => {
    // The tone is what tells the athlete the combination is starting.
    const h = harness({ style: 'call-and-go' }, { durations: true })
    runCue(h, cue({ tokens: [punch(1), punch(2), punch(3), punch(1), punch(2)] }))
    expect(h.port.assets()).toContain('tone-ready')
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
    // One unknown length makes the whole phrase unplaceable, so it falls back
    // to the fixed lead rather than inventing a number for the rest.
    expect(firstWord(h.port)).toEqual({ kind: 'asset', id: '1', atMs: c.announceAt })
  })

  it('falls back to the fixed announce moment when nothing measured the clips', () => {
    // The honest default: with no durations there is nothing to place the
    // phrase against, so it uses the doc §18.3 lead and never skips.
    const h = harness({ style: 'call-and-go' })
    const c = cue({ tokens: [punch(1), punch(2), punch(3)], tokenOffsetsMs: [0, 300, 600] })
    runCue(h, c)
    expect(h.port.assets()).toEqual(['1', '2', '3', 'tone-ready'])
    expect(h.skips).toEqual([])
    expect(firstWord(h.port)).toEqual({ kind: 'asset', id: '1', atMs: c.announceAt })
  })

  it('prefers a duration the output measured over the injected table', () => {
    // The port knows the real file; the table is a fallback for tests and for
    // a build whose clips have not loaded yet.
    const port = new RecordingPort()
    const announcer = new CueAnnouncer({
      policy: { ...defaultVoiceCoachPolicy(), style: 'call-and-go' },
      output: Object.assign(port, { assetDurationMs: () => 100 }),
      assetDurationsMs: { '1': 400, '2': 400 },
    })
    const c = cue({ tokens: [punch(1), punch(2)] })
    announcer.onCueEvent(cueEvent('cue-announcing', c))
    const finishBy = c.scheduledStartMs - DEFAULT_ANNOUNCE_LEAD_TIMES.readyToneMs
    // 100 ms a clip at the combination cadence: 100 × 0.72 + 100.
    const expected = Math.round(100 * COMBO_TIGHTNESS + 100)
    expect(port.calls).toContainEqual({ kind: 'asset', id: '1', atMs: finishBy - expected })
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

describe('a count-scored burst re-anchors the motif periodically', () => {
  // The point: a 30-80s volume-burst that named the motif once and then went
  // silent left the athlete without a rhythm reminder. Under D18 they still
  // have to keep throwing, so the coach should re-call the motif every few
  // seconds rather than dropping out.
  interface Scheduled {
    combination: string
    atMs: number | undefined
  }
  function burstHarness(windowMs: number): {
    announcer: CueAnnouncer
    scheduled: Scheduled[]
    port: RecordingPort
  } {
    const port = new RecordingPort()
    const scheduled: Scheduled[] = []
    // A minimal RecordingPort augmented with the two methods the announcer
    // needs to schedule refires: a phrase length and a combination player.
    const output = Object.assign(port, {
      playCombination: (combination: string, _c: string, atMs?: number) => {
        scheduled.push({ combination, atMs })
        return true
      },
      combinationDurationMs: () => 600,
    })
    const announcer = new CueAnnouncer({
      policy: { ...defaultVoiceCoachPolicy(), style: 'call-and-go' },
      output,
      cadence: 'steady',
    })
    const c: CueInstance = {
      ...cue(),
      scoring: 'count',
      countScored: { targetPunches: 20, countdownMs: 3_000 },
      windowStartMs: cue().scheduledStartMs,
      windowEndMs: cue().scheduledStartMs + windowMs,
      scheduledEndMs: cue().scheduledStartMs + windowMs,
    }
    announcer.onCueEvent(cueEvent('cue-announcing', c))
    scheduled.length = 0 // discard the initial announce; we care about refires
    announcer.onCueEvent(cueEvent('cue-active', c))
    return { announcer, scheduled, port }
  }

  it('schedules a re-call every ~6 seconds across a long burst', () => {
    // A 45s window at 6s interval fits about seven re-fires, each landing
    // before the tail-quiet buffer.
    const h = burstHarness(45_000)
    expect(h.scheduled.length).toBeGreaterThan(3)
    expect(h.scheduled.length).toBeLessThan(10)

    // Every re-fire falls inside the window and leaves room for the clip
    // and the tail buffer to finish before it closes.
    const c = cue()
    for (const s of h.scheduled) {
      expect(s.atMs).toBeDefined()
      const atCue = (s.atMs ?? 0) - (cueEvent('cue-active', c).nowMs - cueEvent('cue-active', c).workElapsedMs)
      expect(atCue).toBeGreaterThan(c.scheduledStartMs)
    }
  })

  it('does not re-fire on a short burst the initial call already covers', () => {
    // A 6s window: the initial announce says the motif, and re-firing so
    // close to the end would stack the same phrase on itself.
    const h = burstHarness(6_000)
    expect(h.scheduled).toEqual([])
  })

  it('does not schedule refires on a sequence-scored cue', () => {
    // The re-fire path exists for count-scored bursts, not for enumerated
    // combos where every token is spoken as it comes due.
    const port = new RecordingPort()
    const scheduled: Array<{ atMs?: number }> = []
    const output = Object.assign(port, {
      playCombination: (_c: string, _cad: string, atMs?: number) => {
        scheduled.push({ atMs })
        return true
      },
      combinationDurationMs: () => 600,
    })
    const announcer = new CueAnnouncer({
      policy: { ...defaultVoiceCoachPolicy(), style: 'call-and-go' },
      output,
      cadence: 'steady',
    })
    const c = { ...cue(), windowEndMs: cue().scheduledStartMs + 45_000 }
    announcer.onCueEvent(cueEvent('cue-announcing', c))
    scheduled.length = 0
    announcer.onCueEvent(cueEvent('cue-active', c))
    expect(scheduled).toEqual([])
  })
})
