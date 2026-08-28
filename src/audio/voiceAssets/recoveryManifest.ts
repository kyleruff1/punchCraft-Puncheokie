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
    scriptId: "R02",
    title: "Cross-Body Shoulder Reset",
    category: "upper_body",
    tags: ["breathing","shoulder","cross_body","hydration_optional"],
    hydrationPrompt: true,
    requiresStableBag: false,
    avoidIfDizzy: false,
    segments: [
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s1.wav'), durationMs: 8093, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s2.wav'), durationMs: 7453, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s3.wav'), durationMs: 3250, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s4.wav'), durationMs: 9093, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 38889,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s1.wav'), durationMs: 5948, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s2.wav'), durationMs: 8398, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s3.wav'), durationMs: 5454, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s4.wav'), durationMs: 11866, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42666,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s1.wav'), durationMs: 9558, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s2.wav'), durationMs: 5548, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s3.wav'), durationMs: 9037, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s4.wav'), durationMs: 6109, pauseAfterMs: 3000 },
    ],
    measuredTotalMs: 44252,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s1.wav'), durationMs: 7622, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s2.wav'), durationMs: 5163, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s3.wav'), durationMs: 6761, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s4.wav'), durationMs: 4803, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s5.wav'), durationMs: 8944, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 43793,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s1.wav'), durationMs: 6644, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s2.wav'), durationMs: 6860, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s3.wav'), durationMs: 7350, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s4.wav'), durationMs: 3133, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s5.wav'), durationMs: 6609, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42596,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s1.wav'), durationMs: 9017, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s2.wav'), durationMs: 8081, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s3.wav'), durationMs: 6613, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s4.wav'), durationMs: 9347, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 44058,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s1.wav'), durationMs: 5836, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s2.wav'), durationMs: 6369, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s3.wav'), durationMs: 8212, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s4.wav'), durationMs: 4410, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s5.wav'), durationMs: 6374, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42201,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s1.wav'), durationMs: 7999, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s2.wav'), durationMs: 8320, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s3.wav'), durationMs: 8378, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s4.wav'), durationMs: 8793, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 44490,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s1.wav'), durationMs: 8521, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s2.wav'), durationMs: 5894, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s3.wav'), durationMs: 9188, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s4.wav'), durationMs: 7787, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42390,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s1.wav'), durationMs: 6830, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s2.wav'), durationMs: 10093, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s3.wav'), durationMs: 8573, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s4.wav'), durationMs: 8222, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 44718,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s1.wav'), durationMs: 6505, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s2.wav'), durationMs: 7028, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s3.wav'), durationMs: 5815, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s4.wav'), durationMs: 8133, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 37481,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s1.wav'), durationMs: 5035, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s2.wav'), durationMs: 9201, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s3.wav'), durationMs: 5591, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s4.wav'), durationMs: 9893, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40220,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s1.wav'), durationMs: 5465, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s2.wav'), durationMs: 6528, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s3.wav'), durationMs: 9008, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s4.wav'), durationMs: 3543, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s5.wav'), durationMs: 6337, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42881,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
]

/* eslint-enable @typescript-eslint/no-require-imports */
