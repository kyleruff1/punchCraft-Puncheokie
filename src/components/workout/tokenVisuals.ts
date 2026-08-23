/**
 * Shared visual vocabulary for the cue tokens (M32-06, doc §13).
 *
 * The rule every value here serves: **a state must be readable with colour
 * removed** (spec §19.4, doc §25). So each `TokenVisualState` differs in
 * border weight, fill, and a text marker — the tint only reinforces what
 * shape and glyph already say.
 *
 * The other rule is the no-red-flash one (doc §13, §21): nothing in this
 * module references `colors.danger`. A missed token is not marked during
 * the combination; mismatch belongs to the cue result and the round
 * summary. Red appears only in M33-03's result badge, with text and icon.
 *
 * Pure data and types — no React, so the components stay small.
 */

import { colors } from '@/theme/colors'

export type TokenVisualState = 'upcoming' | 'active' | 'completed'
export type TokenSize = 'stage' | 'preview'

/**
 * Glove-friendly stage sizing (doc §25). 96dp is comfortably above the
 * 44dp minimum target because the athlete is reading this at arm's length,
 * mid-combination, through sweat.
 */
export const TOKEN_DIAMETER: Record<TokenSize, number> = {
  stage: 96,
  preview: 56,
}

export const TOKEN_FONT_SIZE: Record<TokenSize, number> = {
  stage: 44,
  preview: 24,
}

export interface StateVisual {
  borderWidth: number
  borderColor: string
  backgroundColor: string
  textColor: string
  /** Text marker so the state survives greyscale. */
  marker: string
  /** Spoken/accessible description of the state. */
  label: string
}

export const STATE_VISUALS: Record<TokenVisualState, StateVisual> = {
  // High contrast but unfilled — visible without competing with the active
  // token for attention.
  upcoming: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    textColor: colors.textSecondary,
    marker: '',
    label: 'upcoming',
  },
  // The one the athlete is throwing now: heaviest border, filled, and a
  // caret so the state reads at a glance in greyscale.
  active: {
    borderWidth: 6,
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
    textColor: colors.textPrimary,
    marker: '▸',
    label: 'active',
  },
  // Subdued and checked. Deliberately NOT red-or-green: whether the punch
  // matched is a cue result, not a mid-combination judgement.
  completed: {
    // 3, not 2: the border weight alone separates completed from upcoming,
    // so the state survives greyscale even if the fill and the check glyph
    // are both lost.
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textColor: colors.textMuted,
    marker: '✓',
    label: 'completed',
  },
}

/**
 * Motion glyphs. Always shown *alongside* the word, never instead of it —
 * an icon on its own would fail the colour-blind-safe/label rule and would
 * also be unreadable to anyone who has not memorised the set.
 */
export const DEFENSE_ICON: Record<string, string> = {
  duck: '↓',
  'bob-weave': '≈',
  slip: '↘',
  roll: '↺',
  pull: '←',
}

export const DEFENSE_LABEL: Record<string, string> = {
  duck: 'Duck',
  'bob-weave': 'Bob and weave',
  slip: 'Slip',
  roll: 'Roll',
  pull: 'Pull',
}

export const FOOTWORK_ICON: Record<string, string> = {
  pivot: '↻',
  'step-off': '↗',
  circle: '◯',
  'cut-off-ring': '◐',
  reset: '⊙',
}

export const FOOTWORK_LABEL: Record<string, string> = {
  pivot: 'Pivot',
  'step-off': 'Step off',
  circle: 'Circle',
  'cut-off-ring': 'Cut off the ring',
  reset: 'Reset',
}

export const COACH_LABEL: Record<string, string> = {
  'double-up': 'Double up',
  'put-it-on-em': 'Put it on em',
  'touch-and-go': 'Touch and go',
  breathe: 'Breathe',
  'hands-up': 'Hands up',
}

/**
 * `circle` and `cut-off-ring` describe a path around the opponent rather
 * than a single step, so they render as a ring diagram instead of an arrow
 * (doc §13).
 */
export function isRingFootwork(command: string): boolean {
  return command === 'circle' || command === 'cut-off-ring'
}
