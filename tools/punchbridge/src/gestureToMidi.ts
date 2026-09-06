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
 *
 * Three-lane model (brass seam plan): bend and CC1 are CHANNEL-WIDE, so
 * lanes are keyed by wire channel — a note lane (latch OR the brass tick
 * engine), one bend lane per channel tagged 'elastic' | 'travel' |
 * 'whammy' (whammy wins: it preempts and, while running, drops incoming
 * elastic/travel requests), and an independent wah lane. Channel-keying
 * is also what lets panic() center and settle EVERY channel this session
 * touched — including the arp/accent/transient channels no latch owns.
 */
import type {
  CompiledPunchGesture,
  ImmediateAccent,
  QuantizedChange,
  VoiceId,
  WhammyAccent,
} from '../../../src/domain/instrument/gestureSchema'
import { bendRampPoints, whammyRampPoints, PITCH_BEND_CENTER } from './bendRamp'
import { BrassArpEngine } from './brassArpEngine'
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
import type { BridgeClock } from './server'

/** Default channels (0-based on the wire): left=1→ch2, right=2→ch3 doc-numbered. */
export const LEFT_CHANNEL = 1
export const RIGHT_CHANNEL = 2
/** Brass immediate-accent channel (0-based wire; doc ch4 at launch). */
export const ACCENT_CHANNEL = 3

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

const realClock: BridgeClock = { now: () => Date.now() }

/**
 * Impact ladder (brass-cube-design "Track 4 — Impact transient", R6):
 * light → rim/sidestick, medium → snare, hard → kick, peak → crash.
 * Pure so tests pin the bands without a renderer.
 */
export function transientNoteFor(velocity: number): number {
  if (velocity <= 69) return 37 // side stick / rim
  if (velocity <= 94) return 38 // snare
  if (velocity <= 114) return 36 // kick
  return 49 // crash
}

type BendLaneKind = 'elastic' | 'travel' | 'whammy'

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
  /** One bend lane per wire channel; 'whammy' outranks the other kinds. */
  private readonly bendLanes = new Map<number, { handle: unknown; kind: BendLaneKind }>()
  private readonly wahLanes = new Map<number, { handle: unknown }>()
  private readonly pendingOffs = new Map<VoiceId, PendingOff>()
  /**
   * Accent + transient gates. Each callback deletes its OWN record before
   * sending (self-clearing, like legatoMove's pendingOffs), so panic
   * flushes only unfired gates and never duplicates a note-off.
   */
  private readonly oneShotOffs = new Set<PendingOff>()
  /** Every wire channel this renderer ever wrote — panic coverage (R5). */
  private readonly touchedChannels = new Set<number>()
  private engine: BrassArpEngine | null = null
  private readonly profile: InstrumentProfile
  private readonly scheduler: RampScheduler
  private readonly clock: BridgeClock

  constructor(
    private readonly midi: MidiOutputBackend,
    profile: InstrumentProfile | string = 'studio-one-stock',
    scheduler: RampScheduler = realScheduler,
    clock: BridgeClock = realClock,
  ) {
    this.profile = typeof profile === 'string' ? profileById(profile) : profile
    this.scheduler = scheduler
    this.clock = clock
  }

  /**
   * Prime the voice channels for a session: GM destinations get the
   * profile's voice program (thick saw); wah channels settle on their
   * baseline so the first sweep starts from a known place. The brass
   * accent channel (§13) gets the program too — its stabs land there.
   */
  prepareVoices(): void {
    for (const channel of [LEFT_CHANNEL, RIGHT_CHANNEL]) {
      if (this.profile.voiceProgramGm !== undefined) {
        this.emit(programChange(channel, this.profile.voiceProgramGm))
      }
      if (this.profile.wah) {
        this.emit(
          controlChange(channel, this.profile.wah.controllerCc, this.profile.wah.baselineValue),
        )
      }
    }
    if (this.profile.voiceProgramGm !== undefined) {
      this.emit(programChange(ACCENT_CHANNEL, this.profile.voiceProgramGm))
    }
  }

  /** Sound a test note on a voice's channel (P2 deliverable). Latched. */
  testNote(voiceId: VoiceId): void {
    const channel = voiceId === 'left' ? LEFT_CHANNEL : RIGHT_CHANNEL
    this.strikeVoice(voiceId, channel, TEST_NOTE[voiceId], 100)
  }

  /** Render one compiled gesture: move the voice, ornament, breathe. */
  renderGesture(gesture: CompiledPunchGesture): void {
    if (gesture.quantized !== undefined) {
      this.renderBrassGesture(gesture, gesture.quantized)
      return
    }
    // Mode transition: a latch gesture after brass gestures flushes the
    // running engine first, then strikes normally.
    if (this.engine?.running) this.engine.stop()

    const { voiceId, midiChannel, targetNote, noteVelocity, brightness, expression } =
      gesture.voice
    const channel = Math.max(0, midiChannel - 1)
    const previous = this.active.get(voiceId)

    const { cutoffCc, expressionCc } = this.profile.controls
    if (cutoffCc !== undefined) this.emit(controlChange(channel, cutoffCc, brightness))
    if (expressionCc !== undefined) this.emit(controlChange(channel, expressionCc, expression))

    const isGlide =
      gesture.voice.transition === 'glide' && previous !== undefined && previous.note !== targetNote

    if (isGlide && this.profile.transitionBackend === 'legato-glide') {
      // The synth's portamento travels: overlap new-on before old-off.
      this.legatoMove(voiceId, channel, previous, targetNote, noteVelocity)
      if (gesture.whammy) {
        // Note path first, whammy second (seam rule 5) — and the elastic
        // is skipped outright: the octave gesture owns the wheel.
        this.startWhammy(channel, gesture.whammy, voiceId)
      } else if (gesture.voice.pitchOvershootCents > 0 && gesture.voice.transitionDurationMs > 0) {
        // Elastic ornament riding on the glide: 0 → +overshoot → center.
        this.startBendRamp('elastic', channel, {
          intervalSemitones: 0,
          overshootCents: gesture.voice.pitchOvershootCents,
          durationMs: gesture.voice.transitionDurationMs,
        })
      }
    } else {
      this.strikeVoice(voiceId, channel, targetNote, noteVelocity)
      if (gesture.whammy) {
        // Strike → whammy ordering: the strike's own center reset lands
        // BEFORE the whammy starts and therefore cannot kill it. Any
        // travel ramp is skipped — whammy dominates the wheel.
        this.startWhammy(channel, gesture.whammy, voiceId)
      } else if (
        isGlide &&
        this.profile.transitionBackend === 'bend-emulated' &&
        gesture.voice.transitionDurationMs > 0
      ) {
        this.startBendRamp('travel', channel, {
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
      this.startWah(channel, gesture)
    }
  }

  /**
   * Emergency silence (§6/§23 + R5 channel-coverage fix). Step order is
   * pinned: engine first, unfired gates flushed, lanes cancelled, then
   * center bend + wah baseline on EVERY touched channel (arp / bass /
   * accent / transient included — channels no latch ever owned), then the
   * active-voice releases and the backend's own reset. Nothing may emit
   * after panic returns.
   */
  panic(): void {
    // 1. Engine first: flush unfired gated offs, off current step + chord + bass.
    const engineChannels = this.engine ? this.engine.touchedChannels() : []
    this.engine?.stop()
    // 2. Unfired one-shot gates + pending legato offs (fired callbacks
    //    removed their own records — no duplicate note-offs).
    for (const record of this.oneShotOffs) {
      this.scheduler.clearTimeout(record.handle)
      this.midi.send(noteOff(record.channel, record.note))
    }
    this.oneShotOffs.clear()
    for (const pending of this.pendingOffs.values()) {
      this.scheduler.clearTimeout(pending.handle)
      this.midi.send(noteOff(pending.channel, pending.note))
    }
    this.pendingOffs.clear()
    // 3. Cancel every bend + wah lane, whatever channel it rides.
    const laneChannels = [...this.bendLanes.keys(), ...this.wahLanes.keys()]
    for (const lane of this.bendLanes.values()) this.scheduler.clearInterval(lane.handle)
    this.bendLanes.clear()
    for (const lane of this.wahLanes.values()) this.scheduler.clearInterval(lane.handle)
    this.wahLanes.clear()
    // 4. Center + settle every channel the session touched (R5).
    const channels = new Set<number>([...this.touchedChannels, ...laneChannels, ...engineChannels])
    for (const voice of this.active.values()) channels.add(voice.channel)
    for (const channel of [...channels].sort((a, b) => a - b)) {
      this.midi.send(pitchBend(channel, PITCH_BEND_CENTER))
      if (this.profile.wah) {
        this.midi.send(
          controlChange(channel, this.profile.wah.controllerCc, this.profile.wah.baselineValue),
        )
      }
    }
    // 5. Release the latched voices + the backend's own reset.
    for (const voice of this.active.values()) {
      this.midi.send(noteOff(voice.channel, voice.note))
    }
    this.active.clear()
    this.midi.allNotesOff()
  }

  /** How many voices are currently sounding — for tests + diagnostics. */
  activeCount(): number {
    return this.active.size
  }

  /** The brass engine's latency/robustness counters (am. 14); null while idle. */
  brassTelemetry(): ReturnType<BrassArpEngine['telemetry']> | null {
    return this.engine ? this.engine.telemetry() : null
  }

  /** The last canonical harmonic commit the engine applied (field driver). */
  lastHarmonicCommit(): BrassArpEngine['lastHarmonicCommit'] {
    return this.engine ? this.engine.lastHarmonicCommit : null
  }

  /**
   * Brass path (no strikeVoice, no latch write, no center reset): CCs on
   * the arp channel, the immediate ch4 stab, the ch10 impact transient,
   * stage the quantized block, then whammy-or-elastic, then wah — note
   * path first, whammy second, wah third (R5).
   */
  private renderBrassGesture(gesture: CompiledPunchGesture, q: QuantizedChange): void {
    const arpChannel = Math.max(0, q.arpChannel - 1)
    const bassChannel = Math.max(0, q.bassChannel - 1)
    if (
      !this.engine ||
      this.engine.arpChannel !== arpChannel ||
      this.engine.bassChannel !== bassChannel
    ) {
      this.engine?.stop()
      this.engine = new BrassArpEngine(this.midi, this.scheduler, this.clock, {
        arpChannel,
        bassChannel,
        bassOverlapMs: this.profile.legatoOverlapMs,
      })
    }
    // The engine writes notes on these channels; record them for panic
    // even though the engine itself is bend/CC-neutral.
    this.touchedChannels.add(arpChannel)
    this.touchedChannels.add(bassChannel)

    const { cutoffCc, expressionCc } = this.profile.controls
    if (cutoffCc !== undefined) {
      this.emit(controlChange(arpChannel, cutoffCc, gesture.voice.brightness))
    }
    if (expressionCc !== undefined) {
      this.emit(controlChange(arpChannel, expressionCc, gesture.voice.expression))
    }

    if (gesture.accent) this.strikeAccent(gesture.accent)
    this.renderTransient(gesture)

    // Stage only — the engine commits on the next boundary (or fires
    // boundary 0 synchronously when idle: the accent + step-0 double
    // attack on the first punch is by design, layered voices). The
    // eventId feeds the field driver's commit fold (contributing ids).
    this.engine.applyGesture(q, gesture.voice.noteVelocity, {
      eventId: gesture.eventId,
      ...(gesture.technique ? { technique: gesture.technique } : {}),
    })

    if (gesture.whammy) {
      // The whammy rides the ARP channel for BOTH hands, so its bend range
      // resolves by the TARGET LANE's synth — always 'right' (doc ch3 IS
      // the right-voice latch channel: same Mai Tai either hand). Keying
      // by the punching hand would give the same channel different pitch
      // math per hand once pitchBendRangeByVoice.left describes Mojito.
      this.startWhammy(arpChannel, gesture.whammy, 'right')
    } else if (gesture.voice.pitchOvershootCents > 0 && gesture.voice.transitionDurationMs > 0) {
      this.startBendRamp('elastic', arpChannel, {
        intervalSemitones: 0,
        overshootCents: gesture.voice.pitchOvershootCents,
        durationMs: gesture.voice.transitionDurationMs,
      })
    }

    if (this.profile.wah) {
      this.startWah(arpChannel, gesture)
    }
  }

  /** Immediate ch4 brass stab (R6): the punch's anchor note, short gate. */
  private strikeAccent(accent: ImmediateAccent): void {
    const channel = Math.max(0, accent.channel - 1)
    const velocity = Math.max(1, Math.min(127, Math.round(accent.midiVelocity)))
    this.emit(noteOn(channel, accent.midiNote, velocity))
    this.scheduleOneShotOff(channel, accent.midiNote, Math.max(0, accent.gateMs))
  }

  /**
   * Toontrack impact (R6): the gesture's transient velocity through the
   * drum-piece ladder, short gate. Brass path ONLY — wiring transients
   * for legacy gestures would break the byte-identical latch stream (R1).
   */
  private renderTransient(gesture: CompiledPunchGesture): void {
    const channel = Math.max(0, (this.profile.transientChannel ?? 10) - 1)
    const velocity = Math.max(1, Math.min(127, Math.round(gesture.transient.velocity)))
    const note = transientNoteFor(velocity)
    this.emit(noteOn(channel, note, velocity))
    this.scheduleOneShotOff(channel, note, Math.max(0, this.profile.transientGateMs ?? 60))
  }

  private scheduleOneShotOff(channel: number, note: number, delayMs: number): void {
    const record: PendingOff = { handle: null, channel, note }
    record.handle = this.scheduler.setTimeout(() => {
      // Self-clearing: drop the record BEFORE sending so a later panic
      // can never re-send this off.
      this.oneShotOffs.delete(record)
      this.midi.send(noteOff(channel, note))
    }, delayMs)
    this.oneShotOffs.add(record)
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
    // A legato Note On never touches a riding whammy (seam rule 3).
    this.cancelBend(channel, { keepWhammy: true })
    const vel = Math.max(1, Math.min(127, Math.round(velocity)))
    this.emit(noteOn(channel, note, vel))
    const overlap = Math.max(0, this.profile.legatoOverlapMs)
    const handle = this.scheduler.setTimeout(() => {
      this.pendingOffs.delete(voiceId)
      this.midi.send(noteOff(previous.channel, previous.note))
    }, overlap)
    this.pendingOffs.set(voiceId, { handle, channel: previous.channel, note: previous.note })
    this.active.set(voiceId, { channel, note })
  }

  /**
   * Plain strike: old off (if any), wheel centered, new on. A HARD reset
   * (seam rule 4): cancels every bend kind INCLUDING a riding whammy —
   * striking a new note with the wheel at +7 st would sound transposed.
   */
  private strikeVoice(voiceId: VoiceId, channel: number, note: number, velocity: number): void {
    this.flushPendingOff(voiceId)
    const prev = this.active.get(voiceId)
    if (prev && prev.channel !== channel) this.cancelBend(prev.channel)
    this.cancelBend(channel)
    if (prev) this.emit(noteOff(prev.channel, prev.note))
    this.emit(pitchBend(channel, PITCH_BEND_CENTER))
    const vel = Math.max(1, Math.min(127, Math.round(velocity)))
    this.emit(noteOn(channel, note, vel))
    this.active.set(voiceId, { channel, note })
  }

  /**
   * Elastic/travel ramp on a channel's bend lane. While a whammy runs on
   * the channel the request is DROPPED (seam rule 2) — a 10-cent blip or
   * an old→new travel sweep must not steal the wheel. Natural exhaustion
   * keeps today's trailing center send (latch byte-stream unchanged).
   */
  private startBendRamp(
    kind: 'elastic' | 'travel',
    channel: number,
    spec: { intervalSemitones: number; overshootCents: number; durationMs: number },
  ): void {
    const existing = this.bendLanes.get(channel)
    if (existing?.kind === 'whammy') return
    if (existing) {
      this.scheduler.clearInterval(existing.handle)
      this.bendLanes.delete(channel)
    }
    const points = bendRampPoints({
      ...spec,
      stepMs: RAMP_STEP_MS,
      bendRangeSemitones: this.profile.pitchBendRangeSemitones,
    })
    this.emit(pitchBend(channel, points[0] ?? PITCH_BEND_CENTER))
    let index = 1
    const handle = this.scheduler.setInterval(() => {
      const value = points[index]
      index += 1
      if (value === undefined) {
        this.cancelBend(channel)
        this.midi.send(pitchBend(channel, PITCH_BEND_CENTER))
        return
      }
      this.midi.send(pitchBend(channel, value))
    }, RAMP_STEP_MS)
    this.bendLanes.set(channel, { handle, kind })
  }

  /**
   * Peak-event whammy (seam rule 1): cancels ANY in-flight lane on the
   * channel and starts fresh. No extra center message — the generator's
   * point 0 is 8192 and its last point is exactly 8192, so the stream is
   * the generator's output verbatim. The bend range resolves by the
   * TARGET LANE's synth via `bendRangeVoice` (§13): the caller passes the
   * lane key — latch path the punching voiceId, brass path always 'right'.
   */
  private startWhammy(channel: number, accent: WhammyAccent, bendRangeVoice: VoiceId): void {
    this.cancelBend(channel)
    const range =
      this.profile.pitchBendRangeByVoice?.[bendRangeVoice] ?? this.profile.pitchBendRangeSemitones
    const points = whammyRampPoints({
      direction: accent.direction,
      semitones: accent.semitones,
      durationMs: accent.durationMs,
      stepMs: RAMP_STEP_MS,
      bendRangeSemitones: range,
    })
    this.emit(pitchBend(channel, points[0] ?? PITCH_BEND_CENTER))
    let index = 1
    const handle = this.scheduler.setInterval(() => {
      const value = points[index]
      index += 1
      if (value === undefined) {
        // Natural end: the last point already settled on center — no
        // extra center send (unlike the elastic/travel lane).
        this.cancelBend(channel)
        return
      }
      this.midi.send(pitchBend(channel, value))
    }, RAMP_STEP_MS)
    this.bendLanes.set(channel, { handle, kind: 'whammy' })
  }

  private startWah(channel: number, gesture: CompiledPunchGesture): void {
    const wah = this.profile.wah
    if (!wah) return
    this.cancelWah(channel)
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
        this.cancelWah(channel)
        this.midi.send(controlChange(channel, wah.controllerCc, wah.baselineValue))
        return
      }
      this.midi.send(controlChange(channel, wah.controllerCc, value))
    }, WAH_STEP_MS)
    this.wahLanes.set(channel, { handle })
    this.touchedChannels.add(channel)
  }

  private flushPendingOff(voiceId: VoiceId): void {
    const pending = this.pendingOffs.get(voiceId)
    if (pending) {
      this.scheduler.clearTimeout(pending.handle)
      this.midi.send(noteOff(pending.channel, pending.note))
      this.pendingOffs.delete(voiceId)
    }
  }

  private cancelBend(channel: number, opts?: { keepWhammy?: boolean }): void {
    const lane = this.bendLanes.get(channel)
    if (!lane) return
    if (opts?.keepWhammy && lane.kind === 'whammy') return
    this.scheduler.clearInterval(lane.handle)
    this.bendLanes.delete(channel)
  }

  private cancelWah(channel: number): void {
    const lane = this.wahLanes.get(channel)
    if (lane) {
      this.scheduler.clearInterval(lane.handle)
      this.wahLanes.delete(channel)
    }
  }

  /** Send + record the channel for panic coverage. */
  private emit(bytes: number[]): void {
    const status = bytes[0]
    if (typeof status === 'number' && status >= 0x80 && status <= 0xef) {
      this.touchedChannels.add(status & 0x0f)
    }
    this.midi.send(bytes)
  }
}
