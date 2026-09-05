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
  /** Master beat tempo the loop is rendered at — one bar = 60000/baseBpm ms. */
  baseBpm: number
  /** 1..4 — the number of call slots per master beat. */
  division: 1 | 2 | 3 | 4
  /** 0.5 (mechanical) .. 0.62 (avoid). See TimingEngine SWING_* constants. */
  swing: number
  /** Metro module id for the loop wav. */
  module: number
  /** Measured length of one bar (≈ 60000/baseBpm ms). */
  durationMs: number
}

export const METRONOME_LOOPS: readonly MetronomeLoop[] = [
  { baseBpm: 60, division: 1, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b60-d1-s50.wav'), durationMs: 1000 },
  { baseBpm: 60, division: 2, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b60-d2-s50.wav'), durationMs: 1000 },
  { baseBpm: 60, division: 2, swing: 0.54, module: require('../../../assets/audio/metronome/metronome-b60-d2-s54.wav'), durationMs: 1000 },
  { baseBpm: 60, division: 3, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b60-d3-s50.wav'), durationMs: 1000 },
  { baseBpm: 60, division: 4, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b60-d4-s50.wav'), durationMs: 1000 },
  { baseBpm: 60, division: 4, swing: 0.54, module: require('../../../assets/audio/metronome/metronome-b60-d4-s54.wav'), durationMs: 1000 },
  { baseBpm: 100, division: 1, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b100-d1-s50.wav'), durationMs: 600 },
  { baseBpm: 100, division: 2, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b100-d2-s50.wav'), durationMs: 600 },
  { baseBpm: 100, division: 2, swing: 0.54, module: require('../../../assets/audio/metronome/metronome-b100-d2-s54.wav'), durationMs: 600 },
  { baseBpm: 100, division: 3, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b100-d3-s50.wav'), durationMs: 600 },
  { baseBpm: 85, division: 1, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b85-d1-s50.wav'), durationMs: 706 },
  { baseBpm: 85, division: 2, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b85-d2-s50.wav'), durationMs: 706 },
  { baseBpm: 85, division: 2, swing: 0.54, module: require('../../../assets/audio/metronome/metronome-b85-d2-s54.wav'), durationMs: 706 },
  { baseBpm: 85, division: 3, swing: 0.5, module: require('../../../assets/audio/metronome/metronome-b85-d3-s50.wav'), durationMs: 706 },
]

/**
 * Runtime lookup: exact `(baseBpm, division, swing)` wins; else same
 * baseBpm+division at straight swing (0.50); else undefined (caller
 * no-ops). baseBpm defaults to 60 for legacy callers.
 */
export function metronomeLoopFor(division: 1 | 2 | 3 | 4, swing: number, baseBpm = 60): MetronomeLoop | undefined {
  const at = METRONOME_LOOPS.filter((l) => l.baseBpm === baseBpm && l.division === division)
  const exact = at.find((l) => Math.abs(l.swing - swing) < 0.005)
  if (exact) return exact
  return at.find((l) => Math.abs(l.swing - 0.5) < 0.005)
}
