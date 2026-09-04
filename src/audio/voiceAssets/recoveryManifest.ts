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
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s1.wav'), durationMs: 6460, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s2.wav'), durationMs: 5928, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s3.wav'), durationMs: 5350, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s4.wav'), durationMs: 4880, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r01-s5.wav'), durationMs: 8520, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 43138,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s1.wav'), durationMs: 8431, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s2.wav'), durationMs: 8680, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s3.wav'), durationMs: 3800, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r02-s4.wav'), durationMs: 8438, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40349,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s1.wav'), durationMs: 5828, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s2.wav'), durationMs: 8028, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s3.wav'), durationMs: 8256, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r03-s4.wav'), durationMs: 9240, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42352,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s1.wav'), durationMs: 8551, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s2.wav'), durationMs: 5967, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s3.wav'), durationMs: 7349, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r04-s4.wav'), durationMs: 5282, pauseAfterMs: 3000 },
    ],
    measuredTotalMs: 41149,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s1.wav'), durationMs: 7139, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s2.wav'), durationMs: 6208, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s3.wav'), durationMs: 7533, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s4.wav'), durationMs: 5054, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r05-s5.wav'), durationMs: 5936, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 42370,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s1.wav'), durationMs: 7300, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s2.wav'), durationMs: 6266, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s3.wav'), durationMs: 6320, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s4.wav'), durationMs: 3095, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r06-s5.wav'), durationMs: 6674, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 41655,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s1.wav'), durationMs: 5007, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s2.wav'), durationMs: 6228, pauseAfterMs: 1500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s3.wav'), durationMs: 6595, pauseAfterMs: 1500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s4.wav'), durationMs: 4920, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r07-s5.wav'), durationMs: 7586, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 39336,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s1.wav'), durationMs: 6353, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s2.wav'), durationMs: 6436, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s3.wav'), durationMs: 7466, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r08-s4.wav'), durationMs: 9480, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40735,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s1.wav'), durationMs: 6480, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s2.wav'), durationMs: 6722, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s3.wav'), durationMs: 7333, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s4.wav'), durationMs: 4835, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r09-s5.wav'), durationMs: 5318, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 41688,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s1.wav'), durationMs: 7909, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s2.wav'), durationMs: 5178, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s3.wav'), durationMs: 7344, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r10-s4.wav'), durationMs: 8780, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40211,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s1.wav'), durationMs: 7683, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s2.wav'), durationMs: 6200, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s3.wav'), durationMs: 5960, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r11-s4.wav'), durationMs: 9486, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40329,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s1.wav'), durationMs: 5280, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s2.wav'), durationMs: 9231, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s3.wav'), durationMs: 7403, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r12-s4.wav'), durationMs: 8399, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 41313,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s1.wav'), durationMs: 7497, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s2.wav'), durationMs: 7730, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s3.wav'), durationMs: 6120, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r13-s4.wav'), durationMs: 9080, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40427,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s1.wav'), durationMs: 5760, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s2.wav'), durationMs: 8772, pauseAfterMs: 5000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s3.wav'), durationMs: 5506, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r14-s4.wav'), durationMs: 10080, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40618,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s1.wav'), durationMs: 6936, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s2.wav'), durationMs: 6070, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s3.wav'), durationMs: 6120, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s4.wav'), durationMs: 4506, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r16-s5.wav'), durationMs: 6280, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 41912,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s1.wav'), durationMs: 7195, pauseAfterMs: 1000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s2.wav'), durationMs: 6493, pauseAfterMs: 4500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s3.wav'), durationMs: 7011, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s4.wav'), durationMs: 3527, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r17-s5.wav'), durationMs: 7600, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 44326,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s1.wav'), durationMs: 7341, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s2.wav'), durationMs: 5972, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s3.wav'), durationMs: 4758, pauseAfterMs: 4000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s4.wav'), durationMs: 3760, pauseAfterMs: 3000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r18-s5.wav'), durationMs: 4940, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40771,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s1.wav'), durationMs: 5769, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s2.wav'), durationMs: 6320, pauseAfterMs: 2000 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s3.wav'), durationMs: 6160, pauseAfterMs: 4500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s4.wav'), durationMs: 6551, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r19-s5.wav'), durationMs: 5062, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 40862,
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
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s1.wav'), durationMs: 8600, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s2.wav'), durationMs: 5903, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s3.wav'), durationMs: 4000, pauseAfterMs: 3500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s4.wav'), durationMs: 5640, pauseAfterMs: 2500 },
      { module: require('../../../assets/voice/numbers/standalone/rec-r20-s5.wav'), durationMs: 7480, pauseAfterMs: 0 },
    ],
    measuredTotalMs: 43623,
    corpusVersion: "puncheokie-inter-round-recovery-v1",
  },
]

/* eslint-enable @typescript-eslint/no-require-imports */
