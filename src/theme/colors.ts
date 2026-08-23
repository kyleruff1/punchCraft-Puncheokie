/**
 * App-wide dark palette — retro sunset.
 *
 * The app is dark-only (`userInterfaceStyle: 'dark'` in app.config.ts), so
 * there is no light variant. Every screen and shared component pulls from
 * this module, which is what makes a palette change like this one a
 * single-file edit.
 *
 * ## The palette
 *
 * Four authored colours, interwoven through a warm near-black ground:
 * burnt orange, mustard yellow, teal, and rust. The neutrals are warm
 * rather than blue-grey — a neutral-grey dark theme would fight the
 * palette and lose the '70s feel entirely.
 *
 * ## Why the semantic roles are not the raw swatches
 *
 * The four swatches were chosen as a *brand* palette, not for contrast on
 * a near-black ground, and several of them fail as text at their authored
 * value: burnt orange `#BE5103` lands around 2.6:1 on this background, well
 * under the 4.5:1 body-text floor. So the semantic roles below use
 * brightened members of the same families, and the exact authored values
 * are exported as `retro*` for fills, borders and large decorative areas
 * where contrast is not the constraint.
 *
 * Spec §19.4 still applies to all of it: colour is never the only signal.
 * Warning and danger sit in neighbouring hue families — unavoidable with a
 * palette whose warm end is orange and rust — so every surface that uses
 * them also carries the words and an icon, and that pairing is enforced by
 * test in `ConflictNotice` and the cue tokens.
 */

/**
 * The four authored swatches, exact. Use these for fills, borders and
 * decorative areas — not for small text on the background.
 */
export const retro = {
  /** Burnt orange. */
  orange: '#BE5103',
  /** Mustard yellow. */
  mustard: '#FFCE1B',
  /** Teal — the cool contrast. */
  teal: '#069494',
  /** Rust. */
  rust: '#B7410E',
} as const

export const colors = {
  /** App root / scroll bodies. Warm near-black, not neutral grey. */
  background: '#141110',
  /** Cards, list rows, chips, header backgrounds. */
  surface: '#211C18',
  /** Pressed / selected variant of `surface`. */
  surfaceElevated: '#2E271F',
  /** Selected accent tint for rows / chips — mustard-tinted. */
  accentSurface: '#33290A',

  /** Hairlines and card borders. */
  border: '#3E352B',
  /** Higher-contrast border (buttons, active outline). */
  borderStrong: '#5D4E40',

  /** Primary body text. Warm off-white, not pure white. */
  textPrimary: '#F7F1E6',
  /** Secondary / metadata text. */
  textSecondary: '#C7BAA7',
  /** Muted labels (timestamps, disabled state). */
  textMuted: '#8F8375',
  /** Text on top of `accent` fills — dark, because mustard is a light fill. */
  textOnAccent: '#1A1400',

  /**
   * Primary action / focus / the active cue ring.
   *
   * Mustard, at roughly 13:1 on the background — by far the most legible
   * member of the palette, which is what the live screen needs when it is
   * read at arm's length, mid-combination.
   */
  accent: retro.mustard,

  /** Warning / attention. Brightened burnt orange (~5.5:1). */
  warning: '#E08A1E',
  /** Success indicator. Brightened teal (~6:1). */
  success: '#12B3B3',
  /**
   * Danger / error. Brightened rust.
   *
   * Deliberately rare: doc §13/§21 forbid a red flash mid-combination, so
   * this appears only in conflict notices and in the M33-03 result badge —
   * always with text and an icon beside it.
   */
  danger: '#D2451E',
  /** Solid destructive button background. */
  dangerSurface: '#3D1608',

  /**
   * Reward / affirmation. Mustard's metallic sibling, not a fifth swatch:
   * the same authored hue family (~46 deg vs mustard's ~47), desaturated and
   * darkened so it reads as *metal* rather than as `accent`.
   *
   * That separation is the point. `accent` already means "the thing you are
   * doing right now" on the live screen, so borrowing it to say "you did
   * that well" would say the wrong thing. Used for the form-affirmation
   * glow and the exact-target badge; ~8.9:1 on `background`, so it is
   * legible as text and not only as a large fill.
   */
  gold: '#D4AF37',

  /**
   * Physical tracker colours. The trackers are colour-coded and permanently
   * assigned — blue is the left glove, red the right (see
   * ble/knownTrackers.ts). Any surface that distinguishes hands should use
   * these so the on-screen marker matches the device on the athlete's wrist.
   *
   * The palette's cool/warm split maps onto that naturally: teal reads as
   * the blue glove, orange as the red one. §19.4 still applies — these
   * always accompany an L/R letter or a text label.
   */
  trackerLeft: '#2FC4C4',
  trackerRight: '#E2761B',
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
export type RetroPalette = typeof retro
