/**
 * Live screen (M32-08).
 *
 * The screen holds no workout logic, so these tests are about wiring and
 * about the rules that must not quietly regress: velocity surfaces absent
 * when the source cannot measure velocity, no red mid-combination, and
 * destructive controls guarded.
 *
 * The runner's timing is covered by the session-clock and cue-engine
 * suites; here the store is driven directly so each phase can be rendered
 * without running a workout in real time.
 */
import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { readFileSync } from 'node:fs'

// The screen now builds a `VoiceOutputExpo`, which imports the native audio
// modules. They are never exercised here — the coach makes no sound in a test
// renderer — but the import has to resolve without a binding (spec §21.1).
jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({
    volume: 1,
    seekTo: () => {},
    play: () => {},
    remove: () => {},
  }),
  setAudioModeAsync: async () => undefined,
}))
jest.mock('expo-speech', () => ({ speak: () => {}, stop: () => {} }))

// The backdrop pulls in reanimated (whose worklets runtime needs a native
// proxy) and Skia (native bindings, and outside jest-expo's transform
// allowlist). Neither must ever load for real here — and reanimated
// 4.5.1's OFFICIAL mock is unusable too: its mock.ts imports the real
// index, which initializes the worklets native module. So the mock is
// hand-rolled to exactly the hooks the live tree touches: derived
// values evaluate once (the frame math is pure and runs fine under
// Node), runOnUI executes inline, and Skia becomes inert null
// components — the scene mounts, draws nothing, and the style walks
// below see straight through it.
jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
  useSharedValue: <T,>(init: T) => ({ value: init }),
  useDerivedValue: <T,>(fn: () => T) => ({ value: fn() }),
  runOnUI:
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
  withTiming: <T,>(value: T) => value,
  useFrameCallback: () => ({ setActive: () => {} }),
}))
jest.mock('@shopify/react-native-skia', () => {
  const Null = () => null
  return {
    Canvas: Null,
    Fill: Null,
    Shader: Null,
    ImageShader: Null,
    FilterMode: { Nearest: 0, Linear: 1 },
    MipmapMode: { None: 0 },
    TileMode: { Clamp: 0 },
    useImage: () => null,
    useClock: () => ({ value: 0 }),
    Skia: {
      RuntimeEffect: { Make: () => ({}) },
      Surface: { MakeOffscreen: () => null },
      Paint: () => ({ setColor: () => {}, setShader: () => {} }),
      Color: () => 0,
    },
  }
})

jest.mock('expo-router', () => {
  function Stack() {
    return null
  }
  function Screen() {
    return null
  }
  Stack.Screen = Screen
  function Link({ children }: { children: React.ReactNode }) {
    return children
  }
  return {
    Stack,
    Link,
    useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
    useNavigation: () => ({ getParent: () => mockParent }),
    useFocusEffect: (fn: () => void | (() => void)) => {
      // Run the effect body once so the orientation/keep-awake calls are
      // exercised, mirroring a focused screen.
      const cleanup = fn()
      if (typeof cleanup === 'function') mockCleanups.push(cleanup)
    },
  }
})

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { LANDSCAPE: 'LANDSCAPE' },
  lockAsync: jest.fn(async () => undefined),
  unlockAsync: jest.fn(async () => undefined),
}))

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(() => undefined),
}))

const mockCleanups: Array<() => void> = []
/** Stands in for the tab navigator whose bar the live screen hides. */
const mockParent = { setOptions: jest.fn() }

import * as ScreenOrientation from 'expo-screen-orientation'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import LiveScreen from '../live'
import { TAB_BAR_STYLE } from '../../_layout'
import { colors } from '@/theme/colors'
import { setLive, useLiveStore, useWorkoutStore } from '@state/useWorkoutStore'
import { useBackdropSettingsStore } from '@state/useBackdropSettingsStore'
import type { LiveState } from '@state/useWorkoutStore'

const mounted: ReactTestRenderer[] = []

// The screen reads the bottom safe-area inset (the control strip must
// clear the Android taskbar), so renders need a provider with metrics.
const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 2000, height: 1200 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <LiveScreen />
      </SafeAreaProvider>,
    )
  })
  mounted.push(tree)
  return tree
}

function drive(patch: Partial<LiveState>): void {
  act(() => {
    setLive(patch)
  })
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('')
}

const allText = (tree: ReactTestRenderer): string => textOf(tree.root)

function nodes(tree: ReactTestRenderer, testID: string): ReactTestInstance[] {
  return tree.root.findAllByProps({ testID }, { deep: false })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCleanups.length = 0
  act(() => {
    useLiveStore.getState().resetLive()
    useWorkoutStore.getState().resetRecipe()
  })
})

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount()
  })
})

// ---------------------------------------------------------------------------

describe('orientation and keep-awake (M32-05 decision)', () => {
  it('locks landscape and takes a keep-awake lock on focus', () => {
    render()
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith('LANDSCAPE')
    expect(activateKeepAwakeAsync).toHaveBeenCalled()
  })

  it('releases both on blur', () => {
    render()
    act(() => {
      for (const cleanup of mockCleanups.splice(0)) cleanup()
    })
    expect(ScreenOrientation.unlockAsync).toHaveBeenCalled()
    // Explicitly deactivated by tag — the spike found useKeepAwake()'s
    // implicit release does not fire, which would stop the screen ever
    // sleeping again.
    expect(deactivateKeepAwake).toHaveBeenCalled()
  })

  it('releases keep-awake by the same tag it acquired', () => {
    render()
    const acquiredTag = (activateKeepAwakeAsync as jest.Mock).mock.calls[0]?.[0]
    act(() => {
      for (const cleanup of mockCleanups.splice(0)) cleanup()
    })
    expect((deactivateKeepAwake as jest.Mock).mock.calls[0]?.[0]).toBe(acquiredTag)
  })
})

describe('navigation is unreachable during a workout (doc §19)', () => {
  it('hides the tab bar on focus', () => {
    render()
    expect(mockParent.setOptions).toHaveBeenCalledWith({
      tabBarStyle: { display: 'none' },
    })
  })

  it('restores it on blur', () => {
    render()
    act(() => {
      for (const cleanup of mockCleanups.splice(0)) cleanup()
    })
    // Restores the shared style object, never `undefined`: an explicit
    // undefined overrides the navigator-level tabBarStyle in the options
    // merge and collapses the bar to a few pixels (the "no navigation
    // bar after a workout" bug).
    expect(mockParent.setOptions).toHaveBeenLastCalledWith({ tabBarStyle: TAB_BAR_STYLE })
  })
})

describe('zones', () => {
  it('renders all three zones', () => {
    const tree = render()
    expect(() => tree.root.findByProps({ testID: 'round-top-bar' })).not.toThrow()
    expect(() => tree.root.findByProps({ testID: 'metrics-rail' })).not.toThrow()
    expect(() => tree.root.findByProps({ testID: 'live-screen' })).not.toThrow()
  })

  it('mounts the reactive backdrop by default; quality off removes it live', () => {
    const tree = render()
    expect(() => tree.root.findByProps({ testID: 'live-backdrop' })).not.toThrow()
    act(() => {
      useBackdropSettingsStore.setState({ quality: 'off' })
    })
    expect(tree.root.findAllByProps({ testID: 'live-backdrop' }, { deep: false })).toHaveLength(0)
    act(() => {
      useBackdropSettingsStore.setState({ quality: 'standard' })
    })
  })

  it('offers a start action before the workout begins', () => {
    const tree = render()
    expect(() => tree.root.findByProps({ testID: 'start-workout' })).not.toThrow()
  })

  it('keeps round counter and countdown OUT of the live tree (they live in the header)', () => {
    // Kyle 2026-08-28: the tabs-navigator header renders Round n/N and
    // the clock at its 75% line, outside this screen's tree — the live
    // screen must not duplicate them.
    const tree = render()
    drive({ phase: 'work', roundIndex: 1, roundCount: 3, roundRemainingMs: 95_000 })
    expect(tree.root.findAllByProps({ testID: 'round-counter' })).toHaveLength(0)
    expect(tree.root.findAllByProps({ testID: 'round-countdown' })).toHaveLength(0)
  })

  it('keeps tracker lamps OUT of the live tree — the header led zone owns them', () => {
    // Kyle 2026-08-29: the in-round lamp pair was a duplicate of the
    // header's; simulation shows on the header lamps (SIM tag) instead.
    const tree = render()
    expect(tree.root.findAllByProps({ testID: 'tracker-lamp-L' })).toHaveLength(0)
    expect(tree.root.findAllByProps({ testID: 'tracker-lamp-R' })).toHaveLength(0)
  })

  it('keeps the punch avatar OUT of the backdrop subtree — effects can never reach it', () => {
    // Kyle 2026-08-29: the avatar is a top layer. The reactive backdrop
    // darkens inside a fragment shader, so anything ABOVE the canvas is
    // untouchable by construction — this pins that the card is up there and
    // not, say, refactored down into the backdrop tree one day.
    const tree = render()
    const backdrop = tree.root.findAllByProps({ testID: 'live-backdrop' }, { deep: false })
    for (const node of backdrop) {
      expect(node.findAllByProps({ testID: 'punch-avatar-card' }, { deep: false })).toHaveLength(0)
    }
  })

  it('surfaces a degraded tracker through the top bar, not a new channel', () => {
    const tree = render()
    expect(nodes(tree, 'degraded-warning')).toHaveLength(0)

    drive({ degraded: 'Left glove reconnecting — those punches are not being counted' })
    expect(textOf(tree.root.findByProps({ testID: 'degraded-warning' }))).toContain(
      'Left glove reconnecting',
    )
  })

  it('shows counts from the store', () => {
    const tree = render()
    drive({
      phase: 'work',
      counts: { total: 24, left: 12, right: 12, inCue: 1, inCueExpected: 2 },
    })
    expect(textOf(tree.root.findByProps({ testID: 'metric-left-right' }))).toContain('12 / 12')
  })
})

describe('phase overlays', () => {
  it('shows Paused while paused and hides it on resume', () => {
    const tree = render()
    drive({ phase: 'paused' })
    expect(textOf(tree.root.findByProps({ testID: 'paused-overlay' }))).toContain('Paused')

    drive({ phase: 'work' })
    expect(nodes(tree, 'paused-overlay')).toHaveLength(0)
  })

  it('shows a completion overlay when the workout finishes', () => {
    const tree = render()
    drive({ phase: 'completed' })
    expect(textOf(tree.root.findByProps({ testID: 'finished-overlay' }))).toContain(
      'Workout complete',
    )
  })

  it('distinguishes a stop from a completion', () => {
    const tree = render()
    drive({ phase: 'cancelled' })
    expect(textOf(tree.root.findByProps({ testID: 'finished-overlay' }))).toContain('Stopped')
  })
})

describe('controls', () => {
  it('disables pause before the workout starts', () => {
    const tree = render()
    expect(tree.root.findByProps({ testID: 'control-pause' }).props.disabled).toBe(true)
  })

  it('enables pause during work and swaps it for resume when paused', () => {
    const tree = render()
    drive({ phase: 'work' })
    expect(tree.root.findByProps({ testID: 'control-pause' }).props.disabled).toBe(false)

    drive({ phase: 'paused' })
    expect(nodes(tree, 'control-pause')).toHaveLength(0)
    expect(() => tree.root.findByProps({ testID: 'control-resume' })).not.toThrow()
  })

  it('puts skip and repeat behind a long press, not a tap (doc §25)', () => {
    // A glove mis-tap mid-combination must not silently change the workout.
    const tree = render()
    drive({ phase: 'work' })
    for (const id of ['control-skip', 'control-repeat']) {
      const control = tree.root.findByProps({ testID: id })
      expect(typeof control.props.onLongPress).toBe('function')
      expect(control.props.onPress).toBeUndefined()
    }
  })

  it('disables skip and repeat outside work', () => {
    const tree = render()
    drive({ phase: 'rest' })
    expect(tree.root.findByProps({ testID: 'control-skip' }).props.disabled).toBe(true)
    expect(tree.root.findByProps({ testID: 'control-repeat' }).props.disabled).toBe(true)
  })

  it('confirms before discarding after a stop (spec §19.4)', () => {
    const tree = render()
    drive({ phase: 'work' })
    expect(nodes(tree, 'stop-confirm')).toHaveLength(0)

    act(() => {
      tree.root.findByProps({ testID: 'control-stop' }).props.onPress()
    })
    // The stop itself is immediate (doc §25); only the session's fate is
    // still open, and Discard is never a one-tap action.
    const confirm = tree.root.findByProps({ testID: 'stop-confirm' })
    expect(textOf(confirm)).toContain('Keep this session?')
    expect(() => tree.root.findByProps({ testID: 'confirm-save' })).not.toThrow()
    expect(() => tree.root.findByProps({ testID: 'confirm-discard' })).not.toThrow()
  })

  it('gives every control a glove-friendly target (doc §25)', () => {
    const tree = render()
    drive({ phase: 'work' })
    for (const id of ['control-pause', 'control-skip', 'control-repeat', 'control-stop']) {
      const flat = StyleSheet.flatten(
        tree.root.findByProps({ testID: id }).props.style,
      ) as { minHeight?: number }
      expect(flat.minHeight ?? 0).toBeGreaterThanOrEqual(48)
    }
  })
})

describe('capability honesty (doc §3, spec §4.3)', () => {
  it('hides every velocity surface when the source reports none', () => {
    const tree = render()
    drive({ velocityAvailable: false, capabilityTier: 'hand-only' })
    expect(nodes(tree, 'metric-avg-velocity')).toHaveLength(0)
    expect(nodes(tree, 'metric-last-velocity')).toHaveLength(0)
    expect(allText(tree)).not.toContain('velocity')
  })

  it('labels visible velocity as tracker-reported', () => {
    const tree = render()
    drive({
      velocityAvailable: true,
      capabilityTier: 'hand-timestamp',
      lastVelocity: { value: 11, unit: 'tracker-unit', label: 'tracker-reported velocity' },
      avgVelocity: { value: 9, unit: 'tracker-unit', label: 'tracker-reported velocity' },
    })
    expect(allText(tree)).toContain('tracker-reported velocity')
  })

  it('never claims technique accuracy', () => {
    const tree = render()
    drive({ capabilityTier: 'hand-timestamp', tiles: ['correct-hand-percent'] })
    expect(allText(tree)).toContain('hand-sequence match')
    expect(allText(tree)).not.toMatch(/technique accuracy/i)
  })
})

describe('matching surfaces (#188)', () => {
  it('shows the extra-punch count', () => {
    const tree = render()
    drive({ phase: 'work', extraCount: 3 })
    expect(textOf(tree.root.findByProps({ testID: 'extra-count' }))).toContain('3')
  })

  it('shows zero extras rather than hiding the row', () => {
    // Extras are a fact about the round, not a warning that appears only
    // when something went wrong.
    const tree = render()
    drive({ phase: 'work', extraCount: 0 })
    expect(() => tree.root.findByProps({ testID: 'extra-count' })).not.toThrow()
  })

  it('does not show a per-combo sequence score — the score is punch count', () => {
    // The sequence label was dropped from the live strip: punch count (in the
    // metrics rail) is the score, with left/right and velocity as analytics.
    const tree = render()
    drive({ phase: 'work', sequenceScoreLabel: 'hand-sequence match' })
    expect(allText(tree).toLowerCase()).not.toContain('hand-sequence match')
  })
})

describe('pacing surfaces (#191)', () => {
  it('shows a real required pace once pacing supplies one', () => {
    const tree = render()
    drive({ phase: 'work', requiredPace: 63.4 })
    expect(textOf(tree.root.findByProps({ testID: 'metric-required-pace' }))).toContain('63/min')
  })

  it('still shows an em dash before pacing has a figure', () => {
    // Not measured yet is not zero.
    const tree = render()
    drive({ phase: 'work', requiredPace: undefined })
    expect(textOf(tree.root.findByProps({ testID: 'metric-required-pace' }))).toContain('—')
  })

  it('shows the pacing cue when one is set', () => {
    const tree = render()
    drive({ phase: 'work', pacingCue: 'Build the pace' })
    expect(textOf(tree.root.findByProps({ testID: 'pacing-cue' }))).toBe('Build the pace')
  })

  it('shows no cue when there is none — silence is the unreachable case', () => {
    // Doc §25: an out-of-reach target produces no cue at all, so the
    // absence has to render as nothing rather than as an empty row.
    const tree = render()
    drive({ phase: 'work', pacingCue: undefined })
    expect(nodes(tree, 'pacing-cue')).toHaveLength(0)
  })

  it('uses the exact doc §22 wording', () => {
    const tree = render()
    drive({ phase: 'work', pacingCue: 'You are ahead; stay sharp' })
    expect(allText(tree)).toContain('You are ahead; stay sharp')
  })
})

describe('no red flash mid-combination (doc §13, §21)', () => {
  it('uses danger only on the stop control, never in the cue zone', () => {
    const tree = render()
    drive({ phase: 'work' })

    const stage = tree.root.findByProps({ testID: 'live-screen' })
    const reds: string[] = []
    const visit = (node: ReactTestInstance): void => {
      const id = node.props?.testID
      // The Stop control is allowed to be red; it is not mid-combo feedback.
      if (typeof id === 'string' && (id === 'control-stop' || id === 'stop-confirm')) return
      const flat = StyleSheet.flatten(node.props?.style) as Record<string, unknown> | undefined
      if (flat) {
        for (const [key, value] of Object.entries(flat)) {
          if (typeof value === 'string' && /color/i.test(key) && value === colors.danger) {
            reds.push(String(id ?? 'unnamed'))
          }
        }
      }
      for (const child of node.children) if (typeof child !== 'string') visit(child)
    }
    visit(stage)
    expect(reds).toEqual([])
  })
})

describe('no app audio on this screen (spec §13.5)', () => {
  it('imports no audio module', () => {
    // Voice arrives in M34 behind the D1 gate; nothing here may speak.
    // Read from the repo root rather than __dirname so this stays a plain
    // ESM import with no CommonJS globals.
    const source = readFileSync('src/app/(tabs)/punchcraft/live.tsx', 'utf8')
    expect(source).not.toMatch(/expo-av|expo-audio|expo-speech/)
  })
})
