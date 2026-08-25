/**
 * The active production persona, projected onto the flat constants the voice
 * tools consume.
 *
 * Personas themselves now live in `personas.mjs` as a registry, so a second
 * voice is a data change rather than a refactor. This module selects the
 * active one and re-exports its fields under the names the generators and the
 * audition tool already use — which is what lets those tools stay unaware that
 * a persona is now a record rather than a set of loose constants.
 *
 * ## History
 *
 * The persona was settled over six listening rounds against workout music:
 *
 * | Axis        | Winner        | Round | What it decides                    |
 * |-------------|---------------|-------|------------------------------------|
 * | Timbre      | stone         | 1, 6  | which voices are blended, and how  |
 * | Expression  | theatrical    | 2     | how far the pitch contour moves    |
 * | Texture     | broadcast     | 3     | the production chain, post-render  |
 * | Finish      | shout         | 4     | the ending inflection              |
 *
 * Those rounds tuned Kokoro, whose 82M-parameter prosody turned out to be the
 * real ceiling on how expressive the coach could sound — round five had
 * already found the post-production chain to be a weak lever for character.
 * Production therefore moved to a cloned voice (`cornerman`), where the
 * character comes from the reference clip and intensity is a synthesis
 * parameter rather than a pitch-contour trick. The expression, finish and
 * texture choices carried over; the blend did not.
 *
 * The rounds are documented in docs/puncheokie-voice-spike.md, with the
 * measurements that settled each one.
 */

import { ACTIVE_PERSONA, PERSONAS, getPersona, rendererId } from './personas.mjs'

/** The persona every tool in this directory renders unless told otherwise. */
export const PERSONA = getPersona(ACTIVE_PERSONA)

export { ACTIVE_PERSONA, PERSONAS, getPersona, rendererId }

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/** `chatterbox` (cloned, GPU) or `kokoro` (blended, CPU). See personas.mjs. */
export const ENGINE = PERSONA.engine

/**
 * The voice being cloned, for a `chatterbox` persona. Licensing and the exact
 * extract are recorded in `tools/voice/reference/PROVENANCE.md` — read it
 * before changing this, since the reference is the licensing of every clip.
 */
export const REFERENCE_VOICE = PERSONA.reference

/** Performance state → Chatterbox intensity, for a `chatterbox` persona. */
export const EXAGGERATION = PERSONA.intensity ?? {}

/** Kokoro-era speed → formant-preserving stretch, for a `chatterbox` persona. */
export const CHATTERBOX_TEMPO_CALIBRATION = PERSONA.tempoCalibration ?? 1

// ---------------------------------------------------------------------------
// Shaping — applied after synthesis, whichever engine produced the audio
// ---------------------------------------------------------------------------

/** Expression — how far the pitch contour moves. */
export const PRODUCTION_EXPRESSION = PERSONA.expression

/**
 * Finish — the ending inflection.
 *
 * The ending rises into the last strike and stays up rather than settling
 * down. The downward finish was a dead lever under theatrical (already clamped
 * to the pitch floor), so aggression on the ending had to come from the
 * up-kick and the shout, applied to the measured last voiced region.
 */
export const PRODUCTION_FINISH = PERSONA.finish

/**
 * Texture — the post-render production chain.
 *
 * The corner shouting over a PA: band-limited, mid-forward, very loud. It won
 * on the constraint that overrides taste — cutting through a gym mix without
 * smearing *three*, *five* or *slip*.
 */
export const PRODUCTION_TEXTURE = PERSONA.texture

// ---------------------------------------------------------------------------
// Kokoro blend — only meaningful for a `kokoro` persona
// ---------------------------------------------------------------------------

/**
 * A weighted sum of Kokoro's shipped male voices. `am_santa` is age colour
 * only, never the clarity foundation: it has far less training material than
 * the others, and leaning on it costs intelligibility — the one thing a punch
 * call cannot afford to lose.
 *
 * Falls back to the `stone` persona's blend so the Kokoro-only tools keep
 * working while the active persona is a cloned one.
 */
export const PRODUCTION_BLEND_NAME = PERSONA.blendName ?? PERSONAS.stone.blendName
export const PRODUCTION_BLEND = PERSONA.blend ?? PERSONAS.stone.blend

/**
 * The renderer identity, for the manifest and the cache key.
 *
 * Any change to the engine, the reference, the expression or the texture must
 * change this, so a stored session can tell which persona produced its audio
 * (D16, spec §3.2 versioned decoders).
 */
export const PERSONA_VERSION = PERSONA.version
export const RENDERER = rendererId(PERSONA)
