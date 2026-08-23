/**
 * Asset id → clip file, per vocabulary (M34-04, D15, D16).
 *
 * Two vocabularies share one set of ids: `'1'` is "one" in `numbers` and
 * "jab" in `names`. That is the whole reason vocabulary lives here rather
 * than in the id — the announcer decides *what* is said, the manifest
 * decides *which recording says it*.
 *
 * `require()` rather than `import`: Metro resolves static assets by module
 * id, and there is no import form that yields one.
 *
 * The clips are currently Windows SAPI placeholders. D16 ships Kokoro-82M;
 * swapping them means re-running `tools/voice/make-voice-clips.mjs` with a
 * different renderer and replacing the files. Nothing below changes.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import { VOICE_ASSET_IDS, type VoiceAssetId } from '@domain/coach/VoiceOutputPort'
import type { VoiceVocabulary } from '@domain/coach/VoiceCoachPolicy'

/** What Metro's `require` returns for an asset — an opaque module id. */
export type AssetModule = number

export interface VoiceAssetManifest {
  /** Fixed by the M34-01 decision: uncompressed, no decoder variance. */
  format: 'wav'
  assets: Record<VoiceVocabulary, Record<VoiceAssetId, AssetModule>>
}

/**
 * Written out one line per id rather than generated in a loop.
 *
 * Metro must see every `require` as a literal to bundle the file at all — a
 * computed path resolves to nothing at runtime, and the failure shows up as a
 * silent missing clip rather than a build error.
 */
export const voiceAssetManifest: VoiceAssetManifest = {
  format: 'wav',
  assets: {
    numbers: {
      '1': require('../../../assets/voice/numbers/1.wav'),
      '2': require('../../../assets/voice/numbers/2.wav'),
      '3': require('../../../assets/voice/numbers/3.wav'),
      '4': require('../../../assets/voice/numbers/4.wav'),
      '5': require('../../../assets/voice/numbers/5.wav'),
      '6': require('../../../assets/voice/numbers/6.wav'),
      body: require('../../../assets/voice/numbers/body.wav'),
      slip: require('../../../assets/voice/numbers/slip.wav'),
      roll: require('../../../assets/voice/numbers/roll.wav'),
      duck: require('../../../assets/voice/numbers/duck.wav'),
      pull: require('../../../assets/voice/numbers/pull.wav'),
      'bob-weave': require('../../../assets/voice/numbers/bob-weave.wav'),
      pivot: require('../../../assets/voice/numbers/pivot.wav'),
      'step-off': require('../../../assets/voice/numbers/step-off.wav'),
      circle: require('../../../assets/voice/numbers/circle.wav'),
      'cut-off-ring': require('../../../assets/voice/numbers/cut-off-ring.wav'),
      reset: require('../../../assets/voice/numbers/reset.wav'),
      go: require('../../../assets/voice/numbers/go.wav'),
      stop: require('../../../assets/voice/numbers/stop.wav'),
      switch: require('../../../assets/voice/numbers/switch.wav'),
      bell: require('../../../assets/voice/numbers/bell.wav'),
      'tone-ready': require('../../../assets/voice/numbers/tone-ready.wav'),
      'tone-repeat': require('../../../assets/voice/numbers/tone-repeat.wav'),
      'tone-warning': require('../../../assets/voice/numbers/tone-warning.wav'),
    },
    names: {
      '1': require('../../../assets/voice/names/1.wav'),
      '2': require('../../../assets/voice/names/2.wav'),
      '3': require('../../../assets/voice/names/3.wav'),
      '4': require('../../../assets/voice/names/4.wav'),
      '5': require('../../../assets/voice/names/5.wav'),
      '6': require('../../../assets/voice/names/6.wav'),
      body: require('../../../assets/voice/names/body.wav'),
      slip: require('../../../assets/voice/names/slip.wav'),
      roll: require('../../../assets/voice/names/roll.wav'),
      duck: require('../../../assets/voice/names/duck.wav'),
      pull: require('../../../assets/voice/names/pull.wav'),
      'bob-weave': require('../../../assets/voice/names/bob-weave.wav'),
      pivot: require('../../../assets/voice/names/pivot.wav'),
      'step-off': require('../../../assets/voice/names/step-off.wav'),
      circle: require('../../../assets/voice/names/circle.wav'),
      'cut-off-ring': require('../../../assets/voice/names/cut-off-ring.wav'),
      reset: require('../../../assets/voice/names/reset.wav'),
      go: require('../../../assets/voice/names/go.wav'),
      stop: require('../../../assets/voice/names/stop.wav'),
      switch: require('../../../assets/voice/names/switch.wav'),
      bell: require('../../../assets/voice/names/bell.wav'),
      'tone-ready': require('../../../assets/voice/names/tone-ready.wav'),
      'tone-repeat': require('../../../assets/voice/names/tone-repeat.wav'),
      'tone-warning': require('../../../assets/voice/names/tone-warning.wav'),
    },
  },
}

/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Ids the manifest is missing for a vocabulary.
 *
 * Exported so the test can assert emptiness rather than re-deriving the
 * expected list — a hand-copied list in the test would drift from the union
 * and stop catching anything.
 */
export function missingAssetIds(
  manifest: VoiceAssetManifest,
  vocabulary: VoiceVocabulary,
): VoiceAssetId[] {
  const set = manifest.assets[vocabulary]
  return VOICE_ASSET_IDS.filter((id) => set[id] === undefined || set[id] === null)
}
