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
}

const DEFAULT_TABLET_BLOB: Required<InstrumentTabletBlob> = {
  output: 'bridge',
  texture: 'brass',
  mode: 'arp',
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

/** A stored value that is no longer (or never was) valid falls to default. */
function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
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
  /** True once a load has run, so a screen never writes over unread values. */
  loaded: boolean
  load(repo: SettingsRepository): void
  setPatchId(patchId: string): void
  setBridgeUrl(url: string): void
  setBrassOptions(partial: Partial<BrassOptions>): void
  setOutputTarget(target: InstrumentOutputTarget): void
  setTextureId(textureId: InstrumentTextureId): void
  setVoiceMode(mode: InstrumentVoiceMode): void
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
    set({
      patchId: normalizePatchId(patch.patchId),
      bridgeUrl: bridge.url,
      brassPatternId: oneOf(ARP_PATTERN_IDS, brass.patternId, DEFAULT_BRASS_OPTIONS.patternId),
      brassRetrigger: oneOf(RETRIGGER_POLICIES, brass.retrigger, DEFAULT_BRASS_OPTIONS.retrigger),
      brassBackend: oneOf(ARP_BACKENDS, brass.backend, DEFAULT_BRASS_OPTIONS.backend),
      outputTarget: oneOf(OUTPUT_TARGETS, tablet.output, DEFAULT_TABLET_BLOB.output),
      textureId: oneOf(INSTRUMENT_TEXTURE_IDS, tablet.texture, DEFAULT_TABLET_BLOB.texture),
      voiceMode: oneOf(INSTRUMENT_VOICE_MODES, tablet.mode, DEFAULT_TABLET_BLOB.mode),
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
    } satisfies InstrumentTabletBlob)
  },

  setTextureId(textureId) {
    set({ textureId })
    repository?.write(SETTINGS_KEYS.instrumentTablet, {
      output: get().outputTarget,
      texture: textureId,
      mode: get().voiceMode,
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
    loaded: false,
  })
}
