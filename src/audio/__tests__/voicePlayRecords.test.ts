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

function rig() {
  let clock = 5_000
  let nextId = 1
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  const makeFake = (source: number) =>
    ({
      source,
      volume: 1,
      currentTime: 0,
      seekTo: () => Promise.resolve(),
      play: () => {},
      pause: () => {},
      remove: () => {},
      release: () => {},
    }) as never
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
  })
  return { output, tick: (ms: number) => void (clock += ms), now: () => clock }
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
