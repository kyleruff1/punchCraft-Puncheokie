/**
 * Elastic transition planning (instrument-design §9): how long a voice
 * takes to reach its new note, and how far a hard strike overshoots in
 * cents before settling. One number serves MIDI bend, cube cursor, and
 * ribbon — never computed twice.
 */
import type { TransitionKind } from './gestureSchema'
import type { PunchPatch } from './punchPatch'
import type { VoiceChange } from './latchedVoice'

/**
 * base + distance·30 + slowness·145, clamped to the patch's window
 * (design §9's curve with the patch supplying min/max).
 */
export function transitionDurationMs(
  zoneDistance: number,
  punchRate01: number,
  patch: Pick<PunchPatch, 'transition'>,
): number {
  const { minimumMs, maximumMs } = patch.transition
  const raw = 45 + zoneDistance * 30 + (1 - Math.max(0, Math.min(1, punchRate01))) * 145
  return Math.round(Math.max(minimumMs, Math.min(maximumMs, raw)))
}

/**
 * Overshoot ladder (§9): none / 4-7 / 8-12 / up to the patch cap. Only
 * the elastic transition mode ornaments — Clean glide and retrigger stay
 * exactly in tune (transition-design §7 presets).
 */
export function overshootCents(
  acceleration01: number,
  patch: Pick<PunchPatch, 'transition'>,
): number {
  if (patch.transition.mode !== 'elastic') return 0
  const cap = patch.transition.overshootCents
  const a = Math.max(0, Math.min(1, acceleration01))
  if (a < 0.33) return 0
  if (a < 0.6) return Math.min(cap, 6)
  if (a < 0.85) return Math.min(cap, 10)
  return Math.min(cap, 15)
}

/** Which articulation the wire gesture carries for a voice change. */
export function transitionKind(
  change: VoiceChange,
  patch: Pick<PunchPatch, 'transition'>,
): TransitionKind {
  if (change === 'same-zone') return 'retrigger'
  if (change === 'first' || patch.transition.mode === 'retrigger') return 'attack'
  return 'glide'
}
