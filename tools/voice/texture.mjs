/**
 * Texture — the production chain, as distinct from the performance.
 *
 * Prosody settled the *timing* and the pitch movement. This is the other
 * half of what makes a boxing coach sound like a boxing coach: what the voice
 * was recorded through and how hard it was pushed. Two takes with identical
 * words, identical rhythm and identical contour can read as a documentary
 * narrator or as a man leaning over the ropes, and the difference is entirely
 * here.
 *
 * ## The defect this replaces
 *
 * The previous chain carried `rubberband=pitch=1.0:formant=preserved` with a
 * comment claiming it lengthened the vocal tract. It did not: `formant` only
 * has an effect when the pitch actually shifts, so at `pitch=1.0` the filter
 * was a no-op and the aging was pitch and saturation alone.
 *
 * Real formant scaling needs two moves. `asetrate` lowers pitch *and*
 * formants together by resampling; `rubberband` then puts the pitch back with
 * the formants held where they landed. What remains is a longer vocal tract —
 * a bigger, older, chestier voice — with the pitch contour Praat authored left
 * intact.
 *
 * ## The constraint every option is judged against
 *
 * None of this may cost intelligibility. *Three*, *five* and *slip* have to
 * survive a gym mix at the far end of a room, and a texture that sounds
 * characterful in isolation but blurs a sibilant is a worse coach, not a
 * better one.
 */

/** Formant-scale without touching pitch. `scale` below 1 lengthens the tract. */
function formantScale(scale, rate = 24_000) {
  const back = (1 / scale).toFixed(4)
  return [
    `asetrate=${Math.round(rate * scale)}`,
    `aresample=${rate}`,
    `atempo=${back}`,
    `rubberband=pitch=${back}:formant=preserved:pitchq=quality`,
  ]
}

/**
 * Saturation blended *under* the clean signal rather than across it.
 *
 * In series, a soft clipper rounds the transients that make a punch call
 * arrive. In parallel, the harmonics are added while the clean attack stays
 * where it was — which is the difference between a voice with grit and a
 * voice that has been squashed.
 *
 * More grit comes from **driving harder into** the clipper (`preGain`), not
 * from raising `param` — ffmpeg caps `asoftclip:param` at 3, and the honest
 * way to saturate is to push a hotter signal through it anyway. `param` sets
 * the knee; `mix` is how much of the dirt is blended back under the clean.
 */
function parallelSaturation({ preGain = 1, param, mix, focusHz }) {
  return [
    'asplit[clean][drive]',
    `[drive]highpass=f=${focusHz},volume=${preGain},asoftclip=type=atan:param=${param},volume=${mix}[dirt]`,
    '[clean][dirt]amix=inputs=2:normalize=0',
  ].join(';')
}

/**
 * A gym, not a hall.
 *
 * Singles stay drier than combinations: a tail on a 300 ms command only
 * smears the next one.
 */
const room = (single) => (single ? 'aecho=0.9:0.8:13:0.06' : 'aecho=0.9:0.75:17|29:0.12|0.07')

const compressor = ({ threshold, ratio, attack, release, makeup }) =>
  `acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}:makeup=${makeup}`

const shelf = (hz, gain, width = 1.0) =>
  `equalizer=f=${hz}:width_type=o:width=${width}:g=${gain}`

/**
 * The broadcast chain, parametrised so its character variants (rasp, bark) are
 * the *same* chain with a few values moved — not four hand-copied graphs that
 * drift apart. `BROADCAST_BASE` is the settled round-three winner exactly.
 */
const BROADCAST_BASE = {
  threshold: -32,
  ratio: 12,
  makeup: 7,
  presence: 6,
  preGain: 1,
  param: 2.8,
  mix: 0.3,
  focusHz: 500,
  limitRelease: 25,
  baseI: -14,
  echo: true,
}

function broadcastChain({ single, finalAccentDb }, o) {
  return [
    'highpass=f=150',
    'lowpass=f=7200',
    compressor({ threshold: o.threshold, ratio: o.ratio, attack: 1, release: single ? 40 : 55, makeup: o.makeup }),
    shelf(1200, 3),
    shelf(2600, o.presence),
    shelf(5000, -3),
    parallelSaturation({ preGain: o.preGain, param: o.param, mix: o.mix, focusHz: o.focusHz }),
    // The aecho taps compound when a clip's timbre already carries them from
    // its reference (the 2026-09-02 echo diagnosis) — dry variants drop them.
    ...(o.echo === false ? [] : [room(single)]),
    `alimiter=limit=0.95:attack=1:release=${o.limitRelease}`,
    `loudnorm=I=${(o.baseI + finalAccentDb * 0.3).toFixed(1)}:TP=-1.2:LRA=6`,
    'afade=t=in:st=0:d=0.004',
  ]
}

/**
 * The candidates.
 *
 * Deliberately spread rather than clustered: a control, an older and heavier
 * voice, an angrier one, an intimate one, and a public-address one. Auditioning
 * five near-identical chains would tell us nothing that the first one did not.
 */
export const TEXTURES = {
  /** Exactly what shipped in round two, so the comparison has a baseline. */
  current: ({ single, finalAccentDb }) => [
    'highpass=f=120',
    compressor({
      threshold: single ? -26 : -24,
      ratio: single ? 7 : 5,
      attack: single ? 2 : 4,
      release: single ? 60 : 80,
      makeup: single ? 5 : 4,
    }),
    shelf(2400, 4),
    shelf(3800, 3),
    `asoftclip=type=tanh:param=${single ? 0.72 : 0.65}`,
    room(single),
    'alimiter=limit=0.95:attack=2:release=40',
    `loudnorm=I=${(-15 + finalAccentDb * 0.25).toFixed(1)}:TP=-1.2:LRA=8`,
    'afade=t=in:st=0:d=0.006',
  ],

  /** Older and physically bigger: a genuinely longer vocal tract, plus chest. */
  chest: ({ single, finalAccentDb }) => [
    'highpass=f=95',
    ...formantScale(0.93),
    shelf(180, 3.5, 1.3),
    compressor({
      threshold: single ? -26 : -24,
      ratio: single ? 7 : 5,
      attack: single ? 2 : 4,
      release: single ? 60 : 80,
      makeup: single ? 5 : 4,
    }),
    // Less presence than the others: the low end is doing the work, and
    // stacking a bright shelf on top of it only makes the voice sound thin
    // again.
    shelf(2400, 2.5),
    parallelSaturation({ param: 1.8, mix: 0.22, focusHz: 350 }),
    room(single),
    'alimiter=limit=0.95:attack=2:release=40',
    `loudnorm=I=${(-15 + finalAccentDb * 0.25).toFixed(1)}:TP=-1.2:LRA=8`,
    'afade=t=in:st=0:d=0.006',
  ],

  /** Angrier. Harmonics under the clean signal, and a harder compressor. */
  grit: ({ single, finalAccentDb }) => [
    'highpass=f=110',
    ...formantScale(0.96),
    compressor({
      threshold: single ? -30 : -28,
      ratio: single ? 9 : 8,
      attack: 1,
      release: single ? 50 : 70,
      makeup: single ? 6 : 5,
    }),
    parallelSaturation({ param: 2.4, mix: 0.38, focusHz: 300 }),
    shelf(2800, 5),
    shelf(4200, 3),
    room(single),
    'alimiter=limit=0.95:attack=1:release=30',
    `loudnorm=I=${(-14.2 + finalAccentDb * 0.3).toFixed(1)}:TP=-1.2:LRA=7`,
    'afade=t=in:st=0:d=0.005',
  ],

  /** In your ear, not across the gym. No room at all. */
  close: ({ single, finalAccentDb }) => [
    'highpass=f=105',
    ...formantScale(0.95),
    shelf(220, 2.5, 1.2),
    compressor({
      threshold: single ? -32 : -30,
      ratio: single ? 10 : 9,
      attack: 1,
      release: single ? 45 : 60,
      makeup: single ? 7 : 6,
    }),
    shelf(3000, 4.5),
    parallelSaturation({ param: 1.6, mix: 0.18, focusHz: 400 }),
    // Deliberately no `aecho`. The intimacy is the absence of a room, and a
    // short tail is worse than none — it reads as a small box rather than as
    // proximity.
    'alimiter=limit=0.95:attack=1:release=35',
    `loudnorm=I=${(-14.5 + finalAccentDb * 0.3).toFixed(1)}:TP=-1.2:LRA=6`,
    'afade=t=in:st=0:d=0.004',
  ],

  /** The corner shouting over a PA: band-limited, mid-forward, very loud. */
  broadcast: ({ single, finalAccentDb }) => broadcastChain({ single, finalAccentDb }, BROADCAST_BASE),

  /**
   * The same PA, without the small box: broadcast with the aecho taps
   * removed. For clips cloned from a clean pre-texture reference, the
   * room the athlete hears should come from ONE pass — and Kyle's ruling
   * (2026-09-02) is that the broadcast character stays, the echo goes.
   */
  'broadcast-dry': ({ single, finalAccentDb }) =>
    broadcastChain({ single, finalAccentDb }, { ...BROADCAST_BASE, echo: false }),

  /**
   * Dry and slightly unclenched: with the compounded generations gone the
   * 12:1 wall may be over-gluing a clean take, so this backs the
   * compressor off to 8:1 @ -28 with matching makeup. Bake-off candidate.
   */
  'broadcast-dry-gentle': ({ single, finalAccentDb }) =>
    broadcastChain(
      { single, finalAccentDb },
      { ...BROADCAST_BASE, echo: false, threshold: -28, ratio: 8, makeup: 6 },
    ),

  /**
   * Weathered rasp — a voice that has shouted across gyms for thirty years.
   *
   * More parallel saturation, driven lower into the body of the voice so the
   * grit sits *in* the tone rather than as fizz on top. Compression is left at
   * baseline: rasp is harmonic content, not level.
   */
  rasp: ({ single, finalAccentDb }) =>
    broadcastChain({ single, finalAccentDb }, { ...BROADCAST_BASE, preGain: 2.0, param: 3, mix: 0.55, focusHz: 430 }),

  /**
   * More bark — harder, brighter, hotter, getting on you.
   *
   * Faster and deeper compression flattens the dynamics into a wall, a bigger
   * presence lift adds the edge, and a hotter target pushes it forward.
   * Saturation stays at baseline so the bark reads as projection, not fuzz.
   */
  bark: ({ single, finalAccentDb }) =>
    broadcastChain(
      { single, finalAccentDb },
      { ...BROADCAST_BASE, threshold: -34, ratio: 16, makeup: 8, presence: 9, limitRelease: 20, baseI: -13 },
    ),

  /** Both at once: the old dog who has never once called it quietly. */
  raspbark: ({ single, finalAccentDb }) =>
    broadcastChain(
      { single, finalAccentDb },
      {
        ...BROADCAST_BASE,
        threshold: -34,
        ratio: 16,
        makeup: 8,
        presence: 8.5,
        preGain: 1.7,
        param: 3,
        mix: 0.48,
        focusHz: 450,
        limitRelease: 20,
        baseI: -13,
      },
    ),
}

/** The filtergraph for one clip, as a single `-af` argument. */
export function textureChain(name, { profile, finalAccentDb }) {
  const build = TEXTURES[name]
  if (!build) throw new Error(`unknown texture ${name}`)
  return build({ single: profile === 'single', finalAccentDb }).join(',')
}
