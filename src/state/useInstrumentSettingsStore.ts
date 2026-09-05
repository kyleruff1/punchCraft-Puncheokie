/**
 * Puncheoke instrument settings, persisted — the selected PunchPatch and
 * the PunchBridge address. Same shape as the backdrop settings store:
 * zustand for the screens, SettingsRepository behind it, module-level
 * repository handle.
 */
import { create } from 'zustand'

import { DEFAULT_PATCH_ID, LAUNCH_PATCHES } from '@domain/instrument/punchPatch'
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import type { SettingsRepository } from '@storage/repositories/SettingsRepository'

export const DEFAULT_BRIDGE_URL = 'ws://192.168.86.35:8787'

export interface InstrumentSettingsState {
  patchId: string
  bridgeUrl: string
  /** True once a load has run, so a screen never writes over unread values. */
  loaded: boolean
  load(repo: SettingsRepository): void
  setPatchId(patchId: string): void
  setBridgeUrl(url: string): void
}

let repository: SettingsRepository | null = null

function normalizePatchId(id: string): string {
  return LAUNCH_PATCHES.some((p) => p.id === id) ? id : DEFAULT_PATCH_ID
}

export const useInstrumentSettingsStore = create<InstrumentSettingsState>((set) => ({
  patchId: DEFAULT_PATCH_ID,
  bridgeUrl: DEFAULT_BRIDGE_URL,
  loaded: false,

  load(repo) {
    repository = repo
    const patch = repo.read<{ patchId: string }>(SETTINGS_KEYS.instrumentPatch, {
      patchId: DEFAULT_PATCH_ID,
    })
    const bridge = repo.read<{ url: string }>(SETTINGS_KEYS.instrumentBridge, {
      url: DEFAULT_BRIDGE_URL,
    })
    set({ patchId: normalizePatchId(patch.patchId), bridgeUrl: bridge.url, loaded: true })
  },

  setPatchId(patchId) {
    const normalized = normalizePatchId(patchId)
    set({ patchId: normalized })
    repository?.write(SETTINGS_KEYS.instrumentPatch, { patchId: normalized })
  },

  setBridgeUrl(url) {
    set({ bridgeUrl: url })
    repository?.write(SETTINGS_KEYS.instrumentBridge, { url })
  },
}))

/** Reset for tests — the module-level repository handle outlives a render. */
export function __resetInstrumentSettingsForTests(): void {
  repository = null
  useInstrumentSettingsStore.setState({
    patchId: DEFAULT_PATCH_ID,
    bridgeUrl: DEFAULT_BRIDGE_URL,
    loaded: false,
  })
}
