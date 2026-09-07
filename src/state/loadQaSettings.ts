/**
 * Load the persisted QA flag once per launch.
 *
 * Same posture as `loadBackdropSettings`: the store stays free of database
 * imports, and an unreadable settings table means the flag is OFF, never a
 * failed launch — failing closed is the right default for a flag that
 * grants autostart to a public URL scheme.
 */
import { useEffect } from 'react'

import { logger, safe } from '@diagnostics/logger'
import { openDatabase } from '@storage/database'
import { SettingsRepository } from '@storage/repositories/SettingsRepository'
import { useQaStore } from './useQaStore'

let loaded = false

export function loadQaSettingsOnce(): void {
  if (loaded) return
  loaded = true
  try {
    useQaStore.getState().load(new SettingsRepository(openDatabase()))
  } catch (err) {
    logger.warn('settings.qa.loadFailed', 'QA settings not loaded; QA mode stays off', {
      error: safe(String(err)),
    })
  }
}

/** Root-layout hook. Runs once per launch, never per screen. */
export function useQaSettingsOnLaunch(): void {
  useEffect(() => {
    loadQaSettingsOnce()
  }, [])
}

/** Test seam — the module-level latch outlives a render. */
export function __resetQaSettingsLoadForTests(): void {
  loaded = false
}
