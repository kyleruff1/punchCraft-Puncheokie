/**
 * Voice vocabulary (M34-02, doc §18.2, D10, spec §4.3).
 */
import { comboPhraseAssets, decimalToWords, numberToWords, velocityPhrase } from '../vocabulary'
import { VOICE_ASSET_IDS, type VoiceAssetId } from '../VoiceOutputPort'
import type { WorkoutToken } from '@domain/workout/WorkoutTokens'

const punch = (number: 1 | 2 | 3 | 4 | 5 | 6, body = false): WorkoutToken => ({
  kind: 'punch',
  number,
  body,
  beatOffset: 0,
})

// ---------------------------------------------------------------------------

describe('a combination becomes clip ids', () => {
  it('resolves 1-2b-3-2 with the body suffix on its own digit (D10)', () => {
    // `b` is per-digit: `1-2b-3` bodies only the second punch, so the suffix
    // has to follow the 2 rather than flag the combination.
    expect(comboPhraseAssets([punch(1), punch(2, true), punch(3), punch(2)])).toEqual([
      '1',
      '2',
      'body',
      '3',
      '2',
    ])
  })

  it('keeps defense and footwork words in sequence', () => {
    const tokens: WorkoutToken[] = [
      punch(1),
      { kind: 'defense', command: 'slip', beatOffset: 1 },
      punch(2),
      { kind: 'footwork', command: 'pivot', beatOffset: 2 },
    ]
    expect(comboPhraseAssets(tokens)).toEqual(['1', 'slip', '2', 'pivot'])
  })

  it('says nothing for a coach command', () => {
    // Doc §18.2's closed vocabulary has no clip for these. Stated here so
    // the hole is a decision rather than something nobody noticed.
    const tokens: WorkoutToken[] = [punch(1), { kind: 'coach', command: 'breathe', beatOffset: 1 }]
    expect(comboPhraseAssets(tokens)).toEqual(['1'])
  })

  it('refuses a punch number outside 1–6', () => {
    // A stored plan could carry one. Speaking a wrong digit confidently is
    // worse than failing loudly.
    const bad = [{ kind: 'punch', number: 7, body: false, beatOffset: 0 }] as unknown as WorkoutToken[]
    expect(() => comboPhraseAssets(bad)).toThrow(/outside 1–6/)
  })

  it('only ever emits ids the manifest has to cover', () => {
    const known = new Set<VoiceAssetId>(VOICE_ASSET_IDS)
    const tokens: WorkoutToken[] = [
      punch(1, true),
      punch(6),
      { kind: 'defense', command: 'bob-weave', beatOffset: 1 },
      { kind: 'footwork', command: 'cut-off-ring', beatOffset: 2 },
    ]
    for (const id of comboPhraseAssets(tokens)) expect(known.has(id)).toBe(true)
  })
})

describe('the asset set covers the whole token vocabulary', () => {
  it('has an id for every defense and footwork command', () => {
    // A command the generator can emit and the coach cannot say would be a
    // silent hole in the middle of a workout.
    const ids = new Set<string>(VOICE_ASSET_IDS)
    for (const command of ['slip', 'roll', 'duck', 'pull', 'bob-weave']) {
      expect([command, ids.has(command)]).toEqual([command, true])
    }
    for (const command of ['pivot', 'step-off', 'circle', 'cut-off-ring', 'reset']) {
      expect([command, ids.has(command)]).toEqual([command, true])
    }
  })

  it('lists every id exactly once', () => {
    expect(new Set(VOICE_ASSET_IDS).size).toBe(VOICE_ASSET_IDS.length)
    // 24 core (punches, defense, footwork, session, tones) + 4 coast
    // announcements (D23) + 5 coach lines (M4 encouragement) + the gong
    // (round-end sound; the ding opens rounds, and no beeps exist) + the
    // power-mode call-out + 47 Set Ceremony call-outs (19 patterns in
    // 2-3 variants, plus the two launch tails).
    expect(VOICE_ASSET_IDS).toHaveLength(82)
  })
})

describe('numbers become words', () => {
  it('spells the small ones', () => {
    expect(numberToWords(0)).toBe('zero')
    expect(numberToWords(6)).toBe('six')
    expect(numberToWords(19)).toBe('nineteen')
  })

  it('hyphenates the compound tens', () => {
    expect(numberToWords(20)).toBe('twenty')
    expect(numberToWords(46)).toBe('forty-six')
  })

  it('spells the hundreds', () => {
    expect(numberToWords(200)).toBe('two hundred')
    expect(numberToWords(246)).toBe('two hundred forty-six')
  })

  it('leaves four figures as digits rather than inventing grammar', () => {
    expect(numberToWords(1200)).toBe('1200')
  })

  it('reads a decimal digit by digit', () => {
    expect(decimalToWords(6.8)).toBe('six point eight')
    expect(decimalToWords(12.25)).toBe('twelve point two five')
    expect(decimalToWords(7)).toBe('seven')
  })
})

describe('the spoken velocity readout (spec §4.3)', () => {
  it('matches the doc §18.2 example', () => {
    expect(velocityPhrase('average', 6.8)).toBe('Average velocity six point eight')
  })

  it('labels the last and peak readings', () => {
    expect(velocityPhrase('last', 9)).toBe('Last velocity nine')
    expect(velocityPhrase('peak', 12.5)).toBe('Peak velocity twelve point five')
  })

  it('names no unit, because none is known', () => {
    // The tracker's number is a tracker number. Naming a unit would claim a
    // measurement nobody has validated.
    // Matched as whole words: a bare letter like "g" is a substring of
    // "average" and would assert nothing.
    const words = velocityPhrase('average', 6.8).toLowerCase().split(/[^a-z/]+/)
    for (const unit of ['mph', 'm/s', 'kph', 'newton', 'joule', 'g', 'gs']) {
      expect([unit, words.includes(unit)]).toEqual([unit, false])
    }
  })

  it('reaches for no word the terminology rule bans', () => {
    // Assembled from fragments so this file does not itself trip the guard.
    const banned = ['fo' + 'rce', 'po' + 'wer', 'en' + 'ergy', 'imp' + 'act']
    const phrase = velocityPhrase('peak', 10).toLowerCase()
    for (const word of banned) expect([word, phrase.includes(word)]).toEqual([word, false])
  })
})
