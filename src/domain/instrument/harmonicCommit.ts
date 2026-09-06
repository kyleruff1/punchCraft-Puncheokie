/**
 * The harmonic commit fold (M40-17, harmonic-field-v2 §12 + second-pass
 * amendments 3/4): per commit window, everything the boxer staged collapses
 * into ONE canonical CompiledHarmonicCommit. Pure and shared — the bridge's
 * tick engine folds with it today; the M40-23 tablet commit follower folds
 * with the SAME function so both surfaces can only ever agree.
 *
 * Ordering contract: staged entries arrive in receipt order; the NEWEST
 * surviving entry wins the resolved state (the domain's sample-and-hold
 * latch already merged the hands into each staged cell, so newest-wins IS
 * "latest band request per hand"). Every surviving entry's eventId is
 * recorded — a flurry becomes one commit that remembers all its punches.
 *
 * Deterministic-audible rule (am. 4): audibleCommitTick derives from the
 * CURRENTLY SOUNDING arp grid, never the incoming rate; the commit records
 * both intervals and the new grid's phase anchor so replay and telemetry
 * can reconstruct the atomic apply exactly.
 */
import type { HarmonicIntent, QuantizedChange } from './gestureSchema'
import {
  arpIntervalTicksFor,
  nextBoundaryTickAtOrAfter,
  type QuantizationGrid,
} from './transportGrid'

/** One staged punch awaiting the window boundary. */
export interface StagedHarmonicChange {
  eventId: string
  q: QuantizedChange
  noteVelocity: number
  harmonicIntent?: HarmonicIntent
  /** Stale-generation guards (am. 8/13); absent entries are never stale. */
  transportGeneration?: number
  patchGeneration?: number
}

/** The canonical, replay-stable record of one harmonic commit. */
export interface CompiledHarmonicCommit {
  commitId: string
  /** The harmonic boundary that closed the window. */
  requestedCommitTick: number
  /** First boundary of the SOUNDING arp grid ≥ requested — where it lands. */
  audibleCommitTick: number
  /** Every surviving staged punch, receipt order, deduped. */
  contributingPunchEventIds: readonly string[]
  previousCellId: string | null
  resolvedCellId: string
  bassNote: number
  entryTone: number
  arpPool: readonly number[]
  /** The winner's rotation (arpStartIndex — right-zone entry tone). */
  patternRotation: number
  /** The grid the commit was audible ON (am. 4). */
  previousArpIntervalTicks: number
  /** The rate that applies FROM the commit, atomically with the harmony. */
  nextArpIntervalTicks: number
  /** New arp grid anchor = audibleCommitTick (atomic apply). */
  nextArpPhaseTick: number
}

export interface FoldHarmonicCommitOptions {
  previousCellId: string | null
  requestedCommitTick: number
  /** The arp grid SOUNDING when the window closed. */
  soundingArpGrid: QuantizationGrid
  /** When set, entries stamped with a DIFFERENT generation are dropped. */
  currentTransportGeneration?: number
  currentPatchGeneration?: number
}

export interface FoldedHarmonicCommit {
  commit: CompiledHarmonicCommit
  /** The newest surviving staged entry — the state the engine applies. */
  winner: StagedHarmonicChange
}

function isStale(entry: StagedHarmonicChange, opts: FoldHarmonicCommitOptions): boolean {
  if (
    opts.currentTransportGeneration !== undefined &&
    entry.transportGeneration !== undefined &&
    entry.transportGeneration !== opts.currentTransportGeneration
  ) {
    return true
  }
  if (
    opts.currentPatchGeneration !== undefined &&
    entry.patchGeneration !== undefined &&
    entry.patchGeneration !== opts.currentPatchGeneration
  ) {
    return true
  }
  return false
}

/**
 * Fold one window's staged punches into the canonical commit. Returns null
 * when nothing survives (all duplicates/stale — the window commits
 * nothing and the running pattern simply continues).
 */
export function foldHarmonicCommit(
  staged: readonly StagedHarmonicChange[],
  opts: FoldHarmonicCommitOptions,
): FoldedHarmonicCommit | null {
  const seen = new Set<string>()
  const surviving: StagedHarmonicChange[] = []
  for (const entry of staged) {
    if (isStale(entry, opts)) continue
    if (seen.has(entry.eventId)) continue // retransmit/duplicate: one vote
    seen.add(entry.eventId)
    surviving.push(entry)
  }
  const winner = surviving[surviving.length - 1]
  if (!winner) return null

  const audibleCommitTick = nextBoundaryTickAtOrAfter(
    opts.requestedCommitTick,
    opts.soundingArpGrid,
  )
  const commit: CompiledHarmonicCommit = {
    commitId: `c${opts.requestedCommitTick}-${winner.q.cubeCellId}`,
    requestedCommitTick: opts.requestedCommitTick,
    audibleCommitTick,
    contributingPunchEventIds: surviving.map((entry) => entry.eventId),
    previousCellId: opts.previousCellId,
    resolvedCellId: winner.q.cubeCellId,
    bassNote: winner.q.bassMidiNote,
    entryTone: winner.q.chordMidiNotes[0] ?? 0,
    arpPool: winner.q.chordMidiNotes,
    patternRotation: winner.q.arpStartIndex,
    previousArpIntervalTicks: opts.soundingArpGrid.intervalTicks,
    nextArpIntervalTicks: arpIntervalTicksFor(winner.q.notesPerMinute),
    nextArpPhaseTick: audibleCommitTick,
  }
  return { commit, winner }
}
