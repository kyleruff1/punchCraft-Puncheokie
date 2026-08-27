/**
 * Asset id → clip file, per vocabulary and per form (M34-04, D15, D16).
 *
 * Three axes meet here, and only one of them belongs to the id.
 *
 * - **id** — *what* is said: `'1'`, `'slip'`, `'bell'`.
 * - **vocabulary** (D15) — *which words*: `numbers` says "one", `names` says
 *   "jab".
 * - **form** — *how it is delivered*: `standalone` is a single command called
 *   clearly; `combo` is the same word inside a combination, clipped and
 *   quicker, the way a coach rattles "one-two-three" rather than announcing
 *   three separate numbers.
 *
 * The form is a genuinely different rendering, not the standalone clip played
 * faster. Speeding a clip up at runtime smears the consonants; re-rendering
 * keeps them crisp, which is what makes a fast call still a *clear* one.
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
// Set Ceremonies: generated per-directory require maps (47 call-out
// clips × 4 sections) — see tools/voice/make-callout-clips.mjs.
import {
  CALLOUT_REQUIRES_NAMES_COMBO,
  CALLOUT_REQUIRES_NAMES_STANDALONE,
  CALLOUT_REQUIRES_NUMBERS_COMBO,
  CALLOUT_REQUIRES_NUMBERS_STANDALONE,
} from './calloutManifest'

/** What Metro's `require` returns for an asset — an opaque module id. */
export type AssetModule = number

/** How a word is delivered. See the header note. */
export type PhraseForm = 'standalone' | 'combo'

export const PHRASE_FORMS: readonly PhraseForm[] = ['standalone', 'combo']

export interface VoiceAssetManifest {
  /** Fixed by the M34-01 decision: uncompressed, no decoder variance. */
  format: 'wav'
  assets: Record<VoiceVocabulary, Record<PhraseForm, Record<VoiceAssetId, AssetModule>>>
}

/**
 * Written out one line per clip rather than generated in a loop.
 *
 * Metro must see every `require` as a literal to bundle the file at all — a
 * computed path resolves to nothing at runtime, and the failure shows up as a
 * silent missing clip rather than a build error.
 */
export const voiceAssetManifest: VoiceAssetManifest = {
  format: 'wav',
  assets: {
    numbers: {
      standalone: {
        '1': require('../../../assets/voice/numbers/standalone/1.wav'),
        '2': require('../../../assets/voice/numbers/standalone/2.wav'),
        '3': require('../../../assets/voice/numbers/standalone/3.wav'),
        '4': require('../../../assets/voice/numbers/standalone/4.wav'),
        '5': require('../../../assets/voice/numbers/standalone/5.wav'),
        '6': require('../../../assets/voice/numbers/standalone/6.wav'),
        body: require('../../../assets/voice/numbers/standalone/body.wav'),
        slip: require('../../../assets/voice/numbers/standalone/slip.wav'),
        roll: require('../../../assets/voice/numbers/standalone/roll.wav'),
        duck: require('../../../assets/voice/numbers/standalone/duck.wav'),
        pull: require('../../../assets/voice/numbers/standalone/pull.wav'),
        'bob-weave': require('../../../assets/voice/numbers/standalone/bob-weave.wav'),
        pivot: require('../../../assets/voice/numbers/standalone/pivot.wav'),
        'step-off': require('../../../assets/voice/numbers/standalone/step-off.wav'),
        circle: require('../../../assets/voice/numbers/standalone/circle.wav'),
        'cut-off-ring': require('../../../assets/voice/numbers/standalone/cut-off-ring.wav'),
        reset: require('../../../assets/voice/numbers/standalone/reset.wav'),
        go: require('../../../assets/voice/numbers/standalone/go.wav'),
        stop: require('../../../assets/voice/numbers/standalone/stop.wav'),
        switch: require('../../../assets/voice/numbers/standalone/switch.wav'),
        bell: require('../../../assets/voice/numbers/standalone/bell.wav'),
        ...CALLOUT_REQUIRES_NUMBERS_STANDALONE,
        'power-strikes': require('../../../assets/voice/numbers/standalone/power-strikes.wav'),
        'tone-ready': require('../../../assets/voice/numbers/standalone/tone-ready.wav'),
        'tone-repeat': require('../../../assets/voice/numbers/standalone/tone-repeat.wav'),
        'tone-warning': require('../../../assets/voice/numbers/standalone/tone-warning.wav'),
        'coast-15': require('../../../assets/voice/numbers/standalone/coast-15.wav'),
        'coast-30': require('../../../assets/voice/numbers/standalone/coast-30.wav'),
        'coast-45': require('../../../assets/voice/numbers/standalone/coast-45.wav'),
        'coast-60': require('../../../assets/voice/numbers/standalone/coast-60.wav'),
        'double-up': require('../../../assets/voice/numbers/standalone/double-up.wav'),
        'put-it-on-em': require('../../../assets/voice/numbers/standalone/put-it-on-em.wav'),
        'touch-and-go': require('../../../assets/voice/numbers/standalone/touch-and-go.wav'),
        'breathe': require('../../../assets/voice/numbers/standalone/breathe.wav'),
        'hands-up': require('../../../assets/voice/numbers/standalone/hands-up.wav'),
      },
      combo: {
        '1': require('../../../assets/voice/numbers/combo/1.wav'),
        '2': require('../../../assets/voice/numbers/combo/2.wav'),
        '3': require('../../../assets/voice/numbers/combo/3.wav'),
        '4': require('../../../assets/voice/numbers/combo/4.wav'),
        '5': require('../../../assets/voice/numbers/combo/5.wav'),
        '6': require('../../../assets/voice/numbers/combo/6.wav'),
        body: require('../../../assets/voice/numbers/combo/body.wav'),
        slip: require('../../../assets/voice/numbers/combo/slip.wav'),
        roll: require('../../../assets/voice/numbers/combo/roll.wav'),
        duck: require('../../../assets/voice/numbers/combo/duck.wav'),
        pull: require('../../../assets/voice/numbers/combo/pull.wav'),
        'bob-weave': require('../../../assets/voice/numbers/combo/bob-weave.wav'),
        pivot: require('../../../assets/voice/numbers/combo/pivot.wav'),
        'step-off': require('../../../assets/voice/numbers/combo/step-off.wav'),
        circle: require('../../../assets/voice/numbers/combo/circle.wav'),
        'cut-off-ring': require('../../../assets/voice/numbers/combo/cut-off-ring.wav'),
        reset: require('../../../assets/voice/numbers/combo/reset.wav'),
        go: require('../../../assets/voice/numbers/combo/go.wav'),
        stop: require('../../../assets/voice/numbers/combo/stop.wav'),
        switch: require('../../../assets/voice/numbers/combo/switch.wav'),
        bell: require('../../../assets/voice/numbers/combo/bell.wav'),
        ...CALLOUT_REQUIRES_NUMBERS_COMBO,
        'power-strikes': require('../../../assets/voice/numbers/combo/power-strikes.wav'),
        'tone-ready': require('../../../assets/voice/numbers/combo/tone-ready.wav'),
        'tone-repeat': require('../../../assets/voice/numbers/combo/tone-repeat.wav'),
        'tone-warning': require('../../../assets/voice/numbers/combo/tone-warning.wav'),
        'coast-15': require('../../../assets/voice/numbers/combo/coast-15.wav'),
        'coast-30': require('../../../assets/voice/numbers/combo/coast-30.wav'),
        'coast-45': require('../../../assets/voice/numbers/combo/coast-45.wav'),
        'coast-60': require('../../../assets/voice/numbers/combo/coast-60.wav'),
        'double-up': require('../../../assets/voice/numbers/combo/double-up.wav'),
        'put-it-on-em': require('../../../assets/voice/numbers/combo/put-it-on-em.wav'),
        'touch-and-go': require('../../../assets/voice/numbers/combo/touch-and-go.wav'),
        'breathe': require('../../../assets/voice/numbers/combo/breathe.wav'),
        'hands-up': require('../../../assets/voice/numbers/combo/hands-up.wav'),
      },
    },
    names: {
      standalone: {
        '1': require('../../../assets/voice/names/standalone/1.wav'),
        '2': require('../../../assets/voice/names/standalone/2.wav'),
        '3': require('../../../assets/voice/names/standalone/3.wav'),
        '4': require('../../../assets/voice/names/standalone/4.wav'),
        '5': require('../../../assets/voice/names/standalone/5.wav'),
        '6': require('../../../assets/voice/names/standalone/6.wav'),
        body: require('../../../assets/voice/names/standalone/body.wav'),
        slip: require('../../../assets/voice/names/standalone/slip.wav'),
        roll: require('../../../assets/voice/names/standalone/roll.wav'),
        duck: require('../../../assets/voice/names/standalone/duck.wav'),
        pull: require('../../../assets/voice/names/standalone/pull.wav'),
        'bob-weave': require('../../../assets/voice/names/standalone/bob-weave.wav'),
        pivot: require('../../../assets/voice/names/standalone/pivot.wav'),
        'step-off': require('../../../assets/voice/names/standalone/step-off.wav'),
        circle: require('../../../assets/voice/names/standalone/circle.wav'),
        'cut-off-ring': require('../../../assets/voice/names/standalone/cut-off-ring.wav'),
        reset: require('../../../assets/voice/names/standalone/reset.wav'),
        go: require('../../../assets/voice/names/standalone/go.wav'),
        stop: require('../../../assets/voice/names/standalone/stop.wav'),
        switch: require('../../../assets/voice/names/standalone/switch.wav'),
        bell: require('../../../assets/voice/names/standalone/bell.wav'),
        ...CALLOUT_REQUIRES_NAMES_STANDALONE,
        'power-strikes': require('../../../assets/voice/names/standalone/power-strikes.wav'),
        'tone-ready': require('../../../assets/voice/names/standalone/tone-ready.wav'),
        'tone-repeat': require('../../../assets/voice/names/standalone/tone-repeat.wav'),
        'tone-warning': require('../../../assets/voice/names/standalone/tone-warning.wav'),
        'coast-15': require('../../../assets/voice/names/standalone/coast-15.wav'),
        'coast-30': require('../../../assets/voice/names/standalone/coast-30.wav'),
        'coast-45': require('../../../assets/voice/names/standalone/coast-45.wav'),
        'coast-60': require('../../../assets/voice/names/standalone/coast-60.wav'),
        'double-up': require('../../../assets/voice/names/standalone/double-up.wav'),
        'put-it-on-em': require('../../../assets/voice/names/standalone/put-it-on-em.wav'),
        'touch-and-go': require('../../../assets/voice/names/standalone/touch-and-go.wav'),
        'breathe': require('../../../assets/voice/names/standalone/breathe.wav'),
        'hands-up': require('../../../assets/voice/names/standalone/hands-up.wav'),
      },
      combo: {
        '1': require('../../../assets/voice/names/combo/1.wav'),
        '2': require('../../../assets/voice/names/combo/2.wav'),
        '3': require('../../../assets/voice/names/combo/3.wav'),
        '4': require('../../../assets/voice/names/combo/4.wav'),
        '5': require('../../../assets/voice/names/combo/5.wav'),
        '6': require('../../../assets/voice/names/combo/6.wav'),
        body: require('../../../assets/voice/names/combo/body.wav'),
        slip: require('../../../assets/voice/names/combo/slip.wav'),
        roll: require('../../../assets/voice/names/combo/roll.wav'),
        duck: require('../../../assets/voice/names/combo/duck.wav'),
        pull: require('../../../assets/voice/names/combo/pull.wav'),
        'bob-weave': require('../../../assets/voice/names/combo/bob-weave.wav'),
        pivot: require('../../../assets/voice/names/combo/pivot.wav'),
        'step-off': require('../../../assets/voice/names/combo/step-off.wav'),
        circle: require('../../../assets/voice/names/combo/circle.wav'),
        'cut-off-ring': require('../../../assets/voice/names/combo/cut-off-ring.wav'),
        reset: require('../../../assets/voice/names/combo/reset.wav'),
        go: require('../../../assets/voice/names/combo/go.wav'),
        stop: require('../../../assets/voice/names/combo/stop.wav'),
        switch: require('../../../assets/voice/names/combo/switch.wav'),
        bell: require('../../../assets/voice/names/combo/bell.wav'),
        ...CALLOUT_REQUIRES_NAMES_COMBO,
        'power-strikes': require('../../../assets/voice/names/combo/power-strikes.wav'),
        'tone-ready': require('../../../assets/voice/names/combo/tone-ready.wav'),
        'tone-repeat': require('../../../assets/voice/names/combo/tone-repeat.wav'),
        'tone-warning': require('../../../assets/voice/names/combo/tone-warning.wav'),
        'coast-15': require('../../../assets/voice/names/combo/coast-15.wav'),
        'coast-30': require('../../../assets/voice/names/combo/coast-30.wav'),
        'coast-45': require('../../../assets/voice/names/combo/coast-45.wav'),
        'coast-60': require('../../../assets/voice/names/combo/coast-60.wav'),
        'double-up': require('../../../assets/voice/names/combo/double-up.wav'),
        'put-it-on-em': require('../../../assets/voice/names/combo/put-it-on-em.wav'),
        'touch-and-go': require('../../../assets/voice/names/combo/touch-and-go.wav'),
        'breathe': require('../../../assets/voice/names/combo/breathe.wav'),
        'hands-up': require('../../../assets/voice/names/combo/hands-up.wav'),
      },
    },
  },
}

/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Ids the manifest is missing for a vocabulary and form.
 *
 * Exported so the test can assert emptiness rather than re-deriving the
 * expected list — a hand-copied list in the test would drift from the union
 * and stop catching anything.
 */
export function missingAssetIds(
  manifest: VoiceAssetManifest,
  vocabulary: VoiceVocabulary,
  form: PhraseForm = 'standalone',
): VoiceAssetId[] {
  const set = manifest.assets[vocabulary][form]
  return VOICE_ASSET_IDS.filter((id) => set[id] === undefined || set[id] === null)
}
