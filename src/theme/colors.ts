/**
 * App-wide dark palette — metallic chrome.
 *
 * The app is dark-only (`userInterfaceStyle: 'dark'` in app.config.ts), so
 * there is no light variant. Every screen and shared component pulls from
 * this module, which is what makes a palette change like this one a
 * single-file edit.
 *
 * ## The palette
 *
 * Colorless by design (Kyle 2026-08-28): a near-black neutral ground with
 * charcoal/gunmetal surfaces, steel lines, and silver-to-white shine for
 * everything that used to be an accent hue. The authored button art is
 * polished chrome on dark metal, and the UI reads as the same material.
 *
 * Color survives in exactly three places, all deliberate:
 * - the punchCraft wordmark (silver + cyan art, used everywhere),
 * - `trackerLeft` — the physical BLUE left glove,
 * - `trackerRight` — the physical RED-ORANGE right glove
 *   (see ble/knownTrackers.ts and spec §14: on-screen must match
 *   on-wrist).
 *
 * ## Shine is the new hue
 *
 * With hue gone, brightness carries the semantic ladder:
 * reward (`gold`, near-white) > success > accent (polished chrome) >
 * primary text > secondary text > muted. Spec §19.4 — colour is never
 * the only signal — is now load-bearing everywhere: every state that
 * used to lean on a hue difference must keep its words and icons, and
 * the existing tests enforce that pairing.
 *
 * ## Why the semantic roles are not the raw swatches
 *
 * The raw palette (`punch.*`) is exported for fills and decorative areas
 * where contrast is not the constraint; text-carrying roles pick members
 * chosen for legibility on the near-black ground.
 */

/**
 * The raw chrome palette. Use these for fills, borders and decorative
 * areas — not for small text on the background.
 */
export const punch = {
  /** Near-white shine — the reward tier. */
  shine: '#FBFDFD',
  /** Bright chrome — success / connected. */
  chromeBright: '#EFF2F3',
  /** Polished chrome — the action colour (accent). */
  chrome: '#D9DEE1',
  /** Silver — secondary text. */
  silver: '#C6CACC',
  /** Cool grey — muted labels. */
  grey: '#81888C',
  /** Dim steel — cautionary. */
  steelDim: '#767F83',
  /** Steel-strong — heavy borders. */
  steelStrong: '#5A6367',
  /** Steel-light — the Stop / danger fill (distinct from border). */
  steelLight: '#4C5457',
  /** Steel — hairlines and borders. */
  steel: '#3A4145',
  /** Selected steel — accent-tinted rows/chips. */
  steelSelected: '#272C2F',
  /** Gunmetal — elevated card surface. */
  gunmetal: '#1F2325',
  /** Deep charcoal — destructive-button ground (distinct from surface). */
  charcoalDeep: '#171B1D',
  /** Charcoal — card surface. */
  charcoal: '#15181A',
  /** Near-black — the app ground. */
  black: '#0B0D0E',
  /** Physical LEFT glove — blue. The one cool colour that remains. */
  gloveBlue: '#1EBBC4',
  /** Physical RIGHT glove — red-orange. The one warm colour that remains. */
  gloveRedOrange: '#E2761B',
} as const

export const colors = {
  /** App root / scroll bodies. Near-black neutral. */
  background: punch.black,
  /** Cards, list rows, chips, header backgrounds. */
  surface: punch.charcoal,
  /** Pressed / selected variant of `surface`. */
  surfaceElevated: punch.gunmetal,
  /** Selected accent tint for rows / chips — steel, not hue. */
  accentSurface: punch.steelSelected,

  /** Hairlines and card borders. */
  border: punch.steel,
  /** Higher-contrast border (buttons, active outline). */
  borderStrong: punch.steelStrong,

  /** Primary body text. Cool off-white. */
  textPrimary: '#F3F5F6',
  /** Secondary / metadata text. */
  textSecondary: punch.silver,
  /** Muted labels (timestamps, disabled state). */
  textMuted: punch.grey,
  /** Text on top of `accent` fills — dark, because chrome is a light fill. */
  textOnAccent: punch.black,

  /**
   * Primary action / focus / the active cue ring.
   *
   * Polished chrome — the brightest working colour that is not a
   * reward. ~13:1 on the background, which is what the live screen
   * needs when read at arm's length mid-combination.
   */
  accent: punch.chrome,

  /**
   * Warning / attention. Dim steel — quiet on purpose; the words and
   * icon beside it carry the meaning (§19.4).
   */
  warning: punch.steelDim,
  /**
   * Success indicator. Bright chrome — one step above `accent` on the
   * shine ladder, so a connected dot reads against an accent chip.
   */
  success: punch.chromeBright,
  /**
   * Reward. Two consumers, deliberately sharing one token: the
   * exact-target result badge (doc §23, M33-03) and the form-affirmation
   * glow on a punch node. Both mean "that was right".
   *
   * Near-white shine — the brightest thing on any screen. On a chrome
   * palette the reward cannot out-hue anything, so it out-shines
   * everything instead. Colour still never carries the meaning alone
   * (spec §19.4) — the exact state renders a target icon and the words
   * `EXACT TARGET`, and the form affirmation renders a star glyph.
   */
  gold: punch.shine,
  /**
   * Danger / stop.
   *
   * Steel-light — deliberately non-signalling by colour. Doc §13/§21
   * forbid a red flash mid-combination; the affordance is text-carried
   * ("STOP", "END") and the fill stays subdued so the athlete does not
   * slap it by reflex. Hex distinct from `border` because the
   * no-red-flash test compares by value.
   */
  danger: punch.steelLight,
  /** Solid destructive button background — distinct from surfaceElevated. */
  dangerSurface: punch.charcoalDeep,

  /**
   * Physical tracker colours. The trackers are colour-coded and permanently
   * assigned — blue is the left glove, red the right (see
   * ble/knownTrackers.ts). Any surface that distinguishes hands should use
   * these so the on-screen marker matches the device on the athlete's
   * wrist. These are the ONLY colours in the UI, kept precisely because
   * they are physical facts, not theme choices. §19.4 still applies —
   * always beside an L/R letter or a text label.
   */
  trackerLeft: punch.gloveBlue,
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
