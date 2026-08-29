/**
 * The manifest contract: a wrong uniform key or float count THROWS on
 * the UI thread at draw time on device. These tests turn that whole
 * class of crash into a Node-time failure by parsing the SkSL uniform
 * declarations and diffing them against the manifests and the
 * builders' actual output.
 */
import {
  DEFAULT_TUNING,
  DISPLAY_MANIFEST,
  DISPLAY_SKSL,
  MEMORY_MANIFEST,
  MEMORY_SKSL,
  MOTION_MANIFEST,
  MOTION_SKSL,
  SEED_MANIFEST,
  SEED_SKSL,
  buildDisplayUniforms,
  buildMemoryUniforms,
  buildMotionUniforms,
  buildSeedUniforms,
  uniformFloatCount,
  type UniformSpec,
} from '../effects/sedimentShaders'
import { HAND_LEFT, HAND_RIGHT, restingTray, splatFromPunch } from '../effects/sedimentMath'

const TYPE_FLOATS: Record<string, number> = { float: 1, float2: 2, float3: 3, float4: 4 }

/** Parse `uniform <type> <name>[count]?;` declarations (skips children). */
function parseUniforms(sksl: string): UniformSpec[] {
  const out: UniformSpec[] = []
  const re = /uniform\s+(shader|float[234]?)\s+(\w+)(?:\[(\d+)\])?\s*;/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sksl)) !== null) {
    const [, type, name, count] = m
    if (type === 'shader') continue
    const base = TYPE_FLOATS[type ?? ''] ?? 0
    out.push({ name: name ?? '', floats: base * (count ? Number(count) : 1) })
  }
  return out
}

function childShaders(sksl: string): string[] {
  const out: string[] = []
  const re = /uniform\s+shader\s+(\w+)\s*;/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sksl)) !== null) out.push(m[1] ?? '')
  return out
}

const splats = [splatFromPunch(HAND_LEFT, 0.6, 1), splatFromPunch(HAND_RIGHT, 1, 2)]

const built = {
  motion: buildMotionUniforms(1 / 30, 4, 0.5, 0.01, 0, splats),
  memory: buildMemoryUniforms(1 / 30, 0.5, 0, splats),
  display: buildDisplayUniforms(
    12.5,
    1600,
    900,
    1,
    restingTray(),
    { leftV: 0.4, leftStamp: 12, rightV: 0.2, rightStamp: 11 },
    DEFAULT_TUNING,
  ),
}

const cases: Array<{
  label: string
  sksl: string
  manifest: ReadonlyArray<UniformSpec>
  uniforms: Record<string, number | number[]>
  children: string[]
}> = [
  {
    label: 'motion',
    sksl: MOTION_SKSL,
    manifest: MOTION_MANIFEST,
    uniforms: built.motion,
    children: ['motionPrev', 'memoryPrev'],
  },
  {
    label: 'memory',
    sksl: MEMORY_SKSL,
    manifest: MEMORY_MANIFEST,
    uniforms: built.memory,
    children: ['motionNext', 'memoryPrev'],
  },
  {
    label: 'display',
    sksl: DISPLAY_SKSL,
    manifest: DISPLAY_MANIFEST,
    uniforms: built.display,
    children: ['backdrop', 'memoryCur', 'motionCur'],
  },
  {
    label: 'seed',
    sksl: SEED_SKSL,
    manifest: SEED_MANIFEST,
    uniforms: buildSeedUniforms(7),
    children: [],
  },
]

describe.each(cases)('$label shader contract', ({ sksl, manifest, uniforms, children }) => {
  it('declares exactly the manifest uniforms, in order, with matching float counts', () => {
    expect(parseUniforms(sksl)).toEqual(manifest)
  })

  it('declares exactly the expected child shaders, in binding order', () => {
    expect(childShaders(sksl)).toEqual(children)
  })

  it("the builder's keys and float counts match the manifest exactly", () => {
    expect(Object.keys(uniforms)).toEqual(manifest.map((u) => u.name))
    for (const spec of manifest) {
      const value = uniforms[spec.name]
      expect(value).toBeDefined()
      expect(uniformFloatCount(value as number | number[])).toBe(spec.floats)
    }
  })

  it('every array value is a plain Array (typed arrays truncate on native)', () => {
    for (const value of Object.values(uniforms)) {
      if (typeof value !== 'number') {
        expect(Array.isArray(value)).toBe(true)
        for (const n of value) expect(typeof n).toBe('number')
      }
    }
  })
})

describe('builders', () => {
  it('are pure — same inputs, deep-equal outputs', () => {
    const again = buildMotionUniforms(1 / 30, 4, 0.5, 0.01, 0, splats)
    expect(again).toEqual(built.motion)
  })
})
