/**
 * App-wide typography — Kanit throughout.
 *
 * The wordmark carries the branded name everywhere the app names itself
 * (see `src/components/branding/Wordmark`). This module governs every
 * other rendered string — headings, paragraphs, chip labels, buttons —
 * so the app feels like it belongs to the same chrome brand family
 * top to bottom rather than "wordmarks over a system-font UI."
 *
 * ## Why Kanit
 *
 * The chrome button art letters in an aggressive slanted chiseled-metal
 * style (Kyle's 2026-08-28 restyle). Kanit (OFL) is the closest Google
 * Font that survives UI scale: sharp sporty terminals, real italics
 * for the slant, and 18 styles so one family covers display down to
 * chip labels. Headings and display run ITALIC — that slant is the
 * motif tie to the art; body and labels stay upright for long-read
 * legibility at 13–15pt.
 *
 * ## Sizes and weights
 *
 * `sizes` covers the type scale currently in use; `weights` names the
 * range of weights used across the app. Both are ordered so a numeric
 * comparison is meaningful (larger > smaller).
 */

/**
 * Font families. Values are the family names `expo-font` registers when
 * `useFonts` loads Kanit in the root layout. Every rendered
 * string that wants the brand voice reads one of these.
 */
export const fonts = {
  /** Hero call-outs — the biggest headings on screen. */
  display: 'Kanit_700Bold_Italic',
  /** Section titles, tile values, banners, button text. */
  heading: 'Kanit_600SemiBold_Italic',
  /** Chip labels, form fields, small controls. */
  label: 'Kanit_500Medium',
  /** Body copy, paragraphs, list rows. */
  body: 'Kanit_400Regular',
  /** Dev-log / raw-frame surfaces only. */
  mono: 'monospace',
} as const

/**
 * The type scale. Ordered largest → smallest; a numeric comparison is
 * meaningful and enforced by test.
 */
export const sizes = {
  /** Hero call-outs (workout paused text). */
  display: 40,
  /** Section headers, tile values. */
  hero: 28,
  /** Screen titles, button text. */
  title: 22,
  /** Sub-heads, small callouts. */
  subtitle: 18,
  /** Body copy. */
  body: 15,
  /** Chip and control labels. */
  label: 13,
  /** Micro-labels, uppercased tags. */
  micro: 11,
} as const

/**
 * Weight tokens. Values are `TextStyle['fontWeight']` strings so a
 * TextStyle can accept them without a cast.
 */
export const weights = {
  black: '800',
  bold: '700',
  semibold: '600',
  medium: '500',
  regular: '400',
} as const

/**
 * Button text recipes — composed once so every button reads with the same
 * prominence. `buttonPrimary` is for the one page-action button that
 * drives the athlete forward (Build a workout, Start, Go); it is louder
 * than a section heading on purpose. `buttonSecondary` is the workhorse
 * for tab-bar controls, header links, and destination buttons.
 * `buttonSubtle` is for tertiary affordances (Settings, dev-only spikes).
 */
export const recipes = {
  buttonPrimary: {
    fontFamily: fonts.display,
    fontSize: sizes.title,
    fontWeight: weights.black,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  buttonSecondary: {
    fontFamily: fonts.heading,
    fontSize: sizes.subtitle,
    fontWeight: weights.bold,
    letterSpacing: 0.6,
  },
  buttonSubtle: {
    fontFamily: fonts.label,
    fontSize: sizes.body,
    fontWeight: weights.semibold,
    letterSpacing: 0.3,
  },
} as const

export type TypographyFonts = typeof fonts
export type TypographySizes = typeof sizes
export type TypographyWeights = typeof weights
export type TypographyRecipes = typeof recipes
