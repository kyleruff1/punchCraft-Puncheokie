/**
 * The RhythmSpine — one per-token schedule that binds every output track.
 *
 * A live cue drives four tracks: numbers-vocab audio, techniques-vocab
 * audio, the ring row lighting, and the punch-avatar 2-frame flip.
 * Today `phraseTokenTimesMs ?? tokenOffsetsMs` is where each of those
 * consumers ALREADY re-derives per-token timing on its own — three
 * separate reads of the same reference, and any consumer that computes
 * a slightly different value drifts out of sync with the rest.
 *
 * The spine ends that: one compiled `SpineSchedule` per round, with a
 * `TokenBeat[]` per cue that consumers read directly. Vocabulary swaps
 * change WHICH clip plays, never WHEN a beat happens; both vocabularies
 * end word N at the same `audioEndMs`, computed from the numbers
 * clip's word-end times and shifted by a measured per-token offset for
 * techniques (see `RhythmSpine.audio`'s `AudioLayout`, planned for v2).
 *
 * v1 (this file) is deliberately narrow:
 *   * Per-cue `TokenBeat[]`, built from the same source of truth the
 *     cue engine and the avatar already read.
 *   * A `pulses` slot per cue, empty for now — bursts/coasts will
 *     populate it in A2 (issue #257).
 *   * An `AudioLayout` slot per cue, empty for now — A11/A12 wire the
 *     vocab-offset table in v2.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { CueInstance, RoundTimeline } from './CueTimeline'
import type { PunchHand, PunchType } from '../punch/PunchEvent'
import { findPhraseTiming, type PhraseTimingEntry } from './phraseTimingManifest'
/**
 * The rail's fixed offset between a word's audible end and the ring
 * lighting for that token. Kept as one constant so the spine, the
 * announcer's rail-placement math (`RhythmMap.RAIL_K_MS`) and any
 * mic-anchored analyzer share it.
 */
export const RAIL_K_MS = 120

/**
 * One beat inside a cue — the single reference every consumer reads.
 * All ms fields are round-relative absolute times, same clock as
 * `CueInstance.scheduledStartMs`.
 */
export interface TokenBeat {
  /** Index into `cue.tokens`. */
  tokenIndex: number
  /**
   * When the ring should light and the avatar should advance to
   * frame 1 (guard). Also the beat the athlete throws to.
   *
   * Derived from `cue.phraseTokenTimesMs?.[i] ?? cue.tokenOffsetsMs[i]`
   * plus `cue.scheduledStartMs`. This is exactly the same expression
   * `CueEngine.fireDueTokens` and `PunchAvatarCard` already use; the
   * spine centralises it.
   */
  atMs: number
  /**
   * When the coach's word for this token starts. For phrase-driven
   * cues (with `phraseTokenTimesMs`) this is
   * `atMs − RAIL_K_MS − (endOffsetMs − offsetMs)` — the word's onset
   * on the round clock. For beat-grid cues it collapses to `atMs`.
   */
  audioAtMs: number
  /**
   * When the coach's word for this token ENDS. The avatar's flip
   * to frame 2 (strike) targets this: motion arrives with the sound
   * finishing, so the impact reads as caused by the athlete's own
   * throw rather than by the announcer's syllable.
   */
  audioEndMs: number
  /** The hand the token calls for; `unknown` for non-punch tokens. */
  hand: PunchHand
  /** The punch family (cue-implied, not observed — D12), absent for non-punch tokens. */
  type?: PunchType
}

/**
 * Placeholder audio-layout — v2 will fill this with the paired
 * numbers/techniques asset keys + measured vocab offset per token.
 * Keeping the shape here now so downstream consumers can import
 * without needing to re-import once v2 lands.
 */
export interface AudioLayout {
  combination: string
  /** Vocab-specific asset key; string for now, canonicalised in v2. */
  numbersAssetKey?: string
  techniquesAssetKey?: string
}

/**
 * The compiled spine for one round.
 *
 * `beats[cueId]` is the token schedule; `pulses[cueId]` is the
 * count-scored motif that keeps rings alive during volume-burst /
 * open-pressure / active-recovery windows (populated in A2/#257);
 * `audio[cueId]` is the paired layout (populated in v2).
 */
export interface SpineSchedule {
  roundIndex: number
  beats: Record<string, TokenBeat[]>
  pulses: Record<string, TokenBeat[]>
  audio: Record<string, AudioLayout | null>
}

/**
 * Compile a `SpineSchedule` from an already-expanded `RoundTimeline`.
 *
 * Pure and cheap — regenerate on any timeline mutation. Does not
 * modify the input; produces a new `SpineSchedule` per call.
 */
export function compileRoundSpine(round: RoundTimeline): SpineSchedule {
  const beats: Record<string, TokenBeat[]> = {}
  const pulses: Record<string, TokenBeat[]> = {}
  const audio: Record<string, AudioLayout | null> = {}
  for (const cue of round.cues) {
    beats[cue.id] = beatsFor(cue)
    // A2/A11 land pulses + audio in follow-up work — the slots exist so
    // consumers can hard-code the read shape now.
    pulses[cue.id] = []
    audio[cue.id] = null
  }
  return { roundIndex: round.roundIndex, beats, pulses, audio }
}

/**
 * The per-token beat list for one cue.
 *
 * Reads `phraseTokenTimesMs` when present (the rail's per-word times),
 * `tokenOffsetsMs` otherwise (the beat grid) — same fallback the cue
 * engine at `CueEngine.fireDueTokens` uses, so the spine cannot drift
 * from the engine by construction.
 */
export function beatsFor(cue: CueInstance): TokenBeat[] {
  const offsets = cue.phraseTokenTimesMs ?? cue.tokenOffsetsMs
  const out: TokenBeat[] = []
  const timing = timingFor(cue)
  for (let i = 0; i < cue.tokens.length; i += 1) {
    const off = offsets[i]
    if (off === undefined) continue
    const atMs = cue.scheduledStartMs + off
    const token = cue.tokens[i]
    const expected =
      token?.kind === 'punch' ? cue.expectedPunches.find((p) => p.tokenIndex === i) : undefined
    const audio = audioTimesFor(timing, i, atMs)
    out.push({
      tokenIndex: i,
      atMs,
      audioAtMs: audio.audioAtMs,
      audioEndMs: audio.audioEndMs,
      hand: expected?.hand ?? 'unknown',
      ...(expected?.type ? { type: expected.type } : {}),
    })
  }
  return out
}

/**
 * The manifest entry for a cue, if the compiled phrase-timing manifest
 * has one. `undefined` for non-punch cues or missing renderings — the
 * caller then falls back to the beat grid.
 */
function timingFor(cue: CueInstance): PhraseTimingEntry | undefined {
  const cadence = cue.cadence
  if (!cadence) return undefined
  const combination = cue.tokens.map(tokenToNotation).join('-')
  return findPhraseTiming(combination, cadence)
}

function tokenToNotation(t: CueInstance['tokens'][number]): string {
  if (t.kind === 'punch') return `${t.number}${t.body ? 'b' : ''}`
  if (t.kind === 'defense') return t.command
  if (t.kind === 'footwork') return t.command
  if (t.kind === 'coach') return t.command
  return ''
}

/**
 * Derive the word's onset and end for token `i`, in the round clock,
 * from the phrase-timing manifest. Both vocabularies land word N at
 * the SAME `audioEndMs` — the manifest's `numbers.endMs` is the
 * source, and `techniques` follows via the measured `vocabOffsetMs`.
 *
 * When the manifest has no wordMarks for either vocab we collapse to
 * the beat grid: audioAtMs = audioEndMs = ring atMs. That is the same
 * fallback CueEngine.fireDueTokens uses today, so the spine cannot
 * drift from the engine.
 */
function audioTimesFor(
  timing: PhraseTimingEntry | undefined,
  tokenIndex: number,
  atMs: number,
): { audioAtMs: number; audioEndMs: number } {
  const vocab = timing?.numbers ?? timing?.techniques
  const word = vocab?.words[tokenIndex]
  if (!word) return { audioAtMs: atMs, audioEndMs: atMs }
  // atMs is placed so `word.endMs + RAIL_K_MS === ringTime` when the
  // rail is active. Invert to recover onset/end on the round clock.
  const audioEndMs = atMs - RAIL_K_MS
  const audioAtMs = audioEndMs - (word.endMs - word.onsetMs)
  return { audioAtMs, audioEndMs }
}
