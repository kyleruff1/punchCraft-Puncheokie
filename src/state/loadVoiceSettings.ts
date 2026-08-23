/**
 * Load persisted Voice Coach settings once per launch (M34-05).
 *
 * Kept out of the store module so the store itself stays free of any
 * database import — the settings screen and its tests can then use the store
 * without pulling in expo-sqlite.
 *
 * Failure is survivable and deliberately quiet at the surface: an unreadable
 * settings table means the athlete gets the defaults, not a launch that
 * fails. The one thing that must never happen is a failed read leaving the
 * D1 opt-in on, and it cannot — the default is off, and a failed load leaves
 * the store exactly at its defaults.
 */
import { useEffect } from 'react'

import { logger, safe } from '@diagnostics/logger'
import { openDatabase } from '@storage/database'
import { SettingsRepository } from '@storage/repositories/SettingsRepository'
import { useVoiceSettingsStore } from './useVoiceSettingsStore'

let loaded = false

export function loadVoiceSettingsOnce(): void {
  if (loaded) return
  loaded = true
  try {
    useVoiceSettingsStore.getState().load(new SettingsRepository(openDatabase()))
  } catch (err) {
    logger.warn('settings.voice.loadFailed', 'voice settings not loaded; using defaults', {
      error: safe(String(err)),
    })
  }
}

/** Root-layout hook. Runs once per launch, never per screen. */
export function useVoiceSettingsOnLaunch(): void {
  useEffect(() => {
    loadVoiceSettingsOnce()
  }, [])
}

/** Test seam — the module-level latch outlives a render. */
export function __resetVoiceSettingsLoadForTests(): void {
  loaded = false
}
