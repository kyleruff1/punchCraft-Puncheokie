/**
 * Visual-forensics buffer (token-order investigation, 2026-08-31).
 *
 * The buffer exists to measure a stall WITHOUT causing one, so the
 * properties worth pinning are: nothing is emitted per transition, the
 * buffer is bounded, a clock anomaly is recorded only when it is real,
 * and disabling it makes every entry point free.
 */
import {
  CLOCK_ANOMALY_MS,
  FLUSH_BATCH,
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED,
  VizForensics,
  type VizRecord,
} from '../vizForensics'

function harness(enabled = true, flushIntervalMs = 0) {
  const batches: VizRecord[][] = []
  const clock = { now: 1_000 }
  const viz = new VizForensics({
    emit: (batch) => batches.push([...batch]),
    now: () => clock.now,
    enabled,
    // Most tests exercise buffering, not pacing, so they opt out of the
    // rate limit. The rate-limit suite below sets it explicitly.
    flushIntervalMs,
  })
  return { viz, batches, clock, flat: () => batches.flat() }
}

const tokenInput = (over: Partial<Parameters<VizForensics['token']>[0]> = {}) => ({
  cueId: 'r1-b1#0',
  repeatIndex: 0,
  tokenIndex: 0,
  ordinal: 0,
  prev: 'upcoming',
  next: 'active',
  source: 'token-due' as const,
  workElapsedMs: 500,
  ...over,
})

describe('VizForensics buffering', () => {
  it('records without emitting — the flush is the only I/O', () => {
    const h = harness()
    h.viz.token(tokenInput())
    h.viz.token(tokenInput({ tokenIndex: 1 }))
    expect(h.batches).toHaveLength(0)
    expect(h.viz.pending).toBe(2)

    h.viz.flush()
    expect(h.batches).toHaveLength(1)
    expect(h.flat()).toHaveLength(2)
    expect(h.viz.pending).toBe(0)
  })

  it('stamps every record with the injected monotonic clock', () => {
    const h = harness()
    h.clock.now = 1_234.5
    h.viz.token(tokenInput())
    h.viz.flush()
    expect(h.flat()[0]?.monotonicMs).toBe(1_234.5)
  })

  it('splits a large buffer into batches of FLUSH_BATCH', () => {
    const h = harness()
    for (let i = 0; i < FLUSH_BATCH * 2 + 3; i += 1) h.viz.token(tokenInput())
    h.viz.flush()
    expect(h.batches).toHaveLength(3)
    expect(h.batches[0]).toHaveLength(FLUSH_BATCH)
    expect(h.batches[1]).toHaveLength(FLUSH_BATCH)
    expect(h.batches[2]).toHaveLength(3)
  })

  it('flushing an empty buffer emits nothing', () => {
    const h = harness()
    h.viz.flush()
    expect(h.batches).toHaveLength(0)
  })

  it('is bounded — drops the OLDEST past MAX_BUFFERED and counts the loss', () => {
    const h = harness()
    // The records nearest the recovery explain the burst, so the newest win.
    for (let i = 0; i < MAX_BUFFERED + 10; i += 1) {
      h.viz.token(tokenInput({ tokenIndex: i }))
    }
    expect(h.viz.pending).toBe(MAX_BUFFERED)
    expect(h.viz.droppedCount).toBe(10)

    h.viz.flush()
    const first = h.flat()[0]
    // Oldest ten are gone: the survivor set starts at tokenIndex 10.
    expect(first && 'tokenIndex' in first ? first.tokenIndex : -1).toBe(10)
  })
})

describe('VizForensics clock-anomaly detection', () => {
  it('writes nothing on a healthy tick cadence', () => {
    const h = harness()
    for (let i = 0; i < 10; i += 1) {
      h.clock.now += 50
      h.viz.tick(i * 50)
    }
    expect(h.viz.pending).toBe(0)
  })

  it('records a stall when the wall clock jumps past the threshold', () => {
    const h = harness()
    h.clock.now += 50
    h.viz.tick(0)
    // The freeze: wall time leaps, work clock leaps with it.
    h.clock.now += CLOCK_ANOMALY_MS + 2_000
    h.viz.tick(2_250)

    h.viz.flush()
    const record = h.flat()[0]
    expect(record?.kind).toBe('clock')
    if (record?.kind !== 'clock') throw new Error('expected a clock record')
    expect(record.wallDeltaMs).toBe(CLOCK_ANOMALY_MS + 2_000)
    expect(record.workDeltaMs).toBe(2_250)
  })

  it('records a backwards work clock even when the wall delta is small', () => {
    const h = harness()
    h.clock.now += 50
    h.viz.tick(1_000)
    h.clock.now += 50
    h.viz.tick(900) // regression

    h.viz.flush()
    const record = h.flat()[0]
    if (record?.kind !== 'clock') throw new Error('expected a clock record')
    expect(record.workDeltaMs).toBe(-100)
  })

  it('needs two ticks before it can measure a delta', () => {
    const h = harness()
    h.viz.tick(0)
    expect(h.viz.pending).toBe(0)
  })
})

describe('VizForensics when disabled', () => {
  it('records nothing and emits nothing', () => {
    const h = harness(false)
    h.viz.token(tokenInput())
    h.viz.avatar({ frameKey: '1', step: 'step1', occurrence: 'r1-b1#0:0' })
    h.clock.now += 5_000
    h.viz.tick(0)
    h.clock.now += 5_000
    h.viz.tick(5_000)
    h.viz.flush()

    expect(h.viz.pending).toBe(0)
    expect(h.batches).toHaveLength(0)
    expect(h.viz.isEnabled).toBe(false)
  })
})

describe('VizForensics flush rate limit', () => {
  // The runner calls flush() on its 50 ms tick. Emitting every time puts
  // ~20 serialized log lines/second INSIDE the interval whose lateness we
  // are measuring — a first forensic drive wired that way reported 574
  // stalls totalling 215.9 s in a 240 s round, which was self-inflicted.
  it('emits at most once per interval no matter how often flush is called', () => {
    const h = harness(true, FLUSH_INTERVAL_MS)
    h.viz.token(tokenInput())
    h.viz.flush() // first flush establishes the baseline and emits
    expect(h.batches).toHaveLength(1)

    // Eight 50 ms ticks = 400 ms, still inside the 500 ms interval:
    // buffered, not emitted.
    for (let i = 0; i < 8; i += 1) {
      h.clock.now += 50
      h.viz.token(tokenInput({ tokenIndex: i }))
      h.viz.flush()
    }
    expect(h.batches).toHaveLength(1)
    expect(h.viz.pending).toBeGreaterThan(0)

    // Crossing the interval releases everything buffered.
    h.clock.now += FLUSH_INTERVAL_MS
    h.viz.flush()
    expect(h.batches).toHaveLength(2)
    expect(h.viz.pending).toBe(0)
  })

  it('force bypasses the interval so teardown never loses records', () => {
    const h = harness(true, FLUSH_INTERVAL_MS)
    h.viz.token(tokenInput())
    h.viz.flush()
    h.clock.now += 10
    h.viz.token(tokenInput({ tokenIndex: 1 }))
    h.viz.flush() // rate-limited
    expect(h.batches).toHaveLength(1)

    h.viz.flush(true)
    expect(h.batches).toHaveLength(2)
    expect(h.viz.pending).toBe(0)
  })

  it('an empty buffer never emits, even when forced', () => {
    const h = harness(true, FLUSH_INTERVAL_MS)
    h.viz.flush(true)
    expect(h.batches).toHaveLength(0)
  })
})

describe('VizForensics reset', () => {
  it('drops buffered records without emitting them', () => {
    const h = harness()
    h.viz.token(tokenInput())
    h.viz.reset()
    h.viz.flush()
    expect(h.batches).toHaveLength(0)
    expect(h.viz.pending).toBe(0)
  })

  it('clears the tick baseline so the next tick cannot fabricate a stall', () => {
    const h = harness()
    h.clock.now += 50
    h.viz.tick(0)
    h.viz.reset()
    // A long real-time gap across the reset must not be reported.
    h.clock.now += 10_000
    h.viz.tick(10_000)
    expect(h.viz.pending).toBe(0)
  })
})
