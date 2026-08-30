/**
 * Sustained-strike coach lines (generated; M39-V2 Phase 4b).
 *
 * DO NOT EDIT — produced by `node tools/voice/make-sustained-clips.mjs`.
 *
 * Each entry pairs a rendered wav with a (token, vocabulary) key.
 * Runtime lookup: `sustainedClipFor({ token, vocabulary })`.
 * A block whose `voicePolicy.contentKind === "sustained-instruction"`
 * and `repeatFrequency === "once-per-cue"` fires this clip ONCE at
 * cue start and stays silent for the block interior.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { StrikeToken } from '@domain/strikes/strikeCatalog'

export type SustainedVocabulary = 'numbers' | 'techniques'

export interface SustainedClip {
  id: string
  token: StrikeToken
  vocabulary: SustainedVocabulary
  /** The exact rendered text (for diagnostics + fit-check). */
  text: string
  /** Metro module id for the wav. */
  module: number
  /** Measured duration of the rendered clip, in milliseconds. */
  durationMs: number
}

export const SUSTAINED_CLIPS: readonly SustainedClip[] = [
  { id: 'su-pump-1-numbers', token: '1', vocabulary: 'numbers', text: "Pump the one.", module: require('../../../assets/voice/numbers/standalone/su-pump-1-numbers.wav'), durationMs: 1413 },
  { id: 'su-pump-1b-numbers', token: '1B', vocabulary: 'numbers', text: "Pump the body one.", module: require('../../../assets/voice/numbers/standalone/su-pump-1b-numbers.wav'), durationMs: 1293 },
  { id: 'su-pump-2-numbers', token: '2', vocabulary: 'numbers', text: "Pump the two.", module: require('../../../assets/voice/numbers/standalone/su-pump-2-numbers.wav'), durationMs: 1293 },
  { id: 'su-pump-2b-numbers', token: '2B', vocabulary: 'numbers', text: "Pump the body two.", module: require('../../../assets/voice/numbers/standalone/su-pump-2b-numbers.wav'), durationMs: 1379 },
  { id: 'su-pump-3-numbers', token: '3', vocabulary: 'numbers', text: "Pump the three.", module: require('../../../assets/voice/numbers/standalone/su-pump-3-numbers.wav'), durationMs: 1013 },
  { id: 'su-pump-3b-numbers', token: '3B', vocabulary: 'numbers', text: "Pump the body three.", module: require('../../../assets/voice/numbers/standalone/su-pump-3b-numbers.wav'), durationMs: 1595 },
  { id: 'su-pump-4-numbers', token: '4', vocabulary: 'numbers', text: "Pump the four.", module: require('../../../assets/voice/numbers/standalone/su-pump-4-numbers.wav'), durationMs: 1293 },
  { id: 'su-pump-4b-numbers', token: '4B', vocabulary: 'numbers', text: "Pump the body four.", module: require('../../../assets/voice/numbers/standalone/su-pump-4b-numbers.wav'), durationMs: 1333 },
  { id: 'su-pump-5-numbers', token: '5', vocabulary: 'numbers', text: "Pump the five.", module: require('../../../assets/voice/numbers/standalone/su-pump-5-numbers.wav'), durationMs: 2173 },
  { id: 'su-pump-5b-numbers', token: '5B', vocabulary: 'numbers', text: "Pump the body five.", module: require('../../../assets/voice/numbers/standalone/su-pump-5b-numbers.wav'), durationMs: 1333 },
  { id: 'su-pump-6-numbers', token: '6', vocabulary: 'numbers', text: "Pump the six.", module: require('../../../assets/voice/numbers/standalone/su-pump-6-numbers.wav'), durationMs: 1133 },
  { id: 'su-pump-6b-numbers', token: '6B', vocabulary: 'numbers', text: "Pump the body six.", module: require('../../../assets/voice/numbers/standalone/su-pump-6b-numbers.wav'), durationMs: 1493 },
  { id: 'su-pump-1-techniques', token: '1', vocabulary: 'techniques', text: "Pump the jab.", module: require('../../../assets/voice/numbers/standalone/su-pump-1-techniques.wav'), durationMs: 1053 },
  { id: 'su-pump-1b-techniques', token: '1B', vocabulary: 'techniques', text: "Pump the body jab.", module: require('../../../assets/voice/numbers/standalone/su-pump-1b-techniques.wav'), durationMs: 1373 },
  { id: 'su-pump-2-techniques', token: '2', vocabulary: 'techniques', text: "Pump the cross.", module: require('../../../assets/voice/numbers/standalone/su-pump-2-techniques.wav'), durationMs: 1293 },
  { id: 'su-pump-2b-techniques', token: '2B', vocabulary: 'techniques', text: "Pump the body cross.", module: require('../../../assets/voice/numbers/standalone/su-pump-2b-techniques.wav'), durationMs: 2893 },
  { id: 'su-pump-3-techniques', token: '3', vocabulary: 'techniques', text: "Pump the lead hook.", module: require('../../../assets/voice/numbers/standalone/su-pump-3-techniques.wav'), durationMs: 1573 },
  { id: 'su-pump-3b-techniques', token: '3B', vocabulary: 'techniques', text: "Pump the body hook.", module: require('../../../assets/voice/numbers/standalone/su-pump-3b-techniques.wav'), durationMs: 1453 },
  { id: 'su-pump-4-techniques', token: '4', vocabulary: 'techniques', text: "Pump the rear hook.", module: require('../../../assets/voice/numbers/standalone/su-pump-4-techniques.wav'), durationMs: 1133 },
  { id: 'su-pump-4b-techniques', token: '4B', vocabulary: 'techniques', text: "Pump the rear body hook.", module: require('../../../assets/voice/numbers/standalone/su-pump-4b-techniques.wav'), durationMs: 1493 },
  { id: 'su-pump-5-techniques', token: '5', vocabulary: 'techniques', text: "Pump the lead uppercut.", module: require('../../../assets/voice/numbers/standalone/su-pump-5-techniques.wav'), durationMs: 1493 },
  { id: 'su-pump-5b-techniques', token: '5B', vocabulary: 'techniques', text: "Pump the lead body uppercut.", module: require('../../../assets/voice/numbers/standalone/su-pump-5b-techniques.wav'), durationMs: 1733 },
  { id: 'su-pump-6-techniques', token: '6', vocabulary: 'techniques', text: "Pump the rear uppercut.", module: require('../../../assets/voice/numbers/standalone/su-pump-6-techniques.wav'), durationMs: 1693 },
  { id: 'su-pump-6b-techniques', token: '6B', vocabulary: 'techniques', text: "Pump the rear body uppercut.", module: require('../../../assets/voice/numbers/standalone/su-pump-6b-techniques.wav'), durationMs: 1773 },
]

/**
 * The sustained-instruction clip for a (token, vocabulary) pair,
 * or undefined when none was rendered. Matches exactly on both
 * fields — no cross-vocab fallback: if a vocabulary is missing a
 * clip, the runtime is expected to know and stay silent rather
 * than say the wrong dialect.
 */
export function sustainedClipFor(
  key: { token: StrikeToken; vocabulary: SustainedVocabulary },
): SustainedClip | undefined {
  return SUSTAINED_CLIPS.find(
    (c) => c.token === key.token && c.vocabulary === key.vocabulary,
  )
}

/* eslint-enable @typescript-eslint/no-require-imports */
