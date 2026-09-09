/**
 * The logical drum vocabulary (drum-kit-design §6).
 *
 * The rule this file exists to enforce, verbatim from §2: "Do not put SD3
 * note numbers in the strike catalog." The domain says `ride-bow`; a
 * resolver downstream decides what that MEANS on a given output —
 *
 *   Sd3MappingProfile (bridge)  → a MIDI note on the active SD3 kit
 *   rendered WAV bank (tablet)  → a pre-rendered one-shot
 *
 * That indirection is what keeps the strike logic independent of the loaded
 * SD3 library, the kit preset, custom remapping, and any future replacement
 * of Superior Drummer entirely. It is also what lets the tablet — the only
 * shipping output — play this kit at all, since SD3 is a desktop plugin.
 *
 * So: no note numbers here, and no filenames either.
 *
 * Pure: no clocks, no randomness, no RN imports.
 */

/** §6, verbatim. The complete set of pieces the kit can sound. */
export type LogicalDrumArticulation =
  | 'ride-bow'
  | 'ride-bell'
  | 'ride-tight'
  | 'snare-center'
  | 'snare-rimshot'
  | 'snare-body'
  | 'rack-tom-high'
  | 'rack-tom-mid'
  | 'floor-tom-high'
  | 'floor-tom-low'
  | 'kick-main'
  | 'kick-sub'
  | 'hihat-closed'
  | 'hihat-open'
  | 'crash-main'
  | 'rim-click'

/** Declared, not derived — render order and audition order both read this. */
export const LOGICAL_DRUM_ARTICULATIONS: readonly LogicalDrumArticulation[] = [
  'ride-bow',
  'ride-bell',
  'ride-tight',
  'snare-center',
  'snare-rimshot',
  'snare-body',
  'rack-tom-high',
  'rack-tom-mid',
  'floor-tom-high',
  'floor-tom-low',
  'kick-main',
  'kick-sub',
  'hihat-closed',
  'hihat-open',
  'crash-main',
  'rim-click',
]

/**
 * Kit groups (§7). Two hits in the same group landing on the same
 * subdivision are a collision to resolve, not a chord to play — a snare
 * center and a rimshot at once is a flam nobody asked for.
 */
export type DrumGroup = 'kick' | 'snare' | 'rack-tom' | 'floor-tom' | 'cymbal' | 'hat' | 'percussion'

export const DRUM_GROUP_OF: Readonly<Record<LogicalDrumArticulation, DrumGroup>> = {
  'ride-bow': 'cymbal',
  'ride-bell': 'cymbal',
  'ride-tight': 'cymbal',
  'snare-center': 'snare',
  'snare-rimshot': 'snare',
  'snare-body': 'snare',
  'rack-tom-high': 'rack-tom',
  'rack-tom-mid': 'rack-tom',
  'floor-tom-high': 'floor-tom',
  'floor-tom-low': 'floor-tom',
  'kick-main': 'kick',
  'kick-sub': 'kick',
  'hihat-closed': 'hat',
  'hihat-open': 'hat',
  'crash-main': 'cymbal',
  'rim-click': 'percussion',
}

/**
 * Which pieces a live PUNCH can reach, and which belong to the generated
 * groove. Not every articulation is triggered by a strike, and that is by
 * design rather than an oversight:
 *
 *   hihat-closed / hihat-open  §4 "generated groove backbone"
 *   ride-tight                 §18 ride density control — the tighter ride
 *                              a jab flurry falls back to
 *   kick-sub                   groove low-end reinforcement (§7 capability)
 *   rim-click                  generated ghost notes and the Free Kit
 *
 * A resolver must still be able to sound all sixteen; only the twelve
 * strike rows are restricted to `PUNCH_REACHABLE`.
 */
export const PUNCH_REACHABLE: readonly LogicalDrumArticulation[] = [
  'ride-bow',
  'ride-bell',
  'snare-center',
  'snare-rimshot',
  'snare-body',
  'rack-tom-high',
  'rack-tom-mid',
  'floor-tom-high',
  'floor-tom-low',
  'kick-main',
  'crash-main',
]

/** Articulations only the generated layer produces. Complement of the above. */
export const GROOVE_ONLY: readonly LogicalDrumArticulation[] = LOGICAL_DRUM_ARTICULATIONS.filter(
  (articulation) => !PUNCH_REACHABLE.includes(articulation),
)
