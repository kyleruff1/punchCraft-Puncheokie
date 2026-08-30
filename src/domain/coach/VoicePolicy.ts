/**
 * VoicePolicy — three orthogonal properties of how a cue's coach
 * voice fires (M39-V2 Phase 3, Kyle amendments 2026-08-30).
 *
 * The V1c enum collapsed content + timing + frequency into one
 * discriminator (`per-punch | announce-then-work | announce-per-rep
 * | sustained | coasting | synchronized`) and started spawning
 * combinatorial values (`announce-per-rep-synchronized`, etc.).
 * V2 splits the three concerns:
 *
 *   contentKind      — WHAT the coach says
 *   defaultTiming    — WHEN the audible event lands relative to the strike(s)
 *   repeatFrequency  — HOW OFTEN it fires across a cue's repetitions
 *
 * Together they cover every shape Kyle spec'd:
 *
 *   Standard combo drill:
 *     {contentKind: 'combo-announce', defaultTiming: 'precall',
 *      repeatFrequency: 'once-per-rep'}
 *
 *   Sustained pump ("Pump the jab, 30 s"):
 *     {contentKind: 'sustained-instruction', defaultTiming: 'precall',
 *      repeatFrequency: 'once-per-cue'}
 *
 *   Coasting (intro + authored synchronized check-ins):
 *     {contentKind: 'coast-intro', defaultTiming: 'precall',
 *      repeatFrequency: 'authored-events'}
 *
 *   Synchronized single-strike reinforcement:
 *     {contentKind: 'strike-call', defaultTiming: 'synchronized',
 *      repeatFrequency: 'selected-reps'}
 *
 * Pure module — no React, no audio, no clock. Downstream `compileCue`
 * reads the policy at compile time and produces `CompiledCoachEvent`s
 * accordingly.
 */

/**
 * WHAT the coach says. Each kind maps to a distinct render batch
 * and its own asset shape:
 *
 * - `combo-announce`     — "One, two, three, go!" — one utterance per combo
 * - `strike-call`        — a single strike name ("Jab", "Two"); one word (or two for body shots)
 * - `sustained-instruction` — "Pump the jab, keep it firing" — one line covers a block
 * - `coast-intro`        — "Coast on the one-two, stay loose" — announces a coast
 * - `coast-checkin`      — mid-coast reminder / correction, often synchronized to a specific strike
 * - `encouragement`      — "yes!", "keep going" — motivational, fires independent of strikes
 */
export type CoachContentKind =
  | 'combo-announce'
  | 'strike-call'
  | 'sustained-instruction'
  | 'coast-intro'
  | 'coast-checkin'
  | 'encouragement'

/**
 * WHEN the coach event's audible span lands relative to the strike(s)
 * it teaches. The compiler stamps the actual tick offsets on each
 * `CompiledCoachEvent`; this discriminator captures the AUTHORED
 * intent so the runtime + diagnostics can classify without measuring.
 *
 * - `precall`      — audible END lands before the first strike it teaches (call-and-response)
 * - `synchronized` — audible START lines up with the strike's own start (near-zero offset)
 * - `shared-block` — one coach event spans a whole block of strikes (sustained instructions)
 * - `independent` — fires on its own schedule; no strike-time relationship (encouragements)
 */
export type CoachTimingRelation =
  | 'precall'
  | 'synchronized'
  | 'shared-block'
  | 'independent'

/**
 * HOW OFTEN the coach event fires across a cue's repetitions.
 *
 * - `once-per-cue`    — one event for the whole cue, regardless of rep count
 * - `once-per-rep`    — one event before every authored rep (combo drill default)
 * - `first-rep-only`  — one event before rep 0; interior reps silent (memorized drills)
 * - `selected-reps`   — an explicit list of rep indexes fires
 * - `authored-events` — coast check-ins etc.; not tied to rep boundaries at all
 */
export type CoachRepeatFrequency =
  | 'once-per-cue'
  | 'once-per-rep'
  | 'first-rep-only'
  | 'selected-reps'
  | 'authored-events'

export interface VoicePolicy {
  contentKind: CoachContentKind
  defaultTiming: CoachTimingRelation
  repeatFrequency: CoachRepeatFrequency
  /**
   * Rep indexes to fire on when `repeatFrequency === 'selected-reps'`.
   * Ignored for every other frequency. Empty array under
   * `selected-reps` means "no coach events" — legal but rare.
   */
  selectedRepIndexes?: readonly number[]
}

/**
 * The relationship between a coach event and a strike it references.
 * Attached bidirectionally on the compiled timeline:
 *
 *   - `CompiledStrikeEvent.coachLinks[]` — links this strike has to any coach event
 *   - `CompiledCoachEvent.strikeEventIds[]` — inverse, which strikes this event teaches
 *
 * A single strike can carry multiple links (pre-call + synchronized
 * reinforcement + shared-block sustained instruction all at once —
 * the Kyle-mixed-cue case).
 */
export type CoachStrikeRelation =
  | 'precall'
  | 'synchronized'
  | 'shared-block'
  | 'checkin'

export interface CoachEventLink {
  coachEventId: string
  relation: CoachStrikeRelation
}

// ---------------------------------------------------------------------------
// Behavioral defaults per Kyle (2026-08-30 amendments): discrete combos
// pre-call each rep; sustained + coasting one intro + authored events.
// Exported for `compileCue` to fill omitted fields.
// ---------------------------------------------------------------------------

export const DEFAULT_COMBO_POLICY: VoicePolicy = Object.freeze({
  contentKind: 'combo-announce',
  defaultTiming: 'precall',
  repeatFrequency: 'once-per-rep',
})

export const DEFAULT_SUSTAINED_POLICY: VoicePolicy = Object.freeze({
  contentKind: 'sustained-instruction',
  defaultTiming: 'precall',
  repeatFrequency: 'once-per-cue',
})

export const DEFAULT_COAST_POLICY: VoicePolicy = Object.freeze({
  contentKind: 'coast-intro',
  defaultTiming: 'precall',
  repeatFrequency: 'authored-events',
})
