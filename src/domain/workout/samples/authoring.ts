/**
 * Authoring helpers for hand-written sample workouts (M31-05).
 *
 * Samples must not contain hand-typed millisecond literals: every block and
 * round duration derives from beats through M31-02, so a sample authored at
 * one cadence stays correct if its profile changes. These helpers are what
 * make that practical — without them each block would need three
 * hand-computed numbers that could silently drift from its tokens.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { beatsToMs, blockDurationMs } from '../cadence'
import {
  parseCombo,
  type BlockKind,
  type BlockStance,
  type SetupCallout,
  type WorkoutBlock,
  type WorkoutToken,
} from '../WorkoutTokens'

export interface BlockSpec {
  id: string
  kind: BlockKind
  /** Combo notation, e.g. `'1-2b-3'`. Parsed via `parseCombo` (D10). */
  notation: string
  /**
   * Musical beat offsets, one per token, replacing `parseCombo`'s
   * placeholder 0,1,2,… sequence. Omit for evenly-spaced tokens.
   */
  offsets?: number[]
  /** Trailing gap before the next block, in beats (D5). */
  gapBeats: number
  /** Repetitions. Only valid on `repeated-combo` (validator enforces this). */
  repeat?: number
  stance?: BlockStance
  spokenPhrase?: string
  instruction?: string
  /**
   * For `volume-burst` / `open-pressure`, where output is measured by count
   * rather than enumerated tokens — doc §14 calls these essential for high
   * punch-count targets.
   */
  targetPunches?: number
  targetVelocityZone?: 1 | 2 | 3 | 4
  /**
   * Explicit block length in beats, overriding the token-derived duration.
   *
   * Needed by `volume-burst` and `open-pressure`, which run for a fixed
   * window and are measured by tracker count rather than by prescribing
   * every punch (doc §14). Their token list is a motif to repeat, not an
   * enumeration, so its last beat offset says nothing about how long the
   * block runs.
   */
  durationBeats?: number
  /** Voice cadence band for this block (M4) — see WorkoutBlock.cadence. */
  cadence?: string
  /**
   * Quiet lead-in laid BEFORE this block starts (Set Ceremonies): the
   * fill reserves the time a pre-set call-out needs, because inter-set
   * quiet is otherwise ≤3s and no ceremony fits. Span accounting folds
   * it in automatically — `layBlocks` advances the cursor first.
   */
  leadInBeats?: number
  /** The pre-set call-out this block earned — see setupCallouts.ts. */
  setupCallout?: SetupCallout
}

/** Apply authored musical offsets over the parser's placeholder sequence. */
function withOffsets(tokens: WorkoutToken[], offsets?: readonly number[]): WorkoutToken[] {
  if (!offsets) return tokens
  if (offsets.length !== tokens.length) {
    throw new Error(
      `offsets length ${offsets.length} does not match token count ${tokens.length}`,
    )
  }
  return tokens.map((token, i) => ({ ...token, beatOffset: offsets[i] as number }))
}

/**
 * Lay a list of block specs end to end from the start of a round.
 *
 * Each block's `startOffsetMs` is the running total of everything before it.
 * Because `blockDurationMs` already includes the trailing `gapBeats`, blocks
 * laid this way never overlap.
 */
export function layBlocks(specs: readonly BlockSpec[], bpm: number): WorkoutBlock[] {
  const blocks: WorkoutBlock[] = []
  let cursorMs = 0

  for (const spec of specs) {
    // A ceremony reservation is empty laid time before the block — the
    // set's own rhythm (reps, gaps) is untouched by its announcement.
    cursorMs += beatsToMs(spec.leadInBeats ?? 0, bpm)
    const tokens = withOffsets(parseCombo(spec.notation), spec.offsets)
    const repeat = spec.repeat ?? 1
    const durationMs =
      spec.durationBeats !== undefined
        ? beatsToMs(spec.durationBeats, bpm)
        : blockDurationMs(tokens, spec.gapBeats, bpm) * repeat

    const block: WorkoutBlock = {
      id: spec.id,
      kind: spec.kind,
      startOffsetMs: cursorMs,
      durationMs,
      stance: spec.stance ?? 'inherit',
      tokens,
      gapBeats: spec.gapBeats,
    }
    if (spec.repeat !== undefined) block.repeat = spec.repeat
    if (spec.targetPunches !== undefined) block.targetPunches = spec.targetPunches
    if (spec.targetVelocityZone !== undefined) block.targetVelocityZone = spec.targetVelocityZone
    if (spec.spokenPhrase !== undefined) block.spokenPhrase = spec.spokenPhrase
    if (spec.instruction !== undefined) block.instruction = spec.instruction
    if (spec.cadence !== undefined) block.cadence = spec.cadence
    if (spec.setupCallout !== undefined) block.setupCallout = spec.setupCallout

    blocks.push(block)
    cursorMs += durationMs
  }

  return blocks
}

/**
 * Punches a block contributes to a round target.
 *
 * Enumerated punch tokens times the repeat count, unless the block declares
 * `targetPunches` — volume-burst and open-pressure blocks measure output by
 * tracker count rather than by prescribing every punch (doc §14), so their
 * declared target is authoritative.
 */
/**
 * Stamp `voicePolicy` on every block in the list.
 *
 * The M39-V1c bulk-flip helper (Kyle 2026-08-30): sprint + pressure
 * samples flip every one of their blocks to `announce-then-work` so
 * the coach speaks once at the block's first cue and stays silent on
 * interior reps while rings still march to the CueEngine grid. See
 * `CueAnnouncer.announce` + `WorkoutBlock.voicePolicy`.
 *
 * Mutates in place — the samples build blocks then pass them through
 * this helper as the last step, so the "one place to flip a whole
 * sample" lever is right there in the recipe file.
 */
export function withVoicePolicy(
  blocks: WorkoutBlock[],
  voicePolicy: WorkoutBlock['voicePolicy'],
): WorkoutBlock[] {
  for (const block of blocks) {
    block.voicePolicy = voicePolicy
  }
  return blocks
}

export function blockPunchCount(block: WorkoutBlock): number {
  if (block.targetPunches !== undefined) return block.targetPunches
  const enumerated = block.tokens.filter((t) => t.kind === 'punch').length
  return enumerated * (block.repeat ?? 1)
}

/** Total punches a round's blocks prescribe. */
export function roundPunchCount(blocks: readonly WorkoutBlock[]): number {
  return blocks.reduce((sum, b) => sum + blockPunchCount(b), 0)
}

/** Milliseconds consumed by a laid-out block list. */
export function blocksSpanMs(blocks: readonly WorkoutBlock[]): number {
  if (blocks.length === 0) return 0
  const last = blocks[blocks.length - 1] as WorkoutBlock
  return last.startOffsetMs + last.durationMs
}

/**
 * A3 (#258): after laying a sample's blocks, top the round off with a
 * count-scored pressure repetition of `padMotif` so the coach never
 * runs out of work before the bell.
 *
 * Room-mic evidence from pace-pusher: hand-authored blocks cover only
 * 42-48% of a 240 s round; the rest fell into the free-work fallback
 * with no rings and no coach. Rather than rewrite every sample by
 * hand, this helper appends ONE `volume-burst` block whose window is
 * exactly the gap between the blocks-so-far and
 * `workDurationMs - marginMs`. `targetPunches` is derived from the
 * chosen `padMotif`'s spacing so the added block reads as continuous
 * pressure on the same rhythm the round already established.
 *
 * If the blocks already fill the round (or the gap is smaller than a
 * minimum burst), the input is returned unchanged.
 *
 * `padMotif`'s `gapBeats` sets the perceived rate — the sample chooses
 * a tighter value for late rounds and a roomier one for early. The
 * padder never touches earlier blocks; it only ever appends.
 */
export interface PadMotifSpec {
  id: string
  notation: string
  offsets?: readonly number[]
  gapBeats: number
  spokenPhrase?: string
  cadence?: string
  instruction?: string
}

/** Minimum burst window the padder is willing to emit; below this it drops the tail. */
export const PAD_MIN_BURST_MS = 4_000
/** Trailing quiet before the bell — one breath, not a hole. */
export const PAD_BELL_MARGIN_MS = 2_000

export function padBlocksToRound(
  blocks: WorkoutBlock[],
  bpm: number,
  workDurationMs: number,
  padMotif?: PadMotifSpec,
): WorkoutBlock[] {
  const span = blocksSpanMs(blocks)
  const gap = workDurationMs - PAD_BELL_MARGIN_MS - span
  if (gap < PAD_MIN_BURST_MS) return blocks

  // When no explicit padMotif is given, re-use the round's LAST block:
  // its tokens, gap and cadence are what the athlete was just working,
  // so the tail reads as continuous pressure rather than a genre-shift.
  // The last block's own id is namespaced with #pad so consumers can
  // tell the two apart in the timeline.
  const last = blocks[blocks.length - 1]
  const motif: PadMotifSpec =
    padMotif ??
    (last
      ? {
          id: last.id,
          notation: last.tokens
            .filter((t): t is Extract<WorkoutToken, { kind: 'punch' }> => t.kind === 'punch')
            .map((t) => `${t.number}${t.body ? 'b' : ''}`)
            .join('-'),
          offsets: last.tokens
            .filter((t) => t.kind === 'punch')
            .map((t) => t.beatOffset ?? 0),
          gapBeats: last.gapBeats,
          ...(last.cadence !== undefined ? { cadence: last.cadence } : {}),
          ...(last.spokenPhrase !== undefined ? { spokenPhrase: last.spokenPhrase } : {}),
        }
      : { id: 'pad', notation: '1', gapBeats: 1.5 })

  const tokens = withOffsets(parseCombo(motif.notation), motif.offsets)
  // Quantise the pad block's duration to a clean beat subdivision so
  // the "derives every duration from beats" sample test still passes.
  const SUBDIVISION_BEATS = 0.05
  const rawBeats = gap / beatsToMs(1, bpm)
  const durationBeats = Math.floor(rawBeats / SUBDIVISION_BEATS) * SUBDIVISION_BEATS
  // Don't Math.round — the "duration derives from beats" sample test
  // reverses this exact conversion at 1e-6 tolerance, and a rounded
  // ms figure fails at 85 BPM (0.05-beat subdivision = 35.29 ms).
  const durationMs = beatsToMs(durationBeats, bpm)
  const motifBeats =
    tokens[tokens.length - 1]?.beatOffset !== undefined
      ? (tokens[tokens.length - 1]!.beatOffset as number) + motif.gapBeats
      : motif.gapBeats
  const punchTokens = tokens.filter((t) => t.kind === 'punch').length
  const cycles = Math.max(1, Math.floor(durationBeats / Math.max(motifBeats, 0.25)))
  const targetPunches = cycles * punchTokens

  const block: WorkoutBlock = {
    id: `${motif.id}#pad`,
    kind: 'volume-burst',
    startOffsetMs: span,
    durationMs,
    // Inherit the last block's stance so switch-by-round's "every
    // block in a round shares a stance" invariant still holds.
    stance: last?.stance ?? 'inherit',
    tokens,
    gapBeats: motif.gapBeats,
    targetPunches,
  }
  if (motif.spokenPhrase !== undefined) block.spokenPhrase = motif.spokenPhrase
  if (motif.cadence !== undefined) block.cadence = motif.cadence
  if (motif.instruction !== undefined) block.instruction = motif.instruction
  return [...blocks, block]
}

/**
 * Author a sustained-strike block — one canonical strike pumped for a
 * fixed window (M39-V2 Phase 4b).
 *
 * The compiler resolves the coach line via
 * `sustainedClipFor({ token, vocabulary })` — one clip per (token,
 * vocabulary), pre-rendered CALM+teach+land. The block spec's
 * `notation` is the single token; `durationBeats` is what fixes the
 * window because the token-derived duration would be one repetition
 * of one punch (typically <1 beat).
 *
 * Rate: at 60 BPM steady and `gapBeats: 1`, a 60-second window pumps
 * ~60 punches; halving gapBeats doubles the rate. The default
 * `gapBeats: 1` matches the "pump every second" musical intent of
 * the render batch's asset text ("Pump the jab.").
 */
export function withSustainedStrike(spec: {
  id: string
  /** The canonical strike token ('1', '1b', '2', ..., '6b'). */
  token: string
  /** Block window in beats. Fixed — token-derived duration would be one punch. */
  durationBeats: number
  /** Beats between each pump (default 1 — "one per beat"). */
  gapBeats?: number
  stance?: BlockStance
  /** Vocabulary hint — the runtime picks numeric/technique per user setting. */
  cadence?: string
  /**
   * On-screen instruction, if different from what the sustained-instruction
   * clip already covers audibly. Rarely used — the whole point of a
   * sustained-strike is one clip covers the block.
   */
  instruction?: string
}): BlockSpec {
  return {
    id: spec.id,
    kind: 'sustained-strike',
    notation: spec.token,
    gapBeats: spec.gapBeats ?? 1,
    durationBeats: spec.durationBeats,
    ...(spec.stance !== undefined ? { stance: spec.stance } : {}),
    ...(spec.cadence !== undefined ? { cadence: spec.cadence } : {}),
    ...(spec.instruction !== undefined ? { instruction: spec.instruction } : {}),
  }
}

/** Convenience re-export so samples never import cadence directly. */
export { beatsToMs }
