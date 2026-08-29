/**
 * The manifest contract: a wrong uniform key or float count THROWS on
 * the UI thread at draw time on device. These tests turn that whole
 * class of crash into a Node-time failure by parsing the SkSL uniform
 * declarations and diffing them against the manifest and the builder's
 * actual output. Plus the strict-ES2 rule the membrane loop must obey:
 * no continue/break inside runtime-effect loops.
 */
import {
  DEFAULT_TUNING,
  MEMBRANE_MANIFEST,
  MEMBRANE_SKSL,
  buildMembraneUniforms,
  uniformFloatCount,
  type UniformSpec,
} from '../effects/membraneShader'
import { HAND_LEFT, HAND_RIGHT, spawnImpulse } from '../effects/membraneMath'

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

const ring = [spawnImpulse(HAND_LEFT, 0.6, 1, 10), spawnImpulse(HAND_RIGHT, 1, 2, 10.2)]
const built = buildMembraneUniforms(10.4, 1600, 900, 1, 0.5, 0.3, ring, DEFAULT_TUNING)

describe('membrane shader contract', () => {
  it('declares exactly the manifest uniforms, in order, with matching float counts', () => {
    expect(parseUniforms(MEMBRANE_SKSL)).toEqual(MEMBRANE_MANIFEST)
  })

  it('declares exactly the expected child shaders, in binding order', () => {
    expect(childShaders(MEMBRANE_SKSL)).toEqual(['backdrop', 'grain'])
  })

  it("the builder's keys and float counts match the manifest exactly", () => {
    expect(Object.keys(built)).toEqual(MEMBRANE_MANIFEST.map((u) => u.name))
    for (const spec of MEMBRANE_MANIFEST) {
      const value = built[spec.name]
      expect(value).toBeDefined()
      expect(uniformFloatCount(value as number | number[])).toBe(spec.floats)
    }
  })

  it('every array value is a plain Array (typed arrays truncate on native)', () => {
    for (const value of Object.values(built)) {
      if (typeof value !== 'number') {
        expect(Array.isArray(value)).toBe(true)
        for (const n of value) expect(typeof n).toBe('number')
      }
    }
  })

  it('keeps the loop strict-ES2 clean: no continue or break statements', () => {
    const code = MEMBRANE_SKSL.replace(/\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/\bcontinue\b/)
    expect(code).not.toMatch(/\bbreak\b/)
  })

  it('is pure — same inputs, deep-equal outputs', () => {
    expect(buildMembraneUniforms(10.4, 1600, 900, 1, 0.5, 0.3, ring, DEFAULT_TUNING)).toEqual(
      built,
    )
  })

  it('an empty ring builds an exactly-neutral gel, zero darkness, zero amplitudes', () => {
    const idle = buildMembraneUniforms(99, 1600, 900, 1, 0, 0, [], DEFAULT_TUNING)
    expect(idle.uGel).toEqual([0, 0, 0, 0])
    expect(idle.uDark).toBe(0)
    const a = idle.uA as number[]
    for (let i = 0; i < a.length; i += 4) expect(a[i + 3]).toBe(0)
  })
})
