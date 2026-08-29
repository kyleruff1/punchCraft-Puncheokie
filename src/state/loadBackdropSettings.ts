/**
 * Load persisted backdrop settings once per launch.
 *
 * Same posture as `loadVoiceSettings`: the store stays free of database
 * imports, and an unreadable settings table means defaults, never a
 * failed launch.
 */
import { useEffect } from 'react'

import { logger, safe } from '@diagnostics/logger'
import { openDatabase } from '@storage/database'
import { SettingsRepository } from '@storage/repositories/SettingsRepository'
import { useBackdropSettingsStore } from './useBackdropSettingsStore'

let loaded = false

export function loadBackdropSettingsOnce(): void {
  if (loaded) return
  loaded = true
  try {
    useBackdropSettingsStore.getState().load(new SettingsRepository(openDatabase()))
  } catch (err) {
    logger.warn('settings.backdrop.loadFailed', 'backdrop settings not loaded; using defaults', {
      error: safe(String(err)),
    })
  }
}

/** Root-layout hook. Runs once per launch, never per screen. */
export function useBackdropSettingsOnLaunch(): void {
  useEffect(() => {
    loadBackdropSettingsOnce()
  }, [])
}

/** Test seam — the module-level latch outlives a render. */
export function __resetBackdropSettingsLoadForTests(): void {
  loaded = false
}
