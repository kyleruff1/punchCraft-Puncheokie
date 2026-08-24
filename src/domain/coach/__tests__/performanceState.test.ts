import { PUSH_TAIL_MS, selectPerformanceState } from '../performanceState'

const base = {
  startMsIntoRound: 60_000,
  workDurationMs: 180_000,
  isRoundOpening: false,
  cadenceProfile: 'steady',
}

describe('selectPerformanceState', () => {
  it('is work through the body of a steady round', () => {
    expect(selectPerformanceState(base)).toBe('work')
  })

  it('teaches the opening call of a round', () => {
    expect(selectPerformanceState({ ...base, startMsIntoRound: 0, isRoundOpening: true })).toBe(
      'teach',
    )
  })

  it('pushes in the closing seconds', () => {
    const atEdge = { ...base, startMsIntoRound: 180_000 - PUSH_TAIL_MS }
    expect(selectPerformanceState(atEdge)).toBe('push')
    // A hair before the tail is still work.
    expect(selectPerformanceState({ ...atEdge, startMsIntoRound: atEdge.startMsIntoRound - 1 })).toBe(
      'work',
    )
  })

  it('pushes for a pressure or sprint block regardless of position', () => {
    expect(selectPerformanceState({ ...base, cadenceProfile: 'pressure' })).toBe('push')
    expect(selectPerformanceState({ ...base, cadenceProfile: 'sprint' })).toBe('push')
  })

  it('lets push win over teach when the opening is also a pressure block', () => {
    // A pressure block's first cue is still a pressure cue.
    expect(
      selectPerformanceState({
        ...base,
        startMsIntoRound: 0,
        isRoundOpening: true,
        cadenceProfile: 'pressure',
      }),
    ).toBe('push')
  })

  it('lets the ending win when a short round opens inside the closing seconds', () => {
    // Round shorter than the push tail: the opening cue is also near the end,
    // and the ending wins.
    expect(
      selectPerformanceState({
        startMsIntoRound: 0,
        workDurationMs: 15_000,
        isRoundOpening: true,
        cadenceProfile: 'steady',
      }),
    ).toBe('push')
  })

  it('teaches the opening of a technical round but works the body', () => {
    expect(
      selectPerformanceState({ ...base, startMsIntoRound: 0, isRoundOpening: true, cadenceProfile: 'technical' }),
    ).toBe('teach')
    expect(selectPerformanceState({ ...base, cadenceProfile: 'technical' })).toBe('work')
  })
})
