/**
 * QA mode (GH #291) — the persisted flag and the ephemeral staged run.
 *
 * Two very different lifetimes share this store on purpose:
 *
 * - `enabled` is PERSISTED (migration 006's key/value table, same posture
 *   as the backdrop and voice settings). It survives a cold start, which
 *   is the whole point: the unattended timing suite runs against a release
 *   build where `__DEV__` is false, and every workout is a cold start.
 *   Nothing here is gated on `__DEV__`.
 * - `run` is EPHEMERAL. The `punchcraft://qa/run` route stages one request
 *   here immediately before navigating to the live screen; the live screen
 *   consumes it (autostart, sim script). It is never written to disk.
 *
 * The flag is what makes a public URL scheme safe to expose: without it a
 * `qa/run` link merely selects a workout — it can neither press Hit It nor
 * fire simulated punches. `isQaEnabled()` is the hook-free read for
 * non-React callers (the timing observers, the viz-forensics gate).
 */
import { create } from 'zustand'

import type { SampleWorkoutKey } from '@domain/workout/samples'
import type { SimScriptId } from '@simulation/scripts'
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import type { SettingsRepository } from '@storage/repositories/SettingsRepository'

export type QaVocabulary = 'numbers' | 'techniques'

/** The persisted blob. Deliberately tiny — one boolean. */
export interface QaSettings {
  enabled: boolean
}

export function defaultQaSettings(): QaSettings {
  return { enabled: false }
}

/**
 * One deep-link request, as staged for the live screen.
 *
 * `autostart` and `sim` are the two privileged actions; the route downgrades
 * both to off unless the QA flag is on (see `qa/run.tsx`).
 */
export interface StagedQaRun {
  workout: SampleWorkoutKey | 'generated'
  vocab: QaVocabulary
  sim: SimScriptId | 'none'
  /** Simulator even when both gloves are live. */
  simForce: boolean
  /** Explicit script tempo; absent means "match the workout's punch density". */
  simBpm?: number
  autostart: boolean
  /** Settle before Hit It; the live screen applies its default when absent. */
  autostartDelayMs?: number
  seed?: string
  /** De-dupe key for an intent the driver had to re-send. */
  nonce?: string
  /** `performance.now()` at staging — the suite joins on this clock. */
  requestedAtMs: number
  /** Flipped by the live screen the moment it presses Hit It. */
  autostartConsumed: boolean
}

export interface QaState {
  enabled: boolean
  /** True once a load has run, so a screen never writes over unread values. */
  loaded: boolean
  run: StagedQaRun | null
  load(repo: SettingsRepository): void
  setEnabled(on: boolean): void
  stageRun(run: StagedQaRun): void
  consumeAutostart(): void
  clearRun(): void
}

let repository: SettingsRepository | null = null

function persist(settings: QaSettings): void {
  repository?.write(SETTINGS_KEYS.qa, settings)
}

export const useQaStore = create<QaState>((set) => ({
  enabled: defaultQaSettings().enabled,
  loaded: false,
  run: null,

  load(repo) {
    repository = repo
    const stored = repo.read<QaSettings>(SETTINGS_KEYS.qa, defaultQaSettings())
    // Anything but literal `true` is off — a corrupted row must fail closed,
    // because "on" grants autostart to an externally reachable URL.
    set({ enabled: stored.enabled === true, loaded: true })
  },

  setEnabled(on) {
    set({ enabled: on })
    persist({ enabled: on })
  },

  stageRun(run) {
    set({ run })
  },

  consumeAutostart() {
    set((prev) => (prev.run ? { run: { ...prev.run, autostartConsumed: true } } : {}))
  },

  clearRun() {
    set({ run: null })
  },
}))

/** Hook-free read for the observers and other non-React callers. */
export function isQaEnabled(): boolean {
  return useQaStore.getState().enabled
}

/** Reset for tests — the module-level repository handle outlives a render. */
export function __resetQaStoreForTests(): void {
  repository = null
  useQaStore.setState({ ...defaultQaSettings(), loaded: false, run: null })
}
