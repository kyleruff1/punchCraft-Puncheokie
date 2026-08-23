/**
 * Which priority a clip carries (M34-03, doc §18.2).
 *
 * `VoiceOutputPort.playAsset` takes an id and a deadline but no priority —
 * so the priority has to be derivable from the id, or the doc's interruption
 * order could not be applied to assets at all. Deriving it once, here, means
 * the announcer's `cancel` calls and the output queue (M34-04) agree by
 * construction rather than by two people reading §18.2 the same way.
 *
 * Pure TypeScript (spec §15.1).
 */

import { AUDIO_PRIORITY, type AudioPriority, type VoiceAssetId } from './VoiceOutputPort'

const DEFENSE_FOOTWORK: ReadonlySet<VoiceAssetId> = new Set<VoiceAssetId>([
  'slip',
  'roll',
  'duck',
  'pull',
  'bob-weave',
  'pivot',
  'step-off',
  'circle',
  'cut-off-ring',
  'reset',
])

export function assetPriority(id: VoiceAssetId): AudioPriority {
  // A stop call is the safety rung: it outranks everything, including the
  // bell, because it is the one that means "stop moving".
  if (id === 'stop') return AUDIO_PRIORITY.safety
  if (id === 'bell' || id === 'tone-warning') return AUDIO_PRIORITY.bell
  if (DEFENSE_FOOTWORK.has(id)) return AUDIO_PRIORITY.defenseFootwork
  // Numbers, the body suffix, `go`, `switch`, and the ready/repeat tones are
  // all part of calling the combination.
  return AUDIO_PRIORITY.punchCommand
}
