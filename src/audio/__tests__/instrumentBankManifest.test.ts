/**
 * Generated instrument bank manifest — completeness against the COMPILED
 * domain (M40-15 #319, spec §9).
 *
 * The bank is only correct relative to what `compileBrassCube` can ask
 * for: every reachable chord × layer bed, every left-zone bass, and a stab
 * for every note an accent can ever carry (`startMidiNote` over all 36
 * cells — the accent is always `rotatedPool[0]`). These tests recompute
 * that demand from the shipped domain and hold the generated manifest to
 * it, so a domain edit that widens the pool set fails HERE rather than as
 * a silent missing note on the tablet.
 *
 * Under jest every wav module flattens to `1` (the asset transformer), so
 * the drums-are-shared dedupe is asserted against the generated SOURCE —
 * the require paths themselves — not the module values.
 */
import { readFileSync } from 'node:fs'

import { BRASS_ACTIVITY_LAYERS, compileBrassCube } from '@domain/instrument/brassCube'
import { launchPatchById } from '@domain/instrument/punchPatch'

import { bassKey, bedKey, INSTRUMENT_DRUM_KEYS, stabKey } from '../instrumentBankKeys'
import {
  INSTRUMENT_BANKS,
  INSTRUMENT_TEXTURE_IDS,
} from '../voiceAssets/instrumentBankManifest'

const LAUNCH_MAP = compileBrassCube(launchPatchById('dorian-brass-cube'))

/** The accent-reachable notes: startMidiNote over all 36 compiled cells. */
const STAB_UNION = [...new Set(LAUNCH_MAP.cells.map((cell) => cell.startMidiNote))].sort(
  (a, b) => a - b,
)

const ZONES = [0, 1, 2, 3, 4, 5] as const

describe('texture registry', () => {
  it('ships exactly the two launch textures, banks keyed to match', () => {
    expect(INSTRUMENT_TEXTURE_IDS).toEqual(['brass', 'pluck'])
    expect(Object.keys(INSTRUMENT_BANKS).sort()).toEqual([...INSTRUMENT_TEXTURE_IDS].sort())
    for (const id of INSTRUMENT_TEXTURE_IDS) {
      expect(INSTRUMENT_BANKS[id].textureId).toBe(id)
    }
  })
})

describe.each(INSTRUMENT_TEXTURE_IDS)('bank completeness — %s', (textureId) => {
  const bank = INSTRUMENT_BANKS[textureId]

  it('holds a bed for every chord × activity layer', () => {
    const expected = ZONES.flatMap((zone) =>
      BRASS_ACTIVITY_LAYERS.map((l) => bedKey(zone, l.layer)),
    ).sort()
    expect(Object.keys(bank.beds).sort()).toEqual(expected)
  })

  it('holds a bass for every left zone', () => {
    expect(Object.keys(bank.basses).sort()).toEqual(ZONES.map((z) => bassKey(z)).sort())
  })

  it('holds a stab for exactly the accent-reachable note union', () => {
    expect(Object.keys(bank.stabs).sort()).toEqual(STAB_UNION.map((n) => stabKey(n)).sort())
    // The verified launch golden — 18 notes (spec §2). If the domain's
    // pools change, the render tool must be re-run; this line names it.
    expect(STAB_UNION).toHaveLength(18)
  })

  it('holds every drum one-shot (kick, snare, rim, tom, crash)', () => {
    expect(Object.keys(bank.drums).sort()).toEqual([...INSTRUMENT_DRUM_KEYS].sort())
  })

  it('bed loop lengths are the ladder loop math, sample-exact', () => {
    for (const layer of BRASS_ACTIVITY_LAYERS) {
      const stepSamples = (48_000 * 60) / layer.notesPerMinute
      expect(Number.isInteger(stepSamples)).toBe(true)
      const expectedMs = Math.round((layer.patternDepth * stepSamples) / 48)
      for (const zone of ZONES) {
        expect(bank.beds[bedKey(zone, layer.layer)]!.durationMs).toBe(expectedMs)
      }
    }
  })

  it('every clip has a positive integer duration', () => {
    const clips = [
      ...Object.values(bank.beds),
      ...Object.values(bank.basses),
      ...Object.values(bank.stabs),
      ...Object.values(bank.drums),
    ]
    expect(clips).toHaveLength(24 + 6 + STAB_UNION.length + INSTRUMENT_DRUM_KEYS.length)
    for (const clip of clips) {
      expect(Number.isInteger(clip.durationMs)).toBe(true)
      expect(clip.durationMs).toBeGreaterThan(0)
    }
  })
})

describe('drums are consciously deduped to shared modules', () => {
  it('every drum require in the generated source points at instrument/shared/', () => {
    // Read from the repo root rather than __dirname so this stays a plain
    // path under jest's cwd (the house pattern, see live.test.tsx).
    const source = readFileSync('src/audio/voiceAssets/instrumentBankManifest.ts', 'utf8')
    const drumRequires = source.match(/require\('[^']*drum-[^']*\.wav'\)/g) ?? []
    // One require per drum per texture bank — all aimed at shared/.
    expect(drumRequires).toHaveLength(INSTRUMENT_TEXTURE_IDS.length * INSTRUMENT_DRUM_KEYS.length)
    for (const line of drumRequires) {
      expect(line).toContain('/assets/audio/instrument/shared/drum-')
    }
  })
})
