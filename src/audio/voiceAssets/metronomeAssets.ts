/**
 * Boxing-flavored metronome loops (generated).
 *
 * DO NOT EDIT — produced by `node tools/voice/make-metronome-loops.mjs`.
 *
 * One entry per (division, swing) combination the runtime may request.
 * Kyle's spec 2026-08-30: 60 BPM master pulse, one-beat loops (1,000
 * ms), thud on the downbeat, hats on the subdivisions (with swing on
 * divisions 2 and 4; triplets never swung). Runtime fallback lives in
 * `metronomeLoopFor(division, swing)` — an exact match wins; else the
 * straight-swing (0.50) loop for that division wins; else undefined.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export interface MetronomeLoop {
  /** 1..4 — the number of call slots per master beat. */
  division: 1 | 2 | 3 | 4
  /** 0.5 (mechanical) .. 0.62 (avoid). See TimingEngine SWING_* constants. */
  swing: number
  /** Metro module id for the loop wav. */
  module: number
  /** Measured length of one bar. Should equal 1000 ms at baseBpm 60. */
  durationMs: number
}

export const METRONOME_LOOPS: readonly MetronomeLoop[] = [
  { division: 1, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-d1-s50.wav'), durationMs: 1000 },
  { division: 2, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-d2-s50.wav'), durationMs: 1000 },
  { division: 2, swing: 0.54, module: require('../../../assets/audio/metronome/metronome-d2-s54.wav'), durationMs: 1000 },
  { division: 3, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-d3-s50.wav'), durationMs: 1000 },
  { division: 4, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-d4-s50.wav'), durationMs: 1000 },
  { division: 4, swing: 0.54, module: require('../../../assets/audio/metronome/metronome-d4-s54.wav'), durationMs: 1000 },
]

/**
 * Runtime lookup: an exact match on `(division, swing)` wins; if the
 * requested swing bucket was not rendered, fall back to the same
 * division at straight swing (0.50). Returns undefined only when no
 * loop exists for the division at all — the caller then no-ops.
 */
export function metronomeLoopFor(division: 1 | 2 | 3 | 4, swing: number): MetronomeLoop | undefined {
  const exact = METRONOME_LOOPS.find((l) => l.division === division && Math.abs(l.swing - swing) < 0.005)
  if (exact) return exact
  return METRONOME_LOOPS.find((l) => l.division === division && Math.abs(l.swing - 0.5) < 0.005)
}
