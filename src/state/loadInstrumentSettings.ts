/**
 * Load persisted Puncheoke instrument settings once per launch. Same
 * posture as `loadBackdropSettings`: unreadable table → defaults, never a
 * failed launch.
 */
import { useEffect } from 'react'

import { logger, safe } from '@diagnostics/logger'
import { openDatabase } from '@storage/database'
import { SettingsRepository } from '@storage/repositories/SettingsRepository'
import { useInstrumentSettingsStore } from './useInstrumentSettingsStore'

let loaded = false

export function loadInstrumentSettingsOnce(): void {
  if (loaded) return
  loaded = true
  try {
    useInstrumentSettingsStore.getState().load(new SettingsRepository(openDatabase()))
  } catch (err) {
    logger.warn('settings.instrument.loadFailed', 'instrument settings not loaded; using defaults', {
      error: safe(String(err)),
    })
  }
}

/** Root-layout hook. Runs once per launch, never per screen. */
export function useInstrumentSettingsOnLaunch(): void {
  useEffect(() => {
    loadInstrumentSettingsOnce()
  }, [])
}

/** Test seam — the module-level latch outlives a render. */
export function __resetInstrumentSettingsLoadForTests(): void {
  loaded = false
}
