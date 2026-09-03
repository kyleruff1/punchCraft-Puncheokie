/**
 * Inter-round recovery walkthroughs (generated from tools/voice/recovery.json).
 *
 * One entry per script; each script is a sequence of pre-rendered
 * segments and scheduled pauses between them. `RecoveryPlayer` builds
 * a single native audio playlist per rest: segment, silence, segment,
 * silence, ... — the pauses are shipped as real silence assets so no
 * JavaScript sequences the audio at run time.
 *
 * Scripts whose measured total exceeds the corpus cap
 * (45000 ms) are EXCLUDED from the manifest; a build-time
 * console error names them.
 *
 * DO NOT EDIT — regenerate with `node tools/voice/make-recovery-clips.mjs`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export interface RecoverySegmentClip {
  /** Metro module id for the segment wav. */
  module: number
  /** Measured duration of the rendered segment, in milliseconds. */
  durationMs: number
  /** Held silence to schedule AFTER this segment (from the corpus). */
  pauseAfterMs: number
}

export interface RecoveryScript {
  scriptId: string
  title: string
  category: string
  tags: readonly string[]
  hydrationPrompt: boolean
  requiresStableBag: boolean
  avoidIfDizzy: boolean
  segments: readonly RecoverySegmentClip[]
  /** Sum of measured segment durations plus scheduled pauses. */
  measuredTotalMs: number
  corpusVersion: string
}

export const RECOVERY_SCRIPTS: readonly RecoveryScript[] = [
  {
    scriptId: "R01",
    title: "Reach High, Settle Low",
    category: "mixed",
    tags: ["breathing","overhead_reach","side_bend"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s1.wav'), durationMs: 6175, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s2.wav'), durationMs: 5520, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s3.wav'), durationMs: 4931, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s4.wav'), durationMs: 5800, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s5.wav'), durationMs: 8651, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 43077,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R02",
    title: "Cross-Body Shoulder Reset",
    category: "upper_body",
    tags: ["breathing","shoulder","cross_body","hydration_optional"],
    hydrationPrompt: true,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s1.wav'), durationMs: 8711, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s2.wav'), durationMs: 8220, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s3.wav'), durationMs: 3683, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s4.wav'), durationMs: 7680, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 39294,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R03",
    title: "Bag-Side Chest Opener",
    category: "upper_body",
    tags: ["chest","front_shoulder","bag_assisted","breathing"],
    hydrationPrompt: false,
    requiresStableBag: true,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s1.wav'), durationMs: 6480, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s2.wav'), durationMs: 7825, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s3.wav'), durationMs: 7284, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s4.wav'), durationMs: 8360, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40949,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R04",
    title: "Elbow High, Side Long",
    category: "upper_body",
    tags: ["triceps","lat","side_bend","symmetrical"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s1.wav'), durationMs: 7877, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s2.wav'), durationMs: 5611, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s3.wav'), durationMs: 7800, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s4.wav'), durationMs: 5802, pauseAfterMs: 3000 },
    ],
    measuredTotalMs: 41090,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R05",
    title: "Shoulder and Elbow Mobility",
    category: "upper_body",
    tags: ["dynamic_mobility","shoulder_rolls","elbows","guard_reset"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s1.wav'), durationMs: 7545, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s2.wav'), durationMs: 5240, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s3.wav'), durationMs: 7085, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s4.wav'), durationMs: 5335, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s5.wav'), durationMs: 6544, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42249,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R06",
    title: "Upper-Back Reach and Sip",
    category: "upper_body",
    tags: ["upper_back","scapular","hydration_optional","breathing"],
    hydrationPrompt: true,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s1.wav'), durationMs: 6320, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s2.wav'), durationMs: 6160, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s3.wav'), durationMs: 6581, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s4.wav'), durationMs: 2936, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s5.wav'), durationMs: 7501, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 41498,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R07",
    title: "Easy Torso Turns",
    category: "torso",
    tags: ["dynamic_mobility","rotation","hips","guard_reset"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s1.wav'), durationMs: 4477, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s2.wav'), durationMs: 6606, pauseAfterMs: 1500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s3.wav'), durationMs: 6767, pauseAfterMs: 1500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s4.wav'), durationMs: 5030, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s5.wav'), durationMs: 8847, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40727,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R08",
    title: "Rib-Cage Breathing",
    category: "torso",
    tags: ["breathing","side_bend","ribs","recovery"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s1.wav'), durationMs: 6624, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s2.wav'), durationMs: 6389, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s3.wav'), durationMs: 6200, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s4.wav'), durationMs: 9926, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40139,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R09",
    title: "Soft-Knee Toe Reach",
    category: "lower_body",
    tags: ["hamstring","forward_hinge","toe_reach","breathing"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: true,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s1.wav'), durationMs: 6588, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s2.wav'), durationMs: 6099, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s3.wav'), durationMs: 7402, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s4.wav'), durationMs: 4710, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s5.wav'), durationMs: 6114, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 41913,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R10",
    title: "Split-Stance Hamstrings",
    category: "lower_body",
    tags: ["hamstring","split_stance","hydration_optional","symmetrical"],
    hydrationPrompt: true,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s1.wav'), durationMs: 8332, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s2.wav'), durationMs: 5373, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s3.wav'), durationMs: 6916, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s4.wav'), durationMs: 8920, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40541,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R11",
    title: "Calves Against the Floor",
    category: "lower_body",
    tags: ["calf","ankle","split_stance","bag_optional"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s1.wav'), durationMs: 8360, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s2.wav'), durationMs: 5909, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s3.wav'), durationMs: 6525, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s4.wav'), durationMs: 8479, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40273,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R12",
    title: "Hip-Flexor Stance Reset",
    category: "lower_body",
    tags: ["hip_flexor","split_stance","glute","posture"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s1.wav'), durationMs: 5844, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s2.wav'), durationMs: 8907, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s3.wav'), durationMs: 7437, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s4.wav'), durationMs: 9225, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42413,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R13",
    title: "Ankles and Light Feet",
    category: "lower_body",
    tags: ["dynamic_mobility","ankle","calf","footwork"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s1.wav'), durationMs: 7877, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s2.wav'), durationMs: 6315, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s3.wav'), durationMs: 6725, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s4.wav'), durationMs: 9864, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40781,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R14",
    title: "Reach, Fold, Rise, Drink",
    category: "mixed",
    tags: ["overhead_reach","forward_hinge","breathing","hydration_optional"],
    hydrationPrompt: true,
    requiresStableBag: false,
    avoidIfDizzy: true,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s1.wav'), durationMs: 7224, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s2.wav'), durationMs: 8287, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s3.wav'), durationMs: 5470, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s4.wav'), durationMs: 9033, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40514,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R15",
    title: "Breath and Jaw Reset",
    category: "breathing",
    tags: ["breathing","jaw","posture","mental_reset"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r15-s1.wav'), durationMs: 6990, pauseAfterMs: 1500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r15-s2.wav'), durationMs: 5667, pauseAfterMs: 4500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r15-s3.wav'), durationMs: 6817, pauseAfterMs: 4500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r15-s4.wav'), durationMs: 4000, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r15-s5.wav'), durationMs: 7021, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 44995,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R16",
    title: "Shake Out the Arms",
    category: "upper_body",
    tags: ["arm_shake","shoulder_depression","recovery","guard_reset"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s1.wav'), durationMs: 7417, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s2.wav'), durationMs: 6118, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s3.wav'), durationMs: 5540, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s4.wav'), durationMs: 5089, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s5.wav'), durationMs: 6339, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42503,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R17",
    title: "Bag Press for the Shoulder Blades",
    category: "upper_body",
    tags: ["scapular","bag_assisted","upper_back","dynamic_mobility"],
    hydrationPrompt: false,
    requiresStableBag: true,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s1.wav'), durationMs: 6240, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s2.wav'), durationMs: 6368, pauseAfterMs: 4500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s3.wav'), durationMs: 6730, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s4.wav'), durationMs: 4251, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s5.wav'), durationMs: 7768, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 43857,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R18",
    title: "Across and Away",
    category: "upper_body",
    tags: ["shoulder","cross_body","bag_assisted","symmetrical"],
    hydrationPrompt: false,
    requiresStableBag: true,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s1.wav'), durationMs: 7098, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s2.wav'), durationMs: 6344, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s3.wav'), durationMs: 4878, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s4.wav'), durationMs: 3720, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s5.wav'), durationMs: 5594, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 41634,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R19",
    title: "Tall, Turn, and Hinge",
    category: "mixed",
    tags: ["overhead_reach","rotation","forward_hinge","full_body"],
    hydrationPrompt: false,
    requiresStableBag: false,
    avoidIfDizzy: true,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s1.wav'), durationMs: 7403, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s2.wav'), durationMs: 6173, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s3.wav'), durationMs: 5927, pauseAfterMs: 4500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s4.wav'), durationMs: 6478, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s5.wav'), durationMs: 4412, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 41393,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
  {
    scriptId: "R20",
    title: "Cornerman's Full Reset",
    category: "mixed",
    tags: ["breathing","shoulder_rolls","calf","hydration_optional","mental_reset"],
    hydrationPrompt: true,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s1.wav'), durationMs: 7960, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s2.wav'), durationMs: 6509, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s3.wav'), durationMs: 3142, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s4.wav'), durationMs: 5704, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s5.wav'), durationMs: 8652, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 43967,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
]

/* eslint-enable @typescript-eslint/no-require-imports */
