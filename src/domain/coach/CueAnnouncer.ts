/**
 * Turning cue events into spoken calls (M34-03, doc §18, §20, §25).
 *
 * ## It owns no time
 *
 * The announcer has no timer, reads no clock, and schedules nothing of its
 * own. Every deadline it hands the output port is arithmetic on timestamps
 * that arrived with the event — `executionScheduledMs − readyToneMs`, and
 * nothing else. That is D3 made structural: if the announcer could set a
 * timer, speech latency would eventually be allowed to move the workout, and
 * the failure mode is a coach that narrates the punch you already threw.
 *
 * ## It never speaks first and checks later
 *
 * Every entry point begins at the D1 gate. Not "mostly" — a single path that
 * emits before checking is an app that talks over someone's music, which is
 * the one thing the design says must never happen.
 *
 * ## What it does when a phrase will not fit
 *
 * At sprint cadence a spoken phrase can be longer than the gap before the
 * combination starts (D15). Queuing it anyway is the worst option: the queue
 * drifts further behind with every cue until the coach is calling the wrong
 * punch. So a phrase that cannot finish in time is **skipped**, and the skip
 * is reported rather than silent.
 *
 * D15's other remedy — downgrading `names` to `numbers` — is not
 * implementable from here: both vocabularies share one set of asset ids and
 * the clip set is chosen by the manifest, so the announcer has nothing to
 * switch. That half belongs to M34-04, where vocabulary selection lives.
 *
 * Pure TypeScript (spec §15.1).
 */

import { assetPriority } from './assetPriority'
import { comboPhraseAssets } from './vocabulary'
import { AUDIO_PRIORITY, type VoiceAssetId, type VoiceOutputPort } from './VoiceOutputPort'
import { shouldSpeak, voiceAllowed, type VoiceCoachPolicy } from './VoiceCoachPolicy'
import type { CueEvent, SessionPhaseEvent } from '../programs/CueState'
import type { CueInstance } from '../programs/CueTimeline'
import type { Stance } from '../workout/WorkoutTokens'

/** Doc §18.3: voice at T−0.75 s, ready tone at T−0.10 s. M36-03 tunes these. */
export const DEFAULT_ANNOUNCE_LEAD_TIMES = { announceMs: 750, readyToneMs: 100 } as const

/** Doc §25's final warning, in milliseconds remaining. */
export const FINAL_WARNING_AT_MS = 10_000

export interface AnnouncerLeadTimes {
  announceMs: number
  readyToneMs: number
}

/** Why a phrase was not spoken. Reported so a skip is never silent. */
export interface AnnouncerSkip {
  cueId: string
  reason: 'phrase-too-long'
  phraseMs: number
  availableMs: number
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
  onSkip?: (skip: AnnouncerSkip) => void
}

export class CueAnnouncer {
  private policy: VoiceCoachPolicy
  private readonly output: VoiceOutputPort
  private readonly leadTimes: AnnouncerLeadTimes
  private readonly durations: Readonly<Partial<Record<VoiceAssetId, number>>> | undefined
  private readonly onSkip: ((skip: AnnouncerSkip) => void) | undefined

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
        this.announce(e.cue)
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

  private announce(cue: CueInstance): void {
    // The ready tone is a property of the cue reaching its start, not of the
    // phrase, so it is emitted whatever the style does with the words.
    const readyAt = cue.scheduledStartMs - this.leadTimes.readyToneMs

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

    const assets = this.prepared.get(cue.id) ?? comboPhraseAssets(cue.tokens)
    if (assets.length > 0 && this.fits(cue, assets)) {
      // One deadline for the whole phrase: it is a single utterance made of
      // clips, and the output plays them back to back from there.
      for (const asset of assets) this.output.playAsset(asset, cue.announceAt)
    }
    this.emitReadyTone(readyAt)
  }

  private emitReadyTone(atMs: number): void {
    // The tone is part of calling the combination, so it follows the same
    // permission as the call itself.
    if (!this.speakable('punch-command')) return
    this.output.playAsset('tone-ready', atMs)
  }

  /**
   * Whether the phrase can finish before the combination starts.
   *
   * Without measured durations there is nothing to compare, so the check
   * passes — guessing a duration would produce skips nobody could explain.
   */
  private fits(cue: CueInstance, assets: readonly VoiceAssetId[]): boolean {
    if (!this.durations) return true
    let phraseMs = 0
    for (const asset of assets) {
      const ms = this.durations[asset]
      if (ms === undefined) return true // unmeasured clip: do not guess
      phraseMs += ms
    }
    const availableMs = cue.scheduledStartMs - this.leadTimes.readyToneMs - cue.announceAt
    if (phraseMs <= availableMs) return true
    this.onSkip?.({ cueId: cue.id, reason: 'phrase-too-long', phraseMs, availableMs })
    return false
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

    const assets = comboPhraseAssets([token])
    // Played without a deadline: `token-due` fires at the moment the token
    // becomes active, so the deadline is now.
    for (const asset of assets) this.output.playAsset(asset)
  }
}

/** Re-exported so a queue implementation has one place to read it. */
export { assetPriority }
