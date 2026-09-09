/**
 * Call and lead-in placement — the arithmetic the runner schedules by and the
 * manifest generator predicts by.
 *
 * This module exists because those two restated the rule independently and
 * drifted: the runner anchored a section's lead-in to that section's rep-0
 * CALL dispatch, the manifest generator to the section's first STRIKE. They
 * differ by the call's whole lead — about two seconds — so the correlator
 * flagged all three lead-ins of every quick workout as mismatched on drives
 * where the runtime had been exactly right, and twelve workouts were headed
 * for a permanent WARN over a defect in the expectation.
 *
 * The anchor case below is the regression guard for that. It is deliberately
 * written as "a lead-in must NOT be placed against the first strike", because
 * that is the specific wrong answer.
 */
import {
  breathForBar,
  callDispatchAtMs,
  leadInDispatchAtMs,
  BREATH_REF_SLOT_MS,
  BREATH_TRACK_GAIN,
  CALL_DISPATCH_LAG_MS,
  DELIVERED_BREATH_SHORTFALL_MS,
  DENSE_BREATH_MS,
  LEAD_IN_PAD_MS,
  MIN_BREATH_MS,
  TECHNIQUE_LEADIN_LEAD_MS,
  type PlaceableBar,
} from '../callPlacement'

/** A bar of punches at `slotMs` spacing, optionally opening on a rest. */
function bar(offsets: number[], opts: { leadRest?: boolean } = {}): PlaceableBar {
  const tokens = offsets.map(() => ({ kind: 'punch' }))
  const tokenOffsetsMs = [...offsets]
  if (opts.leadRest) {
    tokens.unshift({ kind: 'rest' })
    tokenOffsetsMs.unshift(0)
  }
  return { tokens, tokenOffsetsMs }
}

describe('breathForBar', () => {
  it('gives a dense bar the full tuned breath', () => {
    expect(breathForBar(bar([0, 250, 500, 750]), 'techniques', 'call/x').breathMs).toBe(
      DENSE_BREATH_MS.techniques,
    )
  })

  it('shrinks the breath as the bar widens past the reference slot', () => {
    const { breathMs } = breathForBar(bar([0, 600]), 'numbers', 'call/y')
    expect(breathMs).toBe(DENSE_BREATH_MS.numbers - (600 - BREATH_REF_SLOT_MS))
  })

  it('floors a single-punch bar, which has no interval to track', () => {
    // The floor is the DELIVERED one. A bar with one punch has no interval,
    // so it lands on the clamp — and the clamp now promises 150 ms at the
    // ear rather than 150 ms at the scheduler.
    expect(breathForBar(bar([0]), 'numbers', 'call/z').breathMs).toBe(
      MIN_BREATH_MS + DELIVERED_BREATH_SHORTFALL_MS,
    )
  })

  it('NEVER LATE: every bar in the catalogue range keeps 150 ms at the ear', () => {
    // The guarantee as a property of the arithmetic rather than a number
    // read off a report. The observer's onset is optimistic by
    // DELIVERED_BREATH_SHORTFALL_MS, so the breath the athlete actually hears
    // is `breathMs − shortfall`; that is what must clear MIN_BREATH_MS.
    //
    // Swept across the whole range the maps produce — 100 ms (the tightest
    // dense combo) to 1500 ms (wider than switch-by-round's widest bar at
    // 1412 ms) — in both vocabularies, so a future map that widens a bar
    // cannot walk out of the tested band without widening this sweep first.
    for (const vocabulary of ['numbers', 'techniques'] as const) {
      for (let slotMs = 100; slotMs <= 1500; slotMs += 5) {
        const { breathMs } = breathForBar(bar([0, slotMs]), vocabulary, 'call/sweep')
        expect(breathMs - DELIVERED_BREATH_SHORTFALL_MS).toBeGreaterThanOrEqual(MIN_BREATH_MS)
      }
    }
  })

  it('does not move a single dense bar — the upper clamp is untouched', () => {
    // The other half of the change, and the one that protects Kyle's tuning.
    // Everything at or inside the reference slot must come out at exactly the
    // mic-tuned dense breath; the raised floor may only lift bars that were
    // sitting on it.
    for (const vocabulary of ['numbers', 'techniques'] as const) {
      const dense = DENSE_BREATH_MS[vocabulary]
      for (let slotMs = 100; slotMs <= BREATH_REF_SLOT_MS; slotMs += 5) {
        expect(breathForBar(bar([0, slotMs]), vocabulary, 'call/dense').breathMs).toBe(dense)
      }
      // ...and through the shrink band, until the raised floor takes over at
      // `dense − (slotMs − REF) = MIN + SHORTFALL`, i.e. slotMs 655 / 805.
      const bites = BREATH_REF_SLOT_MS + (dense - (MIN_BREATH_MS + DELIVERED_BREATH_SHORTFALL_MS)) / BREATH_TRACK_GAIN
      expect(breathForBar(bar([0, bites - 5]), vocabulary, 'call/track').breathMs).toBe(
        dense - (bites - 5 - BREATH_REF_SLOT_MS),
      )
      expect(breathForBar(bar([0, bites + 5]), vocabulary, 'call/track').breathMs).toBe(
        MIN_BREATH_MS + DELIVERED_BREATH_SHORTFALL_MS,
      )
    }
  })

  it('anchors to the first PUNCH, not the bar start — a bar may open on a rest', () => {
    expect(breathForBar(bar([600, 1200], { leadRest: true }), 'numbers', 'call/r').firstPunchOffsetMs).toBe(600)
  })
})

describe('callDispatchAtMs', () => {
  it('places the clip to finish a breath before the first punch, then pays the dispatch lag', () => {
    const cue = bar([0, 250, 500, 750])
    const placed = callDispatchAtMs({
      cue,
      scheduledStartMs: 10_000,
      vocabulary: 'numbers',
      slot: 'call/1-2-3-4',
      clipDurationMs: 1_400,
    })
    expect(placed.firstNodeMs).toBe(10_000)
    expect(placed.breathMs).toBe(DENSE_BREATH_MS.numbers)
    // 10000 − 1400 − 600 − 71
    expect(placed.dispatchAtMs).toBe(10_000 - 1_400 - DENSE_BREATH_MS.numbers - CALL_DISPATCH_LAG_MS)
  })

  it('never goes negative at the very top of a round', () => {
    expect(
      callDispatchAtMs({
        cue: bar([0, 250]),
        scheduledStartMs: 100,
        vocabulary: 'numbers',
        slot: 'call/1-2',
        clipDurationMs: 2_000,
      }).dispatchAtMs,
    ).toBe(0)
  })
})

describe('leadInDispatchAtMs — the anchor that drifted', () => {
  const cue = bar([0, 250, 500, 750])
  const SECTION_START = 60_000
  const CALL_CLIP_MS = 1_400
  const LEAD_CLIP_MS = 8_000

  const rep0 = callDispatchAtMs({
    cue,
    scheduledStartMs: SECTION_START,
    vocabulary: 'numbers',
    slot: 'call/1-2-3-4',
    clipDurationMs: CALL_CLIP_MS,
  })

  it('ends before the section OPENING CALL, not before the first strike', () => {
    const placed = leadInDispatchAtMs({
      rep0CallDispatchAtMs: rep0.dispatchAtMs,
      scheduledStartMs: SECTION_START,
      clipDurationMs: LEAD_CLIP_MS,
      vocabulary: 'numbers',
    })
    expect(placed.endByMs).toBe(rep0.dispatchAtMs)
    expect(placed.dispatchAtMs).toBe(rep0.dispatchAtMs - LEAD_CLIP_MS - LEAD_IN_PAD_MS)

    // The wrong answer, spelled out: anchoring to the strike would place it
    // this much later — the ~2 s that made every quick workout report WARN.
    const anchoredToStrike = SECTION_START - LEAD_CLIP_MS - LEAD_IN_PAD_MS
    expect(placed.dispatchAtMs).toBeLessThan(anchoredToStrike)
    expect(anchoredToStrike - placed.dispatchAtMs).toBe(CALL_CLIP_MS + DENSE_BREATH_MS.numbers + CALL_DISPATCH_LAG_MS)
  })

  it('falls back to the first strike only when the section has no rep-0 call', () => {
    const placed = leadInDispatchAtMs({
      scheduledStartMs: SECTION_START,
      clipDurationMs: LEAD_CLIP_MS,
      vocabulary: 'numbers',
    })
    expect(placed.endByMs).toBe(SECTION_START)
    expect(placed.dispatchAtMs).toBe(SECTION_START - LEAD_CLIP_MS - LEAD_IN_PAD_MS)
  })

  it('techniques lead-ins carry their extra lead; numbers carry none', () => {
    const shared = { rep0CallDispatchAtMs: rep0.dispatchAtMs, scheduledStartMs: SECTION_START, clipDurationMs: LEAD_CLIP_MS }
    const numbers = leadInDispatchAtMs({ ...shared, vocabulary: 'numbers' })
    const techniques = leadInDispatchAtMs({ ...shared, vocabulary: 'techniques' })
    expect(numbers.dispatchAtMs - techniques.dispatchAtMs).toBe(TECHNIQUE_LEADIN_LEAD_MS)
  })
})
