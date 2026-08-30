/**
 * The Timing Engine contract (Kyle's spec, 2026-08-30).
 *
 * The numbers in these tests are the spec, verbatim: 60 BPM base gives
 * 1,000 ms beats; divisions 1/2/3/4 give 60/120/180/240 call slots per
 * minute at intervals 1000/500/333.33/250 ms; swing keeps the master
 * beat EXACTLY intact while moving only internal positions; density is
 * separate from rate; acceptance windows widen on the fast grids.
 */
import {
  authoringStepAt,
  AUTHORING_STEPS_PER_PULSE,
  beatDurationMs,
  callSlotDurationMs,
  callSlotsPerMinute,
  combinationDurationMs,
  density,
  msAtTick,
  plannedPacePerMinute,
  scheduleCombination,
  stepOffsetMs,
  SWING_EVEN,
  SWING_ROLLING,
  SWING_SINGSONG,
  tickAt,
  tickAtAuthoringStep,
  tickDurationMs,
  TICKS_PER_AUTHORING_STEP,
  ticksPerUnit,
  TRANSPORT_TICKS_PER_PULSE,
  type BeatDivision,
  type CoachTempo,
  type RhythmicCombination,
  type VoicePolicy,
} from '../TimingEngine'
import {
  ACCEPT_FROM_MS,
  ACCEPT_UNTIL_BASE_MS,
  acceptUntilMsFor,
  EXPECTED_STRIKE_DELAY_MS,
} from '../acceptance'

const tempo = (division: BeatDivision, swing = SWING_EVEN): CoachTempo => ({
  baseBpm: 60,
  division,
  swing,
})

describe('the master pulse', () => {
  it('is 1,000 ms per beat at 60 BPM', () => {
    expect(beatDurationMs(60)).toBe(1_000)
  })

  it('scales with the base BPM (the future speed slider)', () => {
    expect(beatDurationMs(90)).toBeCloseTo(666.667, 2)
    expect(beatDurationMs(45)).toBeCloseTo(1333.333, 2)
  })

  it('rejects a non-positive or non-finite base', () => {
    expect(() => beatDurationMs(0)).toThrow('positive')
    expect(() => beatDurationMs(-60)).toThrow('positive')
    expect(() => beatDurationMs(Number.NaN)).toThrow('positive')
  })
})

describe('the cadence grid (spec table, verbatim)', () => {
  it.each([
    [1, 1_000, 60],
    [2, 500, 120],
    [3, 333.33, 180],
    [4, 250, 240],
  ] as Array<[BeatDivision, number, number]>)(
    'division %i → %s ms interval, %i call slots/min',
    (division, intervalMs, slotsPerMin) => {
      const t = tempo(division)
      expect(callSlotDurationMs(t)).toBeCloseTo(intervalMs, 1)
      expect(callSlotsPerMinute(t)).toBe(slotsPerMin)
    },
  )
})

describe('stepOffsetMs — straight grids', () => {
  it('division 1: one call per beat', () => {
    const t = tempo(1)
    expect([0, 1, 2, 3].map((s) => stepOffsetMs(s, t))).toEqual([0, 1_000, 2_000, 3_000])
  })

  it('division 2 even: two calls per beat', () => {
    const t = tempo(2)
    expect([0, 1, 2, 3].map((s) => stepOffsetMs(s, t))).toEqual([0, 500, 1_000, 1_500])
  })

  it('division 3: straight triplets, never swung', () => {
    // Kyle's spec applies swing at divisions 2 and 4 only; triplets
    // stay straight even when the tempo carries a swing value.
    const t = tempo(3, SWING_SINGSONG)
    const offsets = [0, 1, 2, 3].map((s) => stepOffsetMs(s, t))
    expect(offsets[0]).toBe(0)
    expect(offsets[1]).toBeCloseTo(333.333, 2)
    expect(offsets[2]).toBeCloseTo(666.667, 2)
    expect(offsets[3]).toBeCloseTo(1_000, 5)
  })

  it('division 4 even: four calls per beat', () => {
    const t = tempo(4)
    expect([0, 1, 2, 3, 4].map((s) => stepOffsetMs(s, t))).toEqual([0, 250, 500, 750, 1_000])
  })
})

describe('stepOffsetMs — swing (spec examples, verbatim)', () => {
  it('56% swing at division 2: 0 → 560 → 1000', () => {
    const t = tempo(2, 0.56)
    expect(stepOffsetMs(0, t)).toBe(0)
    expect(stepOffsetMs(1, t)).toBeCloseTo(560, 5)
    expect(stepOffsetMs(2, t)).toBe(1_000)
  })

  it('56% swing at division 4: 0, 280, 500, 780, 1000', () => {
    const t = tempo(4, 0.56)
    expect([0, 1, 2, 3, 4].map((s) => stepOffsetMs(s, t))).toEqual([0, 280, 500, 780, 1_000])
  })

  it('the master beat is untouched by swing — downbeats stay on the pulse', () => {
    for (const division of [2, 4] as const) {
      for (const swing of [SWING_EVEN, SWING_ROLLING, SWING_SINGSONG, 0.58]) {
        const t = tempo(division, swing)
        // Steps that land on whole beats never move.
        expect(stepOffsetMs(0, t)).toBe(0)
        expect(stepOffsetMs(division, t)).toBeCloseTo(1_000, 5)
        expect(stepOffsetMs(division * 2, t)).toBeCloseTo(2_000, 5)
      }
    }
  })

  it('rejects a negative or fractional step', () => {
    expect(() => stepOffsetMs(-1, tempo(2))).toThrow('non-negative')
    expect(() => stepOffsetMs(1.5, tempo(2))).toThrow('non-negative')
  })
})

describe('density is separate from rate (spec table)', () => {
  const combo = (
    division: BeatDivision,
    totalSteps: number,
    punchSteps: number[],
  ): RhythmicCombination => ({
    id: 'test',
    tokens: punchSteps.map(() => '1'),
    tempo: tempo(division),
    totalSteps,
    punches: punchSteps.map((step) => ({ token: '1', step, accent: 1 })),
    repeatCount: 1,
  })

  it.each([
    // grid slots/min, occupancy fraction, planned pace
    [2, 4, [0, 1], 60], // 120 slots/min × 50% = 60
    [2, 4, [0, 1, 2], 90], // 120 × 75% = 90
    [4, 4, [0, 1], 120], // 240 × 50% = 120
    [4, 8, [0, 1, 2, 3, 6, 7], 180], // 240 × 75% = 180
  ] as Array<[BeatDivision, number, number[], number]>)(
    'division %i, %i steps, punches at %j → %i punches/min',
    (division, totalSteps, steps, pace) => {
      expect(plannedPacePerMinute(combo(division, totalSteps, steps))).toBeCloseTo(pace, 5)
    },
  )

  it('a sparse sprint grid feels fast but plans a human pace', () => {
    // Kyle's example: "1 2 - - 1 2 - -" on the 240-slot grid = 120/min.
    const sparse = combo(4, 8, [0, 1, 4, 5])
    expect(density(sparse)).toBe(0.5)
    expect(plannedPacePerMinute(sparse)).toBe(120)
  })

  it('rejects a combination that allocates no steps', () => {
    expect(() => density(combo(2, 0, []))).toThrow('no steps')
  })
})

describe('scheduleCombination — one grid time drives every consumer', () => {
  const oneTwoThreeTwoSprint: RhythmicCombination = {
    id: '1-2-3-2-sprint',
    tokens: ['1', '2', '3', '2'],
    tempo: { baseBpm: 60, division: 4, swing: 0.54 },
    totalSteps: 4,
    punches: [
      { token: '1', step: 0, accent: 0.72 },
      { token: '2', step: 1, accent: 0.9 },
      { token: '3', step: 2, accent: 0.78 },
      { token: '2', step: 3, accent: 1.0 },
    ],
    repeatCount: 1,
  }

  it('fits the whole sprint combination inside one master beat', () => {
    expect(combinationDurationMs(oneTwoThreeTwoSprint)).toBe(1_000)
  })

  it('derives spoken/visual/strike/accept times from ONE grid time', () => {
    const [first] = scheduleCombination(oneTwoThreeTwoSprint, 10_000)
    expect(first).toBeDefined()
    expect(first!.spokenAtMs).toBe(10_000)
    expect(first!.visualAtMs).toBe(10_000)
    expect(first!.expectedStrikeAtMs).toBe(10_000 + EXPECTED_STRIKE_DELAY_MS)
    expect(first!.acceptFromMs).toBe(10_000 + ACCEPT_FROM_MS)
    expect(first!.acceptUntilMs).toBe(10_000 + acceptUntilMsFor(4))
  })

  it('applies the swing to the scheduled positions', () => {
    const times = scheduleCombination(oneTwoThreeTwoSprint, 0).map((p) => p.visualAtMs)
    // Division 4 at swing 0.54: 0, 270, 500, 770.
    expect(times).toEqual([0, 270, 500, 770])
  })

  it('honours syncopation — an empty step simply is not scheduled', () => {
    const delayedFinish: RhythmicCombination = {
      id: '1-2-3-delayed-2',
      tokens: ['1', '2', '3', '2'],
      tempo: { baseBpm: 60, division: 4, swing: SWING_EVEN },
      totalSteps: 6,
      punches: [
        { token: '1', step: 0, accent: 0.72 },
        { token: '2', step: 1, accent: 0.88 },
        { token: '3', step: 2, accent: 0.82 },
        // Step 3 intentionally remains empty.
        { token: '2', step: 4, accent: 1.0 },
      ],
      repeatCount: 1,
    }
    const times = scheduleCombination(delayedFinish, 0).map((p) => p.visualAtMs)
    expect(times).toEqual([0, 250, 500, 1_000])
    expect(times).not.toContain(750)
  })

  it('lays repeats back to back, one grid duration apart', () => {
    const twice = { ...oneTwoThreeTwoSprint, repeatCount: 2 }
    const times = scheduleCombination(twice, 0).map((p) => p.visualAtMs)
    expect(times.slice(0, 4)).toEqual([0, 270, 500, 770])
    expect(times.slice(4)).toEqual([1_000, 1_270, 1_500, 1_770])
  })
})

describe('voice policy — decoupled from ring cadence (M39 addendum)', () => {
  const withPolicy = (voicePolicy: VoicePolicy | undefined): RhythmicCombination => ({
    id: 't',
    tokens: ['1'],
    tempo: { baseBpm: 60, division: 2, swing: SWING_EVEN },
    totalSteps: 2,
    punches: [{ token: '1', step: 0, accent: 1 }],
    repeatCount: 1,
    voicePolicy,
  })

  it('is optional — an absent policy leaves the runtime to pick the default', () => {
    expect(withPolicy(undefined).voicePolicy).toBeUndefined()
  })

  it('scheduleCombination does not care about the policy — grid times unchanged', () => {
    // The engine only carries the tag; when the voice fires is a
    // runtime consumer decision. Two policies produce identical
    // ScheduledPunch arrays for the same combination shape.
    const a = scheduleCombination(withPolicy('per-punch'), 0)
    const b = scheduleCombination(withPolicy('announce-then-work'), 0)
    expect(a).toEqual(b)
  })

  it('accepts every documented policy value', () => {
    for (const p of [
      'per-punch',
      'per-rep',
      'announce-then-work',
      'announce-with-affirmations',
    ] as const) {
      expect(withPolicy(p).voicePolicy).toBe(p)
    }
  })
})

// ---------------------------------------------------------------------------
// M39-V2 Phase 1' (Kyle amendments): 960 PPQN transport with a simple
// 12-step authoring surface. TRANSPORT_TICKS_PER_PULSE gives ms-precision
// for fit-checks + coach-lane grace; AUTHORING_STEPS_PER_PULSE stays the
// combo-author-facing grid. compileCue lowers steps → ticks at compile
// time via tickAtAuthoringStep.
// ---------------------------------------------------------------------------

describe('tick grid — TRANSPORT_TICKS_PER_PULSE + AUTHORING_STEPS_PER_PULSE', () => {
  it('TRANSPORT_TICKS_PER_PULSE is 960 (ms-precision at 60 BPM)', () => {
    expect(TRANSPORT_TICKS_PER_PULSE).toBe(960)
  })

  it('AUTHORING_STEPS_PER_PULSE is 12 (divisible by every supported division)', () => {
    expect(AUTHORING_STEPS_PER_PULSE).toBe(12)
  })

  it('TICKS_PER_AUTHORING_STEP is 80 (960 / 12)', () => {
    expect(TICKS_PER_AUTHORING_STEP).toBe(80)
  })

  it('ticksPerUnit(division) is an integer at every division', () => {
    // 960 / division → 960 / 480 / 320 / 240
    expect(ticksPerUnit(1)).toBe(960)
    expect(ticksPerUnit(2)).toBe(480)
    expect(ticksPerUnit(3)).toBe(320)
    expect(ticksPerUnit(4)).toBe(240)
  })

  it('rejects a division outside 1..4', () => {
    // Runtime coverage — the type gate blocks it at compile time,
    // but callers may cast through `any` from JS layers.
    expect(() => ticksPerUnit(5 as unknown as BeatDivision)).toThrow()
    expect(() => ticksPerUnit(0 as unknown as BeatDivision)).toThrow()
  })
})

describe('tickAtAuthoringStep / authoringStepAt', () => {
  it('lowers an authored step to its transport tick (×80)', () => {
    expect(tickAtAuthoringStep(0)).toBe(0)
    expect(tickAtAuthoringStep(1)).toBe(80)
    expect(tickAtAuthoringStep(3)).toBe(240) // one sprint slot
    expect(tickAtAuthoringStep(6)).toBe(480) // one flow slot
    expect(tickAtAuthoringStep(12)).toBe(960) // one full pulse
  })

  it('is the inverse of authoringStepAt', () => {
    for (const step of [0, 1, 3, 6, 12, 33]) {
      expect(authoringStepAt(tickAtAuthoringStep(step))).toBeCloseTo(step, 10)
    }
  })
})

describe('tickDurationMs + tickAt + msAtTick', () => {
  it('60 BPM → 1000/960 ≈ 1.0417 ms per tick', () => {
    expect(tickDurationMs(60)).toBeCloseTo(1000 / 960, 8)
  })

  it('120 BPM → half the tick duration', () => {
    expect(tickDurationMs(120)).toBeCloseTo(tickDurationMs(60) / 2, 8)
  })

  it('tickAt(1000 ms, 60 BPM) → 960 ticks (one pulse)', () => {
    expect(tickAt(1_000, 60)).toBeCloseTo(960, 5)
  })

  it('msAtTick and tickAt are inverses', () => {
    for (const bpm of [60, 120, 180, 240]) {
      for (const tick of [0, 1, 80, 240, 960, 26_666]) {
        const ms = msAtTick(tick, bpm)
        expect(tickAt(ms, bpm)).toBeCloseTo(tick, 5)
      }
    }
  })

  it('tickDurationMs rejects non-positive bpm', () => {
    expect(() => tickDurationMs(0)).toThrow()
    expect(() => tickDurationMs(-1)).toThrow()
    expect(() => tickDurationMs(NaN)).toThrow()
  })
})

describe('acceptance windows', () => {
  it('slower grids keep the base close', () => {
    expect(acceptUntilMsFor(1)).toBe(ACCEPT_UNTIL_BASE_MS)
    expect(acceptUntilMsFor(2)).toBe(ACCEPT_UNTIL_BASE_MS)
  })

  it('the fast grids widen so reaction delay never reads as late', () => {
    expect(acceptUntilMsFor(3)).toBeGreaterThan(ACCEPT_UNTIL_BASE_MS)
    expect(acceptUntilMsFor(4)).toBeGreaterThan(acceptUntilMsFor(3))
  })
})
