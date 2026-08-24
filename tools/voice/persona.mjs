/**
 * The settled production persona — Old-School Cornerman.
 *
 * Three axes, each decided by a listening round over workout music, each
 * pinned here so the audition tool and the production generator cannot drift
 * apart. Changing any value here changes every rendered clip, so it belongs
 * to the cache key alongside the renderer (D16).
 *
 * | Axis        | Winner        | Round | What it decides                    |
 * |-------------|---------------|-------|------------------------------------|
 * | Timbre      | aged-melodic  | 1     | which voices are blended, and how  |
 * | Expression  | theatrical    | 2     | how far the pitch contour moves    |
 * | Texture     | broadcast     | 3     | the production chain, post-render  |
 *
 * The rounds are documented in docs/puncheokie-voice-spike.md, with the
 * measurements that settled each one.
 */

/**
 * Timbre — round one.
 *
 * A weighted sum of Kokoro's shipped male voices. `am_santa` is age colour
 * only, never the clarity foundation: it has far less training material than
 * the others, and leaning on it costs intelligibility — the one thing a punch
 * call cannot afford to lose.
 */
export const PRODUCTION_BLEND_NAME = 'aged-melodic'
export const PRODUCTION_BLEND = {
  am_michael: 0.45,
  am_fenrir: 0.25,
  am_puck: 0.2,
  am_santa: 0.1,
}

/** Expression — round two. The deepest of the three contour multipliers. */
export const PRODUCTION_EXPRESSION = 'theatrical'

/**
 * Finish — round four. The corner shouting the power punch.
 *
 * The ending rises into the last strike and stays up rather than settling
 * down. The downward finish was a dead lever under theatrical (already clamped
 * to the pitch floor), so aggression on the ending had to come from the
 * up-kick and the shout, applied to the measured last voiced region.
 */
export const PRODUCTION_FINISH = 'shout'

/**
 * Texture — round three.
 *
 * The corner shouting over a PA: band-limited, mid-forward, very loud. It won
 * on the constraint that overrides taste — cutting through a gym mix without
 * smearing *three*, *five* or *slip*.
 */
export const PRODUCTION_TEXTURE = 'broadcast'

/**
 * The renderer identity, for the manifest and the cache key.
 *
 * Any change to the blend, the expression or the texture must change this, so
 * a stored session can tell which persona produced its audio (D16, spec §3.2
 * versioned decoders).
 */
export const PERSONA_VERSION = 'cornerman-1'
export const RENDERER = `kokoro-${PRODUCTION_BLEND_NAME}-${PRODUCTION_EXPRESSION}-${PRODUCTION_TEXTURE}`
