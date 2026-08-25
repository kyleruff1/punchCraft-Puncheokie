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
   * How long a clip takes to say, if the implementation knows.
   *
   * Optional because only a real audio backend can measure it, and a domain
   * consumer must work without one. `CueAnnouncer` uses it to place a phrase
   * so it *finishes* before the combination starts — a coach calls the
   * combination and then you throw it, rather than being narrated over.
   */
  assetDurationMs?(id: VoiceAssetId): number | undefined
}
