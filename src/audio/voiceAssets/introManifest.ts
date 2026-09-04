/**
 * Workout intro segments (generated).
 *
 * DO NOT EDIT — produced by `node tools/voice/make-intro-clips.mjs`.
 * Durations are measured from the rendered files; the pre-round
 * countdown offset is computed from them.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export interface IntroSegment {
  id: string
  /** Metro module id for the clip. */
  module: number
  durationMs: number
}

export const INTRO_SEGMENTS: Readonly<Record<string, IntroSegment>> = {
  'intro-hello': { id: 'intro-hello', module: require('../../../assets/voice/numbers/standalone/intro-hello.wav'), durationMs: 6360 },
  'intro-rounds-2': { id: 'intro-rounds-2', module: require('../../../assets/voice/numbers/standalone/intro-rounds-2.wav'), durationMs: 7429 },
  'intro-rounds-3': { id: 'intro-rounds-3', module: require('../../../assets/voice/numbers/standalone/intro-rounds-3.wav'), durationMs: 5719 },
  'intro-rounds-4': { id: 'intro-rounds-4', module: require('../../../assets/voice/numbers/standalone/intro-rounds-4.wav'), durationMs: 6619 },
  'intro-rounds-5': { id: 'intro-rounds-5', module: require('../../../assets/voice/numbers/standalone/intro-rounds-5.wav'), durationMs: 6621 },
  'intro-rounds-6': { id: 'intro-rounds-6', module: require('../../../assets/voice/numbers/standalone/intro-rounds-6.wav'), durationMs: 6845 },
  'intro-rounds-7': { id: 'intro-rounds-7', module: require('../../../assets/voice/numbers/standalone/intro-rounds-7.wav'), durationMs: 7787 },
  'intro-rounds-8': { id: 'intro-rounds-8', module: require('../../../assets/voice/numbers/standalone/intro-rounds-8.wav'), durationMs: 6520 },
  'intro-rounds-9': { id: 'intro-rounds-9', module: require('../../../assets/voice/numbers/standalone/intro-rounds-9.wav'), durationMs: 6132 },
  'intro-rounds-10': { id: 'intro-rounds-10', module: require('../../../assets/voice/numbers/standalone/intro-rounds-10.wav'), durationMs: 6320 },
  'intro-rounds-11': { id: 'intro-rounds-11', module: require('../../../assets/voice/numbers/standalone/intro-rounds-11.wav'), durationMs: 7040 },
  'intro-rounds-12': { id: 'intro-rounds-12', module: require('../../../assets/voice/numbers/standalone/intro-rounds-12.wav'), durationMs: 6660 },
  'intro-program-beginner-technical': { id: 'intro-program-beginner-technical', module: require('../../../assets/voice/numbers/standalone/intro-program-beginner-technical.wav'), durationMs: 6731 },
  'intro-program-beginner-steady': { id: 'intro-program-beginner-steady', module: require('../../../assets/voice/numbers/standalone/intro-program-beginner-steady.wav'), durationMs: 6194 },
  'intro-program-beginner-pressure': { id: 'intro-program-beginner-pressure', module: require('../../../assets/voice/numbers/standalone/intro-program-beginner-pressure.wav'), durationMs: 6896 },
  'intro-program-beginner-sprint': { id: 'intro-program-beginner-sprint', module: require('../../../assets/voice/numbers/standalone/intro-program-beginner-sprint.wav'), durationMs: 7265 },
  'intro-program-intermediate-technical': { id: 'intro-program-intermediate-technical', module: require('../../../assets/voice/numbers/standalone/intro-program-intermediate-technical.wav'), durationMs: 6520 },
  'intro-program-intermediate-steady': { id: 'intro-program-intermediate-steady', module: require('../../../assets/voice/numbers/standalone/intro-program-intermediate-steady.wav'), durationMs: 6955 },
  'intro-program-intermediate-pressure': { id: 'intro-program-intermediate-pressure', module: require('../../../assets/voice/numbers/standalone/intro-program-intermediate-pressure.wav'), durationMs: 6651 },
  'intro-program-intermediate-sprint': { id: 'intro-program-intermediate-sprint', module: require('../../../assets/voice/numbers/standalone/intro-program-intermediate-sprint.wav'), durationMs: 6987 },
  'intro-program-advanced-technical': { id: 'intro-program-advanced-technical', module: require('../../../assets/voice/numbers/standalone/intro-program-advanced-technical.wav'), durationMs: 6446 },
  'intro-program-advanced-steady': { id: 'intro-program-advanced-steady', module: require('../../../assets/voice/numbers/standalone/intro-program-advanced-steady.wav'), durationMs: 6909 },
  'intro-program-advanced-pressure': { id: 'intro-program-advanced-pressure', module: require('../../../assets/voice/numbers/standalone/intro-program-advanced-pressure.wav'), durationMs: 7468 },
  'intro-program-advanced-sprint': { id: 'intro-program-advanced-sprint', module: require('../../../assets/voice/numbers/standalone/intro-program-advanced-sprint.wav'), durationMs: 6832 },
  'intro-letsgo': { id: 'intro-letsgo', module: require('../../../assets/voice/numbers/standalone/intro-letsgo.wav'), durationMs: 1320 },
  'warn-opener-01': { id: 'warn-opener-01', module: require('../../../assets/voice/numbers/standalone/warn-opener-01.wav'), durationMs: 2076 },
  'warn-opener-02': { id: 'warn-opener-02', module: require('../../../assets/voice/numbers/standalone/warn-opener-02.wav'), durationMs: 1363 },
  'warn-opener-03': { id: 'warn-opener-03', module: require('../../../assets/voice/numbers/standalone/warn-opener-03.wav'), durationMs: 2372 },
  'warn-opener-04': { id: 'warn-opener-04', module: require('../../../assets/voice/numbers/standalone/warn-opener-04.wav'), durationMs: 2280 },
  'warn-opener-05': { id: 'warn-opener-05', module: require('../../../assets/voice/numbers/standalone/warn-opener-05.wav'), durationMs: 1989 },
  'warn-opener-06': { id: 'warn-opener-06', module: require('../../../assets/voice/numbers/standalone/warn-opener-06.wav'), durationMs: 2278 },
  'warn-opener-07': { id: 'warn-opener-07', module: require('../../../assets/voice/numbers/standalone/warn-opener-07.wav'), durationMs: 1859 },
  'warn-opener-08': { id: 'warn-opener-08', module: require('../../../assets/voice/numbers/standalone/warn-opener-08.wav'), durationMs: 2280 },
  'warn-opener-09': { id: 'warn-opener-09', module: require('../../../assets/voice/numbers/standalone/warn-opener-09.wav'), durationMs: 1480 },
  'warn-opener-10': { id: 'warn-opener-10', module: require('../../../assets/voice/numbers/standalone/warn-opener-10.wav'), durationMs: 3040 },
  'warn-opener-11': { id: 'warn-opener-11', module: require('../../../assets/voice/numbers/standalone/warn-opener-11.wav'), durationMs: 2284 },
  'warn-opener-12': { id: 'warn-opener-12', module: require('../../../assets/voice/numbers/standalone/warn-opener-12.wav'), durationMs: 2730 },
  'warn-opener-13': { id: 'warn-opener-13', module: require('../../../assets/voice/numbers/standalone/warn-opener-13.wav'), durationMs: 2217 },
  'warn-opener-14': { id: 'warn-opener-14', module: require('../../../assets/voice/numbers/standalone/warn-opener-14.wav'), durationMs: 2571 },
  'warn-opener-15': { id: 'warn-opener-15', module: require('../../../assets/voice/numbers/standalone/warn-opener-15.wav'), durationMs: 2591 },
  'warn-round-2': { id: 'warn-round-2', module: require('../../../assets/voice/numbers/standalone/warn-round-2.wav'), durationMs: 5440 },
  'warn-round-3': { id: 'warn-round-3', module: require('../../../assets/voice/numbers/standalone/warn-round-3.wav'), durationMs: 5183 },
  'warn-round-4': { id: 'warn-round-4', module: require('../../../assets/voice/numbers/standalone/warn-round-4.wav'), durationMs: 5680 },
  'warn-round-5': { id: 'warn-round-5', module: require('../../../assets/voice/numbers/standalone/warn-round-5.wav'), durationMs: 4771 },
  'warn-round-6': { id: 'warn-round-6', module: require('../../../assets/voice/numbers/standalone/warn-round-6.wav'), durationMs: 5011 },
  'warn-round-7': { id: 'warn-round-7', module: require('../../../assets/voice/numbers/standalone/warn-round-7.wav'), durationMs: 4913 },
  'warn-round-8': { id: 'warn-round-8', module: require('../../../assets/voice/numbers/standalone/warn-round-8.wav'), durationMs: 4583 },
  'warn-round-9': { id: 'warn-round-9', module: require('../../../assets/voice/numbers/standalone/warn-round-9.wav'), durationMs: 5080 },
  'warn-round-10': { id: 'warn-round-10', module: require('../../../assets/voice/numbers/standalone/warn-round-10.wav'), durationMs: 6880 },
  'warn-round-11': { id: 'warn-round-11', module: require('../../../assets/voice/numbers/standalone/warn-round-11.wav'), durationMs: 5634 },
  'warn-round-12': { id: 'warn-round-12', module: require('../../../assets/voice/numbers/standalone/warn-round-12.wav'), durationMs: 6203 },
  'power-strikes': { id: 'power-strikes', module: require('../../../assets/voice/numbers/standalone/power-strikes.wav'), durationMs: 3840 },
}

/* eslint-enable @typescript-eslint/no-require-imports */
