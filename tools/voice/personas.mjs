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
    version: 'cornerman-3',
    engine: 'chatterbox',
    reference: 'tools/voice/reference/cornerman-reference.wav',
    /**
     * Performance state → Chatterbox intensity. `exaggeration` is how hard the
     * line is performed; `cfgWeight` trades fidelity-to-reference against
     * freedom, and lower reads looser and more urgent.
     */
    intensity: {
      teach: { exaggeration: 0.4, cfgWeight: 0.5 },
      work: { exaggeration: 0.7, cfgWeight: 0.4 },
      push: { exaggeration: 1.0, cfgWeight: 0.3 },
    },
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
