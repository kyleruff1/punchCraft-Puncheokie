/**
 * Backdrop quality — the athlete-facing switch for the reactive layer
 * (spec §31.4): an off switch, a no-motion tier, and the full scene.
 * Theme *selection* is a recipe concern (§31.5) and does not live here.
 */

export type BackdropQuality = 'off' | 'reduced' | 'standard'

export interface BackdropSettings {
  quality: BackdropQuality
}

export function defaultBackdropSettings(): BackdropSettings {
  return { quality: 'standard' }
}

/**
 * A stored setting outlives the release that wrote it (D22): a retired
 * or corrupted value degrades to the default rather than crashing a
 * launch or silently meaning something new.
 */
export function normalizeBackdropQuality(quality: unknown): BackdropQuality {
  return quality === 'off' || quality === 'reduced' || quality === 'standard'
    ? quality
    : defaultBackdropSettings().quality
}
