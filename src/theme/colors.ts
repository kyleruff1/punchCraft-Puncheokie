/**
 * App-wide dark palette — punchCraft brand.
 *
 * The app is dark-only (`userInterfaceStyle: 'dark'` in app.config.ts), so
 * there is no light variant. Every screen and shared component pulls from
 * this module, which is what makes a palette change like this one a
 * single-file edit.
 *
 * ## The palette
 *
 * Fully cool: electric turquoise and its family (bright cyan, highlight
 * turquoise, light aqua, deep teal) over a near-black-teal ground with
 * cool-neutral steel/silver mids. The wordmark art is silver-metallic
 * chiseled type on the same near-black; the rest of the app is now that
 * same ground so the wordmark reads as native to the UI, not glued on.
 *
 * One deliberate warm holdout — `trackerRight` stays orange, because the
 * physical FightCamp v1 tracker on the right glove is red-orange (see
 * ble/knownTrackers.ts and spec §14). Losing that would break the
 * on-screen-to-on-wrist mapping.
 *
 * ## Why the semantic roles are not the raw swatches
 *
 * The raw palette (`punch.*` below) is exported for large fills and
 * decorative surfaces where contrast is not the constraint. Text-carrying
 * roles use the same family members chosen for legibility on the near-black
 * ground.
 *
 * Spec §19.4 still applies to all of it: colour is never the only signal.
 * With warm signalling gone, that discipline is more important, not less —
 * `danger`, `warning`, and `gold` no longer carry their meaning by hue
 * alone. Every surface that uses them also carries the words and an icon,
 * and that pairing is enforced by test in `ConflictNotice` and the cue
 * tokens.
 */

/**
 * The raw brand palette. Use these for fills, borders and decorative
 * areas — not for small text on the background.
 */
export const punch = {
  /** Electric turquoise — the wordmark's cyan and the primary brand pop. */
  turquoise: '#22D3DC',
  /** Slightly warmer/deeper turquoise; the blue-glove tracker dot. */
  turquoiseDeep: '#1EBBC4',
  /** Highlight cyan — brighter than accent; the "yes / glow" signal. */
  turquoiseBright: '#54E8EF',
  /**
   * Deep turquoise — the mid-dark member of Kyle's authored palette.
   * Dark enough for silver-metal label art to pop, saturated enough to
   * still read as the turquoise action colour.
   */
  turquoiseMid: '#15949C',
  /** Light aqua — the brightest cool; the reward-badge fill. */
  aqua: '#8CF4F7',
  /** Deep teal — accent-tinted selected rows. */
  tealDeep: '#074348',
  /** Dark teal — cautionary / connecting state. */
  tealDark: '#0B6970',
  /** Near-black teal — the app ground. */
  tealBlack: '#051C1F',
  /** Charcoal — cool near-black card surface. */
  charcoal: '#111718',
  /** Gunmetal — elevated card surface. */
  gunmetal: '#202A2C',
  /** Steel — hairlines and borders. */
  steel: '#3B494A',
  /**
   * Steel-light — the Stop / danger colour. A distinct value from
   * `steel`/`border` on purpose: the tokens.test "no red flash" rule
   * filters by *hex*, so `danger` must not collide with any hue that
   * legitimately appears inside cue UI (which uses `border` heavily).
   */
  steelLight: '#4A5A5C',
  /**
   * Deep charcoal-teal — the destructive-button background. A distinct
   * value from `charcoal`/`gunmetal` on purpose (same reason as
   * `steelLight`): the Stop button's fill must not read as an ordinary
   * card surface, and the test rule enforces that with hex comparison.
   */
  charcoalDeep: '#152224',
  /** Cool mid gray — stronger borders, muted labels. */
  slate: '#557477',
  /** Silver — secondary body text. */
  silver: '#C8C9CA',
  /** Off-white — primary body text. */
  offWhite: '#F4F6F6',
  /** Red-orange — the right glove's physical tracker colour (only warm). */
  gloveRedOrange: '#E2761B',
} as const

export const colors = {
  /** App root / scroll bodies. Near-black teal, not neutral grey. */
  background: punch.tealBlack,
  /** Cards, list rows, chips, header backgrounds. */
  surface: punch.charcoal,
  /** Pressed / selected variant of `surface`. */
  surfaceElevated: punch.gunmetal,
  /** Selected accent tint for rows / chips — turquoise-tinted. */
  accentSurface: punch.tealDeep,

  /** Hairlines and card borders. */
  border: punch.steel,
  /** Higher-contrast border (buttons, active outline). */
  borderStrong: punch.slate,

  /** Primary body text. Cool off-white, not pure white. */
  textPrimary: punch.offWhite,
  /** Secondary / metadata text. */
  textSecondary: punch.silver,
  /** Muted labels (timestamps, disabled state). */
  textMuted: punch.slate,
  /**
   * Text on top of `accent` fills — dark, because bright cyan is a light
   * fill. Matches the ground so an accent chip reads as a cut-out.
   */
  textOnAccent: punch.tealBlack,

  /**
   * Primary action / focus / the active cue ring.
   *
   * Electric turquoise — the wordmark's cyan, at ~11:1 on the background.
   * The most legible bright member of the palette, which is what the live
   * screen needs when it is read at arm's length, mid-combination.
   */
  accent: punch.turquoise,

  /**
   * Warning / attention. Dark teal — dim on purpose, so a warning does not
   * out-shout the accent. Text and icon always ride alongside per §19.4.
   */
  warning: punch.tealDark,
  /**
   * Success indicator. Highlight cyan — brighter than accent, so a
   * connection-good dot glows against a chip that also carries accent.
   */
  success: punch.turquoiseBright,
  /**
   * Reward. Two consumers, deliberately sharing one token: the
   * exact-target result badge (doc §23, M33-03) and the form-affirmation
   * glow on a punch node. Both mean "that was right", so they should not
   * be two different tokens.
   *
   * Light aqua — the brightest cool in the palette, distinct from `accent`
   * (bright cyan) and from `success` (highlight cyan) by lightness alone.
   * The pre-cool palette used a warm gold here; on a fully-cool ground a
   * warm gold would fight the wordmark, so the reward now glows in the
   * palette's top cool tone.
   *
   * Colour still never carries the meaning alone (spec §19.4) — the exact
   * state renders a target icon and the words `EXACT TARGET`, and the form
   * affirmation renders a star glyph and a "good form" label.
   */
  gold: punch.aqua,
  /**
   * Danger / stop.
   *
   * Steel-light — deliberately non-signalling by colour. Doc §13/§21 forbid
   * a red flash mid-combination, so this token appears only on the Stop
   * button and in conflict notices, always with the word "STOP" or "END"
   * and an icon. With the palette gone fully cool there is no red to fall
   * back on, so the affordance is text-carried by design — the button
   * reads as subdued so the athlete does not slap it by reflex.
   */
  danger: punch.steelLight,
  /** Solid destructive button background — distinct from surfaceElevated. */
  dangerSurface: punch.charcoalDeep,


  /**
   * Physical tracker colours. The trackers are colour-coded and permanently
   * assigned — blue is the left glove, red the right (see
   * ble/knownTrackers.ts). Any surface that distinguishes hands should use
   * these so the on-screen marker matches the device on the athlete's wrist.
   *
   * Left uses the palette's deeper turquoise (distinct from `accent`'s
   * brighter cyan so a dot near an accent chip does not disappear). Right
   * stays warm red-orange — the one warm holdout in the palette, because
   * the physical device is red-orange and swapping it to a cool tone would
   * break the on-screen-to-on-wrist mapping. §19.4 still applies — these
   * always accompany an L/R letter or a text label.
   */
  trackerLeft: punch.turquoiseDeep,
  trackerRight: punch.gloveRedOrange,
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
export type PunchPalette = typeof punch
