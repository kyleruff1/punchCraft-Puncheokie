/**
 * The port every spoken call goes through (M34-02, doc §18).
 *
 * Two rules shape this interface, and both are about who owns time.
 *
 * **The scheduler is the master clock (D3).** `playAsset` takes `atMs` — a
 * deadline read off the cue timeline — rather than a delay. A delay would
 * make the caller compute "how long from now", which is a measurement of
 * when the call happened rather than of when the sound is due, and every
 * millisecond spent between the two would silently shift the workout. The
 * port's job is to hit a deadline it was handed; it never invents one.
 *
 * **Time-critical audio is a closed vocabulary, not text (D16).** Punch
 * commands, defense, footwork, bells and tones are pre-rendered clips
 * addressed by id. `speak()` exists only for descriptive lines — a round
 * summary, a metric callout — where a few hundred milliseconds of synthesis
 * cost nothing. Nothing time-critical may go through it.
 *
 * Pure TypeScript: no React Native, no Expo, no `src/audio/**` (spec §15.1).
 * The implementation lives in `src/audio/VoiceOutputExpo.ts` (M34-04).
 */

/**
 * Interruption order from doc §18.2, lowest number first.
 *
 * A safety call cuts everything. A bell outranks a punch command because
 * missing the end of a round is worse than missing one combination. A
 * coaching reminder yields to everything, including itself.
 */
export const AUDIO_PRIORITY = {
  safety: 0,
  bell: 1,
  punchCommand: 2,
  defenseFootwork: 3,
  metric: 4,
  coachingReminder: 5,
} as const

export type AudioPriority = (typeof AUDIO_PRIORITY)[keyof typeof AUDIO_PRIORITY]

/**
 * The closed set of pre-rendered clips (doc §18.2, D16).
 *
 * Ids name *what is said*, never which recording says it. D15's second
 * vocabulary renders this same set a second time — "one" and "jab" are the
 * same id under different clip sets — so the vocabulary choice belongs to
 * the manifest (M34-04), not to the id.
 *
 * Defense and footwork ids are exactly `DefenseCommand` and
 * `FootworkCommand` from the token union: a command the generator can emit
 * and the coach cannot say would be a silent hole in the workout.
 */
export type VoiceAssetId =
  // Punch numbers and the body suffix (doc §2, D10).
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | 'body'
  // Defense — `DefenseCommand`.
  | 'slip'
  | 'roll'
  | 'duck'
  | 'pull'
  | 'bob-weave'
  // Footwork — `FootworkCommand`.
  | 'pivot'
  | 'step-off'
  | 'circle'
  | 'cut-off-ring'
  | 'reset'
  // Session-level calls.
  | 'go'
  | 'stop'
  | 'switch'
  | 'bell'
  // Coast announcements (D23) — the whole instruction in one clip, because
  // "coast for half a minute" is a sentence rather than a word, and stitching
  // it from parts at run time is exactly what D16 forbids. Lengths live in
  // `domain/workout/coast.ts`.
  | 'coast-15'
  | 'coast-30'
  | 'coast-45'
  | 'coast-60'
  // Tones, which are sounds rather than words in either vocabulary.
  | 'tone-ready'
  | 'tone-repeat'
  | 'tone-warning'
  // Coach lines (M4) — encouragement and shorthand commands the rhythm map
  // schedules into audited silence gaps. Matched to the recipe's
  // `enabledCoachCalls` ids and the grammar's COACH_WORDS.
  | 'double-up'
  | 'put-it-on-em'
  | 'touch-and-go'
  | 'breathe'
  | 'hands-up'
  // Power mode: names WHY a slow 1-2 strike window slowed down.
  | 'power-strikes'
  // Set Ceremonies — pre-set call-out sentences (2-3 variants per
  // pattern; fill-time rng picks the variant) plus the two launch tails.
  | 'co-first-look-01'
  | 'co-first-look-02'
  | 'co-first-look-03'
  | 'co-ones-twos-01'
  | 'co-ones-twos-02'
  | 'co-ones-twos-03'
  | 'co-double-jab-01'
  | 'co-double-jab-02'
  | 'co-hooks-01'
  | 'co-hooks-02'
  | 'co-hooks-03'
  | 'co-uppercuts-01'
  | 'co-uppercuts-02'
  | 'co-square-01'
  | 'co-square-02'
  | 'co-buildup-start-01'
  | 'co-buildup-start-02'
  | 'co-buildup-start-03'
  | 'co-buildup-next-01'
  | 'co-buildup-next-02'
  | 'co-volume-01'
  | 'co-volume-02'
  | 'co-volume-03'
  | 'co-jab-volume-01'
  | 'co-jab-volume-02'
  | 'co-downstairs-01'
  | 'co-downstairs-02'
  | 'co-downstairs-03'
  | 'co-body-to-head-01'
  | 'co-body-to-head-02'
  | 'co-movement-01'
  | 'co-movement-02'
  | 'co-pressure-01'
  | 'co-pressure-02'
  | 'co-pressure-03'
  | 'co-new-pattern-01'
  | 'co-new-pattern-02'
  | 'co-settle-in-01'
  | 'co-settle-in-02'
  | 'co-coast-01'
  | 'co-coast-02'
  | 'co-coast-03'
  | 'co-power-coast-01'
  | 'co-power-coast-02'
  | 'co-power-coast-03'
  | 'co-flurry-01'
  | 'co-flurry-02'
  | 'co-final-round-01'
  | 'co-final-round-02'
  | 'co-breathe-reset-01'
  | 'co-breathe-reset-02'
  | 'co-okay-go'
  | 'co-regular-speed-go'
  // The 30-second closer: 'Thirty seconds left!' + a rotating finisher.
  | 'co-thirty-left'
  | 'co-closer-01'
  | 'co-closer-02'
  | 'co-closer-03'
  | 'co-closer-04'
  | 'co-closer-05'
  | 'co-closer-06'
  | 'co-closer-07'
  | 'co-closer-08'
  | 'co-closer-09'
  | 'co-closer-10'
  | 'co-closer-11'
  | 'co-closer-12'
  | 'co-closer-13'

/**
 * The callout vocabulary (D15) — which rendering of a combination is played.
 *
 * `numbers` says the notation ("one, two bee"); `techniques` names the moves
 * ("jab, body cross"). It is a rendering choice over one canonical sequence,
 * so it lives on the voice call, never in the workout data.
 */
export type CalloutVocabulary = 'numbers' | 'techniques'

/**
 * The performance state — the same call at three emotional levels.
 *
 * `teach` is warm and lands soft; `work` is the general in-round delivery;
 * `push` leans on the athlete and shouts the finish. Chosen from round context
 * by whoever drives the announcer, not baked into the workout.
 */
export type PerformanceState = 'teach' | 'work' | 'push'

/**
 * How a combination should be voiced — the axes beyond notation and cadence.
 *
 * Both optional: an implementation resolves the production baseline (numbers /
 * work) when they are absent, so a caller that has not been widened still gets
 * a valid call.
 */
export interface CombinationVoice {
  vocabulary?: CalloutVocabulary
  performance?: PerformanceState
}

/** Every id, for manifest completeness checks (M34-04). */
export const VOICE_ASSET_IDS: readonly VoiceAssetId[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  'body',
  'slip',
  'roll',
  'duck',
  'pull',
  'bob-weave',
  'pivot',
  'step-off',
  'circle',
  'cut-off-ring',
  'reset',
  'go',
  'stop',
  'switch',
  'bell',
  'coast-15',
  'coast-30',
  'coast-45',
  'coast-60',
  'double-up',
  'put-it-on-em',
  'touch-and-go',
  'breathe',
  'hands-up',
  'power-strikes',
  'co-first-look-01',
  'co-first-look-02',
  'co-first-look-03',
  'co-ones-twos-01',
  'co-ones-twos-02',
  'co-ones-twos-03',
  'co-double-jab-01',
  'co-double-jab-02',
  'co-hooks-01',
  'co-hooks-02',
  'co-hooks-03',
  'co-uppercuts-01',
  'co-uppercuts-02',
  'co-square-01',
  'co-square-02',
  'co-buildup-start-01',
  'co-buildup-start-02',
  'co-buildup-start-03',
  'co-buildup-next-01',
  'co-buildup-next-02',
  'co-volume-01',
  'co-volume-02',
  'co-volume-03',
  'co-jab-volume-01',
  'co-jab-volume-02',
  'co-downstairs-01',
  'co-downstairs-02',
  'co-downstairs-03',
  'co-body-to-head-01',
  'co-body-to-head-02',
  'co-movement-01',
  'co-movement-02',
  'co-pressure-01',
  'co-pressure-02',
  'co-pressure-03',
  'co-new-pattern-01',
  'co-new-pattern-02',
  'co-settle-in-01',
  'co-settle-in-02',
  'co-coast-01',
  'co-coast-02',
  'co-coast-03',
  'co-power-coast-01',
  'co-power-coast-02',
  'co-power-coast-03',
  'co-flurry-01',
  'co-flurry-02',
  'co-final-round-01',
  'co-final-round-02',
  'co-breathe-reset-01',
  'co-breathe-reset-02',
  'co-okay-go',
  'co-regular-speed-go',
  'co-thirty-left',
  'co-closer-01',
  'co-closer-02',
  'co-closer-03',
  'co-closer-04',
  'co-closer-05',
  'co-closer-06',
  'co-closer-07',
  'co-closer-08',
  'co-closer-09',
  'co-closer-10',
  'co-closer-11',
  'co-closer-12',
  'co-closer-13',
  'tone-ready',
  'tone-repeat',
  'tone-warning',
]

export type ToneKind = 'ready' | 'repeat' | 'warning'

/**
 * Independent levels, 0..1 (doc §25).
 *
 * Music is absent on purpose: the app never touches the user's playback
 * volume. Ducking is a platform focus request and nothing more (spec §14.6).
 */
export interface Volumes {
  voice: number
  bells: number
  haptics: number
}

export const DEFAULT_VOLUMES: Volumes = { voice: 1, bells: 1, haptics: 1 }

export interface VoiceOutputPort {
  /**
   * Play a pre-rendered clip.
   *
   * `atMs` is a monotonic cue-clock deadline, not a delay. Omit it to play
   * as soon as possible. A deadline already past is played immediately and
   * late rather than dropped — a call that arrives late is still the call
   * the athlete is being given.
   */
  playAsset(id: VoiceAssetId, atMs?: number): void
  /** Descriptive text only. Never a punch command (D16). */
  speak(text: string, priority: AudioPriority): void
  tone(kind: ToneKind): void
  /** Drop anything queued that is less urgent than `belowPriority`. */
  cancel(belowPriority: AudioPriority): void
  setVolumes(v: Volumes): void
  /**
   * Play several clips as one utterance, starting at `atMs`.
   *
   * A combination is one call, not several coincident ones. Sending it as a
   * phrase is what lets the implementation run the clips back to back — and
   * what lets the same word be said twice in a row without the second play
   * cutting off the first on a shared player.
   *
   * `tightness` scales the gap between clips: 1 gives each its full length,
   * lower values run them together the way a coach rattles off a combination.
   *
   * Optional so a domain consumer can fall back to repeated `playAsset`.
   */
  playPhrase?(ids: readonly VoiceAssetId[], atMs?: number, tightness?: number): void
  /**
   * Play a whole combination as one recorded utterance.
   *
   * Returns true when a phrase asset existed and was scheduled. False means
   * the caller should fall back to the per-word path — a combination the
   * library has not been rendered for must still be called, just less well.
   *
   * The combination is a notation string (`formatCombo` output) and the
   * cadence a profile id. The domain never learns which file that resolves
   * to; that mapping belongs to the manifest.
   */
  playCombination?(
    combination: string,
    cadence: string,
    atMs?: number,
    voice?: CombinationVoice,
  ): boolean
  /** Length of that utterance, so the announcer can place it. */
  combinationDurationMs?(
    combination: string,
    cadence: string,
    voice?: CombinationVoice,
  ): number | undefined
  /**
   * Drop every combination call that is scheduled but not yet sounding.
   *
   * The announcer pre-schedules a burst's periodic re-calls all at once
   * (it owns no timers, D3). When the burst ends early — target reached,
   * or skipped — the calls not yet started belong to a combination the
   * athlete is no longer being asked for, and playing them over the next
   * block is worse than silence.
   */
  cancelScheduledCombinations?(): void
  /**
   * Fire every scheduled call whose time has arrived.
   *
   * The workout runner calls this each tick — the same real-clock sample
   * that advances the cue engine and the screen — so scheduled audio and
   * presentation read one rhythm map. Wall timers measured on device
   * stretch ~2.3x under workout load; the tick does not.
   */
  advance?(): void
  /**
   * How long a clip takes to say, if the implementation knows.
   *
   * Optional because only a real audio backend can measure it, and a domain
   * consumer must work without one. `CueAnnouncer` uses it to place a phrase
   * so it *finishes* before the combination starts — a coach calls the
   * combination and then you throw it, rather than being narrated over.
   */
  assetDurationMs?(id: VoiceAssetId): number | undefined
  /**
   * The clock instant, in the same `clock()` reference the port uses,
   * up to which the coach track is expected to still be audible from
   * a currently sounding clip. `0` (or clock-in-the-past) means the
   * coach is quiet right now.
   *
   * A15 (#256): the ONE piece of state every scheduler needs to reason
   * about "is the coach already talking?". `flushMetric` uses it to
   * defer past the next clip's end so a held metric never lands on top
   * of the very call it was held for; the announcer uses it before
   * dispatching a `gap-filler` so a fresh filler cannot overwrite a
   * still-sounding one; the analyzer uses it to distinguish LONG (two
   * clips overlapped) from a legitimately long single clip.
   *
   * Optional so a domain consumer can work without a real backend.
   */
  audibleUntilMs?(): number
}
