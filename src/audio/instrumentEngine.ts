/**
 * Which audio engine backs the instrument (audio-engine-migration.md).
 *
 * Deliberately ZERO imports, for the same reason `instrumentBankKeys.ts` is:
 * the settings store needs this type, and routing it through the engine
 * implementation would drag `expo-audio` — and later Oboe — into every store
 * test. That is not hypothetical; it broke three suites the first time.
 *
 * `expo`  — Media3 ExoPlayer via expo-audio. Measured on the TB125FU at
 *           119.4 ms median / 50.6 ms jitter for a kit one-shot; its tracks
 *           carry Flags 0x000 with a 15104-frame buffer and never reach the
 *           fast mixer, because media3 floors its PCM buffer at 250 ms.
 * `oboe`  — react-native-audio-api → Oboe → AAudio. Confirmed on device as
 *           fast-track index 1 at 48 kHz with a 512-frame buffer.
 */
export type InstrumentEngine = 'expo' | 'oboe'

export const INSTRUMENT_ENGINES: readonly InstrumentEngine[] = ['expo', 'oboe']
