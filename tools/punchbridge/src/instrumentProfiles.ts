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
  /**
   * How pitch travels between latched notes (transition-design §1):
   * 'legato-glide' — the synth's own portamento does the travel (mono +
   * Glide patches): new Note On FIRST, old Note Off after
   * `legatoOverlapMs`; bend is reserved for the small elastic overshoot.
   * 'bend-emulated' — no synth glide (GM destinations): old off, new on,
   * full old→new bend ramp emulates the travel.
   */
  transitionBackend: 'legato-glide' | 'bend-emulated'
  /** Note-off delay after the legato Note On (5–15 ms per the design). */
  legatoOverlapMs: number
  /**
   * GM program (0-indexed) sent to both voice channels at session start.
   * Only meaningful on GM destinations — a DAW profile leaves it unset
   * because the DAW owns the patch.
   */
  voiceProgramGm?: number
  /** Wah backend (§2): the CC the synth's mod matrix maps to cutoff. */
  wah?: {
    controllerCc: number
    baselineValue: number
  }
  controls: {
    cutoffCc?: number
    expressionCc?: number
  }
}

export const PROFILES: readonly InstrumentProfile[] = [
  {
    // Studio One 4 stock synths (Mai Tai / Mojito), set up per
    // transition-design §5: Mono + Glide ON, Bend ±12, mod matrix
    // Mod Wheel (CC1) → Filter Cutoff. The synth's glide does the pitch
    // travel; the bridge only ornaments (overshoot) and breathes (wah).
    id: 'studio-one-stock',
    name: 'Studio One stock (Mai Tai / Mojito)',
    pitchBendRangeSemitones: 12,
    transitionBackend: 'legato-glide',
    legatoOverlapMs: 10,
    wah: { controllerCc: 1, baselineValue: 18 },
    controls: { cutoffCc: 74, expressionCc: 11 },
  },
  {
    // Microsoft GS Wavetable Synth: GM — no glide, CC74 ignored, CC1 is
    // GM vibrato (not a wah — off). Bend fixed ±2, travel emulated by
    // bend ramps. Voices default to GM 81 "Lead 2 (sawtooth)" — the
    // thick-saw default — instead of GM grand piano.
    id: 'gs-fallback',
    name: 'Windows GS synth (GM fallback)',
    pitchBendRangeSemitones: 2,
    transitionBackend: 'bend-emulated',
    legatoOverlapMs: 0,
    voiceProgramGm: 81,
    controls: { expressionCc: 11 },
  },
]

export function profileById(id: string): InstrumentProfile {
  return PROFILES.find((p) => p.id === id) ?? (PROFILES[0] as InstrumentProfile)
}
