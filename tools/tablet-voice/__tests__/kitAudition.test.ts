/**
 * The audition mixdown, end to end (drum-kit-design §§33, 35).
 *
 * This is the only test that runs the WHOLE chain — token → identity →
 * `compileDrumGesture` → logical articulation → rendered wav → audible
 * samples. Everything else tests one link. If the domain and the bank ever
 * disagree about what a piece is called, nothing else in the suite notices
 * and the tablet just plays silence; this fails.
 */
import { renderDrumArticulation } from '../src/drumKit'
import { decisiveScenario, renderAudition, twelveSignatures } from '../src/render-kit-audition'
import { SAMPLE_RATE } from '../src/dsp'

jest.setTimeout(120000)

function peakOf(buffer: Float64Array): number {
  let peak = 0
  for (let n = 0; n < buffer.length; n += 1) peak = Math.max(peak, Math.abs(buffer[n] ?? 0))
  return peak
}

describe('the twelve-signature audition', () => {
  const audition = renderAudition(twelveSignatures(), 1200)

  test('every one of the twelve sounds at least one piece', () => {
    // The failure this catches: a signature whose articulation has no clip
    // renders as silence, and a silent strike in a blind listening test
    // reads as "I could not identify it" rather than as a missing asset.
    expect(audition.gestures).toHaveLength(12)
    for (const gesture of audition.gestures) {
      expect(gesture.hits.length).toBeGreaterThan(0)
    }
  })

  test('the mix is audible and does not clip', () => {
    const peak = peakOf(audition.samples)
    expect(peak).toBeGreaterThan(0.1)
    expect(peak).toBeLessThanOrEqual(0.98)
  })

  test('at fixed intensity, no token reaches an accent or peak articulation', () => {
    // §33 fixes intensity precisely so the ear is judging FAMILY, not
    // effort. If a constant-velocity pass could trigger a rimshot, the
    // audition would be testing the accent ladder by accident.
    for (const gesture of audition.gestures) {
      expect(gesture.accentBand).toBe('normal')
      expect(gesture.hits.map((h) => h.articulation)).not.toContain('crash-main')
    }
  })

  test('the four families are separable by piece alone', () => {
    const pieceOf = (index: number): string =>
      audition.gestures[index]!.hits[0]!.articulation
    // Table order is 1, 1B, 2, 2B, 3, 3B, 4, 4B, 5, 5B, 6, 6B.
    const heads = [pieceOf(0), pieceOf(2), pieceOf(4), pieceOf(8)]
    expect(new Set(heads).size).toBe(4)
  })

  test('every body shot carries a kick and every head shot does not', () => {
    audition.gestures.forEach((gesture, index) => {
      const hasKick = gesture.hits.some((h) => h.articulation === 'kick-main')
      expect(hasKick).toBe(index % 2 === 1) // odd indices are the B tokens
    })
  })
})

describe('§35 decisive scenario', () => {
  const audition = renderAudition(decisiveScenario(), 480)

  test('is eight strikes and ends on the body cross', () => {
    expect(audition.gestures).toHaveLength(8)
    expect(audition.gestures[7]!.token).toBe('2B')
  })

  test('the closing strike crashes — and nothing before it does', () => {
    // §4's reservation, demonstrated: the crash is consequential precisely
    // because seven punches went by without one.
    for (const gesture of audition.gestures.slice(0, 7)) {
      expect(gesture.hits.map((h) => h.articulation)).not.toContain('crash-main')
    }
    const closing = audition.gestures[7]!.hits.map((h) => h.articulation)
    expect(closing).toContain('crash-main')
    // …under a rimshot (peak band) and a kick (body), all three at once.
    expect(closing).toContain('snare-rimshot')
    expect(closing).toContain('kick-main')
  })

  test('the combination builds — the finish is the hardest hit', () => {
    const primaryVelocity = (index: number): number =>
      audition.gestures[index]!.hits[0]!.midiVelocity
    expect(primaryVelocity(7)).toBeGreaterThan(primaryVelocity(0))
  })

  test('uppercut energy accumulates across the 5-6 pair (§14)', () => {
    // The 5 then 6 at positions 6 and 7 in the sequence should leave the
    // uppercut lane hotter than the jab lane it opened on.
    const closing = audition.gestures[7]!.grooveIntent.energy
    expect(closing.uppercut).toBeGreaterThan(closing.jab)
  })

  test('fits its wall clock: 8 strikes at 480 ms plus a tail', () => {
    const seconds = audition.samples.length / SAMPLE_RATE
    expect(seconds).toBeGreaterThan(8 * 0.48)
    expect(seconds).toBeLessThan(8 * 0.48 + 2.5)
  })
})

describe('determinism', () => {
  test('the same audition renders identically twice', () => {
    const a = renderAudition(decisiveScenario(), 480)
    const b = renderAudition(decisiveScenario(), 480)
    expect(a.samples.length).toBe(b.samples.length)
    for (let n = 0; n < a.samples.length; n += 1) {
      if (a.samples[n] !== b.samples[n]) throw new Error(`diverged at ${n}`)
    }
    expect(a.key).toEqual(b.key)
  })
})

describe('the bank answers every name the compiler produces', () => {
  test('each compiled hit resolves to a non-silent clip', () => {
    // The contract between the two halves of this feature. A name the
    // domain emits but the bank cannot render is the exact defect that made
    // body stabs inaudible before — silent, with no error anywhere.
    const all = [...twelveSignatures(), ...decisiveScenario()]
    const audition = renderAudition(all, 300)
    const names = new Set(
      audition.gestures.flatMap((gesture) => gesture.hits.map((hit) => hit.articulation)),
    )
    expect(names.size).toBeGreaterThan(0)
    for (const name of names) {
      const clip = renderDrumArticulation(name)
      expect(clip.length).toBeGreaterThan(0)
      expect(peakOf(clip)).toBeGreaterThan(0.02)
    }
  })
})
