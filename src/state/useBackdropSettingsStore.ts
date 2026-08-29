/**
 * Backdrop settings, persisted (spec §31.4).
 *
 * Same shape as the voice settings store: zustand for the screens, one
 * durable store behind it (`SettingsRepository`, migration 006's
 * key/value table), and a module-level repository handle so a settings
 * row never threads a database handle.
 */
import { create } from 'zustand'

import {
  defaultBackdropSettings,
  normalizeBackdropQuality,
  type BackdropQuality,
  type BackdropSettings,
} from '@domain/effects/backdropSettings'
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import type { SettingsRepository } from '@storage/repositories/SettingsRepository'

export interface BackdropSettingsState {
  quality: BackdropQuality
  /** True once a load has run, so a screen never writes over unread values. */
  loaded: boolean
  load(repo: SettingsRepository): void
  setQuality(quality: BackdropQuality): void
}

let repository: SettingsRepository | null = null

function persist(settings: BackdropSettings): void {
  repository?.write(SETTINGS_KEYS.backdrop, settings)
}

export const useBackdropSettingsStore = create<BackdropSettingsState>((set) => ({
  quality: defaultBackdropSettings().quality,
  loaded: false,

  load(repo) {
    repository = repo
    const stored = repo.read<BackdropSettings>(SETTINGS_KEYS.backdrop, defaultBackdropSettings())
    set({ quality: normalizeBackdropQuality(stored.quality), loaded: true })
  },

  setQuality(quality) {
    set({ quality })
    persist({ quality })
  },
}))

export const useBackdropQuality = (): BackdropQuality =>
  useBackdropSettingsStore((s) => s.quality)

/** Reset for tests — the module-level repository handle outlives a render. */
export function __resetBackdropSettingsForTests(): void {
  repository = null
  useBackdropSettingsStore.setState({ ...defaultBackdropSettings(), loaded: false })
}
