/**
 * Technique standalone strike names (generated; M39-V2 Phase 4b).
 *
 * DO NOT EDIT — produced by
 * `node tools/voice/make-technique-standalone-clips.mjs`.
 *
 * Each entry pairs a rendered wav with the canonical strike token
 * (`1`, `1b`, … `6b`). Runtime lookup: `techniqueStandaloneClipFor(token)`.
 * The technique-vocabulary partner of the shipped `numbers/standalone`
 * corpus — used by synchronized `strike-call` cues.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { StrikeToken } from '@domain/strikes/strikeCatalog'

export interface TechniqueStandaloneClip {
  id: string
  token: StrikeToken
  /** The exact rendered text (for diagnostics + fit-check). */
  text: string
  /** Metro module id for the wav. */
  module: number
  /** Measured duration of the rendered clip, in milliseconds. */
  durationMs: number
}

export const TECHNIQUE_STANDALONE_CLIPS: readonly TechniqueStandaloneClip[] = [
  { id: 'ts-1', token: '1', text: "Jab.", module: require('../../../assets/voice/numbers/standalone/ts-1.wav'), durationMs: 1373 },
  { id: 'ts-1b', token: '1B', text: "Body jab.", module: require('../../../assets/voice/numbers/standalone/ts-1b.wav'), durationMs: 2013 },
  { id: 'ts-2', token: '2', text: "Cross.", module: require('../../../assets/voice/numbers/standalone/ts-2.wav'), durationMs: 1173 },
  { id: 'ts-2b', token: '2B', text: "Body cross.", module: require('../../../assets/voice/numbers/standalone/ts-2b.wav'), durationMs: 1813 },
  { id: 'ts-3', token: '3', text: "Lead hook.", module: require('../../../assets/voice/numbers/standalone/ts-3.wav'), durationMs: 1533 },
  { id: 'ts-3b', token: '3B', text: "Body hook.", module: require('../../../assets/voice/numbers/standalone/ts-3b.wav'), durationMs: 1133 },
  { id: 'ts-4', token: '4', text: "Rear hook.", module: require('../../../assets/voice/numbers/standalone/ts-4.wav'), durationMs: 1813 },
  { id: 'ts-4b', token: '4B', text: "Rear body hook.", module: require('../../../assets/voice/numbers/standalone/ts-4b.wav'), durationMs: 1439 },
  { id: 'ts-5', token: '5', text: "Lead uppercut.", module: require('../../../assets/voice/numbers/standalone/ts-5.wav'), durationMs: 1253 },
  { id: 'ts-5b', token: '5B', text: "Lead body uppercut.", module: require('../../../assets/voice/numbers/standalone/ts-5b.wav'), durationMs: 1493 },
  { id: 'ts-6', token: '6', text: "Rear uppercut.", module: require('../../../assets/voice/numbers/standalone/ts-6.wav'), durationMs: 1933 },
  { id: 'ts-6b', token: '6B', text: "Rear body uppercut.", module: require('../../../assets/voice/numbers/standalone/ts-6b.wav'), durationMs: 1853 },
]

/**
 * The technique standalone clip for a strike token, or undefined
 * when none was rendered. A missing token means synchronized
 * technique-vocab reinforcement on THIS strike is skipped; the
 * runtime does not synthesize a substitute.
 */
export function techniqueStandaloneClipFor(
  token: StrikeToken,
): TechniqueStandaloneClip | undefined {
  return TECHNIQUE_STANDALONE_CLIPS.find((c) => c.token === token)
}

/* eslint-enable @typescript-eslint/no-require-imports */
