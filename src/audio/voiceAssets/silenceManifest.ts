/**
 * Silence tracks — the walkout's pauses, as playable assets.
 *
 * The walkout plays through a NATIVE playlist (no JS in the sequencing
 * loop; see `IntroPlayer`), so its planned pauses must be tracks too.
 * Every gap the planner can emit exists here: the sentence breath, the
 * double breath before the joke, and the quantized landing-beat range.
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
  1600: require('../../../assets/voice/numbers/standalone/silence-1600.wav'),
  1700: require('../../../assets/voice/numbers/standalone/silence-1700.wav'),
  1800: require('../../../assets/voice/numbers/standalone/silence-1800.wav'),
  2000: require('../../../assets/voice/numbers/standalone/silence-2000.wav'),
  2200: require('../../../assets/voice/numbers/standalone/silence-2200.wav'),
}

/* eslint-enable @typescript-eslint/no-require-imports */

/** The silence module for a planned gap, or undefined for a zero gap. */
export function silenceFor(gapMs: number): number | undefined {
  return gapMs > 0 ? SILENCE_TRACKS[gapMs] : undefined
}
