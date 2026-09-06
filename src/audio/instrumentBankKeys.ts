/**
 * Key scheme for the tablet instrument sample bank (M40-15 #319) — the ONE
 * vocabulary the render tool (tools/tablet-voice), the generated manifest
 * (voiceAssets/instrumentBankManifest.ts), and the runtime selection /
 * engine all share, so a key can never drift between the offline renderer
 * and the player that looks it up.
 *
 * Deliberately ZERO imports: the render tool consumes this file under tsx
 * via a relative path and the app under the @audio alias — no resolution
 * risk on either side.
 */
export const bedKey = (leftZone: number, layer: number): string => `bed-L${leftZone}-A${layer}`
export const bassKey = (leftZone: number): string => `bass-L${leftZone}`
export const stabKey = (midiNote: number): string => `stab-${midiNote}`
export const INSTRUMENT_DRUM_KEYS = ['kick', 'snare', 'rim', 'tom', 'crash'] as const
export type InstrumentDrumKey = (typeof INSTRUMENT_DRUM_KEYS)[number]
/**
 * gesture.transient.note -> drum. The family's drum class picks the piece
 * (M40-25/28): 37 rim = jab, 36 kick = cross, 38 snare = hook, 45 low tom =
 * uppercut. 49 crash is RESERVED for a velocity peak, never routine.
 */
export const DRUM_KEY_BY_MIDI: Readonly<Record<number, InstrumentDrumKey>> = {
  36: 'kick',
  37: 'rim',
  38: 'snare',
  45: 'tom',
  49: 'crash',
}
