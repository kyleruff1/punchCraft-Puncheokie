/**
 * Translate the semantic wire objects into MIDI, holding the per-voice
 * latch so a new note releases the old one and a disconnect never leaves a
 * stuck note (instrument-design §8, §23). The compiler that fills every
 * CompiledPunchGesture field lands in P3/P4; this renderer already honors
 * the latch contract for the fields P2 exercises (test notes + panic) and
 * for a gesture's targetNote/channel/velocity when they arrive.
 */
import type { CompiledPunchGesture, VoiceId } from '../../../src/domain/instrument/gestureSchema'
import {
  controlChange,
  noteOff,
  noteOn,
  pitchBend,
  PITCH_BEND_CENTER,
  type MidiOutputBackend,
} from './midiBackend'

/** Default channels (0-based on the wire): left=1→ch2, right=2→ch3 doc-numbered. */
export const LEFT_CHANNEL = 1
export const RIGHT_CHANNEL = 2

/** A comfortable test-note pitch per voice (D3 / D5 of the pentatonic). */
export const TEST_NOTE: Record<VoiceId, number> = { left: 50, right: 74 }

interface LatchedVoice {
  channel: number
  note: number
}

export class VoiceRenderer {
  private readonly active = new Map<VoiceId, LatchedVoice>()

  constructor(private readonly midi: MidiOutputBackend) {}

  /** Sound a test note on a voice's channel (P2 deliverable). Latched. */
  testNote(voiceId: VoiceId): void {
    const channel = voiceId === 'left' ? LEFT_CHANNEL : RIGHT_CHANNEL
    this.moveVoice(voiceId, channel, TEST_NOTE[voiceId], 100)
  }

  /**
   * Render one compiled gesture. Only the voice layer is wired in P2 — it
   * moves the gesture's own voice to its target note (releasing that
   * voice's previous note), which is the latch behavior the acceptance
   * criteria gate. Cube/cloud/transient consumers are separate readers of
   * the same object and are not this renderer's concern.
   */
  renderGesture(gesture: CompiledPunchGesture): void {
    const { voiceId, midiChannel, targetNote, noteVelocity } = gesture.voice
    // MIDI channels arrive doc-numbered (1-based); convert to 0-based wire.
    const channel = Math.max(0, midiChannel - 1)
    this.moveVoice(voiceId, channel, targetNote, noteVelocity)
  }

  /** Release every latched voice + center bends (§23 panic path). */
  panic(): void {
    for (const [voiceId, voice] of this.active) {
      this.midi.send(noteOff(voice.channel, voice.note))
      this.midi.send(pitchBend(voice.channel, PITCH_BEND_CENTER))
      void voiceId
    }
    this.active.clear()
    // Belt and suspenders: the backend's own all-notes-off across channels.
    this.midi.allNotesOff()
  }

  /** How many voices are currently sounding — for tests + diagnostics. */
  activeCount(): number {
    return this.active.size
  }

  private moveVoice(voiceId: VoiceId, channel: number, note: number, velocity: number): void {
    const prev = this.active.get(voiceId)
    if (prev) {
      // Same note, same channel → retrigger (release then restrike), never
      // stack a second held note (§8 "same zone").
      this.midi.send(noteOff(prev.channel, prev.note))
    }
    const vel = Math.max(1, Math.min(127, Math.round(velocity)))
    this.midi.send(controlChange(channel, 11, 100)) // expression baseline
    this.midi.send(noteOn(channel, note, vel))
    this.active.set(voiceId, { channel, note })
  }
}
