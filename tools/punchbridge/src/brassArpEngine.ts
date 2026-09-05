/**
 * The PunchBridge tick backend (brass-cube-design "PunchBridge tick
 * backend"): owns the arpeggio pattern between punches. The domain computes
 * every musical number per punch (cell, rotated pool, bass, layer); this
 * engine decides only WHEN — it stages the newest QuantizedChange and
 * commits it on the next TickClock boundary, so flurries coalesce into ONE
 * coherent harmonic change per step while accents/transients still fire per
 * punch in the renderer.
 *
 * STRUCTURALLY bend/CC-neutral (R4): this module imports ONLY noteOn and
 * noteOff from the MIDI backend, so it cannot write the wheel or any
 * controller lane — expression ramps ride the running pattern untouched.
 */
import {
  BRASS_ACTIVITY_LAYERS,
  stepMsFor,
  type BrassActivityLayer,
} from '../../../src/domain/instrument/brassCube'
import {
  brassLayerFor,
  decayPps,
} from '../../../src/domain/instrument/activityEnvelope'
import type {
  ArpeggiatorBackend,
  QuantizedChange,
  RetriggerPolicy,
} from '../../../src/domain/instrument/gestureSchema'
import { noteOff, noteOn, type MidiOutputBackend } from './midiBackend'
import type { RampScheduler } from './gestureToMidi'
import type { BridgeClock } from './server'
import { TickClock } from './tickClock'

export interface BrassEngineOptions {
  /** Wire 0-based channels (doc ch3 → 2, doc ch2 → 1 at launch). */
  arpChannel: number
  bassChannel: number
  /** Bass legato overlap (profile.legatoOverlapMs; Mojito's glide travels). */
  bassOverlapMs: number
  /** Layer ladder for decay wind-down; defaults to the shared domain table. */
  activityLayers?: readonly BrassActivityLayer[]
}

interface CommittedState {
  cellId: string
  chordName: string
  rotatedPool: readonly number[]
  pattern: readonly number[]
  patternDepth: number
  gateRatio: number
  notesPerMinute: number
  activityLayer: 0 | 1 | 2 | 3
  retrigger: RetriggerPolicy
  backend: ArpeggiatorBackend
  bassNote: number
  noteVelocity: number
}

interface PendingNoteOff {
  handle: unknown
  channel: number
  note: number
}

export class BrassArpEngine {
  private committed: CommittedState | null = null
  private staged: { q: QuantizedChange; noteVelocity: number } | null = null
  private lastActivity: { pps: number; atMs: number } = { pps: 0, atMs: 0 }
  private stepCursor = 0
  private pendingStepOff: PendingNoteOff | null = null
  private pendingBassOff: PendingNoteOff | null = null
  private heldChordNotes: number[] = []
  private soundingBassNote: number | null = null
  private readonly tickClock: TickClock
  private readonly activityLayers: readonly BrassActivityLayer[]

  constructor(
    private readonly midi: MidiOutputBackend,
    private readonly scheduler: RampScheduler,
    private readonly clock: BridgeClock,
    private readonly opts: BrassEngineOptions,
  ) {
    this.activityLayers = opts.activityLayers ?? BRASS_ACTIVITY_LAYERS
    this.tickClock = new TickClock(scheduler, clock, () => this.onBoundary())
  }

  /**
   * Stage a punch's quantized block — NO MIDI at punch time. One staged
   * slot: the newest gesture overwrites, so a flurry commits once per
   * boundary with the newest zone per hand (the domain's sample-and-hold
   * latch already merged the hands). If idle, the grid starts here and
   * boundary 0 fires synchronously — first commit + first step sound
   * within this call (the ch4 accent + step-0 double attack is by design).
   */
  applyGesture(q: QuantizedChange, noteVelocity: number): void {
    this.staged = { q, noteVelocity }
    this.lastActivity = { pps: q.activityPps, atMs: this.clock.now() }
    if (!this.tickClock.running) {
      this.tickClock.start(stepMsFor(q.notesPerMinute))
    }
  }

  /**
   * Silence everything: flush only UNFIRED gated offs (fired callbacks
   * already cleared their own records — never a duplicate note-off), off
   * the held chord + bass, stop the grid, reset. Emits only note-offs.
   */
  stop(): void {
    this.flushPendingStepOff()
    this.flushPendingBassOff()
    for (const note of this.heldChordNotes) {
      this.midi.send(noteOff(this.opts.arpChannel, note))
    }
    this.heldChordNotes = []
    if (this.soundingBassNote !== null) {
      this.midi.send(noteOff(this.opts.bassChannel, this.soundingBassNote))
      this.soundingBassNote = null
    }
    this.tickClock.stop()
    this.committed = null
    this.staged = null
    this.stepCursor = 0
  }

  get running(): boolean {
    return this.tickClock.running
  }

  get arpChannel(): number {
    return this.opts.arpChannel
  }

  get bassChannel(): number {
    return this.opts.bassChannel
  }

  /** Wire 0-based channels the engine sounds on — for panic coverage (R5). */
  touchedChannels(): number[] {
    return [this.opts.arpChannel, this.opts.bassChannel]
  }

  /** The whole state machine: commit-or-decay, emit, bass. */
  private onBoundary(): void {
    let committedThisBoundary = false
    let cellChanged = false

    if (this.staged) {
      const { q, noteVelocity } = this.staged
      cellChanged = this.committed === null || q.cubeCellId !== this.committed.cellId
      // A backend switch silences the departing mode first.
      if (this.committed !== null && q.backend !== this.committed.backend) {
        if (this.committed.backend === 'studio-one-note-fx') {
          for (const note of this.heldChordNotes) {
            this.midi.send(noteOff(this.opts.arpChannel, note))
          }
          this.heldChordNotes = []
        } else {
          this.flushPendingStepOff()
        }
        // A switch INTO note-fx must seed the arriving mode on this very
        // boundary: its emit branch is gated on cellChanged, and the cell id
        // survives a backend switch — without this, a same-cell switch under
        // quantized-rotate would latch no chord until the next cell change.
        if (q.backend === 'studio-one-note-fx') {
          cellChanged = true
        }
      }
      // Cursor per retrigger policy (the design's three behaviors).
      if (q.retrigger === 'hard-retrigger') {
        this.stepCursor = 0 // every commit restarts, same-cell re-accents included
      } else if (q.retrigger === 'quantized-rotate' && cellChanged) {
        this.stepCursor = 0 // new cell enters at its rotated start tone
      } // continuous-morph: the pool swaps under the running phase
      this.committed = {
        cellId: q.cubeCellId,
        chordName: q.chordName,
        rotatedPool: q.chordMidiNotes,
        pattern: q.arpPattern,
        patternDepth: q.patternDepth,
        gateRatio: q.gateRatio,
        notesPerMinute: q.notesPerMinute,
        activityLayer: q.activityLayer,
        retrigger: q.retrigger,
        backend: q.backend,
        bassNote: q.bassMidiNote,
        noteVelocity,
      }
      this.tickClock.setStepMs(stepMsFor(q.notesPerMinute))
      this.staged = null
      committedThisBoundary = true
    } else if (this.committed) {
      // No punch since the last boundary: wind the layer down with the
      // domain's own decay curve + hysteresis (240 → 180 → 120 → 60; the
      // chord stays latched and the engine never auto-stops).
      const pps = decayPps(this.lastActivity.pps, this.clock.now() - this.lastActivity.atMs)
      const layer = brassLayerFor(pps, this.committed.activityLayer)
      if (layer !== this.committed.activityLayer) {
        const def = this.activityLayers[layer]
        if (def) {
          this.committed.notesPerMinute = def.notesPerMinute
          this.committed.gateRatio = def.gateRatio
          this.committed.patternDepth = def.patternDepth
          this.committed.activityLayer = layer
          this.tickClock.setStepMs(stepMsFor(def.notesPerMinute))
        }
      }
    }

    const committed = this.committed
    if (!committed) return

    if (committed.backend === 'punchbridge-tick') {
      const effLen = Math.max(1, Math.min(committed.patternDepth, committed.pattern.length))
      const patternIndex = committed.pattern[this.stepCursor % effLen] ?? 0
      const note =
        committed.rotatedPool[Math.min(patternIndex, committed.rotatedPool.length - 1)] ?? 0
      this.flushPendingStepOff()
      this.midi.send(noteOn(this.opts.arpChannel, note, committed.noteVelocity))
      // Gate < 1 ends the step early, so the off always lands before the
      // next on at any rate transition (tickClock.stepMs already carries
      // the step length this note will actually span).
      const gateMs = Math.round(this.tickClock.stepMs * committed.gateRatio)
      const record: PendingNoteOff = { handle: null, channel: this.opts.arpChannel, note }
      record.handle = this.scheduler.setTimeout(() => {
        // Self-clearing (legatoMove's pendingOffs pattern): the record is
        // nulled BEFORE sending, so stop()/panic flush only unfired offs.
        this.pendingStepOff = null
        this.midi.send(noteOff(record.channel, record.note))
      }, gateMs)
      this.pendingStepOff = record
      this.stepCursor = (this.stepCursor % effLen) + 1
    } else if (
      committedThisBoundary &&
      (cellChanged || committed.retrigger === 'hard-retrigger')
    ) {
      // studio-one-note-fx: no stepping — latch the full rotated six-note
      // chord and let S1's Arpeggiator own the pattern. The grid keeps
      // running (boundaries still gate commits; the rate is inaudible).
      for (const note of this.heldChordNotes) {
        this.midi.send(noteOff(this.opts.arpChannel, note))
      }
      for (const note of committed.rotatedPool) {
        this.midi.send(noteOn(this.opts.arpChannel, note, committed.noteVelocity))
      }
      this.heldChordNotes = [...committed.rotatedPool]
    }

    // Bass (both backends): only a committed root CHANGE moves it — new on
    // first, old off after the overlap; Mojito's glide does the travel.
    if (committedThisBoundary && committed.bassNote !== this.soundingBassNote) {
      const oldBass = this.soundingBassNote
      this.flushPendingBassOff()
      this.midi.send(noteOn(this.opts.bassChannel, committed.bassNote, committed.noteVelocity))
      if (oldBass !== null) {
        const record: PendingNoteOff = { handle: null, channel: this.opts.bassChannel, note: oldBass }
        record.handle = this.scheduler.setTimeout(() => {
          this.pendingBassOff = null // self-clearing, same rule as the step gate
          this.midi.send(noteOff(record.channel, record.note))
        }, Math.max(0, this.opts.bassOverlapMs))
        this.pendingBassOff = record
      }
      this.soundingBassNote = committed.bassNote
    }
  }

  private flushPendingStepOff(): void {
    const pending = this.pendingStepOff
    if (pending) {
      this.pendingStepOff = null
      this.scheduler.clearTimeout(pending.handle)
      this.midi.send(noteOff(pending.channel, pending.note))
    }
  }

  private flushPendingBassOff(): void {
    const pending = this.pendingBassOff
    if (pending) {
      this.pendingBassOff = null
      this.scheduler.clearTimeout(pending.handle)
      this.midi.send(noteOff(pending.channel, pending.note))
    }
  }
}
