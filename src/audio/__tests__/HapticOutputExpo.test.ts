/**
 * The haptic output gate.
 *
 * The one behaviour that must never regress: nothing buzzes until the athlete's
 * `haptics` volume enables it. Beyond that, each strike kind maps to a distinct
 * intensity so a good hit, a perfect hit and a completed combo feel different.
 */
import * as Haptics from 'expo-haptics'

import { HapticOutputExpo } from '../HapticOutputExpo'

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}))

const impactAsync = Haptics.impactAsync as jest.MockedFunction<typeof Haptics.impactAsync>
const notificationAsync = Haptics.notificationAsync as jest.MockedFunction<
  typeof Haptics.notificationAsync
>

beforeEach(() => {
  impactAsync.mockClear()
  notificationAsync.mockClear()
})

describe('HapticOutputExpo', () => {
  it('does nothing until enabled', () => {
    const h = new HapticOutputExpo()
    h.strike('good')
    h.strike('perfect')
    h.strike('combo')
    expect(impactAsync).not.toHaveBeenCalled()
    expect(notificationAsync).not.toHaveBeenCalled()
  })

  it('buzzes once enabled, and goes quiet again when disabled', () => {
    const h = new HapticOutputExpo()
    h.setEnabled(true)
    h.strike('good')
    expect(impactAsync).toHaveBeenCalledWith('medium')

    impactAsync.mockClear()
    h.setEnabled(false)
    h.strike('good')
    expect(impactAsync).not.toHaveBeenCalled()
  })

  it('hits harder for a perfect strike than a good one', () => {
    const h = new HapticOutputExpo()
    h.setEnabled(true)
    h.strike('perfect')
    expect(impactAsync).toHaveBeenCalledWith('heavy')
  })

  it('opens a completed combo with a success note', () => {
    const h = new HapticOutputExpo()
    h.setEnabled(true)
    h.strike('combo')
    expect(notificationAsync).toHaveBeenCalledWith('success')
  })
})
