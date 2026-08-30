/**
 * The runner feeds the backdrop (D17 seam).
 *
 * The bus and the frame math have their own suites; this one proves the
 * runner actually *emits* — the seam where "the water was wired
 * perfectly and never stirred" would come from. Same posture as
 * voiceWiring: the real runner, a fake clock, a recording port.
 *
 * The port contract (mirroring haptics) is that the IMPLEMENTATION is
 * non-throwing — the runner calls it bare. backdropBus.test.ts proves
 * the real implementation swallows sink failures.
 */
import React, { useImperativeHandle } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { View } from 'react-native'

import { useWorkoutRunner, TICK_INTERVAL_MS, type WorkoutRunner } from '../_useWorkoutRunner'
import { DEFAULT_COUNTDOWN_MS } from '@domain/session/WorkoutSessionClock'
import { createFakeClock, type FakeClock } from '@testing/fakeClock'
import { defaultRecipe } from '@domain/workout/WorkoutRecipe'
import { resetLive, useLiveStore } from '@state/useWorkoutStore'
import type {
  BackdropImpulsePort,
  BackdropPunchImpulse,
} from '@domain/effects/BackdropImpulsePort'
import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'
import type { PunchEventSource } from '@domain/punch/PunchEventSource'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import type { ProgramRound } from '@domain/workout/WorkoutTokens'

const WORK_MS = 20_000

function round(order: number): ProgramRound {
  return {
    id: `r${order}`,
    order,
    kind: 'round',
    countsTowardGoal: true,
    theme: `Round ${order}`,
    workDurationMs: WORK_MS,
    restAfterMs: 0,
    targetPunches: 4,
    blocks: [
      {
        id: `r${order}-b1`,
        kind: 'repeated-combo',
        stance: 'inherit',
        startOffsetMs: 0,
        durationMs: 2_000,
        gapBeats: 1,
        repeat: 2,
        tokens: [
          { kind: 'punch', number: 1, body: false, beatOffset: 0 },
          { kind: 'punch', number: 2, body: false, beatOffset: 0.6 },
        ],
      },
    ],
  }
}

const WORKOUT: GeneratedWorkout = {
  id: 'backdrop-wiring-fixture',
  recipe: defaultRecipe(),
  schedule: [round(1)],
  roundPunchTargets: [4],
  expectedTechniqueDistribution: {},
  estimatedActivePunchesPerMinute: 60,
  warnings: [],
}

/** A source the test drives by hand. */
class ControllableSource implements PunchEventSource {
  readonly id = 'controllable'
  readonly capability = {
    hand: true,
    timestamp: true,
    punchType: 'none' as const,
    velocity: true,
  }
  private listener: ((e: TrackerPunchEvent) => void) | null = null

  subscribe(l: (e: TrackerPunchEvent) => void): () => void {
    this.listener = l
    return () => {
      this.listener = null
    }
  }
  start(): void {}
  stop(): void {}

  punch(hand: TrackerPunchEvent['hand'], velocityRaw: number | undefined, at: number): void {
    this.listener?.({
      id: `test-${at}`,
      sourceFrameId: `frame-${at}`,
      deviceId: 'test-device',
      hand,
      receivedMonotonicTimeMs: at,
      receivedWallTimeIso: '2026-08-29T00:00:00.000Z',
      ...(typeof velocityRaw === 'number' ? { velocityRaw } : {}),
      velocityUnit: 'tracker-unit',
      recovered: false,
      decoderId: 'test',
      decoderVersion: '0',
      qualityFlags: [],
    })
  }
}

class RecordingBackdrop implements BackdropImpulsePort {
  readonly impulses: BackdropPunchImpulse[] = []
  impulse(punch: BackdropPunchImpulse): void {
    this.impulses.push(punch)
  }
}

interface Harness {
  runner: WorkoutRunner
  source: ControllableSource
  clock: FakeClock
  step(ms: number): void
  begin(): void
  unmount(): void
}

function mount(backdrop?: BackdropImpulsePort): Harness {
  const clock = createFakeClock()
  const source = new ControllableSource()
  const ref = React.createRef<WorkoutRunner>()

  function Probe(): React.JSX.Element {
    const runner = useWorkoutRunner({
      workout: WORKOUT,
      source,
      stance: 'orthodox',
      clock,
      persistence: null,
      ...(backdrop ? { backdrop } : {}),
    })
    useImperativeHandle(ref, () => runner, [runner])
    return <View />
  }

  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<Probe />)
  })

  const step = (ms: number): void => {
    act(() => {
      for (let elapsed = 0; elapsed < ms; elapsed += TICK_INTERVAL_MS) {
        clock.advance(TICK_INTERVAL_MS)
        jest.advanceTimersByTime(TICK_INTERVAL_MS)
      }
    })
  }

  return {
    get runner() {
      return ref.current as WorkoutRunner
    },
    source,
    clock,
    step,
    begin: () => {
      act(() => {
        ;(ref.current as WorkoutRunner).start()
      })
      step(DEFAULT_COUNTDOWN_MS + TICK_INTERVAL_MS)
    },
    unmount: () => {
      act(() => {
        tree.unmount()
      })
    },
  }
}

beforeEach(() => {
  jest.useFakeTimers()
  resetLive()
})

afterEach(() => {
  jest.useRealTimers()
  act(() => {
    useLiveStore.getState().resetLive()
  })
})

describe('the runner feeds the backdrop', () => {
  it('emits one impulse per punch, hand and reading intact', () => {
    const port = new RecordingBackdrop()
    const h = mount(port)
    h.begin()

    act(() => {
      h.source.punch('left', 9, h.clock.now())
      h.source.punch('right', 14, h.clock.now() + 200)
    })

    expect(port.impulses).toEqual([
      { hand: 'left', velocityRaw: 9 },
      { hand: 'right', velocityRaw: 14 },
    ])
    // The same punches also reached scoring — the fan-out is a copy,
    // not a diversion.
    expect(useLiveStore.getState().live.counts.total).toBe(2)
    h.unmount()
  })

  it('omits the reading when the event carries none', () => {
    const port = new RecordingBackdrop()
    const h = mount(port)
    h.begin()

    act(() => {
      h.source.punch('left', undefined, h.clock.now())
    })

    expect(port.impulses).toEqual([{ hand: 'left' }])
    h.unmount()
  })

  it('runs identically with no backdrop configured', () => {
    const h = mount()
    h.begin()

    act(() => {
      h.source.punch('left', 9, h.clock.now())
    })

    expect(useLiveStore.getState().live.counts.total).toBe(1)
    h.unmount()
  })
})
