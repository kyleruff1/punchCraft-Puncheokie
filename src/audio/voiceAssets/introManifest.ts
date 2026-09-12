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
  'intro-hello': { id: 'intro-hello', module: require('../../../assets/voice/numbers/standalone/intro-hello.wav'), durationMs: 5469 },
  'intro-rounds-2': { id: 'intro-rounds-2', module: require('../../../assets/voice/numbers/standalone/intro-rounds-2.wav'), durationMs: 6173 },
  'intro-rounds-3': { id: 'intro-rounds-3', module: require('../../../assets/voice/numbers/standalone/intro-rounds-3.wav'), durationMs: 6786 },
  'intro-rounds-4': { id: 'intro-rounds-4', module: require('../../../assets/voice/numbers/standalone/intro-rounds-4.wav'), durationMs: 6523 },
  'intro-rounds-5': { id: 'intro-rounds-5', module: require('../../../assets/voice/numbers/standalone/intro-rounds-5.wav'), durationMs: 6405 },
  'intro-rounds-6': { id: 'intro-rounds-6', module: require('../../../assets/voice/numbers/standalone/intro-rounds-6.wav'), durationMs: 6390 },
  'intro-rounds-7': { id: 'intro-rounds-7', module: require('../../../assets/voice/numbers/standalone/intro-rounds-7.wav'), durationMs: 7437 },
  'intro-rounds-8': { id: 'intro-rounds-8', module: require('../../../assets/voice/numbers/standalone/intro-rounds-8.wav'), durationMs: 6065 },
  'intro-rounds-9': { id: 'intro-rounds-9', module: require('../../../assets/voice/numbers/standalone/intro-rounds-9.wav'), durationMs: 6493 },
  'intro-rounds-10': { id: 'intro-rounds-10', module: require('../../../assets/voice/numbers/standalone/intro-rounds-10.wav'), durationMs: 7510 },
  'intro-rounds-11': { id: 'intro-rounds-11', module: require('../../../assets/voice/numbers/standalone/intro-rounds-11.wav'), durationMs: 6933 },
  'intro-rounds-12': { id: 'intro-rounds-12', module: require('../../../assets/voice/numbers/standalone/intro-rounds-12.wav'), durationMs: 6261 },
  'intro-program-beginner-technical': { id: 'intro-program-beginner-technical', module: require('../../../assets/voice/numbers/standalone/intro-program-beginner-technical.wav'), durationMs: 7613 },
  'intro-program-beginner-steady': { id: 'intro-program-beginner-steady', module: require('../../../assets/voice/numbers/standalone/intro-program-beginner-steady.wav'), durationMs: 5925 },
  'intro-program-beginner-pressure': { id: 'intro-program-beginner-pressure', module: require('../../../assets/voice/numbers/standalone/intro-program-beginner-pressure.wav'), durationMs: 6968 },
  'intro-program-beginner-sprint': { id: 'intro-program-beginner-sprint', module: require('../../../assets/voice/numbers/standalone/intro-program-beginner-sprint.wav'), durationMs: 6236 },
  'intro-program-intermediate-technical': { id: 'intro-program-intermediate-technical', module: require('../../../assets/voice/numbers/standalone/intro-program-intermediate-technical.wav'), durationMs: 7453 },
  'intro-program-intermediate-steady': { id: 'intro-program-intermediate-steady', module: require('../../../assets/voice/numbers/standalone/intro-program-intermediate-steady.wav'), durationMs: 7625 },
  'intro-program-intermediate-pressure': { id: 'intro-program-intermediate-pressure', module: require('../../../assets/voice/numbers/standalone/intro-program-intermediate-pressure.wav'), durationMs: 7013 },
  'intro-program-intermediate-sprint': { id: 'intro-program-intermediate-sprint', module: require('../../../assets/voice/numbers/standalone/intro-program-intermediate-sprint.wav'), durationMs: 7361 },
  'intro-program-advanced-technical': { id: 'intro-program-advanced-technical', module: require('../../../assets/voice/numbers/standalone/intro-program-advanced-technical.wav'), durationMs: 5681 },
  'intro-program-advanced-steady': { id: 'intro-program-advanced-steady', module: require('../../../assets/voice/numbers/standalone/intro-program-advanced-steady.wav'), durationMs: 7093 },
  'intro-program-advanced-pressure': { id: 'intro-program-advanced-pressure', module: require('../../../assets/voice/numbers/standalone/intro-program-advanced-pressure.wav'), durationMs: 6573 },
  'intro-program-advanced-sprint': { id: 'intro-program-advanced-sprint', module: require('../../../assets/voice/numbers/standalone/intro-program-advanced-sprint.wav'), durationMs: 6812 },
  'intro-letsgo': { id: 'intro-letsgo', module: require('../../../assets/voice/numbers/standalone/intro-letsgo.wav'), durationMs: 1520 },
  'warn-opener-01': { id: 'warn-opener-01', module: require('../../../assets/voice/numbers/standalone/warn-opener-01.wav'), durationMs: 2453 },
  'warn-opener-02': { id: 'warn-opener-02', module: require('../../../assets/voice/numbers/standalone/warn-opener-02.wav'), durationMs: 1293 },
  'warn-opener-03': { id: 'warn-opener-03', module: require('../../../assets/voice/numbers/standalone/warn-opener-03.wav'), durationMs: 2426 },
  'warn-opener-04': { id: 'warn-opener-04', module: require('../../../assets/voice/numbers/standalone/warn-opener-04.wav'), durationMs: 2893 },
  'warn-opener-05': { id: 'warn-opener-05', module: require('../../../assets/voice/numbers/standalone/warn-opener-05.wav'), durationMs: 2451 },
  'warn-opener-06': { id: 'warn-opener-06', module: require('../../../assets/voice/numbers/standalone/warn-opener-06.wav'), durationMs: 2512 },
  'warn-opener-07': { id: 'warn-opener-07', module: require('../../../assets/voice/numbers/standalone/warn-opener-07.wav'), durationMs: 2019 },
  'warn-opener-08': { id: 'warn-opener-08', module: require('../../../assets/voice/numbers/standalone/warn-opener-08.wav'), durationMs: 2285 },
  'warn-opener-09': { id: 'warn-opener-09', module: require('../../../assets/voice/numbers/standalone/warn-opener-09.wav'), durationMs: 1733 },
  'warn-opener-10': { id: 'warn-opener-10', module: require('../../../assets/voice/numbers/standalone/warn-opener-10.wav'), durationMs: 3893 },
  'warn-opener-11': { id: 'warn-opener-11', module: require('../../../assets/voice/numbers/standalone/warn-opener-11.wav'), durationMs: 2673 },
  'warn-opener-12': { id: 'warn-opener-12', module: require('../../../assets/voice/numbers/standalone/warn-opener-12.wav'), durationMs: 2310 },
  'warn-opener-13': { id: 'warn-opener-13', module: require('../../../assets/voice/numbers/standalone/warn-opener-13.wav'), durationMs: 1782 },
  'warn-opener-14': { id: 'warn-opener-14', module: require('../../../assets/voice/numbers/standalone/warn-opener-14.wav'), durationMs: 3319 },
  'warn-opener-15': { id: 'warn-opener-15', module: require('../../../assets/voice/numbers/standalone/warn-opener-15.wav'), durationMs: 2653 },
  'warn-round-2': { id: 'warn-round-2', module: require('../../../assets/voice/numbers/standalone/warn-round-2.wav'), durationMs: 5455 },
  'warn-round-3': { id: 'warn-round-3', module: require('../../../assets/voice/numbers/standalone/warn-round-3.wav'), durationMs: 4080 },
  'warn-round-4': { id: 'warn-round-4', module: require('../../../assets/voice/numbers/standalone/warn-round-4.wav'), durationMs: 5221 },
  'warn-round-5': { id: 'warn-round-5', module: require('../../../assets/voice/numbers/standalone/warn-round-5.wav'), durationMs: 5320 },
  'warn-round-6': { id: 'warn-round-6', module: require('../../../assets/voice/numbers/standalone/warn-round-6.wav'), durationMs: 4959 },
  'warn-round-7': { id: 'warn-round-7', module: require('../../../assets/voice/numbers/standalone/warn-round-7.wav'), durationMs: 5425 },
  'warn-round-8': { id: 'warn-round-8', module: require('../../../assets/voice/numbers/standalone/warn-round-8.wav'), durationMs: 6000 },
  'warn-round-9': { id: 'warn-round-9', module: require('../../../assets/voice/numbers/standalone/warn-round-9.wav'), durationMs: 5579 },
  'warn-round-10': { id: 'warn-round-10', module: require('../../../assets/voice/numbers/standalone/warn-round-10.wav'), durationMs: 5459 },
  'warn-round-11': { id: 'warn-round-11', module: require('../../../assets/voice/numbers/standalone/warn-round-11.wav'), durationMs: 5024 },
  'warn-round-12': { id: 'warn-round-12', module: require('../../../assets/voice/numbers/standalone/warn-round-12.wav'), durationMs: 5536 },
  'power-strikes': { id: 'power-strikes', module: require('../../../assets/voice/numbers/standalone/power-strikes.wav'), durationMs: 3074 },
}

/* eslint-enable @typescript-eslint/no-require-imports */
