/**
 * The prosody compiler decides how a combination is *performed*, and every
 * rule in it was arrived at by measuring a rendered clip. That makes it
 * exactly the kind of code that regresses silently: a change here produces
 * audio that is still perfectly valid, just wrong, and nothing fails until
 * somebody listens.
 *
 * These lock the decisions that cost the most to rediscover.
 */
import { compilePhrase, groupTokens, isMovement, spokenFor, EXPRESSION } from '../prosody.mjs'

const roll = ['1', '2', 'roll', '3', '2']

describe('grouping', () => {
  it('pairs punches and leaves a movement standing alone', () => {
    expect(groupTokens(roll)).toEqual([['1', '2'], ['roll'], ['3', '2']])
  })

  it('leaves an odd trailing punch as its own group', () => {
    expect(groupTokens(['1', '2', '3'])).toEqual([['1', '2'], ['3']])
  })
})

describe('spoken form', () => {
  it('says a body shot the way a person would', () => {
    expect(spokenFor('2b')).toBe('Body two')
  })

  it('names lead and rear, never left and right', () => {
    // A lead hook is a left hook in orthodox and a right hook in southpaw, so
    // a call naming a side is wrong every time the athlete switches stance.
    const named = Object.values({ three: spokenFor('3', { vocabulary: 'techniques' }) })
    expect(named[0]).toBe('Lead hook')
    expect(named[0]).not.toMatch(/left|right/i)
  })

  it('shortens a technique name when the cadence has no room for it', () => {
    expect(spokenFor('5', { vocabulary: 'techniques', cadence: 'technical' })).toBe('Lead uppercut')
    expect(spokenFor('5', { vocabulary: 'techniques', cadence: 'sprint' })).toBe('Lead upper')
  })
})

describe('movement is an interruption, not a list item', () => {
  it('sets it off with an ellipsis and its own hard landing', () => {
    // Measured across six spellings: only an ellipsis produces a pause the
    // synthesizer actually renders. A comma produced no measurable gap at
    // all, which is why `, roll,` read as one more word in the run.
    const text = compilePhrase({ tokens: roll }).renderedText
    expect(text).toBe('One two... Roll!... Three two!')
  })

  it('asks for a beat on both sides of it', () => {
    const { beats } = compilePhrase({ tokens: roll })
    expect(beats).toHaveLength(2)
    expect(beats[0].at).toBeLessThan(beats[1].at)
    expect(beats.every((b) => b.targetMs > 0)).toBe(true)
  })

  it('does not ask for a beat where there is no movement', () => {
    expect(compilePhrase({ tokens: ['1', '2', '3', '2'] }).beats).toEqual([])
  })

  it('drops the outer beat when the movement opens or closes the phrase', () => {
    // Nothing to break away from at the start, and nothing to resume at the
    // end — a beat there is just a longer clip.
    expect(compilePhrase({ tokens: ['slip', '1', '2'] }).beats).toHaveLength(1)
    expect(compilePhrase({ tokens: ['1', '2', 'slip'] }).beats).toHaveLength(1)
  })

  it('tightens the beat as the state gets more urgent', () => {
    const beatFor = (performance) => compilePhrase({ tokens: roll, performance }).beats[0].targetMs
    expect(beatFor('teach')).toBeGreaterThan(beatFor('work'))
    expect(beatFor('work')).toBeGreaterThan(beatFor('push'))
  })
})

describe('contour', () => {
  const contour = (options) => compilePhrase({ tokens: roll, ...options }).pitchContourSemitones

  it('is ordered, so Praat interpolates rather than flattening a segment', () => {
    const times = contour().map((p) => p.normalizedTime)
    expect([...times]).toEqual([...times].sort((a, b) => a - b))
  })

  it('ends on the hardest downward move', () => {
    // A combination ends by landing, not by trailing off.
    const points = contour()
    const last = points[points.length - 1]
    expect(last.normalizedTime).toBe(1)
    expect(last.offset).toBeLessThan(Math.min(...points.slice(0, -1).map((p) => p.offset)))
  })

  it('puts the movement above the line and then below it', () => {
    // The rise-then-drop is the interruption. Without it the roll is absorbed
    // into the melodic run instead of breaking it.
    const points = contour()
    const highest = points.reduce((a, b) => (b.offset > a.offset ? b : a))
    expect(points.some((p) => p.offset > 1 && p.normalizedTime < 0.5)).toBe(true)
    expect(highest.offset).toBeGreaterThan(0)
  })

  it('deepens with expression rather than moving the accents', () => {
    const measured = contour({ expression: 'measured' })
    const theatrical = contour({ expression: 'theatrical' })
    expect(theatrical.map((p) => p.normalizedTime)).toEqual(measured.map((p) => p.normalizedTime))
    expect(Math.abs(theatrical[0].offset)).toBeGreaterThan(Math.abs(measured[0].offset))
  })

  it('stays inside what Praat can resynthesize cleanly', () => {
    // pitch_contour.py clamps at 4.5 st. Producing values above the clamp
    // would silently flatten the peaks this whole system exists to create.
    for (const expression of Object.keys(EXPRESSION)) {
      for (const performance of ['teach', 'work', 'push']) {
        const plan = compilePhrase({ tokens: roll, performance, expression })
        for (const point of plan.pitchContourSemitones) {
          expect(Math.abs(point.offset + plan.pitchShiftSemitones)).toBeLessThanOrEqual(4.5)
        }
      }
    }
  })
})

describe('delivery', () => {
  it('uses sentence case, not Title Case On Every Word', () => {
    // Capitalising each word invites the synthesizer to treat every one as
    // its own emphatic unit, which is an evenly-stressed delivery.
    expect(compilePhrase({ tokens: ['1', '2', '3', '2'] }).renderedText).toBe('One two, three two!')
  })

  it('treats a single strike as a different performance, not a short combination', () => {
    expect(compilePhrase({ tokens: ['1'] }).profile).toBe('single')
    expect(compilePhrase({ tokens: ['1', '2'] }).profile).toBe('combination')
    // A lone defense call is a bark too: "Slip!" wants the dry, hard-attack
    // treatment, not the flowing one.
    expect(compilePhrase({ tokens: ['slip'] }).profile).toBe('single')
  })

  it('ends a teaching call without a shout', () => {
    expect(compilePhrase({ tokens: roll, performance: 'teach' }).renderedText).toMatch(/\.$/)
    expect(compilePhrase({ tokens: roll, performance: 'push' }).renderedText).toMatch(/!$/)
  })

  it('records how it was made, so a bad take is diagnosable', () => {
    const plan = compilePhrase({ tokens: roll, vocabulary: 'techniques', performance: 'push' })
    expect(plan).toMatchObject({
      canonicalTokens: roll,
      calloutMode: 'techniques',
      performance: 'push',
      expression: 'theatrical',
    })
    expect(plan.renderedText).toBe('Jab cross... Roll!... Lead hook cross!')
  })
})

describe('isMovement', () => {
  it('recognises defense and footwork, and nothing else', () => {
    expect(isMovement('roll')).toBe(true)
    expect(isMovement('bob-weave')).toBe(true)
    expect(isMovement('1')).toBe(false)
    expect(isMovement('2b')).toBe(false)
  })
})
