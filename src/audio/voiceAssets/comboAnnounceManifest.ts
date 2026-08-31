/**
 * Combo-announce clips (generated).
 *
 * DO NOT EDIT — produced by `node tools/voice/make-combo-announce-clips.mjs`.
 *
 * One rendered wav per (combination, vocabulary). Consumed by the
 * VoicePolicy = announce-then-work path in CueAnnouncer (M39-V1c):
 * fires at rep 0 of a block whose voicePolicy is announce-then-work,
 * silent on interior reps. Rings still march to the CueEngine grid.
 *
 * Lookup: `findComboAnnounce(combination, vocabulary)`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { CalloutVocabulary } from '@domain/coach/VoiceOutputPort'

/**
 * The V2 shape of one word onset in the recording (M39-V2 Phase 4).
 * Same shape as V1c's PhraseWordMark; lives here now that Phase 5-iv
 * retired the per-punch phrase manifest.
 */
export interface SpeechMark {
  /** Onset in milliseconds from the start of the clip. */
  offsetMs: number
  /** End of the audible envelope for this mark, in ms. Optional. */
  endOffsetMs?: number
  /** Label — the word / syllable this mark corresponds to. Optional. */
  label?: string
}

export interface ComboAnnounceClip {
  id: string
  combination: string
  vocabulary: CalloutVocabulary
  /** The exact rendered text — what the ASR gate scored against. */
  text: string
  /** Metro module id for the wav. */
  module: number
  /** Measured duration of the rendered clip, in milliseconds. */
  durationMs: number
  /**
   * V2 word onsets in the recording — diagnostic use only (subtitles /
   * ASR / transcript). Optional; present when the render pipeline emits
   * it (M39-V2 Phase 4). Not a strike map.
   */
  speechMarksMs?: readonly SpeechMark[]
  /**
   * V2 strike map: semantic strike positions the announce phrase teaches,
   * in transport ticks (960 PPQN). Consumed by the compiled-timeline
   * fit-check + the ring-cadence rail (M39-V2 Phase 4). Optional.
   */
  taughtStrikeOffsetsTicks?: readonly number[]
  /**
   * V2 mirror of `durationMs` in transport ticks (960 PPQN) — lets the
   * compiled timeline compose without unit conversion. Optional.
   */
  mappedDurationTicks?: number
}

export const COMBO_ANNOUNCE_CLIPS: readonly ComboAnnounceClip[] = [
  { id: 'ca-1-1-numbers', combination: '1-1', vocabulary: 'numbers', text: "One, One, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-numbers.wav'), durationMs: 2093 },
  { id: 'ca-1-1-techniques', combination: '1-1', vocabulary: 'techniques', text: "Jab, Jab, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-techniques.wav'), durationMs: 1733 },
  { id: 'ca-1-1-1-2b-numbers', combination: '1-1-1-2b', vocabulary: 'numbers', text: "One, One, One, Two-bee, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-1-2b-numbers.wav'), durationMs: 3293 },
  { id: 'ca-1-1-1-2b-techniques', combination: '1-1-1-2b', vocabulary: 'techniques', text: "Jab, Jab, Jab, Body cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-1-2b-techniques.wav'), durationMs: 3173 },
  { id: 'ca-1-1-2-numbers', combination: '1-1-2', vocabulary: 'numbers', text: "One, One, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-numbers.wav'), durationMs: 3213 },
  { id: 'ca-1-1-2-techniques', combination: '1-1-2', vocabulary: 'techniques', text: "Jab, Jab, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-techniques.wav'), durationMs: 2653 },
  { id: 'ca-1-1-2-3-numbers', combination: '1-1-2-3', vocabulary: 'numbers', text: "One, One, Two, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3-numbers.wav'), durationMs: 2133 },
  { id: 'ca-1-1-2-3-techniques', combination: '1-1-2-3', vocabulary: 'techniques', text: "Jab, Jab, Cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3-techniques.wav'), durationMs: 2723 },
  { id: 'ca-1-1-2-3-2-numbers', combination: '1-1-2-3-2', vocabulary: 'numbers', text: "One, One, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3-2-numbers.wav'), durationMs: 2973 },
  { id: 'ca-1-1-2-3-2-techniques', combination: '1-1-2-3-2', vocabulary: 'techniques', text: "Jab, Jab, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3-2-techniques.wav'), durationMs: 3293 },
  { id: 'ca-1-1-2-3-2-5-6-3-2-numbers', combination: '1-1-2-3-2-5-6-3-2', vocabulary: 'numbers', text: "One, One, Two, Three, Two, Five, Six, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3-2-5-6-3-2-numbers.wav'), durationMs: 3253 },
  { id: 'ca-1-1-2-3-2-5-6-3-2-techniques', combination: '1-1-2-3-2-5-6-3-2', vocabulary: 'techniques', text: "Jab, Jab, Cross, Lead hook, Cross, Lead uppercut, Rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3-2-5-6-3-2-techniques.wav'), durationMs: 5093 },
  { id: 'ca-1-1-2-3b-numbers', combination: '1-1-2-3b', vocabulary: 'numbers', text: "One, One, Two, Three-bee, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-numbers.wav'), durationMs: 3093 },
  { id: 'ca-1-1-2-3b-techniques', combination: '1-1-2-3b', vocabulary: 'techniques', text: "Jab, Jab, Cross, Body lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-techniques.wav'), durationMs: 3173 },
  { id: 'ca-1-1-2-3b-2-numbers', combination: '1-1-2-3b-2', vocabulary: 'numbers', text: "One, One, Two, Three-bee, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-2-numbers.wav'), durationMs: 3453 },
  { id: 'ca-1-1-2-3b-2-techniques', combination: '1-1-2-3b-2', vocabulary: 'techniques', text: "Jab, Jab, Cross, Body lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-2-techniques.wav'), durationMs: 3493 },
  { id: 'ca-1-1-2-3b-3-numbers', combination: '1-1-2-3b-3', vocabulary: 'numbers', text: "One, One, Two, Three-bee, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-3-numbers.wav'), durationMs: 2893 },
  { id: 'ca-1-1-2-3b-3-techniques', combination: '1-1-2-3b-3', vocabulary: 'techniques', text: "Jab, Jab, Cross, Body lead hook, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-3-techniques.wav'), durationMs: 3493 },
  { id: 'ca-1-1-2-3b-3-2-numbers', combination: '1-1-2-3b-3-2', vocabulary: 'numbers', text: "One, One, Two, Three-bee, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-3-2-numbers.wav'), durationMs: 3733 },
  { id: 'ca-1-1-2-3b-3-2-techniques', combination: '1-1-2-3b-3-2', vocabulary: 'techniques', text: "Jab, Jab, Cross, Body lead hook, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-3-2-techniques.wav'), durationMs: 3413 },
  { id: 'ca-1-1-2-3b-3-2-5-2-numbers', combination: '1-1-2-3b-3-2-5-2', vocabulary: 'numbers', text: "One, One, Two, Three-bee, Three, Two, Five, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-3-2-5-2-numbers.wav'), durationMs: 4133 },
  { id: 'ca-1-1-2-3b-3-2-5-2-techniques', combination: '1-1-2-3b-3-2-5-2', vocabulary: 'techniques', text: "Jab, Jab, Cross, Body lead hook, Lead hook, Cross, Lead uppercut, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-3b-3-2-5-2-techniques.wav'), durationMs: 4293 },
  { id: 'ca-1-1-2-4-3-2-numbers', combination: '1-1-2-4-3-2', vocabulary: 'numbers', text: "One, One, Two, Four, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-4-3-2-numbers.wav'), durationMs: 3413 },
  { id: 'ca-1-1-2-4-3-2-techniques', combination: '1-1-2-4-3-2', vocabulary: 'techniques', text: "Jab, Jab, Cross, Rear hook, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-2-4-3-2-techniques.wav'), durationMs: 3773 },
  { id: 'ca-1-1-4b-numbers', combination: '1-1-4b', vocabulary: 'numbers', text: "One, One, Four-bee, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-4b-numbers.wav'), durationMs: 2893 },
  { id: 'ca-1-1-4b-techniques', combination: '1-1-4b', vocabulary: 'techniques', text: "Jab, Jab, Body rear hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-4b-techniques.wav'), durationMs: 2693 },
  { id: 'ca-1-1-step off-numbers', combination: '1-1-step off', vocabulary: 'numbers', text: "One, One, Step off, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-step off-numbers.wav'), durationMs: 2853 },
  { id: 'ca-1-1-step off-techniques', combination: '1-1-step off', vocabulary: 'techniques', text: "Jab, Jab, Step off, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-1-step off-techniques.wav'), durationMs: 2773 },
  { id: 'ca-1-2-numbers', combination: '1-2', vocabulary: 'numbers', text: "One, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-numbers.wav'), durationMs: 2293 },
  { id: 'ca-1-2-techniques', combination: '1-2', vocabulary: 'techniques', text: "Jab, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-techniques.wav'), durationMs: 1893 },
  { id: 'ca-1-2-1-numbers', combination: '1-2-1', vocabulary: 'numbers', text: "One, Two, One, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-1-numbers.wav'), durationMs: 2293 },
  { id: 'ca-1-2-1-techniques', combination: '1-2-1', vocabulary: 'techniques', text: "Jab, Cross, Jab, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-1-techniques.wav'), durationMs: 2333 },
  { id: 'ca-1-2-1-2-numbers', combination: '1-2-1-2', vocabulary: 'numbers', text: "One, Two, One, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-1-2-numbers.wav'), durationMs: 1973 },
  { id: 'ca-1-2-1-2-techniques', combination: '1-2-1-2', vocabulary: 'techniques', text: "Jab, Cross, Jab, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-1-2-techniques.wav'), durationMs: 2693 },
  { id: 'ca-1-2-3-numbers', combination: '1-2-3', vocabulary: 'numbers', text: "One, Two, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-numbers.wav'), durationMs: 2733 },
  { id: 'ca-1-2-3-techniques', combination: '1-2-3', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-techniques.wav'), durationMs: 2253 },
  { id: 'ca-1-2-3-2-numbers', combination: '1-2-3-2', vocabulary: 'numbers', text: "One, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-2-numbers.wav'), durationMs: 2293 },
  { id: 'ca-1-2-3-2-techniques', combination: '1-2-3-2', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-2-techniques.wav'), durationMs: 3213 },
  { id: 'ca-1-2-3-2-1-numbers', combination: '1-2-3-2-1', vocabulary: 'numbers', text: "One, Two, Three, Two, One, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-2-1-numbers.wav'), durationMs: 3293 },
  { id: 'ca-1-2-3-2-1-techniques', combination: '1-2-3-2-1', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, Cross, Jab, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-2-1-techniques.wav'), durationMs: 3293 },
  { id: 'ca-1-2-3-2-3-numbers', combination: '1-2-3-2-3', vocabulary: 'numbers', text: "One, Two, Three, Two, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-2-3-numbers.wav'), durationMs: 2773 },
  { id: 'ca-1-2-3-2-3-techniques', combination: '1-2-3-2-3', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, Cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-2-3-techniques.wav'), durationMs: 3333 },
  { id: 'ca-1-2-3-6-numbers', combination: '1-2-3-6', vocabulary: 'numbers', text: "One, Two, Three, Six, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-6-numbers.wav'), durationMs: 3093 },
  { id: 'ca-1-2-3-6-techniques', combination: '1-2-3-6', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, Rear uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-6-techniques.wav'), durationMs: 3213 },
  { id: 'ca-1-2-3-6-3-numbers', combination: '1-2-3-6-3', vocabulary: 'numbers', text: "One, Two, Three, Six, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-6-3-numbers.wav'), durationMs: 2253 },
  { id: 'ca-1-2-3-6-3-techniques', combination: '1-2-3-6-3', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, Rear uppercut, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-6-3-techniques.wav'), durationMs: 3293 },
  { id: 'ca-1-2-3-6-3-2-numbers', combination: '1-2-3-6-3-2', vocabulary: 'numbers', text: "One, Two, Three, Six, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-6-3-2-numbers.wav'), durationMs: 2613 },
  { id: 'ca-1-2-3-6-3-2-techniques', combination: '1-2-3-6-3-2', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, Rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-6-3-2-techniques.wav'), durationMs: 3893 },
  { id: 'ca-1-2-3-6-3-2-3-2-numbers', combination: '1-2-3-6-3-2-3-2', vocabulary: 'numbers', text: "One, Two, Three, Six, Three, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-6-3-2-3-2-numbers.wav'), durationMs: 3373 },
  { id: 'ca-1-2-3-6-3-2-3-2-techniques', combination: '1-2-3-6-3-2-3-2', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, Rear uppercut, Lead hook, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-6-3-2-3-2-techniques.wav'), durationMs: 5253 },
  { id: 'ca-1-2-3-pivot-numbers', combination: '1-2-3-pivot', vocabulary: 'numbers', text: "One, Two, Three, Pivot, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-pivot-numbers.wav'), durationMs: 2333 },
  { id: 'ca-1-2-3-pivot-techniques', combination: '1-2-3-pivot', vocabulary: 'techniques', text: "Jab, Cross, Lead hook, Pivot, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3-pivot-techniques.wav'), durationMs: 3373 },
  { id: 'ca-1-2-3b-numbers', combination: '1-2-3b', vocabulary: 'numbers', text: "One, Two, Three-bee, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-numbers.wav'), durationMs: 3293 },
  { id: 'ca-1-2-3b-techniques', combination: '1-2-3b', vocabulary: 'techniques', text: "Jab, Cross, Body lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-techniques.wav'), durationMs: 2453 },
  { id: 'ca-1-2-3b-2-numbers', combination: '1-2-3b-2', vocabulary: 'numbers', text: "One, Two, Three-bee, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-2-numbers.wav'), durationMs: 3413 },
  { id: 'ca-1-2-3b-2-techniques', combination: '1-2-3b-2', vocabulary: 'techniques', text: "Jab, Cross, Body lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-2-techniques.wav'), durationMs: 3293 },
  { id: 'ca-1-2-3b-3-numbers', combination: '1-2-3b-3', vocabulary: 'numbers', text: "One, Two, Three-bee, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-3-numbers.wav'), durationMs: 2173 },
  { id: 'ca-1-2-3b-3-techniques', combination: '1-2-3b-3', vocabulary: 'techniques', text: "Jab, Cross, Body lead hook, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-3-techniques.wav'), durationMs: 3013 },
  { id: 'ca-1-2-3b-3-2-numbers', combination: '1-2-3b-3-2', vocabulary: 'numbers', text: "One, Two, Three-bee, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-3-2-numbers.wav'), durationMs: 3293 },
  { id: 'ca-1-2-3b-3-2-techniques', combination: '1-2-3b-3-2', vocabulary: 'techniques', text: "Jab, Cross, Body lead hook, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-3-2-techniques.wav'), durationMs: 3413 },
  { id: 'ca-1-2-3b-6-3-2-5-2-numbers', combination: '1-2-3b-6-3-2-5-2', vocabulary: 'numbers', text: "One, Two, Three-bee, Six, Three, Two, Five, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-6-3-2-5-2-numbers.wav'), durationMs: 3613 },
  { id: 'ca-1-2-3b-6-3-2-5-2-techniques', combination: '1-2-3b-6-3-2-5-2', vocabulary: 'techniques', text: "Jab, Cross, Body lead hook, Rear uppercut, Lead hook, Cross, Lead uppercut, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-3b-6-3-2-5-2-techniques.wav'), durationMs: 4333 },
  { id: 'ca-1-2-4-3-2-numbers', combination: '1-2-4-3-2', vocabulary: 'numbers', text: "One, Two, Four, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-4-3-2-numbers.wav'), durationMs: 2773 },
  { id: 'ca-1-2-4-3-2-techniques', combination: '1-2-4-3-2', vocabulary: 'techniques', text: "Jab, Cross, Rear hook, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-4-3-2-techniques.wav'), durationMs: 3293 },
  { id: 'ca-1-2-4-3-6-3-2-numbers', combination: '1-2-4-3-6-3-2', vocabulary: 'numbers', text: "One, Two, Four, Three, Six, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-4-3-6-3-2-numbers.wav'), durationMs: 2893 },
  { id: 'ca-1-2-4-3-6-3-2-techniques', combination: '1-2-4-3-6-3-2', vocabulary: 'techniques', text: "Jab, Cross, Rear hook, Lead hook, Rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-4-3-6-3-2-techniques.wav'), durationMs: 4093 },
  { id: 'ca-1-2-5-numbers', combination: '1-2-5', vocabulary: 'numbers', text: "One, Two, Five, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-numbers.wav'), durationMs: 2253 },
  { id: 'ca-1-2-5-techniques', combination: '1-2-5', vocabulary: 'techniques', text: "Jab, Cross, Lead uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-techniques.wav'), durationMs: 2613 },
  { id: 'ca-1-2-5-6-numbers', combination: '1-2-5-6', vocabulary: 'numbers', text: "One, Two, Five, Six, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-6-numbers.wav'), durationMs: 2693 },
  { id: 'ca-1-2-5-6-techniques', combination: '1-2-5-6', vocabulary: 'techniques', text: "Jab, Cross, Lead uppercut, Rear uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-6-techniques.wav'), durationMs: 3013 },
  { id: 'ca-1-2-5-6-3-numbers', combination: '1-2-5-6-3', vocabulary: 'numbers', text: "One, Two, Five, Six, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-6-3-numbers.wav'), durationMs: 2893 },
  { id: 'ca-1-2-5-6-3-techniques', combination: '1-2-5-6-3', vocabulary: 'techniques', text: "Jab, Cross, Lead uppercut, Rear uppercut, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-6-3-techniques.wav'), durationMs: 3533 },
  { id: 'ca-1-2-5-6-3-2-numbers', combination: '1-2-5-6-3-2', vocabulary: 'numbers', text: "One, Two, Five, Six, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-6-3-2-numbers.wav'), durationMs: 3213 },
  { id: 'ca-1-2-5-6-3-2-techniques', combination: '1-2-5-6-3-2', vocabulary: 'techniques', text: "Jab, Cross, Lead uppercut, Rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-6-3-2-techniques.wav'), durationMs: 4053 },
  { id: 'ca-1-2-5-6-3-2-3-2-numbers', combination: '1-2-5-6-3-2-3-2', vocabulary: 'numbers', text: "One, Two, Five, Six, Three, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-6-3-2-3-2-numbers.wav'), durationMs: 3373 },
  { id: 'ca-1-2-5-6-3-2-3-2-techniques', combination: '1-2-5-6-3-2-3-2', vocabulary: 'techniques', text: "Jab, Cross, Lead uppercut, Rear uppercut, Lead hook, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5-6-3-2-3-2-techniques.wav'), durationMs: 4972 },
  { id: 'ca-1-2-5b-6b-3-2-numbers', combination: '1-2-5b-6b-3-2', vocabulary: 'numbers', text: "One, Two, Five-bee, Six-bee, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5b-6b-3-2-numbers.wav'), durationMs: 2933 },
  { id: 'ca-1-2-5b-6b-3-2-techniques', combination: '1-2-5b-6b-3-2', vocabulary: 'techniques', text: "Jab, Cross, Body lead uppercut, Body rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-5b-6b-3-2-techniques.wav'), durationMs: 4653 },
  { id: 'ca-1-2-6b-3-2-numbers', combination: '1-2-6b-3-2', vocabulary: 'numbers', text: "One, Two, Six-bee, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-6b-3-2-numbers.wav'), durationMs: 3333 },
  { id: 'ca-1-2-6b-3-2-techniques', combination: '1-2-6b-3-2', vocabulary: 'techniques', text: "Jab, Cross, Body rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-6b-3-2-techniques.wav'), durationMs: 3773 },
  { id: 'ca-1-2-circle-numbers', combination: '1-2-circle', vocabulary: 'numbers', text: "One, Two, Circle, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-circle-numbers.wav'), durationMs: 2813 },
  { id: 'ca-1-2-circle-techniques', combination: '1-2-circle', vocabulary: 'techniques', text: "Jab, Cross, Circle, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-circle-techniques.wav'), durationMs: 2973 },
  { id: 'ca-1-2-pivot-numbers', combination: '1-2-pivot', vocabulary: 'numbers', text: "One, Two, Pivot, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-pivot-numbers.wav'), durationMs: 1933 },
  { id: 'ca-1-2-pivot-techniques', combination: '1-2-pivot', vocabulary: 'techniques', text: "Jab, Cross, Pivot, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2-pivot-techniques.wav'), durationMs: 1973 },
  { id: 'ca-1-2b-numbers', combination: '1-2b', vocabulary: 'numbers', text: "One, Two-bee, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-numbers.wav'), durationMs: 2533 },
  { id: 'ca-1-2b-techniques', combination: '1-2b', vocabulary: 'techniques', text: "Jab, Body cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-techniques.wav'), durationMs: 2971 },
  { id: 'ca-1-2b-3-numbers', combination: '1-2b-3', vocabulary: 'numbers', text: "One, Two-bee, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-numbers.wav'), durationMs: 1853 },
  { id: 'ca-1-2b-3-techniques', combination: '1-2b-3', vocabulary: 'techniques', text: "Jab, Body cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-techniques.wav'), durationMs: 3213 },
  { id: 'ca-1-2b-3-2-numbers', combination: '1-2b-3-2', vocabulary: 'numbers', text: "One, Two-bee, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-2-numbers.wav'), durationMs: 2813 },
  { id: 'ca-1-2b-3-2-techniques', combination: '1-2b-3-2', vocabulary: 'techniques', text: "Jab, Body cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-2-techniques.wav'), durationMs: 3213 },
  { id: 'ca-1-2b-3-2-5b-numbers', combination: '1-2b-3-2-5b', vocabulary: 'numbers', text: "One, Two-bee, Three, Two, Five-bee, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-2-5b-numbers.wav'), durationMs: 2653 },
  { id: 'ca-1-2b-3-2-5b-techniques', combination: '1-2b-3-2-5b', vocabulary: 'techniques', text: "Jab, Body cross, Lead hook, Cross, Body lead uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-2-5b-techniques.wav'), durationMs: 3453 },
  { id: 'ca-1-2b-3-2-5b-2-numbers', combination: '1-2b-3-2-5b-2', vocabulary: 'numbers', text: "One, Two-bee, Three, Two, Five-bee, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-2-5b-2-numbers.wav'), durationMs: 2653 },
  { id: 'ca-1-2b-3-2-5b-2-techniques', combination: '1-2b-3-2-5b-2', vocabulary: 'techniques', text: "Jab, Body cross, Lead hook, Cross, Body lead uppercut, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-2-5b-2-techniques.wav'), durationMs: 4133 },
  { id: 'ca-1-2b-3-2b-numbers', combination: '1-2b-3-2b', vocabulary: 'numbers', text: "One, Two-bee, Three, Two-bee, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-2b-numbers.wav'), durationMs: 2933 },
  { id: 'ca-1-2b-3-2b-techniques', combination: '1-2b-3-2b', vocabulary: 'techniques', text: "Jab, Body cross, Lead hook, Body cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3-2b-techniques.wav'), durationMs: 3453 },
  { id: 'ca-1-2b-3b-2-3-2-numbers', combination: '1-2b-3b-2-3-2', vocabulary: 'numbers', text: "One, Two-bee, Three-bee, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3b-2-3-2-numbers.wav'), durationMs: 3452 },
  { id: 'ca-1-2b-3b-2-3-2-techniques', combination: '1-2b-3b-2-3-2', vocabulary: 'techniques', text: "Jab, Body cross, Body lead hook, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-2b-3b-2-3-2-techniques.wav'), durationMs: 4253 },
  { id: 'ca-1-3-numbers', combination: '1-3', vocabulary: 'numbers', text: "One, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-numbers.wav'), durationMs: 2053 },
  { id: 'ca-1-3-techniques', combination: '1-3', vocabulary: 'techniques', text: "Jab, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-techniques.wav'), durationMs: 2253 },
  { id: 'ca-1-3-2-numbers', combination: '1-3-2', vocabulary: 'numbers', text: "One, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-2-numbers.wav'), durationMs: 2253 },
  { id: 'ca-1-3-2-techniques', combination: '1-3-2', vocabulary: 'techniques', text: "Jab, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-2-techniques.wav'), durationMs: 2373 },
  { id: 'ca-1-3-2-3-numbers', combination: '1-3-2-3', vocabulary: 'numbers', text: "One, Three, Two, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-2-3-numbers.wav'), durationMs: 3133 },
  { id: 'ca-1-3-2-3-techniques', combination: '1-3-2-3', vocabulary: 'techniques', text: "Jab, Lead hook, Cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-2-3-techniques.wav'), durationMs: 3293 },
  { id: 'ca-1-3-2-3-2-numbers', combination: '1-3-2-3-2', vocabulary: 'numbers', text: "One, Three, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-2-3-2-numbers.wav'), durationMs: 2933 },
  { id: 'ca-1-3-2-3-2-techniques', combination: '1-3-2-3-2', vocabulary: 'techniques', text: "Jab, Lead hook, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-2-3-2-techniques.wav'), durationMs: 3293 },
  { id: 'ca-1-3-2-5-2-3-2-numbers', combination: '1-3-2-5-2-3-2', vocabulary: 'numbers', text: "One, Three, Two, Five, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-2-5-2-3-2-numbers.wav'), durationMs: 2933 },
  { id: 'ca-1-3-2-5-2-3-2-techniques', combination: '1-3-2-5-2-3-2', vocabulary: 'techniques', text: "Jab, Lead hook, Cross, Lead uppercut, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-2-5-2-3-2-techniques.wav'), durationMs: 4853 },
  { id: 'ca-1-3-6-numbers', combination: '1-3-6', vocabulary: 'numbers', text: "One, Three, Six, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-6-numbers.wav'), durationMs: 2599 },
  { id: 'ca-1-3-6-techniques', combination: '1-3-6', vocabulary: 'techniques', text: "Jab, Lead hook, Rear uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-3-6-techniques.wav'), durationMs: 3053 },
  { id: 'ca-1-4-numbers', combination: '1-4', vocabulary: 'numbers', text: "One, Four, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-numbers.wav'), durationMs: 1893 },
  { id: 'ca-1-4-techniques', combination: '1-4', vocabulary: 'techniques', text: "Jab, Rear hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-techniques.wav'), durationMs: 1964 },
  { id: 'ca-1-4-2-numbers', combination: '1-4-2', vocabulary: 'numbers', text: "One, Four, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-numbers.wav'), durationMs: 2773 },
  { id: 'ca-1-4-2-techniques', combination: '1-4-2', vocabulary: 'techniques', text: "Jab, Rear hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-techniques.wav'), durationMs: 2653 },
  { id: 'ca-1-4-2-3-numbers', combination: '1-4-2-3', vocabulary: 'numbers', text: "One, Four, Two, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-numbers.wav'), durationMs: 2813 },
  { id: 'ca-1-4-2-3-techniques', combination: '1-4-2-3', vocabulary: 'techniques', text: "Jab, Rear hook, Cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-techniques.wav'), durationMs: 3133 },
  { id: 'ca-1-4-2-3-6-numbers', combination: '1-4-2-3-6', vocabulary: 'numbers', text: "One, Four, Two, Three, Six, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-6-numbers.wav'), durationMs: 2533 },
  { id: 'ca-1-4-2-3-6-techniques', combination: '1-4-2-3-6', vocabulary: 'techniques', text: "Jab, Rear hook, Cross, Lead hook, Rear uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-6-techniques.wav'), durationMs: 3493 },
  { id: 'ca-1-4-2-3-6-5-numbers', combination: '1-4-2-3-6-5', vocabulary: 'numbers', text: "One, Four, Two, Three, Six, Five, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-6-5-numbers.wav'), durationMs: 3413 },
  { id: 'ca-1-4-2-3-6-5-techniques', combination: '1-4-2-3-6-5', vocabulary: 'techniques', text: "Jab, Rear hook, Cross, Lead hook, Rear uppercut, Lead uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-6-5-techniques.wav'), durationMs: 4413 },
  { id: 'ca-1-4-2-3-6-5-2-numbers', combination: '1-4-2-3-6-5-2', vocabulary: 'numbers', text: "One, Four, Two, Three, Six, Five, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-6-5-2-numbers.wav'), durationMs: 3453 },
  { id: 'ca-1-4-2-3-6-5-2-techniques', combination: '1-4-2-3-6-5-2', vocabulary: 'techniques', text: "Jab, Rear hook, Cross, Lead hook, Rear uppercut, Lead uppercut, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-6-5-2-techniques.wav'), durationMs: 5453 },
  { id: 'ca-1-4-2-3-6-5-3-2-numbers', combination: '1-4-2-3-6-5-3-2', vocabulary: 'numbers', text: "One, Four, Two, Three, Six, Five, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-6-5-3-2-numbers.wav'), durationMs: 3333 },
  { id: 'ca-1-4-2-3-6-5-3-2-techniques', combination: '1-4-2-3-6-5-3-2', vocabulary: 'techniques', text: "Jab, Rear hook, Cross, Lead hook, Rear uppercut, Lead uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-2-3-6-5-3-2-techniques.wav'), durationMs: 5693 },
  { id: 'ca-1-4-3-2-numbers', combination: '1-4-3-2', vocabulary: 'numbers', text: "One, Four, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-3-2-numbers.wav'), durationMs: 2413 },
  { id: 'ca-1-4-3-2-techniques', combination: '1-4-3-2', vocabulary: 'techniques', text: "Jab, Rear hook, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-4-3-2-techniques.wav'), durationMs: 3053 },
  { id: 'ca-1-5-numbers', combination: '1-5', vocabulary: 'numbers', text: "One, Five, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-5-numbers.wav'), durationMs: 1613 },
  { id: 'ca-1-5-techniques', combination: '1-5', vocabulary: 'techniques', text: "Jab, Lead uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-5-techniques.wav'), durationMs: 1933 },
  { id: 'ca-1-5-2-numbers', combination: '1-5-2', vocabulary: 'numbers', text: "One, Five, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-5-2-numbers.wav'), durationMs: 2053 },
  { id: 'ca-1-5-2-techniques', combination: '1-5-2', vocabulary: 'techniques', text: "Jab, Lead uppercut, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-5-2-techniques.wav'), durationMs: 2173 },
  { id: 'ca-1-5-2-3-2-numbers', combination: '1-5-2-3-2', vocabulary: 'numbers', text: "One, Five, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-5-2-3-2-numbers.wav'), durationMs: 3253 },
  { id: 'ca-1-5-2-3-2-techniques', combination: '1-5-2-3-2', vocabulary: 'techniques', text: "Jab, Lead uppercut, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-5-2-3-2-techniques.wav'), durationMs: 3293 },
  { id: 'ca-1-5-2-3b-3-2-numbers', combination: '1-5-2-3b-3-2', vocabulary: 'numbers', text: "One, Five, Two, Three-bee, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-5-2-3b-3-2-numbers.wav'), durationMs: 3373 },
  { id: 'ca-1-5-2-3b-3-2-techniques', combination: '1-5-2-3b-3-2', vocabulary: 'techniques', text: "Jab, Lead uppercut, Cross, Body lead hook, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-5-2-3b-3-2-techniques.wav'), durationMs: 3493 },
  { id: 'ca-1-6-numbers', combination: '1-6', vocabulary: 'numbers', text: "One, Six, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-6-numbers.wav'), durationMs: 1893 },
  { id: 'ca-1-6-techniques', combination: '1-6', vocabulary: 'techniques', text: "Jab, Rear uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-6-techniques.wav'), durationMs: 2373 },
  { id: 'ca-1-6-3-numbers', combination: '1-6-3', vocabulary: 'numbers', text: "One, Six, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-6-3-numbers.wav'), durationMs: 2293 },
  { id: 'ca-1-6-3-techniques', combination: '1-6-3', vocabulary: 'techniques', text: "Jab, Rear uppercut, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-6-3-techniques.wav'), durationMs: 2773 },
  { id: 'ca-1-6-3-2-numbers', combination: '1-6-3-2', vocabulary: 'numbers', text: "One, Six, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-6-3-2-numbers.wav'), durationMs: 2333 },
  { id: 'ca-1-6-3-2-techniques', combination: '1-6-3-2', vocabulary: 'techniques', text: "Jab, Rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-6-3-2-techniques.wav'), durationMs: 3173 },
  { id: 'ca-1-6-3-2-5-2-numbers', combination: '1-6-3-2-5-2', vocabulary: 'numbers', text: "One, Six, Three, Two, Five, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-6-3-2-5-2-numbers.wav'), durationMs: 3053 },
  { id: 'ca-1-6-3-2-5-2-techniques', combination: '1-6-3-2-5-2', vocabulary: 'techniques', text: "Jab, Rear uppercut, Lead hook, Cross, Lead uppercut, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1-6-3-2-5-2-techniques.wav'), durationMs: 4093 },
  { id: 'ca-1b-1-2-numbers', combination: '1b-1-2', vocabulary: 'numbers', text: "One-bee, One, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-1-2-numbers.wav'), durationMs: 2693 },
  { id: 'ca-1b-1-2-techniques', combination: '1b-1-2', vocabulary: 'techniques', text: "Body jab, Jab, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-1-2-techniques.wav'), durationMs: 2773 },
  { id: 'ca-1b-1-2-3-6-3-2-numbers', combination: '1b-1-2-3-6-3-2', vocabulary: 'numbers', text: "One-bee, One, Two, Three, Six, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-1-2-3-6-3-2-numbers.wav'), durationMs: 3333 },
  { id: 'ca-1b-1-2-3-6-3-2-techniques', combination: '1b-1-2-3-6-3-2', vocabulary: 'techniques', text: "Body jab, Jab, Cross, Lead hook, Rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-1-2-3-6-3-2-techniques.wav'), durationMs: 4373 },
  { id: 'ca-1b-1-2-5-2-numbers', combination: '1b-1-2-5-2', vocabulary: 'numbers', text: "One-bee, One, Two, Five, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-1-2-5-2-numbers.wav'), durationMs: 3253 },
  { id: 'ca-1b-1-2-5-2-techniques', combination: '1b-1-2-5-2', vocabulary: 'techniques', text: "Body jab, Jab, Cross, Lead uppercut, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-1-2-5-2-techniques.wav'), durationMs: 3613 },
  { id: 'ca-1b-2-numbers', combination: '1b-2', vocabulary: 'numbers', text: "One-bee, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2-numbers.wav'), durationMs: 1893 },
  { id: 'ca-1b-2-techniques', combination: '1b-2', vocabulary: 'techniques', text: "Body jab, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2-techniques.wav'), durationMs: 1925 },
  { id: 'ca-1b-2-3-numbers', combination: '1b-2-3', vocabulary: 'numbers', text: "One-bee, Two, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2-3-numbers.wav'), durationMs: 3453 },
  { id: 'ca-1b-2-3-techniques', combination: '1b-2-3', vocabulary: 'techniques', text: "Body jab, Cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2-3-techniques.wav'), durationMs: 2693 },
  { id: 'ca-1b-2-3-2-numbers', combination: '1b-2-3-2', vocabulary: 'numbers', text: "One-bee, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2-3-2-numbers.wav'), durationMs: 3493 },
  { id: 'ca-1b-2-3-2-techniques', combination: '1b-2-3-2', vocabulary: 'techniques', text: "Body jab, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2-3-2-techniques.wav'), durationMs: 3213 },
  { id: 'ca-1b-2-3-2b-3-2-numbers', combination: '1b-2-3-2b-3-2', vocabulary: 'numbers', text: "One-bee, Two, Three, Two-bee, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2-3-2b-3-2-numbers.wav'), durationMs: 3493 },
  { id: 'ca-1b-2-3-2b-3-2-techniques', combination: '1b-2-3-2b-3-2', vocabulary: 'techniques', text: "Body jab, Cross, Lead hook, Body cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2-3-2b-3-2-techniques.wav'), durationMs: 4453 },
  { id: 'ca-1b-2b-numbers', combination: '1b-2b', vocabulary: 'numbers', text: "One-bee, Two-bee, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-numbers.wav'), durationMs: 3173 },
  { id: 'ca-1b-2b-techniques', combination: '1b-2b', vocabulary: 'techniques', text: "Body jab, Body cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-techniques.wav'), durationMs: 2373 },
  { id: 'ca-1b-2b-3-numbers', combination: '1b-2b-3', vocabulary: 'numbers', text: "One-bee, Two-bee, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-3-numbers.wav'), durationMs: 1893 },
  { id: 'ca-1b-2b-3-techniques', combination: '1b-2b-3', vocabulary: 'techniques', text: "Body jab, Body cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-3-techniques.wav'), durationMs: 3453 },
  { id: 'ca-1b-2b-3-2-numbers', combination: '1b-2b-3-2', vocabulary: 'numbers', text: "One-bee, Two-bee, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-3-2-numbers.wav'), durationMs: 3053 },
  { id: 'ca-1b-2b-3-2-techniques', combination: '1b-2b-3-2', vocabulary: 'techniques', text: "Body jab, Body cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-3-2-techniques.wav'), durationMs: 3493 },
  { id: 'ca-1b-2b-3-6-numbers', combination: '1b-2b-3-6', vocabulary: 'numbers', text: "One-bee, Two-bee, Three, Six, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-3-6-numbers.wav'), durationMs: 3053 },
  { id: 'ca-1b-2b-3-6-techniques', combination: '1b-2b-3-6', vocabulary: 'techniques', text: "Body jab, Body cross, Lead hook, Rear uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-3-6-techniques.wav'), durationMs: 3613 },
  { id: 'ca-1b-2b-3-6-3-2-numbers', combination: '1b-2b-3-6-3-2', vocabulary: 'numbers', text: "One-bee, Two-bee, Three, Six, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-3-6-3-2-numbers.wav'), durationMs: 3213 },
  { id: 'ca-1b-2b-3-6-3-2-techniques', combination: '1b-2b-3-6-3-2', vocabulary: 'techniques', text: "Body jab, Body cross, Lead hook, Rear uppercut, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-1b-2b-3-6-3-2-techniques.wav'), durationMs: 4213 },
  { id: 'ca-2-3-numbers', combination: '2-3', vocabulary: 'numbers', text: "Two, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-3-numbers.wav'), durationMs: 1573 },
  { id: 'ca-2-3-techniques', combination: '2-3', vocabulary: 'techniques', text: "Cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-3-techniques.wav'), durationMs: 2133 },
  { id: 'ca-2-3-2-numbers', combination: '2-3-2', vocabulary: 'numbers', text: "Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-3-2-numbers.wav'), durationMs: 3013 },
  { id: 'ca-2-3-2-techniques', combination: '2-3-2', vocabulary: 'techniques', text: "Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-3-2-techniques.wav'), durationMs: 2452 },
  { id: 'ca-2-3-6-numbers', combination: '2-3-6', vocabulary: 'numbers', text: "Two, Three, Six, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-3-6-numbers.wav'), durationMs: 2333 },
  { id: 'ca-2-3-6-techniques', combination: '2-3-6', vocabulary: 'techniques', text: "Cross, Lead hook, Rear uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-3-6-techniques.wav'), durationMs: 2813 },
  { id: 'ca-2-3b-5-numbers', combination: '2-3b-5', vocabulary: 'numbers', text: "Two, Three-bee, Five, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-3b-5-numbers.wav'), durationMs: 3013 },
  { id: 'ca-2-3b-5-techniques', combination: '2-3b-5', vocabulary: 'techniques', text: "Cross, Body lead hook, Lead uppercut, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-3b-5-techniques.wav'), durationMs: 3093 },
  { id: 'ca-2-6-3-numbers', combination: '2-6-3', vocabulary: 'numbers', text: "Two, Six, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-6-3-numbers.wav'), durationMs: 3173 },
  { id: 'ca-2-6-3-techniques', combination: '2-6-3', vocabulary: 'techniques', text: "Cross, Rear uppercut, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-2-6-3-techniques.wav'), durationMs: 3293 },
  { id: 'ca-3-2-numbers', combination: '3-2', vocabulary: 'numbers', text: "Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-3-2-numbers.wav'), durationMs: 1853 },
  { id: 'ca-3-2-techniques', combination: '3-2', vocabulary: 'techniques', text: "Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-3-2-techniques.wav'), durationMs: 1813 },
  { id: 'ca-bob and weave-3-2-numbers', combination: 'bob and weave-3-2', vocabulary: 'numbers', text: "bob and weave, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-bob and weave-3-2-numbers.wav'), durationMs: 3093 },
  { id: 'ca-bob and weave-3-2-techniques', combination: 'bob and weave-3-2', vocabulary: 'techniques', text: "bob and weave, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-bob and weave-3-2-techniques.wav'), durationMs: 2453 },
  { id: 'ca-duck-2-3-numbers', combination: 'duck-2-3', vocabulary: 'numbers', text: "Duck, Two, Three, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-duck-2-3-numbers.wav'), durationMs: 2293 },
  { id: 'ca-duck-2-3-techniques', combination: 'duck-2-3', vocabulary: 'techniques', text: "Duck, Cross, Lead hook, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-duck-2-3-techniques.wav'), durationMs: 3133 },
  { id: 'ca-pull-1-2-numbers', combination: 'pull-1-2', vocabulary: 'numbers', text: "Pull, One, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-pull-1-2-numbers.wav'), durationMs: 1813 },
  { id: 'ca-pull-1-2-techniques', combination: 'pull-1-2', vocabulary: 'techniques', text: "Pull, Jab, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-pull-1-2-techniques.wav'), durationMs: 2573 },
  { id: 'ca-roll-1-2-numbers', combination: 'roll-1-2', vocabulary: 'numbers', text: "Roll, One, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-roll-1-2-numbers.wav'), durationMs: 2213 },
  { id: 'ca-roll-1-2-techniques', combination: 'roll-1-2', vocabulary: 'techniques', text: "Roll, Jab, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-roll-1-2-techniques.wav'), durationMs: 1933 },
  { id: 'ca-roll-3-2-numbers', combination: 'roll-3-2', vocabulary: 'numbers', text: "Roll, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-roll-3-2-numbers.wav'), durationMs: 2613 },
  { id: 'ca-roll-3-2-techniques', combination: 'roll-3-2', vocabulary: 'techniques', text: "Roll, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-roll-3-2-techniques.wav'), durationMs: 2613 },
  { id: 'ca-slip-1-2-numbers', combination: 'slip-1-2', vocabulary: 'numbers', text: "Slip, One, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-slip-1-2-numbers.wav'), durationMs: 3453 },
  { id: 'ca-slip-1-2-techniques', combination: 'slip-1-2', vocabulary: 'techniques', text: "Slip, Jab, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-slip-1-2-techniques.wav'), durationMs: 1893 },
  { id: 'ca-slip-2-numbers', combination: 'slip-2', vocabulary: 'numbers', text: "Slip, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-slip-2-numbers.wav'), durationMs: 1853 },
  { id: 'ca-slip-2-techniques', combination: 'slip-2', vocabulary: 'techniques', text: "Slip, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-slip-2-techniques.wav'), durationMs: 1733 },
  { id: 'ca-slip-2-3-2-numbers', combination: 'slip-2-3-2', vocabulary: 'numbers', text: "Slip, Two, Three, Two, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-slip-2-3-2-numbers.wav'), durationMs: 2373 },
  { id: 'ca-slip-2-3-2-techniques', combination: 'slip-2-3-2', vocabulary: 'techniques', text: "Slip, Cross, Lead hook, Cross, go!", module: require('../../../assets/voice/combo-announces/cornerman/ca-slip-2-3-2-techniques.wav'), durationMs: 2853 },
]

/**
 * The announce clip for a combination at a vocabulary, or undefined
 * when the library has no rendering for it. A missing clip means the
 * announce-then-work block falls back to silence for that combo — the
 * runtime does not synthesize at runtime.
 */
export function findComboAnnounce(
  combination: string,
  vocabulary: CalloutVocabulary,
): ComboAnnounceClip | undefined {
  return COMBO_ANNOUNCE_CLIPS.find(
    (c) => c.combination === combination && c.vocabulary === vocabulary,
  )
}

/* eslint-enable @typescript-eslint/no-require-imports */
