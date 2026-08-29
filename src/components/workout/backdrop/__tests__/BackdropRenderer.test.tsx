/**
 * Tier matrix: which backdrop actually renders for each (quality,
 * reducedMotion) pair. The scene's contents are not under test — Skia
 * and reanimated are inert mocks — only the §31.4 gating is.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
  useSharedValue: <T,>(init: T) => ({ value: init }),
  useDerivedValue: <T,>(fn: () => T) => ({ value: fn() }),
  runOnUI:
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
  withTiming: <T,>(value: T) => value,
}))
jest.mock('@shopify/react-native-skia', () => {
  const Null = () => null
  return {
    Canvas: Null,
    Group: Null,
    Circle: Null,
    Rect: Null,
    Atlas: Null,
    RadialGradient: Null,
    LinearGradient: Null,
    BlurMask: Null,
    useClock: () => ({ value: 0 }),
    useRectBuffer: () => ({ value: [] }),
    useRSXformBuffer: () => ({ value: [] }),
    useTexture: () => ({ value: null }),
  }
})

import { BackdropRenderer, resolveBackdropQuality } from '../BackdropRenderer'
import { createBackdropBus } from '../backdropBus'

function mount(quality: 'off' | 'reduced' | 'standard', reducedMotion = false) {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(
      <BackdropRenderer
        bus={createBackdropBus()}
        quality={quality}
        calm={1}
        reducedMotion={reducedMotion}
      />,
    )
  })
  return tree
}

function has(tree: ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }, { deep: false }).length > 0
}

describe('resolveBackdropQuality', () => {
  it('honors the athlete switch, reduced motion, and the degrade seam', () => {
    expect(resolveBackdropQuality('standard', false)).toBe('standard')
    expect(resolveBackdropQuality('standard', true)).toBe('reduced')
    expect(resolveBackdropQuality('reduced', false)).toBe('reduced')
    expect(resolveBackdropQuality('off', true)).toBe('off')
    expect(resolveBackdropQuality('standard', false, 'reduced')).toBe('reduced')
    expect(resolveBackdropQuality('standard', false, 'off')).toBe('off')
    expect(resolveBackdropQuality('off', false, 'reduced')).toBe('off')
  })
})

describe('BackdropRenderer', () => {
  it('off renders nothing at all', () => {
    const tree = mount('off')
    expect(has(tree, 'live-backdrop')).toBe(false)
    tree.unmount()
  })

  it('reduced renders the still glow, never the canvas', () => {
    const tree = mount('reduced')
    expect(has(tree, 'live-backdrop')).toBe(true)
    expect(has(tree, 'backdrop-static-glow')).toBe(true)
    expect(has(tree, 'hydro-pulse-canvas')).toBe(false)
    tree.unmount()
  })

  it('standard mounts the HydroPulse scene', () => {
    const tree = mount('standard')
    expect(has(tree, 'live-backdrop')).toBe(true)
    expect(has(tree, 'hydro-pulse-canvas')).toBe(true)
    expect(has(tree, 'backdrop-static-glow')).toBe(false)
    tree.unmount()
  })

  it('reduced motion forces the still tier even at standard (§31.4)', () => {
    const tree = mount('standard', true)
    expect(has(tree, 'backdrop-static-glow')).toBe(true)
    expect(has(tree, 'hydro-pulse-canvas')).toBe(false)
    tree.unmount()
  })
})
