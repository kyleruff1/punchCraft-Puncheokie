/**
 * SlotDispatcher — the score-authoritative coach dispatcher
 * (M39-V2 W1 Epic Slice 3-a-i, Kyle amended plan 2026-08-30,
 * principles #7 + #10).
 *
 * ## What it replaces
 *
 * `VoiceOutputExpo.playPhrase` + `.playSequence` today own a
 * SINGLE cue's dispatch queue and call `clearSequence()` on every
 * new cue — the root cause of the 2026-08-30 regression where a
 * fresh `1-2b-3` cue truncated the previous cue's pending
 * `body` clip and the athlete heard `"one one two one one one"`.
 * SlotDispatcher owns ONE global ordered queue that cues APPEND
 * to; nothing truncates in-flight or pending slots.
 *
 * ## The rule
 *
 * Given a stream of `CompiledCoachSlot`s (compiled by
 * `workoutScore`), dispatch each slot's `assetId` at
 * `reservationStartTick - calibratedLatencyTicks` — the audio
 * backend receives the play call `latencyTicks` before the
 * intended audible onset so the physical sound reaches the ear
 * on the reservation moment.
 *
 * Vocabulary is picked at dispatch time via
 * `getCurrentVocabulary()`. When the picked vocab's variant is
 * absent (e.g. numeric-only slot when user is in technique
 * mode), the dispatcher falls back to the other variant. When
 * neither variant is present, or when the picked variant's
 * `assetId` doesn't resolve to a playable asset, the
 * dispatcher THROWS — no silent mode fallback (principle #11).
 *
 * ## What it does NOT own
 *
 * - Reservation-window collision detection. That's the
 *   score compiler's job (principle #4 conservative reservation
 *   guarantees no collision). The dispatcher trusts its input.
 * - Timing (advancing a wall clock). The dispatcher is
 *   TICK-DRIVEN — the caller supplies `nowTick` on every
 *   `advance()`. This keeps the dispatcher pure + easy to unit
 *   test with a fake tick source.
 * - Metronome playback (owned by MetronomePlayer, isolated per
 *   principle #20).
 *
 * ## Idempotency
 *
 * A slot dispatched once never fires again — tracked via
 * `dispatched: Set<slotId>`. `clear()` is for `stop()` /
 * workout-end only; nothing "per-cue" clears the queue.
 *
 * ## Latency compensation
 *
 * `dispatchAtTick(slot) = slot.reservationStartTick -
 * calibratedLatencyTicks`. The `latencyTicks` is a static
 * calibration input; a dynamic per-device value can be plumbed
 * via config in a future slice. If the caller's clock advances
 * past a slot's dispatchAtTick before `advance()` runs, the
 * dispatcher fires it late (silence would be worse) — matching
 * the existing coach-lane late-vs-drop policy.
 *
 * Pure TypeScript — no React, no Expo, no clock. Same purity
 * rules as `src/domain/*` modules; only lives in `src/audio/`
 * because it consumes audio-side types (`CompiledCoachSlot`).
 */

import type { CompiledCoachSlot } from '@/domain/programs/workoutScore'

export type CoachVocabulary = 'numeric' | 'technique'

export interface SlotDispatcherConfig {
  /**
   * Called to fire a slot's asset. `atTick` is the slot's
   * `reservationStartTick` — the intended audible onset — so
   * the underlying player can log it for post-hoc analysis.
   * Any throw propagates out of `advance()`.
   *
   * Return `false` to DECLINE the play — "not now, try again". The
   * dispatcher re-queues the slot and re-offers it on later ticks until
   * `desiredAudibleEndTick`, after which the call is too late to teach
   * the strike it names and is dropped via `onSkipped`.
   *
   * Returning anything else (including `undefined`) counts as played.
   */
  play: (assetId: string, atTick: number, slotId: string) => void | boolean
  /**
   * Called at each dispatch to decide which variant to play.
   * The dispatcher freezes the choice as it fires — a vocab
   * switch mid-slot cannot retroactively affect a slot the
   * dispatcher already picked (principle #8 lock deadline is
   * enforced upstream by the runner; the dispatcher's role is
   * to consult the current vocab, not to time-lock).
   */
  getCurrentVocabulary: () => CoachVocabulary
  /**
   * Audio-backend output latency in transport ticks (960 PPQN
   * at 60 BPM = 16 ticks/ms). Subtracted from every slot's
   * `reservationStartTick` to compute the dispatch moment.
   * Default 0 — a caller that hasn't measured device latency
   * should still get correct dispatch, just not
   * latency-compensated.
   */
  latencyTicks?: number
  /**
   * Called when a slot is discarded without playing. Today the only
   * reason is `round-elapsed` — its round ended before it dispatched.
   * Optional; exists so the runner can log what the athlete did not hear
   * rather than letting it vanish.
   */
  onSkipped?: (slot: CompiledCoachSlot, reason: 'round-elapsed' | 'retry-expired') => void
}

export class SlotDispatcher {
  private readonly play: SlotDispatcherConfig['play']
  private readonly getCurrentVocabulary: SlotDispatcherConfig['getCurrentVocabulary']
  private readonly latencyTicks: number
  private readonly queue: CompiledCoachSlot[] = []
  private readonly dispatched = new Set<string>()
  private readonly onSkipped: SlotDispatcherConfig['onSkipped']
  private sorted = true
  private staleSkipped = 0

  constructor(config: SlotDispatcherConfig) {
    this.play = config.play
    this.getCurrentVocabulary = config.getCurrentVocabulary
    this.latencyTicks = config.latencyTicks ?? 0
    this.onSkipped = config.onSkipped
  }

  /**
   * Add a slot to the queue. Duplicate `slotId`s are ignored
   * (already-dispatched or already-queued). The queue re-sorts
   * lazily on next `advance()` — safe to enqueue in any order.
   */
  enqueue(slot: CompiledCoachSlot): void {
    if (this.dispatched.has(slot.slotId)) return
    if (this.queue.some((s) => s.slotId === slot.slotId)) return
    this.queue.push(slot)
    this.sorted = false
  }

  /**
   * Bulk enqueue. Convenience for the runner arming a score's
   * `coachSlots` at workout start.
   */
  enqueueAll(slots: readonly CompiledCoachSlot[]): void {
    for (const slot of slots) this.enqueue(slot)
  }

  /**
   * Fire any slots whose dispatch moment has arrived.
   * Called on every runtime tick from the runner. Slots whose
   * `dispatchAtTick <= nowTick` are dispatched in queue order
   * (earlier dispatchAt first). Throws whatever `play()` throws;
   * a throw from `play()` does NOT re-queue the slot — it is
   * marked dispatched and the runner surfaces the error.
   *
   * ## The round band (GH #305, "precall bleed")
   *
   * `currentRoundIndex` clamps dispatch to the round the athlete is
   * actually in. It is optional: omit it and this behaves exactly as
   * before, which keeps the dispatcher usable without a session clock.
   *
   * It is needed because the score's tick axis contains only WORK time —
   * rest is not represented, so consecutive round starts sit exactly
   * `workDurationMs` apart. A round's opening announce is authored to
   * LEAD its bell (speed-combos round 1: −2355 ms), and with no rest gap
   * to live in, that lead-in lands inside the PREVIOUS round's work
   * band: absolute tick 228139 of a round-0 band ending at 230400.
   * Measured on-glass — round 1's `One, Two, go!` fired 2.7 s before the
   * round-0 bell, while the athlete was still working round 0.
   *
   * A slot whose round has not started is HELD, not skipped: it fires at
   * the first tick of its own round, which is the earliest legal moment
   * and preserves the authored intent of leading the round.
   *
   * Holding must not block the queue. A future-round slot can sort ahead
   * of a still-due current-round slot whenever the previous round has a
   * call inside its final ~2.4 s, so returning early on one would starve
   * the other. Held slots are set aside and re-queued instead.
   *
   * A slot whose round has already ENDED is dropped, not played late:
   * the previous round's combination called over the current round is
   * worse than silence, and the report shows it honestly as `missing`.
   */
  advance(nowTick: number, currentRoundIndex: number | null = null): void {
    if (!this.sorted) {
      this.queue.sort((a, b) => a.reservationStartTick - b.reservationStartTick)
      this.sorted = true
    }
    const held: CompiledCoachSlot[] = []
    try {
      while (this.queue.length > 0) {
        const head = this.queue[0]!
        const dispatchAt = head.reservationStartTick - this.latencyTicks
        // Sorted by tick, so nothing behind this is due either.
        if (nowTick < dispatchAt) break
        this.queue.shift()
        if (currentRoundIndex !== null && head.roundIndex > currentRoundIndex) {
          held.push(head)
          continue
        }
        if (this.dispatched.has(head.slotId)) continue
        this.dispatched.add(head.slotId)
        if (currentRoundIndex !== null && head.roundIndex < currentRoundIndex) {
          this.staleSkipped += 1
          this.onSkipped?.(head, 'round-elapsed')
          continue
        }
        const variant = this.pickVariant(head)
        // Marked dispatched BEFORE the call so a throw cannot re-queue it
        // (existing contract). An explicit `false` is different from a
        // throw: it means "declined, ask me again", so we undo that.
        const played = this.play(variant.assetId, head.reservationStartTick, head.slotId)
        if (played === false) {
          this.dispatched.delete(head.slotId)
          if (nowTick < head.desiredAudibleEndTick) {
            held.push(head)
          } else {
            // Past the strike it teaches — naming the combination now
            // would describe punches the athlete has already thrown.
            this.staleSkipped += 1
            this.onSkipped?.(head, 'retry-expired')
          }
        }
      }
    } finally {
      // In a `finally` so a throw from `play()` cannot strand held slots
      // outside the queue, which would silence them for the whole workout.
      if (held.length > 0) {
        this.queue.unshift(...held)
        this.sorted = false
      }
    }
  }

  /**
   * Drop the entire queue AND the dispatched set. Called on
   * `stop()` — the workout ended; nothing pending should fire
   * against the next workout's score. Never called per-cue.
   */
  clear(): void {
    this.queue.length = 0
    this.dispatched.clear()
    this.sorted = true
  }

  /** Test seam — how many slots are still waiting to fire. */
  getPendingCount(): number {
    return this.queue.length
  }

  /** Test seam — has this slotId already fired? */
  hasDispatched(slotId: string): boolean {
    return this.dispatched.has(slotId)
  }

  /** Test seam — slots dropped because their round had already ended. */
  getStaleSkippedCount(): number {
    return this.staleSkipped
  }

  /**
   * Pick the variant to play. Preference: current vocabulary
   * first, then the other, then throw if neither exists.
   * Missing-asset RAISES (principle #11 — no silent fallback);
   * a slot with no variants at all is a compile-time bug the
   * score compiler should never produce, but we defend anyway.
   */
  private pickVariant(slot: CompiledCoachSlot): { assetId: string } {
    const preferred = this.getCurrentVocabulary()
    const fallback: CoachVocabulary = preferred === 'numeric' ? 'technique' : 'numeric'
    const primary = slot.variants[preferred]
    if (primary) return { assetId: primary.assetId }
    const secondary = slot.variants[fallback]
    if (secondary) return { assetId: secondary.assetId }
    throw new Error(
      `SlotDispatcher: slot ${slot.slotId} has no variant to dispatch (neither numeric nor technique)`,
    )
  }
}
