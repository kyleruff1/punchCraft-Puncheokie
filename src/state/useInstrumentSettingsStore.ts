import { INSTRUMENT_ENGINES, type InstrumentEngine } from '@audio/instrumentEngine'
/**
 * Puncheoke instrument settings, persisted — the selected PunchPatch,
 * the PunchBridge address, and the brass-cube jam options. Same shape as
 * the backdrop settings store: zustand for the screens, SettingsRepository
 * behind it, module-level repository handle.
 */
import { create } from 'zustand'

import {
  INSTRUMENT_VOICE_MODES,
  type InstrumentVoiceMode,
} from '@audio/instrumentSelection'
import {
  INSTRUMENT_TEXTURE_IDS,
  type InstrumentTextureId,
} from '@audio/voiceAssets/instrumentBankManifest'
import { type ArpPatternId } from '@domain/instrument/brassCube'
import type { ArpeggiatorBackend, RetriggerPolicy } from '@domain/instrument/gestureSchema'
import type {
  FreedomProfileId,
  HarmonicSettingsOptions,
  NavigationMode,
} from '@domain/instrument/harmonicField'
import type { CommitIntervalTicks } from '@domain/instrument/transportGrid'
import { DEFAULT_PATCH_ID, LAUNCH_PATCHES } from '@domain/instrument/punchPatch'
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import type { SettingsRepository } from '@storage/repositories/SettingsRepository'

export const DEFAULT_BRIDGE_URL = 'ws://192.168.86.35:8787'

/** Where compiled gestures sound (M40-15): the PC rig, the tablet, or both. */
export type InstrumentOutputTarget = 'bridge' | 'tablet' | 'both'

const OUTPUT_TARGETS: readonly InstrumentOutputTarget[] = ['bridge', 'tablet', 'both']

/** The persisted tablet-voice blob (one JSON object under instrumentTablet). */
interface InstrumentTabletBlob {
  output: InstrumentOutputTarget
  texture: InstrumentTextureId
  /** Absent in pre-mode blobs — oneOf falls back to 'arp'. */
  mode?: InstrumentVoiceMode
  /**
   * Which audio engine backs the instrument. Absent in pre-engine blobs —
   * oneOf falls back to 'expo', so an existing install keeps today's engine
   * until it is switched deliberately (audio-engine-migration.md step 2).
   */
  engine?: InstrumentEngine
}

const DEFAULT_TABLET_BLOB: Required<InstrumentTabletBlob> = {
  output: 'bridge',
  texture: 'brass',
  mode: 'arp',
  // Oboe is the shipping engine as of the step-4 default flip
  // (audio-engine-migration.md). Measured against expo-audio on the same
  // screen, same app, toggled live: 37 AudioTracks to 0, and a kit one-shot
  // from 119.4 ms median / 50.6 ms jitter to a fast-mixer track. An install
  // that has already persisted a choice keeps it; this is only the fallback.
  engine: 'oboe',
}

/** The persisted brass-cube blob (one JSON object under instrumentBrass). */
export interface BrassOptions {
  patternId: ArpPatternId
  retrigger: RetriggerPolicy
  backend: ArpeggiatorBackend
}

export const DEFAULT_BRASS_OPTIONS: BrassOptions = {
  patternId: 'punch-weave',
  retrigger: 'quantized-rotate',
  backend: 'punchbridge-tick',
}

const ARP_PATTERN_IDS: readonly ArpPatternId[] = ['punch-weave', 'up', 'down', 'fanfare', 'pendulum']
const RETRIGGER_POLICIES: readonly RetriggerPolicy[] = [
  'quantized-rotate',
  'hard-retrigger',
  'continuous-morph',
]
const ARP_BACKENDS: readonly ArpeggiatorBackend[] = ['punchbridge-tick', 'studio-one-note-fx']

/**
 * The persisted harmonic-field blob (M40-18) — VERSIONED, always written
 * with every field canonical (omitted ≡ stored-default hashing: an
 * open-and-save can never move effectivePatchHash). A wrong schemaVersion
 * or garbage field falls to the canonical defaults, never partially.
 */
interface InstrumentHarmonicBlob extends HarmonicSettingsOptions {
  schemaVersion: 1
}

export const DEFAULT_HARMONIC_OPTIONS: HarmonicSettingsOptions = {
  freedom: 'safe-3x3',
  navigation: 'orbit',
  commitIntervalTicks: 480,
}

const FREEDOM_MODES: readonly FreedomProfileId[] = ['safe-3x3', 'guided-4x4', 'full-6x6']
const NAVIGATION_MODES: readonly NavigationMode[] = ['absolute', 'orbit']
const COMMIT_INTERVALS: readonly CommitIntervalTicks[] = [240, 480, 960]

/** A stored value that is no longer (or never was) valid falls to default. */
function oneOf<T extends string | number>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback
}

export interface InstrumentSettingsState {
  patchId: string
  bridgeUrl: string
  brassPatternId: ArpPatternId
  brassRetrigger: RetriggerPolicy
  brassBackend: ArpeggiatorBackend
  /** Tablet instrument voice (M40-15): gesture routing + sample texture. */
  outputTarget: InstrumentOutputTarget
  textureId: InstrumentTextureId
  /** 'arp' = sustained loops between punches; 'notes' = alternating stabs. */
  voiceMode: InstrumentVoiceMode
  /** Harmonic-field selections (M40-18); folded into field-patch sections. */
  harmonicFreedom: FreedomProfileId
  harmonicNavigation: NavigationMode
  harmonicCommitIntervalTicks: CommitIntervalTicks
  /**
   * Session-scoped generation, bumped by every harmonic settings change:
   * the jam drops pending intents, resets orbit state, panics, and
   * re-hellos on a bump (harmonic-field-v2 review amendment). Never
   * persisted — pending state dies with the process anyway.
   */
  harmonicGeneration: number
  /** True once a load has run, so a screen never writes over unread values. */
  loaded: boolean
  load(repo: SettingsRepository): void
  setPatchId(patchId: string): void
  setBridgeUrl(url: string): void
  setBrassOptions(partial: Partial<BrassOptions>): void
  setOutputTarget(target: InstrumentOutputTarget): void
  setTextureId(textureId: InstrumentTextureId): void
  setVoiceMode(mode: InstrumentVoiceMode): void
  engine: InstrumentEngine
  setEngine(engine: InstrumentEngine): void
  setHarmonicOptions(partial: Partial<HarmonicSettingsOptions>): void
}

let repository: SettingsRepository | null = null

function normalizePatchId(id: string): string {
  return LAUNCH_PATCHES.some((p) => p.id === id) ? id : DEFAULT_PATCH_ID
}

export const useInstrumentSettingsStore = create<InstrumentSettingsState>((set, get) => ({
  patchId: DEFAULT_PATCH_ID,
  bridgeUrl: DEFAULT_BRIDGE_URL,
  brassPatternId: DEFAULT_BRASS_OPTIONS.patternId,
  brassRetrigger: DEFAULT_BRASS_OPTIONS.retrigger,
  brassBackend: DEFAULT_BRASS_OPTIONS.backend,
  outputTarget: DEFAULT_TABLET_BLOB.output,
  textureId: DEFAULT_TABLET_BLOB.texture,
  voiceMode: DEFAULT_TABLET_BLOB.mode,
  engine: DEFAULT_TABLET_BLOB.engine,
  harmonicFreedom: DEFAULT_HARMONIC_OPTIONS.freedom,
  harmonicNavigation: DEFAULT_HARMONIC_OPTIONS.navigation,
  harmonicCommitIntervalTicks: DEFAULT_HARMONIC_OPTIONS.commitIntervalTicks,
  harmonicGeneration: 0,
  loaded: false,

  load(repo) {
    repository = repo
    const patch = repo.read<{ patchId: string }>(SETTINGS_KEYS.instrumentPatch, {
      patchId: DEFAULT_PATCH_ID,
    })
    const bridge = repo.read<{ url: string }>(SETTINGS_KEYS.instrumentBridge, {
      url: DEFAULT_BRIDGE_URL,
    })
    const brass = repo.read<BrassOptions>(SETTINGS_KEYS.instrumentBrass, DEFAULT_BRASS_OPTIONS)
    const tablet = repo.read<InstrumentTabletBlob>(
      SETTINGS_KEYS.instrumentTablet,
      DEFAULT_TABLET_BLOB,
    )
    const harmonic = repo.read<Partial<InstrumentHarmonicBlob>>(SETTINGS_KEYS.instrumentHarmonic, {
      schemaVersion: 1,
      ...DEFAULT_HARMONIC_OPTIONS,
    })
    // A wrong/missing schemaVersion drops the WHOLE blob to defaults — a
    // future v2 blob must never be half-read through v1 validation.
    const harmonicValid = harmonic.schemaVersion === 1
    set({
      patchId: normalizePatchId(patch.patchId),
      bridgeUrl: bridge.url,
      brassPatternId: oneOf(ARP_PATTERN_IDS, brass.patternId, DEFAULT_BRASS_OPTIONS.patternId),
      brassRetrigger: oneOf(RETRIGGER_POLICIES, brass.retrigger, DEFAULT_BRASS_OPTIONS.retrigger),
      brassBackend: oneOf(ARP_BACKENDS, brass.backend, DEFAULT_BRASS_OPTIONS.backend),
      outputTarget: oneOf(OUTPUT_TARGETS, tablet.output, DEFAULT_TABLET_BLOB.output),
      textureId: oneOf(INSTRUMENT_TEXTURE_IDS, tablet.texture, DEFAULT_TABLET_BLOB.texture),
      voiceMode: oneOf(INSTRUMENT_VOICE_MODES, tablet.mode, DEFAULT_TABLET_BLOB.mode),
      engine: oneOf(INSTRUMENT_ENGINES, tablet.engine, DEFAULT_TABLET_BLOB.engine),
      harmonicFreedom: harmonicValid
        ? oneOf(FREEDOM_MODES, harmonic.freedom, DEFAULT_HARMONIC_OPTIONS.freedom)
        : DEFAULT_HARMONIC_OPTIONS.freedom,
      harmonicNavigation: harmonicValid
        ? oneOf(NAVIGATION_MODES, harmonic.navigation, DEFAULT_HARMONIC_OPTIONS.navigation)
        : DEFAULT_HARMONIC_OPTIONS.navigation,
      harmonicCommitIntervalTicks: harmonicValid
        ? oneOf(
            COMMIT_INTERVALS,
            harmonic.commitIntervalTicks,
            DEFAULT_HARMONIC_OPTIONS.commitIntervalTicks,
          )
        : DEFAULT_HARMONIC_OPTIONS.commitIntervalTicks,
      loaded: true,
    })
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

  setBrassOptions(partial) {
    const s = get()
    const merged: BrassOptions = {
      patternId: partial.patternId ?? s.brassPatternId,
      retrigger: partial.retrigger ?? s.brassRetrigger,
      backend: partial.backend ?? s.brassBackend,
    }
    set({
      brassPatternId: merged.patternId,
      brassRetrigger: merged.retrigger,
      brassBackend: merged.backend,
    })
    repository?.write(SETTINGS_KEYS.instrumentBrass, merged)
  },

  setOutputTarget(target) {
    set({ outputTarget: target })
    // Merged blob, the setBrassOptions pattern: one key, all fields.
    repository?.write(SETTINGS_KEYS.instrumentTablet, {
      output: target,
      texture: get().textureId,
      mode: get().voiceMode,
      engine: get().engine,
    } satisfies InstrumentTabletBlob)
  },

  setTextureId(textureId) {
    set({ textureId })
    repository?.write(SETTINGS_KEYS.instrumentTablet, {
      output: get().outputTarget,
      texture: textureId,
      mode: get().voiceMode,
      engine: get().engine,
    } satisfies InstrumentTabletBlob)
  },

  setEngine(engine) {
    set({ engine })
    repository?.write(SETTINGS_KEYS.instrumentTablet, {
      output: get().outputTarget,
      texture: get().textureId,
      mode: get().voiceMode,
      engine,
    } satisfies InstrumentTabletBlob)
  },

  setVoiceMode(mode) {
    set({ voiceMode: mode })
    repository?.write(SETTINGS_KEYS.instrumentTablet, {
      output: get().outputTarget,
      texture: get().textureId,
      mode,
    } satisfies InstrumentTabletBlob)
  },

  setHarmonicOptions(partial) {
    const s = get()
    const merged: HarmonicSettingsOptions = {
      freedom: partial.freedom ?? s.harmonicFreedom,
      navigation: partial.navigation ?? s.harmonicNavigation,
      commitIntervalTicks: partial.commitIntervalTicks ?? s.harmonicCommitIntervalTicks,
    }
    set({
      harmonicFreedom: merged.freedom,
      harmonicNavigation: merged.navigation,
      harmonicCommitIntervalTicks: merged.commitIntervalTicks,
      // Every harmonic change is a generation: pending intents drop,
      // orbit resets, panic, re-hello (the jam reacts to this counter).
      harmonicGeneration: s.harmonicGeneration + 1,
    })
    // Always the canonical FULL blob — never a partial write.
    repository?.write(SETTINGS_KEYS.instrumentHarmonic, {
      schemaVersion: 1,
      ...merged,
    } satisfies InstrumentHarmonicBlob)
  },
}))

/** Reset for tests — the module-level repository handle outlives a render. */
export function __resetInstrumentSettingsForTests(): void {
  repository = null
  useInstrumentSettingsStore.setState({
    patchId: DEFAULT_PATCH_ID,
    bridgeUrl: DEFAULT_BRIDGE_URL,
    brassPatternId: DEFAULT_BRASS_OPTIONS.patternId,
    brassRetrigger: DEFAULT_BRASS_OPTIONS.retrigger,
    brassBackend: DEFAULT_BRASS_OPTIONS.backend,
    outputTarget: DEFAULT_TABLET_BLOB.output,
    textureId: DEFAULT_TABLET_BLOB.texture,
    voiceMode: DEFAULT_TABLET_BLOB.mode,
    engine: DEFAULT_TABLET_BLOB.engine,
    harmonicFreedom: DEFAULT_HARMONIC_OPTIONS.freedom,
    harmonicNavigation: DEFAULT_HARMONIC_OPTIONS.navigation,
    harmonicCommitIntervalTicks: DEFAULT_HARMONIC_OPTIONS.commitIntervalTicks,
    harmonicGeneration: 0,
    loaded: false,
  })
}
