/**
 * Grid-target math for the phrase render pipeline (M39-V1c fit-check).
 *
 * Two things pinned here:
 *
 * 1. **The formula is correct.** `gridDurationMs` produces the exact
 *    ms values Kyle's spec table names (technical = 3s for a 3-token
 *    combo, sprint = 750ms). These are numbers that will change if the
 *    baseBpm or the CADENCE_DIVISION mapping ever drifts — the whole
 *    render pipeline anchors to them.
 *
 * 2. **The JS mirror matches the TS engine byte-for-byte.** For every
 *    (cadence, tokens.length) pair the phrase corpus renders,
 *    `grid_targets.gridDurationMs` and the engine's
 *    `combinationDurationMs` (recomputed here in-line) return the same
 *    number. If they drift, the .mjs pipeline would silently target a
 *    different grid than the runtime — a fit-check that produces
 *    validated-but-wrong clips.
 */
import {
  CADENCE_DIVISION,
  DEFAULT_BASE_BPM,
  DEFAULT_SWING,
  INTERVAL_HARD_MS_FLOOR,
  INTERVAL_HARD_PCT,
  INTERVAL_WARN_MS,
  MAX_TOLERANCE,
  PREFERRED_TOLERANCE,
  beatDurationMs,
  callSlotDurationMs,
  fitBoundsMs,
  fitPct,
  fitVerdict,
  gridDurationMs,
  intervalFitAudit,
  intervalFitVerdict,
  intervalHardMs,
} from '../grid_targets.mjs'

describe('beatDurationMs', () => {
  it('60 BPM → 1000 ms per beat', () => {
    expect(beatDurationMs(60)).toBe(1000)
  })
  it('defaults to Kyle master pulse (60)', () => {
    expect(beatDurationMs()).toBe(1000)
  })
  it('rejects non-positive bpm', () => {
    expect(() => beatDurationMs(0)).toThrow()
    expect(() => beatDurationMs(-1)).toThrow()
    expect(() => beatDurationMs(NaN)).toThrow()
  })
})

describe('callSlotDurationMs', () => {
  // Kyle's spec table, verbatim.
  it.each([
    [1, 1000],
    [2, 500],
    [3, 1000 / 3],
    [4, 250],
  ])('division %s at 60 BPM → %s ms/slot', (division, expected) => {
    expect(callSlotDurationMs({ baseBpm: 60, division })).toBeCloseTo(expected, 10)
  })

  it('rejects a non-integer division', () => {
    expect(() => callSlotDurationMs({ baseBpm: 60, division: 1.5 })).toThrow()
  })
  it('rejects a division outside [1,4]', () => {
    expect(() => callSlotDurationMs({ baseBpm: 60, division: 0 })).toThrow()
    expect(() => callSlotDurationMs({ baseBpm: 60, division: 5 })).toThrow()
  })
})

describe('CADENCE_DIVISION mapping', () => {
  it('is the same mapping as WorkoutRecipe.divisionForCadenceProfile', () => {
    expect(CADENCE_DIVISION).toEqual({
      technical: 1,
      steady: 2,
      pressure: 3,
      sprint: 4,
    })
  })
})

describe('gridDurationMs — Kyle spec table for 3-token combo like "1-2-3"', () => {
  const tokens = ['1', '2', '3']
  it.each([
    ['technical', 3000],
    ['steady', 1500],
    ['pressure', 1000],
    ['sprint', 750],
  ])('%s → %s ms', (cadence, expected) => {
    expect(gridDurationMs({ tokens, cadence })).toBeCloseTo(expected, 10)
  })
})

describe('gridDurationMs — density is separate from rate', () => {
  it('honors explicit totalSteps > tokens.length (syncopated combo)', () => {
    // A 3-punch combo laid across 4 grid slots (one skipped) — the
    // engine spec explicitly allows this ("ONE-two-THREE … TWO!").
    const g = gridDurationMs({ tokens: ['1', '2', '3'], cadence: 'steady', totalSteps: 4 })
    expect(g).toBe(2000)
  })
  it('honors explicit division override (wins over cadence)', () => {
    const g = gridDurationMs({ tokens: ['1', '2'], cadence: 'sprint', division: 1 })
    expect(g).toBe(2000)
  })
  it('honors baseBpm override', () => {
    const g = gridDurationMs({ tokens: ['1', '2', '3'], cadence: 'steady', baseBpm: 120 })
    expect(g).toBe(750)
  })
  it('throws on an unknown cadence with no division override', () => {
    expect(() => gridDurationMs({ tokens: ['1'], cadence: 'nope' })).toThrow()
  })
  it('throws on zero tokens', () => {
    expect(() => gridDurationMs({ tokens: [], cadence: 'steady' })).toThrow()
  })
})

describe('fitPct + fitVerdict', () => {
  it('1.0 → preferred', () => {
    expect(fitVerdict(fitPct(1500, 1500))).toBe('preferred')
  })
  it('within ±5% → preferred', () => {
    expect(fitVerdict(fitPct(1575, 1500))).toBe('preferred') // +5.0%
    expect(fitVerdict(fitPct(1425, 1500))).toBe('preferred') // -5.0%
  })
  it('outside ±5% but within ±10% → acceptable', () => {
    expect(fitVerdict(fitPct(1600, 1500))).toBe('acceptable') // +6.7%
    expect(fitVerdict(fitPct(1400, 1500))).toBe('acceptable') // -6.7%
    expect(fitVerdict(fitPct(1650, 1500))).toBe('acceptable') // +10.0%
    expect(fitVerdict(fitPct(1350, 1500))).toBe('acceptable') // -10.0%
  })
  it('beyond ±10% → reject', () => {
    expect(fitVerdict(fitPct(1651, 1500))).toBe('reject')
    expect(fitVerdict(fitPct(1349, 1500))).toBe('reject')
    expect(fitVerdict(fitPct(3000, 1500))).toBe('reject')
  })

  it('rejects non-positive inputs', () => {
    expect(() => fitPct(0, 1500)).toThrow()
    expect(() => fitPct(1500, 0)).toThrow()
    expect(() => fitPct(-1, 1500)).toThrow()
    expect(() => fitPct(1500, NaN)).toThrow()
  })
})

describe('fitBoundsMs', () => {
  it('renders the ±5% / ±10% bands as ms bounds', () => {
    expect(fitBoundsMs(1500)).toEqual({
      preferredMinMs: 1425,
      preferredMaxMs: 1575,
      maxMinMs: 1350,
      maxMaxMs: 1650,
    })
  })
})

// ---------------------------------------------------------------------------
// PARITY: the mirror must never drift from the TS engine.
// ---------------------------------------------------------------------------

// The engine formula, re-implemented here inline. If this ever produces
// different numbers from `gridDurationMs`, the mirror in grid_targets.mjs
// has drifted from src/domain/timing/TimingEngine.ts and the render
// pipeline will start writing clips against the wrong grid.
function engineCombinationDurationMs({ totalSteps, coachTempo }) {
  const beatMs = 60_000 / coachTempo.baseBpm
  const slotMs = beatMs / coachTempo.division
  return totalSteps * slotMs
}

describe('parity — JS mirror matches the TS engine formula for every cadence×length the corpus renders', () => {
  const cadences = ['technical', 'steady', 'pressure', 'sprint']
  const lengths = [2, 3, 4, 5, 6, 7, 8] // every plausible corpus combo length

  it.each(
    cadences.flatMap((cadence) =>
      lengths.map((len) => [cadence, len]),
    ),
  )('cadence %s × %s tokens', (cadence, len) => {
    const tokens = Array.from({ length: len }, (_, i) => String(i + 1))
    const jsSide = gridDurationMs({ tokens, cadence })
    const tsSide = engineCombinationDurationMs({
      totalSteps: len,
      coachTempo: {
        baseBpm: DEFAULT_BASE_BPM,
        division: CADENCE_DIVISION[cadence],
        swing: DEFAULT_SWING,
      },
    })
    expect(jsSide).toBeCloseTo(tsSide, 10)
  })
})

describe('tolerance constants', () => {
  it('are Kyle spec (5% preferred, 10% max)', () => {
    expect(PREFERRED_TOLERANCE).toBe(0.05)
    expect(MAX_TOLERANCE).toBe(0.10)
  })
})

// ---------------------------------------------------------------------------
// Per-interval tolerance (M39-V2 Phase 4b, Kyle amended blueprint).
// Kept separate from the whole-clip band above: this is the check that
// a phrase's INTERNAL taught strike positions land within tolerance,
// not that the whole file fits its allotted grid.
// ---------------------------------------------------------------------------

describe('per-interval tolerance constants', () => {
  it('are Kyle amended blueprint spec (12 ms warn, max(25 ms, 5%) hard)', () => {
    expect(INTERVAL_WARN_MS).toBe(12)
    expect(INTERVAL_HARD_MS_FLOOR).toBe(25)
    expect(INTERVAL_HARD_PCT).toBe(0.05)
  })
})

describe('intervalHardMs', () => {
  it('is the 25 ms floor for short targets where 5% would be smaller', () => {
    expect(intervalHardMs(100)).toBe(25)
    expect(intervalHardMs(400)).toBe(25) // 5% × 400 = 20; floor wins
  })
  it('scales to 5% of the target when the target is large enough', () => {
    expect(intervalHardMs(1000)).toBe(50) // 5% × 1000 = 50; > floor
    expect(intervalHardMs(2000)).toBe(100) // 5% × 2000 = 100
  })
  it('rejects non-positive targets', () => {
    expect(() => intervalHardMs(0)).toThrow()
    expect(() => intervalHardMs(-1)).toThrow()
    expect(() => intervalHardMs(NaN)).toThrow()
  })
})

describe('intervalFitVerdict', () => {
  it('is ok inside the ±12 ms warn tier', () => {
    expect(intervalFitVerdict(500, 500)).toBe('ok')
    expect(intervalFitVerdict(511, 500)).toBe('ok')
    expect(intervalFitVerdict(489, 500)).toBe('ok')
    expect(intervalFitVerdict(512, 500)).toBe('ok') // exactly 12 ms
  })
  it('is warn between the warn tier and hard tier', () => {
    // Target 500 → hard = max(25, 25) = 25. Warn band = (12, 25].
    expect(intervalFitVerdict(513, 500)).toBe('warn')
    expect(intervalFitVerdict(525, 500)).toBe('warn') // exactly 25 ms
    expect(intervalFitVerdict(475, 500)).toBe('warn')
  })
  it('is hard beyond the hard tier', () => {
    // Target 500 → hard threshold 25 ms.
    expect(intervalFitVerdict(526, 500)).toBe('hard')
    expect(intervalFitVerdict(474, 500)).toBe('hard')
  })
  it('uses 5% for large-target proportional cap', () => {
    // Target 1000 → hard = 50. Drift 40 ms → warn; drift 51 → hard.
    expect(intervalFitVerdict(1040, 1000)).toBe('warn')
    expect(intervalFitVerdict(1050, 1000)).toBe('warn') // exactly 50
    expect(intervalFitVerdict(1051, 1000)).toBe('hard')
  })
})

describe('intervalFitAudit', () => {
  it('rolls up per-interval verdicts into a summary', () => {
    const audit = intervalFitAudit([500, 511, 526], [500, 500, 500])
    expect(audit.counts.ok).toBe(2)
    expect(audit.counts.warn).toBe(0)
    expect(audit.counts.hard).toBe(1)
    expect(audit.verdict).toBe('hard')
    expect(audit.worst.index).toBe(2)
    expect(audit.worst.driftMs).toBe(26)
  })
  it('warn if any interval warns but none hard', () => {
    const audit = intervalFitAudit([500, 513], [500, 500])
    expect(audit.verdict).toBe('warn')
    expect(audit.counts.warn).toBe(1)
  })
  it('ok when every interval is inside the warn tier', () => {
    const audit = intervalFitAudit([500, 505, 495], [500, 500, 500])
    expect(audit.verdict).toBe('ok')
    expect(audit.counts.ok).toBe(3)
  })
  it('rejects length mismatch', () => {
    expect(() => intervalFitAudit([1, 2], [1])).toThrow(/length mismatch/)
  })
  it('rejects non-arrays', () => {
    expect(() => intervalFitAudit(1, [1])).toThrow()
    expect(() => intervalFitAudit([1], null)).toThrow()
  })
})
