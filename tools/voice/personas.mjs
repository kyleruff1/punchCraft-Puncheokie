/**
 * Persona registry — every voice the coach can be rendered in.
 *
 * A persona is the whole recipe for a voice: which synthesizer produces it,
 * what it is cloned from or blended out of, and how it is shaped afterwards
 * (expression, finish, texture). Keeping them in one table rather than as
 * loose constants is what makes a second voice a data change instead of a
 * refactor — add an entry, render it, ship it.
 *
 * Personas are rendered into their own asset directory and tagged in the
 * manifest, so more than one can exist side by side. Shipping more than one is
 * a bundle-size decision, not a pipeline one: each full corpus is ~45MB.
 *
 * ## Adding a persona
 *
 * 1. Add an entry here with a unique `id` and a fresh `version`.
 * 2. For a cloned persona, put the reference clip under
 *    `tools/voice/reference/` and record its licensing in PROVENANCE.md —
 *    the reference *is* the licensing of every clip it produces.
 * 3. `node tools/voice/make-phrase-clips.mjs --persona=<id>`.
 *
 * Never edit a shipped persona in place. `version` is the cache key a stored
 * session uses to know which voice produced its audio (D16, spec §3.2), so a
 * changed voice needs a changed version and a full re-render.
 */

/** The persona rendered when none is named. */
export const ACTIVE_PERSONA = 'cornerman'

export const PERSONAS = {
  /**
   * The shipped voice: a boisterous, theatrical cornerman — a showman who
   * bellows at a crowd rather than a narrator who reads.
   *
   * Cloned rather than blended. The character lives entirely in the reference
   * clip, so the persona's identity is a file on disk with a recorded
   * provenance chain, not a set of tuning constants.
   */
  cornerman: {
    id: 'cornerman',
    label: 'Old-School Cornerman',
    version: 'cornerman-5',
    engine: 'chatterbox',
    reference: 'tools/voice/reference/cornerman-reference.wav',
    /**
     * Performance state → Chatterbox intensity. `exaggeration` is how hard the
     * line is performed; `cfgWeight` trades fidelity-to-reference against
     * freedom, and lower reads looser and more urgent.
     *
     * **Every state is push.** The calmer settings were auditioned and read as
     * tame — a workout coach is not a narrator, and there is no moment in a
     * round where the athlete wants the corner to ease off. The three states
     * survive as a selection axis (`performanceFor` still chooses one) so a
     * future persona can differentiate them by re-rendering rather than by
     * re-architecting, but they currently all resolve to the same delivery.
     */
    intensity: {
      teach: { exaggeration: 1.0, cfgWeight: 0.3 },
      work: { exaggeration: 1.0, cfgWeight: 0.3 },
      push: { exaggeration: 1.0, cfgWeight: 0.3 },
    },
    /**
     * The single performance rendered, since all three intensities are equal
     * and the finish is shared. Cuts the corpus to a third — 248 clips rather
     * than 744, and ~15MB of shipped audio rather than ~46MB.
     */
    performances: ['push'],
    /**
     * Chatterbox has no speed control and runs roughly twice as long as Kokoro
     * for the same call, which a cue window will not tolerate. The plan's
     * `speed` is applied afterwards as a formant-preserving stretch, scaled by
     * this. Measured, not guessed — raise it and the calls get clipped short.
     */
    tempoCalibration: 1.35,
    expression: 'theatrical',
    finish: 'shout',
    texture: 'broadcast',
  },

  /**
   * The self-cloned cornerman (Kyle, 2026-09-01): same recipe as
   * `cornerman`, but the reference is 31.7s of OUR OWN shipped renders —
   * six intro clips (intro-hello, intro-rounds-4, the three -steady
   * program descriptions, intro-letsgo) concatenated. Cloning from the
   * shipped output bakes the production sound into the reference, so new
   * batches match what the athlete already hears on the tablet rather
   * than the raw source extract. Provenance chain unchanged — the
   * reference derives from cornerman-reference.wav renders (PROVENANCE.md).
   */
  cornerman2: {
    id: 'cornerman2',
    label: 'Cornerman (self-clone)',
    version: 'cornerman2-1',
    engine: 'chatterbox',
    reference: 'tools/voice/reference/cornerman-selfref-30s.wav',
    intensity: {
      teach: { exaggeration: 1.0, cfgWeight: 0.3 },
      work: { exaggeration: 1.0, cfgWeight: 0.3 },
      push: { exaggeration: 1.0, cfgWeight: 0.3 },
    },
    performances: ['push'],
    tempoCalibration: 1.35,
    expression: 'theatrical',
    finish: 'shout',
    texture: 'broadcast',
  },

  /**
   * The clean-generation cornerman (Kyle's B2 pick, 2026-09-02): same
   * character, ONE texture pass. cornerman2's clips were three broadcast
   * passes deep (reference built from textured output, then textured
   * again at render) and the compounding `aecho` taps read as "echoey
   * and lo-fi". This reference is the six intro lines re-rendered fresh
   * from the raw v4 recording with NO texture, so the broadcast chain —
   * echo-free, compressor eased — is applied exactly once, at render.
   * Doctrine: a reference must always be PRE-texture material.
   */
  cornerman3: {
    id: 'cornerman3',
    label: 'Cornerman (clean self-clone)',
    // v2 (Kyle, 2026-09-03): the band-limit opened 7.2k -> 10.5k for
    // top-end "air" and output raised to 48kHz — his C pick from the
    // quality bake-off ("make it sound nice and high bit rate"). Same
    // dry-gentle character underneath, one texture pass.
    // v3 (Kyle, 2026-09-04): the WALKOUT gets its growl back — a separate
    // punchy intro texture (broadcast-bright-punch) + the wired shout
    // ending; the per-bar calls keep dry-gentle-bright.
    version: 'cornerman3-3',
    engine: 'chatterbox',
    reference: 'tools/voice/reference/cornerman3-selfref-30s.wav',
    intensity: {
      teach: { exaggeration: 1.0, cfgWeight: 0.3 },
      work: { exaggeration: 1.0, cfgWeight: 0.3 },
      push: { exaggeration: 1.0, cfgWeight: 0.3 },
    },
    performances: ['push'],
    tempoCalibration: 1.35,
    expression: 'theatrical',
    finish: 'shout',
    texture: 'broadcast-dry-gentle-bright',
    /** The walkout/intro texture — full broadcast punch at the bright ceiling (Kyle's attitude ask). */
    introTexture: 'broadcast-bright-punch',
    /** Output sample rate; the model synthesizes at 24k but 48k is the shipped container (Kyle's hi-fi ask). */
    sampleRate: 48000,
  },

  /**
   * The original Kokoro voice, kept as a fallback rather than deleted.
   *
   * Needs no GPU and no separate venv, so it is the persona a machine that
   * cannot run the Chatterbox toolchain can still render. Its ceiling is the
   * 82M-parameter model's prosody — the delivery reads flat however the
   * texture chain is tuned, which is what moved production off it.
   */
  stone: {
    id: 'stone',
    label: 'Stone (Kokoro fallback)',
    version: 'cornerman-2',
    engine: 'kokoro',
    blendName: 'stone',
    blend: { am_onyx: 0.42, am_michael: 0.33, am_fenrir: 0.25 },
    expression: 'theatrical',
    finish: 'shout',
    texture: 'broadcast',
  },
}

/** Look a persona up by id, failing loudly on an unknown one. */
export function getPersona(id = ACTIVE_PERSONA) {
  const persona = PERSONAS[id]
  if (!persona) {
    throw new Error(`unknown persona '${id}'. Known: ${Object.keys(PERSONAS).join(', ')}`)
  }
  return persona
}

/**
 * The renderer identity written into every manifest entry.
 *
 * Carries the engine and the shaping, so a clip can always be traced back to
 * the exact pipeline that made it.
 */
export function rendererId(persona) {
  const source = persona.engine === 'chatterbox' ? persona.id : persona.blendName
  return `${persona.engine}-${source}-${persona.expression}-${persona.texture}`
}

/** Where a persona's clips live, relative to the repo root. */
export function assetDirFor(persona) {
  return `assets/voice/phrases/${persona.id}`
}
