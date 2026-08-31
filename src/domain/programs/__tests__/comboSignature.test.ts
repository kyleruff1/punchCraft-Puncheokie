import { describe, expect, it } from '@jest/globals'
import {
  comboSignatureFromStrikes,
  comboSignatureTokenPart,
} from '../comboSignature'

describe('comboSignatureTokenPart', () => {
  it('leaves head tokens as their digit string', () => {
    expect(comboSignatureTokenPart('1')).toBe('1')
    expect(comboSignatureTokenPart('6')).toBe('6')
  })

  it('lowercases body suffix (uppercase B → lowercase b)', () => {
    expect(comboSignatureTokenPart('2B')).toBe('2b')
    expect(comboSignatureTokenPart('5B')).toBe('5b')
  })
})

describe('comboSignatureFromStrikes', () => {
  it('joins tokens with hyphens preserving order', () => {
    expect(
      comboSignatureFromStrikes([
        { token: '1' },
        { token: '2' },
        { token: '3' },
      ]),
    ).toBe('1-2-3')
  })

  it('canonicalizes body tokens to the manifest form', () => {
    expect(
      comboSignatureFromStrikes([
        { token: '1' },
        { token: '2B' },
        { token: '3' },
      ]),
    ).toBe('1-2b-3')
  })

  it('handles the repeated-node case `1-1-2` verbatim (matches manifest key)', () => {
    expect(
      comboSignatureFromStrikes([
        { token: '1' },
        { token: '1' },
        { token: '2' },
      ]),
    ).toBe('1-1-2')
  })

  it('returns the empty string for an empty strike list', () => {
    expect(comboSignatureFromStrikes([])).toBe('')
  })
})
