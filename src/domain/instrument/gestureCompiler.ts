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
import { cellAt, type CompiledCubeMap } from './cubeCompiler'
import type { CompiledPunchGesture, MusicalPunchInput } from './gestureSchema'
import { INSTRUMENT_SCHEMA_VERSION } from './gestureSchema'
import {
  activityLayerAt,
  emptyActivity,
  notePunch,
  rate01At,
  type ActivityState,
} from './activityEnvelope'
import { advanceVoice, emptyLatch, type InstrumentLatchState } from './latchedVoice'
import type { ModulationDestination, PunchPatch } from './punchPatch'
import { overshootCents, transitionDurationMs, transitionKind } from './transitions'
import { positionInZone, quantizeZone, type ZoneState } from './zoneQuantizer'

/** Alternating-hands window (instrument-design §20). */
export const ALTERNATION_WINDOW_MS = 450

export interface InstrumentSessionState {
  latch: InstrumentLatchState
  zones: { left: ZoneState | null; right: ZoneState | null }
  activity: ActivityState
  lastLive: { hand: 'left' | 'right'; atMs: number } | null
}

export function emptySessionState(): InstrumentSessionState {
  return { latch: emptyLatch(), zones: { left: null, right: null }, activity: emptyActivity(), lastLive: null }
}

export interface CompileContext {
  sessionId: string
  patch: PunchPatch
  cubeMap: CompiledCubeMap
  /** Normalized readings from the caller's per-hand scalers. */
  velocity01: number
  acceleration01: number
}

export interface CompiledResult {
  gesture: CompiledPunchGesture
  state: InstrumentSessionState
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

  const now = input.receivedMonotonicTimeMs
  const hand = input.hand
  const zoneCount = ctx.patch.zoneCount

  // Zone with hysteresis, per hand.
  const prevZone = state.zones[hand]
  const zoneState = quantizeZone(prevZone, ctx.velocity01, zoneCount)
  const zone = zoneState.currentZone

  // Cube coordinate: punched hand takes its new zone; the other hand
  // holds its latched zone (0 while that voice has never sounded).
  const leftZone = hand === 'left' ? zone : (state.latch.left.zone ?? 0)
  const rightZone = hand === 'right' ? zone : (state.latch.right.zone ?? 0)
  const cell = cellAt(ctx.cubeMap, leftZone, rightZone)
  const targetNote = hand === 'left' ? cell.leftMidiNote : cell.rightMidiNote

  // Latch + activity + alternation, all against the event's own clock.
  const advanced = advanceVoice(state.latch, hand, zone, targetNote, now)
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

  const gesture: CompiledPunchGesture = {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
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
      velocity: Math.round(40 + 87 * ctx.acceleration01),
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
  }

  return {
    gesture,
    state: {
      latch: advanced.state,
      zones: { ...state.zones, [hand]: zoneState },
      activity,
      lastLive: { hand, atMs: now },
    },
  }
}
