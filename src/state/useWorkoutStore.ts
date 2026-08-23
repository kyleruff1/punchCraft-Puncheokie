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
  setAdvancedOpen: (open: boolean) => void
  resetRecipe: () => void
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
