/**
 * Expression math for the transition layer (transition-design §2, §4) —
 * pure functions so tests need no timers.
 */

export interface WahEnvelope {
  baseline: number
  peak: number
  attackMs: number
  releaseMs: number
}

/**
 * The supplement's reference formula: acceleration opens the wah,
 * velocity sharpens the attack and adds intensity, punch rate tightens
 * the release so flurries don't smear.
 */
export function wahEnvelope(
  velocity01: number,
  acceleration01: number,
  punchRate01: number,
): WahEnvelope {
  const v = clamp01(velocity01)
  const a = clamp01(acceleration01)
  const r = clamp01(punchRate01)
  return {
    baseline: 18,
    peak: Math.max(0, Math.min(127, Math.round(55 + a * 60 + v * 12))),
    attackMs: Math.round(55 - v * 30),
    releaseMs: Math.round(360 - r * 220 - v * 60),
  }
}

/**
 * CC values for one wah sweep at a fixed step: baseline → peak over the
 * attack, then → baseline over the release. Ends exactly on baseline.
 */
export function wahRampPoints(envelope: WahEnvelope, stepMs: number): number[] {
  const attackSteps = Math.max(1, Math.round(envelope.attackMs / stepMs))
  const releaseSteps = Math.max(1, Math.round(envelope.releaseMs / stepMs))
  const points: number[] = []
  for (let i = 1; i <= attackSteps; i += 1) {
    const t = smooth(i / attackSteps)
    points.push(Math.round(envelope.baseline + (envelope.peak - envelope.baseline) * t))
  }
  for (let i = 1; i <= releaseSteps; i += 1) {
    const t = smooth(i / releaseSteps)
    points.push(Math.round(envelope.peak + (envelope.baseline - envelope.peak) * t))
  }
  points[points.length - 1] = envelope.baseline
  return points
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function smooth(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}
