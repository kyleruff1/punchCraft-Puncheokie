/**
 * The pattern execution backend contract (M40-22A, execution-backends
 * design). Studio One and Toontrack may author, render, humanize, and
 * process the performance — PunchEoke still decides the notes, the legal
 * movements, the commit boundaries, and the semantic relationship to each
 * punch. This module is that boundary written down.
 *
 * ONE compiled plan serves every backend: Bridge Exact plays its steps
 * directly, Imported MIDI plays steps normalized out of a Studio One
 * export (M45-05), and a future DAW-hosted arpeggiator (M45-06) drives its
 * host through `hostDirective` while the same steps remain the canonical
 * description of what SHOULD sound. No parallel Studio One pattern map
 * exists outside this object.
 *
 * Bridge Exact is the only production backend this milestone.
 */
import type { RetriggerPolicy } from './gestureSchema'

export type PatternExecutionBackendId = 'bridge-exact' | 'studio-one-note-fx' | 'imported-midi'

/**
 * What the tablet may PROMISE about a backend's projected notes. A page
 * showing "next tones: A, D, F, C" is lying unless the backend is exact —
 * a symbolic backend may show only the pattern's character.
 */
export type ProjectionAccuracy = 'exact' | 'pattern-symbolic' | 'unavailable'

export interface PatternBackendCapabilities {
  exactStepProjection: boolean
  supportsLiveRateChange: boolean
  supportsLiveGateChange: boolean
  supportsPatternRotation: boolean
  supportsContinuousMorph: boolean
  supportsMicroMutations: boolean
  supportsVoiceLeading: boolean
}

/** One canonical step of a compiled pattern. */
export interface CompiledPatternStep {
  stepId: string
  atTick: number
  poolIndex: number
  octaveOffset: number
  gateTicks: number
  accent01: number
}

export interface CompiledPatternPlan {
  planId: string
  /** The compiled field this plan is legal under. */
  fieldHash: string
  patchGeneration: number
  patternId: string
  startTick: number
  lengthTicks: number
  steps: readonly CompiledPatternStep[]
  rateTicks: number
  gateRatio: number
  swing: number
  retrigger: RetriggerPolicy
  /** Present only for a DAW-hosted backend (M45-06). */
  hostDirective?: {
    studioOnePresetId: string
    verifiedPresetVersion: string
    rateMacro?: number
    gateMacro?: number
    octaveMacro?: number
    patternMacro?: number
  }
}

/**
 * The ≤3-step override one punch asks of the RUNNING pattern — no phase
 * restart (design §10 "micro motif": always enabled, short-lived, obvious).
 *
 * Precedence (second-pass am. 6): several punches can arrive before the
 * next arp step, and their operations contradict each other (a jab says
 * advance, a hook says reverse, an uppercut says rise). They must never
 * stack: the MOST RECENT valid punch owns the next step. The phrase
 * accumulator still retains every punch in order, so nothing is lost from
 * the persistent motif.
 */
export interface PendingMicroMutation {
  sourcePunchEventId: string
  createdAtTick: number
  appliesFromStepIndex: number
  expiresAfterStepIndex: number
  operations: readonly string[]
  rotation: number
}

/** Bridge Exact: PunchEoke sequences every note, so everything is possible. */
export const BRIDGE_EXACT_CAPABILITIES: PatternBackendCapabilities = {
  exactStepProjection: true,
  supportsLiveRateChange: true,
  supportsLiveGateChange: true,
  supportsPatternRotation: true,
  supportsContinuousMorph: true,
  supportsMicroMutations: true,
  supportsVoiceLeading: true,
}

/**
 * Studio One Note FX starts CONSERVATIVE (M45-06): a capability is enabled
 * only after the installed environment is probed and the corresponding
 * parameter proves reliably controllable. The arpeggiator existing is not
 * evidence that its controls can be driven remotely.
 */
export const STUDIO_ONE_NOTE_FX_CAPABILITIES: PatternBackendCapabilities = {
  exactStepProjection: false,
  supportsLiveRateChange: false,
  supportsLiveGateChange: false,
  supportsPatternRotation: false,
  supportsContinuousMorph: false,
  supportsMicroMutations: false,
  supportsVoiceLeading: true,
}

export const BACKEND_CAPABILITIES: Readonly<
  Record<PatternExecutionBackendId, PatternBackendCapabilities>
> = {
  'bridge-exact': BRIDGE_EXACT_CAPABILITIES,
  'studio-one-note-fx': STUDIO_ONE_NOTE_FX_CAPABILITIES,
  // Imported MIDI is performed by OUR sequencer, so it is exact like
  // bridge-exact; only the pattern's authorship differs (M45-05).
  'imported-midi': BRIDGE_EXACT_CAPABILITIES,
}

/** What a backend may promise the telegraphing layer (M41-03). */
export function projectionAccuracyOf(id: PatternExecutionBackendId): ProjectionAccuracy {
  return BACKEND_CAPABILITIES[id].exactStepProjection ? 'exact' : 'pattern-symbolic'
}

/**
 * A backend may only be handed work it can actually perform. A plan that
 * needs a capability the backend lacks is a PROGRAMMING error, not a
 * degraded mode — the caller picks a different backend.
 */
export function backendSupportsPlan(
  id: PatternExecutionBackendId,
  needs: { microMutations?: boolean; liveRateChange?: boolean; rotation?: boolean },
): boolean {
  const caps = BACKEND_CAPABILITIES[id]
  if (needs.microMutations && !caps.supportsMicroMutations) return false
  if (needs.liveRateChange && !caps.supportsLiveRateChange) return false
  if (needs.rotation && !caps.supportsPatternRotation) return false
  return true
}

/**
 * Resolve which pending mutation owns a given step — the am.-6 precedence
 * rule in one pure function, shared by the bridge engine and (later) the
 * tablet's projection so the two can never disagree about what will sound.
 */
export function mutationForStep(
  pending: PendingMicroMutation | null,
  stepIndex: number,
): PendingMicroMutation | null {
  if (!pending) return null
  if (stepIndex < pending.appliesFromStepIndex) return null
  if (stepIndex > pending.expiresAfterStepIndex) return null
  return pending
}
