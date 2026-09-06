/**
 * The PunchBridge tick backend (brass-cube-design "PunchBridge tick
 * backend"): owns the arpeggio pattern between punches. The domain computes
 * every musical number per punch (cell, rotated pool, bass, layer); this
 * engine decides only WHEN.
 *
 * TWO drivers, one emit path (M40-17):
 *
 * · LEGACY (no `quantized.commitIntervalTicks`): the original TickClock —
 *   the newest staged gesture commits on the next arp-step boundary.
 *   Byte-equal with the pre-field engine; the boundary-commit pin in
 *   brassArpEngine.test.ts stays green untouched.
 *
 * · FIELD (harmonic-field-v2): the ONE Transport. Harmonic-commit and
 *   arp-step grids are projections of the same absolute tick position —
 *   never two independently advancing clocks. Punches stage into the
 *   commit window; at each harmonic boundary the window folds (pure
 *   harmonicCommit.ts) into ONE canonical commit; the commit becomes
 *   audible on the SOUNDING arp grid's next boundary, where pool + bass +
 *   layer + rate apply ATOMICALLY and the arp grid re-anchors (second-pass
 *   am. 4). Missed-boundary policy (am. 3): commits coalesce to the latest
 *   legal state; stale arp steps are skipped (phase advanced, never
 *   burst-played); gated note-offs always process; skips are counted.
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
  TechniqueBlock,
} from '../../../src/domain/instrument/gestureSchema'
import {
  mutationForStep,
  type PendingMicroMutation,
} from '../../../src/domain/instrument/patternExecutionBackend'
import {
  foldHarmonicCommit,
  type CompiledHarmonicCommit,
  type FoldedHarmonicCommit,
  type StagedHarmonicChange,
} from '../../../src/domain/instrument/harmonicCommit'
import {
  arpIntervalTicksFor,
  boundaryTickOf,
  crossedBoundaryIndices,
  msForTicks,
  type QuantizationGrid,
} from '../../../src/domain/instrument/transportGrid'
import { noteOff, noteOn, type MidiOutputBackend } from './midiBackend'
import type { RampScheduler } from './gestureToMidi'
import type { BridgeClock } from './server'
import { TickClock } from './tickClock'
import { Transport, type TransportObservation } from './transport'

export interface BrassEngineOptions {
  /** Wire 0-based channels (doc ch3 → 2, doc ch2 → 1 at launch). */
  arpChannel: number
  bassChannel: number
  /** Bass legato overlap (profile.legatoOverlapMs; Mojito's glide travels). */
  bassOverlapMs: number
  /** Layer ladder for decay wind-down; defaults to the shared domain table. */
  activityLayers?: readonly BrassActivityLayer[]
}

/** Provenance for the commit fold; optional so legacy call sites compile. */
export interface GestureMeta {
  eventId?: string
  transportGeneration?: number
  patchGeneration?: number
  /** The punch's technique block (M40-22A); absent off-field. */
  technique?: TechniqueBlock
}

/** Basic latency/robustness counters (second-pass am. 14). */
export interface BrassEngineTelemetry {
  /** Canonical harmonic commits applied (field driver only). */
  commits: number
  /** Stale arp boundaries skipped under the missed-boundary policy. */
  skippedArpSteps: number
  /** requested→applied lag of the last commit, in transport ticks. */
  lastCommitLagTicks: number | null
  /** Worst scheduler lateness observed vs the tick lattice, in ms. */
  maxLatenessMs: number
  /** Micro-mutated steps actually sounded (M40-22A). */
  mutatedSteps: number
  /** Mutations replaced by a newer punch before they ever sounded. */
  supersededMutations: number
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
  private readonly transport: Transport
  private readonly activityLayers: readonly BrassActivityLayer[]
  /** Which driver currently owns the grid; null while idle. */
  private mode: 'legacy' | 'field' | null = null
  private arpGrid: QuantizationGrid | null = null
  private commitGrid: QuantizationGrid | null = null
  private stagedField: StagedHarmonicChange[] = []
  private pendingCommit: FoldedHarmonicCommit | null = null
  private lastCommit: CompiledHarmonicCommit | null = null
  private stagedSeq = 0
  /**
   * ONE pending micro-mutation (am. 6): the newest valid punch owns the
   * next step. Contradictory operations never stack — a jab's advance, a
   * hook's reverse and an uppercut's rise cannot compose on one step. The
   * phrase accumulator still keeps every punch for the persistent motif.
   */
  private pendingMutation: PendingMicroMutation | null = null
  /** Steps emitted since the engine started — the mutation's step clock. */
  private stepIndex = 0
  /** The transport tick most recently observed (mutation provenance). */
  private lastTickObserved = 0
  private readonly counters: BrassEngineTelemetry = {
    commits: 0,
    skippedArpSteps: 0,
    lastCommitLagTicks: null,
    maxLatenessMs: 0,
    mutatedSteps: 0,
    supersededMutations: 0,
  }

  constructor(
    private readonly midi: MidiOutputBackend,
    private readonly scheduler: RampScheduler,
    private readonly clock: BridgeClock,
    private readonly opts: BrassEngineOptions,
  ) {
    this.activityLayers = opts.activityLayers ?? BRASS_ACTIVITY_LAYERS
    this.tickClock = new TickClock(scheduler, clock, () => this.onBoundary())
    this.transport = new Transport(scheduler, clock, (obs) => this.onTransportObservation(obs))
  }

  /**
   * Stage a punch's quantized block — NO MIDI at punch time.
   *
   * Legacy: one staged slot, newest wins, commit on the next arp boundary.
   * Field: EVERY punch stages into the commit window (the fold collects
   * all contributing eventIds; newest still wins the resolved state). If
   * idle, the grid starts here and boundary 0 fires synchronously — first
   * commit + first step sound within this call (the ch4 accent + step-0
   * double attack is by design). A driver switch silences the departing
   * mode completely first (patch switches re-hello anyway).
   */
  applyGesture(q: QuantizedChange, noteVelocity: number, meta?: GestureMeta): void {
    if (q.commitIntervalTicks !== undefined) {
      if (this.mode === 'legacy') this.stop()
      this.mode = 'field'
      this.stagedSeq += 1
      this.stagedField.push({
        eventId: meta?.eventId ?? `staged-${this.stagedSeq}`,
        q,
        noteVelocity,
        ...(meta?.transportGeneration !== undefined
          ? { transportGeneration: meta.transportGeneration }
          : {}),
        ...(meta?.patchGeneration !== undefined
          ? { patchGeneration: meta.patchGeneration }
          : {}),
      })
      this.lastActivity = { pps: q.activityPps, atMs: this.clock.now() }
      this.stagePendingMutation(meta)
      if (!this.transport.running) {
        this.arpGrid = { phaseTick: 0, intervalTicks: arpIntervalTicksFor(q.notesPerMinute) }
        this.commitGrid = { phaseTick: 0, intervalTicks: q.commitIntervalTicks }
        this.transport.start()
      }
      return
    }

    if (this.mode === 'field') this.stop()
    this.mode = 'legacy'
    this.staged = { q, noteVelocity }
    this.lastActivity = { pps: q.activityPps, atMs: this.clock.now() }
    if (!this.tickClock.running) {
      this.tickClock.start(stepMsFor(q.notesPerMinute))
    }
  }

  /**
   * Silence everything: flush only UNFIRED gated offs (fired callbacks
   * already cleared their own records — never a duplicate note-off), off
   * the held chord + bass, stop both grids, reset. Emits only note-offs.
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
    this.transport.stop()
    this.committed = null
    this.staged = null
    this.stagedField = []
    this.pendingCommit = null
    this.arpGrid = null
    this.commitGrid = null
    this.mode = null
    this.stepCursor = 0
    this.pendingMutation = null
    this.stepIndex = 0
  }

  get running(): boolean {
    return this.tickClock.running || this.transport.running
  }

  get arpChannel(): number {
    return this.opts.arpChannel
  }

  get bassChannel(): number {
    return this.opts.bassChannel
  }

  /** The last canonical harmonic commit applied (field driver). */
  get lastHarmonicCommit(): CompiledHarmonicCommit | null {
    return this.lastCommit
  }

  /** The mutation that currently owns the next step, if any (am. 6). */
  get pendingMicroMutation(): PendingMicroMutation | null {
    return this.pendingMutation
  }

  /**
   * Stage a punch's micro-mutation: it owns the NEXT step and lives at most
   * maxSteps steps. A newer punch replaces an unfired one outright — the
   * newest valid punch owns the next step, and contradictory operations
   * never compose (am. 6).
   */
  private stagePendingMutation(meta?: GestureMeta): void {
    const technique = meta?.technique
    const micro = technique?.microMutation
    if (!technique || !micro || micro.operations.length === 0) return
    if (this.pendingMutation && this.stepIndex <= this.pendingMutation.expiresAfterStepIndex) {
      // The outgoing mutation never got to sound (or is mid-life): it is
      // superseded, not merged.
      this.counters.supersededMutations += 1
    }
    const from = this.stepIndex
    this.pendingMutation = {
      sourcePunchEventId: meta?.eventId ?? 'unknown',
      createdAtTick: this.lastTickObserved,
      appliesFromStepIndex: from,
      expiresAfterStepIndex: from + Math.max(1, Math.min(3, micro.maxSteps)) - 1,
      operations: micro.operations,
      rotation: micro.rotation,
    }
  }

  telemetry(): BrassEngineTelemetry {
    return { ...this.counters }
  }

  /** Wire 0-based channels the engine sounds on — for panic coverage (R5). */
  touchedChannels(): number[] {
    return [this.opts.arpChannel, this.opts.bassChannel]
  }

  // -------------------------------------------------------------------------
  // Legacy driver (TickClock) — byte-equal with the pre-field engine.
  // -------------------------------------------------------------------------

  /** The legacy state machine: commit-or-decay, emit, bass. */
  private onBoundary(): void {
    const { committedThisBoundary, cellChanged } = this.commitOrDecayLegacy()
    if (!this.committed) return
    // tickClock.stepMs already carries the step length this note will
    // actually span (setStepMs takes effect on the NEXT interval).
    this.emitStep(committedThisBoundary, cellChanged, this.tickClock.stepMs)
    this.emitBass(committedThisBoundary)
  }

  private commitOrDecayLegacy(): { committedThisBoundary: boolean; cellChanged: boolean } {
    let committedThisBoundary = false
    let cellChanged = false

    if (this.staged) {
      const { q, noteVelocity } = this.staged
      cellChanged = this.adoptStagedState(q, noteVelocity)
      this.tickClock.setStepMs(stepMsFor(q.notesPerMinute))
      this.staged = null
      committedThisBoundary = true
    } else if (this.committed) {
      // No punch since the last boundary: wind the layer down with the
      // domain's own decay curve + hysteresis (240 → 180 → 120 → 60; the
      // chord stays latched and the engine never auto-stops).
      const def = this.decayedLayerDef()
      if (def) this.tickClock.setStepMs(stepMsFor(def.notesPerMinute))
    }

    return { committedThisBoundary, cellChanged }
  }

  // -------------------------------------------------------------------------
  // Field driver (Transport) — projections of ONE absolute tick position.
  // -------------------------------------------------------------------------

  private onTransportObservation(obs: TransportObservation): void {
    this.lastTickObserved = obs.currentTick
    if (obs.latenessMs > this.counters.maxLatenessMs) {
      this.counters.maxLatenessMs = obs.latenessMs
    }
    const commitGrid = this.commitGrid
    if (!commitGrid || !this.arpGrid) return

    // 1) Harmonic boundaries FIRST, so a commit requested at tick T is
    //    audible at an arp boundary at the SAME tick within this firing.
    const harmonic = crossedBoundaryIndices(obs.previousTick, obs.currentTick, commitGrid)
    if (harmonic.length > 0) {
      // Coalesce (am. 3): one fold at the LATEST crossed boundary — a
      // stall never replays intermediate windows.
      const requestedTick = boundaryTickOf(harmonic[harmonic.length - 1] ?? 0, commitGrid)
      if (this.stagedField.length > 0) {
        const folded = foldHarmonicCommit(this.stagedField, {
          previousCellId: this.committed?.cellId ?? null,
          requestedCommitTick: requestedTick,
          soundingArpGrid: this.arpGrid,
        })
        this.stagedField = []
        if (folded) this.pendingCommit = folded
      }
      // A window-size change takes effect on its OWN boundary: the new
      // interval re-anchors the commit grid from here forward.
      const nextWindow = this.pendingCommit?.winner.q.commitIntervalTicks
      if (nextWindow !== undefined && nextWindow !== commitGrid.intervalTicks) {
        this.commitGrid = { phaseTick: requestedTick, intervalTicks: nextWindow }
      }
    }

    // 2) Arp boundaries: apply-then-step.
    const arp = crossedBoundaryIndices(obs.previousTick, obs.currentTick, this.arpGrid)
    if (arp.length === 0) return
    const latestArpTick = boundaryTickOf(arp[arp.length - 1] ?? 0, this.arpGrid)

    let committedThisBoundary = false
    let cellChanged = false
    const pending = this.pendingCommit
    if (pending && pending.commit.audibleCommitTick <= latestArpTick) {
      cellChanged = this.applyFieldCommit(pending, latestArpTick)
      committedThisBoundary = true
      this.pendingCommit = null
    } else if (this.committed) {
      this.applyFieldDecay(latestArpTick)
    }

    const committed = this.committed
    if (!committed) return

    // Missed-boundary policy (am. 3): stale steps are SKIPPED, the phase
    // advances as if they had played, and only the newest boundary sounds.
    // A commit already owns the cursor (retrigger policy), so pre-commit
    // stale boundaries never advance it.
    if (arp.length > 1) {
      if (!committedThisBoundary && committed.backend === 'punchbridge-tick') {
        const effLen = Math.max(1, Math.min(committed.patternDepth, committed.pattern.length))
        for (let skip = 0; skip < arp.length - 1; skip += 1) {
          this.stepCursor = (this.stepCursor % effLen) + 1
        }
      }
      this.counters.skippedArpSteps += arp.length - 1
    }

    this.emitStep(committedThisBoundary, cellChanged, msForTicks(this.arpGrid.intervalTicks))
    this.emitBass(committedThisBoundary)
  }

  /**
   * Apply ONE canonical commit atomically (am. 4): pool + bass + layer +
   * rate together; the arp grid re-anchors at the boundary the commit
   * actually became audible on. Under a stall that boundary can be later
   * than the folded audibleCommitTick — the stored commit records what
   * actually happened.
   */
  private applyFieldCommit(pending: FoldedHarmonicCommit, atTick: number): boolean {
    const { q, noteVelocity } = pending.winner
    const cellChanged = this.adoptStagedState(q, noteVelocity)
    this.arpGrid = { phaseTick: atTick, intervalTicks: pending.commit.nextArpIntervalTicks }
    this.lastCommit =
      atTick === pending.commit.audibleCommitTick
        ? pending.commit
        : { ...pending.commit, audibleCommitTick: atTick, nextArpPhaseTick: atTick }
    this.counters.commits += 1
    this.counters.lastCommitLagTicks = atTick - pending.commit.requestedCommitTick
    return cellChanged
  }

  /**
   * Decay between commits — FALL-ONLY on the field driver (am. 4): a layer
   * RAISE is part of the atomic harmonic commit at audibleCommitTick, so a
   * staged flurry's fresh pps must not lift the rate early through this
   * path (staged punches refresh lastActivity before their window folds).
   * A genuine wind-down re-anchors the arp grid at this boundary.
   */
  private applyFieldDecay(atTick: number): void {
    const committed = this.committed
    if (!committed) return
    const layerBefore = committed.activityLayer
    const pps = decayPps(this.lastActivity.pps, this.clock.now() - this.lastActivity.atMs)
    const layer = brassLayerFor(pps, layerBefore)
    if (layer >= layerBefore) return
    const def = this.activityLayers[layer]
    if (!def) return
    committed.notesPerMinute = def.notesPerMinute
    committed.gateRatio = def.gateRatio
    committed.patternDepth = def.patternDepth
    committed.activityLayer = layer
    this.arpGrid = { phaseTick: atTick, intervalTicks: arpIntervalTicksFor(def.notesPerMinute) }
  }

  // -------------------------------------------------------------------------
  // Shared state adoption + emit path (identical arithmetic both drivers).
  // -------------------------------------------------------------------------

  /**
   * Adopt one staged QuantizedChange into `committed` — the backend-switch
   * silencing, retrigger cursor policy, and state copy the legacy staged
   * branch always performed, verbatim. Returns cellChanged.
   */
  private adoptStagedState(q: QuantizedChange, noteVelocity: number): boolean {
    let cellChanged = this.committed === null || q.cubeCellId !== this.committed.cellId
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
    return cellChanged
  }

  /**
   * Between-punch decay against the shared ladder. Mutates `committed`'s
   * energy fields when the layer falls and returns the new layer def (the
   * caller applies the rate to its own grid), else null.
   */
  private decayedLayerDef(): BrassActivityLayer | null {
    const committed = this.committed
    if (!committed) return null
    const pps = decayPps(this.lastActivity.pps, this.clock.now() - this.lastActivity.atMs)
    const layer = brassLayerFor(pps, committed.activityLayer)
    if (layer === committed.activityLayer) return null
    const def = this.activityLayers[layer]
    if (!def) return null
    committed.notesPerMinute = def.notesPerMinute
    committed.gateRatio = def.gateRatio
    committed.patternDepth = def.patternDepth
    committed.activityLayer = layer
    return def
  }

  /** One boundary's sound: tick stepping OR the note-fx chord latch. */
  private emitStep(committedThisBoundary: boolean, cellChanged: boolean, stepMs: number): void {
    const committed = this.committed
    if (!committed) return

    if (committed.backend === 'punchbridge-tick') {
      const effLen = Math.max(1, Math.min(committed.patternDepth, committed.pattern.length))
      const basePatternIndex = committed.pattern[this.stepCursor % effLen] ?? 0
      // Micro-mutation (M40-22A): the owning punch's operation colours THIS
      // step only — the running phase is never restarted, so the mutation
      // is audible without the pattern lurching.
      const patternIndex = this.mutatedPatternIndex(basePatternIndex)
      const note =
        committed.rotatedPool[Math.min(patternIndex, committed.rotatedPool.length - 1)] ?? 0
      this.flushPendingStepOff()
      this.midi.send(noteOn(this.opts.arpChannel, note, committed.noteVelocity))
      // Gate < 1 ends the step early, so the off always lands before the
      // next on at any rate transition (stepMs already carries the step
      // length this note will actually span).
      const gateMs = Math.round(stepMs * committed.gateRatio)
      const record: PendingNoteOff = { handle: null, channel: this.opts.arpChannel, note }
      record.handle = this.scheduler.setTimeout(() => {
        // Self-clearing (legatoMove's pendingOffs pattern): the record is
        // nulled BEFORE sending, so stop()/panic flush only unfired offs.
        this.pendingStepOff = null
        this.midi.send(noteOff(record.channel, record.note))
      }, gateMs)
      this.pendingStepOff = record
      this.stepCursor = (this.stepCursor % effLen) + 1
      this.stepIndex += 1
      // An expired mutation is dropped so it can never colour a later step.
      if (this.pendingMutation && this.stepIndex > this.pendingMutation.expiresAfterStepIndex) {
        this.pendingMutation = null
      }
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
  }

  /**
   * Apply the owning micro-mutation's leading operation to ONE step's
   * pool index. Operations are interpreted against the running pattern's
   * index space, never against harmony: a mutation can move which pool
   * tone this step takes, and nothing else. The chord, bass, and rate are
   * untouched — only a harmonic commit moves those.
   */
  private mutatedPatternIndex(baseIndex: number): number {
    const mutation = mutationForStep(this.pendingMutation, this.stepIndex)
    if (!mutation) return baseIndex
    const operation = mutation.operations[this.stepIndex - mutation.appliesFromStepIndex]
    if (operation === undefined) return baseIndex
    const poolSize = this.committed?.rotatedPool.length ?? 6
    const wrap = (i: number): number => ((i % poolSize) + poolSize) % poolSize
    let index = baseIndex
    switch (operation) {
      case 'advance':
        index = wrap(baseIndex + 1)
        break
      case 'skip':
        index = wrap(baseIndex + 2)
        break
      case 'reverse':
        index = wrap(baseIndex - 1)
        break
      case 'land-root':
        index = 0
        break
      case 'land-fifth':
        index = 2
        break
      case 'land-upper-anchor':
        index = 5
        break
      case 'octave-pulse-up':
      case 'octave-pulse-down':
      case 'lower-inversion':
        // Register moves ride the voice, not the pattern index: the step
        // keeps its tone here (the octave lands with M40-22B's plan).
        index = baseIndex
        break
      default:
        return baseIndex
    }
    // The hand's rotation nudges which side of the pool the step leans to.
    index = wrap(index + mutation.rotation)
    if (index !== baseIndex) this.counters.mutatedSteps += 1
    return index
  }

  /**
   * Bass (both backends): only a committed root CHANGE moves it — new on
   * first, old off after the overlap; Mojito's glide does the travel.
   */
  private emitBass(committedThisBoundary: boolean): void {
    const committed = this.committed
    if (!committed) return
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
