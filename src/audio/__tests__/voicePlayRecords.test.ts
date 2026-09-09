/**
 * The `puncheokie.voice.play` records carry what the timing observer and
 * the offline analyzer join on (GH #291, C0).
 *
 * The log sink prints FIELDS only — a record's own `monotonicTimeMs` never
 * reaches logcat — so every timestamp the analyzer needs must be an
 * explicit field. `dispatchMs` is stamped on the injected clock immediately
 * before `play()`, and `traceId` echoes whatever the runner minted so the
 * dispatch record, the audio record and the observation line up without
 * time-proximity guessing.
 */
// VoiceOutputExpo imports the native audio modules; nothing here plays.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  createAudioPlaylist: jest.fn(),
  setAudioModeAsync: jest.fn(async () => undefined),
}))
jest.mock('expo-speech', () => ({ speak: () => {}, stop: () => {} }))

import { replaceSinks, type LogRecord } from '@diagnostics/logger'

import { VoiceOutputExpo } from '../VoiceOutputExpo'

interface FakePlayer {
  source: number
  volume: number
  currentTime: number
  listeners: Array<(s: { playing?: boolean; currentTime?: number }) => void>
  emit: (s: { playing?: boolean; currentTime?: number }) => void
}

function rig(options: { timingObserver?: boolean } = {}) {
  let clock = 5_000
  let nextId = 1
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  const fakes: FakePlayer[] = []
  const makeFake = (source: number) => {
    const fake: FakePlayer = {
      source,
      volume: 1,
      currentTime: 0,
      listeners: [],
      emit: (s) => {
        for (const l of [...fake.listeners]) l(s)
      },
    }
    fakes.push(fake)
    return {
      ...fake,
      get listeners() {
        return fake.listeners
      },
      emit: fake.emit,
      seekTo: () => Promise.resolve(),
      play: () => {},
      pause: () => {},
      remove: () => {},
      release: () => {},
      addListener: (_event: string, cb: FakePlayer['listeners'][number]) => {
        fake.listeners.push(cb)
        return { remove: () => void (fake.listeners = fake.listeners.filter((l) => l !== cb)) }
      },
    } as never
  }
  const output = new VoiceOutputExpo({
    clock: () => clock,
    schedule: (fn, delayMs) => {
      const id = nextId++
      timers.push({ at: clock + delayMs, fn, id })
      return id
    },
    cancelScheduled: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
    createPlayer: (source: number) => makeFake(source),
    createClickScriptPlayer: ((source: number) => makeFake(source)) as never,
    setAudioMode: (async () => {}) as never,
    ...options,
  })
  return { output, fakes, tick: (ms: number) => void (clock += ms), now: () => clock }
}

let records: LogRecord[] = []
const plays = (): LogRecord[] => records.filter((r) => r.code === 'puncheokie.voice.play')
const field = (r: LogRecord, k: string): unknown => r.fields[k]?.value

beforeEach(() => {
  records = []
  replaceSinks([{ write: (r) => records.push(r) }])
})

describe('voice.play records', () => {
  it('instruction: dispatchMs on the injected clock, traceId echoed, volume present', () => {
    const h = rig()
    h.tick(123)
    h.output.playInstruction({ text: 'aside', module: 600, durationMs: 900, traceId: 'slot-a' })
    const r = plays()[0]
    expect(r?.message).toBe('instruction playing')
    expect(field(r!, 'dispatchMs')).toBe(5_123)
    expect(field(r!, 'traceId')).toBe('slot-a')
    expect(typeof field(r!, 'volume')).toBe('number')
  })

  it('combo-announce: same contract, and a missing traceId logs null rather than vanishing', () => {
    const h = rig()
    h.output.playComboAnnounce({ text: 'One, two, go!', module: 601, durationMs: 800 })
    const r = plays()[0]
    expect(r?.message).toBe('combo-announce playing')
    expect(field(r!, 'dispatchMs')).toBe(5_000)
    expect(field(r!, 'traceId')).toBeNull()
  })

  it('click-script: dispatchMs is stamped at play(), after any rewind, and carries the runner traceId', () => {
    const h = rig()
    h.output.playClickScript(
      { text: 'clip', module: 700, durationMs: 700, traceId: 'call/1-2-3-2#4000' },
      { oneShot: true },
    )
    const r = plays()[0]
    expect(r?.message).toBe('click-script playing')
    expect(field(r!, 'traceId')).toBe('call/1-2-3-2#4000')
    // A fresh player speaks straight away: dispatchMs equals the clock at play().
    expect(field(r!, 'dispatchMs')).toBe(5_000)
    expect(field(r!, 'path')).toBe('fresh')
  })

  it('with the observer armed, a play is observed end to end and joined by playId', () => {
    const h = rig({ timingObserver: true })
    h.output.playInstruction({ text: 'aside', module: 610, durationMs: 900, traceId: 't-1' })
    const play = plays()[0]!
    const playId = field(play, 'playId') as string
    expect(typeof playId).toBe('string')
    const fake = h.fakes[h.fakes.length - 1]!
    expect(fake.listeners).toHaveLength(1) // one listener per player

    h.tick(30)
    fake.emit({ playing: true, currentTime: 0 })
    h.tick(900)
    fake.emit({ playing: false, currentTime: 0.9 })

    const observed = records.filter((r) => r.code === 'puncheokie.voice.observed')
    expect(observed).toHaveLength(1)
    const o = observed[0]!
    expect(field(o, 'playId')).toBe(playId)
    expect(field(o, 'traceId')).toBe('t-1')
    expect(field(o, 'kind')).toBe('instruction')
    expect(field(o, 'outcome')).toBe('ok')
    expect(field(o, 'onsetLatencyMs')).toBe(30)
    expect(field(o, 'observedDurationMs')).toBe(900)
    expect(field(o, 'silentByVolume')).toBe(false)
  })

  it('with the observer off (the default), no listener is ever attached and nothing is observed', () => {
    const h = rig()
    h.output.playInstruction({ text: 'aside', module: 611, durationMs: 900 })
    expect(h.fakes[h.fakes.length - 1]?.listeners).toHaveLength(0)
    expect(records.filter((r) => r.code === 'puncheokie.voice.observed')).toHaveLength(0)
    expect(field(plays()[0]!, 'playId')).toEqual(expect.any(String))
  })

  it('release() reports the observer stats and closes open observations as released', () => {
    const h = rig({ timingObserver: true })
    h.output.playInstruction({ text: 'aside', module: 612, durationMs: 5_000 })
    h.fakes[h.fakes.length - 1]!.emit({ playing: true })
    h.output.release()
    const observed = records.filter((r) => r.code === 'puncheokie.voice.observed')
    expect(observed.map((r) => field(r, 'outcome'))).toEqual(['released'])
    const stats = records.find((r) => r.code === 'puncheokie.observer.stats')
    expect(stats).toBeDefined()
    expect(field(stats!, 'watched')).toBe(1)
    expect(field(stats!, 'openAtRelease')).toBe(1)
  })

  it('clip (pooled): dispatchMs present alongside the duck-tell volume', async () => {
    const h = rig()
    await h.output.preload({ light: true })
    h.output.playAsset('bell')
    const r = plays().find((x) => x.message === 'clip playing')
    expect(r).toBeDefined()
    expect(field(r!, 'asset')).toBe('bell')
    expect(typeof field(r!, 'dispatchMs')).toBe('number')
    expect(typeof field(r!, 'volume')).toBe('number')
  })
})
