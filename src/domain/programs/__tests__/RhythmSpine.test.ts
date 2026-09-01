// ENGINE-BEHAVIOR SUITE — pinned to the FROZEN pre-click-track samples
// (samples/__fixtures__), NOT the live library. The live sets were
// rewritten to the 4-slot click-track format (MVP v2, GH #305) and no
// longer exercise bursts / count scoring / defense-counters; these
// assertions encode engine semantics those shapes exist to test.
/**
 * The RhythmSpine contract — one per-token schedule that every output
 * track reads. Walks every sample workout and pins the invariants that
 * keep numbers audio, techniques audio, ring lights and avatar frames
 * from drifting apart.
 *
 * v1 assertions (this file):
 *   1) Every non-empty cue produces a TokenBeat[] whose length equals
 *      the number of tokens in `cue.tokens`.
 *   2) Beats are monotone non-decreasing on `atMs` and land inside
 *      `[cue.scheduledStartMs, cue.windowEndMs]` (with a small trailing
 *      grace for rail-placed final tokens).
 *   3) `beatsFor` respects the same override the cue engine reads:
 *      `phraseTokenTimesMs` when present, `tokenOffsetsMs` otherwise.
 *   4) Purity — same input, deep-equal output.
 *
 * A2/A3/A11/A12 land later assertions (pulses, dark-and-silent ban,
 * paired vocab layouts) — those tests will live alongside this file.
 */
import { expandTimeline } from '../CueTimeline'
import {
  compileRoundSpine,
  beatsFor,
  pulseCursorAt,
  pulsesFor,
  RAIL_K_MS,
} from '../RhythmSpine'
import { legacyPacePusher as pacePusher } from '../../workout/samples/__fixtures__'
import { listLegacySampleWorkouts as listSampleWorkouts } from '../../workout/samples/__fixtures__'
import { findPhraseTiming } from '../phraseTimingManifest'
import type { CueInstance } from '../CueTimeline'

const SAMPLES = listSampleWorkouts()

describe('RhythmSpine — per-token schedule', () => {
  it.each(SAMPLES.map((s) => [s.key, s]))(
    'sample %s: every non-empty cue produces one beat per token',
    (_key, sample) => {
      const rounds = expandTimeline(sample.workout, 'orthodox', 120)
      for (const round of rounds) {
        const spine = compileRoundSpine(round)
        for (const cue of round.cues) {
          const beats = spine.beats[cue.id]
          expect(beats).toBeDefined()
          if (cue.tokens.length === 0) {
            expect(beats!.length).toBe(0)
            continue
          }
          // A cue produces a beat for every token whose scheduled fire
          // time fits inside cue.windowEndMs (`beatsFor` matches
          // `CueEngine.fireDueTokens`'s window cap so the avatar and
          // rings agree). Phase 5-ii: the V1c `phraseTokenTimesMs` /
          // `visualOffsetsMs` overrides retired; only the beat grid
          // remains here.
          const offsets = cue.tokenOffsetsMs
          const inWindow = offsets.filter((o) => cue.scheduledStartMs + o <= cue.windowEndMs).length
          expect(beats!.length).toBeGreaterThan(0)
          expect(beats!.length).toBeLessThanOrEqual(offsets.length)
          // Every in-window offset produces a beat; the two totals match.
          if (inWindow === offsets.length) {
            expect(beats!.length).toBe(offsets.length)
          }
        }
      }
    },
  )

  it.each(SAMPLES.map((s) => [s.key, s]))(
    'sample %s: beats are monotone and inside the cue window',
    (_key, sample) => {
      const rounds = expandTimeline(sample.workout, 'orthodox', 120)
      for (const round of rounds) {
        const spine = compileRoundSpine(round)
        for (const cue of round.cues) {
          const beats = spine.beats[cue.id]!
          let prev = -Infinity
          for (const beat of beats) {
            expect(beat.atMs).toBeGreaterThanOrEqual(prev)
            prev = beat.atMs
            expect(beat.atMs).toBeGreaterThanOrEqual(cue.scheduledStartMs - 1)
            // Leave a full second of trailing grace — rail-placed final
            // tokens can land just past scheduledEndMs when the rail
            // stretches to fit a long word.
            expect(beat.atMs).toBeLessThanOrEqual(cue.windowEndMs + 1_000)
          }
        }
      }
    },
  )
})

describe('round-fill coverage (A3 / issue #258)', () => {
  /**
   * The free-work tail was 124-139 s per round on pace-pusher — dead
   * rings and no coach for over half the round. Every sample now goes
   * through padBlocksToRound, so the blocks must cover the round to
   * within PAD_BELL_MARGIN_MS + one beat-subdivision (the padder floors
   * to 0.05 beats to keep the sample "duration derives from beats"
   * test happy). One breath's worth of tail, never a hole.
   */
  const MARGIN_MS = 2_100
  it.each(listSampleWorkouts().map((s) => [s.key, s]))(
    'sample %s: every round is covered to within 2 s of the bell',
    (_key, sample) => {
      for (const round of sample.workout.schedule) {
        if (!round.blocks.length) continue
        const last = round.blocks[round.blocks.length - 1]!
        const span = last.startOffsetMs + last.durationMs
        expect(span).toBeGreaterThanOrEqual(round.workDurationMs - MARGIN_MS)
      }
    },
  )
})

describe('pulses for count-scored windows (A2 / issue #257)', () => {
  it('a volume-burst window produces a pulse per planned punch', () => {
    // Real pace-pusher volume-burst: 55 beats at 120bpm = 27.5s,
    // target 60 punches, 2-token motif.
    const rounds = expandTimeline(pacePusher, 'orthodox', 120)
    const bursts = rounds
      .flatMap((r: { cues: CueInstance[] }) => r.cues)
      .filter((c: CueInstance) => c.scoring === 'count')
    expect(bursts.length).toBeGreaterThan(0)
    for (const cue of bursts) {
      const pulses = pulsesFor(cue)
      const target = cue.countScored?.targetPunches ?? 0
      // ±one motif of tolerance (integer cycles + trailing prune).
      expect(pulses.length).toBeGreaterThanOrEqual(target - cue.tokens.length)
      expect(pulses.length).toBeLessThanOrEqual(target + cue.tokens.length)
      // Monotone and inside the window.
      let prev = -Infinity
      for (const b of pulses) {
        expect(b.atMs).toBeGreaterThanOrEqual(prev)
        prev = b.atMs
        expect(b.atMs).toBeGreaterThanOrEqual(cue.scheduledStartMs - 1)
        expect(b.atMs).toBeLessThanOrEqual(cue.windowEndMs + 1)
      }
    }
  })

  it('sequence cues produce no pulses (rings drive from beats)', () => {
    const cue: CueInstance = {
      id: 'seq', blockId: 'b', repeatIndex: 0, scoring: 'sequence',
      tokens: [{ kind: 'punch', number: 1, body: false, beatOffset: 0 }],
      tokenOffsetsMs: [0], expectedPunches: [{ tokenIndex: 0, hand: 'left' }],
      displayOnlyTokenIndexes: [], previewAt: 0, announceAt: 0,
      scheduledStartMs: 0, scheduledEndMs: 500,
      windowStartMs: 0, windowEndMs: 1000,
    }
    expect(pulsesFor(cue)).toEqual([])
  })

  it('pulseCursorAt walks the motif in real time', () => {
    // A tiny synthetic burst: 4 tokens, target 8, window 4000 ms.
    // Stride = 4000 / 2 = 2000 ms; motif offsets [0, 200, 400, 600].
    // So pulses land at 0, 200, 400, 600, 2000, 2200, 2400, 2600.
    const cue: CueInstance = {
      id: 'burst', blockId: 'b', repeatIndex: 0, scoring: 'count',
      countScored: { targetPunches: 8, countdownMs: 3000 },
      tokens: [
        { kind: 'punch', number: 1, body: false, beatOffset: 0 },
        { kind: 'punch', number: 2, body: false, beatOffset: 0.4 },
        { kind: 'punch', number: 1, body: false, beatOffset: 0.8 },
        { kind: 'punch', number: 2, body: false, beatOffset: 1.2 },
      ],
      tokenOffsetsMs: [0, 200, 400, 600], expectedPunches: [],
      displayOnlyTokenIndexes: [0, 1, 2, 3],
      previewAt: 0, announceAt: 0,
      scheduledStartMs: 0, scheduledEndMs: 4000,
      windowStartMs: 0, windowEndMs: 4000,
    }
    const spine = {
      roundIndex: 0,
      beats: {},
      pulses: { burst: pulsesFor(cue) },
      audio: {},
      compiled: {},
    }
    // Before any pulse.
    expect(pulseCursorAt(spine, cue, -1)).toBe(-1)
    // Just after pulse 0.
    expect(pulseCursorAt(spine, cue, 50)).toBe(0)
    // At pulse 2 (400 ms).
    expect(pulseCursorAt(spine, cue, 450)).toBe(2)
    // Mid-cycle 2 (2200 ms → token 1).
    expect(pulseCursorAt(spine, cue, 2200)).toBe(1)
    // Past the window.
    expect(pulseCursorAt(spine, cue, 5000)).toBe(3)
  })
})

describe('phrase-timing manifest coverage (A16)', () => {
  /**
   * Kyle's rule: numbers ⇄ techniques must be a rendering choice, not
   * a re-mapping. Where a manifest entry has BOTH vocabularies with
   * wordMarks, the two must land word N at the same audioEndMs within
   * a small tolerance (envelope precision + Whisper jitter).
   */
  it('every phrase with both vocabularies stays within 400 ms of a paired offset', () => {
    // Larger tolerance than the "≤ 25 ms" of the plan: today's marks
    // are mixed envelope+Whisper, and Whisper's word-time precision on
    // this corpus is ~200 ms. The tighter bound lands with issue #269's
    // re-render batch. This test still catches gross drift (a full
    // token skipped).
    const OFFSET_TOL_MS = 400
    // Enumerate every combination × cadence referenced by a sample.
    for (const sample of listSampleWorkouts()) {
      const rounds = expandTimeline(sample.workout, 'orthodox', 120)
      const seen = new Set<string>()
      for (const round of rounds) {
        for (const cue of round.cues) {
          if (!cue.cadence) continue
          const combo = cue.tokens
            .map((t) =>
              t.kind === 'punch' ? `${t.number}${t.body ? 'b' : ''}` : (t as { command?: string }).command ?? '',
            )
            .join('-')
          const key = `${combo}.${cue.cadence}`
          if (seen.has(key)) continue
          seen.add(key)
          const timing = findPhraseTiming(combo, cue.cadence)
          if (!timing?.vocabOffsetMs) continue
          for (const offset of timing.vocabOffsetMs) {
            expect(Math.abs(offset)).toBeLessThan(OFFSET_TOL_MS)
          }
        }
      }
    }
  })
})

describe('beatsFor — the single source of truth', () => {
  const cue: CueInstance = {
    id: 'test-cue',
    blockId: 'test-block',
    repeatIndex: 0,
    scoring: 'sequence',
    tokens: [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
    ],
    tokenOffsetsMs: [0, 500],
    expectedPunches: [
      { tokenIndex: 0, hand: 'left', type: 'straight' },
      { tokenIndex: 1, hand: 'right', type: 'straight' },
    ],
    displayOnlyTokenIndexes: [],
    previewAt: 0,
    announceAt: 0,
    scheduledStartMs: 10_000,
    scheduledEndMs: 10_500,
    windowStartMs: 10_000,
    windowEndMs: 11_500,
  }

  it('uses the beat grid when no rail is stamped', () => {
    const beats = beatsFor(cue)
    expect(beats.map((b) => b.atMs)).toEqual([10_000, 10_500])
    expect(beats.map((b) => b.hand)).toEqual(['left', 'right'])
    expect(beats.map((b) => b.type)).toEqual(['straight', 'straight'])
  })

  it('stamps a per-occurrence strikeId on every TokenBeat (M39-V2 Phase 2)', () => {
    // Distinct strikeIds fix the `1-1-2` avatar short-circuit — two
    // repeats of the same punch number now produce distinct
    // identifiers so consumers can re-adopt on each occurrence.
    const repeated: CueInstance = {
      ...cue,
      id: 'sp1-b2#0',
      tokens: [
        { kind: 'punch', number: 1, body: false, beatOffset: 0 },
        { kind: 'punch', number: 1, body: false, beatOffset: 0.5 },
        { kind: 'punch', number: 2, body: false, beatOffset: 1 },
      ],
      tokenOffsetsMs: [0, 250, 500],
      expectedPunches: [
        { tokenIndex: 0, hand: 'left' },
        { tokenIndex: 1, hand: 'left' },
        { tokenIndex: 2, hand: 'right' },
      ],
    }
    const beats = beatsFor(repeated)
    expect(beats).toHaveLength(3)
    expect(beats.map((b) => b.strikeId)).toEqual([
      'sp1-b2#0:rep-0:0',
      'sp1-b2#0:rep-0:1',
      'sp1-b2#0:rep-0:2',
    ])
    expect(new Set(beats.map((b) => b.strikeId)).size).toBe(3)
  })

  // Phase 5-ii: the V1c `phraseTokenTimesMs` (rail) and
  // `visualOffsetsMs` (engine grid) overrides retired. `beatsFor`
  // now reads only the beat grid; engine authoring lives on
  // `SpineSchedule.compiled[cueId]` instead. Regression coverage
  // moved to `programCueBridge.test.ts` +
  // `compileRoundSpine — compiled field` in this file.

  it('is pure — same inputs, deep-equal output', () => {
    expect(beatsFor(cue)).toEqual(beatsFor(cue))
  })

  it("splits Kyle's 4-strike / 800 ms combo into 8 avatar frames of 100 ms each", () => {
    // Kyle 2026-08-29: for a 4-strike combo that spends 800 ms on
    // screen, every avatar frame gets 100 ms; strict sequence 1a 1b
    // 2a 2b 3a 3b 4a 4b. avatarFrameMs is the per-frame ms; there are
    // always exactly 2 frames per punch token, in order.
    const combo: CueInstance = {
      id: 'k', blockId: 'k', repeatIndex: 0, scoring: 'sequence',
      tokens: [
        { kind: 'punch', number: 1, body: false, beatOffset: 0 },
        { kind: 'punch', number: 2, body: false, beatOffset: 0.4 },
        { kind: 'punch', number: 3, body: false, beatOffset: 0.8 },
        { kind: 'punch', number: 2, body: false, beatOffset: 1.2 },
      ],
      tokenOffsetsMs: [0, 200, 400, 600],
      expectedPunches: [
        { tokenIndex: 0, hand: 'left' },
        { tokenIndex: 1, hand: 'right' },
        { tokenIndex: 2, hand: 'left' },
        { tokenIndex: 3, hand: 'right' },
      ],
      displayOnlyTokenIndexes: [],
      previewAt: 0, announceAt: 0,
      scheduledStartMs: 0, scheduledEndMs: 800,
      windowStartMs: 0, windowEndMs: 1600,
    }
    const beats = beatsFor(combo)
    expect(beats).toHaveLength(4)
    for (const b of beats) expect(b.avatarFrameMs).toBe(100)
  })

  it('non-punch tokens hold the guard frame — avatarFrameMs is 0', () => {
    const mixed: CueInstance = {
      ...cue,
      tokens: [
        { kind: 'defense', command: 'slip', beatOffset: 0 },
        { kind: 'punch', number: 1, body: false, beatOffset: 1 },
      ],
      tokenOffsetsMs: [0, 500],
      expectedPunches: [{ tokenIndex: 1, hand: 'left' }],
      displayOnlyTokenIndexes: [0],
      scheduledStartMs: 0, scheduledEndMs: 1000,
      windowStartMs: 0, windowEndMs: 1500,
    }
    const beats = beatsFor(mixed)
    expect(beats[0]?.avatarFrameMs).toBe(0)
    // The one punch owns the whole on-screen window: 1000 ms / (2×1) = 500 ms/frame.
    expect(beats[1]?.avatarFrameMs).toBe(500)
  })

  it('audio times collapse to atMs when no phrase-timing manifest entry exists', () => {
    // The test fixture has no `cadence`, so the manifest lookup returns
    // undefined and the spine falls back to the beat grid — same behavior
    // CueEngine.fireDueTokens already has.
    const beats = beatsFor(cue)
    for (const b of beats) {
      expect(b.audioAtMs).toBe(b.atMs)
      expect(b.audioEndMs).toBe(b.atMs)
    }
  })

  it('audio times come from the manifest when a matching entry exists', () => {
    // 1-2 at pressure ships with both vocabs and full wordMarks in the
    // compiled phrase-timing manifest. Pick a real cue shape and
    // verify audioEndMs is atMs - RAIL_K_MS (Kyle's per-word rail).
    const railed: CueInstance = { ...cue, cadence: 'pressure' }
    const beats = beatsFor(railed)
    // atMs is unchanged (rail-vs-grid is orthogonal to manifest lookup);
    // audioEndMs must trail atMs by RAIL_K_MS.
    for (const b of beats) {
      expect(b.audioEndMs).toBe(b.atMs - RAIL_K_MS)
      expect(b.audioAtMs).toBeLessThan(b.audioEndMs)
    }
  })
})

describe('compileRoundSpine — compiled field (M39-V2 Phase 4-vi)', () => {
  // The spine now carries a `compiled: Record<string, CompiledCueTimeline | null>`
  // alongside beats/pulses/audio. Punch-bearing cues get a full Phase 3b
  // timeline; non-punch cues (defense-only, coach-only, coast markers)
  // appear as null — the consumer's "fall back to V1c dispatch" signal.
  it('exposes a `compiled` slot for every cue', () => {
    for (const sample of SAMPLES) {
      const rounds = expandTimeline(sample.workout, 'orthodox', 120)
      for (const round of rounds) {
        const spine = compileRoundSpine(round)
        expect(spine.compiled).toBeDefined()
        // Every cue id in the round must appear as a compiled key
        // (either a compiled timeline or null).
        for (const cue of round.cues) {
          expect(cue.id in spine.compiled).toBe(true)
        }
      }
    }
  })

  it('produces a compiled timeline whose strikes count matches the cue\'s punch tokens', () => {
    const rounds = expandTimeline(pacePusher, 'orthodox', 120)
    const spine = compileRoundSpine(rounds[0]!)
    for (const cue of rounds[0]!.cues) {
      const compiled = spine.compiled[cue.id]
      const punchCount = cue.tokens.filter((t) => t.kind === 'punch').length
      if (punchCount === 0) {
        // Non-punch cue → null (bridge contract).
        expect(compiled).toBeNull()
      } else {
        expect(compiled).not.toBeNull()
        expect(compiled!.strikes).toHaveLength(punchCount)
      }
    }
  })

  it('is deterministic — two compiles of the same round produce identical timeline identities', () => {
    const rounds = expandTimeline(pacePusher, 'orthodox', 120)
    const spineA = compileRoundSpine(rounds[0]!)
    const spineB = compileRoundSpine(rounds[0]!)
    for (const cueId of Object.keys(spineA.compiled)) {
      const a = spineA.compiled[cueId]
      const b = spineB.compiled[cueId]
      if (a === null || a === undefined) {
        expect(b ?? null).toBeNull()
      } else {
        expect(b).toBeDefined()
        expect(b!.identity).toEqual(a.identity)
      }
    }
  })
})
