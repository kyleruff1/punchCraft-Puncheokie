/**
 * Voice Coach settings, persisted (M34-05, D1, doc §25).
 *
 * ## The one rule this file exists to hold
 *
 * **`overlayOptIn` is written only by the athlete's own toggle.** Not by a
 * default, not by a migration, not by loading an older stored object, not by
 * changing mode or style or vocabulary. `setPolicy` refuses the field
 * outright — there is a separate, obviously-named `setOverlayOptIn` for the
 * one call site allowed to move it.
 *
 * That is stricter than it needs to be to work, and deliberately so. A single
 * accidental `setPolicy({ overlayOptIn: true })` somewhere in a settings
 * screen would silently make the app talk over someone's music, and nothing
 * would fail. Making the field unreachable through the general setter means
 * that mistake cannot be written.
 *
 * Persistence goes through `SettingsRepository` rather than a separate
 * storage mechanism — one durable store, one thing to reason about.
 */
import { create } from 'zustand'

import {
  defaultVoiceCoachPolicy,
  normalizeVoiceStyle,
  type VoiceCoachPolicy,
} from '@domain/coach/VoiceCoachPolicy'
import { DEFAULT_VOLUMES, type Volumes } from '@domain/coach/VoiceOutputPort'
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import type { SettingsRepository } from '@storage/repositories/SettingsRepository'

/** Everything except the D1 opt-in, which has its own setter. */
export type VoicePolicyPatch = Partial<Omit<VoiceCoachPolicy, 'overlayOptIn'>>

export interface VoiceSettingsState {
  policy: VoiceCoachPolicy
  volumes: Volumes
  /**
   * The audible metronome "click" — development instrumentation (an audible
   * marker grid for verifying event/call mapping onto the beat). OFF by
   * default: it never ships audible, and turning it off must always be a
   * single flip. Gates only the audible loop volume in the runner — it does
   * NOT touch `recipe.metronome.enabled` or `bpmForRecipe`, so the visual
   * node/avatar grid, coach calls, and avatar flip are byte-identical whether
   * the click sounds or not (mute-only semantics, Kyle 2026-09-04).
   */
  clickEnabled: boolean
  /**
   * A/B ONLY. When true the coach places calls the way it did before
   * `DELIVERED_BREATH_SHORTFALL_MS` existed — the clamp floors at
   * `MIN_BREATH_MS` alone.
   *
   * It exists so the on-glass listening test can hear both placements inside
   * one session; a ~50-95 ms difference on wide bars is not something memory
   * settles across two installs. It defaults to the SHIPPED behaviour, so
   * forgetting it leaves the athlete on the measured placement, and it gates
   * nothing but the number handed to `breathForBar`.
   *
   * Retire it once Kyle has ruled on the breath (plan step 5a).
   */
  legacyBreathFloor: boolean
  /** True once a load has run, so a screen never writes over unread values. */
  loaded: boolean
  load(repo: SettingsRepository): void
  setPolicy(patch: VoicePolicyPatch): void
  /**
   * The only path that may change the D1 opt-in. Named for what it is so it
   * cannot be reached by accident (spec §13.5).
   */
  setOverlayOptIn(optIn: boolean): void
  setVolumes(v: Volumes): void
  /** Flip the audible development click on or off (persisted). */
  setClickEnabled(on: boolean): void
  /** Flip the A/B placement between the delivered floor and the retired one. */
  setLegacyBreathFloor(on: boolean): void
}

/** The click is dev instrumentation — it never defaults audible. */
const DEFAULT_CLICK_ENABLED = false

/** The A/B defaults to the SHIPPED placement, never the retired one. */
const DEFAULT_LEGACY_BREATH_FLOOR = false

/**
 * The repository the store writes through.
 *
 * Held module-level rather than passed on every call: the settings screen
 * should not have to thread a database handle through to a slider.
 */
let repository: SettingsRepository | null = null

function persistPolicy(policy: VoiceCoachPolicy): void {
  repository?.write(SETTINGS_KEYS.voicePolicy, policy)
}

function persistVolumes(volumes: Volumes): void {
  repository?.write(SETTINGS_KEYS.voiceVolumes, volumes)
}

function persistClick(enabled: boolean): void {
  repository?.write(SETTINGS_KEYS.click, { enabled })
}

export const useVoiceSettingsStore = create<VoiceSettingsState>((set, get) => ({
  policy: defaultVoiceCoachPolicy(),
  volumes: { ...DEFAULT_VOLUMES },
  clickEnabled: DEFAULT_CLICK_ENABLED,
  legacyBreathFloor: DEFAULT_LEGACY_BREATH_FLOOR,
  loaded: false,

  load(repo) {
    repository = repo
    // `read` merges over the defaults, so a policy stored before a field
    // existed comes back complete rather than missing it.
    const stored = repo.read<VoiceCoachPolicy>(
      SETTINGS_KEYS.voicePolicy,
      defaultVoiceCoachPolicy(),
    )
    // A saved setting outlives the release that wrote it, so a retired style
    // has to be migrated rather than merely removed — an install carrying
    // `coach-shorthand` would otherwise keep beeping its repetitions with no
    // control left in the UI to explain why (D22).
    const style = normalizeVoiceStyle(stored.style)
    const policy = style === stored.style ? stored : { ...stored, style }
    if (policy !== stored) persistPolicy(policy)

    const volumes = repo.read<Volumes>(SETTINGS_KEYS.voiceVolumes, { ...DEFAULT_VOLUMES })
    // A pre-click install has no row → defaults off, the safe direction for
    // dev instrumentation. A corrupt/non-object row also merges to the default.
    const click = repo.read<{ enabled: boolean }>(SETTINGS_KEYS.click, {
      enabled: DEFAULT_CLICK_ENABLED,
    })
    const legacy = repo.read<{ enabled: boolean }>(SETTINGS_KEYS.legacyBreathFloor, {
      enabled: DEFAULT_LEGACY_BREATH_FLOOR,
    })
    set({
      policy,
      volumes,
      clickEnabled: click.enabled === true,
      legacyBreathFloor: legacy.enabled === true,
      loaded: true,
    })
  },

  setPolicy(patch) {
    // The type already excludes `overlayOptIn`; this strips it at runtime too,
    // because a patch can arrive from JSON that types never saw.
    const { overlayOptIn: _ignored, ...safePatch } = patch as VoicePolicyPatch & {
      overlayOptIn?: boolean
    }
    const policy = { ...get().policy, ...safePatch }
    set({ policy })
    persistPolicy(policy)
  },

  setOverlayOptIn(optIn) {
    const policy = { ...get().policy, overlayOptIn: optIn }
    set({ policy })
    persistPolicy(policy)
  },

  setVolumes(v) {
    const volumes = { ...v }
    set({ volumes })
    persistVolumes(volumes)
  },

  setClickEnabled(on) {
    set({ clickEnabled: on })
    persistClick(on)
  },

  setLegacyBreathFloor(on) {
    set({ legacyBreathFloor: on })
    repository?.write(SETTINGS_KEYS.legacyBreathFloor, { enabled: on })
  },
}))

/* ------------------------------------------------------ narrow selectors */

export const useVoicePolicy = (): VoiceCoachPolicy => useVoiceSettingsStore((s) => s.policy)
export const useVoiceVolumes = (): Volumes => useVoiceSettingsStore((s) => s.volumes)

/** Reset for tests — the module-level repository handle outlives a render. */
export function __resetVoiceSettingsForTests(): void {
  repository = null
  useVoiceSettingsStore.setState({
    policy: defaultVoiceCoachPolicy(),
    volumes: { ...DEFAULT_VOLUMES },
    clickEnabled: DEFAULT_CLICK_ENABLED,
    legacyBreathFloor: DEFAULT_LEGACY_BREATH_FLOOR,
    loaded: false,
  })
}
