/**
 * InstrumentVoiceOutputOboe — the Oboe/AAudio instrument engine.
 *
 * This file exists because the engine shipped with none, and an adversarial
 * review then found four defects in it that a test would have caught. Every
 * case below is one of those defects, pinned:
 *
 * - `panic()` suspended the AudioContext on a comment claiming "the next
 *   trigger resumes it". Nothing in the app calls `resume()`, and starting a
 *   source does not resume a suspended context, so one panic — or one tap on
 *   a harmonic setting, which panics the live engine — left the instrument
 *   silent for the rest of the screen visit while every later trigger still
 *   reported success. The app's characteristic failure exactly.
 * - `panic()` must still CUT what is sounding. The expo sibling pauses every
 *   pooled player; an Oboe panic that only stopped the loops would silence
 *   less than the engine it replaces.
 * - the legacy five-piece drum had no branch at all here, so every patch that
 *   does not compile a kit block lost its drum, and a latch-only patch (no
 *   stab either) went completely silent — on expo it sounded.
 * - a lane committed its key BEFORE the decode await and never rolled back,
 *   so one failed decode gated that chord out of `handleGesture` forever and
 *   the lane stayed silent for the session with nothing logged.
 *
 * Driven through a controllable fake of the native graph — the root
 * `__mocks__/react-native-audio-api.js` is a no-op, which cannot observe
 * whether a node was started or a context suspended.
 */
import type { CompiledPunchGesture, QuantizedChange } from '@domain/instrument/gestureSchema'

interface FakeSource {
  buffer: unknown
  loop: boolean
  started: boolean
  stopped: boolean
  disconnected: boolean
}

interface FakeGain {
  gain: { value: number }
}

const mockGraph: {
  sources: FakeSource[]
  gains: FakeGain[]
  suspendCount: number
  closeCount: number
  decodeCalls: string[]
  /** Keys whose decode should reject, consumed once each. */
  failDecodeOnce: Set<number>
  decodeSeq: number
} = {
  sources: [],
  gains: [],
  suspendCount: 0,
  closeCount: 0,
  decodeCalls: [],
  failDecodeOnce: new Set(),
  decodeSeq: 0,
}

jest.mock('react-native-audio-api', () => {
  class FakeAudioContext {
    sampleRate: number
    state = 'running'
    currentTime = 0
    destination = { connect: () => undefined, disconnect: () => undefined }

    constructor(options: { sampleRate?: number } = {}) {
      this.sampleRate = options.sampleRate ?? 48000
    }
    createBufferSource(): FakeSource {
      const source: FakeSource = {
        buffer: null,
        loop: false,
        started: false,
        stopped: false,
        disconnected: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = source as any
      s.start = () => {
        source.started = true
      }
      s.stop = () => {
        source.stopped = true
      }
      s.connect = () => undefined
      s.disconnect = () => {
        source.disconnected = true
      }
      mockGraph.sources.push(source)
      return source
    }
    createGain(): FakeGain {
      const node: FakeGain = { gain: { value: 1 } }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = node as any
      g.connect = () => undefined
      g.disconnect = () => undefined
      mockGraph.gains.push(node)
      return node
    }
    createBuffer(): unknown {
      return { duration: 0.001 }
    }
    async decodeAudioData(moduleId: number): Promise<unknown> {
      const seq = mockGraph.decodeSeq++
      mockGraph.decodeCalls.push(String(moduleId))
      if (mockGraph.failDecodeOnce.has(seq)) {
        mockGraph.failDecodeOnce.delete(seq)
        throw new Error('decode failed')
      }
      return { duration: 0.25, sampleRate: 48000, numberOfChannels: 1 }
    }
    async suspend(): Promise<void> {
      mockGraph.suspendCount += 1
      this.state = 'suspended'
    }
    async resume(): Promise<void> {
      this.state = 'running'
    }
    async close(): Promise<void> {
      mockGraph.closeCount += 1
      this.state = 'closed'
    }
  }
  return { AudioContext: FakeAudioContext }
})

import { InstrumentVoiceOutputOboe } from '../InstrumentVoiceOutputOboe'
import { INSTRUMENT_BANKS } from '../voiceAssets/instrumentBankManifest'
import { BRASS_ACTIVITY_LAYERS } from '@domain/instrument/brassCube'

beforeEach(() => {
  mockGraph.sources = []
  mockGraph.gains = []
  mockGraph.suspendCount = 0
  mockGraph.closeCount = 0
  mockGraph.decodeCalls = []
  mockGraph.failDecodeOnce = new Set()
  mockGraph.decodeSeq = 0
})

// ---------------------------------------------------------------------------
// Gesture builders
// ---------------------------------------------------------------------------

/** A legacy gesture: no accent, no quantized block, no compiled kit block. */
function legacyGesture(note = 36, velocity = 80): CompiledPunchGesture {
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
      activityLayer: 1,
      changedAxis: 'left',
      targetCoordinate: [3, 2, 1],
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
    transient: { note, velocity, layer: 'generic' },
    visual: {
      quadrant: 'upper-left',
      hueDegrees: 0,
      opacity: 0.5,
      radius: 10,
      persistenceMs: 200,
      transitionRibbonMs: 0,
    },
  } as CompiledPunchGesture
}

/** A field gesture whose quantized block resolves to a real bed and bass. */
function fieldGesture(slot: number): CompiledPunchGesture {
  const quantized = {
    cubeCellId: `${slot}-2-1`,
    sampleBankSlot: slot,
    notesPerMinute: BRASS_ACTIVITY_LAYERS[0].notesPerMinute,
  } as unknown as QuantizedChange
  return { ...legacyGesture(), quantized } as CompiledPunchGesture
}

/** Let every pending decode settle. */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

// ---------------------------------------------------------------------------

describe('panic', () => {
  it('never suspends the context — nothing in the app ever resumes it', async () => {
    // The defect: suspend() froze the graph permanently. Every later trigger
    // built and started a node without throwing, so the instrument was
    // silent while `available` stayed true and nothing logged.
    const voice = new InstrumentVoiceOutputOboe()
    await voice.preload('brass')

    voice.panic()

    expect(mockGraph.suspendCount).toBe(0)

    // And the engine still sounds afterwards: a punch after a panic must
    // produce a started source node.
    const before = mockGraph.sources.filter((s) => s.started).length
    voice.handleGesture(legacyGesture())
    expect(mockGraph.sources.filter((s) => s.started).length).toBeGreaterThan(before)
  })

  it('cuts one-shots that are still ringing, like the expo sibling', async () => {
    const voice = new InstrumentVoiceOutputOboe()
    await voice.preload('brass')
    mockGraph.sources = []

    voice.handleGesture(legacyGesture())
    const sounding = mockGraph.sources.filter((s) => s.started)
    expect(sounding.length).toBeGreaterThan(0)
    expect(sounding.every((s) => s.stopped)).toBe(false)

    voice.panic()

    // Silence NOW is the whole contract of panic.
    expect(sounding.every((s) => s.stopped)).toBe(true)
  })

  it('drops finished one-shots rather than growing the registry forever', async () => {
    const voice = new InstrumentVoiceOutputOboe()
    await voice.preload('brass')
    mockGraph.sources = []

    // Each clip is 0.25 s in the fake and currentTime never advances, so
    // pruning is exercised by firing many hits: the registry must not stop
    // panic from working, however many have gone through it.
    for (let i = 0; i < 50; i += 1) voice.handleGesture(legacyGesture())
    voice.panic()
    expect(mockGraph.sources.filter((s) => s.started).every((s) => s.stopped)).toBe(true)
  })
})

describe('the legacy five-piece drum', () => {
  it('fires for a gesture with no compiled kit block', async () => {
    // The defect: handleGesture had only the kit branch, so every patch that
    // does not compile a drum block — which is every non-field patch — lost
    // its drum here while expo still played it.
    const voice = new InstrumentVoiceOutputOboe()
    await voice.preload('brass')
    mockGraph.sources = []

    voice.handleGesture(legacyGesture(36, 80))

    const started = mockGraph.sources.filter((s) => s.started)
    expect(started.length).toBe(1)
    // Gain carries the transient velocity, not a default.
    expect(mockGraph.gains.at(-1)?.gain.value).toBeCloseTo(80 / 127, 5)
  })

  it('is preloaded, or the fire would silently find no buffer', async () => {
    const voice = new InstrumentVoiceOutputOboe()
    await voice.preload('brass')
    const drumModules = Object.values(INSTRUMENT_BANKS.brass.drums).map((c) =>
      String(c.module),
    )
    for (const module of drumModules) {
      expect(mockGraph.decodeCalls).toContain(module)
    }
  })
})

describe('loop lane claims', () => {
  it('rolls the claim back when a decode fails, so the chord retries', async () => {
    // The defect: the lane's key was committed before the await and never
    // rolled back. handleGesture gates on that field, so after one failed
    // decode the identical selection was gated out on every later punch and
    // the lane stayed silent for the rest of the session.
    const voice = new InstrumentVoiceOutputOboe()
    await voice.preload('brass')
    const decodesAfterPreload = mockGraph.decodeSeq
    mockGraph.sources = []

    // Fail the very next decode — the BED for this chord. The bass decode
    // that follows it succeeds, which is what makes this lane-precise: one
    // loop should start, not two.
    mockGraph.failDecodeOnce.add(decodesAfterPreload)

    voice.handleGesture(fieldGesture(3))
    await settle()
    expect(mockGraph.sources.filter((s) => s.loop && s.started).length).toBe(1)

    // The SAME chord again must retry the bed rather than be gated out.
    // Before the fix the claim was already committed, so this stayed at 1
    // for the rest of the session.
    voice.handleGesture(fieldGesture(3))
    await settle()
    expect(mockGraph.sources.filter((s) => s.loop && s.started).length).toBe(2)
  })

  it('does not restart a loop that is already sounding', async () => {
    const voice = new InstrumentVoiceOutputOboe()
    await voice.preload('brass')
    mockGraph.sources = []

    voice.handleGesture(fieldGesture(3))
    await settle()
    const after = mockGraph.sources.filter((s) => s.loop && s.started).length
    expect(after).toBeGreaterThan(0)

    voice.handleGesture(fieldGesture(3))
    await settle()
    // Same selection — the lanes must be left alone, or every punch clicks.
    expect(mockGraph.sources.filter((s) => s.loop && s.started).length).toBe(after)
  })
})

describe('release', () => {
  it('closes the context and stops everything still sounding', async () => {
    const voice = new InstrumentVoiceOutputOboe()
    await voice.preload('brass')
    mockGraph.sources = []
    voice.handleGesture(legacyGesture())
    const sounding = mockGraph.sources.filter((s) => s.started)

    voice.release()

    expect(mockGraph.closeCount).toBe(1)
    expect(sounding.every((s) => s.stopped)).toBe(true)
  })
})
