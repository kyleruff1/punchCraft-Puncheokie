/**
 * The PunchPatch — one instrument preset (note-cube-design §10). Five
 * independent selections plus the four-route modulation matrix:
 *
 *   Root key + pitch set + cube topology + harmony behavior +
 *   register/transition = punch patch
 *
 * The patch is DATA; `compilePunchPatch` (cubeCompiler.ts) turns it into
 * the CompiledCubeMap every consumer shares. patchHash = mapHashOf(patch).
 */
import { DORIAN_BRASS_CUBE_SECTION, type BrassCubeSection } from './brassCube'

export type TopologyId = 'parallel' | 'bass-lead' | 'root-interval'

export type HarmonyMode = 'free' | 'soft-guard' | 'interval-lock'

export type TransitionMode = 'retrigger' | 'glide' | 'elastic'

export type ZoneCount = 4 | 5 | 6

export type ModulationSource =
  | 'velocity-in-zone'
  | 'acceleration'
  | 'punch-rate'
  | 'alternation'

export type ModulationCurve = 'linear' | 'exponential' | 'smooth' | 'threshold'

/**
 * Launch destinations map onto the wire gesture's fields: note-velocity →
 * voice.noteVelocity, filter-cutoff → voice.brightness, delay-send →
 * voice.expression, stereo-width → visual radius emphasis. Pitch-oriented
 * destinations are deliberately absent — modulation never bypasses the
 * quantizer (§11).
 */
export type ModulationDestination =
  | 'note-velocity'
  | 'filter-cutoff'
  | 'delay-send'
  | 'stereo-width'

export interface PunchModulationRoute {
  source: ModulationSource
  curve: ModulationCurve
  /** Signed percent, -100..100. */
  amount: number
  destination: ModulationDestination
}

export interface PatchVoice {
  /** Scientific octave of the root for this hand (D2 → baseOctave 2). */
  baseOctave: number
  /** 'descending' reverses the zone→offset order for this hand. */
  direction: 'ascending' | 'descending'
  /** Doc-numbered MIDI channel (1-based; the bridge converts to wire). */
  midiChannel: number
}

export interface PunchPatch {
  schemaVersion: 1
  id: string
  name: string
  /** 0 = C … 11 = B. */
  rootPitchClass: number
  pitchSetId: string
  topologyId: TopologyId
  harmony: {
    mode: HarmonyMode
    /**
     * soft-guard: pitch-class intervals (0..11) allowed between the two
     * held voices; a disallowed interval resolves the CHANGED voice to
     * the nearest allowed note. Default per note-cube-design §6.
     */
    allowedIntervalClasses?: readonly number[]
    /** interval-lock: the right voice holds this interval above left. */
    lockIntervalSemitones?: number
  }
  leftVoice: PatchVoice
  rightVoice: PatchVoice
  transition: {
    mode: TransitionMode
    minimumMs: number
    maximumMs: number
    overshootCents: number
    /**
     * Peak-event whammy rise (transition-design "new velocity peak").
     * Additive: only patches that opt in fire it — enabling it moves the
     * patchHash, so the legacy launch patches never carry it (R1).
     */
    whammy?: { semitones: number; minDurationMs: number; maxDurationMs: number }
  }
  modulationRoutes: readonly [
    PunchModulationRoute,
    PunchModulationRoute,
    PunchModulationRoute,
    PunchModulationRoute,
  ]
  instrumentProfileId: string
  zoneCount: ZoneCount
  /**
   * Brass-cube section (brass-cube-design). Present → the compiler emits
   * the accent/quantized blocks and `compileBrassCube` builds the 36-cell
   * map; absent → the patch is a pure latch preset, byte-identical wire.
   */
  brassCube?: BrassCubeSection
}

/** Soft Guard's default allowed set (§6): unison m3 M3 P4 P5 m6 M6 m7. */
export const SOFT_GUARD_ALLOWED: readonly number[] = [0, 3, 4, 5, 7, 8, 9, 10]

/** The default four-route matrix (note-cube-design §11). */
export const DEFAULT_MODULATION_ROUTES: PunchPatch['modulationRoutes'] = [
  { source: 'velocity-in-zone', curve: 'linear', amount: 45, destination: 'filter-cutoff' },
  { source: 'acceleration', curve: 'exponential', amount: 80, destination: 'note-velocity' },
  { source: 'punch-rate', curve: 'smooth', amount: 38, destination: 'delay-send' },
  { source: 'alternation', curve: 'threshold', amount: 55, destination: 'stereo-width' },
]

const base = (
  id: string,
  name: string,
  patch: Partial<PunchPatch> & Pick<PunchPatch, 'rootPitchClass' | 'pitchSetId'>,
): PunchPatch => ({
  schemaVersion: 1,
  id,
  name,
  topologyId: 'parallel',
  harmony: { mode: 'free' },
  leftVoice: { baseOctave: 2, direction: 'ascending', midiChannel: 2 },
  rightVoice: { baseOctave: 4, direction: 'ascending', midiChannel: 3 },
  transition: { mode: 'elastic', minimumMs: 35, maximumMs: 320, overshootCents: 12 },
  modulationRoutes: DEFAULT_MODULATION_ROUTES,
  instrumentProfileId: 'studio-one-stock',
  zoneCount: 6,
  ...patch,
})

/** Launch patches (note-cube-design §14). */
export const LAUNCH_PATCHES: readonly PunchPatch[] = [
  base('two-handed-pentatonic', 'Two-Handed Pentatonic', {
    rootPitchClass: 2, // D
    pitchSetId: 'minor-pentatonic',
  }),
  base('bright-corners', 'Bright Corners', {
    rootPitchClass: 7, // G
    pitchSetId: 'major-pentatonic',
  }),
  base('blues-pressure', 'Blues Pressure', {
    rootPitchClass: 4, // E
    pitchSetId: 'minor-blues',
    topologyId: 'bass-lead',
    harmony: { mode: 'soft-guard', allowedIntervalClasses: SOFT_GUARD_ALLOWED },
  }),
  base('power-cage', 'Power Cage', {
    rootPitchClass: 2, // D
    pitchSetId: 'power-lattice',
    harmony: { mode: 'soft-guard', allowedIntervalClasses: SOFT_GUARD_ALLOWED },
  }),
  base('harmonic-cube', 'Harmonic Cube', {
    rootPitchClass: 2, // D
    pitchSetId: 'dorian-six',
    topologyId: 'root-interval',
    harmony: { mode: 'soft-guard', allowedIntervalClasses: SOFT_GUARD_ALLOWED },
  }),
  base('dorian-brass-cube', 'Dorian Brass Cube', {
    rootPitchClass: 2, // D
    pitchSetId: 'dorian-six',
    transition: {
      mode: 'elastic',
      minimumMs: 35,
      maximumMs: 320,
      overshootCents: 12,
      whammy: { semitones: 12, minDurationMs: 200, maxDurationMs: 450 },
    },
    brassCube: DORIAN_BRASS_CUBE_SECTION,
  }),
]

export const DEFAULT_PATCH_ID = 'dorian-brass-cube'

export function launchPatchById(id: string): PunchPatch {
  const found = LAUNCH_PATCHES.find((p) => p.id === id)
  if (!found) throw new Error(`unknown launch patch "${id}"`)
  return found
}
