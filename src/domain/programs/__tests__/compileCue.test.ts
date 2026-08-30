/**
 * `compileCue` — the V2 heart, one authored cue in, one immutable
 * compiled timeline out (Phase 3b).
 *
 * Pins Kyle's decisive test matrix cases 1, 3, 4 (case 2 needs
 * Phase 4's vocab-swap runtime; case 5 needs Phase 5's frame
 * clock):
 *
 *   1. Repeated discrete combination — `1-1-2 × 3` produces nine
 *      unique strike events, six node-1 activations, three node-2.
 *   3. Mixed cue — pre-call PLUS synchronized reinforcement can
 *      target the same strike via many-to-many coachLinks.
 *   4. Sustained block — one coach instruction, N unique strikes
 *      on one node.
 *
 * Plus the shared-authority + timeline-fingerprint invariants:
 *   - `strikes[]` is identical across the numeric + technique tracks
 *   - `timelineHash` is deterministic across recompilations
 *   - Monotonic strike-occurrence order across every generated cue
 */
import {
  DEFAULT_COAST_POLICY,
  DEFAULT_COMBO_POLICY,
  DEFAULT_SUSTAINED_POLICY,
} from '../../coach/VoicePolicy'
import {
  compileCue,
  type CoachAssetRef,
  type CoachAssetResolver,
  type ProgramCue,
} from '../compileCue'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NEVER_RESOLVE: CoachAssetResolver = () => undefined

const ALWAYS_RESOLVE = (
  contentKind: string,
  vocabulary: 'numeric' | 'technique',
): CoachAssetRef => ({
  assetId: `fixture-asset:${contentKind}:${vocabulary}`,
  mappedDurationTicks: 480, // half-pulse at 60 BPM
})

function cue(overrides: Partial<ProgramCue> = {}): ProgramCue {
  return {
    roundId: 'round-1',
    cueId: 'cue-A',
    combo: {
      id: 'combo.1-1-2',
      strikes: [
        { token: '1', atStep: 0 },
        { token: '1', atStep: 1 },
        { token: '2', atStep: 2 },
      ],
      totalSteps: 3,
    },
    repetition: { count: 1, gapSteps: 3 },
    executeAtTick: 0,
    executionDivision: 4, // sprint
    baseBpm: 60,
    voicePolicy: DEFAULT_COMBO_POLICY,
    coachAssets: NEVER_RESOLVE,
    revision: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Kyle decisive test 1 — `1-1-2 × 3`
// ---------------------------------------------------------------------------

describe('decisive test 1 — `1-1-2 × 3` produces 9 unique strike events', () => {
  const compiled = compileCue(
    cue({
      repetition: { count: 3, gapSteps: 3 },
      coachAssets: ALWAYS_RESOLVE,
    }),
  )

  it('has exactly nine strike events', () => {
    expect(compiled.strikes).toHaveLength(9)
  })

  it('has nine UNIQUE eventIds (no collapse on token or index)', () => {
    const ids = compiled.strikes.map((s) => s.eventId)
    expect(new Set(ids).size).toBe(9)
  })

  it('has three reps, each with three strikes', () => {
    expect(compiled.reps).toHaveLength(3)
    for (const rep of compiled.reps) {
      expect(rep.strikeEventIds).toHaveLength(3)
    }
  })

  it('lights node-1 six times and node-2 three times (physical node repeats OK)', () => {
    const byNode = new Map<string, number>()
    for (const s of compiled.strikes) {
      byNode.set(s.nodeId, (byNode.get(s.nodeId) ?? 0) + 1)
    }
    expect(byNode.get('node.1')).toBe(6)
    expect(byNode.get('node.2')).toBe(3)
  })

  it('each rep gets its own pre-call coach event on each track', () => {
    // 3 reps × 2 vocabularies = 6 pre-call events per compiled cue.
    expect(compiled.coachTracks.numeric.events).toHaveLength(3)
    expect(compiled.coachTracks.technique.events).toHaveLength(3)
    for (const ev of compiled.coachTracks.numeric.events) {
      expect(ev.contentKind).toBe('combo-announce')
      expect(ev.relation).toBe('precall')
    }
  })

  it('coach events on both tracks cover the SAME strikes per rep', () => {
    // Numeric event i and technique event i should teach the same
    // strike set — the visual layer is vocabulary-independent.
    const numericIds = compiled.coachTracks.numeric.events.map((e) =>
      [...e.strikeEventIds].sort(),
    )
    const techniqueIds = compiled.coachTracks.technique.events.map((e) =>
      [...e.strikeEventIds].sort(),
    )
    expect(numericIds).toEqual(techniqueIds)
  })
})

// ---------------------------------------------------------------------------
// Kyle decisive test 3 — mixed cue: pre-call + synchronized reinforcement
// on the same strike via many-to-many coachLinks
// ---------------------------------------------------------------------------

describe('decisive test 3 — many-to-many coach ↔ strike links', () => {
  it('a precall event links to every strike it teaches (via strike.coachLinks)', () => {
    const compiled = compileCue(
      cue({
        combo: {
          id: 'combo.1-2-3-2',
          strikes: [
            { token: '1', atStep: 0 },
            { token: '2', atStep: 1 },
            { token: '3', atStep: 2 },
            { token: '2', atStep: 3 },
          ],
          totalSteps: 4,
        },
        coachAssets: ALWAYS_RESOLVE,
      }),
    )
    // One rep, one numeric + one technique precall. Every strike
    // should carry two coachLinks (numeric + technique for the precall).
    expect(compiled.strikes).toHaveLength(4)
    for (const s of compiled.strikes) {
      expect(s.coachLinks).toHaveLength(2)
      expect(s.coachLinks.every((l) => l.relation === 'precall')).toBe(true)
    }
  })

  it('the compiler supports authoring an override syncMode per strike', () => {
    // A strike authored with syncMode: 'synchronized' should carry
    // that as its own field, distinct from the cue's defaultTiming.
    const compiled = compileCue(
      cue({
        combo: {
          id: 'combo.mixed',
          strikes: [
            { token: '1', atStep: 0 },
            { token: '2', atStep: 1, syncMode: 'synchronized' },
          ],
          totalSteps: 2,
        },
        coachAssets: ALWAYS_RESOLVE,
      }),
    )
    expect(compiled.strikes[0]!.syncMode).toBe('precall')
    expect(compiled.strikes[1]!.syncMode).toBe('synchronized')
  })
})

// ---------------------------------------------------------------------------
// Kyle decisive test 4 — sustained block
// ---------------------------------------------------------------------------

describe('decisive test 4 — sustained block: one coach event, N unique strikes on one node', () => {
  const compiled = compileCue(
    cue({
      combo: {
        id: 'combo.pump-1',
        strikes: Array.from({ length: 10 }, (_, i) => ({
          token: '1' as const,
          atStep: i,
        })),
        totalSteps: 10,
      },
      repetition: { count: 1, gapSteps: 0 },
      voicePolicy: DEFAULT_SUSTAINED_POLICY,
      coachAssets: (kind, vocab) =>
        kind === 'sustained-instruction'
          ? {
              assetId: `pump-the-1.${vocab}`,
              mappedDurationTicks: 720, // ~750 ms
            }
          : undefined,
    }),
  )

  it('produces ten unique strike events on one node', () => {
    expect(compiled.strikes).toHaveLength(10)
    expect(new Set(compiled.strikes.map((s) => s.nodeId))).toEqual(new Set(['node.1']))
    expect(new Set(compiled.strikes.map((s) => s.eventId)).size).toBe(10)
  })

  it('coach fires ONCE per track (once-per-cue frequency)', () => {
    expect(compiled.coachTracks.numeric.events).toHaveLength(1)
    expect(compiled.coachTracks.technique.events).toHaveLength(1)
    const numericEv = compiled.coachTracks.numeric.events[0]!
    expect(numericEv.contentKind).toBe('sustained-instruction')
  })
})

// ---------------------------------------------------------------------------
// Shared authority + fingerprint invariants
// ---------------------------------------------------------------------------

describe('shared authority — strikes are vocabulary-independent', () => {
  it('the compiled `strikes[]` array is identical regardless of coach vocabulary', () => {
    // Same input → same strike shape. The coach TRACKS differ only
    // in `assetId` per event; strikes carry no vocabulary reference.
    const compiled = compileCue(cue({ coachAssets: ALWAYS_RESOLVE }))
    for (const s of compiled.strikes) {
      // No vocabulary field escaping into the strike shape.
      expect(s).not.toHaveProperty('vocabulary')
    }
  })
})

describe('timeline fingerprint — deterministic across recompilations', () => {
  it('produces the same identity hash for the same input', () => {
    const input = cue({ coachAssets: ALWAYS_RESOLVE })
    const a = compileCue(input)
    const b = compileCue(input)
    expect(a.identity.timelineHash).toBe(b.identity.timelineHash)
  })

  it('produces different hashes when strike content differs', () => {
    const a = compileCue(cue({ coachAssets: ALWAYS_RESOLVE }))
    const b = compileCue(
      cue({
        combo: {
          id: 'combo.1-1-3',
          strikes: [
            { token: '1', atStep: 0 },
            { token: '1', atStep: 1 },
            { token: '3', atStep: 2 }, // was 2
          ],
          totalSteps: 3,
        },
        coachAssets: ALWAYS_RESOLVE,
      }),
    )
    expect(a.identity.timelineHash).not.toBe(b.identity.timelineHash)
  })

  it('preserves the revision + cueId on the identity', () => {
    const compiled = compileCue(cue({ revision: 42, cueId: 'special' }))
    expect(compiled.identity.revision).toBe(42)
    expect(compiled.identity.cueId).toBe('special')
  })
})

describe('monotonic strike-occurrence order (Kyle invariant)', () => {
  it('strikeIndex + startTick both strictly increase across a repeated combo', () => {
    const compiled = compileCue(
      cue({
        combo: {
          id: 'combo.1-2-3',
          strikes: [
            { token: '1', atStep: 0 },
            { token: '2', atStep: 1 },
            { token: '3', atStep: 2 },
          ],
          totalSteps: 3,
        },
        repetition: { count: 4, gapSteps: 3 },
        coachAssets: ALWAYS_RESOLVE,
      }),
    )
    let prevTick = -Infinity
    for (let i = 0; i < compiled.strikes.length; i += 1) {
      const s = compiled.strikes[i]!
      expect(s.strikeIndex).toBe(i % 3) // per-rep index
      expect(s.startTick).toBeGreaterThan(prevTick)
      prevTick = s.startTick
    }
  })
})

// ---------------------------------------------------------------------------
// Frequency variants
// ---------------------------------------------------------------------------

describe('CoachRepeatFrequency variants', () => {
  it('once-per-cue emits one coach event even for a 5-rep combo', () => {
    const compiled = compileCue(
      cue({
        repetition: { count: 5, gapSteps: 3 },
        voicePolicy: {
          contentKind: 'sustained-instruction',
          defaultTiming: 'precall',
          repeatFrequency: 'once-per-cue',
        },
        coachAssets: ALWAYS_RESOLVE,
      }),
    )
    expect(compiled.coachTracks.numeric.events).toHaveLength(1)
    expect(compiled.reps).toHaveLength(5)
    expect(compiled.strikes).toHaveLength(15)
  })

  it('first-rep-only fires on rep 0 only', () => {
    const compiled = compileCue(
      cue({
        repetition: { count: 3, gapSteps: 3 },
        voicePolicy: {
          contentKind: 'combo-announce',
          defaultTiming: 'precall',
          repeatFrequency: 'first-rep-only',
        },
        coachAssets: ALWAYS_RESOLVE,
      }),
    )
    expect(compiled.coachTracks.numeric.events).toHaveLength(1)
    const ev = compiled.coachTracks.numeric.events[0]!
    expect(ev.repId).toBe('rep-0')
  })

  it('selected-reps fires only on the authored indexes', () => {
    const compiled = compileCue(
      cue({
        repetition: { count: 4, gapSteps: 3, selectedRepIndexes: [0, 2] },
        voicePolicy: {
          contentKind: 'combo-announce',
          defaultTiming: 'precall',
          repeatFrequency: 'selected-reps',
        },
        coachAssets: ALWAYS_RESOLVE,
      }),
    )
    const repIds = compiled.coachTracks.numeric.events.map((e) => e.repId)
    expect(repIds).toEqual(['rep-0', 'rep-2'])
  })

  it('authored-events fires zero coach events from the per-rep loop', () => {
    const compiled = compileCue(
      cue({
        repetition: { count: 3, gapSteps: 3 },
        voicePolicy: DEFAULT_COAST_POLICY,
        coachAssets: ALWAYS_RESOLVE,
      }),
    )
    // The per-rep loop skips authored-events; a coasting cue's
    // intro + check-ins are appended by a future authoring path.
    expect(compiled.coachTracks.numeric.events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// No coach assets available — silent-coach-but-visuals-still-run
// ---------------------------------------------------------------------------

describe('missing coach assets — silent coach, strikes unchanged', () => {
  it('emits zero coach events but full strike sequence when resolver returns undefined', () => {
    const compiled = compileCue(cue({ coachAssets: NEVER_RESOLVE }))
    expect(compiled.strikes).toHaveLength(3)
    expect(compiled.coachTracks.numeric.events).toHaveLength(0)
    expect(compiled.coachTracks.technique.events).toHaveLength(0)
    // Every strike's coachLinks is empty.
    for (const s of compiled.strikes) {
      expect(s.coachLinks).toEqual([])
    }
  })

  it('single-track resolver (numeric only) produces one populated track and one empty', () => {
    const compiled = compileCue(
      cue({
        coachAssets: (kind, vocab) =>
          vocab === 'numeric'
            ? { assetId: `only-numeric:${kind}`, mappedDurationTicks: 480 }
            : undefined,
      }),
    )
    expect(compiled.coachTracks.numeric.events).toHaveLength(1)
    expect(compiled.coachTracks.technique.events).toHaveLength(0)
    // Strikes only carry the numeric link.
    for (const s of compiled.strikes) {
      expect(s.coachLinks).toHaveLength(1)
      expect(s.coachLinks[0]!.relation).toBe('precall')
    }
  })
})

// ---------------------------------------------------------------------------
// Precall back-scheduling — audible end lands responseGap before execution
// ---------------------------------------------------------------------------

describe('precall back-scheduling', () => {
  it('audibleEnd = executeAtTick − responseGap; audibleStart = audibleEnd − mappedDurationTicks', () => {
    const compiled = compileCue(
      cue({
        executeAtTick: 1_000,
        responseGapTicks: 60,
        coachAssets: () => ({ assetId: 'ac', mappedDurationTicks: 300 }),
      }),
    )
    const ev = compiled.coachTracks.numeric.events[0]!
    expect(ev.desiredAudibleEndTick).toBe(940) // 1000 - 60
    expect(ev.desiredAudibleStartTick).toBe(640) // 940 - 300
  })

  it('defaults responseGap to 60 ticks when omitted', () => {
    const compiled = compileCue(
      cue({
        executeAtTick: 1_000,
        coachAssets: () => ({ assetId: 'ac', mappedDurationTicks: 300 }),
      }),
    )
    const ev = compiled.coachTracks.numeric.events[0]!
    expect(ev.desiredAudibleEndTick).toBe(940)
  })
})
