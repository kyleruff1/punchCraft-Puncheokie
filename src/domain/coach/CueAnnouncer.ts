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
import type { CueInstance, RoundTimeline } from '../programs/CueTimeline'
import type {
  CallPayload,
  RhythmEvent,
  RoundRhythmMap,
  SetCalloutPayload,
} from '../programs/RhythmMap'
import type { Stance } from '../workout/WorkoutTokens'

/**
 * Lead times and burst-re-call constants live with the Rhythm Map (M2) —
 * the compiled schedule and this executor must read the same numbers.
 * Re-exported here so existing importers keep working.
 */
export { DEFAULT_ANNOUNCE_LEAD_TIMES } from '../programs/RhythmMap'
import {
  BURST_REFIRE_INTERVAL_MS,
  BURST_TAIL_QUIET_MS,
  DEFAULT_ANNOUNCE_LEAD_TIMES,
  MIN_BURST_MS_FOR_REFIRE,
} from '../programs/RhythmMap'

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
/**
 * Whether the coach calls a combination ahead of the throw or in time with it.
 * Selected by cadence (technical → `in-time`; steady/pressure/sprint →
 * `call-ahead`).
 */
export type CueDelivery = 'call-ahead' | 'in-time'

/**
 * Pick the delivery from the cadence profile (doc §18.1).
 *
 * Only the slow `technical` cadence has room to call each punch as it lands;
 * everything faster calls the whole combination ahead of the throw, because
 * there is no gap to fit a per-token call into.
 */
export function deliveryForCadence(cadenceProfile: string): CueDelivery {
  return cadenceProfile === 'technical' ? 'in-time' : 'call-ahead'
}

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
  /**
   * Whether the combination is called **ahead** of execution or **in time**
   * with it (doc §18.1). `call-ahead` speaks the whole combination during the
   * preview, finishing by the ready tone, and the athlete then throws it —
   * right for faster cadences where there is no room to call each punch as it
   * lands. `in-time` says nothing up front and lets each token be called the
   * moment its node lights (via `onTokenDue`), which suits a slow technical
   * cadence. Chosen by cadence upstream and injected; defaults to
   * `call-ahead`. Does not change the repeat collapse — later reps are still
   * marked with a tone, not re-called.
   */
  delivery?: CueDelivery
  onSkip?: (skip: AnnouncerSkip) => void
  /**
   * Cadence-lab per-clip placement shift in milliseconds — mirrors the
   * compiled map's `phraseShiftFor` so live-driven and executor-driven
   * placement stay in agreement. Absent = shipped behaviour unchanged.
   */
  phraseShiftFor?: (combination: string, cadence: string) => number | undefined
}

export class CueAnnouncer {
  private policy: VoiceCoachPolicy
  private readonly output: VoiceOutputPort
  private readonly leadTimes: AnnouncerLeadTimes
  private readonly durations: Readonly<Partial<Record<VoiceAssetId, number>>> | undefined
  private readonly onSkip: ((skip: AnnouncerSkip) => void) | undefined
  private readonly cadence: string
  private vocabulary: CalloutVocabulary
  private readonly performanceFor: (cue: CueInstance) => PerformanceState
  private readonly delivery: CueDelivery
  private readonly phraseShiftFor:
    | ((combination: string, cadence: string) => number | undefined)
    | undefined

  private playbackActive = false
  /** Phrase plans resolved at preview, so nothing is computed at announce. */
  private readonly prepared = new Map<string, VoiceAssetId[]>()
  /** True between a cue becoming active and its window closing (doc §18). */
  private inCombo = false
  /** A metric waiting for the combination to end. Newest wins. */
  private heldMetric: string | null = null
  private roundIndex = -1
  private readonly warnedRounds = new Set<number>()
  /**
   * Bursts whose re-calls are already scheduled. The refires are placed all
   * at once at `cue-active`, and with the output port now keeping every
   * scheduled call (the additive-handles fix), a duplicated `cue-active`
   * would stack a second full train of calls on top of the first. Heard on
   * the bag as the coach yelling a combination the screen stopped showing.
   */
  private readonly burstsScheduled = new Set<string>()

  // ---- map execution (M2). When a compiled RoundRhythmMap is installed,
  // the announcer stops deriving call times from events and becomes the
  // map's executor: the conductor tick advances a cursor and every due
  // event is dispatched against runtime permission. Event handling keeps
  // owning LIFECYCLE (inCombo, prepared phrases, ended cues); it no longer
  // owns TIME.
  private roundMap: RoundRhythmMap | null = null
  private mapCues = new Map<string, CueInstance>()
  private mapCursor = 0
  private readonly endedCues = new Set<string>()

  constructor(opts: CueAnnouncerOptions) {
    this.policy = opts.policy
    this.output = opts.output
    this.leadTimes = opts.leadTimes ?? { ...DEFAULT_ANNOUNCE_LEAD_TIMES }
    this.durations = opts.assetDurationsMs
    this.onSkip = opts.onSkip
    this.cadence = opts.cadence ?? 'steady'
    this.phraseShiftFor = opts.phraseShiftFor
    this.vocabulary = opts.vocabulary ?? 'numbers'
    this.performanceFor = opts.performanceFor ?? (() => 'work')
    this.delivery = opts.delivery ?? 'call-ahead'
  }

  setPolicy(p: VoiceCoachPolicy): void {
    this.policy = p
  }

  /** D1 input from M34-05's playback detector. */
  /**
   * Switch the callout vocabulary MID-WORKOUT (Kyle's live radio toggle).
   * Takes effect at the next dispatch — clips resolve at play time, so no
   * engine rebuild and no rhythm-map change. Placement margins were
   * compiled with the starting vocabulary's phrase lengths; a longer
   * techniques phrase may finish slightly into the window, which the
   * overrun reporting already tolerates.
   */
  setVocabulary(vocabulary: CalloutVocabulary): void {
    this.vocabulary = vocabulary
  }

  setThirdPartyPlayback(active: boolean): void {
    this.playbackActive = active
  }

  /** Cue ids with a phrase plan in hand — doc §18's "prepare several ahead". */
  preparedCueIds(): string[] {
    return [...this.prepared.keys()]
  }

  /**
   * Install a round's compiled rhythm map (or clear it with nulls).
   *
   * From here until the next install, the map owns every call time; the
   * event stream only updates lifecycle. Passing nulls returns the
   * announcer to its event-driven behaviour — the compatibility mode the
   * parity harness exercises.
   */
  setRound(round: RoundTimeline | null, map: RoundRhythmMap | null): void {
    this.roundMap = map
    this.mapCursor = 0
    this.endedCues.clear()
    this.mapCues = new Map((round?.cues ?? []).map((cue) => [cue.id, cue]))
  }

  /**
   * The conductor's beat: dispatch every map event whose time has come.
   *
   * Called from the runner's tick with the same work-elapsed sample that
   * advances the cue engine — audio and screen read one clock, so they
   * cannot drift (the wall-timer failure the monitor measured at ~2.3x).
   */
  onTick(workElapsedMs: number, nowMs: number): void {
    const map = this.roundMap
    if (!map) return
    const clockOffsetMs = nowMs - workElapsedMs
    while (this.mapCursor < map.events.length) {
      const event = map.events[this.mapCursor] as RhythmEvent
      if (event.atMs > workElapsedMs) break
      this.mapCursor += 1
      this.dispatchMapEvent(event, clockOffsetMs)
    }
  }

  private dispatchMapEvent(event: RhythmEvent, clockOffsetMs: number): void {
    if (event.cancelsWith === 'cue-end' && this.endedCues.has(event.cueId)) return
    if (!voiceAllowed(this.policy, this.playbackActive)) return

    switch (event.kind) {
      case 'tone': {
        // Compiled maps no longer carry tones; a stale map's tone event is
        // ignored — no beeps (Kyle's sound design).
        return
      }
      case 'set-callout': {
        // A pre-set ceremony part (Set Ceremonies). Gated like the call it
        // precedes — NOT as a coaching reminder, which Standard mode mutes
        // and would silence the keystone feature for default users.
        if (!this.speakable('punch-command')) return
        const payload = event.payload as SetCalloutPayload | null
        if (!payload) return
        if ('recite' in payload) {
          // A false return means the phrase library has no rendering — the
          // recitation is an enhancement; the set's own call still fires.
          this.output.playCombination?.(payload.recite, payload.cadence, undefined, {
            vocabulary: this.vocabulary === 'techniques' ? 'techniques' : 'numbers',
            performance: 'teach',
          })
          return
        }
        this.output.playAsset(payload.asset as VoiceAssetId)
        return
      }
      case 'call':
      case 'refire': {
        const payload = event.payload as CallPayload | null
        if (!payload) return
        // Styles that never speak the combination up front keep their tone-
        // only behaviour; in-time delivery speaks per token via onTokenDue.
        if (this.policy.style === 'follow-the-call' || this.policy.style === 'minimal') return
        if (this.delivery === 'in-time' && event.kind === 'call') return
        // NOTE: `refire` intentionally NOT excluded — under `in-time`
        // (technical cadence) the burst window has expectedPunches=[]
        // and never fires per-token events, so the refire IS the only
        // voice inside the burst. A9's original attempt to exclude
        // refire here silenced the entire burst on technical cadence
        // (uppercut-clinic, measured 2026-08-30). The refire/per-token
        // double-voice concern only appears when both actually fire —
        // sequence cues under technical, addressed separately.
        if (!this.speakable('punch-command')) return

        const cue = this.mapCues.get(event.cueId)
        if (payload.mode === 'phrase' && this.output.playCombination) {
          const voice: CombinationVoice = {
            vocabulary: this.vocabulary,
            performance: cue ? this.performanceFor(cue) : 'work',
          }
          const played = this.output.playCombination(
            payload.combination,
            payload.cadence,
            undefined,
            voice,
          )
          if (played) return
          // The library lost the rendering at runtime — fall through to the
          // per-word path rather than leaving the combination uncalled.
        }
        if (cue) this.dispatchPerWordCall(cue, clockOffsetMs)
        return
      }
      case 'encouragement': {
        const payload = event.payload as { asset?: VoiceAssetId } | null
        if (!payload?.asset) return
        // A0 (fixed): these are the rotation fillers and power-strike
        // chime-ins RhythmMap placed in audited silence between cues —
        // the ONLY lines that keep count-scored windows audible. They
        // ship under the `gap-filler` category, which `mode:'standard'`
        // permits (unlike `coaching-reminder`, which was silently
        // eating every one of them in the shipped configuration —
        // 6 fillers + 2 power calls per round). The policy still holds
        // them under `inCombo`, so the "never interrupt a combination"
        // rule survives; Minimal mode still opts them out. `false` here
        // matches the compiler's placement — they only ever schedule
        // between cues.
        if (!shouldSpeak(this.policy, 'gap-filler', false)) return
        // A15/#256: even though the audited-silence pass placed this
        // in a quiet window, a previous clip may have run long and
        // still be audible. Skipping a filler that would collide is
        // better than doubling coach voices — the next filler in
        // rotation still fires.
        if (
          typeof this.output.audibleUntilMs === 'function' &&
          this.output.audibleUntilMs() > 0
        )
          return
        this.output.playAsset(payload.asset)
        return
      }
      default:
        // phase-announce / movement gain voices later; a declared-but-
        // unvoiced event is schedule, not sound.
        return
    }
  }

  /** The per-word delivery, placed by `planPhrase` from measured clip lengths. */
  private dispatchPerWordCall(cue: CueInstance, clockOffsetMs: number): void {
    const assets = this.prepared.get(cue.id) ?? comboPhraseAssets(cue.tokens)
    if (assets.length === 0) return
    const plan = this.planPhrase(cue, assets)
    const startAt = plan.startAt + clockOffsetMs
    if (this.output.playPhrase) {
      this.output.playPhrase(assets, startAt, plan.tightness)
    } else {
      for (const asset of assets) this.output.playAsset(asset, startAt)
    }
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

    // A7/A15: retry a metric that was deferred because the coach was
    // audibly busy the last time we tried. The event bus ticks
    // frequently in a live session (every token-due, at minimum), so
    // this releases within ~100 ms of the coach going quiet without
    // needing an announcer heartbeat of its own.
    if (this.heldMetric !== null && !this.inCombo) this.flushMetric()

    switch (e.type) {
      case 'cue-announcing':
        // Map execution (M2): the compiled map owns the call time; the
        // event only marks lifecycle. Event-driven timing remains for
        // callers with no map installed.
        if (this.roundMap === null) this.announce(e.cue, e.nowMs - e.workElapsedMs)
        break

      case 'cue-active':
        this.inCombo = true
        // A count-scored cue (volume-burst, open-pressure, coast) is
        // announced once at cue-announcing and then the athlete throws for
        // its whole window — 30-80 seconds, in the workouts the generator
        // has been producing. That was landing as long silent stretches
        // where the athlete lost the rhythm they were told to hold. The
        // periodic re-calls live in the compiled map when one is
        // installed; the event-driven pre-scheduling below is the no-map
        // fallback.
        if (this.roundMap === null) this.scheduleBurstRefires(e.cue, e.nowMs - e.workElapsedMs)
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
        // Map events for this cue that have not dispatched yet die with it.
        this.endedCues.add(e.cue.id)
        // A burst that ends well before its window — target reached early,
        // or skipped — leaves its remaining re-calls scheduled, and they
        // would fire over whatever comes next. Drop them. Only on a
        // clearly-early end: at the natural window close the next cue's own
        // call may already be scheduled, and that one must survive.
        if (
          (e.type === 'cue-completed' || e.type === 'cue-cancelled') &&
          e.cue.scoring === 'count' &&
          e.workElapsedMs < e.cue.windowEndMs - 2_000
        ) {
          this.output.cancelScheduledCombinations?.()
        }
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
        // Cue ids are unique within a round, so the burst guard resets at
        // the round boundary — never mid-round, where a re-emitted
        // activation (however it arises) must stay a no-op.
        this.burstsScheduled.clear()
        if (voiceAllowed(this.policy, this.playbackActive) && this.speakable('bell')) {
          this.output.playAsset('bell')
        }
        return

      case 'rest-entered':
        this.inCombo = false
        // Rounds end on the same ding-ding that starts them — the gong is
        // retired (Kyle: "the ding ding sounds perfect, we want it for
        // the end of the round").
        if (voiceAllowed(this.policy, this.playbackActive) && this.speakable('bell')) {
          this.output.playAsset('bell')
        }
        this.flushMetric()
        return

      case 'finishing':
        // The last round ends on the ding-ding like every other.
        if (voiceAllowed(this.policy, this.playbackActive) && this.speakable('bell')) {
          this.output.playAsset('bell')
        }
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
    // The final-stretch beep is gone with every other beep. The marker
    // survives (warnedRounds bookkeeping) for a future voiced "last ten
    // seconds!" call; until that clip exists, the moment passes silently.
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
    if (!voiceAllowed(this.policy, this.playbackActive)) {
      this.heldMetric = null
      return
    }
    if (!shouldSpeak(this.policy, 'metric', false)) {
      this.heldMetric = null
      return
    }
    // A7 (fixed via A15/#256): cue-window-closed fires at the same
    // instant the NEXT cue's rail-placed call has already started
    // (rail-word-0-end lands RAIL_K_MS before ring 0). Releasing the
    // held metric here would land on top of that fresh combination
    // call. If the coach is audibly busy, hold the metric and let the
    // next `advance()`/`onCueEvent` tick re-try — the metric stays
    // held rather than being dropped or overlapped.
    if (typeof this.output.audibleUntilMs === 'function') {
      if (this.output.audibleUntilMs() > 0) return
    }
    this.heldMetric = null
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

    // A repeated combination is called every time it comes round. It used to be
    // spoken once and beeped thereafter under `coach-shorthand` (doc §18.1),
    // which is exactly the behaviour D22 retired: a tone tells the athlete that
    // something is expected without telling them what, and with generated
    // workouts repeating a block two to four times it meant most calls were
    // beeps. Every punch asked for is now named.

    // `follow-the-call` says each token as it becomes due, so there is no
    // phrase here — only the tone.
    if (this.policy.style === 'follow-the-call' || this.policy.style === 'minimal') {
      this.emitReadyTone(readyAt)
      return
    }

    // In-time delivery (a slow technical cadence): nothing is said up front.
    // Each token is called the moment its node lights, through `onTokenDue`,
    // so the call lands on the punch instead of ahead of it. Later reps were
    // already tone-marked above, and `onTokenDue` only calls tokens on the
    // first rep, so this does not re-call a repeated combo.
    if (this.delivery === 'in-time') {
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
    const phraseShift = this.phraseShiftFor?.(combination, this.cadence) ?? 0
    let startAt = finishBy - lengthMs - phraseShift
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

  private emitReadyTone(_atMs: number): void {
    // Deliberately silent (Kyle's sound design: no beeps, ever). A tone
    // before every call put hundreds of chirps under the vocals in one
    // workout. The call sites remain because the ready moment still shapes
    // control flow — the coach's voice is the cue now, and the only
    // non-voice sounds left are the round ding and the round-end gong.
  }

  // Burst re-call constants are shared with the compiled Rhythm Map —
  // see RhythmMap.ts for the rationale and tuning notes.

  /**
   * Re-fire the motif every few seconds during a count-scored burst.
   *
   * The initial call at `cue-announcing` names the pair once. This adds the
   * periodic anchoring the athlete needs across the burst window so the
   * coach does not go silent for a minute while they are still throwing.
   * Every call is scheduled up front — the announcer owns no timers.
   *
   * Voice-permission is checked once at the start, since a burst is a single
   * combination in the D18 sense; the gate opening or closing mid-burst is
   * not a moment to change what the athlete is doing.
   */
  private scheduleBurstRefires(cue: CueInstance, clockOffsetMs: number): void {
    if (cue.scoring !== 'count') return
    // Once per cue, whatever the event stream does — see `burstsScheduled`.
    if (this.burstsScheduled.has(cue.id)) return
    this.burstsScheduled.add(cue.id)
    if (!this.speakable('punch-command')) return
    const play = this.output.playCombination
    if (!play) return

    const windowMs = cue.windowEndMs - cue.scheduledStartMs
    if (windowMs < MIN_BURST_MS_FOR_REFIRE) return

    const combination = formatCombo(cue.tokens)
    const voice: CombinationVoice = {
      vocabulary: this.vocabulary,
      performance: this.performanceFor(cue),
    }
    const clipMs = this.output.combinationDurationMs?.(combination, this.cadence, voice)
    if (clipMs === undefined) return

    const lastStart = cue.windowEndMs - clipMs - BURST_TAIL_QUIET_MS
    for (
      let at = cue.scheduledStartMs + BURST_REFIRE_INTERVAL_MS;
      at <= lastStart;
      at += BURST_REFIRE_INTERVAL_MS
    ) {
      play.call(this.output, combination, this.cadence, at + clockOffsetMs, voice)
    }
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
    // Two ways a token is spoken as it lands: the `follow-the-call` style, and
    // `in-time` delivery. Previously the second was gated to rep 0 because
    // later reps were "tone-marked" — but Kyle's no-beeps sound design
    // (2026-08-25) removed the tone, and rep 1..N of an 8-rep block then went
    // silent for the whole window. Speak every rep instead: the coach calling
    // a repeated combo eight times in a row is what a coach actually does.
    const inTime = this.delivery === 'in-time'
    if (this.policy.style !== 'follow-the-call' && !inTime) return
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
