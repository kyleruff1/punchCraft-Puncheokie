/**
 * Tablet instrument sample bank (generated) — one bank per texture.
 *
 * DO NOT EDIT — produced by `npx tsx tools/tablet-voice/src/render-brass-bank.ts`.
 *
 * Every musical number is computed from src/domain/instrument/brassCube.ts
 * (compileBrassCube on the dorian-brass-cube launch patch) and the texture
 * registry in tools/tablet-voice/src/textures.ts. Drums are rendered ONCE
 * to assets/audio/instrument/shared/ and referenced by EVERY texture's bank
 * — drum synthesis is texture-independent, so per-texture copies would be
 * byte-identical bloat (conscious dedupe).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { InstrumentDrumKey } from '../instrumentBankKeys'

export type InstrumentTextureId = 'brass' | 'pluck'
export const INSTRUMENT_TEXTURE_IDS: readonly InstrumentTextureId[] = ['brass', 'pluck']

export interface InstrumentBankClip {
  /** Metro module id for the wav. */
  module: number
  /** Rendered clip length: round(sampleCount / 48) ms. */
  durationMs: number
}

export interface InstrumentBank {
  textureId: InstrumentTextureId
  /** `bed-L{0..5}-A{0..3}` — 24 entries. */
  beds: Readonly<Record<string, InstrumentBankClip>>
  /** `bass-L{0..5}` — 6 entries. */
  basses: Readonly<Record<string, InstrumentBankClip>>
  /** `stab-{midi}` — one per accent-reachable note (18 at launch). */
  stabs: Readonly<Record<string, InstrumentBankClip>>
  /** Shared modules — both textures point at assets/audio/instrument/shared/ (conscious dedupe). */
  drums: Readonly<Record<InstrumentDrumKey, InstrumentBankClip>>
}

export const INSTRUMENT_BANKS: Readonly<Record<InstrumentTextureId, InstrumentBank>> = {
  brass: {
    textureId: 'brass',
    beds: {
      'bed-L0-A0': { module: require('../../../assets/audio/instrument/brass/bed-L0-A0.wav'), durationMs: 3000 },
      'bed-L0-A1': { module: require('../../../assets/audio/instrument/brass/bed-L0-A1.wav'), durationMs: 2000 },
      'bed-L0-A2': { module: require('../../../assets/audio/instrument/brass/bed-L0-A2.wav'), durationMs: 2000 },
      'bed-L0-A3': { module: require('../../../assets/audio/instrument/brass/bed-L0-A3.wav'), durationMs: 2000 },
      'bed-L1-A0': { module: require('../../../assets/audio/instrument/brass/bed-L1-A0.wav'), durationMs: 3000 },
      'bed-L1-A1': { module: require('../../../assets/audio/instrument/brass/bed-L1-A1.wav'), durationMs: 2000 },
      'bed-L1-A2': { module: require('../../../assets/audio/instrument/brass/bed-L1-A2.wav'), durationMs: 2000 },
      'bed-L1-A3': { module: require('../../../assets/audio/instrument/brass/bed-L1-A3.wav'), durationMs: 2000 },
      'bed-L2-A0': { module: require('../../../assets/audio/instrument/brass/bed-L2-A0.wav'), durationMs: 3000 },
      'bed-L2-A1': { module: require('../../../assets/audio/instrument/brass/bed-L2-A1.wav'), durationMs: 2000 },
      'bed-L2-A2': { module: require('../../../assets/audio/instrument/brass/bed-L2-A2.wav'), durationMs: 2000 },
      'bed-L2-A3': { module: require('../../../assets/audio/instrument/brass/bed-L2-A3.wav'), durationMs: 2000 },
      'bed-L3-A0': { module: require('../../../assets/audio/instrument/brass/bed-L3-A0.wav'), durationMs: 3000 },
      'bed-L3-A1': { module: require('../../../assets/audio/instrument/brass/bed-L3-A1.wav'), durationMs: 2000 },
      'bed-L3-A2': { module: require('../../../assets/audio/instrument/brass/bed-L3-A2.wav'), durationMs: 2000 },
      'bed-L3-A3': { module: require('../../../assets/audio/instrument/brass/bed-L3-A3.wav'), durationMs: 2000 },
      'bed-L4-A0': { module: require('../../../assets/audio/instrument/brass/bed-L4-A0.wav'), durationMs: 3000 },
      'bed-L4-A1': { module: require('../../../assets/audio/instrument/brass/bed-L4-A1.wav'), durationMs: 2000 },
      'bed-L4-A2': { module: require('../../../assets/audio/instrument/brass/bed-L4-A2.wav'), durationMs: 2000 },
      'bed-L4-A3': { module: require('../../../assets/audio/instrument/brass/bed-L4-A3.wav'), durationMs: 2000 },
      'bed-L5-A0': { module: require('../../../assets/audio/instrument/brass/bed-L5-A0.wav'), durationMs: 3000 },
      'bed-L5-A1': { module: require('../../../assets/audio/instrument/brass/bed-L5-A1.wav'), durationMs: 2000 },
      'bed-L5-A2': { module: require('../../../assets/audio/instrument/brass/bed-L5-A2.wav'), durationMs: 2000 },
      'bed-L5-A3': { module: require('../../../assets/audio/instrument/brass/bed-L5-A3.wav'), durationMs: 2000 },
    },
    basses: {
      'bass-L0': { module: require('../../../assets/audio/instrument/brass/bass-L0.wav'), durationMs: 1989 },
      'bass-L1': { module: require('../../../assets/audio/instrument/brass/bass-L1.wav'), durationMs: 1993 },
      'bass-L2': { module: require('../../../assets/audio/instrument/brass/bass-L2.wav'), durationMs: 2000 },
      'bass-L3': { module: require('../../../assets/audio/instrument/brass/bass-L3.wav'), durationMs: 2000 },
      'bass-L4': { module: require('../../../assets/audio/instrument/brass/bass-L4.wav'), durationMs: 1988 },
      'bass-L5': { module: require('../../../assets/audio/instrument/brass/bass-L5.wav'), durationMs: 1989 },
    },
    stabs: {
      'stab-48': { module: require('../../../assets/audio/instrument/brass/stab-48.wav'), durationMs: 280 },
      'stab-50': { module: require('../../../assets/audio/instrument/brass/stab-50.wav'), durationMs: 280 },
      'stab-52': { module: require('../../../assets/audio/instrument/brass/stab-52.wav'), durationMs: 280 },
      'stab-53': { module: require('../../../assets/audio/instrument/brass/stab-53.wav'), durationMs: 280 },
      'stab-55': { module: require('../../../assets/audio/instrument/brass/stab-55.wav'), durationMs: 280 },
      'stab-57': { module: require('../../../assets/audio/instrument/brass/stab-57.wav'), durationMs: 280 },
      'stab-59': { module: require('../../../assets/audio/instrument/brass/stab-59.wav'), durationMs: 280 },
      'stab-60': { module: require('../../../assets/audio/instrument/brass/stab-60.wav'), durationMs: 280 },
      'stab-62': { module: require('../../../assets/audio/instrument/brass/stab-62.wav'), durationMs: 280 },
      'stab-64': { module: require('../../../assets/audio/instrument/brass/stab-64.wav'), durationMs: 280 },
      'stab-65': { module: require('../../../assets/audio/instrument/brass/stab-65.wav'), durationMs: 280 },
      'stab-67': { module: require('../../../assets/audio/instrument/brass/stab-67.wav'), durationMs: 280 },
      'stab-69': { module: require('../../../assets/audio/instrument/brass/stab-69.wav'), durationMs: 280 },
      'stab-72': { module: require('../../../assets/audio/instrument/brass/stab-72.wav'), durationMs: 280 },
      'stab-74': { module: require('../../../assets/audio/instrument/brass/stab-74.wav'), durationMs: 280 },
      'stab-77': { module: require('../../../assets/audio/instrument/brass/stab-77.wav'), durationMs: 280 },
      'stab-79': { module: require('../../../assets/audio/instrument/brass/stab-79.wav'), durationMs: 280 },
      'stab-81': { module: require('../../../assets/audio/instrument/brass/stab-81.wav'), durationMs: 280 },
    },
    drums: {
      kick: { module: require('../../../assets/audio/instrument/shared/drum-kick.wav'), durationMs: 400 },
      snare: { module: require('../../../assets/audio/instrument/shared/drum-snare.wav'), durationMs: 250 },
      rim: { module: require('../../../assets/audio/instrument/shared/drum-rim.wav'), durationMs: 120 },
      crash: { module: require('../../../assets/audio/instrument/shared/drum-crash.wav'), durationMs: 1500 },
    },
  },
  pluck: {
    textureId: 'pluck',
    beds: {
      'bed-L0-A0': { module: require('../../../assets/audio/instrument/pluck/bed-L0-A0.wav'), durationMs: 3000 },
      'bed-L0-A1': { module: require('../../../assets/audio/instrument/pluck/bed-L0-A1.wav'), durationMs: 2000 },
      'bed-L0-A2': { module: require('../../../assets/audio/instrument/pluck/bed-L0-A2.wav'), durationMs: 2000 },
      'bed-L0-A3': { module: require('../../../assets/audio/instrument/pluck/bed-L0-A3.wav'), durationMs: 2000 },
      'bed-L1-A0': { module: require('../../../assets/audio/instrument/pluck/bed-L1-A0.wav'), durationMs: 3000 },
      'bed-L1-A1': { module: require('../../../assets/audio/instrument/pluck/bed-L1-A1.wav'), durationMs: 2000 },
      'bed-L1-A2': { module: require('../../../assets/audio/instrument/pluck/bed-L1-A2.wav'), durationMs: 2000 },
      'bed-L1-A3': { module: require('../../../assets/audio/instrument/pluck/bed-L1-A3.wav'), durationMs: 2000 },
      'bed-L2-A0': { module: require('../../../assets/audio/instrument/pluck/bed-L2-A0.wav'), durationMs: 3000 },
      'bed-L2-A1': { module: require('../../../assets/audio/instrument/pluck/bed-L2-A1.wav'), durationMs: 2000 },
      'bed-L2-A2': { module: require('../../../assets/audio/instrument/pluck/bed-L2-A2.wav'), durationMs: 2000 },
      'bed-L2-A3': { module: require('../../../assets/audio/instrument/pluck/bed-L2-A3.wav'), durationMs: 2000 },
      'bed-L3-A0': { module: require('../../../assets/audio/instrument/pluck/bed-L3-A0.wav'), durationMs: 3000 },
      'bed-L3-A1': { module: require('../../../assets/audio/instrument/pluck/bed-L3-A1.wav'), durationMs: 2000 },
      'bed-L3-A2': { module: require('../../../assets/audio/instrument/pluck/bed-L3-A2.wav'), durationMs: 2000 },
      'bed-L3-A3': { module: require('../../../assets/audio/instrument/pluck/bed-L3-A3.wav'), durationMs: 2000 },
      'bed-L4-A0': { module: require('../../../assets/audio/instrument/pluck/bed-L4-A0.wav'), durationMs: 3000 },
      'bed-L4-A1': { module: require('../../../assets/audio/instrument/pluck/bed-L4-A1.wav'), durationMs: 2000 },
      'bed-L4-A2': { module: require('../../../assets/audio/instrument/pluck/bed-L4-A2.wav'), durationMs: 2000 },
      'bed-L4-A3': { module: require('../../../assets/audio/instrument/pluck/bed-L4-A3.wav'), durationMs: 2000 },
      'bed-L5-A0': { module: require('../../../assets/audio/instrument/pluck/bed-L5-A0.wav'), durationMs: 3000 },
      'bed-L5-A1': { module: require('../../../assets/audio/instrument/pluck/bed-L5-A1.wav'), durationMs: 2000 },
      'bed-L5-A2': { module: require('../../../assets/audio/instrument/pluck/bed-L5-A2.wav'), durationMs: 2000 },
      'bed-L5-A3': { module: require('../../../assets/audio/instrument/pluck/bed-L5-A3.wav'), durationMs: 2000 },
    },
    basses: {
      'bass-L0': { module: require('../../../assets/audio/instrument/pluck/bass-L0.wav'), durationMs: 2000 },
      'bass-L1': { module: require('../../../assets/audio/instrument/pluck/bass-L1.wav'), durationMs: 2000 },
      'bass-L2': { module: require('../../../assets/audio/instrument/pluck/bass-L2.wav'), durationMs: 2000 },
      'bass-L3': { module: require('../../../assets/audio/instrument/pluck/bass-L3.wav'), durationMs: 2000 },
      'bass-L4': { module: require('../../../assets/audio/instrument/pluck/bass-L4.wav'), durationMs: 2000 },
      'bass-L5': { module: require('../../../assets/audio/instrument/pluck/bass-L5.wav'), durationMs: 2000 },
    },
    stabs: {
      'stab-48': { module: require('../../../assets/audio/instrument/pluck/stab-48.wav'), durationMs: 202 },
      'stab-50': { module: require('../../../assets/audio/instrument/pluck/stab-50.wav'), durationMs: 202 },
      'stab-52': { module: require('../../../assets/audio/instrument/pluck/stab-52.wav'), durationMs: 202 },
      'stab-53': { module: require('../../../assets/audio/instrument/pluck/stab-53.wav'), durationMs: 202 },
      'stab-55': { module: require('../../../assets/audio/instrument/pluck/stab-55.wav'), durationMs: 202 },
      'stab-57': { module: require('../../../assets/audio/instrument/pluck/stab-57.wav'), durationMs: 202 },
      'stab-59': { module: require('../../../assets/audio/instrument/pluck/stab-59.wav'), durationMs: 202 },
      'stab-60': { module: require('../../../assets/audio/instrument/pluck/stab-60.wav'), durationMs: 202 },
      'stab-62': { module: require('../../../assets/audio/instrument/pluck/stab-62.wav'), durationMs: 202 },
      'stab-64': { module: require('../../../assets/audio/instrument/pluck/stab-64.wav'), durationMs: 202 },
      'stab-65': { module: require('../../../assets/audio/instrument/pluck/stab-65.wav'), durationMs: 202 },
      'stab-67': { module: require('../../../assets/audio/instrument/pluck/stab-67.wav'), durationMs: 202 },
      'stab-69': { module: require('../../../assets/audio/instrument/pluck/stab-69.wav'), durationMs: 202 },
      'stab-72': { module: require('../../../assets/audio/instrument/pluck/stab-72.wav'), durationMs: 202 },
      'stab-74': { module: require('../../../assets/audio/instrument/pluck/stab-74.wav'), durationMs: 202 },
      'stab-77': { module: require('../../../assets/audio/instrument/pluck/stab-77.wav'), durationMs: 202 },
      'stab-79': { module: require('../../../assets/audio/instrument/pluck/stab-79.wav'), durationMs: 202 },
      'stab-81': { module: require('../../../assets/audio/instrument/pluck/stab-81.wav'), durationMs: 202 },
    },
    drums: {
      kick: { module: require('../../../assets/audio/instrument/shared/drum-kick.wav'), durationMs: 400 },
      snare: { module: require('../../../assets/audio/instrument/shared/drum-snare.wav'), durationMs: 250 },
      rim: { module: require('../../../assets/audio/instrument/shared/drum-rim.wav'), durationMs: 120 },
      crash: { module: require('../../../assets/audio/instrument/shared/drum-crash.wav'), durationMs: 1500 },
    },
  },
}
