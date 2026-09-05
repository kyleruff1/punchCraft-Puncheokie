/**
 * Instrument profiles (note-cube-design §12): how semantic gesture fields
 * map onto a specific synth's MIDI controls. CC numbers live HERE, never
 * in scale or patch definitions.
 */

export interface InstrumentProfile {
  id: string
  name: string
  /** ± semitones the synth patch's bend wheel is configured for. */
  pitchBendRangeSemitones: number
  controls: {
    cutoffCc?: number
    expressionCc?: number
  }
}

export const PROFILES: readonly InstrumentProfile[] = [
  {
    // Studio One 4 stock synths (Mai Tai / Mojito): default bend ±2,
    // CC74 cutoff, CC11 expression.
    id: 'studio-one-stock',
    name: 'Studio One stock (Mai Tai / Mojito)',
    pitchBendRangeSemitones: 2,
    controls: { cutoffCc: 74, expressionCc: 11 },
  },
  {
    // Microsoft GS Wavetable Synth: GM — expression works, CC74 is
    // ignored; bend range fixed at ±2.
    id: 'gs-fallback',
    name: 'Windows GS synth (GM fallback)',
    pitchBendRangeSemitones: 2,
    controls: { expressionCc: 11 },
  },
]

export function profileById(id: string): InstrumentProfile {
  return PROFILES.find((p) => p.id === id) ?? (PROFILES[0] as InstrumentProfile)
}
