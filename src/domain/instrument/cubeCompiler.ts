/**
 * Compile a PunchPatch into the CompiledCubeMap — the single mapping every
 * consumer shares (note-cube-design §8). Topology assignment and harmony
 * resolution happen HERE, at compile time; playback only looks cells up.
 *
 * Pure and deterministic: same patch → byte-identical map, and
 * patchHash = mapHashOf(patch) rides on every wire message so the tablet
 * and the bridge can prove they agree.
 */
import { mapHashOf } from './gestureSchema'
import { pitchSetById } from './pitchSets'
import { SOFT_GUARD_ALLOWED, type PunchPatch } from './punchPatch'

export interface CompiledCubeCell {
  x: number
  y: number
  leftMidiNote: number
  rightMidiNote: number
  intervalSemitones: number
  /** Pitch-class interval 0..11 of (right − left). */
  intervalClass: number
  /** 0 (consonant) .. 1 (harsh); from the interval-class table. */
  tension: number
  /** True when harmony policy moved the right note off its request. */
  harmonyAdjusted: boolean
  /** e.g. "G2 · A4". */
  label: string
  /** Hue for the cell, from the right-hand zone's scale color. */
  colorHue: number
}

export interface CompiledEnergyLayer {
  z: 0 | 1 | 2 | 3
  modulationMultiplier: number
  harmonicLayer: 'none' | 'fifth' | 'octave' | 'shimmer'
}

export interface CompiledCubeMap {
  schemaVersion: 1
  patchId: string
  patchHash: string
  zoneCount: number
  /** Row-major: cells[x * zoneCount + y]. */
  cells: readonly CompiledCubeCell[]
  energyLayers: readonly CompiledEnergyLayer[]
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const

/** Zone hues per instrument-design §16 (deep cyan → white-gold). */
const ZONE_HUES = [190, 220, 270, 300, 45, 50] as const

/** Tension per pitch-class interval (0..11) — deterministic, editable. */
const TENSION_BY_CLASS: readonly number[] = [
  0, 0.8, 0.55, 0.25, 0.25, 0.15, 0.9, 0.1, 0.35, 0.3, 0.45, 0.7,
]

/** Bass set for the bass-lead topology: root 4th 5th oct oct+4 oct+5. */
const BASS_LEAD_OFFSETS_CENTS = [0, 500, 700, 1200, 1700, 1900] as const

/** Interval zones for root-interval: unison m3 M3 P4 P5 octave. */
const ROOT_INTERVAL_OFFSETS_CENTS = [0, 300, 400, 500, 700, 1200] as const

export function midiNoteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

/** C4 = 60 convention: pitch class + scientific octave → MIDI note. */
function baseMidi(rootPitchClass: number, octave: number): number {
  return 12 * (octave + 1) + rootPitchClass
}

/**
 * Pick zoneCount offsets from a six-entry set, spanning first..last so a
 * 4- or 5-zone patch keeps the set's full range (Easy/Standard modes).
 */
function offsetsForZones(offsetsCents: readonly number[], zoneCount: number): number[] {
  if (zoneCount >= offsetsCents.length) return [...offsetsCents]
  const picked: number[] = []
  for (let i = 0; i < zoneCount; i += 1) {
    const idx = Math.round((i * (offsetsCents.length - 1)) / (zoneCount - 1))
    picked.push(offsetsCents[idx] ?? 0)
  }
  return picked
}

function centsToSemis(cents: number): number {
  return Math.round(cents / 100)
}

interface HandMaps {
  /** MIDI note per left zone. */
  left: number[]
  /**
   * MIDI note per (leftZone, rightZone) — right can depend on left under
   * root-interval; other topologies ignore the left index.
   */
  rightFor(leftZone: number, rightZone: number): number
}

function buildHandMaps(patch: PunchPatch): HandMaps {
  const set = pitchSetById(patch.pitchSetId)
  const zones = patch.zoneCount
  const leftBase = baseMidi(patch.rootPitchClass, patch.leftVoice.baseOctave)
  const rightBase = baseMidi(patch.rootPitchClass, patch.rightVoice.baseOctave)

  const orient = (offsets: number[], direction: 'ascending' | 'descending'): number[] =>
    direction === 'descending' ? [...offsets].reverse() : offsets

  const scaleOffsets = offsetsForZones(set.offsetsCents, zones)

  switch (patch.topologyId) {
    case 'parallel': {
      const left = orient(scaleOffsets, patch.leftVoice.direction).map(
        (c) => leftBase + centsToSemis(c),
      )
      const right = orient(scaleOffsets, patch.rightVoice.direction).map(
        (c) => rightBase + centsToSemis(c),
      )
      return { left, rightFor: (_l, r) => right[r] ?? rightBase }
    }
    case 'bass-lead': {
      const bass = orient(offsetsForZones(BASS_LEAD_OFFSETS_CENTS, zones), patch.leftVoice.direction)
      const left = bass.map((c) => leftBase + centsToSemis(c))
      const right = orient(scaleOffsets, patch.rightVoice.direction).map(
        (c) => rightBase + centsToSemis(c),
      )
      return { left, rightFor: (_l, r) => right[r] ?? rightBase }
    }
    case 'root-interval': {
      const left = orient(scaleOffsets, patch.leftVoice.direction).map(
        (c) => leftBase + centsToSemis(c),
      )
      const intervals = orient(
        offsetsForZones(ROOT_INTERVAL_OFFSETS_CENTS, zones),
        patch.rightVoice.direction,
      )
      // Right rides the CURRENT left note, lifted to the right voice's
      // register (the octave gap between the two base octaves).
      const registerLift = rightBase - leftBase
      return {
        left,
        rightFor: (l, r) => (left[l] ?? leftBase) + registerLift + centsToSemis(intervals[r] ?? 0),
      }
    }
  }
}

function pcInterval(left: number, right: number): number {
  return (((right - left) % 12) + 12) % 12
}

/**
 * Soft Guard: when the pitch-class interval is disallowed, move the RIGHT
 * note to the nearest allowed pitch (searching outward by semitone, upward
 * first on ties) — the changed voice resolves, the anchor holds (§6).
 */
function resolveSoftGuard(
  left: number,
  right: number,
  allowed: readonly number[],
): { note: number; adjusted: boolean } {
  if (allowed.includes(pcInterval(left, right))) return { note: right, adjusted: false }
  for (let step = 1; step <= 6; step += 1) {
    if (allowed.includes(pcInterval(left, right + step))) return { note: right + step, adjusted: true }
    if (allowed.includes(pcInterval(left, right - step))) return { note: right - step, adjusted: true }
  }
  return { note: right, adjusted: false }
}

export function compilePunchPatch(patch: PunchPatch): CompiledCubeMap {
  const maps = buildHandMaps(patch)
  const zones = patch.zoneCount
  const allowed = patch.harmony.allowedIntervalClasses ?? SOFT_GUARD_ALLOWED
  const cells: CompiledCubeCell[] = []

  for (let x = 0; x < zones; x += 1) {
    for (let y = 0; y < zones; y += 1) {
      const leftNote = maps.left[x] ?? 0
      let rightNote = maps.rightFor(x, y)
      let adjusted = false

      if (patch.harmony.mode === 'interval-lock') {
        const lock = patch.harmony.lockIntervalSemitones ?? 7
        const lifted = leftNote + lock
        adjusted = rightNote !== lifted
        rightNote = lifted
      } else if (patch.harmony.mode === 'soft-guard') {
        const resolved = resolveSoftGuard(leftNote, rightNote, allowed)
        rightNote = resolved.note
        adjusted = resolved.adjusted
      }

      const klass = pcInterval(leftNote, rightNote)
      cells.push({
        x,
        y,
        leftMidiNote: leftNote,
        rightMidiNote: rightNote,
        intervalSemitones: rightNote - leftNote,
        intervalClass: klass,
        tension: TENSION_BY_CLASS[klass] ?? 0.5,
        harmonyAdjusted: adjusted,
        label: `${midiNoteName(leftNote)} · ${midiNoteName(rightNote)}`,
        colorHue: ZONE_HUES[Math.min(y, ZONE_HUES.length - 1)] ?? 0,
      })
    }
  }

  return {
    schemaVersion: 1,
    patchId: patch.id,
    patchHash: mapHashOf(patch),
    zoneCount: zones,
    cells,
    energyLayers: [
      { z: 0, modulationMultiplier: 0.05, harmonicLayer: 'none' },
      { z: 1, modulationMultiplier: 0.2, harmonicLayer: 'none' },
      { z: 2, modulationMultiplier: 0.45, harmonicLayer: 'fifth' },
      { z: 3, modulationMultiplier: 0.75, harmonicLayer: 'shimmer' },
    ],
  }
}

export function cellAt(map: CompiledCubeMap, x: number, y: number): CompiledCubeCell {
  const clampedX = Math.max(0, Math.min(map.zoneCount - 1, x))
  const clampedY = Math.max(0, Math.min(map.zoneCount - 1, y))
  const cell = map.cells[clampedX * map.zoneCount + clampedY]
  if (!cell) throw new Error(`cube cell (${clampedX},${clampedY}) missing`)
  return cell
}
