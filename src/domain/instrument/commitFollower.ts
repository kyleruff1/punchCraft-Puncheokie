/**
 * The tablet's harmonic commit follower (M40-23, second-pass am. 12).
 *
 * Two output modes, one rule about authority:
 *
 * · TABLET — the tablet owns its own quantized commits. A JS follower is
 *   fine here: this is ~2 state swaps per second, not note scheduling, so
 *   the native-loop rule (never schedule audio from JS) is untouched.
 *
 * · BOTH — the BRIDGE is the commit authority and the tablet applies only
 *   bridge-CONFIRMED commits. Two independently evolving songs is the
 *   failure this prevents.
 *
 * The acceptance policy is deliberately strict, because every rejected
 * case is a way the two surfaces could drift apart: a confirmation applies
 * only when the session, patch generation, transport generation, field
 * hash, and commit ORDER all match. Late, stale, duplicate, and
 * out-of-order confirmations are discarded. A MISSING confirmation holds
 * the last confirmed harmony — the tablet never performs an independent
 * local commit in BOTH mode. Extended bridge loss fades the bed and
 * surfaces a warning rather than letting the tablet wander.
 *
 * PARITY, defined: chord identity is mandatory; sample-onset alignment is
 * only ever MEASURED against a tolerance. The bridge and tablet share no
 * sample-accurate audio clock, so exact phase parity is not promised.
 *
 * Pure fold — no clocks, no audio, no RN imports.
 */
import type { CompiledHarmonicCommit } from './harmonicCommit'

export type CommitAuthority = 'tablet' | 'bridge'

/** Chord identity parity is required; onset parity is measured, not promised. */
export const ONSET_PARITY_TOLERANCE_MS = 120

export interface FollowerIdentity {
  sessionId: string
  compiledFieldHash: string
  patchGeneration: number
  transportGeneration: number
}

export interface ConfirmedCommit extends FollowerIdentity {
  commit: CompiledHarmonicCommit
}

export interface CommitFollowerState {
  authority: CommitAuthority
  identity: FollowerIdentity
  /** The last commit actually applied to the sounding bed. */
  applied: CompiledHarmonicCommit | null
  /** True once the link is considered lost (bed fades, warning shows). */
  linkLost: boolean
}

export function emptyFollowerState(
  authority: CommitAuthority,
  identity: FollowerIdentity,
): CommitFollowerState {
  return { authority, identity, applied: null, linkLost: false }
}

export type CommitRejection =
  | 'session-mismatch'
  | 'stale-patch-generation'
  | 'stale-transport-generation'
  | 'field-hash-mismatch'
  | 'out-of-order'
  | 'duplicate'

export interface FollowResult {
  state: CommitFollowerState
  /** The commit to apply, or null when nothing changes. */
  apply: CompiledHarmonicCommit | null
  rejected: CommitRejection | null
}

/**
 * Fold a bridge-confirmed commit. Every mismatch is named rather than
 * silently ignored, so a drift bug shows up as a reason instead of a
 * mystery.
 */
export function followConfirmedCommit(
  state: CommitFollowerState,
  confirmed: ConfirmedCommit,
): FollowResult {
  const reject = (rejected: CommitRejection): FollowResult => ({ state, apply: null, rejected })
  if (confirmed.sessionId !== state.identity.sessionId) return reject('session-mismatch')
  if (confirmed.patchGeneration !== state.identity.patchGeneration) {
    return reject('stale-patch-generation')
  }
  if (confirmed.transportGeneration !== state.identity.transportGeneration) {
    return reject('stale-transport-generation')
  }
  if (confirmed.compiledFieldHash !== state.identity.compiledFieldHash) {
    return reject('field-hash-mismatch')
  }
  const previous = state.applied
  if (previous) {
    if (confirmed.commit.commitId === previous.commitId) return reject('duplicate')
    // Commit ORDER is the transport's, not the network's: a confirmation
    // that predates what already sounded is late, not new.
    if (confirmed.commit.requestedCommitTick < previous.requestedCommitTick) {
      return reject('out-of-order')
    }
  }
  return {
    state: { ...state, applied: confirmed.commit, linkLost: false },
    apply: confirmed.commit,
    rejected: null,
  }
}

/**
 * TABLET mode: the tablet is its own authority, so a locally folded commit
 * applies directly. In BOTH mode this is REFUSED — the bridge decides, and
 * a missing confirmation holds the last confirmed harmony rather than
 * splitting the song in two.
 */
export function applyLocalCommit(
  state: CommitFollowerState,
  commit: CompiledHarmonicCommit,
): FollowResult {
  if (state.authority === 'bridge') {
    return { state, apply: null, rejected: 'out-of-order' }
  }
  return {
    state: { ...state, applied: commit, linkLost: false },
    apply: commit,
    rejected: null,
  }
}

/**
 * Extended bridge loss in BOTH mode: fade the harmonic bed and surface a
 * warning. The last confirmed cell is retained (so a quick reconnect
 * resumes cleanly) but nothing new sounds — the tablet must not evolve a
 * second song while the bridge is away.
 */
export function markLinkLost(state: CommitFollowerState): CommitFollowerState {
  if (state.authority !== 'bridge') return state
  return { ...state, linkLost: true }
}

export function markLinkRestored(state: CommitFollowerState): CommitFollowerState {
  return { ...state, linkLost: false }
}

/** A settings/world change invalidates every pending confirmation. */
export function reidentify(
  state: CommitFollowerState,
  identity: FollowerIdentity,
): CommitFollowerState {
  return { ...state, identity, applied: null, linkLost: false }
}

/**
 * Chord-identity parity — the MANDATORY half of the parity contract.
 */
export function chordIdentityMatches(
  tablet: CompiledHarmonicCommit | null,
  bridge: CompiledHarmonicCommit | null,
): boolean {
  if (!tablet || !bridge) return tablet === bridge
  return tablet.resolvedCellId === bridge.resolvedCellId
}

/**
 * Onset parity — MEASURED, never promised: reports whether two surfaces
 * landed a commit within tolerance, for diagnostics only.
 */
export function onsetParityWithinTolerance(
  tabletAtMs: number,
  bridgeAtMs: number,
  toleranceMs: number = ONSET_PARITY_TOLERANCE_MS,
): boolean {
  return Math.abs(tabletAtMs - bridgeAtMs) <= toleranceMs
}
