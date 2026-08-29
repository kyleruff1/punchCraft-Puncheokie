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
uniform float uDark;
uniform float4 uA[${MAX_IMPULSES}];
uniform float4 uB[${MAX_IMPULSES}];
uniform float4 uC[${MAX_IMPULSES}];

const float WAVE_OMEGA = ${WAVE_OMEGA};
const float WAVE_DAMP = ${WAVE_DAMP};

float maskAt(float2 uv) {
  float rail = mix(1.0, uMask.z, smoothstep(uMask.x - 0.16, uMask.x + 0.06, uv.x));
  float top = mix(uMask.w, 1.0, smoothstep(uMask.y - 0.04, uMask.y + 0.14, uv.y));
  return rail * top;
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
  float refract = uTuning.x * (0.85 + 0.5 * uGel.w);

  half4 base = backdrop.eval(xy + dispUv * uOut * refract);

  // Particulate sheet: the immutable grain sampled through the SAME
  // displacement (slightly amplified so it visibly leads the art),
  // darkening only — compression banks the specks into denser bands.
  // The blackout envelope lets the dark particulates saturate and
  // smother the whole pane: specks flood first, then the field between
  // them — total black only under a sustained dead-sprint.
  half g = grain.eval((uv + dispUv * 1.6) * uOut).r;
  float density = 1.0 + clamp(compress * uTuning.z, -0.6, 1.5) * (0.5 + 0.5 * uGel.w);
  float smother = pow(clamp(uDark, 0.0, 1.0), 1.3);
  float darken = (uTuning.y + smother * 2.2) * (1.0 - float(g)) * density + smother * 0.8;
  half3 color = half3(base.rgb) * half(1.0 - clamp(darken * fieldMask, 0.0, 1.0));
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
  { name: 'uDark', floats: 1 },
  { name: 'uA', floats: IMPULSE_FLOATS },
  { name: 'uB', floats: IMPULSE_FLOATS },
  { name: 'uC', floats: IMPULSE_FLOATS },
]

export interface MembraneTuning {
  /** Backdrop refraction strength (fraction of pane per unit offset). */
  refraction: number
  /** Grain darkening opacity (0 = pure drift). */
  grainOpacity: number
  /** Compression banding gain for the grain. */
  compressionGain: number
  /** Whole-sheet gel gain (preset knob). */
  gelGain: number
}

export const DEFAULT_TUNING: MembraneTuning = {
  refraction: 0.9,
  grainOpacity: 0.18,
  compressionGain: 1,
  gelGain: 1,
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
  darkness: number,
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
    uDark: Math.max(0, Math.min(1, darkness)),
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
