/**
 * Versioned constants that gate recalculation (D14).
 *
 * Every one of these is persisted alongside the data it produced, so a
 * stored workout can be recomputed after the logic changes without touching
 * raw events (D8, spec §8.6). They live in one module so that bumping a
 * version is a visible, deliberate edit rather than a literal buried in a
 * repository call.
 *
 * **Bump the version whenever the output changes for the same input.** A
 * silent behaviour change with an unchanged version is the failure these
 * exist to prevent: historical rows would then be indistinguishable from
 * new ones while meaning something different.
 */

/**
 * The workout generator. Same recipe + this version + seed must reproduce an
 * identical plan (R18, doc §16). Bump on any change to template selection,
 * theme planning, or block arrangement.
 */
export const GENERATOR_VERSION = '1.1.0'

/**
 * Schema of the persisted `WorkoutRecipe` object in `workout_recipes.params_json`.
 * Bump when a field is added, removed, or changes meaning.
 */
export const RECIPE_SCHEMA_VERSION = 1

/**
 * The combo-plausibility model (§28.4, M37-02). Bump when a signal is added
 * or removed, or when the weights change — stored `combo_results` carry this
 * so an improved model can recompute history.
 */
export const CONFIDENCE_VERSION = '1.0.0'

/**
 * Derived session metrics (spec §8.6). Bump when a metric's formula changes.
 */
export const CALCULATION_VERSION = '1.0.0'
