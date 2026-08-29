/**
 * The membrane's single SkSL program, its uniform manifest and the
 * worklet-safe uniform builder.
 *
 * Living in domain deliberately: pure strings and pure packers, so a
 * Node test can enforce the manifest ↔ SkSL contract (an exact-key or
 * wrong-length uniform THROWS on the UI thread at draw time — the
 * tests turn that class of crash into a Jest failure).
 *
 * One pass, no state: the shader evaluates the impulse ring
 * analytically per pixel. Every wave term hard-zeros outside its
 * lifetime and the gel arrives pre-computed (closed form in
 * membraneMath), so displacement — and therefore the composition —
 * returns exactly to baseline when the ring runs dry.
 */
import {
  GEL_WINDOW_S,
  IMPULSE_FLOATS,
  MAX_IMPULSES,
  WAVE_DAMP,
  WAVE_OMEGA,
  gelResponse,
  packImpulses,
  visualCoverage,
  type MembraneImpulse,
} from './membraneMath'

export const MEMBRANE_SKSL = `
uniform shader backdrop;
uniform shader grain;
uniform float2 uOut;
uniform float uNow;
uniform float uCalm;
uniform float4 uGel;
uniform float4 uMask;
uniform float4 uTuning;
uniform float4 uVeil;
uniform float4 uA[${MAX_IMPULSES}];
uniform float4 uB[${MAX_IMPULSES}];
uniform float4 uC[${MAX_IMPULSES}];

const float WAVE_OMEGA = ${WAVE_OMEGA};
const float WAVE_DAMP = ${WAVE_DAMP};
const float GRAIN_TEX = 1024.0;

float maskAt(float2 uv) {
  float rail = mix(1.0, uMask.z, smoothstep(uMask.x - 0.16, uMask.x + 0.06, uv.x));
  float top = mix(uMask.w, 1.0, smoothstep(uMask.y - 0.04, uMask.y + 0.14, uv.y));
  return rail * top;
}

float shash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

// Smooth 2-octave value noise for the broad veil's foggy pockets.
float vnoise(float2 p) {
  float2 cell = floor(p);
  float2 f = p - cell;
  float2 s = f * f * (3.0 - 2.0 * f);
  float a = shash(cell);
  float b = shash(cell + float2(1.0, 0.0));
  float c = shash(cell + float2(0.0, 1.0));
  float d = shash(cell + float2(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

half4 main(float2 xy) {
  float2 uv = xy / uOut;
  float aspect = uOut.x / uOut.y;
  // Stage space keeps waves circular on a wide pane.
  float2 stage = uv * float2(aspect, 1.0);

  float2 disp = float2(0.0);
  float compress = 0.0;
  // Strict-ES2 loop: no continue/break — dead slots and not-yet-arrived
  // waves are zeroed by the gate instead.
  float localDeposit = 0.0;
  for (int i = 0; i < ${MAX_IMPULSES}; i++) {
    float amp = uA[i].w;
    float life = uB[i].y;
    float2 origin = uA[i].xy * float2(aspect, 1.0);
    float d = distance(stage, origin);
    // Arrival delay: the wavefront takes real time to reach a point —
    // this is what keeps the response from reading as screen-shake.
    float age = uNow - uA[i].z - d / uB[i].z;
    float gate = step(1e-6, amp) * step(0.0, age) * (1.0 - step(life, age));

    float r = uB[i].x;
    float envelope = exp(-(d * d) / (2.0 * r * r));
    float osc = sin(age * WAVE_OMEGA + uC[i].y);
    float decay = exp(-abs(age) * WAVE_DAMP);
    // Soft tail so the hard zero at expiry never pops.
    float tail = 1.0 - smoothstep(0.75 * life, life, age);

    float2 away = (d > 1e-4) ? (stage - origin) / d : float2(0.0);
    float2 tangent = float2(-away.y, away.x);
    // Radial push + per-hand lateral bias + the seeded spiral: every
    // engagement turns a different way.
    float2 dir = away * 0.55 + float2(uC[i].x, 0.0) * 0.35 + tangent * uB[i].w * 0.9;
    float wave = amp * envelope * osc * decay * tail * gate;
    disp += dir * wave;
    // Analytic radial gradient of the gaussian: negative divergence
    // reads as material gathered under the front, without extra taps.
    compress += wave * (d / (r * r)) * 0.55;

    // Local pummel bloom: dark grain floods AT the glove immediately
    // (no arrival delay), then disperses in ~1.4 s — cause before the
    // global veil catches up.
    float depositAge = uNow - uA[i].z;
    float depositGate = step(1e-6, amp) * step(0.0, depositAge);
    localDeposit +=
      exp(-(d * d) / (r * r)) * (amp * 31.0) * exp(-depositAge / 1.4) * depositGate;
  }

  // Whole-sheet gel: offset plus a small twist about center.
  float2 centered = uv - 0.5;
  float2 twisted = float2(
    centered.x - uGel.z * centered.y,
    centered.y + uGel.z * centered.x * 0.6
  );
  float2 gelDisp = float2(uGel.x, uGel.y) * uTuning.w + (twisted - centered);

  float fieldMask = maskAt(uv) * uCalm;
  // Back to uv space (stage x is aspect-scaled).
  float2 dispUv = (disp * float2(1.0 / aspect, 1.0) + gelDisp) * fieldMask;
  // Impact energy snaps the refraction on the hit itself.
  float refract = uTuning.x * (0.85 + 0.5 * uGel.w + 0.4 * uVeil.w);

  // Parallax: the art bends at 0.7x the field; the particulate scales
  // ride it harder (2.0 / 1.35 / 0.65x) so the grain reads as material
  // suspended ABOVE the image, not printed onto it.
  half4 base = backdrop.eval(xy + dispUv * uOut * refract * 0.7);

  // The Pummel Veil: one immutable texture read at two scales plus a
  // procedural fog. Coverage REVEALS grain by threshold — the texture
  // holds every potential particle; charge decides how many show.
  float fineGrain = 1.0 - grain.eval((uv * 7.0 + dispUv * 2.0) * GRAIN_TEX).r;
  float mediumGrain = 1.0 - grain.eval((uv * 3.0 + dispUv * 1.35) * GRAIN_TEX).r;
  float2 broadCoords = uv * float2(1.2 * aspect, 1.2) + dispUv * 0.65 +
                       float2(uGel.w * uNow * 0.02, 0.0);
  float broadCloud = vnoise(broadCoords * 4.0) * 0.65 + vnoise(broadCoords * 9.0) * 0.35;

  // Per-scale thresholded reveal, each on its own decay clock (dust
  // clears first, debris next, the broad veil last).
  float fineMask = smoothstep(0.95 - uVeil.x, 1.01 - uVeil.x, fineGrain);
  float debrisMask = smoothstep(0.95 - uVeil.y, 1.01 - uVeil.y, mediumGrain);
  float veilMask = smoothstep(0.95 - uVeil.z, 1.01 - uVeil.z, broadCloud);
  float particleOcclusion = fineMask * 0.45 + debrisMask * 0.35 + veilMask * 0.2;

  float effectiveCoverage = clamp(
    particleOcclusion * 0.82 + localDeposit * 0.26 +
      max(0.0, compress * uTuning.z) * 0.1,
    0.0,
    1.0
  );
  // Continuous closure near the top so full black has no pinholes —
  // keyed on the veil charge, which only a sustained flurry can feed.
  float closure = smoothstep(0.88, 1.0, uVeil.z + particleOcclusion * 0.35);
  float finalOcclusion = mix(effectiveCoverage, 1.0, closure) * uTuning.y;

  half3 color = mix(half3(base.rgb), half3(0.0), half(clamp(finalOcclusion * fieldMask, 0.0, 1.0)));
  return half4(color, 1.0);
}
`

export interface UniformSpec {
  name: string
  floats: number
}

export const MEMBRANE_MANIFEST: ReadonlyArray<UniformSpec> = [
  { name: 'uOut', floats: 2 },
  { name: 'uNow', floats: 1 },
  { name: 'uCalm', floats: 1 },
  { name: 'uGel', floats: 4 },
  { name: 'uMask', floats: 4 },
  { name: 'uTuning', floats: 4 },
  { name: 'uVeil', floats: 4 },
  { name: 'uA', floats: IMPULSE_FLOATS },
  { name: 'uB', floats: IMPULSE_FLOATS },
  { name: 'uC', floats: IMPULSE_FLOATS },
]

export interface MembraneTuning {
  /** Backdrop refraction strength (fraction of pane per unit offset). */
  refraction: number
  /** Veil occlusion master gain (0 = pure drift, no particulate). */
  grainOpacity: number
  /** Compression darkening gain. */
  compressionGain: number
  /** Whole-sheet gel gain (preset knob). */
  gelGain: number
}

export const DEFAULT_TUNING: MembraneTuning = {
  // Measured on-glass: 0.9 x the 0.7 parallax left single-punch warps
  // near-invisible on the dark art — 1.7 doubles the visible bend.
  refraction: 1.7,
  grainOpacity: 1,
  compressionGain: 1,
  gelGain: 1,
}

/** Decayed reaction charges the display needs (raw, pre-perceptual). */
export interface VeilState {
  dust: number
  debris: number
  veil: number
  impact: number
}

/**
 * Build the full uniforms object. Key order MUST match the manifest —
 * the engine flattens `Object.values` in insertion order.
 */
export function buildMembraneUniforms(
  nowSec: number,
  outW: number,
  outH: number,
  calm: number,
  churn: number,
  veil: VeilState,
  ring: readonly MembraneImpulse[],
  tuning: MembraneTuning,
): Record<string, number | number[]> {
  'worklet'
  const gel = gelResponse(ring, nowSec)
  const packed = packImpulses(ring)
  return {
    uOut: [Math.max(1, outW), Math.max(1, outH)],
    uNow: nowSec,
    uCalm: calm,
    uGel: [gel.offsetX, gel.offsetY, gel.twist, churn],
    // Full-bleed floors: refraction bends the art BEHIND the KPI text
    // (UI above the canvas), so no readability carve-out. Kept as a
    // knob for the lab.
    uMask: [0.78, 0.14, 1.0, 1.0],
    uTuning: [tuning.refraction, tuning.grainOpacity, tuning.compressionGain, tuning.gelGain],
    // Perceptual coverage per scale, so recovery reads staged rather
    // than tracking the raw exponentials.
    uVeil: [
      Math.min(1, visualCoverage(veil.dust)),
      Math.min(1, visualCoverage(veil.debris)),
      Math.min(1, visualCoverage(veil.veil)),
      Math.max(0, Math.min(1, veil.impact)),
    ],
    uA: packed.a,
    uB: packed.b,
    uC: packed.c,
  }
}

/** Flat float count for a uniform value (numbers count 1). */
export function uniformFloatCount(value: number | number[]): number {
  return Array.isArray(value) ? value.length : 1
}

/** Gel window re-export so the engine's sleep gate shares the truth. */
export { GEL_WINDOW_S }
