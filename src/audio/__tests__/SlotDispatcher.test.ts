/**
 * SlotDispatcher — the score-authoritative coach dispatcher
 * (M39-V2 W1 Epic Slice 3-a-i).
 *
 * These pin the invariants Slice 3-a-ii will wire the runtime
 * against + the design promises the epic makes on the queue:
 *
 *  - APPEND-only queue (`enqueue` never truncates in-flight or
 *    pending slots — this is the direct fix for the 2026-08-30
 *    regression).
 *  - Latency-compensated dispatch (`dispatchAt =
 *    reservationStartTick - latencyTicks`).
 *  - Idempotency (a slotId dispatches exactly once).
 *  - Vocabulary picked at dispatch time (freshly, so a mid-run
 *    switch takes effect on the next slot).
 *  - Missing-variant fallback then throw (no silent mode
 *    fallback — principle #11).
 *  - Late dispatch fires (silence would be worse than lateness
 *    for the athlete).
 *  - `clear()` drops everything (workout-end semantic — never
 *    per-cue).
 */

import { SlotDispatcher } from '../SlotDispatcher'
import type {
  CompiledCoachSlot,
  CompiledCoachVariant,
} from '@/domain/programs/workoutScore'

function variant(
  vocab: 'numeric' | 'technique',
  overrides: Partial<CompiledCoachVariant> = {},
): CompiledCoachVariant {
  return {
    vocabulary: vocab,
    assetId: `asset:${vocab}:${overrides.assetId ?? 'default'}`,
    measuredDurationTicks: 240,
    audibleStartTick: 0,
    audibleEndTick: 240,
    taughtStrikeAnchors: [],
    capabilities: {
      allowedRelations: ['precall', 'synchronized', 'shared-block'],
    },
    ...overrides,
  }
}

function slot(overrides: Partial<CompiledCoachSlot> = {}): CompiledCoachSlot {
  return {
    slotId: overrides.slotId ?? 'slot:1',
    cueId: overrides.cueId ?? 'cue-1',
    repId: overrides.repId ?? 'rep-0',
    roundIndex: overrides.roundIndex ?? 0,
    contentKind: overrides.contentKind ?? 'combo-announce',
    relation: overrides.relation ?? 'precall',
    strikeEventIds: overrides.strikeEventIds ?? ['strike:0'],
    desiredAudibleEndTick: overrides.desiredAudibleEndTick ?? 240,
    reservationStartTick: overrides.reservationStartTick ?? 1000,
    reservationEndTick: overrides.reservationEndTick ?? 1240,
    vocabLockAtTick: overrides.vocabLockAtTick ?? 700,
    variants: overrides.variants ?? {
      numeric: variant('numeric'),
      technique: variant('technique'),
    },
  }
}

function makeSpy() {
  const calls: Array<{ assetId: string; atTick: number; slotId: string }> = []
  const play = (assetId: string, atTick: number, slotId: string) => {
    calls.push({ assetId, atTick, slotId })
  }
  return { play, calls }
}

// ---------------------------------------------------------------------------
// Enqueue + queue ordering
// ---------------------------------------------------------------------------

describe('SlotDispatcher — enqueue + ordering', () => {
  it('starts empty and reports pendingCount = 0', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    expect(d.getPendingCount()).toBe(0)
  })

  it('enqueue adds slots and pendingCount reflects it', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 100 }))
    d.enqueue(slot({ slotId: 's2', reservationStartTick: 200 }))
    expect(d.getPendingCount()).toBe(2)
  })

  it('enqueue is idempotent — a duplicate slotId is dropped', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1' }))
    d.enqueue(slot({ slotId: 's1' }))
    expect(d.getPendingCount()).toBe(1)
  })

  it('enqueueAll takes a readonly array of slots', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueueAll([
      slot({ slotId: 's1', reservationStartTick: 100 }),
      slot({ slotId: 's2', reservationStartTick: 200 }),
    ])
    expect(d.getPendingCount()).toBe(2)
  })

  it('dispatches slots in reservationStartTick order regardless of enqueue order', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's3', reservationStartTick: 300 }))
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 100 }))
    d.enqueue(slot({ slotId: 's2', reservationStartTick: 200 }))
    d.advance(500)
    expect(spy.calls.map((c) => c.slotId)).toEqual(['s1', 's2', 's3'])
  })
})

// ---------------------------------------------------------------------------
// Dispatch timing + latency compensation
// ---------------------------------------------------------------------------

describe('SlotDispatcher — dispatch timing', () => {
  it('does not dispatch a slot before its dispatchAtTick', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 1000 }))
    d.advance(500)
    expect(spy.calls).toHaveLength(0)
    expect(d.getPendingCount()).toBe(1)
  })

  it('dispatches exactly at dispatchAtTick', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 1000 }))
    d.advance(1000)
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0]!.atTick).toBe(1000)
  })

  it('fires LATE rather than dropping (silence is worse than lateness)', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 1000 }))
    d.advance(5000) // way past dispatchAt
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0]!.slotId).toBe('s1')
  })

  it('subtracts latencyTicks from dispatch moment', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({
      play: spy.play,
      getCurrentVocabulary: () => 'numeric',
      latencyTicks: 100,
    })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 1000 }))
    // At tick 899, still 1 tick before dispatchAt (1000 - 100 = 900).
    d.advance(899)
    expect(spy.calls).toHaveLength(0)
    // At tick 900, fires — 100 ticks before reservation start.
    d.advance(900)
    expect(spy.calls).toHaveLength(1)
    // The atTick reported to `play` is the SEMANTIC reservation
    // start (what the athlete should hear at), not the dispatch
    // moment (what `advance` fired at).
    expect(spy.calls[0]!.atTick).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('SlotDispatcher — idempotency', () => {
  it('a slot dispatches exactly once even across many advance calls', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 100 }))
    d.advance(200)
    d.advance(300)
    d.advance(400)
    expect(spy.calls).toHaveLength(1)
    expect(d.hasDispatched('s1')).toBe(true)
  })

  it('re-enqueuing an already-dispatched slotId is a no-op', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 100 }))
    d.advance(200)
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 300 }))
    d.advance(400)
    expect(spy.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Vocabulary selection at dispatch time
// ---------------------------------------------------------------------------

describe('SlotDispatcher — vocabulary at dispatch time', () => {
  it('plays the numeric asset when current vocab is numeric', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(
      slot({
        slotId: 's1',
        reservationStartTick: 100,
        variants: {
          numeric: variant('numeric', { assetId: 'asset:numeric:one' }),
          technique: variant('technique', { assetId: 'asset:technique:jab' }),
        },
      }),
    )
    d.advance(200)
    expect(spy.calls[0]!.assetId).toBe('asset:numeric:one')
  })

  it('plays the technique asset when current vocab is technique', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'technique' })
    d.enqueue(
      slot({
        slotId: 's1',
        reservationStartTick: 100,
        variants: {
          numeric: variant('numeric', { assetId: 'asset:numeric:one' }),
          technique: variant('technique', { assetId: 'asset:technique:jab' }),
        },
      }),
    )
    d.advance(200)
    expect(spy.calls[0]!.assetId).toBe('asset:technique:jab')
  })

  it('picks the current vocab FRESHLY on each dispatch (mid-run switch affects next slot)', () => {
    const spy = makeSpy()
    let currentVocab: 'numeric' | 'technique' = 'numeric'
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => currentVocab })
    d.enqueue(
      slot({
        slotId: 's1',
        reservationStartTick: 100,
        variants: {
          numeric: variant('numeric', { assetId: 'asset:numeric:one' }),
          technique: variant('technique', { assetId: 'asset:technique:jab' }),
        },
      }),
    )
    d.enqueue(
      slot({
        slotId: 's2',
        reservationStartTick: 200,
        variants: {
          numeric: variant('numeric', { assetId: 'asset:numeric:two' }),
          technique: variant('technique', { assetId: 'asset:technique:cross' }),
        },
      }),
    )
    d.advance(150) // fires s1 as numeric
    currentVocab = 'technique'
    d.advance(250) // fires s2 as technique
    expect(spy.calls.map((c) => c.assetId)).toEqual([
      'asset:numeric:one',
      'asset:technique:cross',
    ])
  })

  it('falls back to the OTHER variant when the picked vocab has none', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(
      slot({
        slotId: 's1',
        reservationStartTick: 100,
        variants: { technique: variant('technique', { assetId: 'asset:technique:jab' }) },
      }),
    )
    d.advance(200)
    expect(spy.calls[0]!.assetId).toBe('asset:technique:jab')
  })

  it('THROWS when the slot has no variant at all (principle #11 — no silent fallback)', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 100, variants: {} }))
    expect(() => d.advance(200)).toThrow(/no variant to dispatch/)
  })
})

// ---------------------------------------------------------------------------
// Append-only queue (the 2026-08-30 regression fix)
// ---------------------------------------------------------------------------

describe('SlotDispatcher — APPEND-ONLY queue (the regression fix)', () => {
  it('enqueuing a NEW cue after a prior cue does not truncate the prior queue', () => {
    // Under the old playSequence path, cue B's fresh playPhrase
    // called clearSequence() which truncated cue A's pending clips
    // — the exact 2026-08-30 regression. The SlotDispatcher's
    // enqueue APPENDS to a single global queue; nothing truncates.
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    // Cue A: 3 slots at ticks 100, 200, 300
    d.enqueueAll([
      slot({ slotId: 'A:1', reservationStartTick: 100 }),
      slot({ slotId: 'A:2', reservationStartTick: 200 }),
      slot({ slotId: 'A:3', reservationStartTick: 300 }),
    ])
    // Cue B: 2 slots at ticks 400, 500 (later than A's queue)
    d.enqueueAll([
      slot({ slotId: 'B:1', reservationStartTick: 400 }),
      slot({ slotId: 'B:2', reservationStartTick: 500 }),
    ])
    d.advance(1000)
    // ALL 5 slots dispatched — cue B's arrival did NOT wipe A.
    expect(spy.calls.map((c) => c.slotId)).toEqual(['A:1', 'A:2', 'A:3', 'B:1', 'B:2'])
  })

  it('slots interleaved by reservationStartTick fire in tick order', () => {
    // Cue A + cue B enqueued together, cue A's later slots interleave
    // with cue B's earlier slots.
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 'A:1', reservationStartTick: 100 }))
    d.enqueue(slot({ slotId: 'B:1', reservationStartTick: 150 }))
    d.enqueue(slot({ slotId: 'A:2', reservationStartTick: 200 }))
    d.enqueue(slot({ slotId: 'B:2', reservationStartTick: 250 }))
    d.advance(1000)
    expect(spy.calls.map((c) => c.slotId)).toEqual(['A:1', 'B:1', 'A:2', 'B:2'])
  })
})

// ---------------------------------------------------------------------------
// clear() — workout-end semantic
// ---------------------------------------------------------------------------

describe('SlotDispatcher — clear', () => {
  it('drops all pending slots + resets dispatched set', () => {
    const spy = makeSpy()
    const d = new SlotDispatcher({ play: spy.play, getCurrentVocabulary: () => 'numeric' })
    d.enqueueAll([
      slot({ slotId: 's1', reservationStartTick: 100 }),
      slot({ slotId: 's2', reservationStartTick: 200 }),
      slot({ slotId: 's3', reservationStartTick: 300 }),
    ])
    d.advance(150) // fires s1 only
    expect(spy.calls).toHaveLength(1)

    d.clear()
    expect(d.getPendingCount()).toBe(0)
    expect(d.hasDispatched('s1')).toBe(false)

    // After clear, re-enqueuing s1 with a fresh reservation
    // works — the dispatched set was reset for the new workout.
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 400 }))
    d.advance(500)
    expect(spy.calls).toHaveLength(2)
    expect(spy.calls.at(-1)!.slotId).toBe('s1')
  })
})

// ---------------------------------------------------------------------------
// Error propagation from play()
// ---------------------------------------------------------------------------

describe('SlotDispatcher — play() errors', () => {
  it('propagates a throw from play() and marks the slot dispatched (no re-queue)', () => {
    const rogue = (): void => {
      throw new Error('player refused')
    }
    const d = new SlotDispatcher({ play: rogue, getCurrentVocabulary: () => 'numeric' })
    d.enqueue(slot({ slotId: 's1', reservationStartTick: 100 }))
    expect(() => d.advance(200)).toThrow(/player refused/)
    // The slot is CONSIDERED dispatched — a next advance won't
    // try it again. The runner surfaces the error separately.
    expect(d.hasDispatched('s1')).toBe(true)
    expect(d.getPendingCount()).toBe(0)
  })
})
