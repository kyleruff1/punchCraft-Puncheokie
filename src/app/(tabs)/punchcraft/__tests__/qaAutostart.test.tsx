/**
 * QA autostart (GH #291) — the live screen presses Hit It on behalf of the
 * `punchcraft://qa/run` deep link, and ONLY then.
 *
 * The defect class this guards: the unattended suite relies on a workout
 * starting without a person in the room. A regression here is a 22-workout
 * run that sits on the lobby screen for five hours and then reports every
 * event missing. So the cases pin the three gates the effect must honour —
 * the runner's own armed signal, the settle, and the consumed latch — and
 * the two things it must NEVER do: start when the staged run did not ask
 * for it, or start twice.
 *
 * Same mock block as `live.test.tsx` (the screen mounts the real runner and
 * the real audio stack, whose native imports must resolve without a
 * binding); kept separate because these cases need fake timers and the
 * live suite does not.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { SafeAreaProvider } from 'react-native-safe-area-context'

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
jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
  useSharedValue: <T,>(init: T) => ({ value: init }),
  useDerivedValue: <T,>(fn: () => T) => ({ value: fn() }),
  useAnimatedStyle: <T,>(fn: () => T) => fn(),
  runOnUI:
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
  runOnJS:
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
    useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
    useNavigation: () => ({ getParent: () => ({ setOptions: jest.fn() }) }),
    useFocusEffect: (fn: () => void | (() => void)) => {
      fn()
    },
    useIsFocused: () => mockIsFocused,
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

let mockIsFocused = true

import LiveScreen from '../live'
import { replaceSinks, type LogRecord } from '@diagnostics/logger'
import { SimulatedPunchSource } from '@simulation/SimulatedPunchSource'
import { simBpmForWorkout } from '@simulation/simPace'
import { getSampleWorkout } from '@domain/workout/samples'
import { setLive, useLiveStore, useWorkoutStore, type LiveState } from '@state/useWorkoutStore'
import { __resetQaStoreForTests, useQaStore, type StagedQaRun } from '@state/useQaStore'

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 2000, height: 1200 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

const mounted: ReactTestRenderer[] = []
let records: LogRecord[] = []

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

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms)
  })
}

const stage = (over: Partial<StagedQaRun> = {}): void => {
  useQaStore.getState().stageRun({
    workout: 'three-round-fundamentals',
    vocab: 'numbers',
    sim: 'none',
    simForce: false,
    autostart: true,
    autostartDelayMs: 100,
    nonce: 'test-nonce',
    requestedAtMs: 0,
    autostartConsumed: false,
    ...over,
  })
}

const autostartLogs = (): LogRecord[] => records.filter((r) => r.code === 'puncheokie.qa.autostart')

/** The runner's own "armed, waiting for Hit It" evidence, as pushStore publishes it. */
const armed = (): void => drive({ phase: 'idle', roundCount: 3 })

beforeEach(() => {
  jest.useFakeTimers()
  records = []
  replaceSinks([{ write: (r) => records.push(r) }])
  mockIsFocused = true
  __resetQaStoreForTests()
  act(() => {
    useLiveStore.getState().resetLive()
    useWorkoutStore.getState().resetRecipe()
    useWorkoutStore.getState().selectSample('three-round-fundamentals')
  })
})

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount()
  })
  jest.useRealTimers()
})

describe('QA autostart', () => {
  it('presses Hit It once the runner is armed and the settle has elapsed', () => {
    stage()
    render()
    armed()
    expect(autostartLogs()).toHaveLength(0)
    advance(99)
    expect(autostartLogs()).toHaveLength(0) // still settling
    advance(1)
    expect(autostartLogs()).toHaveLength(1)
    expect(autostartLogs()[0]?.fields.nonce?.value).toBe('test-nonce')
    expect(useQaStore.getState().run?.autostartConsumed).toBe(true)
    // The button's own path ran: the session left idle.
    expect(useLiveStore.getState().live.phase).not.toBe('idle')
  })

  it('does nothing without a staged run', () => {
    render()
    armed()
    advance(10_000)
    expect(autostartLogs()).toHaveLength(0)
    expect(useLiveStore.getState().live.phase).toBe('idle')
  })

  it('does nothing when the staged run did not ask for autostart', () => {
    // The route downgrades autostart when the QA flag is off; the screen
    // must honour that downgrade rather than re-derive its own answer.
    stage({ autostart: false })
    render()
    armed()
    advance(10_000)
    expect(autostartLogs()).toHaveLength(0)
    expect(useLiveStore.getState().live.phase).toBe('idle')
  })

  it('waits for the armed signal — roundCount 0 means the runner has not published yet', () => {
    stage()
    render()
    drive({ phase: 'idle', roundCount: 0 })
    advance(10_000)
    expect(autostartLogs()).toHaveLength(0)
    armed()
    advance(100)
    expect(autostartLogs()).toHaveLength(1)
  })

  it('never starts a screen that is not being looked at', () => {
    mockIsFocused = false
    stage()
    render()
    armed()
    advance(10_000)
    expect(autostartLogs()).toHaveLength(0)
  })

  it('fires once: a consumed run cannot re-arm on later renders', () => {
    stage()
    render()
    armed()
    advance(100)
    expect(autostartLogs()).toHaveLength(1)
    // Anything that would re-run the effect with the run still staged.
    armed()
    advance(10_000)
    expect(autostartLogs()).toHaveLength(1)
  })

  it('abandons a pending settle if the phase leaves idle first', () => {
    // Someone (or the runner) started the workout during the settle: the
    // timer must be cleared, not fire a second start into a live session.
    stage()
    render()
    armed()
    advance(50)
    drive({ phase: 'countdown', roundCount: 3 })
    advance(10_000)
    expect(autostartLogs()).toHaveLength(0)
  })
})

describe('QA auto-sim', () => {
  // No gloves are connected under jest, so the live screen's source IS the
  // simulator; spying on the prototype sees the instance the screen built.
  let playScript: jest.SpyInstance
  let stopScript: jest.SpyInstance

  beforeEach(() => {
    playScript = jest.spyOn(SimulatedPunchSource.prototype, 'playScript')
    stopScript = jest.spyOn(SimulatedPunchSource.prototype, 'stopScript')
  })
  afterEach(() => {
    playScript.mockRestore()
    stopScript.mockRestore()
  })

  const simLogs = (): LogRecord[] => records.filter((r) => r.code === 'puncheokie.qa.sim')

  it('plays the staged script at work-entered, paced to the workout, and stops it at rest', () => {
    stage({ sim: 'captured-jam', autostart: false })
    render()
    // Not in the lobby, not during the countdown.
    drive({ phase: 'idle', roundCount: 3, roundIndex: -1 })
    drive({ phase: 'countdown', roundCount: 3, roundIndex: 0 })
    expect(playScript).not.toHaveBeenCalled()

    drive({ phase: 'work', roundCount: 3, roundIndex: 0 })
    const workout = getSampleWorkout('three-round-fundamentals').workout
    const expectedBpm = simBpmForWorkout('captured-jam', workout)
    expect(playScript).toHaveBeenCalledWith('captured-jam', expectedBpm)
    expect(simLogs()).toHaveLength(1)
    expect(simLogs()[0]?.fields.bpm?.value).toBe(expectedBpm)

    drive({ phase: 'rest', roundCount: 3, roundIndex: 0 })
    expect(stopScript).toHaveBeenCalled()
  })

  it('restarts the script fresh for every round', () => {
    stage({ sim: 'alternating-1-2', autostart: false })
    render()
    drive({ phase: 'work', roundCount: 3, roundIndex: 0 })
    drive({ phase: 'rest', roundCount: 3, roundIndex: 0 })
    drive({ phase: 'work', roundCount: 3, roundIndex: 1 })
    expect(playScript).toHaveBeenCalledTimes(2)
    expect(simLogs().map((r) => r.fields.roundIndex?.value)).toEqual([0, 1])
  })

  it('honours an explicit simBpm over the paced one', () => {
    stage({ sim: 'burst', simBpm: 123, autostart: false })
    render()
    drive({ phase: 'work', roundCount: 3, roundIndex: 0 })
    expect(playScript).toHaveBeenCalledWith('burst', 123)
  })

  it('does nothing when the staged run asks for no script — or there is no run', () => {
    stage({ sim: 'none', autostart: false })
    render()
    drive({ phase: 'work', roundCount: 3, roundIndex: 0 })
    expect(playScript).not.toHaveBeenCalled()
  })

  it('stops the script on pause and on the way out', () => {
    stage({ sim: 'captured-jam', autostart: false })
    const tree = render()
    drive({ phase: 'work', roundCount: 3, roundIndex: 0 })
    drive({ phase: 'paused', roundCount: 3, roundIndex: 0 })
    expect(stopScript).toHaveBeenCalledTimes(1)
    drive({ phase: 'work', roundCount: 3, roundIndex: 0 })
    act(() => {
      tree.unmount()
      mounted.splice(mounted.indexOf(tree), 1)
    })
    expect(stopScript).toHaveBeenCalledTimes(2)
  })
})

