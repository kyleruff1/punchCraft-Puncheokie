/**
 * Silence tracks — the walkout's and the rest-side recovery's pauses,
 * as playable assets.
 *
 * The walkout plays through a NATIVE playlist (no JS in the sequencing
 * loop; see `IntroPlayer`), so its planned pauses must be tracks too.
 * `RecoveryPlayer` follows the same doctrine for the inter-round
 * recovery walkthrough, so its `pauseAfterMs` holds — up to 5 s —
 * ship as real silence too. Every gap either planner can emit exists
 * here: the sentence breath, the double breath before the joke, the
 * quantized landing-beat range, and the recovery corpus's hold set
 * (1000/1500/2000/2500/3000/3500/4000/4500/5000).
 * Files are generated with ffmpeg anullsrc at 24 kHz mono, matching the
 * voice clips so the playlist never renegotiates format.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export const SILENCE_TRACKS: Readonly<Record<number, number>> = {
  350: require('../../../assets/voice/numbers/standalone/silence-350.wav'),
  800: require('../../../assets/voice/numbers/standalone/silence-800.wav'),
  900: require('../../../assets/voice/numbers/standalone/silence-900.wav'),
  1000: require('../../../assets/voice/numbers/standalone/silence-1000.wav'),
  1200: require('../../../assets/voice/numbers/standalone/silence-1200.wav'),
  1400: require('../../../assets/voice/numbers/standalone/silence-1400.wav'),
  1500: require('../../../assets/voice/numbers/standalone/silence-1500.wav'),
  1600: require('../../../assets/voice/numbers/standalone/silence-1600.wav'),
  1700: require('../../../assets/voice/numbers/standalone/silence-1700.wav'),
  1800: require('../../../assets/voice/numbers/standalone/silence-1800.wav'),
  2000: require('../../../assets/voice/numbers/standalone/silence-2000.wav'),
  2200: require('../../../assets/voice/numbers/standalone/silence-2200.wav'),
  2500: require('../../../assets/voice/numbers/standalone/silence-2500.wav'),
  3000: require('../../../assets/voice/numbers/standalone/silence-3000.wav'),
  3500: require('../../../assets/voice/numbers/standalone/silence-3500.wav'),
  4000: require('../../../assets/voice/numbers/standalone/silence-4000.wav'),
  4500: require('../../../assets/voice/numbers/standalone/silence-4500.wav'),
  5000: require('../../../assets/voice/numbers/standalone/silence-5000.wav'),
}

/* eslint-enable @typescript-eslint/no-require-imports */

/** The silence module for a planned gap, or undefined for a zero gap. */
export function silenceFor(gapMs: number): number | undefined {
  return gapMs > 0 ? SILENCE_TRACKS[gapMs] : undefined
}
