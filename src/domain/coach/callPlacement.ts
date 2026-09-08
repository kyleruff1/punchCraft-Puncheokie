/**
 * Where the coach's per-bar CALL and section LEAD-IN are placed on the round's
 * work axis — the one definition, shared by everything that needs it.
 *
 * ## Why this is its own module
 *
 * This rule used to live only in `_useWorkoutRunner.ts`, a React hook module.
 * Anything outside the app that needed it had to restate it, and restatements
 * drift:
 *
 * - `tools/analysis/first-round-manifest.ts` anchored a lead-in to the
 *   section's first STRIKE while the runner anchors it to the section's
 *   rep-0 CALL dispatch. The gap is the call's own lead — about 2 s — so the
 *   correlator flagged all three lead-ins of every quick workout as
 *   mismatched on drives where the runtime had been exactly right. Twelve
 *   workouts would have carried a permanent WARN for a defect in the
 *   expectation, not the app.
 * - `src/domain/workout/samples/__tests__/clickCallFit.test.ts` carried its
 *   own `MIN_BREATH_MS = 150` under the comment "mirrors
 *   _useWorkoutRunner.MIN_BREATH_MS (RN module — not importable here)".
 *
 * Living under `src/domain/**` it imports no React and no Expo (Rule 2), so
 * the runner, the domain tests and the Node analysis tools can all import the
 * same numbers and the same arithmetic.
 *
 * `_useWorkoutRunner.ts` re-exports every symbol here, so existing imports
 * from the runner keep working and there is still exactly one definition.
 */

/** The two calling vocabularies the coach speaks. */
export type CallVocabulary = 'numbers' | 'techniques'

/**
 * Breath between a section lead-in's last word and its section's first
 * strike (Script Bible v2). The clip is scheduled to END this far before
 * the block starts; the 50 ms tick granularity eats into it, never past it.
 */
export const LEAD_IN_PAD_MS = 250

/**
 * Per-bar loop calls finish ~half a second before the bar's first strike
 * (Kyle, on-glass 2026-09-02: the 100ms pad "creates pressure" — with
 * the setup pauses giving each section clean air, the call now leads its
 * bar with real separation). Long clips still start as early as the
 * previous audio allows; the pad is the target, the busy check the law.
 */
export const CALL_PAD_MS = 500

/**
 * How long a per-bar call takes to become AUDIBLE after the scheduler
 * decides to fire it — subtracted from every call's dispatch time so the
 * breath the athlete actually gets is the breath `breathForBar` intends.
 *
 * Measured, not guessed (release build, body-work round 1, 46 call bars,
 * `tools/analysis/observed-timing.mjs`):
 *
 *   scheduler fired late (`clickScript.dispatch.lateMs`)   46.5 ms median
 *   play() → first audio (`voice.observed.onsetLatencyMs`) 25.0 ms median
 *                                                          ─────────────
 *                                                          ~71 ms
 *
 * Deliberately NOT the 201 ms the raw "observed end − planned end" showed.
 * 113 ms of that was the END EVENT arriving late, not audio playing long:
 * the manifest's `durationMs` matches every rendered wav to within 0.5 ms,
 * and the excess varies by player path (124/94/67 ms) — which file content
 * never would. Correcting for reporting lag would have pushed every call
 * ~130 ms too early.
 *
 * Validated on content it was not tuned on (2026-09-07, release): across
 * quick-six-count's 85 call bars and quick-speed-burst's 185, per-slot
 * shortfall runs −15 to +49 ms.
 *
 * Re-measure after any change to the dispatch tick or the audio path; the
 * analyzer proposes a new value from `breathMs` on the dispatch record.
 */
export const CALL_DISPATCH_LAG_MS = 71

/**
 * Technique-vocabulary lead: per-bar CALLS and section LEAD-INS dispatch
 * this much EARLIER than numbers (a pure time-shift of the technique
 * track; numbers stay at 0). Split into two knobs so the shot-calling
 * calls tune independently of the setup-pause lead-ins.
 *
 * CALL lead settled by mic measurement (Kyle, 2026-09-04): at 500 the
 * call ended ~1s before the shot across every extreme set (body-work
 * +1053, uppercut +984, speed-combos +1091 mean; 0 late) — his "too
 * early." Pulling back a quarter second lands a comfortable breath while
 * the tightest set (speed-combos, +445 worst at 500) stays safely
 * never-late (~+195 worst). His "we need a quarter-second delay."
 */
export const TECHNIQUE_CALL_LEAD_MS = 250

/** Lead-ins (the setup-pause whisper) keep the original lead — not the "too early" complaint. */
export const TECHNIQUE_LEADIN_LEAD_MS = 500

/**
 * Numbers CALL lead (Kyle, 2026-09-04): the same measure-and-promote pass
 * on numbers found it already tight (~525ms breath, Kyle liked it) but
 * with one marginal late (-31ms worst on the long 1-2b-3b-2 body motif
 * after the bright/pre-arm re-render). A small nudge guarantees the
 * never-late floor (-31 -> +69 worst) without pushing numbers to
 * technique's wider breath. Numbers lead-ins stay at 0.
 */
export const NUMBERS_CALL_LEAD_MS = 100

/**
 * Set-aware call breath (Kyle, 2026-09-04). The old breath (node − call-end)
 * was a fixed `CALL_PAD_MS + callLead` = 600ms(numbers)/750ms(techniques),
 * tuned by mic on DENSE 4-node combos only. On a dense bar the call's words
 * fill that pre-node window at combo tempo → "snaps to perfect." On a 1-2
 * node SLOW bar (wide inter-node interval) the same short call ends the full
 * 600ms early and then sparse punches unfold under a long silence → Kyle's
 * "offset by a delay too much." So the breath now SHRINKS as the bar's
 * inter-node interval (slotMs) widens past the dense reference, degenerating
 * to the exact old constant on tight bars (dense combos unchanged, still
 * snap). `breath = clamp(DENSE − GAIN·max(0, slotMs − REF), MIN, DENSE)`.
 * All knobs are mic-tunable via tools/audition/call_offset_analysis.py.
 */
export const DENSE_BREATH_MS = {
  numbers: CALL_PAD_MS + NUMBERS_CALL_LEAD_MS, // 600 — the value tuned on dense numbers combos
  techniques: CALL_PAD_MS + TECHNIQUE_CALL_LEAD_MS, // 750 — dense techniques
} as const

/** Inter-node interval the dense breath was tuned at (dense combos run ~250-333ms slots); at/below this, breath = the full dense value. */
export const BREATH_REF_SLOT_MS = 300

/** How hard the breath shrinks per ms the bar's inter-node interval exceeds the reference. */
export const BREATH_TRACK_GAIN = 1.0

/** Floor: the call still finishes at least this far before the bar's first shot, on the widest/slowest bars. */
export const MIN_BREATH_MS = 150

/**
 * How much of the intended breath the audio path eats before the sound
 * reaches the athlete — the gap between "the player says it is playing" and
 * "the playhead is moving".
 *
 * `PlaybackObserver` stamps a play's onset at `playbackStatusUpdate
 * playing: true`. Across two full release sessions that event carried
 * `positionAtOnsetMs: 0` in 296 of 296 observations: media3 asserts "playing"
 * with the playhead still at zero, on a buffer floored at 250 ms. Timing one
 * play two ways at once (src/app/dev/voice-latency.tsx "Calibrate ruler",
 * release 73f7ea6f, TB125FU, armed path, 40 reps/asset) measured the gap:
 *
 *   call cc-e08318c0 (48 kHz)  status 25.2  playhead 118.8  skew  95.4
 *   bell             (24 kHz)  status 19.2  playhead 119.1  skew 101.4
 *
 * So `MIN_BREATH_MS = 150` was a lie at the ear. Recomputed per bar from the
 * raw logs, 8-15% of bars in the tighter workouts delivered under the floor,
 * the worst at 57 ms, and one pre-lag-fix capture put a call ON the punch
 * (−7.5 ms). This constant is what makes the floor mean 150 ms of silence the
 * athlete actually hears.
 *
 * Used ONLY in `breathForBar`'s lower clamp, and that restriction is the
 * whole design:
 *
 *  - NOT added to `CALL_DISPATCH_LAG_MS`. That would move every dense bar
 *    95 ms earlier, back toward the setting Kyle rejected on glass as "too
 *    early". His ear tuned the DELIVERED state, not the intended one — the
 *    breath he approved is today's delivered breath, and dense bars never
 *    breach the floor anyway (quick-speed-burst: 0 of 185 under it).
 *  - NOT added to `DENSE_BREATH_MS`, `CALL_PAD_MS` or the lead constants,
 *    all of which are mic-tuned. How long the coach stays silent is Kyle's
 *    call; this only stops the clamp from promising silence that is not
 *    there.
 *
 * The clamp therefore starts biting at `slotMs > 655` (numbers) / `> 805`
 * (techniques) rather than 750/900, and the bars it moves are exactly the
 * wide, slow ones already pinned at the floor. Dense bars are unchanged to
 * the millisecond.
 *
 * This is a FLOOR, twice over: the playhead moving is itself earlier than
 * sound leaving the speaker, and `currentTime` is a blocking `runOnMain` read
 * resolved to one JS loop turn, so it reads late and compresses the gap.
 * Closing that last stretch needs a microphone — see the still-open
 * `PLAYHEAD_TO_SPEAKER_MS`.
 */
export const DELIVERED_BREATH_SHORTFALL_MS = 95

/**
 * Per-call breath override, keyed by call slot (e.g. 'call/1-2-.-.'). Empty
 * by design — the escape hatch when the mic says a specific bucket wants a
 * bespoke breath the formula doesn't nail. A value here replaces the formula.
 */
export const CALL_BREATH_OVERRIDES: Record<string, number> = {}

/** The minimum a bar must expose for placement: its tokens and their offsets. */
export interface PlaceableBar {
  tokens: readonly { kind: string }[]
  tokenOffsetsMs: readonly number[]
}

/**
 * The breath this bar's call should finish before the bar's first PUNCH, and
 * where that punch sits inside the bar.
 *
 * Anchored to the first punch rather than the bar start because a bar may
 * open on a rest.
 */
export function breathForBar(
  cue: PlaceableBar,
  vocabulary: CallVocabulary,
  slot: string,
): { breathMs: number; firstPunchOffsetMs: number } {
  const punchIdx: number[] = []
  cue.tokens.forEach((t, i) => {
    if (t.kind === 'punch') punchIdx.push(i)
  })
  const firstPunchOffsetMs = punchIdx.length > 0 ? (cue.tokenOffsetsMs[punchIdx[0]!] ?? 0) : 0
  const dense = DENSE_BREATH_MS[vocabulary]
  const override = CALL_BREATH_OVERRIDES[slot]
  if (override !== undefined) return { breathMs: override, firstPunchOffsetMs }
  const slotMs =
    punchIdx.length >= 2
      ? (cue.tokenOffsetsMs[punchIdx[1]!] ?? 0) - firstPunchOffsetMs
      : Number.POSITIVE_INFINITY
  // The floor is raised by the delivered shortfall so that 150 ms of it
  // survives the audio path. Only the LOWER clamp moves: the upper bound is
  // still the mic-tuned dense breath, so a dense bar comes out of here with
  // the number Kyle approved, unchanged.
  const breathMs = Math.max(
    MIN_BREATH_MS + DELIVERED_BREATH_SHORTFALL_MS,
    Math.min(dense, dense - BREATH_TRACK_GAIN * Math.max(0, slotMs - BREATH_REF_SLOT_MS)),
  )
  return { breathMs, firstPunchOffsetMs }
}

/**
 * When the runner fires a bar's CALL, on the round's work axis.
 *
 * The clip is placed to finish `breathMs` before the bar's first punch, then
 * pulled `CALL_DISPATCH_LAG_MS` earlier to pay for the dispatch path (the
 * scheduler's own lateness plus play()-to-audio), so the breath the athlete
 * gets is the breath intended.
 */
export function callDispatchAtMs(args: {
  cue: PlaceableBar
  /** The bar's start on the round's work axis (`CueInstance.scheduledStartMs`). */
  scheduledStartMs: number
  vocabulary: CallVocabulary
  slot: string
  clipDurationMs: number
}): { dispatchAtMs: number; firstNodeMs: number; breathMs: number } {
  const { breathMs, firstPunchOffsetMs } = breathForBar(args.cue, args.vocabulary, args.slot)
  const firstNodeMs = args.scheduledStartMs + firstPunchOffsetMs
  return {
    dispatchAtMs: Math.max(0, firstNodeMs - args.clipDurationMs - breathMs - CALL_DISPATCH_LAG_MS),
    firstNodeMs,
    breathMs,
  }
}

/**
 * When the runner fires a section's LEAD-IN, on the round's work axis.
 *
 * The whisper must END before the section's opening CALL begins — not before
 * the section's first strike. Those differ by the call's whole lead (its clip
 * length plus its breath plus the dispatch lag), roughly two seconds, and
 * anchoring to the strike is precisely the drift this module exists to end.
 * `endByMs` therefore takes the rep-0 call's dispatch time when the section
 * has one, and falls back to the first strike when it does not.
 */
export function leadInDispatchAtMs(args: {
  /** The rep-0 call's dispatch time, or undefined when that section has no call. */
  rep0CallDispatchAtMs?: number
  /** The section's first bar start, used only when there is no rep-0 call. */
  scheduledStartMs: number
  clipDurationMs: number
  vocabulary: CallVocabulary
}): { dispatchAtMs: number; endByMs: number } {
  const endByMs = args.rep0CallDispatchAtMs ?? args.scheduledStartMs
  const leadMs = args.vocabulary === 'techniques' ? TECHNIQUE_LEADIN_LEAD_MS : 0
  return {
    dispatchAtMs: Math.max(0, endByMs - args.clipDurationMs - LEAD_IN_PAD_MS - leadMs),
    endByMs,
  }
}
