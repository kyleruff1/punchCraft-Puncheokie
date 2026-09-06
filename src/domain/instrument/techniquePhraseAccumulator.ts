/**
 * The phrase accumulator (M40-21, technique-motif-design §12).
 *
 * One pulse — 960 transport ticks — collects the punches that become a
 * phrase. At most four contribute explicit operations; the rest raise
 * ENERGY (rule 11: more punches mean more gate/accent/depth, never more
 * notes). The window closes on a tick boundary and emits an ABSTRACT motif
 * (amendment 5) which the bridge resolves against the cell sounding at the
 * persistent-pattern commit.
 *
 * A pure fold, zoneQuantizer/latchedVoice style: the state is handed in and
 * back out, never held in the module — the same input sequence always
 * produces the same phrases (rule 12), which is what makes M45-01 replay
 * possible.
 */
import {
  compileAbstractMotif,
  MAX_EXPLICIT_PHRASE_PUNCHES,
  type AbstractTechniqueMotif,
  type PhrasePunch,
} from './techniqueMotif'
import { boundaryIndexAt, type QuantizationGrid } from './transportGrid'

/** One pulse at 60 BPM (design §12's phrase window). */
export const PHRASE_WINDOW_TICKS = 960

export interface PhraseAccumulatorState {
  /** Which phrase window the collected punches belong to. */
  windowIndex: number | null
  punches: readonly PhrasePunch[]
}

export function emptyPhraseState(): PhraseAccumulatorState {
  return { windowIndex: null, punches: [] }
}

export interface AccumulateResult {
  state: PhraseAccumulatorState
  /**
   * Emitted when a punch (or a tick advance) closes the PREVIOUS window.
   * The current phrase keeps collecting while this one plays.
   */
  closed: AbstractTechniqueMotif | null
}

const PHRASE_GRID: QuantizationGrid = { phaseTick: 0, intervalTicks: PHRASE_WINDOW_TICKS }

/**
 * Fold one punch in. A punch landing in a later window CLOSES the previous
 * one first — the closed phrase's motif is returned for commit while the
 * new punch opens the next phrase.
 */
export function accumulatePhrasePunch(
  state: PhraseAccumulatorState,
  punch: PhrasePunch,
  atTick: number,
): AccumulateResult {
  const windowIndex = boundaryIndexAt(atTick, PHRASE_GRID)
  if (state.windowIndex === null) {
    return { state: { windowIndex, punches: [punch] }, closed: null }
  }
  if (windowIndex === state.windowIndex) {
    // Every qualifying punch is retained in order, even past the explicit
    // cap: the extras still count as energy (and M40-22A's micro-mutation
    // precedence reads the newest one).
    return { state: { ...state, punches: [...state.punches, punch] }, closed: null }
  }
  const closed = compileAbstractMotif(
    state.punches,
    (state.windowIndex + 1) * PHRASE_WINDOW_TICKS,
  )
  return { state: { windowIndex, punches: [punch] }, closed }
}

/**
 * Close the open phrase because the transport crossed its boundary with no
 * punch to carry it — the pulse-driven path (the bridge calls this when it
 * crosses a phrase boundary).
 */
export function closePhraseAtTick(
  state: PhraseAccumulatorState,
  atTick: number,
): AccumulateResult {
  if (state.windowIndex === null || state.punches.length === 0) {
    return { state, closed: null }
  }
  const windowIndex = boundaryIndexAt(atTick, PHRASE_GRID)
  if (windowIndex === state.windowIndex) return { state, closed: null }
  const closed = compileAbstractMotif(
    state.punches,
    (state.windowIndex + 1) * PHRASE_WINDOW_TICKS,
  )
  return { state: { windowIndex: null, punches: [] }, closed }
}

/** How many of the open phrase's punches are still explicit (≤ 4). */
export function explicitCountOf(state: PhraseAccumulatorState): number {
  return Math.min(state.punches.length, MAX_EXPLICIT_PHRASE_PUNCHES)
}
