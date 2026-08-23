/**
 * App-wide dark palette. The app is dark-only (userInterfaceStyle: 'dark'
 * in app.config.ts) — no light variant is defined here. Every screen and
 * shared component pulls its colors from this module so the palette can
 * be edited in one place.
 *
 * Base tones match the existing dev screens (spike / probe / live) so the
 * whole surface reads as one product rather than "engineering dark" vs
 * "app light".
 */

export const colors = {
  /** App root / scroll bodies. */
  background: '#0b0b0d',
  /** Cards, list rows, chips, header backgrounds. */
  surface: '#1f1f22',
  /** Pressed / selected variant of `surface`. */
  surfaceElevated: '#2a2a2f',
  /** Selected accent tint for rows / chips. */
  accentSurface: '#141a2b',

  /** Hairlines and card borders. */
  border: '#33333a',
  /** Higher-contrast border (buttons, active outline). */
  borderStrong: '#4a4a52',

  /** Primary body text. */
  textPrimary: '#f2f2f5',
  /** Secondary / metadata text. */
  textSecondary: '#a8a8b3',
  /** Muted labels (timestamps, disabled state). */
  textMuted: '#7c7c86',
  /** Text on top of `accent` fills. */
  textOnAccent: '#ffffff',

  /** Primary action / focus color. */
  accent: '#2c6bed',
  /** Warning / attention. */
  warning: '#f0a020',
  /** Success indicator. */
  success: '#3ec46d',
  /** Danger / error. */
  danger: '#e56464',
  /** Solid destructive button background. */
  dangerSurface: '#5a2b2b',
} as const

/**
 * Semantic aliases for connection-state indicators. The dot color rule
 * from §19.4 still requires a text label alongside; these are the dot
 * colors only.
 */
export const stateColors = {
  connected: colors.success,
  connecting: colors.warning,
  disconnected: colors.danger,
  unassigned: colors.textMuted,
} as const

export type AppColors = typeof colors
