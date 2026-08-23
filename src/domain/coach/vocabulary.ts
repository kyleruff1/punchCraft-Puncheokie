/**
 * Turning workout tokens into things the coach can say (M34-02).
 *
 * Two jobs, split by doc §18.2's time-critical / descriptive line:
 *
 * - `comboPhraseAssets` resolves a combination to pre-rendered clip ids. No
 *   text, no synthesis — this is the path that has to hit a deadline.
 * - `velocityPhrase` builds descriptive text for `speak()`, where a few
 *   hundred milliseconds cost nothing.
 *
 * Pure TypeScript (spec §15.1).
 */

import type { WorkoutToken } from '../workout/WorkoutTokens'
import type { VoiceAssetId } from './VoiceOutputPort'

const PUNCH_ASSETS: Record<number, VoiceAssetId> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
}

/**
 * The clips a combination is spoken as, in order.
 *
 * `1-2b-3` becomes `['1', '2', 'body', '3']`: the body suffix follows its
 * own digit rather than flagging the combination, because `b` is per-digit
 * (D10) — `1-2b-3` bodies only the second punch.
 *
 * **Coach commands produce nothing.** Doc §18.2's closed vocabulary has no
 * clip for `double-up`, `breathe` or `hands-up`; they are display-only, or
 * descriptive text through `speak()`. Silently dropping them here would be
 * a hole, so it is stated rather than implied — and asserted in the tests.
 */
export function comboPhraseAssets(tokens: readonly WorkoutToken[]): VoiceAssetId[] {
  const assets: VoiceAssetId[] = []
  for (const token of tokens) {
    switch (token.kind) {
      case 'punch': {
        const asset = PUNCH_ASSETS[token.number]
        if (!asset) {
          // The type says 1–6; runtime data from a stored plan might not.
          // A wrong digit spoken confidently is worse than a loud failure.
          throw new RangeError(
            `comboPhraseAssets: punch number ${String(token.number)} is outside 1–6 (doc §2)`,
          )
        }
        assets.push(asset)
        if (token.body) assets.push('body')
        break
      }
      case 'defense':
        assets.push(token.command)
        break
      case 'footwork':
        assets.push(token.command)
        break
      case 'coach':
        // Unvoiced by the closed vocabulary — see the note above.
        break
    }
  }
  return assets
}

/* ------------------------------------------------------------- numbers */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
]

/**
 * Spell a whole number 0–999.
 *
 * Spelled rather than left as digits because TTS engines differ on how they
 * read a bare numeral, and the doc's own examples are words. Above 999 the
 * numeral is returned as-is: no metric here reaches four figures, and
 * inventing "one thousand two hundred" grammar for a case that does not
 * occur is code nothing would exercise.
 */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n < 0) return `minus ${numberToWords(-n)}`
  const whole = Math.floor(n)
  if (whole > 999) return String(whole)
  if (whole < 20) return ONES[whole] ?? String(whole)
  if (whole < 100) {
    const tens = TENS[Math.floor(whole / 10)] ?? ''
    const rest = whole % 10
    return rest === 0 ? tens : `${tens}-${ONES[rest]}`
  }
  const hundreds = `${ONES[Math.floor(whole / 100)]} hundred`
  const rest = whole % 100
  return rest === 0 ? hundreds : `${hundreds} ${numberToWords(rest)}`
}

/** `6.8` → `"six point eight"`; `7` → `"seven"`. */
export function decimalToWords(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return numberToWords(value)
  const [whole = '0', fraction = ''] = Math.abs(value).toString().split('.')
  const digits = [...fraction].map((d) => ONES[Number(d)] ?? d).join(' ')
  const sign = value < 0 ? 'minus ' : ''
  return `${sign}${numberToWords(Number(whole))} point ${digits}`
}

/* ---------------------------------------------------------- descriptive */

const VELOCITY_LABEL: Record<'average' | 'last' | 'peak', string> = {
  average: 'Average',
  last: 'Last',
  peak: 'Peak',
}

/**
 * A spoken velocity readout.
 *
 * The word is always **velocity**, and the number is always the
 * tracker-reported value in tracker units (spec §4.3). No unit is spoken,
 * because none is known: naming one would claim a physical measurement
 * nobody has validated.
 */
export function velocityPhrase(kind: 'average' | 'last' | 'peak', value: number): string {
  return `${VELOCITY_LABEL[kind]} velocity ${decimalToWords(value)}`
}
