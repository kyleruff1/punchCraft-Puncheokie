/**
 * Pure sample selection for the tablet instrument voice (M40-15 #319).
 *
 * One compiled gesture in, one set of bank keys out — the ONLY place the
 * musical routing rules live, so the engine (InstrumentVoiceOutput) stays a
 * dumb transport and the routing is testable under plain jest/node with no
 * expo-audio anywhere in the import graph.
 *
 * Routing (spec §1.3, R4):
 * - chord comes from `quantized.cubeCellId` (the staged cell's left zone) —
 *   parsed, never trusted: a malformed id yields no bed/bass rather than a
 *   wrong chord.
 * - layer comes from `BRASS_ACTIVITY_LAYERS` looked up by the gesture's
 *   `notesPerMinute` — NEVER a hardcoded npm→layer map, so a ladder edit in
 *   the domain re-routes the beds without touching this file.
 * - the stab is the accent's `midiNote` (rotation is voiced by the stab
 *   alone in v1 — beds are rendered at rotation 0).
 * - the drum comes from `transient.note` via `DRUM_KEY_BY_MIDI`, falling
 *   back to 'kick' for unmapped notes (the compiler emits 36 today).
 *
 * A legacy-patch gesture (no accent/quantized blocks) selects only a drum —
 * the tablet plays punch one-shots and leaves any sounding loops alone.
 *
 * Voice mode (Kyle, 2026-09-05): 'arp' keeps the sustained bed+bass loops
 * cycling between punches; 'notes' suppresses them so the two hands trade
 * single entry-tone stabs — the alternating-notes instrument. The drum
 * transient fires in both modes (the punch feel is mode-independent).
 */
import { BRASS_ACTIVITY_LAYERS } from '@domain/instrument/brassCube'
import type { CompiledPunchGesture } from '@domain/instrument/gestureSchema'

import {
  bassKey,
  bedKey,
  DRUM_KEY_BY_MIDI,
  stabKey,
  type InstrumentDrumKey,
} from './instrumentBankKeys'
import type { InstrumentTextureId } from './voiceAssets/instrumentBankManifest'

/** `L{0..5}R{0..5}` — the wire shape of `QuantizedChange.cubeCellId`. */
const CUBE_CELL_ID = /^L([0-5])R([0-5])$/

/** 'arp' = sustained loops between punches; 'notes' = stabs only. */
export type InstrumentVoiceMode = 'arp' | 'notes'

export const INSTRUMENT_VOICE_MODES: readonly InstrumentVoiceMode[] = ['arp', 'notes']

export interface InstrumentSelection {
  textureId: InstrumentTextureId
  /** null when the gesture has no quantized block or its cellId is malformed. */
  bed: string | null
  bass: string | null
  /** null when the gesture has no accent block. */
  stab: string | null
  /** accent.midiVelocity/127 clamped to [0,1]; 0 when stab is null. */
  stabGain: number
  /** DRUM_KEY_BY_MIDI[transient.note] ?? 'kick'. */
  drum: InstrumentDrumKey | null
  /** transient.velocity/127 clamped to [0,1]. */
  drumGain: number
}

function gain01(midiVelocity: number): number {
  const v = midiVelocity / 127
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/**
 * Resolve the gesture into bank keys for `textureId`. Pure — no logging,
 * no clocks, no expo imports; a malformed field degrades to null, never
 * throws.
 */
export function selectInstrumentSamples(
  gesture: CompiledPunchGesture,
  textureId: InstrumentTextureId,
  mode: InstrumentVoiceMode = 'arp',
): InstrumentSelection {
  let bed: string | null = null
  let bass: string | null = null
  const quantized = gesture.quantized
  if (quantized && mode === 'arp') {
    const match = CUBE_CELL_ID.exec(quantized.cubeCellId)
    if (match) {
      const leftZone = Number(match[1])
      bass = bassKey(leftZone)
      const layer = BRASS_ACTIVITY_LAYERS.find(
        (l) => l.notesPerMinute === quantized.notesPerMinute,
      )?.layer
      bed = layer === undefined ? null : bedKey(leftZone, layer)
    }
  }
  const accent = gesture.accent
  return {
    textureId,
    bed,
    bass,
    stab: accent ? stabKey(accent.midiNote) : null,
    stabGain: accent ? gain01(accent.midiVelocity) : 0,
    drum: DRUM_KEY_BY_MIDI[gesture.transient.note] ?? 'kick',
    drumGain: gain01(gesture.transient.velocity),
  }
}
