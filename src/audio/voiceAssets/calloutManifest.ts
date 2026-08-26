/**
 * Set-ceremony call-out clips (generated).
 *
 * DO NOT EDIT — produced by `node tools/voice/make-callout-clips.mjs`.
 * Durations are measured from the rendered files; the fill reserves
 * ceremony time and the map compiler places events from these numbers.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

/** Every in-round call-out clip id — a subset of VoiceAssetId. */
export type CalloutClipId =
  | 'co-first-look-01'
  | 'co-first-look-02'
  | 'co-first-look-03'
  | 'co-ones-twos-01'
  | 'co-ones-twos-02'
  | 'co-ones-twos-03'
  | 'co-double-jab-01'
  | 'co-double-jab-02'
  | 'co-hooks-01'
  | 'co-hooks-02'
  | 'co-hooks-03'
  | 'co-uppercuts-01'
  | 'co-uppercuts-02'
  | 'co-square-01'
  | 'co-square-02'
  | 'co-buildup-start-01'
  | 'co-buildup-start-02'
  | 'co-buildup-start-03'
  | 'co-buildup-next-01'
  | 'co-buildup-next-02'
  | 'co-volume-01'
  | 'co-volume-02'
  | 'co-volume-03'
  | 'co-jab-volume-01'
  | 'co-jab-volume-02'
  | 'co-downstairs-01'
  | 'co-downstairs-02'
  | 'co-downstairs-03'
  | 'co-body-to-head-01'
  | 'co-body-to-head-02'
  | 'co-movement-01'
  | 'co-movement-02'
  | 'co-pressure-01'
  | 'co-pressure-02'
  | 'co-pressure-03'
  | 'co-new-pattern-01'
  | 'co-new-pattern-02'
  | 'co-settle-in-01'
  | 'co-settle-in-02'
  | 'co-flurry-01'
  | 'co-flurry-02'
  | 'co-final-round-01'
  | 'co-final-round-02'
  | 'co-breathe-reset-01'
  | 'co-breathe-reset-02'
  | 'co-okay-go'
  | 'co-regular-speed-go'

/** In-round call-out sentence durations, keyed by VoiceAssetId. */
export const CALLOUT_CLIPS: Readonly<Record<CalloutClipId, { durationMs: number }>> = {
  'co-first-look-01': { durationMs: 8192 },
  'co-first-look-02': { durationMs: 4893 },
  'co-first-look-03': { durationMs: 3767 },
  'co-ones-twos-01': { durationMs: 2470 },
  'co-ones-twos-02': { durationMs: 5497 },
  'co-ones-twos-03': { durationMs: 3505 },
  'co-double-jab-01': { durationMs: 2191 },
  'co-double-jab-02': { durationMs: 2900 },
  'co-hooks-01': { durationMs: 2693 },
  'co-hooks-02': { durationMs: 2676 },
  'co-hooks-03': { durationMs: 3192 },
  'co-uppercuts-01': { durationMs: 2451 },
  'co-uppercuts-02': { durationMs: 2154 },
  'co-square-01': { durationMs: 2564 },
  'co-square-02': { durationMs: 3753 },
  'co-buildup-start-01': { durationMs: 1573 },
  'co-buildup-start-02': { durationMs: 4674 },
  'co-buildup-start-03': { durationMs: 3969 },
  'co-buildup-next-01': { durationMs: 3024 },
  'co-buildup-next-02': { durationMs: 5053 },
  'co-volume-01': { durationMs: 3807 },
  'co-volume-02': { durationMs: 3146 },
  'co-volume-03': { durationMs: 3486 },
  'co-jab-volume-01': { durationMs: 3161 },
  'co-jab-volume-02': { durationMs: 2907 },
  'co-downstairs-01': { durationMs: 2417 },
  'co-downstairs-02': { durationMs: 2644 },
  'co-downstairs-03': { durationMs: 7002 },
  'co-body-to-head-01': { durationMs: 3322 },
  'co-body-to-head-02': { durationMs: 6327 },
  'co-movement-01': { durationMs: 3613 },
  'co-movement-02': { durationMs: 5162 },
  'co-pressure-01': { durationMs: 4013 },
  'co-pressure-02': { durationMs: 5533 },
  'co-pressure-03': { durationMs: 8373 },
  'co-new-pattern-01': { durationMs: 3773 },
  'co-new-pattern-02': { durationMs: 4323 },
  'co-settle-in-01': { durationMs: 3242 },
  'co-settle-in-02': { durationMs: 3973 },
  'co-flurry-01': { durationMs: 2083 },
  'co-flurry-02': { durationMs: 3813 },
  'co-final-round-01': { durationMs: 2853 },
  'co-final-round-02': { durationMs: 3933 },
  'co-breathe-reset-01': { durationMs: 3331 },
  'co-breathe-reset-02': { durationMs: 4100 },
  'co-okay-go': { durationMs: 848 },
  'co-regular-speed-go': { durationMs: 2145 },
}

export const CALLOUT_REQUIRES_NUMBERS_STANDALONE: Readonly<Record<CalloutClipId, number>> = {
  'co-first-look-01': require('../../../assets/voice/numbers/standalone/co-first-look-01.wav'),
  'co-first-look-02': require('../../../assets/voice/numbers/standalone/co-first-look-02.wav'),
  'co-first-look-03': require('../../../assets/voice/numbers/standalone/co-first-look-03.wav'),
  'co-ones-twos-01': require('../../../assets/voice/numbers/standalone/co-ones-twos-01.wav'),
  'co-ones-twos-02': require('../../../assets/voice/numbers/standalone/co-ones-twos-02.wav'),
  'co-ones-twos-03': require('../../../assets/voice/numbers/standalone/co-ones-twos-03.wav'),
  'co-double-jab-01': require('../../../assets/voice/numbers/standalone/co-double-jab-01.wav'),
  'co-double-jab-02': require('../../../assets/voice/numbers/standalone/co-double-jab-02.wav'),
  'co-hooks-01': require('../../../assets/voice/numbers/standalone/co-hooks-01.wav'),
  'co-hooks-02': require('../../../assets/voice/numbers/standalone/co-hooks-02.wav'),
  'co-hooks-03': require('../../../assets/voice/numbers/standalone/co-hooks-03.wav'),
  'co-uppercuts-01': require('../../../assets/voice/numbers/standalone/co-uppercuts-01.wav'),
  'co-uppercuts-02': require('../../../assets/voice/numbers/standalone/co-uppercuts-02.wav'),
  'co-square-01': require('../../../assets/voice/numbers/standalone/co-square-01.wav'),
  'co-square-02': require('../../../assets/voice/numbers/standalone/co-square-02.wav'),
  'co-buildup-start-01': require('../../../assets/voice/numbers/standalone/co-buildup-start-01.wav'),
  'co-buildup-start-02': require('../../../assets/voice/numbers/standalone/co-buildup-start-02.wav'),
  'co-buildup-start-03': require('../../../assets/voice/numbers/standalone/co-buildup-start-03.wav'),
  'co-buildup-next-01': require('../../../assets/voice/numbers/standalone/co-buildup-next-01.wav'),
  'co-buildup-next-02': require('../../../assets/voice/numbers/standalone/co-buildup-next-02.wav'),
  'co-volume-01': require('../../../assets/voice/numbers/standalone/co-volume-01.wav'),
  'co-volume-02': require('../../../assets/voice/numbers/standalone/co-volume-02.wav'),
  'co-volume-03': require('../../../assets/voice/numbers/standalone/co-volume-03.wav'),
  'co-jab-volume-01': require('../../../assets/voice/numbers/standalone/co-jab-volume-01.wav'),
  'co-jab-volume-02': require('../../../assets/voice/numbers/standalone/co-jab-volume-02.wav'),
  'co-downstairs-01': require('../../../assets/voice/numbers/standalone/co-downstairs-01.wav'),
  'co-downstairs-02': require('../../../assets/voice/numbers/standalone/co-downstairs-02.wav'),
  'co-downstairs-03': require('../../../assets/voice/numbers/standalone/co-downstairs-03.wav'),
  'co-body-to-head-01': require('../../../assets/voice/numbers/standalone/co-body-to-head-01.wav'),
  'co-body-to-head-02': require('../../../assets/voice/numbers/standalone/co-body-to-head-02.wav'),
  'co-movement-01': require('../../../assets/voice/numbers/standalone/co-movement-01.wav'),
  'co-movement-02': require('../../../assets/voice/numbers/standalone/co-movement-02.wav'),
  'co-pressure-01': require('../../../assets/voice/numbers/standalone/co-pressure-01.wav'),
  'co-pressure-02': require('../../../assets/voice/numbers/standalone/co-pressure-02.wav'),
  'co-pressure-03': require('../../../assets/voice/numbers/standalone/co-pressure-03.wav'),
  'co-new-pattern-01': require('../../../assets/voice/numbers/standalone/co-new-pattern-01.wav'),
  'co-new-pattern-02': require('../../../assets/voice/numbers/standalone/co-new-pattern-02.wav'),
  'co-settle-in-01': require('../../../assets/voice/numbers/standalone/co-settle-in-01.wav'),
  'co-settle-in-02': require('../../../assets/voice/numbers/standalone/co-settle-in-02.wav'),
  'co-flurry-01': require('../../../assets/voice/numbers/standalone/co-flurry-01.wav'),
  'co-flurry-02': require('../../../assets/voice/numbers/standalone/co-flurry-02.wav'),
  'co-final-round-01': require('../../../assets/voice/numbers/standalone/co-final-round-01.wav'),
  'co-final-round-02': require('../../../assets/voice/numbers/standalone/co-final-round-02.wav'),
  'co-breathe-reset-01': require('../../../assets/voice/numbers/standalone/co-breathe-reset-01.wav'),
  'co-breathe-reset-02': require('../../../assets/voice/numbers/standalone/co-breathe-reset-02.wav'),
  'co-okay-go': require('../../../assets/voice/numbers/standalone/co-okay-go.wav'),
  'co-regular-speed-go': require('../../../assets/voice/numbers/standalone/co-regular-speed-go.wav'),
}

export const CALLOUT_REQUIRES_NUMBERS_COMBO: Readonly<Record<CalloutClipId, number>> = {
  'co-first-look-01': require('../../../assets/voice/numbers/combo/co-first-look-01.wav'),
  'co-first-look-02': require('../../../assets/voice/numbers/combo/co-first-look-02.wav'),
  'co-first-look-03': require('../../../assets/voice/numbers/combo/co-first-look-03.wav'),
  'co-ones-twos-01': require('../../../assets/voice/numbers/combo/co-ones-twos-01.wav'),
  'co-ones-twos-02': require('../../../assets/voice/numbers/combo/co-ones-twos-02.wav'),
  'co-ones-twos-03': require('../../../assets/voice/numbers/combo/co-ones-twos-03.wav'),
  'co-double-jab-01': require('../../../assets/voice/numbers/combo/co-double-jab-01.wav'),
  'co-double-jab-02': require('../../../assets/voice/numbers/combo/co-double-jab-02.wav'),
  'co-hooks-01': require('../../../assets/voice/numbers/combo/co-hooks-01.wav'),
  'co-hooks-02': require('../../../assets/voice/numbers/combo/co-hooks-02.wav'),
  'co-hooks-03': require('../../../assets/voice/numbers/combo/co-hooks-03.wav'),
  'co-uppercuts-01': require('../../../assets/voice/numbers/combo/co-uppercuts-01.wav'),
  'co-uppercuts-02': require('../../../assets/voice/numbers/combo/co-uppercuts-02.wav'),
  'co-square-01': require('../../../assets/voice/numbers/combo/co-square-01.wav'),
  'co-square-02': require('../../../assets/voice/numbers/combo/co-square-02.wav'),
  'co-buildup-start-01': require('../../../assets/voice/numbers/combo/co-buildup-start-01.wav'),
  'co-buildup-start-02': require('../../../assets/voice/numbers/combo/co-buildup-start-02.wav'),
  'co-buildup-start-03': require('../../../assets/voice/numbers/combo/co-buildup-start-03.wav'),
  'co-buildup-next-01': require('../../../assets/voice/numbers/combo/co-buildup-next-01.wav'),
  'co-buildup-next-02': require('../../../assets/voice/numbers/combo/co-buildup-next-02.wav'),
  'co-volume-01': require('../../../assets/voice/numbers/combo/co-volume-01.wav'),
  'co-volume-02': require('../../../assets/voice/numbers/combo/co-volume-02.wav'),
  'co-volume-03': require('../../../assets/voice/numbers/combo/co-volume-03.wav'),
  'co-jab-volume-01': require('../../../assets/voice/numbers/combo/co-jab-volume-01.wav'),
  'co-jab-volume-02': require('../../../assets/voice/numbers/combo/co-jab-volume-02.wav'),
  'co-downstairs-01': require('../../../assets/voice/numbers/combo/co-downstairs-01.wav'),
  'co-downstairs-02': require('../../../assets/voice/numbers/combo/co-downstairs-02.wav'),
  'co-downstairs-03': require('../../../assets/voice/numbers/combo/co-downstairs-03.wav'),
  'co-body-to-head-01': require('../../../assets/voice/numbers/combo/co-body-to-head-01.wav'),
  'co-body-to-head-02': require('../../../assets/voice/numbers/combo/co-body-to-head-02.wav'),
  'co-movement-01': require('../../../assets/voice/numbers/combo/co-movement-01.wav'),
  'co-movement-02': require('../../../assets/voice/numbers/combo/co-movement-02.wav'),
  'co-pressure-01': require('../../../assets/voice/numbers/combo/co-pressure-01.wav'),
  'co-pressure-02': require('../../../assets/voice/numbers/combo/co-pressure-02.wav'),
  'co-pressure-03': require('../../../assets/voice/numbers/combo/co-pressure-03.wav'),
  'co-new-pattern-01': require('../../../assets/voice/numbers/combo/co-new-pattern-01.wav'),
  'co-new-pattern-02': require('../../../assets/voice/numbers/combo/co-new-pattern-02.wav'),
  'co-settle-in-01': require('../../../assets/voice/numbers/combo/co-settle-in-01.wav'),
  'co-settle-in-02': require('../../../assets/voice/numbers/combo/co-settle-in-02.wav'),
  'co-flurry-01': require('../../../assets/voice/numbers/combo/co-flurry-01.wav'),
  'co-flurry-02': require('../../../assets/voice/numbers/combo/co-flurry-02.wav'),
  'co-final-round-01': require('../../../assets/voice/numbers/combo/co-final-round-01.wav'),
  'co-final-round-02': require('../../../assets/voice/numbers/combo/co-final-round-02.wav'),
  'co-breathe-reset-01': require('../../../assets/voice/numbers/combo/co-breathe-reset-01.wav'),
  'co-breathe-reset-02': require('../../../assets/voice/numbers/combo/co-breathe-reset-02.wav'),
  'co-okay-go': require('../../../assets/voice/numbers/combo/co-okay-go.wav'),
  'co-regular-speed-go': require('../../../assets/voice/numbers/combo/co-regular-speed-go.wav'),
}

export const CALLOUT_REQUIRES_NAMES_STANDALONE: Readonly<Record<CalloutClipId, number>> = {
  'co-first-look-01': require('../../../assets/voice/names/standalone/co-first-look-01.wav'),
  'co-first-look-02': require('../../../assets/voice/names/standalone/co-first-look-02.wav'),
  'co-first-look-03': require('../../../assets/voice/names/standalone/co-first-look-03.wav'),
  'co-ones-twos-01': require('../../../assets/voice/names/standalone/co-ones-twos-01.wav'),
  'co-ones-twos-02': require('../../../assets/voice/names/standalone/co-ones-twos-02.wav'),
  'co-ones-twos-03': require('../../../assets/voice/names/standalone/co-ones-twos-03.wav'),
  'co-double-jab-01': require('../../../assets/voice/names/standalone/co-double-jab-01.wav'),
  'co-double-jab-02': require('../../../assets/voice/names/standalone/co-double-jab-02.wav'),
  'co-hooks-01': require('../../../assets/voice/names/standalone/co-hooks-01.wav'),
  'co-hooks-02': require('../../../assets/voice/names/standalone/co-hooks-02.wav'),
  'co-hooks-03': require('../../../assets/voice/names/standalone/co-hooks-03.wav'),
  'co-uppercuts-01': require('../../../assets/voice/names/standalone/co-uppercuts-01.wav'),
  'co-uppercuts-02': require('../../../assets/voice/names/standalone/co-uppercuts-02.wav'),
  'co-square-01': require('../../../assets/voice/names/standalone/co-square-01.wav'),
  'co-square-02': require('../../../assets/voice/names/standalone/co-square-02.wav'),
  'co-buildup-start-01': require('../../../assets/voice/names/standalone/co-buildup-start-01.wav'),
  'co-buildup-start-02': require('../../../assets/voice/names/standalone/co-buildup-start-02.wav'),
  'co-buildup-start-03': require('../../../assets/voice/names/standalone/co-buildup-start-03.wav'),
  'co-buildup-next-01': require('../../../assets/voice/names/standalone/co-buildup-next-01.wav'),
  'co-buildup-next-02': require('../../../assets/voice/names/standalone/co-buildup-next-02.wav'),
  'co-volume-01': require('../../../assets/voice/names/standalone/co-volume-01.wav'),
  'co-volume-02': require('../../../assets/voice/names/standalone/co-volume-02.wav'),
  'co-volume-03': require('../../../assets/voice/names/standalone/co-volume-03.wav'),
  'co-jab-volume-01': require('../../../assets/voice/names/standalone/co-jab-volume-01.wav'),
  'co-jab-volume-02': require('../../../assets/voice/names/standalone/co-jab-volume-02.wav'),
  'co-downstairs-01': require('../../../assets/voice/names/standalone/co-downstairs-01.wav'),
  'co-downstairs-02': require('../../../assets/voice/names/standalone/co-downstairs-02.wav'),
  'co-downstairs-03': require('../../../assets/voice/names/standalone/co-downstairs-03.wav'),
  'co-body-to-head-01': require('../../../assets/voice/names/standalone/co-body-to-head-01.wav'),
  'co-body-to-head-02': require('../../../assets/voice/names/standalone/co-body-to-head-02.wav'),
  'co-movement-01': require('../../../assets/voice/names/standalone/co-movement-01.wav'),
  'co-movement-02': require('../../../assets/voice/names/standalone/co-movement-02.wav'),
  'co-pressure-01': require('../../../assets/voice/names/standalone/co-pressure-01.wav'),
  'co-pressure-02': require('../../../assets/voice/names/standalone/co-pressure-02.wav'),
  'co-pressure-03': require('../../../assets/voice/names/standalone/co-pressure-03.wav'),
  'co-new-pattern-01': require('../../../assets/voice/names/standalone/co-new-pattern-01.wav'),
  'co-new-pattern-02': require('../../../assets/voice/names/standalone/co-new-pattern-02.wav'),
  'co-settle-in-01': require('../../../assets/voice/names/standalone/co-settle-in-01.wav'),
  'co-settle-in-02': require('../../../assets/voice/names/standalone/co-settle-in-02.wav'),
  'co-flurry-01': require('../../../assets/voice/names/standalone/co-flurry-01.wav'),
  'co-flurry-02': require('../../../assets/voice/names/standalone/co-flurry-02.wav'),
  'co-final-round-01': require('../../../assets/voice/names/standalone/co-final-round-01.wav'),
  'co-final-round-02': require('../../../assets/voice/names/standalone/co-final-round-02.wav'),
  'co-breathe-reset-01': require('../../../assets/voice/names/standalone/co-breathe-reset-01.wav'),
  'co-breathe-reset-02': require('../../../assets/voice/names/standalone/co-breathe-reset-02.wav'),
  'co-okay-go': require('../../../assets/voice/names/standalone/co-okay-go.wav'),
  'co-regular-speed-go': require('../../../assets/voice/names/standalone/co-regular-speed-go.wav'),
}

export const CALLOUT_REQUIRES_NAMES_COMBO: Readonly<Record<CalloutClipId, number>> = {
  'co-first-look-01': require('../../../assets/voice/names/combo/co-first-look-01.wav'),
  'co-first-look-02': require('../../../assets/voice/names/combo/co-first-look-02.wav'),
  'co-first-look-03': require('../../../assets/voice/names/combo/co-first-look-03.wav'),
  'co-ones-twos-01': require('../../../assets/voice/names/combo/co-ones-twos-01.wav'),
  'co-ones-twos-02': require('../../../assets/voice/names/combo/co-ones-twos-02.wav'),
  'co-ones-twos-03': require('../../../assets/voice/names/combo/co-ones-twos-03.wav'),
  'co-double-jab-01': require('../../../assets/voice/names/combo/co-double-jab-01.wav'),
  'co-double-jab-02': require('../../../assets/voice/names/combo/co-double-jab-02.wav'),
  'co-hooks-01': require('../../../assets/voice/names/combo/co-hooks-01.wav'),
  'co-hooks-02': require('../../../assets/voice/names/combo/co-hooks-02.wav'),
  'co-hooks-03': require('../../../assets/voice/names/combo/co-hooks-03.wav'),
  'co-uppercuts-01': require('../../../assets/voice/names/combo/co-uppercuts-01.wav'),
  'co-uppercuts-02': require('../../../assets/voice/names/combo/co-uppercuts-02.wav'),
  'co-square-01': require('../../../assets/voice/names/combo/co-square-01.wav'),
  'co-square-02': require('../../../assets/voice/names/combo/co-square-02.wav'),
  'co-buildup-start-01': require('../../../assets/voice/names/combo/co-buildup-start-01.wav'),
  'co-buildup-start-02': require('../../../assets/voice/names/combo/co-buildup-start-02.wav'),
  'co-buildup-start-03': require('../../../assets/voice/names/combo/co-buildup-start-03.wav'),
  'co-buildup-next-01': require('../../../assets/voice/names/combo/co-buildup-next-01.wav'),
  'co-buildup-next-02': require('../../../assets/voice/names/combo/co-buildup-next-02.wav'),
  'co-volume-01': require('../../../assets/voice/names/combo/co-volume-01.wav'),
  'co-volume-02': require('../../../assets/voice/names/combo/co-volume-02.wav'),
  'co-volume-03': require('../../../assets/voice/names/combo/co-volume-03.wav'),
  'co-jab-volume-01': require('../../../assets/voice/names/combo/co-jab-volume-01.wav'),
  'co-jab-volume-02': require('../../../assets/voice/names/combo/co-jab-volume-02.wav'),
  'co-downstairs-01': require('../../../assets/voice/names/combo/co-downstairs-01.wav'),
  'co-downstairs-02': require('../../../assets/voice/names/combo/co-downstairs-02.wav'),
  'co-downstairs-03': require('../../../assets/voice/names/combo/co-downstairs-03.wav'),
  'co-body-to-head-01': require('../../../assets/voice/names/combo/co-body-to-head-01.wav'),
  'co-body-to-head-02': require('../../../assets/voice/names/combo/co-body-to-head-02.wav'),
  'co-movement-01': require('../../../assets/voice/names/combo/co-movement-01.wav'),
  'co-movement-02': require('../../../assets/voice/names/combo/co-movement-02.wav'),
  'co-pressure-01': require('../../../assets/voice/names/combo/co-pressure-01.wav'),
  'co-pressure-02': require('../../../assets/voice/names/combo/co-pressure-02.wav'),
  'co-pressure-03': require('../../../assets/voice/names/combo/co-pressure-03.wav'),
  'co-new-pattern-01': require('../../../assets/voice/names/combo/co-new-pattern-01.wav'),
  'co-new-pattern-02': require('../../../assets/voice/names/combo/co-new-pattern-02.wav'),
  'co-settle-in-01': require('../../../assets/voice/names/combo/co-settle-in-01.wav'),
  'co-settle-in-02': require('../../../assets/voice/names/combo/co-settle-in-02.wav'),
  'co-flurry-01': require('../../../assets/voice/names/combo/co-flurry-01.wav'),
  'co-flurry-02': require('../../../assets/voice/names/combo/co-flurry-02.wav'),
  'co-final-round-01': require('../../../assets/voice/names/combo/co-final-round-01.wav'),
  'co-final-round-02': require('../../../assets/voice/names/combo/co-final-round-02.wav'),
  'co-breathe-reset-01': require('../../../assets/voice/names/combo/co-breathe-reset-01.wav'),
  'co-breathe-reset-02': require('../../../assets/voice/names/combo/co-breathe-reset-02.wav'),
  'co-okay-go': require('../../../assets/voice/names/combo/co-okay-go.wav'),
  'co-regular-speed-go': require('../../../assets/voice/names/combo/co-regular-speed-go.wav'),
}

/** Rest-side theme clips ("Coming up — the Square Builder!"). */
export interface ThemeClip {
  id: string
  theme: string
  module: number
  durationMs: number
}

export const THEME_CLIPS: readonly ThemeClip[] = [
  { id: 'theme-straight-extension', theme: "Straight Extension", module: require('../../../assets/voice/numbers/standalone/theme-straight-extension.wav'), durationMs: 2650 },
  { id: 'theme-jab-volume-ladder', theme: "Jab Volume Ladder", module: require('../../../assets/voice/numbers/standalone/theme-jab-volume-ladder.wav'), durationMs: 3173 },
  { id: 'theme-hook-finish-ladder', theme: "Hook Finish Ladder", module: require('../../../assets/voice/numbers/standalone/theme-hook-finish-ladder.wav'), durationMs: 3133 },
  { id: 'theme-lead-side-disguise', theme: "Lead-Side Disguise", module: require('../../../assets/voice/numbers/standalone/theme-lead-side-disguise.wav'), durationMs: 8657 },
  { id: 'theme-body-jab-rise', theme: "Body-Jab Rise", module: require('../../../assets/voice/numbers/standalone/theme-body-jab-rise.wav'), durationMs: 5333 },
  { id: 'theme-body-hook-finish', theme: "Body-Hook Finish", module: require('../../../assets/voice/numbers/standalone/theme-body-hook-finish.wav'), durationMs: 3078 },
  { id: 'theme-double-jab-power-chain', theme: "Double-Jab Power Chain", module: require('../../../assets/voice/numbers/standalone/theme-double-jab-power-chain.wav'), durationMs: 2733 },
  { id: 'theme-square-builder', theme: "Square Builder", module: require('../../../assets/voice/numbers/standalone/theme-square-builder.wav'), durationMs: 2593 },
  { id: 'theme-uppercut-cascade', theme: "Uppercut Cascade", module: require('../../../assets/voice/numbers/standalone/theme-uppercut-cascade.wav'), durationMs: 2584 },
  { id: 'theme-body-head-hook-double', theme: "Body-Head Hook Double", module: require('../../../assets/voice/numbers/standalone/theme-body-head-hook-double.wav'), durationMs: 4013 },
  { id: 'theme-body-staircase', theme: "Body Staircase", module: require('../../../assets/voice/numbers/standalone/theme-body-staircase.wav'), durationMs: 2290 },
  { id: 'theme-rear-uppercut-line', theme: "Rear-Uppercut Line", module: require('../../../assets/voice/numbers/standalone/theme-rear-uppercut-line.wav'), durationMs: 3733 },
  { id: 'theme-extended-square-ladder', theme: "Extended Square Ladder", module: require('../../../assets/voice/numbers/standalone/theme-extended-square-ladder.wav'), durationMs: 3303 },
  { id: 'theme-body-head-pressure-ladder', theme: "Body-Head Pressure Ladder", module: require('../../../assets/voice/numbers/standalone/theme-body-head-pressure-ladder.wav'), durationMs: 3364 },
  { id: 'theme-alternating-uppercut-ladder', theme: "Alternating Uppercut Ladder", module: require('../../../assets/voice/numbers/standalone/theme-alternating-uppercut-ladder.wav'), durationMs: 5013 },
  { id: 'theme-rolling-pressure-chain', theme: "Rolling Pressure Chain", module: require('../../../assets/voice/numbers/standalone/theme-rolling-pressure-chain.wav'), durationMs: 3093 },
  { id: 'theme-body-to-head-staircase', theme: "Body-to-Head Staircase", module: require('../../../assets/voice/numbers/standalone/theme-body-to-head-staircase.wav'), durationMs: 4093 },
  { id: 'theme-split-level-wave', theme: "Split-Level Wave", module: require('../../../assets/voice/numbers/standalone/theme-split-level-wave.wav'), durationMs: 5013 },
  { id: 'theme-find-your-range', theme: "Find your range", module: require('../../../assets/voice/numbers/standalone/theme-find-your-range.wav'), durationMs: 4213 },
  { id: 'theme-build-combinations', theme: "Build combinations", module: require('../../../assets/voice/numbers/standalone/theme-build-combinations.wav'), durationMs: 2893 },
  { id: 'theme-empty-the-tank', theme: "Empty the tank", module: require('../../../assets/voice/numbers/standalone/theme-empty-the-tank.wav'), durationMs: 2990 },
]

/** The clip for a round theme, or undefined when none was rendered. */
export function themeClipFor(theme: string): ThemeClip | undefined {
  return THEME_CLIPS.find((c) => c.theme === theme)
}

/* eslint-enable @typescript-eslint/no-require-imports */
