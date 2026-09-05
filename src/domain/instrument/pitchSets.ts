/**
 * The pitch-set bank (note-cube-design §3). A pitch set is six offsets
 * from a selectable root — what notes EXIST. How the two hands reach them
 * is the topology's business, and what the sound does is the patch
 * matrix's; keeping those separate is the Note Cube's governing rule.
 *
 * Offsets are stored in CENTS (semitone × 100) so microtonal sets need no
 * schema change later. All launch sets are 12-TET multiples of 100.
 */

export type PitchSetCategory =
  | 'friendly'
  | 'blues'
  | 'modal'
  | 'power'
  | 'experimental'
  | 'custom'

export interface PitchSetDefinition {
  id: string
  name: string
  /** Six ascending offsets from the root, in cents. */
  offsetsCents: readonly [number, number, number, number, number, number]
  category: PitchSetCategory
  recommendedHarmony: 'free' | 'soft-guard' | 'consonant'
  supportsChromaticTopology: boolean
}

const semis = (
  offsets: readonly [number, number, number, number, number, number],
): [number, number, number, number, number, number] =>
  offsets.map((s) => s * 100) as [number, number, number, number, number, number]

/** Launch bank (note-cube-design §15). Minor Pentatonic is the default. */
export const PITCH_SETS: readonly PitchSetDefinition[] = [
  {
    id: 'minor-pentatonic',
    name: 'Minor Pentatonic',
    offsetsCents: semis([0, 3, 5, 7, 10, 12]),
    category: 'friendly',
    recommendedHarmony: 'free',
    supportsChromaticTopology: false,
  },
  {
    id: 'major-pentatonic',
    name: 'Major Pentatonic',
    offsetsCents: semis([0, 2, 4, 7, 9, 12]),
    category: 'friendly',
    recommendedHarmony: 'free',
    supportsChromaticTopology: false,
  },
  {
    id: 'minor-blues',
    name: 'Minor Blues',
    offsetsCents: semis([0, 3, 5, 6, 7, 10]),
    category: 'blues',
    recommendedHarmony: 'soft-guard',
    supportsChromaticTopology: false,
  },
  {
    id: 'dorian-six',
    name: 'Dorian',
    offsetsCents: semis([0, 2, 3, 5, 7, 9]),
    category: 'modal',
    recommendedHarmony: 'soft-guard',
    supportsChromaticTopology: false,
  },
  {
    id: 'mixolydian-six',
    name: 'Mixolydian',
    offsetsCents: semis([0, 2, 4, 5, 7, 10]),
    category: 'modal',
    recommendedHarmony: 'soft-guard',
    supportsChromaticTopology: false,
  },
  {
    id: 'power-lattice',
    name: 'Power Lattice',
    offsetsCents: semis([0, 5, 7, 12, 17, 19]),
    category: 'power',
    recommendedHarmony: 'consonant',
    supportsChromaticTopology: false,
  },
]

export const DEFAULT_PITCH_SET_ID = 'minor-pentatonic'

export function pitchSetById(id: string): PitchSetDefinition {
  const found = PITCH_SETS.find((s) => s.id === id)
  if (!found) throw new Error(`unknown pitch set "${id}"`)
  return found
}
