/**
 * Runtime coach-asset resolvers — the bridge between the compiler's
 * abstract `CoachAssetResolver` interface and the shipped audio
 * catalogs (M39-V2 W1 Epic Slice 3-a-ii, principle #0).
 *
 * The compiler's `workoutScore.compileWorkoutScore(workout, {coachAssets})`
 * asks "give me the asset for this (contentKind, vocabulary,
 * comboSignature)". At compile time in production, the answer comes
 * from the combo-announce manifest (and, in future slices, the
 * sustained + coasting + technique-standalone manifests).
 *
 * ## Vocabulary vocabulary
 *
 * The compiler uses `'numeric'` / `'technique'`; the audio catalogs
 * use `'numbers'` / `'techniques'`. Translated at the resolver
 * boundary — the rest of the runtime keeps its `'numbers'` /
 * `'techniques'` terminology, and the domain stays in `'numeric'` /
 * `'technique'`.
 *
 * ## Duration
 *
 * Combo-announce clips carry `durationMs` (measured post-render);
 * `mappedDurationTicks` is only populated when the render pipeline
 * has emitted the V2 field. When absent, ticks are computed from
 * `durationMs` using the compiler's 60-BPM 960-PPQN tick space —
 * one clip second = 960 transport ticks. That matches
 * `workoutScore.MS_PER_TRANSPORT_TICK` exactly.
 *
 * Pure TypeScript — no clocks, no side effects, no React, no Expo.
 * Same purity rules as `src/domain/*`; lives here because the
 * combo-announce manifest is audio-side.
 */

import {
  findComboAnnounce,
  type ComboAnnounceClip,
} from './voiceAssets/comboAnnounceManifest'
import type {
  CoachAssetContext,
  CoachAssetRef,
  CoachAssetResolver,
} from '@domain/programs/compileCue'
import type { CoachContentKind } from '@domain/coach/VoicePolicy'
import { TRANSPORT_TICKS_PER_PULSE } from '@domain/timing/TimingEngine'

const MS_PER_TRANSPORT_TICK = 60_000 / (60 * TRANSPORT_TICKS_PER_PULSE)

function ticksAtMs(ms: number): number {
  return Math.round(ms / MS_PER_TRANSPORT_TICK)
}

function refFromCombo(clip: ComboAnnounceClip): CoachAssetRef {
  const mappedDurationTicks = clip.mappedDurationTicks ?? ticksAtMs(clip.durationMs)
  const base: CoachAssetRef = {
    assetId: clip.id,
    mappedDurationTicks,
  }
  return clip.taughtStrikeOffsetsTicks
    ? { ...base, taughtStrikeOffsetsTicks: clip.taughtStrikeOffsetsTicks }
    : base
}

function vocabForCatalog(
  vocabulary: 'numeric' | 'technique',
): 'numbers' | 'techniques' {
  return vocabulary === 'numeric' ? 'numbers' : 'techniques'
}

function resolveComboAnnounce(
  vocabulary: 'numeric' | 'technique',
  context: CoachAssetContext,
): CoachAssetRef | undefined {
  if (!context.comboSignature) return undefined
  const clip = findComboAnnounce(context.comboSignature, vocabForCatalog(vocabulary))
  if (!clip) return undefined
  return refFromCombo(clip)
}

/**
 * The production coach-asset resolver used by the workout runner.
 * Currently backs only `combo-announce` — sustained / coast /
 * encouragement / phase-announce content kinds fold in as their
 * runtime consumers land (Slice 6). An unsupported kind returns
 * `undefined`, which the compiler treats as a silent slot per
 * principle #11.
 */
export const runtimeCoachAssetResolver: CoachAssetResolver = (
  contentKind: CoachContentKind,
  vocabulary: 'numeric' | 'technique',
  context: CoachAssetContext,
) => {
  switch (contentKind) {
    case 'combo-announce':
      return resolveComboAnnounce(vocabulary, context)
    default:
      return undefined
  }
}
