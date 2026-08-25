/**
 * What the Voice Coach is allowed to say (M34-02, doc §18, §25, D1, D15).
 *
 * Two gates, deliberately separate.
 *
 * **`voiceAllowed`** answers "may the coach make any sound at all?" It is
 * the D1 gate: when someone else's audio is playing, the coach is silent
 * unless the athlete has explicitly said otherwise. Nothing else opens it —
 * not a mode, not a style, not a preset.
 *
 * **`shouldSpeak`** answers "is this particular thing worth saying?" It runs
 * only after the first gate has opened.
 *
 * Keeping them apart matters because they fail differently. A bug in the
 * second makes the coach chatty or terse. A bug in the first talks over
 * someone's music without their consent, which is the one failure the
 * design says must never happen.
 *
 * Pure TypeScript (spec §15.1).
 */

/** How much the coach speaks (D15). */
export type VoiceMode = 'off' | 'minimal' | 'standard' | 'full'

/** How it speaks — the four behaviours of doc §18.1. */
/**
 * How much the coach speaks.
 *
 * **Every punch the athlete is asked to throw is called.** `call-and-go` names
 * the whole combination before it; `follow-the-call` names each punch as it
 * comes due. `minimal` speaks only round events — deliberately quiet, and the
 * one style that is silent by choice rather than substituting for a call.
 *
 * `coach-shorthand` is gone (D22). It spoke a combination once and marked every
 * repetition with a beep, which is the one thing this vocabulary must not do:
 * a tone standing in for a punch tells the athlete something is expected
 * without telling them what. Persisted values are migrated on read — see
 * `normalizeVoiceStyle`.
 */
export type VoiceStyle = 'call-and-go' | 'follow-the-call' | 'minimal'

/** Styles that were once selectable and must still be readable from storage. */
const RETIRED_STYLES: Record<string, VoiceStyle> = {
  // Beeped its repetitions instead of calling them (D22).
  'coach-shorthand': 'call-and-go',
}

/**
 * A stored style, mapped onto one that still exists.
 *
 * A saved setting outlives the release that wrote it, so removing a style is
 * not enough — an install carrying `coach-shorthand` would otherwise keep
 * beeping forever, and the athlete would have no control that explains why.
 */
export function normalizeVoiceStyle(style: string): VoiceStyle {
  if (style in RETIRED_STYLES) return RETIRED_STYLES[style] as VoiceStyle
  return style === 'call-and-go' || style === 'follow-the-call' || style === 'minimal'
    ? style
    : 'call-and-go'
}

/**
 * Which words it uses (D15).
 *
 * `numbers` says the digits, the way a coach calls combinations in a gym.
 * `names` says the techniques, for someone still learning the numbering —
 * and costs roughly four times the phrase duration, which is why the
 * announcer may downgrade to `numbers` at a cadence that cannot fit names.
 */
export type VoiceVocabulary = 'numbers' | 'names'

export interface VoiceCoachPolicy {
  mode: VoiceMode
  style: VoiceStyle
  vocabulary: VoiceVocabulary
  /**
   * D1: speak over third-party playback. **Only the athlete's own toggle
   * may set this true** — never a default, a migration, a preset, or a mode
   * change (spec §13.5).
   */
  overlayOptIn: boolean
  metricAnnouncements: 'off' | 'periodic' | 'round-summary'
  finalTenSecondWarning: boolean
}

/**
 * Defaults (D22, D18).
 *
 * **Call and Go, not Coach Shorthand.** §18.1 recommended shorthand — speak a
 * combination once, beep the repetitions — on the reasoning that repeating a
 * call the athlete has already heard is nagging. That held for hand-authored
 * workouts; against generated ones it produced a coach that beeped more than it
 * spoke, because the generator emits blocks of two to four repetitions. Under
 * the Set model a repeated block is one Set rather than N repetitions, so the
 * premise largely dissolves, and where a Set does recur it is called. Shorthand
 * stays available as a setting.
 *
 * **Names, not numbers.** The athlete-facing default is technique names — "jab,
 * cross, lead hook" — because it teaches while it calls. Numbers remain one tap
 * away for anyone who already thinks in them.
 */
export function defaultVoiceCoachPolicy(): VoiceCoachPolicy {
  return {
    mode: 'standard',
    style: 'call-and-go',
    vocabulary: 'names',
    // D1. The default is the whole point: it is never true unless asked for.
    overlayOptIn: false,
    metricAnnouncements: 'round-summary',
    finalTenSecondWarning: true,
  }
}

export type SpokenCategory =
  | 'punch-command'
  | 'stance-change'
  | 'defense'
  | 'footwork'
  | 'bell'
  | 'final-countdown'
  | 'metric'
  | 'coaching-reminder'

/**
 * The D1 gate (spec §13.5, §14.6).
 *
 * `playbackActive` is a plain boolean about *whether* something else is
 * playing. Nothing about what it is, or what is in it, reaches this
 * function — the app never inspects another app's audio.
 */
export function voiceAllowed(p: VoiceCoachPolicy, playbackActive: boolean): boolean {
  if (p.mode === 'off') return false
  if (playbackActive && !p.overlayOptIn) return false
  return true
}

/**
 * Doc §18.1's Minimal behaviour: stance changes, round events, and metric
 * summaries. Punch, defense and footwork calls are left to the visuals.
 */
const MINIMAL_CATEGORIES: ReadonlySet<SpokenCategory> = new Set<SpokenCategory>([
  'stance-change',
  'bell',
  'final-countdown',
  'metric',
])

/**
 * Whether one category may be voiced right now.
 *
 * `inCombo` is the doc §18 rule that a metric callout must never land in the
 * middle of a combination: the athlete is mid-sequence and a number spoken
 * over the next punch is worse than a number spoken late. The announcer
 * holds it rather than dropping it (M34-03).
 *
 * Does not consult the D1 gate — call `voiceAllowed` first.
 */
export function shouldSpeak(
  p: VoiceCoachPolicy,
  c: SpokenCategory,
  inCombo: boolean,
): boolean {
  if (p.mode === 'off') return false

  // Doc §18: never interrupt a combination for something that can wait.
  if (inCombo && (c === 'metric' || c === 'coaching-reminder')) return false

  if (c === 'metric' && p.metricAnnouncements === 'off') return false
  if (c === 'final-countdown' && !p.finalTenSecondWarning) return false

  // Mode and style can each ask for less. The more restrictive one wins —
  // otherwise "style: minimal, mode: full" would produce a chatty coach the
  // athlete explicitly asked to quieten.
  if (p.mode === 'minimal' || p.style === 'minimal') return MINIMAL_CATEGORIES.has(c)

  // A coaching reminder is the one thing `standard` holds back; `full` adds
  // it (doc §18.2's priority order puts it last for the same reason).
  if (p.mode === 'standard' && c === 'coaching-reminder') return false

  return true
}
