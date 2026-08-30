/**
 * Coasting coach lines (generated; M39-V2 Phase 4b).
 *
 * DO NOT EDIT — produced by `node tools/voice/make-coast-clips.mjs`.
 *
 * Each entry pairs a rendered wav with a scoped slot. `blockKind`
 * scopes the intro/check-in to a count-scored block type;
 * `role` is intro (one at cue start) vs checkin (authored fraction
 * of block duration); `timing` is synchronized (align to next
 * pulse) or independent (fire when its tick arrives, unaligned).
 *
 * The compiler resolves check-in placements at compileCue time:
 *   `atTick = blockStartTick + Math.round(blockDurationTicks × atFraction)`
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export type CoastBlockKind = 'active-recovery' | 'volume-burst' | 'open-pressure'
export type CoastRole = 'intro' | 'checkin'
export type CoastTiming = 'synchronized' | 'independent'

export interface CoastClip {
  id: string
  blockKind: CoastBlockKind
  role: CoastRole
  /** A named slot inside the block (opener / early / mid / late / ...). */
  slot: string
  /** Design position 0..1 as a fraction of block duration. Intros are 0.0. */
  atFraction: number
  /** Whether the compiler should pulse-align this event. Null for intros. */
  timing: CoastTiming | null
  /** The exact rendered text (for diagnostics + fit-check). */
  text: string
  /** Metro module id for the wav. */
  module: number
  /** Measured duration of the rendered clip, in milliseconds. */
  durationMs: number
}

export const COAST_CLIPS: readonly CoastClip[] = [
  { id: 'co-ar-intro-01', blockKind: 'active-recovery', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Ease off. Just breathe.", module: require('../../../assets/voice/numbers/standalone/co-ar-intro-01.wav'), durationMs: 2333 },
  { id: 'co-ar-intro-02', blockKind: 'active-recovery', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Slow it down. Long jabs, big breaths.", module: require('../../../assets/voice/numbers/standalone/co-ar-intro-02.wav'), durationMs: 2813 },
  { id: 'co-ar-intro-03', blockKind: 'active-recovery', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Recover. Hands up, feet moving.", module: require('../../../assets/voice/numbers/standalone/co-ar-intro-03.wav'), durationMs: 3213 },
  { id: 'co-ar-checkin-mid-01', blockKind: 'active-recovery', role: 'checkin', slot: 'mid', atFraction: 0.4, timing: 'independent', text: "Big breath in.", module: require('../../../assets/voice/numbers/standalone/co-ar-checkin-mid-01.wav'), durationMs: 1973 },
  { id: 'co-ar-checkin-mid-02', blockKind: 'active-recovery', role: 'checkin', slot: 'mid', atFraction: 0.4, timing: 'independent', text: "Hands stay up.", module: require('../../../assets/voice/numbers/standalone/co-ar-checkin-mid-02.wav'), durationMs: 1373 },
  { id: 'co-ar-checkin-mid-03', blockKind: 'active-recovery', role: 'checkin', slot: 'mid', atFraction: 0.4, timing: 'independent', text: "Loose shoulders.", module: require('../../../assets/voice/numbers/standalone/co-ar-checkin-mid-03.wav'), durationMs: 1373 },
  { id: 'co-ar-checkin-late-01', blockKind: 'active-recovery', role: 'checkin', slot: 'late', atFraction: 0.8, timing: 'synchronized', text: "Getting set.", module: require('../../../assets/voice/numbers/standalone/co-ar-checkin-late-01.wav'), durationMs: 1007 },
  { id: 'co-ar-checkin-late-02', blockKind: 'active-recovery', role: 'checkin', slot: 'late', atFraction: 0.8, timing: 'synchronized', text: "Ready.", module: require('../../../assets/voice/numbers/standalone/co-ar-checkin-late-02.wav'), durationMs: 853 },
  { id: 'co-ar-checkin-late-03', blockKind: 'active-recovery', role: 'checkin', slot: 'late', atFraction: 0.8, timing: 'synchronized', text: "Next set coming.", module: require('../../../assets/voice/numbers/standalone/co-ar-checkin-late-03.wav'), durationMs: 1573 },
  { id: 'co-vb-intro-short-01', blockKind: 'volume-burst', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Snap them.", module: require('../../../assets/voice/numbers/standalone/co-vb-intro-short-01.wav'), durationMs: 2013 },
  { id: 'co-vb-intro-short-02', blockKind: 'volume-burst', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Steady rhythm.", module: require('../../../assets/voice/numbers/standalone/co-vb-intro-short-02.wav'), durationMs: 1213 },
  { id: 'co-vb-intro-short-03', blockKind: 'volume-burst', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "One-twos. Go.", module: require('../../../assets/voice/numbers/standalone/co-vb-intro-short-03.wav'), durationMs: 1773 },
  { id: 'co-vb-intro-long-01', blockKind: 'volume-burst', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Full combo. Keep it clean.", module: require('../../../assets/voice/numbers/standalone/co-vb-intro-long-01.wav'), durationMs: 2533 },
  { id: 'co-vb-intro-long-02', blockKind: 'volume-burst', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Punch through.", module: require('../../../assets/voice/numbers/standalone/co-vb-intro-long-02.wav'), durationMs: 1173 },
  { id: 'co-vb-intro-long-03', blockKind: 'volume-burst', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Stay on rhythm.", module: require('../../../assets/voice/numbers/standalone/co-vb-intro-long-03.wav'), durationMs: 973 },
  { id: 'co-vb-intro-body-01', blockKind: 'volume-burst', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Downstairs. Punch through.", module: require('../../../assets/voice/numbers/standalone/co-vb-intro-body-01.wav'), durationMs: 2013 },
  { id: 'co-vb-intro-body-02', blockKind: 'volume-burst', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Sink the body shot.", module: require('../../../assets/voice/numbers/standalone/co-vb-intro-body-02.wav'), durationMs: 1493 },
  { id: 'co-vb-checkin-early-01', blockKind: 'volume-burst', role: 'checkin', slot: 'early', atFraction: 0.25, timing: 'synchronized', text: "Push it.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-early-01.wav'), durationMs: 1453 },
  { id: 'co-vb-checkin-early-02', blockKind: 'volume-burst', role: 'checkin', slot: 'early', atFraction: 0.25, timing: 'synchronized', text: "There it is.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-early-02.wav'), durationMs: 1253 },
  { id: 'co-vb-checkin-early-03', blockKind: 'volume-burst', role: 'checkin', slot: 'early', atFraction: 0.25, timing: 'synchronized', text: "Stay long.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-early-03.wav'), durationMs: 2453 },
  { id: 'co-vb-checkin-mid-01', blockKind: 'volume-burst', role: 'checkin', slot: 'mid', atFraction: 0.55, timing: 'synchronized', text: "Halfway. Do not slow.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-mid-01.wav'), durationMs: 1813 },
  { id: 'co-vb-checkin-mid-02', blockKind: 'volume-burst', role: 'checkin', slot: 'mid', atFraction: 0.55, timing: 'synchronized', text: "Faster hands.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-mid-02.wav'), durationMs: 1533 },
  { id: 'co-vb-checkin-mid-03', blockKind: 'volume-burst', role: 'checkin', slot: 'mid', atFraction: 0.55, timing: 'synchronized', text: "Hips through.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-mid-03.wav'), durationMs: 2713 },
  { id: 'co-vb-checkin-hold-01', blockKind: 'volume-burst', role: 'checkin', slot: 'hold', atFraction: 0.4, timing: 'synchronized', text: "Hold the rhythm.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-hold-01.wav'), durationMs: 1068 },
  { id: 'co-vb-checkin-late-01', blockKind: 'volume-burst', role: 'checkin', slot: 'late', atFraction: 0.8, timing: 'independent', text: "Ten seconds. Empty it.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-late-01.wav'), durationMs: 2351 },
  { id: 'co-vb-checkin-late-02', blockKind: 'volume-burst', role: 'checkin', slot: 'late', atFraction: 0.8, timing: 'independent', text: "Finish strong.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-late-02.wav'), durationMs: 2533 },
  { id: 'co-vb-checkin-late-03', blockKind: 'volume-burst', role: 'checkin', slot: 'late', atFraction: 0.8, timing: 'independent', text: "Almost.", module: require('../../../assets/voice/numbers/standalone/co-vb-checkin-late-03.wav'), durationMs: 1253 },
  { id: 'co-vb-ending-01', blockKind: 'volume-burst', role: 'checkin', slot: 'ending', atFraction: 0.95, timing: 'synchronized', text: "Reset.", module: require('../../../assets/voice/numbers/standalone/co-vb-ending-01.wav'), durationMs: 733 },
  { id: 'co-op-intro-01', blockKind: 'open-pressure', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Flurry. Empty the tank.", module: require('../../../assets/voice/numbers/standalone/co-op-intro-01.wav'), durationMs: 2293 },
  { id: 'co-op-intro-02', blockKind: 'open-pressure', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Open window. Nothing held back.", module: require('../../../assets/voice/numbers/standalone/co-op-intro-02.wav'), durationMs: 2620 },
  { id: 'co-op-intro-03', blockKind: 'open-pressure', role: 'intro', slot: 'opener', atFraction: 0, timing: null, text: "Final thirty. All of it.", module: require('../../../assets/voice/numbers/standalone/co-op-intro-03.wav'), durationMs: 1880 },
  { id: 'co-op-checkin-kick-01', blockKind: 'open-pressure', role: 'checkin', slot: 'kick', atFraction: 0.2, timing: 'synchronized', text: "Go, go, go.", module: require('../../../assets/voice/numbers/standalone/co-op-checkin-kick-01.wav'), durationMs: 1213 },
  { id: 'co-op-checkin-kick-02', blockKind: 'open-pressure', role: 'checkin', slot: 'kick', atFraction: 0.2, timing: 'synchronized', text: "That is it.", module: require('../../../assets/voice/numbers/standalone/co-op-checkin-kick-02.wav'), durationMs: 2093 },
  { id: 'co-op-checkin-mid-01', blockKind: 'open-pressure', role: 'checkin', slot: 'mid', atFraction: 0.45, timing: 'synchronized', text: "Halfway.", module: require('../../../assets/voice/numbers/standalone/co-op-checkin-mid-01.wav'), durationMs: 1333 },
  { id: 'co-op-checkin-mid-02', blockKind: 'open-pressure', role: 'checkin', slot: 'mid', atFraction: 0.45, timing: 'synchronized', text: "Halfway. Dig in.", module: require('../../../assets/voice/numbers/standalone/co-op-checkin-mid-02.wav'), durationMs: 1533 },
  { id: 'co-op-checkin-warn-01', blockKind: 'open-pressure', role: 'checkin', slot: 'warn', atFraction: 0.7, timing: 'independent', text: "Last ten.", module: require('../../../assets/voice/numbers/standalone/co-op-checkin-warn-01.wav'), durationMs: 1133 },
  { id: 'co-op-checkin-warn-02', blockKind: 'open-pressure', role: 'checkin', slot: 'warn', atFraction: 0.7, timing: 'independent', text: "Ten seconds. Everything.", module: require('../../../assets/voice/numbers/standalone/co-op-checkin-warn-02.wav'), durationMs: 2533 },
  { id: 'co-op-checkin-bell-01', blockKind: 'open-pressure', role: 'checkin', slot: 'bell', atFraction: 0.9, timing: 'independent', text: "Bell. Bell. Bell.", module: require('../../../assets/voice/numbers/standalone/co-op-checkin-bell-01.wav'), durationMs: 2893 },
  { id: 'co-op-checkin-bell-02', blockKind: 'open-pressure', role: 'checkin', slot: 'bell', atFraction: 0.9, timing: 'independent', text: "Empty it.", module: require('../../../assets/voice/numbers/standalone/co-op-checkin-bell-02.wav'), durationMs: 1253 },
]

/**
 * Every rendered clip that could open a given block kind (role = intro).
 * The runtime picks one — random rotation, or authored per-cue.
 */
export function coastIntrosFor(blockKind: CoastBlockKind): readonly CoastClip[] {
  return COAST_CLIPS.filter((c) => c.blockKind === blockKind && c.role === 'intro')
}

/**
 * Every rendered check-in for a block kind, in ascending atFraction
 * order. The compiler groups by slot and picks one per slot per rep.
 */
export function coastCheckinsFor(blockKind: CoastBlockKind): readonly CoastClip[] {
  return COAST_CLIPS.filter((c) => c.blockKind === blockKind && c.role === 'checkin').slice().sort(
    (a, b) => a.atFraction - b.atFraction,
  )
}

/* eslint-enable @typescript-eslint/no-require-imports */
