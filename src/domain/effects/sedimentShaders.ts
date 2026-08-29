/**
 * Kinetic Sediment shaders — the three SkSL programs plus their
 * uniform manifests and worklet-safe uniform builders.
 *
 * Living in domain deliberately: pure strings and pure packers, so a
 * Node test can enforce the manifest ↔ SkSL contract (an exact-key or
 * wrong-length uniform THROWS on the UI thread at draw time — the
 * tests turn that class of crash into a Jest failure).
 *
 * Channel layout (RGBA8, signed channels biased at 0.5 — see
 * encodeSigned/decodeSigned in sedimentMath):
 *   motion:  R/G elastic offset (±ELASTIC_RANGE uv), B/A velocity
 *            (±VEL_RANGE uv/s)
 *   memory:  R/G settled offset (±MAX_SETTLED_OFFSET uv),
 *            B settled density (0..1), A mobility (0..1)
 *
 * Yield transfer is computed TWICE with the same closed form — the
 * motion pass drains elastic, the memory pass banks the drained amount
 * into settled. They read the elastic value one half-step apart, so
 * the transfer conserves only approximately; the drift is a fraction
 * of a texel per step and reads as material cohesion, not error.
 */
import {
  GRID_H,
  GRID_W,
  MAX_SETTLED_OFFSET,
  SPLATS_PER_STEP,
  SPLAT_FLOATS,
  type SedimentSplat,
  type TrayState,
  packSplats,
} from './sedimentMath'

export const ELASTIC_RANGE = 0.08
export const VEL_RANGE = 0.5

/** Shared SkSL snippets. */
const SNIPPET_COMMON = `
const float ELASTIC_RANGE = ${ELASTIC_RANGE};
const float VEL_RANGE = ${VEL_RANGE};
const float SETTLED_RANGE = ${MAX_SETTLED_OFFSET};

float2 decode2(half2 c, float range) {
  return (float2(c) - 0.5) * 2.0 * range;
}
half2 encode2(float2 v, float range) {
  float2 clamped = clamp(v / range, float2(-1.0), float2(1.0));
  return half2(0.5 + clamped * 0.5);
}
float shash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}
`

/**
 * MOTION pass. Children: motionPrev, memoryPrev. Advances velocity +
 * elastic offset: wave propagation (4-tap laplacian of the combined
 * offset), spring toward the settled shape, the tray's inertial
 * shove, splat impulses, agitation-scaled damping, yield drain, and
 * per-cell static friction gated by mobility.
 */
export const MOTION_SKSL = `
uniform shader motionPrev;
uniform shader memoryPrev;
uniform float2 uGrid;
uniform float uDt;
uniform float uDamping;
uniform float uChurn;
uniform float2 uTrayForce;
uniform float4 uSplats[${SPLATS_PER_STEP}];
uniform float4 uSplatMeta[${SPLATS_PER_STEP}];
${SNIPPET_COMMON}

float2 offsetAt(float2 xy) {
  half4 m = motionPrev.eval(xy);
  half4 mem = memoryPrev.eval(xy);
  return decode2(m.rg, ELASTIC_RANGE) + decode2(mem.rg, SETTLED_RANGE);
}

half4 main(float2 xy) {
  half4 m = motionPrev.eval(xy);
  half4 mem = memoryPrev.eval(xy);
  float2 elastic = decode2(m.rg, ELASTIC_RANGE);
  float2 vel = decode2(m.ba, VEL_RANGE);
  float mobility = float(mem.a);
  float2 uv = xy / uGrid;

  // Wave propagation: neighbors pull through the combined offset.
  float2 here = elastic + decode2(mem.rg, SETTLED_RANGE);
  float2 lap = (offsetAt(xy + float2(1.0, 0.0)) +
                offsetAt(xy - float2(1.0, 0.0)) +
                offsetAt(xy + float2(0.0, 1.0)) +
                offsetAt(xy - float2(0.0, 1.0))) * 0.25 - here;

  float2 accel = lap * 150.0 - elastic * 22.0 + uTrayForce * (0.4 + 0.6 * mobility);

  float splatPressure = 0.0;
  float2 dent = float2(0.0);
  for (int i = 0; i < ${SPLATS_PER_STEP}; i++) {
    float4 s = uSplats[i];
    float4 meta = uSplatMeta[i];
    float d = distance(uv, s.xy);
    float g = s.z * exp(-(d * d) / (s.w * s.w));
    splatPressure += g;
    float2 away = (d > 0.001) ? (uv - s.xy) / d : float2(0.0);
    // Spiral engagement: the tangential term spins the field around the
    // splat center, and the seeded sign picks clockwise or counter-
    // clockwise per punch — no two engagements swirl alike.
    float spin = (meta.z - 0.5) * 2.0;
    float2 tangent = float2(-away.y, away.x);
    float2 dir = away * 0.55 + float2(meta.x, 0.0) * 0.35 + tangent * spin * 1.5;
    accel += dir * g * 6.5;
    // Instant dent: part of the hit lands as displacement THIS step, so
    // the glass answers on impact while the wave carries the rest out.
    dent += (away * 0.4 + tangent * spin * 0.6) * g * 0.014;
  }

  vel = (vel + accel * uDt) * exp(-uDamping * uDt);
  elastic += vel * uDt + dent;

  // Yield drain: the slow plastic leak the memory pass banks.
  float yieldGate = smoothstep(0.008, 0.02, length(elastic));
  float drain = yieldGate * (0.13 + 0.2 * uChurn) * uDt;
  elastic -= elastic * drain;

  // Static friction: asleep cells hold position exactly.
  float awake = smoothstep(0.02, 0.08, mobility + splatPressure);
  vel *= awake;
  return half4(encode2(elastic, ELASTIC_RANGE), encode2(vel, VEL_RANGE));
}
`

/**
 * MEMORY pass. Children: motionNext, memoryPrev. Banks the yield
 * drain into settled offset, updates mobility (wake vs settle),
 * diffuses density only where churn is high, clamps. Settled channels
 * never fade (uRelax stays 0 outside rest).
 */
export const MEMORY_SKSL = `
uniform shader motionNext;
uniform shader memoryPrev;
uniform float2 uGrid;
uniform float uDt;
uniform float uChurn;
uniform float uRelax;
uniform float4 uSplats[${SPLATS_PER_STEP}];
${SNIPPET_COMMON}

half4 main(float2 xy) {
  half4 m = motionNext.eval(xy);
  half4 mem = memoryPrev.eval(xy);
  float2 elastic = decode2(m.rg, ELASTIC_RANGE);
  float2 vel = decode2(m.ba, VEL_RANGE);
  float2 settled = decode2(mem.rg, SETTLED_RANGE);
  float density = float(mem.b);
  float mobility = float(mem.a);
  float2 uv = xy / uGrid;

  float splatPressure = 0.0;
  for (int i = 0; i < ${SPLATS_PER_STEP}; i++) {
    float4 s = uSplats[i];
    float d = distance(uv, s.xy);
    splatPressure += s.z * exp(-(d * d) / (s.w * s.w));
  }

  // Wake where things move; settle where they do not.
  float kinetic = length(vel) * 2.0 + splatPressure + uChurn * 0.3;
  float wake = smoothstep(0.012, 0.05, kinetic);
  mobility = max(wake, mobility * exp(-uDt / 2.2));

  // Bank the motion pass's yield drain into the permanent shape.
  float yieldGate = smoothstep(0.008, 0.02, length(elastic));
  float drain = yieldGate * (0.13 + 0.2 * uChurn) * uDt;
  settled += elastic * drain;

  // Density redistributes only under churn: awake regions trade a
  // little material with their neighbors; settled regions hold.
  half nb = (memoryPrev.eval(xy + float2(1.0, 0.0)).b +
             memoryPrev.eval(xy - float2(1.0, 0.0)).b +
             memoryPrev.eval(xy + float2(0.0, 1.0)).b +
             memoryPrev.eval(xy - float2(0.0, 1.0)).b) * 0.25;
  density = mix(density, float(nb), mobility * 0.28);
  density = clamp(density + splatPressure * 0.045, 0.06, 0.95);

  // Optional rest-time relaxation of extremes; zero during rounds.
  settled *= (1.0 - uRelax * uDt);
  settled = clamp(settled, float2(-SETTLED_RANGE), float2(SETTLED_RANGE));

  return half4(encode2(settled, SETTLED_RANGE), half(density), half(mobility));
}
`

/**
 * DISPLAY pass (full resolution). Children: backdrop, memoryCur,
 * motionCur. Pure liquid drift: the art refracted through the
 * settled+elastic displacement (plus the tray shiver) — no additive
 * layers at all, so the readability mask gates only displacement and
 * its edge can never read as a color line. uPressureLR/uTimeSec and
 * uTuning.yzw are declared for manifest stability but inert here.
 */
export const DISPLAY_SKSL = `
uniform shader backdrop;
uniform shader memoryCur;
uniform shader motionCur;
uniform float2 uOut;
uniform float2 uGrid;
uniform float uCalm;
uniform float2 uTrayOffset;
uniform float4 uPressureLR;
uniform float uTimeSec;
uniform float4 uMask;
uniform float4 uTuning;
${SNIPPET_COMMON}

float maskAt(float2 uv) {
  // WIDE feathers: a tight mask edge turns the moving field into a
  // visible sliding rectangle against the still KPI zones.
  float rail = mix(1.0, uMask.z, smoothstep(uMask.x - 0.16, uMask.x + 0.06, uv.x));
  float top = mix(uMask.w, 1.0, smoothstep(uMask.y - 0.04, uMask.y + 0.14, uv.y));
  return rail * top;
}

half4 main(float2 xy) {
  float2 uv = xy / uOut;
  float2 g = uv * uGrid;
  half4 mem = memoryCur.eval(g);
  half4 mot = motionCur.eval(g);
  float2 settled = decode2(mem.rg, SETTLED_RANGE);
  float2 elastic = decode2(mot.rg, ELASTIC_RANGE);
  // Tray retired from the display: a uniform whole-pane shift reads as
  // image wobble, not liquid — deformation must stay local to the hit.
  // uTrayOffset remains declared (manifest stability) but unused.
  float2 disp = settled + elastic;
  float fieldMask = maskAt(uv) * uCalm;

  half4 base = backdrop.eval(xy + disp * uOut * uTuning.x * fieldMask);
  return half4(base.rgb, 1.0);
}
`

/**
 * SEED pass: paints the virgin memory texture once per session —
 * neutral settled offsets (0.5 bias) and a seeded uneven density so
 * the pane starts as material, not emptiness.
 */
export const SEED_SKSL = `
uniform float2 uGrid;
uniform float uSeed;
${SNIPPET_COMMON}

half4 main(float2 xy) {
  float2 uv = xy / uGrid;
  float coarse = shash(floor(uv * 9.0) + uSeed);
  float fine = shash(floor(uv * 37.0) + uSeed * 1.7);
  float density = clamp(0.22 + coarse * 0.3 + fine * 0.18, 0.06, 0.95);
  return half4(0.5, 0.5, half(density), 0.0);
}
`

export interface UniformSpec {
  name: string
  floats: number
}

export const SEED_MANIFEST: ReadonlyArray<UniformSpec> = [
  { name: 'uGrid', floats: 2 },
  { name: 'uSeed', floats: 1 },
]

export function buildSeedUniforms(seed: number): Record<string, number | number[]> {
  'worklet'
  return { uGrid: [GRID_W, GRID_H], uSeed: seed }
}

export const MOTION_MANIFEST: ReadonlyArray<UniformSpec> = [
  { name: 'uGrid', floats: 2 },
  { name: 'uDt', floats: 1 },
  { name: 'uDamping', floats: 1 },
  { name: 'uChurn', floats: 1 },
  { name: 'uTrayForce', floats: 2 },
  { name: 'uSplats', floats: SPLAT_FLOATS },
  { name: 'uSplatMeta', floats: SPLAT_FLOATS },
]

export const MEMORY_MANIFEST: ReadonlyArray<UniformSpec> = [
  { name: 'uGrid', floats: 2 },
  { name: 'uDt', floats: 1 },
  { name: 'uChurn', floats: 1 },
  { name: 'uRelax', floats: 1 },
  { name: 'uSplats', floats: SPLAT_FLOATS },
]

export const DISPLAY_MANIFEST: ReadonlyArray<UniformSpec> = [
  { name: 'uOut', floats: 2 },
  { name: 'uGrid', floats: 2 },
  { name: 'uCalm', floats: 1 },
  { name: 'uTrayOffset', floats: 2 },
  { name: 'uPressureLR', floats: 4 },
  { name: 'uTimeSec', floats: 1 },
  { name: 'uMask', floats: 4 },
  { name: 'uTuning', floats: 4 },
]

export interface SedimentTuning {
  /** Backdrop refraction strength (fraction of pane per unit offset). */
  refraction: number
  /** Inert since the pure-drift display (was deposit darkness). */
  densityGain: number
  /** Inert since the pure-drift display (was grain scale). */
  grainScale: number
  /** Reserved. */
  spare: number
}

export const DEFAULT_TUNING: SedimentTuning = {
  refraction: 0.95,
  densityGain: 0.75,
  grainScale: 340,
  spare: 0,
}

export function buildMotionUniforms(
  dtS: number,
  damping: number,
  churn: number,
  trayForceX: number,
  trayForceY: number,
  splats: readonly SedimentSplat[],
): Record<string, number | number[]> {
  'worklet'
  const packed = packSplats(splats)
  return {
    uGrid: [GRID_W, GRID_H],
    uDt: dtS,
    uDamping: damping,
    uChurn: churn,
    uTrayForce: [trayForceX, trayForceY],
    uSplats: packed.positions,
    uSplatMeta: packed.meta,
  }
}

export function buildMemoryUniforms(
  dtS: number,
  churn: number,
  relax: number,
  splats: readonly SedimentSplat[],
): Record<string, number | number[]> {
  'worklet'
  const packed = packSplats(splats)
  return {
    uGrid: [GRID_W, GRID_H],
    uDt: dtS,
    uChurn: churn,
    uRelax: relax,
    uSplats: packed.positions,
  }
}

export function buildDisplayUniforms(
  nowSec: number,
  outW: number,
  outH: number,
  calm: number,
  tray: TrayState,
  pressureLR: { leftV: number; leftStamp: number; rightV: number; rightStamp: number },
  tuning: SedimentTuning,
): Record<string, number | number[]> {
  'worklet'
  return {
    uOut: [Math.max(1, outW), Math.max(1, outH)],
    uGrid: [GRID_W, GRID_H],
    uCalm: calm,
    uTrayOffset: [tray.offsetX, tray.offsetY],
    uPressureLR: [pressureLR.leftV, pressureLR.leftStamp, pressureLR.rightV, pressureLR.rightStamp],
    uTimeSec: nowSec,
    // Full-bleed since the pure-drift display: floors at 1.0 make
    // maskAt a no-op — refraction bends the art BEHIND the KPI text
    // (which is UI above the canvas), so no readability carve-out and
    // no visible zone boundary. Kept as a knob for the lab.
    uMask: [0.78, 0.14, 1.0, 1.0],
    uTuning: [tuning.refraction, tuning.densityGain, tuning.grainScale, tuning.spare],
  }
}

/** Flat float count for a uniform value (numbers count 1). */
export function uniformFloatCount(value: number | number[]): number {
  return Array.isArray(value) ? value.length : 1
}
