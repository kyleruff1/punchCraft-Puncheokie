/**
 * Whole-phrase combination assets (generated).
 *
 * DO NOT EDIT — produced by `node tools/voice/make-phrase-clips.mjs`.
 *
 * Each entry pairs a clip with the word offsets the synthesizer itself
 * reported, so the live screen can light a circle at the moment its number
 * is spoken rather than inferring it from an amplitude envelope.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export interface PhraseWordMark {
  tokenIndex: number
  token: string
  /** Milliseconds from the start of the clip. */
  offsetMs: number
}

export interface PhraseAsset {
  cueId: string
  combination: string
  cadence: string
  tokens: string[]
  durationMs: number
  wordMarks: PhraseWordMark[]
  /** Metro module id for the clip. */
  module: number
  renderer: string
}

export const phraseAssets: readonly PhraseAsset[] = [
  {
    cueId: "1-2.technical",
    combination: "1-2",
    cadence: "technical",
    tokens: ["1","2"],
    durationMs: 680,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"2","offsetMs":324}],
    module: require('../../../assets/voice/phrases/1-2.technical.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2.standard",
    combination: "1-2",
    cadence: "standard",
    tokens: ["1","2"],
    durationMs: 624,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"2","offsetMs":234}],
    module: require('../../../assets/voice/phrases/1-2.standard.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2.pressure",
    combination: "1-2",
    cadence: "pressure",
    tokens: ["1","2"],
    durationMs: 603,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":32},{"tokenIndex":1,"token":"2","offsetMs":198}],
    module: require('../../../assets/voice/phrases/1-2.pressure.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-1-2.technical",
    combination: "1-1-2",
    cadence: "technical",
    tokens: ["1","1","2"],
    durationMs: 1207,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"1","offsetMs":317},{"tokenIndex":2,"token":"2","offsetMs":1054}],
    module: require('../../../assets/voice/phrases/1-1-2.technical.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-1-2.standard",
    combination: "1-1-2",
    cadence: "standard",
    tokens: ["1","1","2"],
    durationMs: 926,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"1","offsetMs":227},{"tokenIndex":2,"token":"2","offsetMs":654}],
    module: require('../../../assets/voice/phrases/1-1-2.standard.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-1-2.pressure",
    combination: "1-1-2",
    cadence: "pressure",
    tokens: ["1","1","2"],
    durationMs: 810,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":32},{"tokenIndex":1,"token":"1","offsetMs":191},{"tokenIndex":2,"token":"2","offsetMs":487}],
    module: require('../../../assets/voice/phrases/1-1-2.pressure.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-3-2.technical",
    combination: "1-2-3-2",
    cadence: "technical",
    tokens: ["1","2","3","2"],
    durationMs: 1430,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"2","offsetMs":324},{"tokenIndex":2,"token":"3","offsetMs":985},{"tokenIndex":3,"token":"2","offsetMs":1316}],
    module: require('../../../assets/voice/phrases/1-2-3-2.technical.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-3-2.standard",
    combination: "1-2-3-2",
    cadence: "standard",
    tokens: ["1","2","3","2"],
    durationMs: 1094,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"2","offsetMs":234},{"tokenIndex":2,"token":"3","offsetMs":606},{"tokenIndex":3,"token":"2","offsetMs":840}],
    module: require('../../../assets/voice/phrases/1-2-3-2.standard.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-3-2.pressure",
    combination: "1-2-3-2",
    cadence: "pressure",
    tokens: ["1","2","3","2"],
    durationMs: 953,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":32},{"tokenIndex":1,"token":"2","offsetMs":198},{"tokenIndex":2,"token":"3","offsetMs":452},{"tokenIndex":3,"token":"2","offsetMs":638}],
    module: require('../../../assets/voice/phrases/1-2-3-2.pressure.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-roll-3-2.technical",
    combination: "1-2-roll-3-2",
    cadence: "technical",
    tokens: ["1","2","roll","3","2"],
    durationMs: 2022,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"2","offsetMs":324},{"tokenIndex":2,"token":"roll","offsetMs":985},{"tokenIndex":3,"token":"3","offsetMs":1805},{"tokenIndex":4,"token":"2","offsetMs":2143}],
    module: require('../../../assets/voice/phrases/1-2-roll-3-2.technical.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-roll-3-2.standard",
    combination: "1-2-roll-3-2",
    cadence: "standard",
    tokens: ["1","2","roll","3","2"],
    durationMs: 1446,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"2","offsetMs":234},{"tokenIndex":2,"token":"roll","offsetMs":606},{"tokenIndex":3,"token":"3","offsetMs":1102},{"tokenIndex":4,"token":"2","offsetMs":1336}],
    module: require('../../../assets/voice/phrases/1-2-roll-3-2.standard.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-roll-3-2.pressure",
    combination: "1-2-roll-3-2",
    cadence: "pressure",
    tokens: ["1","2","roll","3","2"],
    durationMs: 1200,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":32},{"tokenIndex":1,"token":"2","offsetMs":198},{"tokenIndex":2,"token":"roll","offsetMs":452},{"tokenIndex":3,"token":"3","offsetMs":804},{"tokenIndex":4,"token":"2","offsetMs":990}],
    module: require('../../../assets/voice/phrases/1-2-roll-3-2.pressure.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-1-2-3-2.technical",
    combination: "1-1-2-3-2",
    cadence: "technical",
    tokens: ["1","1","2","3","2"],
    durationMs: 1625,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"1","offsetMs":317},{"tokenIndex":2,"token":"2","offsetMs":579},{"tokenIndex":3,"token":"3","offsetMs":1247},{"tokenIndex":4,"token":"2","offsetMs":1584}],
    module: require('../../../assets/voice/phrases/1-1-2-3-2.technical.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-1-2-3-2.standard",
    combination: "1-1-2-3-2",
    cadence: "standard",
    tokens: ["1","1","2","3","2"],
    durationMs: 1229,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"1","offsetMs":227},{"tokenIndex":2,"token":"2","offsetMs":413},{"tokenIndex":3,"token":"3","offsetMs":792},{"tokenIndex":4,"token":"2","offsetMs":1026}],
    module: require('../../../assets/voice/phrases/1-1-2-3-2.standard.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-1-2-3-2.pressure",
    combination: "1-1-2-3-2",
    cadence: "pressure",
    tokens: ["1","1","2","3","2"],
    durationMs: 1058,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":32},{"tokenIndex":1,"token":"1","offsetMs":191},{"tokenIndex":2,"token":"2","offsetMs":335},{"tokenIndex":3,"token":"3","offsetMs":597},{"tokenIndex":4,"token":"2","offsetMs":783}],
    module: require('../../../assets/voice/phrases/1-1-2-3-2.pressure.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-5-2.technical",
    combination: "1-2-5-2",
    cadence: "technical",
    tokens: ["1","2","5","2"],
    durationMs: 1424,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"2","offsetMs":324},{"tokenIndex":2,"token":"5","offsetMs":985},{"tokenIndex":3,"token":"2","offsetMs":1350}],
    module: require('../../../assets/voice/phrases/1-2-5-2.technical.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-5-2.standard",
    combination: "1-2-5-2",
    cadence: "standard",
    tokens: ["1","2","5","2"],
    durationMs: 1083,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":27},{"tokenIndex":1,"token":"2","offsetMs":234},{"tokenIndex":2,"token":"5","offsetMs":606},{"tokenIndex":3,"token":"2","offsetMs":867}],
    module: require('../../../assets/voice/phrases/1-2-5-2.standard.wav'),
    renderer: "sapi-david-ssml",
  },
  {
    cueId: "1-2-5-2.pressure",
    combination: "1-2-5-2",
    cadence: "pressure",
    tokens: ["1","2","5","2"],
    durationMs: 938,
    wordMarks: [{"tokenIndex":0,"token":"1","offsetMs":32},{"tokenIndex":1,"token":"2","offsetMs":198},{"tokenIndex":2,"token":"5","offsetMs":452},{"tokenIndex":3,"token":"2","offsetMs":660}],
    module: require('../../../assets/voice/phrases/1-2-5-2.pressure.wav'),
    renderer: "sapi-david-ssml",
  },
]

/* eslint-enable @typescript-eslint/no-require-imports */

/** Lookup by combination and cadence. */
export function findPhraseAsset(
  combination: string,
  cadence: string,
): PhraseAsset | undefined {
  return phraseAssets.find((a) => a.combination === combination && a.cadence === cadence)
}
