/**
 * Rest presentation sub-phases (M33-04, doc §23, D6).
 *
 * The one-minute rest is shown as three things in sequence — the round's
 * frozen result, a recovery view, and a preview of the next round — but it
 * is **one session state**. D6 is explicit: these are presentation
 * sub-phases of the single spec §18.1 `rest` state. They appear in no state
 * machine, no persistence and no metric, and "skip rest" skips all three
 * together. `WorkoutSessionClock` is therefore untouched by this module
 * except for the `skipRest()` entry point that ends the whole interval.
 *
 * ## Why fractions rather than seconds
 *
 * Doc §23 names 0–12 s / 12–45 s / 45–60 s, which are 20 % and 75 % of a
 * 60-second rest. The thresholds are stored as fractions so a 30-second or
 * 90-second rest degrades to the same *shape* instead of spending its whole
 * length on the result card or skipping the preview entirely. #190 records
 * this as a decision not to re-litigate; M36-03 may retune the numbers.
 *
 * ## Freezing is what this module is really for
 *
 * `restPhaseAt` is a total function of elapsed time, so the phase can never
 * disagree with the clock. `RoundResultFreeze` is the other half: it closes
 * the round's numbers at the bell so that a punch landing during rest — a
 * stray one at the bag, a late-delivered recovered event — cannot move a
 * number the athlete is already reading. A count still ticking after the
 * bell tells them the round is somehow still being judged.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1), and
 * no clock of its own: elapsed time is always passed in.
 */

import { resolveEffectiveStance } from '../programs/StanceMapper'
import { formatCombo, type ProgramRound, type Stance } from '../workout/WorkoutTokens'
import type { PunchHand } from '../punch/PunchEvent'

export type RestPhase = 'result' | 'recovery' | 'preview'

/** Presentation order. Also the source of the "step n of 3" indicator. */
export const REST_PHASE_ORDER: readonly RestPhase[] = ['result', 'recovery', 'preview']

/** 20 % — 12 s into a 60 s rest (doc §23). */
export const REST_RECOVERY_FRACTION = 0.2
/** 75 % — 45 s into a 60 s rest (doc §23). */
export const REST_PREVIEW_FRACTION = 0.75

/**
 * How far through the rest interval, clamped to 0…1.
 *
 * A non-positive or non-finite duration resolves to 1 rather than throwing:
 * there is no interval left to divide, so the last phase is the honest
 * answer, and a render is the worst possible place to raise.
 */
export function restProgress(restElapsedMs: number, restDurationMs: number): number {
  if (!Number.isFinite(restElapsedMs) || !Number.isFinite(restDurationMs)) return 1
  if (restDurationMs <= 0) return 1
  return Math.min(1, Math.max(0, restElapsedMs) / restDurationMs)
}

/**
 * Which of the three rest views belongs on screen at this moment.
 *
 * Boundaries are inclusive-below: at exactly 12 000 ms of a 60 000 ms rest
 * the recovery view is showing, matching doc §23's "0–12 / 12–45 / 45–60"
 * reading where each range starts at its stated second.
 */
export function restPhaseAt(restElapsedMs: number, restDurationMs: number): RestPhase {
  const progress = restProgress(restElapsedMs, restDurationMs)
  if (progress < REST_RECOVERY_FRACTION) return 'result'
  if (progress < REST_PREVIEW_FRACTION) return 'recovery'
  return 'preview'
}

/** 1-based position of a phase in `REST_PHASE_ORDER`. */
export function restPhaseStep(phase: RestPhase): number {
  return REST_PHASE_ORDER.indexOf(phase) + 1
}

/**
 * Tracker-reported velocity, in tracker units (spec §4.3).
 *
 * Declared here because the domain is the inward-most layer that needs it;
 * `MetricsRail.VelocityView` and `useWorkoutStore.LiveVelocity` are the same
 * shape and assign to this without conversion. Both `unit` and `label` are
 * literal types rather than plain strings, so a surface cannot rename the
 * reading into some other quantity or a physical unit on its way to the
 * screen (spec §4.3, CLAUDE.md rule 3).
 */
export interface VelocityView {
  value: number
  unit: 'tracker-unit'
  label: 'tracker-reported velocity'
}

/**
 * A round's result as it stood at the bell.
 *
 * Every field is a plain value, deliberately: this is handed to the store
 * and rendered, and holding a reference to anything still being mutated
 * would defeat the whole point of freezing.
 */
export interface FrozenRoundResult {
  roundIndex: number
  /** Punches the trackers reported during this round. */
  actual: number
  target: number
  left: number
  right: number
  /** Absent when the source reports no velocity — never rendered as zero. */
  avgVelocity?: VelocityView
  /** The round's highest single reading, doc §23's "best velocity". */
  bestVelocity?: VelocityView
  /**
   * Doc §23's alternative to best velocity. Left for M33-08, which owns the
   * per-combination results; the recovery view falls back to velocity.
   */
  bestCombo?: string
  /** A glove was disconnected or reconnecting at some point in this round. */
  trackerDropped: boolean
}

/** The doc §23 preview contents: theme, stance, and two sample combos. */
export interface NextRoundPreview {
  theme: string
  stance: Stance
  sampleCombos: string[]
}

/**
 * What the preview phase should say about the round that comes next.
 *
 * Returns `undefined` after the final round — the clock still runs that
 * round's rest and there is genuinely nothing to preview, which is a
 * different thing from an empty preview.
 *
 * The stance is the first block's effective stance (D2). A round whose
 * blocks disagree is previewed by the one the athlete starts in; the top
 * bar keeps showing the live value once the round begins.
 *
 * Sample combinations are taken from blocks that actually contain punches,
 * so a defense- or footwork-only block never becomes the example of what
 * the round asks for.
 */
export function nextRoundPreview(
  round: ProgramRound | undefined,
  defaultStance: Stance,
  sampleCount = 2,
): NextRoundPreview | undefined {
  if (!round) return undefined

  const first = round.blocks[0]
  const stance = first ? resolveEffectiveStance(first.stance, defaultStance) : defaultStance

  const sampleCombos: string[] = []
  for (const block of round.blocks) {
    if (sampleCombos.length >= sampleCount) break
    if (!block.tokens.some((token) => token.kind === 'punch')) continue
    const notation = formatCombo(block.tokens)
    if (notation.length > 0 && !sampleCombos.includes(notation)) sampleCombos.push(notation)
  }

  return { theme: round.theme, stance, sampleCombos }
}

/** What the freeze needs from a punch. A deliberately narrow slice. */
export interface FreezePunchInput {
  hand: PunchHand
  /** Omitted when the source cannot report velocity (spec §4.2). */
  velocityRaw?: number
}

function velocityView(value: number): VelocityView {
  return { value, unit: 'tracker-unit', label: 'tracker-reported velocity' }
}

/**
 * Per-round accumulator whose numbers stop at the bell.
 *
 * The runner's own counters are cumulative across the whole session, so a
 * round result cannot be read off them. This keeps the round's own tallies
 * and — the part that matters — refuses input once `freeze()` has been
 * called. `beginRound` is the only way to reopen it, which means the only
 * thing that can restart counting is the next round starting.
 */
export class RoundResultFreeze {
  private open = false
  private roundIndex = -1
  private total = 0
  private left = 0
  private right = 0
  private velocitySum = 0
  private velocityCount = 0
  private best: number | undefined
  private trackerDropped = false

  /** Open a fresh round. Discards anything the previous round accumulated. */
  beginRound(roundIndex: number): void {
    this.open = true
    this.roundIndex = roundIndex
    this.total = 0
    this.left = 0
    this.right = 0
    this.velocitySum = 0
    this.velocityCount = 0
    this.best = undefined
    this.trackerDropped = false
  }

  /** True between `beginRound` and `freeze`. */
  get isOpen(): boolean {
    return this.open
  }

  /**
   * Count a punch into the open round.
   *
   * A no-op once frozen. That silence is the feature: the alternative is a
   * caller remembering to stop calling, and one forgetful caller is a
   * result that keeps moving during rest.
   */
  observePunch(punch: FreezePunchInput): void {
    if (!this.open) return
    this.total += 1
    if (punch.hand === 'left') this.left += 1
    else if (punch.hand === 'right') this.right += 1

    const raw = punch.velocityRaw
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      this.velocitySum += raw
      this.velocityCount += 1
      if (this.best === undefined || raw > this.best) this.best = raw
    }
  }

  /**
   * Record that a glove was not streaming during this round.
   *
   * Sticky for the round: a tracker that dropped for ten seconds and came
   * back still means the count under-reports, and the recovery view has to
   * say so (doc §23) rather than let a low number read as the athlete's.
   */
  noteTrackerDropped(): void {
    if (!this.open) return
    this.trackerDropped = true
  }

  /**
   * Close the round and return its result.
   *
   * Returns `undefined` when no round is open, so a duplicate
   * `rest-entered` cannot overwrite a result with an empty one.
   */
  freeze(targetPunches: number): FrozenRoundResult | undefined {
    if (!this.open) return undefined
    this.open = false

    const avg =
      this.velocityCount > 0 ? velocityView(this.velocitySum / this.velocityCount) : undefined

    return {
      roundIndex: this.roundIndex,
      actual: this.total,
      target: Math.max(0, Math.round(targetPunches)),
      left: this.left,
      right: this.right,
      ...(avg ? { avgVelocity: avg } : {}),
      ...(this.best === undefined ? {} : { bestVelocity: velocityView(this.best) }),
      trackerDropped: this.trackerDropped,
    }
  }
}
