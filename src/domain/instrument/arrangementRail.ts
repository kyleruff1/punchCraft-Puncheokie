/**
 * The arrangement rail (M40-22C, technique-motif-design §11, second-pass
 * am. 7).
 *
 * THE SINGLE-AUTHORITY RULE. Before this module the Z ladder chose arp
 * rate, gate, and depth directly from activity, which meant a flurry could
 * lurch the whole arrangement mid-bar. The three layers are now ranked:
 *
 *   raw activity  — continuous, event-derived energy
 *   Z layer       — immediate hysteretic quantization of raw activity
 *   Scene         — bar-quantized, RATE-LIMITED projection of Z
 *
 * and ownership follows the ranking. The SCENE alone owns the persistent
 * arrangement: arp rate, gate, maximum depth, drum arrangement, the
 * persistent brightness ceiling, and whammy eligibility. Raw activity and
 * Z may modulate only WITHIN those ceilings — wah amount, transient
 * velocity, cloud density, temporary filter movement. Z and Scene never
 * independently select rate or depth.
 *
 * Scene ordinals line up with the Z ladder (pocket 0 … peak 3), so "the
 * scene caps Z" is literally `min(zLayer, sceneIndex)` — a flurry raises
 * wah and transients NOW and may raise the scene one level at the next
 * bar, never Pocket → Peak in one jump.
 *
 * Pure and deterministic; no clocks, no randomness, no RN imports.
 */
import { TRANSPORT_TICKS_PER_BEAT } from './transportGrid'

export type ArrangementScene = 'pocket' | 'groove' | 'drive' | 'peak'

export const ARRANGEMENT_SCENES: readonly ArrangementScene[] = [
  'pocket',
  'groove',
  'drive',
  'peak',
]

/** Four beats at 960 ticks — the bar the rail quantizes to. */
export const BAR_TICKS = TRANSPORT_TICKS_PER_BEAT * 4

/** Bars a scene must hold before it may step DOWN (up is once per bar). */
export const SCENE_COOLDOWN_BARS_DOWN = 2

export interface SceneCeilings {
  /** The fastest the arp may run in this scene. */
  notesPerMinute: 60 | 120 | 180 | 240
  /** The shortest gate this scene allows (longer = more legato). */
  gateRatio: number
  /** The deepest pattern this scene exposes. */
  maxPatternDepth: number
  /** How busy the drum arrangement may be. */
  drumArrangement: 'sparse' | 'steady' | 'driving' | 'peak'
  /** Persistent brightness ceiling; Z modulates BELOW it. */
  brightnessCeiling: number
  /** Only the top scene licenses the whammy (design §11). */
  whammyEligible: boolean
}

export const SCENE_CEILINGS: Readonly<Record<ArrangementScene, SceneCeilings>> = {
  pocket: {
    notesPerMinute: 60,
    gateRatio: 0.75,
    maxPatternDepth: 3,
    drumArrangement: 'sparse',
    brightnessCeiling: 0.6,
    whammyEligible: false,
  },
  groove: {
    notesPerMinute: 120,
    gateRatio: 0.65,
    maxPatternDepth: 4,
    drumArrangement: 'steady',
    brightnessCeiling: 0.75,
    whammyEligible: false,
  },
  drive: {
    notesPerMinute: 180,
    gateRatio: 0.55,
    maxPatternDepth: 6,
    drumArrangement: 'driving',
    brightnessCeiling: 0.9,
    whammyEligible: false,
  },
  peak: {
    notesPerMinute: 240,
    gateRatio: 0.45,
    maxPatternDepth: 8,
    drumArrangement: 'peak',
    brightnessCeiling: 1,
    whammyEligible: true,
  },
}

export function sceneIndexOf(scene: ArrangementScene): number {
  return ARRANGEMENT_SCENES.indexOf(scene)
}

export interface ArrangementState {
  scene: ArrangementScene
  /** The bar this scene was entered on — the rate limiter's anchor. */
  enteredAtBar: number
  /** Null until the first commit initialises the rail from live energy. */
  initialised: boolean
}

export function emptyArrangementState(): ArrangementState {
  return { scene: 'pocket', enteredAtBar: 0, initialised: false }
}

/** Which bar a tick belongs to. */
export function barIndexAt(tick: number): number {
  return Math.floor(tick / BAR_TICKS)
}

/**
 * Project the Z layer onto the scene rail at a BAR BOUNDARY.
 *
 * The first call initialises the rail to the jam's opening energy (an
 * initial scene is not a change, so a hard opening punch is not throttled
 * to Pocket). After that the rail moves at most one level per bar upward,
 * and at most one level downward after a cooldown — so Pocket can never
 * jump to Peak, and a single soft moment cannot collapse the arrangement.
 *
 * Calling this off a bar boundary returns the state untouched: scene
 * changes are bar-quantized by construction, not by convention.
 */
export function advanceArrangement(
  state: ArrangementState,
  zLayer: 0 | 1 | 2 | 3,
  atTick: number,
  isBarBoundary: boolean,
): ArrangementState {
  const bar = barIndexAt(atTick)
  if (!state.initialised) {
    return { scene: ARRANGEMENT_SCENES[zLayer] ?? 'pocket', enteredAtBar: bar, initialised: true }
  }
  if (!isBarBoundary) return state

  const current = sceneIndexOf(state.scene)
  if (zLayer > current) {
    if (bar <= state.enteredAtBar) return state // one step per bar, no more
    const next = ARRANGEMENT_SCENES[current + 1]
    return next ? { scene: next, enteredAtBar: bar, initialised: true } : state
  }
  if (zLayer < current) {
    if (bar - state.enteredAtBar < SCENE_COOLDOWN_BARS_DOWN) return state
    const next = ARRANGEMENT_SCENES[current - 1]
    return next ? { scene: next, enteredAtBar: bar, initialised: true } : state
  }
  return state
}

/**
 * The energy a layer may actually express: the scene caps Z. This is the
 * one place rate/gate/depth are decided, so Z and Scene can never select
 * them independently.
 */
export function cappedLayerFor(scene: ArrangementScene, zLayer: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  const capped = Math.min(zLayer, sceneIndexOf(scene))
  return Math.max(0, capped) as 0 | 1 | 2 | 3
}

/** What Z may still modulate, bounded by the scene's ceilings. */
export interface SceneModulation {
  /** 0..1 wah depth — free to move within the bar. */
  wahAmount: number
  /** Multiplier on the impact transient's velocity. */
  transientGain: number
  /** 0..brightnessCeiling — never above the scene's ceiling. */
  brightness: number
}

/**
 * Z's remaining expressive room. These move on every punch; nothing here
 * can raise the persistent arrangement, only colour it under the ceiling.
 */
export function modulationWithin(
  scene: ArrangementScene,
  activity01: number,
  acceleration01: number,
): SceneModulation {
  const ceilings = SCENE_CEILINGS[scene]
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
  return {
    wahAmount: clamp01(0.25 + 0.75 * acceleration01),
    transientGain: 1 + 0.5 * clamp01(activity01),
    brightness: clamp01(0.35 + 0.65 * acceleration01) * ceilings.brightnessCeiling,
  }
}

/** Design §11: only the top scene licenses the whammy. */
export function whammyAllowed(scene: ArrangementScene): boolean {
  return SCENE_CEILINGS[scene].whammyEligible
}
