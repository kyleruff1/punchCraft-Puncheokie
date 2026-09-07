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

/**
 * Punch Kit one-shot key (drum-kit-design §6). The LOGICAL articulation is
 * the key — no note number, no filename — so the same domain gesture drives
 * Superior Drummer on the bridge and these clips on the tablet.
 */
export const kitDrumKey = (articulation: string): string => `kit:${articulation}`

/**
 * The kit pieces worth warming eagerly: the four families' ordinary hits plus
 * the body kick. Everything else — the crash, the ride bell, the rimshot, the
 * darker body snare, the hats, the sub kick, the tight ride, the rim click —
 * is RARE by design, so it loads on first use instead of holding an
 * AudioTrack that may never sound.
 *
 * That keeps the resident pool at 25 stabs + 7 kit pieces + 2 playlists,
 * comfortably clear of the ~48 ceiling, instead of the 46 that warming all
 * sixteen would cost.
 */
export const KIT_DRUM_WARM_SET = [
  'ride-bow',
  'snare-center',
  'rack-tom-high',
  'rack-tom-mid',
  'floor-tom-high',
  'floor-tom-low',
  'kick-main',
] as const
