/**
 * FrameBuffer — batching, latency, retry and overflow behaviour.
 *
 * These pin the guarantees the persist-before-parse rule depends on: a frame
 * that fails to write is retried rather than lost, and the only path that ever
 * discards data is the explicit overflow valve, which reports itself.
 *
 * Pure logic — no SQLite, no Bluetooth, runs on Windows (§21).
 */

import { FrameBuffer } from '../FrameBuffer'

interface Item {
  n: number
}

const item = (n: number): Item => ({ n })

describe('FrameBuffer', () => {
  it('does not flush before the batch size is reached', async () => {
    const flushed: Item[][] = []
    const buf = new FrameBuffer<Item>({
      batchSize: 3,
      maxLatencyMs: 1000,
      maxBuffered: 100,
      flush: async (items) => {
        flushed.push(items)
      },
      now: () => 0,
    })

    buf.add(item(1))
    buf.add(item(2))
    await Promise.resolve()

    expect(flushed).toHaveLength(0)
    expect(buf.pendingCount()).toBe(2)
  })

  it('flushes automatically once the batch size is reached', async () => {
    const flushed: Item[][] = []
    const buf = new FrameBuffer<Item>({
      batchSize: 3,
      maxLatencyMs: 1000,
      maxBuffered: 100,
      flush: async (items) => {
        flushed.push(items)
      },
      now: () => 0,
    })

    buf.add(item(1))
    buf.add(item(2))
    buf.add(item(3))
    await buf.flushNow()

    expect(flushed).toHaveLength(1)
    expect(flushed[0]!.map((i) => i.n)).toEqual([1, 2, 3])
    expect(buf.pendingCount()).toBe(0)
  })

  it('flushes on the latency bound even when the batch is not full', async () => {
    const flushed: Item[][] = []
    let clock = 0
    const buf = new FrameBuffer<Item>({
      batchSize: 50,
      maxLatencyMs: 1000,
      maxBuffered: 100,
      flush: async (items) => {
        flushed.push(items)
      },
      now: () => clock,
    })

    buf.add(item(1))

    clock = 999
    buf.tick()
    await Promise.resolve()
    expect(flushed).toHaveLength(0) // not old enough yet

    clock = 1000
    buf.tick()
    await Promise.resolve()
    await Promise.resolve()

    expect(flushed).toHaveLength(1)
    expect(flushed[0]!.map((i) => i.n)).toEqual([1])
  })

  it('requeues a failed batch at the FRONT so ordering survives the retry', async () => {
    const attempts: number[][] = []
    let failNext = true
    const buf = new FrameBuffer<Item>({
      batchSize: 2,
      maxLatencyMs: 1000,
      maxBuffered: 100,
      flush: async (items) => {
        attempts.push(items.map((i) => i.n))
        if (failNext) {
          failNext = false
          throw new Error('disk on fire')
        }
      },
      now: () => 0,
    })

    buf.add(item(1))
    buf.add(item(2))
    await buf.flushNow()

    // First attempt failed — nothing lost, both items are back in the buffer.
    expect(attempts).toEqual([[1, 2]])
    expect(buf.pendingCount()).toBe(2)

    // Later arrivals must not jump ahead of the retried ones.
    buf.add(item(3))
    await buf.flushNow()

    expect(attempts[1]).toEqual([1, 2, 3])
    expect(buf.pendingCount()).toBe(0)
  })

  it('reports a flush failure through onFlushError without throwing', async () => {
    const errors: Array<{ requeued: number }> = []
    const buf = new FrameBuffer<Item>({
      batchSize: 1,
      maxLatencyMs: 1000,
      maxBuffered: 100,
      flush: async () => {
        throw new Error('nope')
      },
      now: () => 0,
      onFlushError: (_e, requeued) => errors.push({ requeued }),
    })

    buf.add(item(1))
    await expect(buf.flushNow()).resolves.toBeUndefined()
    expect(errors).toEqual([{ requeued: 1 }])
  })

  it('drops the OLDEST items when the hard cap is exceeded, and reports it', () => {
    const drops: Array<{ n: number; total: number }> = []
    const buf = new FrameBuffer<Item>({
      batchSize: 1000, // never auto-flush during this test
      maxLatencyMs: 1_000_000,
      maxBuffered: 3,
      flush: async () => {},
      now: () => 0,
      onDrop: (n, total) => drops.push({ n, total }),
    })

    for (let i = 1; i <= 5; i++) buf.add(item(i))

    expect(buf.pendingCount()).toBe(3)
    expect(buf.droppedCount()).toBe(2)
    expect(drops).toEqual([
      { n: 1, total: 1 },
      { n: 1, total: 2 },
    ])
  })

  it('coalesces concurrent flushes instead of double-writing a batch', async () => {
    const flushed: Item[][] = []
    // Held in an object because TS narrows a reassigned `let` captured in a
    // promise executor down to `never` at the call site.
    const gate: { release: (() => void) | null } = { release: null }
    const buf = new FrameBuffer<Item>({
      batchSize: 100,
      maxLatencyMs: 1000,
      maxBuffered: 100,
      flush: async (items) => {
        flushed.push(items)
        await new Promise<void>((r) => {
          gate.release = r
        })
      },
      now: () => 0,
    })

    buf.add(item(1))
    const first = buf.flushNow()
    const second = buf.flushNow() // must be a no-op while the first is in flight

    await second
    expect(flushed).toHaveLength(1)

    gate.release?.()
    await first
    expect(flushed).toHaveLength(1)
  })

  it('drain() stops retrying when it stops making progress', async () => {
    let calls = 0
    const buf = new FrameBuffer<Item>({
      batchSize: 100,
      maxLatencyMs: 1000,
      maxBuffered: 100,
      flush: async () => {
        calls++
        throw new Error('permanently broken')
      },
      now: () => 0,
    })

    buf.add(item(1))
    await buf.drain(5)

    // One attempt, then it detects no progress and gives up rather than
    // spinning. The item is still buffered, not silently discarded.
    expect(calls).toBe(1)
    expect(buf.pendingCount()).toBe(1)
  })
})
