/**
 * Jam screen — OUTPUT / TEXTURE rows and the gesture tee (M40-15 #319).
 *
 * The rules that must not quietly regress:
 *
 * - default OUTPUT is 'bridge' and on it the wire path is byte-for-byte
 *   today's: gestures go to the bridge and the tablet engine is never even
 *   constructed (R5).
 * - 'tablet' mutes the wire; 'both' feeds both rigs — the tee lives inside
 *   the keepalive subscription and reads the routing through a ref, so a
 *   flip mid-jam applies to the very next punch.
 * - BOTH row families (brass and legacy patches) carry the rows: a legacy
 *   patch on tablet output still plays drum one-shots.
 * - PANIC silences the tablet engine too, and unmount releases it.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

interface MockPlayer {
  volume: number
  playCount: number
  removed: boolean
}

interface MockPlaylist {
  opts: unknown
  volume: number
  playCount: number
  destroyed: boolean
}

const mockAudio = {
  players: [] as MockPlayer[],
  playlists: [] as MockPlaylist[],
  audioModeCalls: 0,
}

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => {
    const player = {
      volume: 1,
      playCount: 0,
      removed: false,
      play() {
        this.playCount += 1
      },
      pause() {},
      seekTo: () => Promise.resolve(),
      remove() {
        this.removed = true
      },
    }
    mockAudio.players.push(player)
    return player
  },
  createAudioPlaylist: (opts: unknown) => {
    const playlist = {
      opts,
      volume: 1,
      playCount: 0,
      destroyed: false,
      play() {
        this.playCount += 1
      },
      pause() {},
      destroy() {
        this.destroyed = true
      },
    }
    mockAudio.playlists.push(playlist)
    return playlist
  },
  setAudioModeAsync: async () => {
    mockAudio.audioModeCalls += 1
  },
}))

const mockBridge = { gestures: [] as unknown[], panics: 0 }

jest.mock('@/instrument/bridgeClient', () => ({
  BridgeClient: class {
    connect(): void {}
    disconnect(): void {}
    setMapHash(): void {}
    sendGesture(gesture: unknown): void {
      mockBridge.gestures.push(gesture)
    }
    sendPanic(): void {
      mockBridge.panics += 1
    }
  },
}))

const mockKeepalive = { listener: null as ((event: unknown) => void) | null }

jest.mock('@protocol/trackerKeepalive', () => ({
  getTrackerKeepaliveSource: () => ({
    subscribe: (listener: (event: unknown) => void) => {
      mockKeepalive.listener = listener
      return () => {
        mockKeepalive.listener = null
      }
    },
  }),
}))

jest.mock('expo-router', () => {
  // useFocusEffect ≈ "focused for as long as mounted" under the test
  // renderer — the focus-scoped lifecycles behave like mount effects.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require('react') as typeof React
  return {
    router: { back: jest.fn() },
    useFocusEffect: (cb: () => void | (() => void)) => {
      useEffect(cb, [cb])
    },
  }
})

import JamScreen from '../jam'
import {
  __resetInstrumentSettingsForTests,
  useInstrumentSettingsStore,
} from '@state/useInstrumentSettingsStore'

let tree: ReactTestRenderer | null = null

function render(): ReactTestRenderer {
  act(() => {
    tree = create(<JamScreen />)
  })
  return tree!
}

/** Host nodes only — `findAllByProps` defaults to deep and doubles counts. */
const node = (t: ReactTestRenderer, testID: string) =>
  t.root.findAll((n) => n.props?.testID === testID, { deep: false })[0]

async function press(t: ReactTestRenderer, testID: string): Promise<void> {
  await act(async () => {
    node(t, testID)?.props.onPress?.()
  })
}

/** All rendered text under a node, walked (React elements hold fiber cycles). */
const textUnder = (t: ReactTestRenderer, testID: string): string => {
  const root = node(t, testID)
  if (!root) return ''
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n))
      return
    }
    const children = (n as { children?: unknown[] }).children
    if (Array.isArray(children)) children.forEach(walk)
  }
  walk(root)
  return out.join(' ')
}

function punch(atMs: number): void {
  act(() => {
    mockKeepalive.listener?.({
      id: `evt-${atMs}`,
      hand: 'left',
      receivedMonotonicTimeMs: atMs,
      velocityRaw: 9,
      accelerationRaw: 5,
      recovered: false,
    })
  })
}

beforeEach(() => {
  __resetInstrumentSettingsForTests()
  mockAudio.players.length = 0
  mockAudio.playlists.length = 0
  mockAudio.audioModeCalls = 0
  mockBridge.gestures.length = 0
  mockBridge.panics = 0
  mockKeepalive.listener = null
})

afterEach(() => {
  // Unmount releases the engine, cancelling its re-arm timers.
  act(() => {
    tree?.unmount()
  })
  tree = null
})

describe('the rows exist in BOTH patch families', () => {
  it('a brass-cube patch shows OUTPUT and TEXTURE beside SENSITIVITY', () => {
    const t = render()
    expect(node(t, 'jam-row-sensitivity')).toBeDefined()
    expect(textUnder(t, 'jam-row-output')).toContain('BRIDGE')
    expect(textUnder(t, 'jam-row-texture')).toContain('brass')
  })

  it('a legacy patch shows them too', () => {
    useInstrumentSettingsStore.setState({ patchId: 'two-handed-pentatonic' })
    const t = render()
    expect(node(t, 'jam-row-sensitivity')).toBeDefined()
    expect(node(t, 'jam-row-output')).toBeDefined()
    expect(node(t, 'jam-row-texture')).toBeDefined()
  })
})

describe('cycling and persistence through the store', () => {
  it('OUTPUT cycles bridge → tablet → both → bridge, uppercased on glass', async () => {
    const t = render()
    await press(t, 'jam-row-output')
    expect(useInstrumentSettingsStore.getState().outputTarget).toBe('tablet')
    expect(textUnder(t, 'jam-row-output')).toContain('TABLET')

    await press(t, 'jam-row-output')
    expect(useInstrumentSettingsStore.getState().outputTarget).toBe('both')
    expect(textUnder(t, 'jam-row-output')).toContain('BOTH')

    await press(t, 'jam-row-output')
    expect(useInstrumentSettingsStore.getState().outputTarget).toBe('bridge')
  })

  it('TEXTURE cycles the registry', async () => {
    const t = render()
    await press(t, 'jam-row-texture')
    expect(useInstrumentSettingsStore.getState().textureId).toBe('pluck')
    expect(textUnder(t, 'jam-row-texture')).toContain('pluck')

    await press(t, 'jam-row-texture')
    expect(useInstrumentSettingsStore.getState().textureId).toBe('brass')
  })
})

describe('the gesture tee', () => {
  it("default 'bridge' sends the wire and never constructs the engine", () => {
    render()
    punch(1_000)

    expect(mockBridge.gestures).toHaveLength(1)
    expect(mockAudio.players).toHaveLength(0)
    expect(mockAudio.playlists).toHaveLength(0)
    expect(mockAudio.audioModeCalls).toBe(0)
  })

  it("'tablet' mutes the wire and voices the punch on the tablet", async () => {
    const t = render()
    await press(t, 'jam-row-output') // → tablet; preload flushed by act

    expect(mockAudio.audioModeCalls).toBe(1)
    expect(mockAudio.players.length).toBeGreaterThan(0)

    punch(1_000)
    expect(mockBridge.gestures).toHaveLength(0)
    // A brass gesture commits a bed + bass loop pair.
    expect(mockAudio.playlists).toHaveLength(2)
  })

  it("'both' feeds both rigs from one punch", async () => {
    const t = render()
    await press(t, 'jam-row-output')
    await press(t, 'jam-row-output') // → both

    punch(1_000)
    expect(mockBridge.gestures).toHaveLength(1)
    expect(mockAudio.playlists).toHaveLength(2)
  })
})

describe('panic and unmount', () => {
  it('PANIC silences the tablet engine alongside the bridge', async () => {
    const t = render()
    await press(t, 'jam-row-output') // → tablet
    punch(1_000)
    expect(mockAudio.playlists.some((p) => !p.destroyed)).toBe(true)

    await press(t, 'jam-panic')
    expect(mockBridge.panics).toBe(1)
    expect(mockAudio.playlists.every((p) => p.destroyed)).toBe(true)
  })

  it('unmount releases every pooled player', async () => {
    const t = render()
    await press(t, 'jam-row-output') // → tablet
    punch(1_000)

    act(() => {
      t.unmount()
    })
    tree = null
    expect(mockAudio.players.every((p) => p.removed)).toBe(true)
  })
})
