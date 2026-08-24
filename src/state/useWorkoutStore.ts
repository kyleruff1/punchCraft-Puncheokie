/**
 * Zustand store for the Puncheokie workout recipe (M31-06).
 *
 * Holds the recipe the athlete is configuring plus the two values derived
 * from it — `conflicts` (M31-04 `validateRecipe`) and `summary` (M31-04
 * `summarizeRecipe`). Both are recomputed on every `setRecipe`, so no
 * component ever has to remember to re-validate and the summary card can
 * never drift out of step with the controls it describes.
 *
 * Rules:
 * - In-memory and ephemeral. Saving a named recipe is M31-09 / M36-01;
 *   nothing here touches SQLite.
 * - State is plain and serializable (spec §15.3) — no event arrays, no
 *   class instances, no functions inside the data.
 * - Selectors are exported so components subscribe minimally, matching
 *   `useTrackerStore`.
 *
 * The live slice (cue clock, round progress) arrives with M32-08, along
 * with the module-level driver helpers the cue engine needs to write to
 * this store from outside React.
 */
import { create } from 'zustand'

import { buildRoundSchedule } from '@domain/workout/roundSchedule'
import { summarizeRecipe, type RecipeSummary } from '@domain/workout/recipeSummary'
import { validateRecipe, type RecipeConflict } from '@domain/workout/recipeValidation'
import { defaultRecipe, type WorkoutRecipe } from '@domain/workout/WorkoutRecipe'
import type { SampleWorkoutKey } from '@domain/workout/samples'
import type { CapabilityTier } from '@domain/workout/capabilityTier'
import type { SessionPhase } from '@domain/session/WorkoutSessionClock'
import type { FrozenRoundResult } from '@domain/session/restPhases'
import type { Stance } from '@domain/workout/WorkoutTokens'
import type { TileId } from '@components/workout/MetricsRail'

/**
 * Default optional tiles — the full set.
 *
 * Kyle wants a metric-heavy screen, so every optional tile is on by default
 * (the rail's cap is raised to match). `left-right-balance` is omitted because
 * the rail already shows left/right as an always-on metric — showing it twice
 * wastes a slot on a number already on screen.
 */
export const DEFAULT_TILES: TileId[] = [
  // `correct-hand-percent` is deliberately omitted: it carries the sequence
  // label, and the score is punch count now, not a sequence grade.
  'peak-velocity',
  'velocity-zone',
  'combo-completion',
  'punches-last-15s',
  'projected-final',
  'connection-completeness',
]

export interface WorkoutStoreState {
  recipe: WorkoutRecipe
  conflicts: RecipeConflict[]
  summary: RecipeSummary
  selectedSampleKey?: SampleWorkoutKey
  /**
   * Whether the Advanced panel is expanded. Held here rather than in
   * component state so it survives in-tab navigation (M31-07).
   */
  advancedOpen: boolean
  /** Patch the recipe; validation and summary are recomputed from the result. */
  setRecipe: (patch: Partial<WorkoutRecipe>) => void
  selectSample: (key: SampleWorkoutKey | undefined) => void
  /**
   * Begin a fresh built workout: mint a new seed and clear any library pick,
   * so the generator produces a new session even at identical settings.
   */
  startNewBuild: () => void
  setAdvancedOpen: (open: boolean) => void
  resetRecipe: () => void
}

/**
 * A fresh generator seed. The state layer may read the clock and `Math.random`
 * — only `src/domain/**` is held to purity — and the seed it mints is what
 * keeps the pure generator's output reproducible once chosen.
 */
function freshSeed(): string {
  return `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Recompute everything that follows from a recipe.
 *
 * Kept as one function so the derived pair is always produced together —
 * a partial recompute is the bug this shape exists to prevent.
 */
function derive(recipe: WorkoutRecipe): {
  recipe: WorkoutRecipe
  conflicts: RecipeConflict[]
  summary: RecipeSummary
} {
  return {
    recipe,
    conflicts: validateRecipe(recipe),
    summary: summarizeRecipe(recipe, buildRoundSchedule(recipe.durationMinutes)),
  }
}

export const useWorkoutStore = create<WorkoutStoreState>((set) => ({
  ...derive(defaultRecipe()),
  selectedSampleKey: undefined,
  advancedOpen: false,

  setRecipe: (patch) => {
    set((prev) => derive({ ...prev.recipe, ...patch }))
  },

  selectSample: (key) => {
    set({ selectedSampleKey: key })
  },

  startNewBuild: () => {
    set((prev) => ({ ...derive({ ...prev.recipe, seed: freshSeed() }), selectedSampleKey: undefined }))
  },

  setAdvancedOpen: (open) => {
    set({ advancedOpen: open })
  },

  resetRecipe: () => {
    // Values reset; the panel's open state does not. Collapsing a panel the
    // athlete deliberately opened would hide the controls they were using.
    set({ ...derive(defaultRecipe()), selectedSampleKey: undefined })
  },
}))

// ---------------------------------------------------------------------------
// Selectors — components subscribe to one field, not the whole store.
// ---------------------------------------------------------------------------

export const selectRecipe = (s: WorkoutStoreState): WorkoutRecipe => s.recipe
export const selectConflicts = (s: WorkoutStoreState): RecipeConflict[] => s.conflicts
export const selectSummary = (s: WorkoutStoreState): RecipeSummary => s.summary

export const useRecipe = (): WorkoutRecipe => useWorkoutStore(selectRecipe)
export const useConflicts = (): RecipeConflict[] => useWorkoutStore(selectConflicts)
export const useRecipeSummary = (): RecipeSummary => useWorkoutStore(selectSummary)
export const useSelectedSampleKey = (): SampleWorkoutKey | undefined =>
  useWorkoutStore((s) => s.selectedSampleKey)
export const useAdvancedOpen = (): boolean => useWorkoutStore((s) => s.advancedOpen)

/**
 * Conflicts for one control, so a control can render its own inline message
 * without every control filtering the same array by hand.
 */
export function conflictsForField(
  conflicts: readonly RecipeConflict[],
  field: keyof WorkoutRecipe,
): RecipeConflict[] {
  return conflicts.filter((c) => c.fields.includes(field))
}

// ---------------------------------------------------------------------------
// Module-level helpers for non-React callers (mirrors useTrackerStore).
// ---------------------------------------------------------------------------

export function getRecipe(): WorkoutRecipe {
  return useWorkoutStore.getState().recipe
}

export function patchRecipe(patch: Partial<WorkoutRecipe>): void {
  useWorkoutStore.getState().setRecipe(patch)
}

// ---------------------------------------------------------------------------
// Live slice (M32-08)
//
// Written from outside React: the session clock and cue engine tick on a
// monotonic clock, not in a render. The `setLive` helper below is how they
// drive the store, mirroring `useTrackerStore`'s module-level helpers.
//
// Everything here stays plain and serializable (spec §15.3). In particular
// no raw event array is held — only counts and the two velocity readings a
// surface actually shows.
// ---------------------------------------------------------------------------

export interface LiveCounts {
  total: number
  left: number
  right: number
  /** Landed so far against the current cue's expectations. */
  inCue: number
  inCueExpected: number
}

export interface LiveVelocity {
  value: number
  unit: 'tracker-unit'
  label: 'tracker-reported velocity'
}

export interface LiveState {
  phase: SessionPhase
  roundIndex: number
  roundCount: number
  roundRemainingMs: number
  stance: Stance
  currentCueId?: string
  nextCueId?: string
  counts: LiveCounts
  /** Absent when the source reports no velocity — never rendered as zero. */
  lastVelocity?: LiveVelocity
  avgVelocity?: LiveVelocity
  /** The hardest punch this session, in tracker units. */
  peakVelocity?: LiveVelocity
  velocityAvailable: boolean
  capabilityTier: CapabilityTier
  tiles: TileId[]
  sourceKind: 'simulated' | 'tracker'
  degraded?: string
  /** Punches with no expectation to answer. Counted, never discarded. */
  extraCount: number
  /** Punches per minute needed to finish on target (doc §22). */
  requiredPace?: number
  /** Punches per minute actually thrown so far — the rate achieved. */
  actualPace?: number
  /** Punches thrown in the last 15 s — a rolling sense of current output. */
  punchesLast15s?: number
  /** Extrapolated from the rate achieved so far, not the rate being asked. */
  projectedTotal?: number
  /**
   * The doc §22 pacing cue, set only at a boundary and only when the band
   * is crossed. Absent when the target is unreachable — doc §25 forbids
   * encouraging acceleration toward something out of reach.
   */
  pacingCue?: 'Build the pace' | 'You are ahead; stay sharp'
  /**
   * What a sequence score may be called at the live tier (D4). Held in the
   * store so no surface can hardcode it and drift into claiming technique
   * accuracy.
   */
  sequenceScoreLabel: 'hand-sequence match' | 'technique match'
  /**
   * The round result as it stood at the bell (M33-04, doc §23).
   *
   * Written once on `rest-entered` and cleared when the next round starts.
   * Nothing else may write it: the rest screen reads a value that has
   * already stopped moving, which is the whole point of freezing it.
   */
  frozenRoundResult?: FrozenRoundResult
}

export const INITIAL_LIVE: LiveState = {
  phase: 'idle',
  roundIndex: -1,
  roundCount: 0,
  roundRemainingMs: 0,
  stance: 'orthodox',
  counts: { total: 0, left: 0, right: 0, inCue: 0, inCueExpected: 0 },
  velocityAvailable: false,
  capabilityTier: 'hand-only',
  tiles: DEFAULT_TILES,
  sourceKind: 'simulated',
  extraCount: 0,
  sequenceScoreLabel: 'hand-sequence match',
}

export interface LiveStoreState {
  live: LiveState
  setLive: (patch: Partial<LiveState>) => void
  resetLive: () => void
}

export const useLiveStore = create<LiveStoreState>((set) => ({
  live: INITIAL_LIVE,
  setLive: (patch) => {
    set((prev) => ({ live: { ...prev.live, ...patch } }))
  },
  resetLive: () => {
    set({ live: INITIAL_LIVE })
  },
}))

export const useLive = (): LiveState => useLiveStore((s) => s.live)

/** Driver for non-React callers (the session clock and cue engine). */
export function setLive(patch: Partial<LiveState>): void {
  useLiveStore.getState().setLive(patch)
}

export function getLive(): LiveState {
  return useLiveStore.getState().live
}

export function resetLive(): void {
  useLiveStore.getState().resetLive()
}
