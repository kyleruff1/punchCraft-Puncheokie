/**
 * Translate the semantic wire objects into MIDI, holding the per-voice
 * latch so a new note releases the old one and a disconnect never leaves
 * a stuck note (instrument-design §8, §23).
 *
 * Transition layer (transition-design §1-§2): on a 'legato-glide'
 * profile the SYNTH's portamento does the pitch travel — new Note On
 * first, old Note Off after a short overlap — and the bend wheel only
 * ornaments (elastic overshoot blip). On a 'bend-emulated' profile (GM
 * destinations without glide) the travel is a full old→new bend ramp.
 * Wah: a per-punch CC envelope (baseline → peak → baseline) on the CC
 * the synth's mod matrix routes to cutoff.
 */
import type { CompiledPunchGesture, VoiceId } from '../../../src/domain/instrument/gestureSchema'
import { bendRampPoints, PITCH_BEND_CENTER } from './bendRamp'
import { wahEnvelope, wahRampPoints } from './expression'
import { profileById, type InstrumentProfile } from './instrumentProfiles'
import {
  controlChange,
  noteOff,
  noteOn,
  pitchBend,
  programChange,
  type MidiOutputBackend,
} from './midiBackend'

/** Default channels (0-based on the wire): left=1→ch2, right=2→ch3 doc-numbered. */
export const LEFT_CHANNEL = 1
export const RIGHT_CHANNEL = 2

/** A comfortable test-note pitch per voice (D3 / D5 of the pentatonic). */
export const TEST_NOTE: Record<VoiceId, number> = { left: 50, right: 74 }

/** Bend-wheel update cadence during a ramp. */
export const RAMP_STEP_MS = 5
/** Wah CC update cadence. */
export const WAH_STEP_MS = 10

export interface RampScheduler {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realScheduler: RampScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as Parameters<typeof clearInterval>[0]),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
}

interface LatchedVoice {
  channel: number
  note: number
}

interface PendingOff {
  handle: unknown
  channel: number
  note: number
}

export class VoiceRenderer {
  private readonly active = new Map<VoiceId, LatchedVoice>()
  private readonly bendRamps = new Map<VoiceId, unknown>()
  private readonly wahRamps = new Map<VoiceId, unknown>()
  private readonly pendingOffs = new Map<VoiceId, PendingOff>()
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

  /**
   * Prime the voice channels for a session: GM destinations get the
   * profile's voice program (thick saw); wah channels settle on their
   * baseline so the first sweep starts from a known place.
   */
  prepareVoices(): void {
    for (const channel of [LEFT_CHANNEL, RIGHT_CHANNEL]) {
      if (this.profile.voiceProgramGm !== undefined) {
        this.midi.send(programChange(channel, this.profile.voiceProgramGm))
      }
      if (this.profile.wah) {
        this.midi.send(
          controlChange(channel, this.profile.wah.controllerCc, this.profile.wah.baselineValue),
        )
      }
    }
  }

  /** Sound a test note on a voice's channel (P2 deliverable). Latched. */
  testNote(voiceId: VoiceId): void {
    const channel = voiceId === 'left' ? LEFT_CHANNEL : RIGHT_CHANNEL
    this.strikeVoice(voiceId, channel, TEST_NOTE[voiceId], 100)
  }

  /** Render one compiled gesture: move the voice, ornament, breathe. */
  renderGesture(gesture: CompiledPunchGesture): void {
    const { voiceId, midiChannel, targetNote, noteVelocity, brightness, expression } =
      gesture.voice
    const channel = Math.max(0, midiChannel - 1)
    const previous = this.active.get(voiceId)

    const { cutoffCc, expressionCc } = this.profile.controls
    if (cutoffCc !== undefined) this.midi.send(controlChange(channel, cutoffCc, brightness))
    if (expressionCc !== undefined) this.midi.send(controlChange(channel, expressionCc, expression))

    const isGlide =
      gesture.voice.transition === 'glide' && previous !== undefined && previous.note !== targetNote

    if (isGlide && this.profile.transitionBackend === 'legato-glide') {
      // The synth's portamento travels: overlap new-on before old-off.
      this.legatoMove(voiceId, channel, previous, targetNote, noteVelocity)
      if (gesture.voice.pitchOvershootCents > 0 && gesture.voice.transitionDurationMs > 0) {
        // Elastic ornament riding on the glide: 0 → +overshoot → center.
        this.startBendRamp(voiceId, channel, {
          intervalSemitones: 0,
          overshootCents: gesture.voice.pitchOvershootCents,
          durationMs: gesture.voice.transitionDurationMs,
        })
      }
    } else {
      this.strikeVoice(voiceId, channel, targetNote, noteVelocity)
      if (
        isGlide &&
        this.profile.transitionBackend === 'bend-emulated' &&
        gesture.voice.transitionDurationMs > 0
      ) {
        this.startBendRamp(voiceId, channel, {
          intervalSemitones: targetNote - previous.note,
          overshootCents: gesture.voice.pitchOvershootCents,
          durationMs: gesture.voice.transitionDurationMs,
        })
      }
    }

    // The wah breathes on every live punch — including same-zone
    // retriggers (transition-design §4: "Same zone repeated → retrigger
    // + wah, no pitch change").
    if (this.profile.wah) {
      this.startWah(voiceId, channel, gesture)
    }
  }

  /** Release every latched voice + center bends + settle wah (§6 panic). */
  panic(): void {
    for (const [voiceId, pending] of this.pendingOffs) {
      this.scheduler.clearTimeout(pending.handle)
      this.midi.send(noteOff(pending.channel, pending.note))
      void voiceId
    }
    this.pendingOffs.clear()
    for (const [voiceId, voice] of this.active) {
      this.cancelBend(voiceId)
      this.cancelWah(voiceId)
      this.midi.send(noteOff(voice.channel, voice.note))
      this.midi.send(pitchBend(voice.channel, PITCH_BEND_CENTER))
      if (this.profile.wah) {
        this.midi.send(
          controlChange(voice.channel, this.profile.wah.controllerCc, this.profile.wah.baselineValue),
        )
      }
    }
    this.active.clear()
    this.midi.allNotesOff()
  }

  /** How many voices are currently sounding — for tests + diagnostics. */
  activeCount(): number {
    return this.active.size
  }

  /** Legato move: Note On (new) first; Note Off (old) after the overlap. */
  private legatoMove(
    voiceId: VoiceId,
    channel: number,
    previous: LatchedVoice,
    note: number,
    velocity: number,
  ): void {
    this.flushPendingOff(voiceId)
    this.cancelBend(voiceId)
    const vel = Math.max(1, Math.min(127, Math.round(velocity)))
    this.midi.send(noteOn(channel, note, vel))
    const overlap = Math.max(0, this.profile.legatoOverlapMs)
    const handle = this.scheduler.setTimeout(() => {
      this.pendingOffs.delete(voiceId)
      this.midi.send(noteOff(previous.channel, previous.note))
    }, overlap)
    this.pendingOffs.set(voiceId, { handle, channel: previous.channel, note: previous.note })
    this.active.set(voiceId, { channel, note })
  }

  /** Plain strike: old off (if any), wheel centered, new on. */
  private strikeVoice(voiceId: VoiceId, channel: number, note: number, velocity: number): void {
    this.flushPendingOff(voiceId)
    this.cancelBend(voiceId)
    const prev = this.active.get(voiceId)
    if (prev) this.midi.send(noteOff(prev.channel, prev.note))
    this.midi.send(pitchBend(channel, PITCH_BEND_CENTER))
    const vel = Math.max(1, Math.min(127, Math.round(velocity)))
    this.midi.send(noteOn(channel, note, vel))
    this.active.set(voiceId, { channel, note })
  }

  private startBendRamp(
    voiceId: VoiceId,
    channel: number,
    spec: { intervalSemitones: number; overshootCents: number; durationMs: number },
  ): void {
    const points = bendRampPoints({
      ...spec,
      stepMs: RAMP_STEP_MS,
      bendRangeSemitones: this.profile.pitchBendRangeSemitones,
    })
    this.midi.send(pitchBend(channel, points[0] ?? PITCH_BEND_CENTER))
    let index = 1
    const handle = this.scheduler.setInterval(() => {
      const value = points[index]
      index += 1
      if (value === undefined) {
        this.cancelBend(voiceId)
        this.midi.send(pitchBend(channel, PITCH_BEND_CENTER))
        return
      }
      this.midi.send(pitchBend(channel, value))
    }, RAMP_STEP_MS)
    this.bendRamps.set(voiceId, handle)
  }

  private startWah(voiceId: VoiceId, channel: number, gesture: CompiledPunchGesture): void {
    const wah = this.profile.wah
    if (!wah) return
    this.cancelWah(voiceId)
    const envelope = wahEnvelope(
      gesture.source.velocity01,
      gesture.source.acceleration01,
      gesture.source.punchRate01,
    )
    envelope.baseline = wah.baselineValue
    const points = wahRampPoints(envelope, WAH_STEP_MS)
    let index = 0
    const handle = this.scheduler.setInterval(() => {
      const value = points[index]
      index += 1
      if (value === undefined) {
        this.cancelWah(voiceId)
        this.midi.send(controlChange(channel, wah.controllerCc, wah.baselineValue))
        return
      }
      this.midi.send(controlChange(channel, wah.controllerCc, value))
    }, WAH_STEP_MS)
    this.wahRamps.set(voiceId, handle)
  }

  private flushPendingOff(voiceId: VoiceId): void {
    const pending = this.pendingOffs.get(voiceId)
    if (pending) {
      this.scheduler.clearTimeout(pending.handle)
      this.midi.send(noteOff(pending.channel, pending.note))
      this.pendingOffs.delete(voiceId)
    }
  }

  private cancelBend(voiceId: VoiceId): void {
    const handle = this.bendRamps.get(voiceId)
    if (handle !== undefined) {
      this.scheduler.clearInterval(handle)
      this.bendRamps.delete(voiceId)
    }
  }

  private cancelWah(voiceId: VoiceId): void {
    const handle = this.wahRamps.get(voiceId)
    if (handle !== undefined) {
      this.scheduler.clearInterval(handle)
      this.wahRamps.delete(voiceId)
    }
  }
}
