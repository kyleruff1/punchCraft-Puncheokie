/**
 * Per-cell stab-role resolution (M40-28, Kyle's revised stab-role model).
 *
 * The old model hardcoded "cross always takes pool index 2, hook always
 * takes index 3". That is wrong for two reasons: a pool may place
 * equivalent roles in different octaves, and — more importantly — the
 * RIGHT hand chooses the entry tone, so the jab's note may itself already
 * be the fifth, a colour tone, or the upper anchor. Hardcoded indices then
 * collide and two families sound the same pitch.
 *
 * Policy (Kyle's ruling): **preserve the entry selection.** The jab always
 * plays the cell's selected entry tone — that is the boxer's direct
 * control over the cube — and every other family moves around it.
 *
 * Resolution happens at FIELD COMPILE time, once per cell; the runtime
 * simply reads the resolved note. That makes perceptual separation a
 * compile-time property with a report, rather than a runtime fallback
 * chain that might or might not fire.
 *
 * The compiler does NOT promise a distinct MIDI note for every family in
 * every voicing — a six-tone pool cannot always supply six separated
 * notes. It promises to TRY, and to report every collision it could not
 * avoid so the instrument can lean on another brass-domain difference
 * (gate, filter arc, pan trajectory) rather than on the drums.
 */

/** Named slots of a NATURAL pool, matching harmonicField's UNIFORM_ROLES. */
export type PoolRoleName = 'root' | 'third' | 'fifth' | 'color' | 'extension' | 'upper-anchor'

const ROLE_SLOT: Readonly<Record<PoolRoleName, number>> = {
  root: 0,
  third: 1,
  fifth: 2,
  color: 3,
  extension: 4,
  'upper-anchor': 5,
}

/** The six family-and-hand voices that need a distinct stab pitch. */
export type StabFamilyVoice =
  | 'jab'
  | 'cross'
  | 'leadHook'
  | 'rearHook'
  | 'leadUppercut'
  | 'rearUppercut'

/**
 * Candidate roles in preference order (Kyle's table). The resolver walks
 * these and takes the first that is still perceptually free.
 */
export const ROLE_CANDIDATES: Readonly<Record<Exclude<StabFamilyVoice, 'jab'>, readonly PoolRoleName[]>> = {
  cross: ['fifth', 'upper-anchor', 'root'],
  leadHook: ['third', 'color', 'extension'],
  rearHook: ['color', 'extension', 'third'],
  leadUppercut: ['extension', 'upper-anchor', 'fifth'],
  rearUppercut: ['upper-anchor', 'extension', 'root'],
}

/** Resolution order matters: earlier voices claim their preferred tone. */
const RESOLUTION_ORDER: readonly Exclude<StabFamilyVoice, 'jab'>[] = [
  'cross',
  'leadHook',
  'rearHook',
  'leadUppercut',
  'rearUppercut',
]

export interface ResolvedStabRoles {
  jabNote: number
  crossNote: number
  leadHookNote: number
  rearHookNote: number
  leadUppercutNote: number
  rearUppercutNote: number
}

export interface StabCollision {
  firstVoice: StabFamilyVoice
  secondVoice: StabFamilyVoice
  midiNote: number
}

export interface StabDistinctnessReport {
  cellId: string
  collisions: readonly StabCollision[]
}

/**
 * Voices whose targets should normally be ordered in register: an
 * uppercut reaches ABOVE the hook it follows, which is what makes the
 * rising identity legible even when both land on colour tones.
 */
function registerPenalty(voice: Exclude<StabFamilyVoice, 'jab'>, note: number, chosen: Partial<Record<StabFamilyVoice, number>>): number {
  if (voice === 'leadUppercut' && chosen.leadHook !== undefined && note <= chosen.leadHook) return 40
  if (voice === 'rearUppercut' && chosen.rearHook !== undefined && note <= chosen.rearHook) return 40
  return 0
}

/**
 * Resolve one cell's six stab notes. Deterministic: the same pool and
 * entry tone always produce the same assignment, which is what lets the
 * result be compiled into the field and covered by its hash.
 */
export function resolveStabRoles(
  naturalPool: readonly number[],
  entryTone: number,
): ResolvedStabRoles {
  const chosen: Partial<Record<StabFamilyVoice, number>> = { jab: entryTone }
  const taken = new Set<number>([entryTone])

  for (const voice of RESOLUTION_ORDER) {
    const candidates = ROLE_CANDIDATES[voice]
    let best: { note: number; score: number } | null = null
    candidates.forEach((role, rank) => {
      const note = naturalPool[ROLE_SLOT[role]]
      if (note === undefined) return
      // Preference order is the base cost; a note already spoken for by
      // another family is heavily penalised but never forbidden — a small
      // pool may leave no alternative.
      let score = rank * 4
      if (taken.has(note)) score += 100
      score += registerPenalty(voice, note, chosen)
      // Separation from the jab is the one the ear notices most, because
      // the jab is the reference the boxer just selected.
      if (note === entryTone) score += 60
      if (best === null || score < best.score) best = { note, score }
    })
    const pick = (best as { note: number; score: number } | null)?.note ?? entryTone
    chosen[voice] = pick
    taken.add(pick)
  }

  return {
    jabNote: entryTone,
    crossNote: chosen.cross ?? entryTone,
    leadHookNote: chosen.leadHook ?? entryTone,
    rearHookNote: chosen.rearHook ?? entryTone,
    leadUppercutNote: chosen.leadUppercut ?? entryTone,
    rearUppercutNote: chosen.rearUppercut ?? entryTone,
  }
}

const ALL_VOICES: readonly StabFamilyVoice[] = [
  'jab',
  'cross',
  'leadHook',
  'rearHook',
  'leadUppercut',
  'rearUppercut',
]

export function noteForVoice(roles: ResolvedStabRoles, voice: StabFamilyVoice): number {
  switch (voice) {
    case 'jab':
      return roles.jabNote
    case 'cross':
      return roles.crossNote
    case 'leadHook':
      return roles.leadHookNote
    case 'rearHook':
      return roles.rearHookNote
    case 'leadUppercut':
      return roles.leadUppercutNote
    case 'rearUppercut':
      return roles.rearUppercutNote
  }
}

/**
 * Which voices had to share a note. Reported at compile time so a pool
 * that cannot separate six families is visible rather than silently
 * relying on the drum channel to carry the difference.
 */
export function reportStabDistinctness(
  cellId: string,
  roles: ResolvedStabRoles,
): StabDistinctnessReport {
  const collisions: StabCollision[] = []
  for (let a = 0; a < ALL_VOICES.length; a += 1) {
    for (let b = a + 1; b < ALL_VOICES.length; b += 1) {
      const first = ALL_VOICES[a]!
      const second = ALL_VOICES[b]!
      const note = noteForVoice(roles, first)
      if (note === noteForVoice(roles, second)) {
        collisions.push({ firstVoice: first, secondVoice: second, midiNote: note })
      }
    }
  }
  return { cellId, collisions }
}
