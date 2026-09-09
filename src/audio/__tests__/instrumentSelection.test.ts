/**
 * Pure sample selection for the tablet instrument voice (M40-15 #319).
 *
 * The behaviours worth guarding are the routing rules with a
 * wrong-but-plausible alternative:
 *
 * - the layer comes from `BRASS_ACTIVITY_LAYERS` looked up by
 *   notesPerMinute, so a ladder edit re-routes the beds — a hardcoded
 *   npm→layer map here would silently diverge from the domain.
 * - a malformed cubeCellId yields NO bed/bass rather than a wrong chord.
 * - a legacy gesture (no accent/quantized) still selects a drum — the
 *   tablet plays punch one-shots and leaves any sounding loops alone.
 *
 * No expo imports anywhere in the import graph — this suite runs under
 * plain jest/node (R4).
 */
import type {
  CompiledPunchGesture,
  ImmediateAccent,
  QuantizedChange,
} from '@domain/instrument/gestureSchema'

import { selectInstrumentSamples } from '../instrumentSelection'
import type { InstrumentTextureId } from '../voiceAssets/instrumentBankManifest'

const BOTH_TEXTURES: readonly InstrumentTextureId[] = ['brass', 'pluck']

function accent(overrides: Partial<ImmediateAccent> = {}): ImmediateAccent {
  return { midiNote: 57, midiVelocity: 100, channel: 4, gateMs: 120, ...overrides }
}

function quantized(overrides: Partial<QuantizedChange> = {}): QuantizedChange {
  return {
    cubeCellId: 'L3R2',
    chordName: 'Am11',
    bassMidiNote: 33,
    bassChannel: 2,
    chordMidiNotes: [64, 67, 74, 81, 57, 60],
    arpStartIndex: 2,
    arpPattern: [0, 2, 1, 3, 2, 4, 3, 5],
    arpChannel: 3,
    notesPerMinute: 180,
    gateRatio: 0.55,
    patternDepth: 6,
    activityLayer: 2,
    activityPps: 3,
    retrigger: 'quantized-rotate',
    backend: 'punchbridge-tick',
    ...overrides,
  }
}

function gesture(blocks: {
  accent?: ImmediateAccent
  quantized?: QuantizedChange
  transientNote?: number
  transientVelocity?: number
}): CompiledPunchGesture {
  return {
    schemaVersion: 1,
    sessionId: 'test',
    eventId: 'e1',
    mapHash: 'deadbeef',
    source: {
      hand: 'left',
      receivedMonotonicTimeMs: 1_000,
      velocity01: 0.5,
      acceleration01: 0.5,
      punchRate01: 0.2,
      gapSincePreviousPunchMs: 500,
      alternating: false,
    },
    cube: {
      leftZone: 3,
      rightZone: 2,
      activityLayer: 2,
      changedAxis: 'left',
      targetCoordinate: [3, 2, 2],
    },
    voice: {
      voiceId: 'left',
      midiChannel: 1,
      targetNote: 57,
      noteVelocity: 90,
      brightness: 0.5,
      expression: 0.5,
      transition: 'attack',
      transitionDurationMs: 0,
      pitchOvershootCents: 0,
    },
    transient: {
      note: blocks.transientNote ?? 36,
      velocity: blocks.transientVelocity ?? 100,
      layer: 'generic',
    },
    visual: {
      quadrant: 'upper-left',
      hueDegrees: 0,
      opacity: 0.5,
      radius: 10,
      persistenceMs: 200,
      transitionRibbonMs: 0,
    },
    ...(blocks.accent ? { accent: blocks.accent } : {}),
    ...(blocks.quantized ? { quantized: blocks.quantized } : {}),
  }
}

describe('selectInstrumentSamples — full brass gesture (goldens, both textures)', () => {
  it.each(BOTH_TEXTURES)('routes chord × layer × stab × drum for %s', (texture) => {
    const sel = selectInstrumentSamples(
      gesture({ accent: accent(), quantized: quantized() }),
      texture,
    )
    expect(sel).toEqual({
      textureId: texture,
      bed: 'bed-L3-A2',
      bass: 'bass-L3',
      stab: 'stab-57',
      stabGain: 100 / 127,
      drum: 'kick',
      drumGain: 100 / 127,
    })
  })

  it('maps every ladder notesPerMinute to its layer (never a hardcoded map)', () => {
    const cases: Array<[QuantizedChange['notesPerMinute'], string]> = [
      [60, 'bed-L0-A0'],
      [120, 'bed-L0-A1'],
      [180, 'bed-L0-A2'],
      [240, 'bed-L0-A3'],
    ]
    for (const [npm, expected] of cases) {
      const sel = selectInstrumentSamples(
        gesture({ quantized: quantized({ cubeCellId: 'L0R0', notesPerMinute: npm }) }),
        'brass',
      )
      expect(sel.bed).toBe(expected)
      expect(sel.bass).toBe('bass-L0')
    }
  })
})

describe('degraded inputs never pick a wrong chord', () => {
  it.each(['L6R0', 'L0R6', 'l0r0', 'L0R', 'X', ''])(
    'malformed cubeCellId %j → bed and bass null, stab untouched',
    (cellId) => {
      const sel = selectInstrumentSamples(
        gesture({ accent: accent(), quantized: quantized({ cubeCellId: cellId }) }),
        'brass',
      )
      expect(sel.bed).toBeNull()
      expect(sel.bass).toBeNull()
      expect(sel.stab).toBe('stab-57')
    },
  )

  it('a notesPerMinute outside the ladder drops the bed but keeps the bass', () => {
    const sel = selectInstrumentSamples(
      gesture({ quantized: quantized({ notesPerMinute: 90 as never }) }),
      'brass',
    )
    expect(sel.bed).toBeNull()
    expect(sel.bass).toBe('bass-L3')
  })
})

describe('legacy gestures (no accent/quantized blocks)', () => {
  it.each(BOTH_TEXTURES)('selects only a drum under %s', (texture) => {
    const sel = selectInstrumentSamples(gesture({}), texture)
    expect(sel).toEqual({
      textureId: texture,
      bed: null,
      bass: null,
      stab: null,
      stabGain: 0,
      drum: 'kick',
      drumGain: 100 / 127,
    })
  })
})

describe('drum routing and gain clamping', () => {
  it('maps the forward drum slots and falls back to kick for unmapped notes', () => {
    expect(selectInstrumentSamples(gesture({ transientNote: 36 }), 'brass').drum).toBe('kick')
    expect(selectInstrumentSamples(gesture({ transientNote: 37 }), 'brass').drum).toBe('rim')
    expect(selectInstrumentSamples(gesture({ transientNote: 38 }), 'brass').drum).toBe('snare')
    expect(selectInstrumentSamples(gesture({ transientNote: 49 }), 'brass').drum).toBe('crash')
    expect(selectInstrumentSamples(gesture({ transientNote: 40 }), 'brass').drum).toBe('kick')
  })

  it('clamps gains into [0, 1]', () => {
    const loud = selectInstrumentSamples(
      gesture({ accent: accent({ midiVelocity: 500 }), transientVelocity: 500 }),
      'brass',
    )
    expect(loud.stabGain).toBe(1)
    expect(loud.drumGain).toBe(1)

    const negative = selectInstrumentSamples(
      gesture({ accent: accent({ midiVelocity: -5 }), transientVelocity: -5 }),
      'brass',
    )
    expect(negative.stabGain).toBe(0)
    expect(negative.drumGain).toBe(0)
  })
})

describe("voice mode — 'notes' suppresses the sustained material", () => {
  it("keeps the stab + drum but returns no bed/bass in 'notes' mode", () => {
    const sel = selectInstrumentSamples(
      gesture({ accent: accent(), quantized: quantized() }),
      'brass',
      'notes',
    )
    expect(sel).toEqual({
      textureId: 'brass',
      bed: null,
      bass: null,
      stab: 'stab-57',
      stabGain: 100 / 127,
      drum: 'kick',
      drumGain: 100 / 127,
    })
  })

  it("defaults to 'arp' when the mode argument is omitted", () => {
    const sel = selectInstrumentSamples(gesture({ accent: accent(), quantized: quantized() }), 'brass')
    expect(sel.bed).toBe('bed-L3-A2')
    expect(sel.bass).toBe('bass-L3')
  })
})
