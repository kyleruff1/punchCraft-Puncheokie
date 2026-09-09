import {
  canonicalize,
  fnv1a,
  mapHashOf,
  INSTRUMENT_SCHEMA_VERSION,
} from '../instrument/gestureSchema'

describe('gestureSchema wire helpers', () => {
  it('canonicalize sorts object keys recursively and preserves array order', () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: [3, 1, 2] } })
    const b = canonicalize({ a: { c: [3, 1, 2], d: 2 }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"c":[3,1,2],"d":2},"b":1}')
  })

  it('canonicalize omits undefined fields deterministically', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }))
  })

  it('canonicalize rejects non-finite numbers rather than colliding on null', () => {
    expect(() => canonicalize({ x: Number.POSITIVE_INFINITY })).toThrow('non-finite')
    expect(() => canonicalize({ x: Number.NaN })).toThrow('non-finite')
  })

  it('mapHashOf is stable across key order and sensitive to values', () => {
    const h1 = mapHashOf({ scale: [62, 65, 67], zones: 6 })
    const h2 = mapHashOf({ zones: 6, scale: [62, 65, 67] })
    expect(h1).toBe(h2)
    expect(mapHashOf({ scale: [62, 65, 67], zones: 6 })).not.toBe(
      mapHashOf({ scale: [62, 65, 67], zones: 5 }),
    )
  })

  it('fnv1a matches the known vector and is 8 hex chars', () => {
    // FNV-1a 32-bit of the empty string is the offset basis 0x811c9dc5.
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('a')).toBe('e40c292c')
    expect(fnv1a('map')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('pins the schema version', () => {
    expect(INSTRUMENT_SCHEMA_VERSION).toBe(1)
  })
})
