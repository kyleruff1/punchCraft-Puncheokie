/**
 * Versioned constants for the backdrop effects pipeline.
 *
 * Kept separate from `src/domain/workout/versions.ts` on purpose: that
 * module gates recalculation of *persisted* data (D14), while nothing
 * the backdrop produces is stored today. The version still exists from
 * day one so that if a normalized impulse value ever lands in a saved
 * row (e.g. alongside a future calibration profile, spec §10.2), the
 * scale that produced it is already a visible, deliberate edit.
 *
 * **Bump whenever the same input produces a different output** — window
 * size, reference percentiles, warm-start values, or the easing curve.
 */
export const IMPULSE_SCALE_VERSION = '1.0.0'
