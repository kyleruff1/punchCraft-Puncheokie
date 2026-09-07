/**
 * PlaybackObserver (GH #291, plan C1) — silent, event-driven timing of one
 * play, driven entirely through fakes: a player that exposes `addListener`
 * and lets the test push status events, and a manual clock/timer pair.
 *
 * The behaviours that matter are the ones with a wrong-but-plausible
 * alternative: onset must be the `playing:true` TRANSITION (not a
 * blocking playhead read); end must accept `playing:false` because the
 * TypeScript status type carries no `didJustFinish`; a second watch on an
 * open entry is data (`superseded`), not an error; a player told to
 * `forget()` must never be touched again; and however many plays go
 * through, there is one listener per player and one timer in total.
 */
import { PlaybackObserver, type ObservedRecord, type StatusLike } from '../PlaybackObserver'

interface FakePlayer {
  currentTime: number
  playing: boolean
  volume: number
  listeners: Array<(s: StatusLike) => void>
  removed: number
  addListener: (event: string, cb: (s: StatusLike) => void) => { remove: () => void }
  emit: (s: StatusLike) => void
}

function fakePlayer(): FakePlayer {
  const p: FakePlayer = {
    currentTime: 0,
    playing: false,
    volume: 1,
    listeners: [],
    removed: 0,
    addListener: (_event, cb) => {
      p.listeners.push(cb)
      return {
        remove: () => {
          p.listeners = p.listeners.filter((l) => l !== cb)
          p.removed += 1
        },
      }
    },
    emit: (s) => {
      for (const l of [...p.listeners]) l(s)
    },
  }
  return p
}

function rig(overrides: { onsetTimeoutMs?: number; endGraceMs?: number } = {}) {
  let now = 10_000
  let nextId = 1
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  const records: ObservedRecord[] = []
  const observer = new PlaybackObserver({
    clock: () => now,
    schedule: (fn, delayMs) => {
      const id = nextId++
      timers.push({ at: now + delayMs, fn, id })
      return id
    },
    cancelScheduled: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
    onObserved: (r) => records.push(r),
    ...overrides,
  })
  const advance = (ms: number): void => {
    now += ms
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (t.at > now) break
      timers.splice(timers.indexOf(t), 1)
      t.fn()
    }
  }
  return { observer, records, advance, now: () => now, timers }
}

const meta = (playId: string, over: Partial<Parameters<PlaybackObserver['watch']>[1]> = {}) => ({
  playId,
  kind: 'instruction' as const,
  label: 'aside',
  expectedDurationMs: 900,
  dispatchMs: 10_000,
  volumeAtDispatch: 1,
  ...over,
})

describe('PlaybackObserver', () => {
  it('onset on the playing:true transition, end on didJustFinish — latencies on the injected clock', () => {
    const h = rig()
    const p = fakePlayer()
    h.observer.watch(p, meta('a'))
    expect(p.listeners).toHaveLength(1)

    h.advance(35)
    p.emit({ playing: true, currentTime: 0 })
    h.advance(900)
    p.emit({ playing: false, didJustFinish: true, currentTime: 0.9 })

    expect(h.records).toHaveLength(1)
    const r = h.records[0]!
    expect(r.outcome).toBe('ok')
    expect(r.method).toBe('status')
    expect(r.onsetLatencyMs).toBe(35)
    expect(r.observedDurationMs).toBe(900)
    expect(r.positionAtOnsetMs).toBe(0)
    expect(r.silentByVolume).toBe(false)
  })

  it('ends on playing:false alone — the TS status type has no didJustFinish', () => {
    const h = rig()
    const p = fakePlayer()
    h.observer.watch(p, meta('b'))
    p.emit({ playing: true })
    h.advance(400)
    p.emit({ playing: false })
    expect(h.records[0]?.outcome).toBe('ok')
    expect(h.records[0]?.observedDurationMs).toBe(400)
  })

  it('times out a play that never starts, and keeps a single deadline timer while doing so', () => {
    const h = rig({ onsetTimeoutMs: 1_000 })
    const p1 = fakePlayer()
    const p2 = fakePlayer()
    h.observer.watch(p1, meta('c1'))
    h.observer.watch(p2, meta('c2', { dispatchMs: 10_500 }))
    expect(h.timers).toHaveLength(1)
    h.advance(999)
    expect(h.records).toHaveLength(0)
    h.advance(1)
    expect(h.records.map((r) => [r.playId, r.outcome])).toEqual([['c1', 'timeout']])
    expect(h.records[0]?.onsetMs).toBeNull()
    expect(h.records[0]?.onsetLatencyMs).toBeNull()
    // The timer re-armed to the second entry's deadline.
    expect(h.timers).toHaveLength(1)
    h.advance(500)
    expect(h.records.map((r) => r.playId)).toEqual(['c1', 'c2'])
  })

  it('times out a started play that never ends, after expected duration plus grace', () => {
    const h = rig({ endGraceMs: 100 })
    const p = fakePlayer()
    h.observer.watch(p, meta('d', { expectedDurationMs: 500 }))
    p.emit({ playing: true })
    h.advance(599)
    expect(h.records).toHaveLength(0)
    h.advance(1)
    expect(h.records[0]?.outcome).toBe('timeout')
    expect(h.records[0]?.onsetMs).toBe(10_000)
  })

  it('a second watch on the same player supersedes the open one — data, not an error', () => {
    const h = rig()
    const p = fakePlayer()
    h.observer.watch(p, meta('e1'))
    p.emit({ playing: true })
    h.advance(200)
    h.observer.watch(p, meta('e2', { dispatchMs: 10_200 }))
    expect(h.records.map((r) => [r.playId, r.outcome])).toEqual([['e1', 'superseded']])
    expect(h.records[0]?.observedDurationMs).toBe(200)
    // Still one listener on that player.
    expect(p.listeners).toHaveLength(1)
    p.emit({ playing: true })
    p.emit({ playing: false })
    expect(h.records.map((r) => r.playId)).toEqual(['e1', 'e2'])
  })

  it('reports stalled only after the position has sat still for 1.5 s of real time', () => {
    // A COUNT of identical positions is not a stall signal. On the tablet
    // media3 repeats `currentTime` several times at the observed 40 ms
    // cadence while it spins up: a 3-sample rule closed the 25 s walkout
    // 101 ms in and 51 of 68 click-script plays early, and every duration
    // built on those observations was fiction (release drive, 2026-09-07).
    const h = rig()
    const p = fakePlayer()
    h.observer.watch(p, meta('f'))
    p.emit({ playing: true, currentTime: 0 })
    // Six repeats of the same position inside a second: still playing.
    for (let i = 0; i < 6; i += 1) {
      h.advance(40)
      p.emit({ playing: true, currentTime: 0.2 })
    }
    expect(h.records).toHaveLength(0)

    h.advance(1_500)
    p.emit({ playing: true, currentTime: 0.2 })
    expect(h.records[0]?.outcome).toBe('stalled')
  })

  it('a playlist stepping its per-track position backwards is progress, not a stall', () => {
    // `currentTime` on a playlist is per-TRACK, so it resets at every track
    // change. Any CHANGE restarts the stall window.
    const h = rig()
    const p = fakePlayer()
    h.observer.watch(p, meta('f2'))
    p.emit({ playing: true, currentTime: 1.8 })
    h.advance(1_000)
    p.emit({ playing: true, currentTime: 0 }) // next track
    h.advance(1_000)
    p.emit({ playing: true, currentTime: 0.5 })
    expect(h.records).toHaveLength(0)
    p.emit({ playing: false })
    expect(h.records[0]?.outcome).toBe('ok')
  })

  it('marks a play born at volume 0 as silentByVolume', () => {
    const h = rig()
    const p = fakePlayer()
    h.observer.watch(p, meta('g', { volumeAtDispatch: 0 }))
    p.emit({ playing: true })
    p.emit({ playing: false })
    expect(h.records[0]?.silentByVolume).toBe(true)
  })

  it('forget() closes the open entry with the reason, removes the listener, and never touches the player again', () => {
    const h = rig()
    const p = fakePlayer()
    h.observer.watch(p, meta('h'))
    p.emit({ playing: true })
    h.observer.forget(p, 'evicted')
    expect(h.records.map((r) => r.outcome)).toEqual(['evicted'])
    expect(p.listeners).toHaveLength(0)
    expect(p.removed).toBe(1)
    // A late status from a released player is ignored, not an error.
    p.emit({ playing: false })
    expect(h.records).toHaveLength(1)
    expect(h.observer.stats().listeners).toBe(0)
  })

  it('release() closes everything as released and cancels the timer', () => {
    const h = rig()
    const p1 = fakePlayer()
    const p2 = fakePlayer()
    h.observer.watch(p1, meta('i1'))
    h.observer.watch(p2, meta('i2'))
    h.observer.release()
    expect(h.records.map((r) => r.outcome)).toEqual(['released', 'released'])
    expect(h.timers).toHaveLength(0)
    expect(h.observer.stats()).toMatchObject({ open: 0, listeners: 0, watched: 2 })
  })

  it('falls back to polling only when a player has no addListener', () => {
    const h = rig();
    const p = { currentTime: 0, playing: false, volume: 1 } as { currentTime: number; playing: boolean; volume: number }
    h.observer.watch(p, meta('j'))
    expect(h.timers.length).toBeGreaterThanOrEqual(1) // the poll is scheduled
    h.advance(25)
    p.playing = true
    p.currentTime = 0.05
    h.advance(25)
    p.currentTime = 0.5
    h.advance(25)
    p.playing = false
    h.advance(25)
    expect(h.records[0]).toMatchObject({ playId: 'j', method: 'poll', outcome: 'ok' })
    expect(h.records[0]?.onsetLatencyMs).toBe(50)
  })
})
