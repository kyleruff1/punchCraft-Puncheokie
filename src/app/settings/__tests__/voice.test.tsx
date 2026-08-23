/**
 * Voice Coach settings screen (M34-05, D1, spec §13.5, §19.4).
 *
 * The assertions that matter are about the overlay row: that its label says
 * in plain words what it does, that it is off until pressed, and that no
 * other control on the screen can move it. A settings screen is where consent
 * is actually given, so the wording is behaviour, not decoration.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

// `Stack.Screen` only sets navigation options; outside a navigator it throws.
// Stubbed the same way the other screen suites do it.
jest.mock('expo-router', () => {
  function Stack(): null {
    return null
  }
  function Screen(): null {
    return null
  }
  Stack.Screen = Screen
  return { Stack }
})

import VoiceSettingsScreen, { OVERLAY_TOGGLE_LABEL } from '../voice'
import {
  __resetVoiceSettingsForTests,
  useVoiceSettingsStore,
} from '@state/useVoiceSettingsStore'
import { PLAYBACK_DETECTION_UNAVAILABLE_NOTICE } from '@audio/ThirdPartyPlaybackDetector'

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<VoiceSettingsScreen />)
  })
  return tree
}

/** Host nodes only — `findAllByProps` defaults to deep and doubles counts. */
const node = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll((n) => n.props?.testID === testID, { deep: false })[0]

const press = (tree: ReactTestRenderer, testID: string): void => {
  act(() => {
    node(tree, testID)?.props.onPress?.()
  })
}

/**
 * All rendered text under a node.
 *
 * Walks the tree rather than stringifying props: a React element holds a
 * `_owner` fiber back-reference, so `JSON.stringify` on one throws on the
 * cycle rather than showing the text.
 */
const textUnder = (tree: ReactTestRenderer, testID: string): string => {
  const root = node(tree, testID)
  if (!root) return ''
  const out: string[] = []
  const walk = (child: unknown): void => {
    if (typeof child === 'string' || typeof child === 'number') {
      out.push(String(child))
      return
    }
    if (Array.isArray(child)) {
      child.forEach(walk)
      return
    }
    if (child && typeof child === 'object' && 'props' in child) {
      walk((child as { props?: { children?: unknown } }).props?.children)
    }
  }
  walk(root.props.children)
  return out.join(' ')
}

const toggle = (tree: ReactTestRenderer, testID: string, value: boolean): void => {
  act(() => {
    node(tree, testID)?.props.onValueChange?.(value)
  })
}

beforeEach(() => {
  __resetVoiceSettingsForTests()
})

// ---------------------------------------------------------------------------

describe('the overlay row (D1)', () => {
  it('says plainly what it does', () => {
    // Not "audio focus", not "mixing" — the athlete should not have to guess
    // that this makes the app talk over their music.
    expect(OVERLAY_TOGGLE_LABEL.toLowerCase()).toContain('music')
    expect(OVERLAY_TOGGLE_LABEL.toLowerCase()).toContain('speak')
  })

  it('renders off', () => {
    const tree = render()
    expect(node(tree, 'overlay-opt-in')?.props.value).toBe(false)
  })

  it('turns on only when pressed', () => {
    const tree = render()
    toggle(tree, 'overlay-opt-in', true)
    expect(useVoiceSettingsStore.getState().policy.overlayOptIn).toBe(true)
  })

  it('turns back off', () => {
    const tree = render()
    toggle(tree, 'overlay-opt-in', true)
    toggle(tree, 'overlay-opt-in', false)
    expect(useVoiceSettingsStore.getState().policy.overlayOptIn).toBe(false)
  })

  it('is not moved by any other control on the screen', () => {
    // The screen has a dozen controls; exactly one may touch consent.
    const tree = render()
    press(tree, 'voice-mode-full')
    press(tree, 'voice-style-follow-the-call')
    press(tree, 'voice-vocabulary-names')
    press(tree, 'voice-metrics-periodic')
    toggle(tree, 'voice-final-warning', true)
    toggle(tree, 'voice-haptics', false)
    press(tree, 'voice-bells-toggle')

    expect(useVoiceSettingsStore.getState().policy.overlayOptIn).toBe(false)
  })

  it('says so when the app cannot detect other playback', () => {
    // Better than a gate that silently assumes silence.
    const tree = render()
    expect(node(tree, 'detection-unavailable')?.props.children).toBe(
      PLAYBACK_DETECTION_UNAVAILABLE_NOTICE,
    )
  })
})

describe('the preference controls write through', () => {
  it('sets the mode', () => {
    const tree = render()
    press(tree, 'voice-mode-minimal')
    expect(useVoiceSettingsStore.getState().policy.mode).toBe('minimal')
  })

  it('sets the style', () => {
    const tree = render()
    press(tree, 'voice-style-call-and-go')
    expect(useVoiceSettingsStore.getState().policy.style).toBe('call-and-go')
  })

  it('sets the vocabulary (D15)', () => {
    const tree = render()
    press(tree, 'voice-vocabulary-names')
    expect(useVoiceSettingsStore.getState().policy.vocabulary).toBe('names')
  })

  it('sets the metric frequency', () => {
    const tree = render()
    press(tree, 'voice-metrics-off')
    expect(useVoiceSettingsStore.getState().policy.metricAnnouncements).toBe('off')
  })

  it('mutes and unmutes bells independently of voice', () => {
    // Independent levels, doc §25 — muting the bell must not silence the coach.
    const tree = render()
    press(tree, 'voice-bells-toggle')
    const state = useVoiceSettingsStore.getState()
    expect(state.volumes.bells).toBe(0)
    expect(state.volumes.voice).toBe(1)
  })

  it('turns haptics off without touching audio', () => {
    const tree = render()
    toggle(tree, 'voice-haptics', false)
    const state = useVoiceSettingsStore.getState()
    expect(state.volumes.haptics).toBe(0)
    expect(state.volumes.voice).toBe(1)
  })
})

describe('voice off is offered as a complete choice, not a downgrade', () => {
  it('says the workout is unchanged without it (doc §25)', () => {
    const tree = render()
    expect(textUnder(tree, 'voice-mode-off').toLowerCase()).toContain('unchanged')
  })
})

describe('selection is never signalled by colour alone (spec §19.4)', () => {
  it('marks the chosen row and sets its accessibility state', () => {
    const tree = render()
    press(tree, 'voice-mode-minimal')
    const chosen = node(tree, 'voice-mode-minimal')
    expect(chosen?.props.accessibilityState).toEqual({ selected: true })
    expect(textUnder(tree, 'voice-mode-minimal')).toContain('✓')
  })
})
