/**
 * The gesture compiler — one live punch in, one CompiledPunchGesture out
 * (instrument-design §3, note-cube-design §9). Consumes the pre-compiled
 * cube map; never computes notes itself. Deterministic: time is the
 * event's own receivedMonotonicTimeMs, so an identical input stream with
 * an identical patchHash replays byte-identically (acceptance #12).
 *
 * Normalization (rolling scalers) stays OUTSIDE — the caller passes
 * velocity01/acceleration01 so this stays a pure fold over state.
 */
import { brassCellAt, type CompiledBrassCubeMap } from './brassCube'
import { cellAt, type CompiledCubeMap } from './cubeCompiler'
import type { CompiledHarmonicField } from './harmonicField'
import {
  advanceOrbit,
  BAND_COUNT_BY_FREEDOM,
  bandMembers,
  subindexInBand,
  ZONE_TO_SURFACE_BAND,
  type OrbitState,
} from './surfaceNavigator'
import type {
  CompiledPunchGesture,
  HarmonicIntent,
  ImmediateAccent,
  MusicalPunchInput,
  QuantizedChange,
  WhammyAccent,
} from './gestureSchema'
import { HARMONIC_SCHEMA_VERSION, INSTRUMENT_SCHEMA_VERSION } from './gestureSchema'
import type { TechniqueBlock } from './gestureSchema'
import {
  resolveStrikeArticulation,
  resolveStrikeIdentity,
} from './strikeArticulationCatalog'
import { msForTicks } from './transportGrid'
import {
  activityAt,
  activityLayerAt,
  brassLayerFor,
  emptyActivity,
  notePunch,
  rate01At,
  type ActivityState,
} from './activityEnvelope'
import { advanceVoice, emptyLatch, type InstrumentLatchState } from './latchedVoice'
import type { ModulationDestination, PunchPatch } from './punchPatch'
import { overshootCents, transitionDurationMs, transitionKind } from './transitions'
import { emptyPeaks, notePeak, type PeakState } from './velocityPeak'
import { positionInZone, quantizeZone, type ZoneState } from './zoneQuantizer'

/** Alternating-hands window (instrument-design §20). */
export const ALTERNATION_WINDOW_MS = 450

export interface InstrumentSessionState {
  latch: InstrumentLatchState
  zones: { left: ZoneState | null; right: ZoneState | null }
  activity: ActivityState
  lastLive: { hand: 'left' | 'right'; atMs: number } | null
  /** Per-hand session peaks — the whammy gate (velocityPeak.ts). */
  peaks: PeakState
  /** Last committed brass activity layer (hysteresis anchor). */
  brassLayer: 0 | 1 | 2 | 3
  /**
   * Per-hand surface orbit (harmonic-field-v2 §9) — sample-and-hold like
   * the latch; session-only, never on the wire (R1 safe).
   */
  orbit: { left: OrbitState | null; right: OrbitState | null }
}

export function emptySessionState(): InstrumentSessionState {
  return {
    latch: emptyLatch(),
    zones: { left: null, right: null },
    activity: emptyActivity(),
    lastLive: null,
    peaks: emptyPeaks(),
    brassLayer: 0,
    orbit: { left: null, right: null },
  }
}

export interface CompileContext {
  sessionId: string
  patch: PunchPatch
  cubeMap: CompiledCubeMap
  /** Present for brass-cube patches; MUST agree with cubeMap's patchHash. */
  brassMap?: CompiledBrassCubeMap
  /** Present for harmonic-field patches; MUST agree with cubeMap's patchHash. */
  field?: CompiledHarmonicField
  /** Normalized readings from the caller's per-hand scalers. */
  velocity01: number
  acceleration01: number
}

export interface CompiledResult {
  gesture: CompiledPunchGesture
  state: InstrumentSessionState
}

function clamp(lo: number, hi: number, value: number): number {
  return Math.max(lo, Math.min(hi, value))
}

function curveValue(curve: string, t: number): number {
  const x = Math.max(0, Math.min(1, t))
  switch (curve) {
    case 'exponential':
      return x * x
    case 'smooth':
      return x * x * (3 - 2 * x)
    case 'threshold':
      return x >= 0.5 ? 1 : 0
    default:
      return x
  }
}

/**
 * Sum the routes targeting one destination into 0..1 (amounts are signed
 * percent; negative routes subtract).
 */
function routesFor(
  destination: ModulationDestination,
  patch: PunchPatch,
  sources: Record<string, number>,
): number {
  let total = 0
  for (const route of patch.modulationRoutes) {
    if (route.destination !== destination) continue
    total += (route.amount / 100) * curveValue(route.curve, sources[route.source] ?? 0)
  }
  return Math.max(0, Math.min(1, total))
}

/**
 * Compile one live punch. Returns null for recovered events — history
 * must never move the instrument (§15).
 */
export function compileGesture(
  input: MusicalPunchInput,
  state: InstrumentSessionState,
  ctx: CompileContext,
): CompiledResult | null {
  if (input.recovered) return null

  // Defensive one-map invariant: the brass map and the cube map must be
  // compiled from the SAME patch, or MIDI and visual could disagree.
  if (ctx.brassMap && ctx.brassMap.patchHash !== ctx.cubeMap.patchHash) {
    throw new Error(
      `brassMap/cubeMap patchHash mismatch (${ctx.brassMap.patchHash} vs ${ctx.cubeMap.patchHash})`,
    )
  }
  if (ctx.field && ctx.field.patchHash !== ctx.cubeMap.patchHash) {
    throw new Error(
      `field/cubeMap patchHash mismatch (${ctx.field.patchHash} vs ${ctx.cubeMap.patchHash})`,
    )
  }

  const now = input.receivedMonotonicTimeMs
  const hand = input.hand
  const zoneCount = ctx.patch.zoneCount

  // Zone with hysteresis, per hand.
  const prevZone = state.zones[hand]
  const zoneState = quantizeZone(prevZone, ctx.velocity01, zoneCount)
  const zone = zoneState.currentZone

  // Surface navigation (harmonic-field-v2 §§4,9, review-amended): for field
  // patches the committed zone collapses to a freedom band; ABSOLUTE lands
  // on the zone's subindex within the band, ORBIT advances at most once per
  // commit window (per-commit policy — flurry parity can never flip the
  // final chord). The latch then HOLDS resolved indices, so the other
  // hand's coordinate stays resolved too. Non-field patches skip all of
  // this — resolvedIndex === zone and the orbit state carries through.
  const fieldSection = ctx.patch.harmonicField
  let orbit = state.orbit
  let resolvedIndex = zone
  let intentBand: number | undefined
  let intentWindow: number | undefined
  if (fieldSection && ctx.field) {
    const bandCount = BAND_COUNT_BY_FREEDOM[fieldSection.freedom]
    const band = ZONE_TO_SURFACE_BAND[bandCount][zone] ?? 0
    // Right-axis members read the CURRENT chord node's explicit role
    // groups; the current chord is the held (or just-punched) left index.
    const currentLeftIndex = hand === 'left' ? undefined : (state.latch.left.zone ?? 0)
    const roleNode =
      hand === 'right'
        ? (ctx.field.section.nodes[Math.max(0, Math.min(5, currentLeftIndex ?? 0))] ?? null)
        : null
    const members = bandMembers(hand, bandCount, band, roleNode)
    // Ticks are canonical (am. 3); the tablet's window key derives ms from
    // them — 480 ticks → 500 ms, identical indices to the shipped goldens.
    const windowIndex = Math.floor(now / msForTicks(fieldSection.commitIntervalTicks))
    const advancedOrbit = advanceOrbit(
      state.orbit[hand],
      band,
      members.length,
      fieldSection.navigation,
      windowIndex,
      subindexInBand(bandCount, zone),
    )
    resolvedIndex = members[advancedOrbit.memberIndex] ?? members[0] ?? 0
    orbit = { ...state.orbit, [hand]: advancedOrbit }
    intentBand = band
    intentWindow = windowIndex
  }

  // Cube coordinate: punched hand takes its resolved index; the other hand
  // holds its latched index (0 while that voice has never sounded).
  const leftZone = hand === 'left' ? resolvedIndex : (state.latch.left.zone ?? 0)
  const rightZone = hand === 'right' ? resolvedIndex : (state.latch.right.zone ?? 0)
  const cell = cellAt(ctx.cubeMap, leftZone, rightZone)
  const targetNote = hand === 'left' ? cell.leftMidiNote : cell.rightMidiNote

  // Latch + activity + alternation, all against the event's own clock.
  // The latch stores the RESOLVED index (=== the raw zone for non-field
  // patches), so held coordinates and Next-Punch behavior stay coherent.
  const advanced = advanceVoice(state.latch, hand, resolvedIndex, targetNote, now)
  const activity = notePunch(state.activity, now)
  const gapMs = state.lastLive ? Math.max(0, now - state.lastLive.atMs) : 0
  const alternating =
    state.lastLive !== null && state.lastLive.hand !== hand && gapMs <= ALTERNATION_WINDOW_MS

  const rate01 = rate01At(activity, now)
  const layer = activityLayerAt(activity, now)
  const inZone = positionInZone(ctx.velocity01, zone, zoneCount)

  const sources: Record<string, number> = {
    'velocity-in-zone': inZone,
    acceleration: ctx.acceleration01,
    'punch-rate': rate01,
    alternation: alternating ? 1 : 0,
  }

  const noteVelocityMod = routesFor('note-velocity', ctx.patch, sources)
  const brightnessMod = routesFor('filter-cutoff', ctx.patch, sources)
  const expressionMod = routesFor('delay-send', ctx.patch, sources)
  const widthMod = routesFor('stereo-width', ctx.patch, sources)

  const duration = transitionDurationMs(advanced.zoneDistance, rate01, ctx.patch)
  const voiceDef = hand === 'left' ? ctx.patch.leftVoice : ctx.patch.rightVoice

  // Peak fold — always advanced, even for patches that never fire a whammy,
  // so switching patches mid-session cannot reset the bar.
  const peakFold = notePeak(state.peaks, hand, input.velocityRaw, now)

  // Brass blocks: the punched hand's new zone + the other hand's latched
  // zone stage ONE cell; the bridge commits it on the next step boundary.
  let accent: ImmediateAccent | undefined
  let quantized: QuantizedChange | undefined
  let brassLayer = state.brassLayer
  let transientMultiplier = 1
  if (ctx.patch.brassCube && ctx.brassMap) {
    const brassCell = brassCellAt(ctx.brassMap, leftZone, rightZone)
    const pps = activityAt(activity, now)
    brassLayer = brassLayerFor(pps, state.brassLayer)
    const layerDef = ctx.brassMap.activityLayers[brassLayer]
    transientMultiplier = layerDef.transientMultiplier
    accent = {
      midiNote: brassCell.startMidiNote,
      midiVelocity: clamp(1, 127, Math.round(50 + 68 * ctx.acceleration01)),
      channel: ctx.brassMap.accentMidiChannel,
      gateMs: ctx.brassMap.accentGateMs,
    }
    // Stable sample routing (am. 6): a field patch names the chord by its
    // STABLE id and the slot its bank was rendered at, so the tension
    // ordering of the left axis cannot mis-route the tablet's samples.
    const fieldNode = fieldSection?.nodes[Math.max(0, Math.min(5, leftZone))]
    quantized = {
      cubeCellId: brassCell.cellId,
      chordName: brassCell.chordName,
      ...(fieldNode
        ? { chordId: fieldNode.chordId, sampleBankSlot: fieldNode.legacySampleBankSlot }
        : {}),
      bassMidiNote: brassCell.bassMidiNote,
      bassChannel: ctx.brassMap.bassMidiChannel,
      chordMidiNotes: brassCell.rotatedPool,
      arpStartIndex: brassCell.startIndex,
      arpPattern: brassCell.arpPattern,
      arpChannel: ctx.brassMap.arpMidiChannel,
      notesPerMinute: layerDef.notesPerMinute,
      gateRatio: layerDef.gateRatio,
      patternDepth: layerDef.patternDepth,
      activityLayer: brassLayer,
      activityPps: pps,
      retrigger: ctx.brassMap.retrigger,
      backend: ctx.brassMap.arpBackend,
      // Harmonic commit grid (v2 §12) — field patches only; its absence
      // keeps every v1 brass gesture byte-identical.
      ...(fieldSection ? { commitIntervalTicks: fieldSection.commitIntervalTicks } : {}),
    }
  }

  // Technique block (M40-20/21/22A) — field patches only, so legacy and
  // brass-only gestures stay byte-identical. The identity policy decides
  // what may be CLAIMED: a guided score's token yields the full signature,
  // free jam stays generic (hand-only articulation, never a technique
  // name). Punch type never touches the harmony computed above.
  let technique: TechniqueBlock | undefined
  if (fieldSection && ctx.field) {
    const identity = resolveStrikeIdentity({
      ...(input.expectedStrikeToken ? { expectedStrikeToken: input.expectedStrikeToken } : {}),
      hand,
    })
    const articulation = resolveStrikeArticulation(identity, hand)
    technique = {
      identitySource: identity.source,
      immediateSignatureId: articulation.signatureId,
      ...(identity.token ? { token: identity.token } : {}),
      ...(identity.family ? { family: identity.family } : {}),
      microMutation: {
        operations: [...articulation.microArp.operations],
        maxSteps: articulation.microArp.maxSteps,
        rotation: articulation.microArp.rotation,
      },
    }
  }

  // Exceptional-peak whammy — patch-gated, orthogonal to the brass blocks.
  const whammyCfg = ctx.patch.transition.whammy
  const whammy: WhammyAccent | undefined =
    whammyCfg && peakFold.accent
      ? {
          direction: 'rise',
          semitones: whammyCfg.semitones,
          durationMs: Math.round(
            whammyCfg.minDurationMs +
              (whammyCfg.maxDurationMs - whammyCfg.minDurationMs) * ctx.acceleration01,
          ),
        }
      : undefined

  const gesture: CompiledPunchGesture = {
    // Field patches speak protocol 2 (fail-closed against pre-field
    // bridges — am. 8); everything else stays on 1 byte-identically.
    schemaVersion: fieldSection ? HARMONIC_SCHEMA_VERSION : INSTRUMENT_SCHEMA_VERSION,
    sessionId: ctx.sessionId,
    eventId: input.eventId,
    mapHash: ctx.cubeMap.patchHash,
    source: {
      hand,
      ...(input.trackerTimestampMs !== undefined
        ? { trackerTimestampMs: input.trackerTimestampMs }
        : {}),
      receivedMonotonicTimeMs: now,
      velocity01: ctx.velocity01,
      acceleration01: ctx.acceleration01,
      punchRate01: rate01,
      gapSincePreviousPunchMs: gapMs,
      alternating,
      ...(input.expectedStrikeToken ? { expectedStrikeToken: input.expectedStrikeToken } : {}),
    },
    cube: {
      leftZone,
      rightZone,
      activityLayer: layer,
      changedAxis: hand,
      targetCoordinate: [leftZone, rightZone, layer],
    },
    voice: {
      voiceId: hand,
      midiChannel: voiceDef.midiChannel,
      targetNote,
      // 40..127 baseline rides acceleration when no route claims it.
      noteVelocity: Math.round(
        40 + 87 * (noteVelocityMod > 0 ? noteVelocityMod : ctx.acceleration01),
      ),
      brightness: Math.round(50 + 77 * brightnessMod),
      expression: Math.round(80 + 47 * expressionMod),
      transition: transitionKind(advanced.change, ctx.patch),
      transitionDurationMs: advanced.change === 'same-zone' ? 0 : duration,
      pitchOvershootCents:
        advanced.change === 'same-zone' ? 0 : overshootCents(ctx.acceleration01, ctx.patch),
    },
    transient: {
      note: 36,
      // Brass patches scale the impact by the layer's ladder multiplier;
      // legacy patches keep the unscaled formula byte-for-byte (R1).
      velocity: quantized
        ? clamp(1, 127, Math.round((40 + 87 * ctx.acceleration01) * transientMultiplier))
        : Math.round(40 + 87 * ctx.acceleration01),
      layer: 'generic',
    },
    visual: {
      quadrant:
        hand === 'left'
          ? ctx.acceleration01 >= 0.5
            ? 'upper-left'
            : 'lower-left'
          : ctx.acceleration01 >= 0.5
            ? 'upper-right'
            : 'lower-right',
      hueDegrees: cell.colorHue,
      opacity: Math.min(1, 0.3 + 0.7 * ctx.acceleration01),
      radius: Math.min(0.3, 0.06 + 0.12 * ctx.velocity01 + 0.08 * widthMod),
      persistenceMs: Math.round(3000 + 3000 * rate01),
      transitionRibbonMs: advanced.change === 'same-zone' ? 0 : duration,
    },
    // Appended AFTER visual — JSON key order is part of the determinism
    // goldens, and absent blocks keep legacy gestures byte-identical (R1).
    ...(accent ? { accent } : {}),
    ...(quantized ? { quantized } : {}),
    ...(whammy ? { whammy } : {}),
    ...(intentBand !== undefined && intentWindow !== undefined
      ? {
          harmonicIntent: {
            band: intentBand,
            memberIndex: orbit[hand]?.memberIndex ?? 0,
            commitWindowIndex: intentWindow,
          } satisfies HarmonicIntent,
        }
      : {}),
    ...(technique ? { technique } : {}),
  }

  return {
    gesture,
    state: {
      latch: advanced.state,
      zones: { ...state.zones, [hand]: zoneState },
      activity,
      lastLive: { hand, atMs: now },
      peaks: peakFold.state,
      brassLayer,
      orbit,
    },
  }
}
