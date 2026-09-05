/**
 * Translate the semantic wire objects into MIDI, holding the per-voice
 * latch so a new note releases the old one and a disconnect never leaves
 * a stuck note (instrument-design §8, §23).
 *
 * P4 upgrade: glide/elastic transitions render as 14-bit pitch-bend ramps
 * over the gesture's own transitionDurationMs (bendRamp.ts is the pure
 * math), and the gesture's brightness/expression land on the CCs the
 * active InstrumentProfile names. The scheduler is injectable so tests
 * drive ramps without real timers.
 */
import type { CompiledPunchGesture, VoiceId } from '../../../src/domain/instrument/gestureSchema'
import { bendRampPoints, PITCH_BEND_CENTER } from './bendRamp'
import { profileById, type InstrumentProfile } from './instrumentProfiles'
import {
  controlChange,
  noteOff,
  noteOn,
  pitchBend,
  type MidiOutputBackend,
} from './midiBackend'

/** Default channels (0-based on the wire): left=1→ch2, right=2→ch3 doc-numbered. */
export const LEFT_CHANNEL = 1
export const RIGHT_CHANNEL = 2

/** A comfortable test-note pitch per voice (D3 / D5 of the pentatonic). */
export const TEST_NOTE: Record<VoiceId, number> = { left: 50, right: 74 }

/** Bend-wheel update cadence during a ramp. */
export const RAMP_STEP_MS = 5

export interface RampScheduler {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

const realScheduler: RampScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as Parameters<typeof clearInterval>[0]),
}

interface LatchedVoice {
  channel: number
  note: number
}

export class VoiceRenderer {
  private readonly active = new Map<VoiceId, LatchedVoice>()
  private readonly ramps = new Map<VoiceId, unknown>()
  private readonly profile: InstrumentProfile
  private readonly scheduler: RampScheduler

  constructor(
    private readonly midi: MidiOutputBackend,
    profile: InstrumentProfile | string = 'studio-one-stock',
    scheduler: RampScheduler = realScheduler,
  ) {
    this.profile = typeof profile === 'string' ? profileById(profile) : profile
    this.scheduler = scheduler
  }

  /** Sound a test note on a voice's channel (P2 deliverable). Latched. */
  testNote(voiceId: VoiceId): void {
    const channel = voiceId === 'left' ? LEFT_CHANNEL : RIGHT_CHANNEL
    this.moveVoice(voiceId, channel, TEST_NOTE[voiceId], 100)
  }

  /**
   * Render one compiled gesture: move the gesture's voice to its target
   * note (latch semantics), apply profile CCs, and when the gesture
   * carries a transition duration, sweep the bend wheel old→new over it.
   */
  renderGesture(gesture: CompiledPunchGesture): void {
    const { voiceId, midiChannel, targetNote, noteVelocity, brightness, expression } =
      gesture.voice
    const channel = Math.max(0, midiChannel - 1)
    const previous = this.active.get(voiceId)

    // Profile CCs first, so the articulation lands with the attack.
    const { cutoffCc, expressionCc } = this.profile.controls
    if (cutoffCc !== undefined) this.midi.send(controlChange(channel, cutoffCc, brightness))
    if (expressionCc !== undefined) this.midi.send(controlChange(channel, expressionCc, expression))

    this.moveVoice(voiceId, channel, targetNote, noteVelocity)

    const durationMs = gesture.voice.transitionDurationMs
    if (previous && durationMs > 0 && gesture.voice.transition === 'glide') {
      this.startRamp(voiceId, channel, {
        intervalSemitones: targetNote - previous.note,
        overshootCents: gesture.voice.pitchOvershootCents,
        durationMs,
      })
    }
  }

  /** Release every latched voice + center bends (§23 panic path). */
  panic(): void {
    for (const [voiceId, voice] of this.active) {
      this.cancelRamp(voiceId)
      this.midi.send(noteOff(voice.channel, voice.note))
      this.midi.send(pitchBend(voice.channel, PITCH_BEND_CENTER))
    }
    this.active.clear()
    this.midi.allNotesOff()
  }

  /** How many voices are currently sounding — for tests + diagnostics. */
  activeCount(): number {
    return this.active.size
  }

  private moveVoice(voiceId: VoiceId, channel: number, note: number, velocity: number): void {
    this.cancelRamp(voiceId)
    const prev = this.active.get(voiceId)
    if (prev) this.midi.send(noteOff(prev.channel, prev.note))
    // A fresh strike starts from a centered wheel; ramps then pull it back.
    this.midi.send(pitchBend(channel, PITCH_BEND_CENTER))
    const vel = Math.max(1, Math.min(127, Math.round(velocity)))
    this.midi.send(noteOn(channel, note, vel))
    this.active.set(voiceId, { channel, note })
  }

  private startRamp(
    voiceId: VoiceId,
    channel: number,
    spec: { intervalSemitones: number; overshootCents: number; durationMs: number },
  ): void {
    const points = bendRampPoints({
      ...spec,
      stepMs: RAMP_STEP_MS,
      bendRangeSemitones: this.profile.pitchBendRangeSemitones,
    })
    // Jump the wheel to the ramp's origin immediately (the old pitch).
    this.midi.send(pitchBend(channel, points[0] ?? PITCH_BEND_CENTER))
    let index = 1
    const handle = this.scheduler.setInterval(() => {
      const value = points[index]
      index += 1
      if (value === undefined) {
        this.cancelRamp(voiceId)
        this.midi.send(pitchBend(channel, PITCH_BEND_CENTER))
        return
      }
      this.midi.send(pitchBend(channel, value))
    }, RAMP_STEP_MS)
    this.ramps.set(voiceId, handle)
  }

  private cancelRamp(voiceId: VoiceId): void {
    const handle = this.ramps.get(voiceId)
    if (handle !== undefined) {
      this.scheduler.clearInterval(handle)
      this.ramps.delete(voiceId)
    }
  }
}
