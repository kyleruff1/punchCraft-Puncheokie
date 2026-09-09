/**
 * The sample-and-hold latch (instrument-design §8): each hand owns one
 * monophonic voice that keeps its note until that hand punches again or
 * the session releases. Pure state machine — MIDI rendering happens on
 * the bridge; this only decides WHAT changed.
 */

export type VoiceChange = 'first' | 'new-zone' | 'same-zone'

export interface LatchedVoiceState {
  zone: number | null
  note: number | null
  lastPunchAtMs: number | null
}

export interface InstrumentLatchState {
  left: LatchedVoiceState
  right: LatchedVoiceState
}

export function emptyLatch(): InstrumentLatchState {
  return {
    left: { zone: null, note: null, lastPunchAtMs: null },
    right: { zone: null, note: null, lastPunchAtMs: null },
  }
}

export interface VoiceAdvance {
  state: InstrumentLatchState
  change: VoiceChange
  /** Zone distance moved (0 for first/same-zone). */
  zoneDistance: number
}

/** Advance one hand's voice to a new zone+note; the other hand holds. */
export function advanceVoice(
  state: InstrumentLatchState,
  hand: 'left' | 'right',
  zone: number,
  note: number,
  atMs: number,
): VoiceAdvance {
  const voice = state[hand]
  const change: VoiceChange =
    voice.zone === null ? 'first' : voice.zone === zone ? 'same-zone' : 'new-zone'
  const zoneDistance = voice.zone === null ? 0 : Math.abs(zone - voice.zone)
  return {
    state: { ...state, [hand]: { zone, note, lastPunchAtMs: atMs } },
    change,
    zoneDistance,
  }
}
