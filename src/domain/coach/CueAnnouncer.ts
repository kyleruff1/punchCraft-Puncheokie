/**
 * Turning cue events into spoken calls (M34-03, doc §18, §20, §25).
 *
 * ## It owns no time
 *
 * The announcer has no timer, reads no clock, and schedules nothing of its
 * own. Every deadline it hands the output port is arithmetic on timestamps
 * that arrived with the event. That is D3 made structural: if the announcer
 * could set a timer, speech latency would eventually be allowed to move the
 * workout, and the failure mode is a coach that narrates the punch you
 * already threw.
 *
 * ## Two clocks, and the conversion between them
 *
 * Cue times are **work-elapsed** — milliseconds into the current round. The
 * output port schedules against the **monotonic** clock, which counts from
 * app launch. They are different origins, and a work-elapsed deadline handed
 * straight to the port is not merely wrong, it is wrong by minutes: every
 * call looks overdue and fires at once.
 *
 * Every `CueEvent` carries both readings — `workElapsedMs` and `nowMs` — so
 * their difference is the offset between the clocks at that instant. That is
 * still arithmetic on the event, not a clock read, so D3 holds.
 *
 * ## It never speaks first and checks later
 *
 * Every entry point begins at the D1 gate. Not "mostly" — a single path that
 * emits before checking is an app that talks over someone's music, which is
 * the one thing the design says must never happen.
 *
 * ## Every call is made. A tight one, if it has to be.
 *
 * At sprint cadence a spoken phrase can be longer than the gap before the
 * combination starts (D15). The obvious remedies are both bad: queuing it
 * anyway makes the coach drift until it is calling the wrong punch, and
 * dropping it leaves the athlete with a combination nobody named.
 *
 * So the phrase is **compressed instead of dropped**. A combination is
 * delivered in the `combo` clip form — clipped, quicker renderings — and the
 * gap between its words is tightened until it fits, down to a floor where
 * numbers stop being countable. A single command keeps its full `standalone`
 * delivery, because one punch called at combination speed sounds like a
 * fragment rather than an order.
 *
 * Only if a phrase still cannot finish at maximum tightness does it start at
 * the preview and run slightly long — reported, never silent. A late word is
 * recoverable; a combination the coach never named is not.
 *
 * Pure TypeScript (spec §15.1).
 */

import { assetPriority } from './assetPriority'
import { comboPhraseAssets } from './vocabulary'
import { formatCombo } from '../workout/WorkoutTokens'
import {
  AUDIO_PRIORITY,
  type CalloutVocabulary,
  type CombinationVoice,
  type PerformanceState,
  type VoiceAssetId,
  type VoiceOutputPort,
} from './VoiceOutputPort'
import { shouldSpeak, voiceAllowed, type VoiceCoachPolicy } from './VoiceCoachPolicy'
import type { CueEvent, SessionPhaseEvent } from '../programs/CueState'
import type { CueInstance } from '../programs/CueTimeline'
import type { Stance } from '../workout/WorkoutTokens'

/** Doc §18.3: voice at T−0.75 s, ready tone at T−0.10 s. M36-03 tunes these. */
export const DEFAULT_ANNOUNCE_LEAD_TIMES = { announceMs: 750, readyToneMs: 100 } as const

/**
 * How closely the words of a combination run together.
 *
 * 1 leaves each clip its full length. Lower values trim the tail so the
 * numbers flow, which is how a combination is actually called — "one-two-
 * three", not three announcements.
 */
export const COMBO_TIGHTNESS = 0.72

/** A single command is called at its full length, not at combination speed. */
export const SINGLE_TIGHTNESS = 1

/** The tightest a combination may be squeezed before words stop being countable. */
export const MIN_TIGHTNESS = 0.45

/** Doc §25's final warning, in milliseconds remaining. */
export const FINAL_WARNING_AT_MS = 10_000

export interface AnnouncerLeadTimes {
  announceMs: number
  readyToneMs: number
}

/**
 * How a phrase had to be adjusted to fit. Reported so it is never silent.
 *
 * `compressed` means the words were tightened past the normal combination
 * cadence. `overruns` means even the tightest delivery runs past the ready
 * tone — it is still spoken, because a combination nobody named is worse than
 * one named slightly late.
 */
export interface AnnouncerSkip {
  cueId: string
  reason: 'compressed' | 'overruns'
  phraseMs: number
  availableMs: number
  tightness: number
}

export interface CueAnnouncerOptions {
  policy: VoiceCoachPolicy
  output: VoiceOutputPort
  leadTimes?: AnnouncerLeadTimes
  /**
   * How long a clip takes to say. Measured from the real assets (M34-01 /
   * M34-04), never guessed — omit it and the fit check is skipped entirely,
   * which is the honest default when nothing has measured the clips yet.
   */
  assetDurationsMs?: Readonly<Partial<Record<VoiceAssetId, number>>>
  /**
   * Cadence profile id, used to pick which rendering of a combination to
   * play. A phrase is a performance, so the cadence chooses a different
   * recording rather than a different playback rate.
   */
  cadence?: string
  /**
   * Which callout vocabulary to speak (D15, Coach Callouts). Defaults to
   * `numbers`. It is a rendering choice over the one canonical sequence, so it
   * belongs here, not in the workout data.
   */
  vocabulary?: CalloutVocabulary
  /**
   * How to pick the performance state for a cue. The round context that
   * decides teach / work / push (opening block, final seconds, pressure)
   * lives upstream, so it is injected rather than derived here — the announcer
   * stays pure. Defaults to `work`, the general in-round delivery.
   */
  performanceFor?: (cue: CueInstance) => PerformanceState
  onSkip?: (skip: AnnouncerSkip) => void
}

export class CueAnnouncer {
  private policy: VoiceCoachPolicy
  private readonly output: VoiceOutputPort
  private readonly leadTimes: AnnouncerLeadTimes
  private readonly durations: Readonly<Partial<Record<VoiceAssetId, number>>> | undefined
  private readonly onSkip: ((skip: AnnouncerSkip) => void) | undefined
  private readonly cadence: string
  private readonly vocabulary: CalloutVocabulary
  private readonly performanceFor: (cue: CueInstance) => PerformanceState

  private playbackActive = false
  /** Phrase plans resolved at preview, so nothing is computed at announce. */
  private readonly prepared = new Map<string, VoiceAssetId[]>()
  /** True between a cue becoming active and its window closing (doc §18). */
  private inCombo = false
  /** A metric waiting for the combination to end. Newest wins. */
  private heldMetric: string | null = null
  private roundIndex = -1
  private readonly warnedRounds = new Set<number>()

  constructor(opts: CueAnnouncerOptions) {
    this.policy = opts.policy
    this.output = opts.output
    this.leadTimes = opts.leadTimes ?? { ...DEFAULT_ANNOUNCE_LEAD_TIMES }
    this.durations = opts.assetDurationsMs
    this.onSkip = opts.onSkip
    this.cadence = opts.cadence ?? 'steady'
    this.vocabulary = opts.vocabulary ?? 'numbers'
    this.performanceFor = opts.performanceFor ?? (() => 'work')
  }

  setPolicy(p: VoiceCoachPolicy): void {
    this.policy = p
  }

  /** D1 input from M34-05's playback detector. */
  setThirdPartyPlayback(active: boolean): void {
    this.playbackActive = active
  }

  /** Cue ids with a phrase plan in hand — doc §18's "prepare several ahead". */
  preparedCueIds(): string[] {
    return [...this.prepared.keys()]
  }

  // -------------------------------------------------------------------------

  onCueEvent(e: CueEvent): void {
    // Preparing is silent work, so it is the one thing allowed through the
    // gate: a phrase resolved while music plays costs nothing and means the
    // coach is ready the moment the athlete opts in.
    if (e.type === 'cue-previewing') {
      this.prepared.set(e.cue.id, comboPhraseAssets(e.cue.tokens))
      return
    }

    if (!voiceAllowed(this.policy, this.playbackActive)) {
      // Still track the combination boundary: a metric held from before the
      // gate closed must not be released mid-combination when it reopens.
      this.trackCombo(e)
      return
    }

    switch (e.type) {
      case 'cue-announcing':
        this.announce(e.cue, e.nowMs - e.workElapsedMs)
        break

      case 'cue-active':
        this.inCombo = true
        break

      case 'token-due':
        this.onTokenDue(e.cue, e.tokenIndex)
        break

      case 'cue-window-closed':
      case 'cue-completed':
      case 'cue-expired':
      case 'cue-cancelled':
        this.inCombo = false
        this.prepared.delete(e.cue.id)
        this.flushMetric()
        break

      default:
        break
    }
  }

  onSessionPhase(e: SessionPhaseEvent): void {
    switch (e.type) {
      case 'paused':
      case 'cancelled':
        // Everything below safety goes. A phrase queued before a pause would
        // otherwise land on a stopped athlete, calling a punch that is no
        // longer coming.
        this.output.cancel(AUDIO_PRIORITY.safety)
        this.inCombo = false
        this.heldMetric = null
        return

      case 'resumed':
        // Nothing to replay: the cue engine re-emits the current cue's
        // lifecycle, which is what re-prepares the phrase.
        return

      case 'work-entered':
        this.roundIndex = e.roundIndex
        if (voiceAllowed(this.policy, this.playbackActive) && this.speakable('bell')) {
          this.output.playAsset('bell')
        }
        return

      case 'rest-entered':
        this.inCombo = false
        if (voiceAllowed(this.policy, this.playbackActive) && this.speakable('bell')) {
          this.output.playAsset('bell')
        }
        this.flushMetric()
        return

      default:
        return
    }
  }

  /**
   * The round clock, sampled by the session tick.
   *
   * Fires once per round on the first sample at or below the threshold.
   * "First crossing" rather than "equals" because the tick is 50 ms and the
   * threshold would otherwise be missed whenever a sample straddled it.
   */
  onRoundClock(remainingMs: number): void {
    if (remainingMs > FINAL_WARNING_AT_MS) return
    if (this.warnedRounds.has(this.roundIndex)) return
    this.warnedRounds.add(this.roundIndex)

    if (!voiceAllowed(this.policy, this.playbackActive)) return
    if (!this.speakable('final-countdown')) return
    this.output.playAsset('tone-warning')
  }

  /**
   * A stance change call.
   *
   * Additive to the binding interface: a stance change lives on the round
   * timeline rather than on any `CueEvent`, so without an entry point of its
   * own the `stance-change` category the policy already models would be
   * unreachable — a switch the athlete is shown but never told.
   */
  onStanceChange(toStance: Stance, atMs?: number): void {
    if (!voiceAllowed(this.policy, this.playbackActive)) return
    if (!this.speakable('stance-change')) return
    void toStance
    this.output.playAsset('switch', atMs)
  }

  /**
   * Descriptive text at metric priority.
   *
   * Held rather than dropped while a combination runs (doc §18): the athlete
   * is mid-sequence, and a number spoken over the next punch is worse than
   * the same number spoken a moment later. A newer metric replaces a held
   * one — the stale figure was never worth saying.
   */
  announceMetric(text: string): void {
    if (!voiceAllowed(this.policy, this.playbackActive)) return
    if (this.inCombo) {
      if (shouldSpeak(this.policy, 'metric', false)) this.heldMetric = text
      return
    }
    if (!this.speakable('metric')) return
    this.output.speak(text, AUDIO_PRIORITY.metric)
  }

  // ------------------------------------------------------------- internals

  private speakable(category: Parameters<typeof shouldSpeak>[1]): boolean {
    return shouldSpeak(this.policy, category, this.inCombo)
  }

  /** Keep the combination boundary current even while the gate is shut. */
  private trackCombo(e: CueEvent): void {
    if (e.type === 'cue-active') this.inCombo = true
    else if (
      e.type === 'cue-window-closed' ||
      e.type === 'cue-completed' ||
      e.type === 'cue-expired' ||
      e.type === 'cue-cancelled'
    ) {
      this.inCombo = false
      this.prepared.delete(e.cue.id)
    }
  }

  private flushMetric(): void {
    const text = this.heldMetric
    if (text === null) return
    this.heldMetric = null
    if (!voiceAllowed(this.policy, this.playbackActive)) return
    if (!shouldSpeak(this.policy, 'metric', false)) return
    this.output.speak(text, AUDIO_PRIORITY.metric)
  }

  /**
   * @param clockOffsetMs monotonic minus work-elapsed, from the event that
   * triggered this call. Adding it converts a cue time into the clock the
   * output port schedules against.
   */
  private announce(cue: CueInstance, clockOffsetMs: number): void {
    // The ready tone is a property of the cue reaching its start, not of the
    // phrase, so it is emitted whatever the style does with the words.
    const readyAt = cue.scheduledStartMs - this.leadTimes.readyToneMs + clockOffsetMs

    if (this.policy.style === 'coach-shorthand' && cue.repeatIndex > 0) {
      // Doc §18.1: the combination is spoken once; repetitions are beeps.
      this.output.tone('repeat')
      this.emitReadyTone(readyAt)
      return
    }

    // `follow-the-call` says each token as it becomes due, so there is no
    // phrase here — only the tone.
    if (this.policy.style === 'follow-the-call' || this.policy.style === 'minimal') {
      this.emitReadyTone(readyAt)
      return
    }

    if (!this.speakable('punch-command')) {
      this.emitReadyTone(readyAt)
      return
    }

    // A whole recorded utterance first. Only when the library has no
    // rendering for this combination does the per-word path run — and that
    // path is now a fallback rather than the design.
    if (this.announceAsPhrase(cue, clockOffsetMs)) {
      this.emitReadyTone(readyAt)
      return
    }

    const assets = this.prepared.get(cue.id) ?? comboPhraseAssets(cue.tokens)
    if (assets.length > 0) {
      const plan = this.planPhrase(cue, assets)
      const startAt = plan.startAt + clockOffsetMs
      if (this.output.playPhrase) {
        this.output.playPhrase(assets, startAt, plan.tightness)
      } else {
        // Fallback for a port with no phrase support: a shared deadline is
        // still the signal that these clips are one call.
        for (const asset of assets) this.output.playAsset(asset, startAt)
      }
    }
    this.emitReadyTone(readyAt)
  }

  /**
   * Call the combination as one recorded utterance.
   *
   * Returns false when the library has no rendering for it, which is the
   * signal to fall back to the per-word path.
   *
   * A phrase is placed to **finish** by the ready tone, exactly as the
   * per-word path is — the call ends and then you throw. Unlike the per-word
   * path there is nothing to compress: the performance is fixed in the file,
   * so a phrase that cannot fit starts at the preview and runs slightly long
   * rather than being trimmed into something that no longer sounds like a
   * coach.
   */
  private announceAsPhrase(cue: CueInstance, clockOffsetMs: number): boolean {
    const play = this.output.playCombination
    if (!play) return false

    const combination = formatCombo(cue.tokens)
    const voice: CombinationVoice = {
      vocabulary: this.vocabulary,
      performance: this.performanceFor(cue),
    }
    const lengthMs = this.output.combinationDurationMs?.(combination, this.cadence, voice)
    if (lengthMs === undefined) return false

    const finishBy = cue.scheduledStartMs - this.leadTimes.readyToneMs
    let startAt = finishBy - lengthMs
    if (startAt < cue.previewAt) {
      this.onSkip?.({
        cueId: cue.id,
        reason: 'overruns',
        phraseMs: lengthMs,
        availableMs: finishBy - cue.previewAt,
        tightness: 1,
      })
      startAt = cue.previewAt
    }

    return play.call(this.output, combination, this.cadence, startAt + clockOffsetMs, voice)
  }

  private emitReadyTone(atMs: number): void {
    // The tone is part of calling the combination, so it follows the same
    // permission as the call itself.
    if (!this.speakable('punch-command')) return
    this.output.playAsset('tone-ready', atMs)
  }

  /**
   * The measured length of a phrase at a given tightness, or `null` if any
   * clip's length is unknown.
   *
   * Durations come from the output port when it can measure them, falling
   * back to an injected table. Never guessed: a made-up length would misplace
   * every call.
   *
   * The last clip is never trimmed — tightness closes the gap *between*
   * words, and the final word gets to finish.
   */
  private phraseMs(assets: readonly VoiceAssetId[], tightness: number): number | null {
    let total = 0
    for (let i = 0; i < assets.length; i += 1) {
      const asset = assets[i]
      if (!asset) continue
      const measured = this.output.assetDurationMs?.(asset) ?? this.durations?.[asset]
      if (measured === undefined) return null
      total += i === assets.length - 1 ? measured : measured * tightness
    }
    return Math.round(total)
  }

  /**
   * When to begin the phrase, and how tightly to deliver it.
   *
   * The call must **finish** before the combination starts — that is what
   * being in sync means for a coach: the call ends and then you throw. A
   * fixed lead that hopes the words fit is what leaves a three-punch call
   * still talking while the first punch is due.
   *
   * A combination is delivered tight; a single command is not. If the tight
   * delivery still will not fit, it is squeezed further rather than dropped,
   * and only past the floor does it start at the preview and run long. Every
   * adjustment is reported; none of them is silence.
   */
  private planPhrase(
    cue: CueInstance,
    assets: readonly VoiceAssetId[],
  ): { startAt: number; tightness: number } {
    const isCombo = assets.length > 1
    const base = isCombo ? COMBO_TIGHTNESS : SINGLE_TIGHTNESS

    const lengthMs = this.phraseMs(assets, base)
    // Nothing measured the clips, so there is nothing to place the phrase
    // against. The doc §18.3 lead is the honest fallback.
    if (lengthMs === null) return { startAt: cue.announceAt, tightness: base }

    const finishBy = cue.scheduledStartMs - this.leadTimes.readyToneMs
    if (finishBy - lengthMs >= cue.previewAt) {
      return { startAt: finishBy - lengthMs, tightness: base }
    }

    // Too long at the normal cadence. Squeeze rather than drop.
    const availableMs = finishBy - cue.previewAt
    if (isCombo) {
      for (let tightness = base - 0.05; tightness >= MIN_TIGHTNESS; tightness -= 0.05) {
        const squeezed = this.phraseMs(assets, tightness)
        if (squeezed !== null && squeezed <= availableMs) {
          this.onSkip?.({
            cueId: cue.id,
            reason: 'compressed',
            phraseMs: squeezed,
            availableMs,
            tightness,
          })
          return { startAt: finishBy - squeezed, tightness }
        }
      }
    }

    // Even at the floor it overruns. Still called: a combination nobody named
    // is worse than one named slightly late.
    const tightest = isCombo ? MIN_TIGHTNESS : base
    this.onSkip?.({
      cueId: cue.id,
      reason: 'overruns',
      phraseMs: this.phraseMs(assets, tightest) ?? lengthMs,
      availableMs,
      tightness: tightest,
    })
    return { startAt: cue.previewAt, tightness: tightest }
  }

  private onTokenDue(cue: CueInstance, tokenIndex: number): void {
    if (this.policy.style !== 'follow-the-call') return
    const token = cue.tokens[tokenIndex]
    if (!token) return

    // Defense and footwork are announced under their own category, so a
    // policy that speaks punches but not footwork is honoured per token.
    const category =
      token.kind === 'defense' ? 'defense' : token.kind === 'footwork' ? 'footwork' : 'punch-command'
    if (token.kind === 'coach') return
    if (!shouldSpeak(this.policy, category, false)) return

    // A per-token call is a single command, so it keeps the full standalone
    // delivery rather than the clipped one a combination uses.
    for (const asset of comboPhraseAssets([token])) this.output.playAsset(asset)
  }
}

/** Re-exported so a queue implementation has one place to read it. */
export { assetPriority }
