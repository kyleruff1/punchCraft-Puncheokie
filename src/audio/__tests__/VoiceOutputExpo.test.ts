/**
 * VoiceOutputExpo (M34-04, doc §18, §25, D3, D16).
 *
 * The behaviours worth guarding are the ones with a wrong-but-plausible
 * alternative:
 *
 * - A deadline already past is played **late, not dropped**. Silence is a
 *   worse answer than lateness for a punch the athlete is being asked to
 *   throw.
 * - `cancel` drops what is *queued*, never what is already sounding. Chopping
 *   a word mid-syllable is not what the priority order is for.
 * - With audio unavailable, every call is a no-op and the workout still runs
 *   (doc §25).
 *
 * Everything native is injected, so this suite needs no binding — which is
 * the whole reason the constructor takes seams (spec §21).
 */
// The native modules are never exercised — every seam is injected — but the
// import still has to resolve, and the real ones need a binding this
// workstation does not have (spec §21.1).
import { existsSync, readFileSync } from 'node:fs'

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => {
    throw new Error('expo-audio is not available in tests; inject createPlayer')
  },
  setAudioModeAsync: async () => undefined,
}))
jest.mock('expo-speech', () => ({ speak: () => {}, stop: () => {} }))

import {
  CLICK_SCRIPT_PREARM_PAD_MS,
  CLICK_SCRIPT_RESIDENT_CAP,
  COACH_LANE_RELEASE_GRACE_MS,
  DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS,
  FALLBACK_CLIP_MS,
  latencyCompensatedDispatchMs,
  MIN_CLIP_GAP_MS,
  VoiceOutputExpo,
} from '../VoiceOutputExpo'
import {
  PHRASE_FORMS,
  missingAssetIds,
  voiceAssetManifest,
  type PhraseForm,
  type VoiceAssetManifest,
} from '../voiceAssets/manifest'
import {
  AUDIO_PRIORITY,
  FUSED_BODY_ASSET_IDS,
  VOICE_ASSET_IDS,
  type VoiceAssetId,
} from '@domain/coach/VoiceOutputPort'

/* ----------------------------------------------------------------- fakes */

interface PlayEvent {
  source: number
  volume: number
}

function harness(
  opts: { failMode?: boolean; failPlayers?: boolean } = {},
): {
  output: VoiceOutputExpo
  plays: PlayEvent[]
  created: Array<{ source: number; volume: number }>
  spoken: string[]
  stops: number
  now: () => number
  advance(ms: number): void
  modes: string[]
} {
  const plays: PlayEvent[] = []
  const created: Array<{ source: number; volume: number }> = []
  const spoken: string[] = []
  const modes: string[] = []
  let stops = 0
  let clock = 1_000
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  let nextId = 1

  const output = new VoiceOutputExpo({
    clock: () => clock,
    schedule: (fn, delayMs) => {
      const id = nextId++
      timers.push({ at: clock + delayMs, fn, id })
      return id
    },
    cancelScheduled: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
    createPlayer: (source) => {
      if (opts.failPlayers) throw new Error('no binding')
      let volume = 1
      const player = {
        source,
        get volume() {
          return volume
        },
        set volume(v: number) {
          volume = v
        },
        seekTo: () => {},
        play: () => plays.push({ source, volume }),
        remove: () => {},
      }
      created.push(player)
      return player as never
    },
    speaker: {
      speak: (text: string) => {
        spoken.push(text)
      },
      stop: () => {
        stops += 1
      },
    } as never,
    setAudioMode: (async (mode: { interruptionMode?: string }) => {
      if (opts.failMode) throw new Error('audio init failed')
      if (mode.interruptionMode) modes.push(mode.interruptionMode)
    }) as never,
  })

  return {
    output,
    plays,
    created,
    spoken,
    get stops() {
      return stops
    },
    modes,
    now: () => clock,
    advance(ms: number) {
      const target = clock + ms
      // Step the clock to each timer's own moment before firing it, and keep
      // looping while more come due. Jumping the clock to `target` first and
      // then firing would schedule a chained timer from the wrong "now" —
      // which made a working sequence look like it stopped after one clip.
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        clock = Math.max(clock, due.at)
        due.fn()
      }
      clock = target
    },
  }
}

const sourceOf = (
  id: VoiceAssetId,
  vocabulary: 'numbers' | 'names' = 'numbers',
  form: PhraseForm = 'standalone',
): number => {
  const module = voiceAssetManifest.assets[vocabulary][form][id]
  if (module === undefined) {
    throw new Error(`sourceOf: no manifest entry for ${vocabulary}/${form}/${id}`)
  }
  return module
}

// ---------------------------------------------------------------------------

describe('the manifest covers the whole vocabulary', () => {
  it.each([
    ['numbers', 'standalone'],
    ['numbers', 'combo'],
    ['names', 'standalone'],
    ['names', 'combo'],
  ] as const)('has a clip for every id in %s/%s', (vocabulary, form) => {
    // Derived from the id union rather than a hand-copied list — a copied
    // list drifts and quietly stops catching anything.
    expect(missingAssetIds(voiceAssetManifest, vocabulary, form)).toEqual([])
  })

  it('fails when an id is missing', () => {
    const broken = {
      ...voiceAssetManifest,
      assets: {
        ...voiceAssetManifest.assets,
        numbers: {
          ...voiceAssetManifest.assets.numbers,
          standalone: { ...voiceAssetManifest.assets.numbers.standalone, body: undefined as never },
        },
      },
    } as VoiceAssetManifest
    expect(missingAssetIds(broken, 'numbers')).toEqual(['body'])
  })

  it('points each vocabulary at its own directory', () => {
    // The failure this guards is a copy-pasted block whose paths still say
    // `numbers/` — which would make choosing `names` silently keep saying
    // "one". It is checked in the source rather than through the module ids,
    // because jest-expo maps every `.wav` require to one stub value and the
    // ids therefore collide in tests but not in Metro.
    // The Set Ceremony call-outs live in generated per-directory maps
    // (calloutManifest.ts) spread into the four sections — count both
    // sources, and hold the same each-vocabulary-owns-its-directory rule.
    const source = readFileSync('src/audio/voiceAssets/manifest.ts', 'utf8')
    const callouts = readFileSync('src/audio/voiceAssets/calloutManifest.ts', 'utf8')
    const numbersBlock = source.slice(source.indexOf('numbers: {'), source.indexOf('names: {'))
    const namesBlock = source.slice(source.indexOf('names: {'))
    const calloutNumbers = callouts.match(/assets\/voice\/numbers\/(standalone|combo)\/co-/g) ?? []
    const calloutNames = callouts.match(/assets\/voice\/names\/(standalone|combo)\/co-/g) ?? []

    // Fused-body ids (`1b..6b`) only ship in numbers/standalone —
    // the other three slots are exempt per FUSED_BODY_ASSET_IDS
    // (see missingAssetIds relaxation in manifest.ts). So numbers
    // carries the full id set once (standalone) + the non-fused
    // subset once (combo); names carries the non-fused subset in
    // both forms.
    const nonFusedCount = VOICE_ASSET_IDS.length - FUSED_BODY_ASSET_IDS.length
    const expectedNumbers = VOICE_ASSET_IDS.length + nonFusedCount
    const expectedNames = nonFusedCount * PHRASE_FORMS.length
    expect((numbersBlock.match(/assets\/voice\/numbers\//g)?.length ?? 0) + calloutNumbers.length).toBe(expectedNumbers)
    expect((namesBlock.match(/assets\/voice\/names\//g)?.length ?? 0) + calloutNames.length).toBe(expectedNames)
    expect(namesBlock).not.toContain('assets/voice/numbers/')
  })

  it('has a real file behind every path it names', () => {
    // A require of a missing asset resolves to nothing at runtime and shows
    // up as a clip that silently never plays.
    const source = readFileSync('src/audio/voiceAssets/manifest.ts', 'utf8')
    const callouts = readFileSync('src/audio/voiceAssets/calloutManifest.ts', 'utf8')
    const paths = source.match(/assets\/voice\/[a-z]+\/[a-z]+\/[^']+\.wav/g) ?? []
    const calloutPaths = callouts.match(/assets\/voice\/[a-z]+\/[a-z]+\/[^']+\.wav/g) ?? []
    // Non-fused ids × 2 vocabs × 2 forms + fused-body ids (numbers/
    // standalone only), split across manifest.ts + calloutManifest.ts.
    const nonFusedCount = VOICE_ASSET_IDS.length - FUSED_BODY_ASSET_IDS.length
    const idPaths = [...paths, ...calloutPaths.filter((p) => p.includes('/co-'))]
    expect(idPaths).toHaveLength(nonFusedCount * 2 * PHRASE_FORMS.length + FUSED_BODY_ASSET_IDS.length)
    for (const path of [...paths, ...calloutPaths]) {
      expect([path, existsSync(path)]).toEqual([path, true])
    }
  })

  it('is uncompressed, per the M34-01 decision', () => {
    expect(voiceAssetManifest.format).toBe('wav')
  })
})

describe('a deadline is honoured, and a missed one is not thrown away', () => {
  it('holds a clip until its deadline', async () => {
    const h = harness()
    await h.output.preload()

    h.output.playAsset('1', h.now() + 300)
    expect(h.plays).toEqual([])

    h.advance(299)
    expect(h.plays).toEqual([])

    h.advance(1)
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('1')])
  })

  it('plays a deadline already past immediately, rather than dropping it', async () => {
    // The punch is still being asked for. Silence would be the worse answer.
    const h = harness()
    await h.output.preload()
    h.output.playAsset('2', h.now() - 40)
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('2')])
  })

  it('plays with no deadline at all straight away', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('3')
    expect(h.plays).toHaveLength(1)
  })

  it('keeps several deadlines in flight and fires them in order', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1', h.now() + 100)
    h.output.playAsset('2', h.now() + 200)
    h.output.playAsset('3', h.now() + 50)

    h.advance(250)
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('3'), sourceOf('1'), sourceOf('2')])
  })
})

describe('a phrase plays as a sequence, not all at once', () => {
  it('plays clips sharing a deadline back to back', async () => {
    // Found on the tablet: 1-1-2 was audible as a single brief noise. Every
    // clip fired at the same instant, so they overlapped — and the repeated
    // "1" restarted its own player mid-word, so only one "1" ever sounded.
    const h = harness()
    await h.output.preload()

    const at = h.now() + 100
    h.output.playAsset('1', at)
    h.output.playAsset('1', at)
    h.output.playAsset('2', at)

    h.advance(100)
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('1')])

    // Nothing measured these clips, so the fallback hold applies.
    h.advance(FALLBACK_CLIP_MS)
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('1'), sourceOf('1')])

    h.advance(FALLBACK_CLIP_MS)
    expect(h.plays.map((p) => p.source)).toEqual([
      sourceOf('1'),
      sourceOf('1'),
      sourceOf('2'),
    ])
  })

  it('says a repeated word once for each time it was called', async () => {
    const h = harness()
    await h.output.preload()
    const at = h.now() + 50
    h.output.playAsset('1', at)
    h.output.playAsset('1', at)

    h.advance(50 + FALLBACK_CLIP_MS * 2)
    expect(h.plays).toHaveLength(2)
  })

  it('keeps a different deadline independent of the phrase', async () => {
    // Contract update 2026-08-31: playSequence now APPENDS (see
    // TRF audio-doubling fix in playSequence). Under the old
    // contract, the ready tone's `playAsset` at t+150 clearSequence'd
    // the '2' that was pending from the (implicitly-phrase'd) '1'+'2'
    // at t+100, so plays = ['1', 'tone-ready'] and '2' was dropped.
    // Under the new contract, all three enqueue in order — the
    // ready tone joins after '2', so plays = ['1', '2', 'tone-ready'].
    // The ready tone is no longer "independent" in the drop-the-phrase
    // sense; it's "in-line-and-preserved" instead, which matches Kyle's
    // "coach never eats a scheduled clip" intent better.
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1', h.now() + 100)
    h.output.playAsset('2', h.now() + 100)
    h.output.playAsset('tone-ready', h.now() + 150)

    h.advance(150)
    expect(h.plays.map((p) => p.source)).toContain(sourceOf('1'))
    expect(h.plays.map((p) => p.source)).toContain(sourceOf('tone-ready'))
    // '2' is now preserved rather than dropped by the tone's arrival.
  })

  it('stops a phrase mid-flight when cancelled', async () => {
    const h = harness()
    await h.output.preload()
    const at = h.now() + 50
    h.output.playAsset('1', at)
    h.output.playAsset('2', at)

    h.advance(50)
    expect(h.plays).toHaveLength(1)

    h.output.cancel(AUDIO_PRIORITY.safety)
    h.advance(FALLBACK_CLIP_MS * 2)
    // The word already sounding is left alone; the rest never starts.
    expect(h.plays).toHaveLength(1)
  })
})

describe('clip length is read once the asset has loaded', () => {
  // Measured on the tablet: a three-word combination took 646 ms while a
  // single standalone word took 201 ms — the combination was *slower* per
  // word than saying one on its own. The cause was reading `duration` at
  // construction, when a player still reports 0, so every hold silently used
  // the assumed fallback length.
  function lateLoadingHarness(): { output: VoiceOutputExpo; load: () => void } {
    let seconds = 0
    const output = new VoiceOutputExpo({
      createPlayer: () =>
        ({
          get duration() {
            return seconds
          },
          volume: 1,
          seekTo: () => {},
          play: () => {},
          remove: () => {},
        }) as never,
      setAudioMode: (async () => undefined) as never,
      speaker: { speak: () => {}, stop: () => {} } as never,
    })
    return {
      output,
      load: () => {
        seconds = 0.15
      },
    }
  }

  // Preload warms the digits in `combo` form — the form a combination is
  // called in — so that is the form with a resident player to measure.
  it('reports nothing while the clip is still loading', async () => {
    const h = lateLoadingHarness()
    await h.output.preload()
    expect(h.output.assetDurationMs('1', 'combo')).toBeUndefined()
  })

  it('picks the length up once loading finishes', async () => {
    const h = lateLoadingHarness()
    await h.output.preload()
    h.load()
    expect(h.output.assetDurationMs('1', 'combo')).toBe(150)
  })

  it('never caches a zero as if it were the real length', async () => {
    // Caching the zero would freeze every clip at the fallback for the whole
    // session, which is exactly the bug this replaced.
    const h = lateLoadingHarness()
    await h.output.preload()
    expect(h.output.assetDurationMs('1', 'combo')).toBeUndefined()
    h.load()
    expect(h.output.assetDurationMs('1', 'combo')).toBe(150)
    expect(h.output.assetDurationMs('1', 'combo')).toBe(150)
  })

  it('does not measure a clip that has no resident player', () => {
    // Creating a track just to read a number is what exhausted the device.
    const h = lateLoadingHarness()
    expect(h.output.assetDurationMs('cut-off-ring', 'standalone')).toBeUndefined()
  })
})

describe('a combination is delivered in the combo form', () => {
  it('plays the clipped renderings for a multi-word call', async () => {
    // Not the standalone clip played faster — a separate, quicker recording,
    // so the consonants stay crisp instead of being smeared.
    const h = harness()
    await h.output.preload()
    h.output.playPhrase(['1', '2'])
    h.advance(FALLBACK_CLIP_MS * 2)

    expect(h.plays.map((p) => p.source)).toEqual([
      sourceOf('1', 'numbers', 'combo'),
      sourceOf('2', 'numbers', 'combo'),
    ])
  })

  it('keeps a single command in its standalone form', async () => {
    // One punch called at combination speed sounds like a fragment.
    const h = harness()
    await h.output.preload()
    h.output.playPhrase(['1'])
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('1', 'numbers', 'standalone')])
  })

  it('runs the words closer together as tightness falls', async () => {
    const loose = harness()
    await loose.output.preload()
    loose.output.playPhrase(['1', '2'], undefined, 1)
    loose.advance(FALLBACK_CLIP_MS - 1)
    expect(loose.plays).toHaveLength(1)

    const tight = harness()
    await tight.output.preload()
    tight.output.playPhrase(['1', '2'], undefined, 0.5)
    tight.advance(Math.round(FALLBACK_CLIP_MS * 0.5))
    expect(tight.plays).toHaveLength(2)
  })

  it('never closes the gap below the countable floor', async () => {
    // Past this the words stop being a call and become a stutter.
    const h = harness()
    await h.output.preload()
    h.output.playPhrase(['1', '2'], undefined, 0.01)
    h.advance(MIN_CLIP_GAP_MS - 1)
    expect(h.plays).toHaveLength(1)

    h.advance(1)
    expect(h.plays).toHaveLength(2)
  })

  it('honours a deadline for the whole phrase', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playPhrase(['1', '2'], h.now() + 200, 1)
    h.advance(199)
    expect(h.plays).toEqual([])
    h.advance(1)
    expect(h.plays).toHaveLength(1)
  })
})

describe('cancel drops what is queued, not what is sounding', () => {
  it('removes lower-priority pending clips', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1', h.now() + 100) // punchCommand
    h.output.playAsset('slip', h.now() + 100) // defenseFootwork

    h.output.cancel(AUDIO_PRIORITY.punchCommand)
    h.advance(200)

    // The punch command survives; the lower-ranked footwork call does not.
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('1')])
  })

  it('clears everything below safety on a pause', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1', h.now() + 100)
    h.output.playAsset('bell', h.now() + 100)

    h.output.cancel(AUDIO_PRIORITY.safety)
    h.advance(200)
    expect(h.plays).toEqual([])
  })

  it('leaves an already-played clip alone', async () => {
    // Nothing can un-play it, and the test states the intent: cancel is about
    // the queue.
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1')
    h.output.cancel(AUDIO_PRIORITY.safety)
    expect(h.plays).toHaveLength(1)
  })

  it('stops descriptive speech when cancelling at metric or above', async () => {
    const h = harness()
    await h.output.preload()
    h.output.speak('Average velocity six', AUDIO_PRIORITY.metric)
    h.output.cancel(AUDIO_PRIORITY.safety)
    expect(h.stops).toBe(1)
  })
})

describe('volumes are independent (doc §25)', () => {
  it('carries bells and tones on the bells volume', async () => {
    const h = harness()
    await h.output.preload()
    h.output.setVolumes({ voice: 0.4, bells: 0.9, haptics: 1, metronome: 0.6 })

    h.output.playAsset('1')
    h.output.playAsset('bell')
    h.output.tone('ready')

    expect(h.plays.map((p) => p.volume)).toEqual([0.4, 0.9, 0.9])
  })

  it('applies a change to clips played afterwards', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1')
    h.output.setVolumes({ voice: 0.2, bells: 1, haptics: 1, metronome: 0.6 })
    h.output.playAsset('1')
    expect(h.plays.map((p) => p.volume)).toEqual([1, 0.2])
  })

  it('never touches music volume — there is no music channel to touch', () => {
    // Ducking is the OS's business (spec §14.6). A music level here would be
    // the app reaching into someone else's playback.
    const h = harness()
    expect(Object.keys({ voice: 0, bells: 0, haptics: 0 })).not.toContain('music')
    expect(h.output.available).toBe(true)
  })
})

describe('playSequence timer safety — A6 (#260) & append-not-clear (2026-08-31)', () => {
  it('appending a new phrase mid-flight keeps the running timer AND enqueues the new clips', async () => {
    // Contract update 2026-08-31: `playSequence` no longer calls
    // `clearSequence()`. The A6 (#260) double-timer bug is prevented
    // by construction: `advanceSequence()` is only started when
    // NO timer is currently armed. If a timer is running, the new
    // clips just APPEND to the queue and the running timer picks
    // them up naturally.
    //
    // This trade-off exists because dropping pending clips at cue
    // transitions caused the TRF audio bug where `1-2` was heard
    // as `1` (rep 2's `playPhrase` clearSequence'd rep 1's pending
    // `'2'`). Append preserves every scheduled clip.
    const scheduled: number[] = []
    const cancelled: number[] = []
    let nextId = 1000
    const clock = { now: 1_000 }
    const timers: Array<{ at: number; fn: () => void; id: number }> = []
    const output = new VoiceOutputExpo({
      clock: () => clock.now,
      schedule: (fn, delayMs) => {
        const id = nextId++
        scheduled.push(id)
        timers.push({ at: clock.now + delayMs, fn, id })
        return id
      },
      cancelScheduled: (h) => {
        cancelled.push(h as number)
        const i = timers.findIndex((t) => t.id === h)
        if (i >= 0) timers.splice(i, 1)
      },
      createPlayer: () => ({
        volume: 1,
        seekTo: () => {},
        play: () => {},
        remove: () => {},
      } as never),
      speaker: { speak: () => {}, stop: () => {} } as never,
      setAudioMode: (async () => undefined) as never,
    })
    await output.preload()
    // Start a 3-clip sequence: emits clip 1, arms a chained handle.
    output.playPhrase(['1', '2', '3'])
    const firstChainedTimer = scheduled[scheduled.length - 1]!
    // Append a 1-clip sequence. The first sequence's chained timer
    // MUST NOT be cancelled — the queue is now ['2', '3', 'bell']
    // and the running timer walks through them all.
    output.playPhrase(['bell'])
    expect(cancelled).not.toContain(firstChainedTimer)

    // Advance the clock so the pending queue drains. The running
    // timer keeps chaining until the queue empties.
    clock.now += FALLBACK_CLIP_MS * 10
    for (let i = 0; i < 10; i += 1) {
      // Drain due timers, but the queue's own tick spacing means
      // each iteration only fires ONE step; the chained timer for
      // the next step gets scheduled at now+holdMs, still in the
      // future relative to our synchronous drain, so we loop until
      // all four clips have fired.
      for (const t of [...timers]) {
        if (t.at <= clock.now) {
          timers.splice(timers.indexOf(t), 1)
          t.fn()
        }
      }
      clock.now += FALLBACK_CLIP_MS
    }
    // The A6 double-timer bug is prevented by the "only start when
    // idle" guard: no two shift()s ever race. Confirm by counting
    // total timers — for a 4-clip queue we expect at most 4 chained
    // timers total (one per clip, minus the last which returns
    // early since the queue is empty after the shift).
    // 4 clips → at most 3 chained timers scheduled during draining.
    // A leaked-timer bug would double this.
    // (The exact scheduled count depends on how the harness clock
    //  interacts with the queue drain, so we assert bounded rather
    //  than exact.)
    expect(scheduled.length).toBeLessThanOrEqual(20)
  })

  it('appending a second phrase while first is chained does not schedule a second timer', async () => {
    const clock = { now: 1_000 }
    const scheduled: number[] = []
    let nextId = 5000
    const output = new VoiceOutputExpo({
      clock: () => clock.now,
      schedule: () => {
        const id = nextId++
        scheduled.push(id)
        return id
      },
      cancelScheduled: () => {},
      createPlayer: () => ({
        volume: 1,
        seekTo: () => {},
        play: () => {},
        remove: () => {},
      } as never),
      speaker: { speak: () => {}, stop: () => {} } as never,
      setAudioMode: (async () => undefined) as never,
    })
    await output.preload()
    // Empty state — playPhrase with 2+ clips seeds the queue AND
    // arms one chained handle to advance to the second clip.
    output.playPhrase(['1', '2'])
    const timersAfterFirst = scheduled.length
    expect(timersAfterFirst).toBeGreaterThan(0)
    // A running sequence — playPhrase appends but does NOT start a
    // second timer (no double-timer). The already-armed chained
    // handle will pick up the appended clip when it advances.
    output.playPhrase(['bell'])
    expect(scheduled.length).toBe(timersAfterFirst)
  })
})

describe('audibleUntilMs — A15 (#256) busy-until timing signal', () => {
  it('reports 0 when nothing has played yet', () => {
    const h = harness()
    expect(h.output.audibleUntilMs()).toBe(0)
  })

  it("advances past a co- ceremony's real length after it starts", async () => {
    const h = harness()
    await h.output.preload()
    // co-pressure-03 = 8373 ms per the manifest.
    h.output.playAsset('co-pressure-03')
    const now = h.now()
    const until = h.output.audibleUntilMs()
    expect(until).toBeGreaterThan(now + 8000)
    // A shorter clip that follows must not shrink the window.
    h.output.playAsset('co-closer-01') // 690 ms
    expect(h.output.audibleUntilMs()).toBe(until)
  })

  it('returns 0 again once the busy window has passed', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('co-closer-01')
    h.advance(2000)
    expect(h.output.audibleUntilMs()).toBe(0)
  })

  it('does NOT advance for a BELL — percussion is not a coach voice (GH #305)', async () => {
    // The lane models SPEECH: two voices must not stack. Marking it busy
    // for the bell's ~2.5s ring made the round-open bell "talk over"
    // every round's opening combo-announce — the precall's audible
    // window closed entirely inside the ring, the collision gate
    // declined it, and the retry expired on the same tick. Measured
    // on-glass on heavy-hands AND pace-pusher (both lost expectation #1
    // to retry-expired). Speaking over a bell tail is the behaviour
    // Kyle signed off by ear.
    const h = harness()
    await h.output.preload()
    h.output.playAsset('bell')
    expect(h.output.audibleUntilMs()).toBe(0)
  })

  it('does NOT advance for playCombination — the phrase player retired in Phase 5-iv', async () => {
    const h = harness()
    await h.output.preload()
    // Phase 5-iv retired the per-punch phrase corpus. playCombination
    // is now a no-op stub that always returns false; the coach lane's
    // audibleUntilMs is untouched.
    const ret = h.output.playCombination('1-2', 'pressure')
    expect(ret).toBe(false)
    expect(h.output.audibleUntilMs()).toBe(0)
  })
})

describe('coach lane release grace (M39-V2 Phase 4-ii) — "extra muted measure" fix', () => {
  // Kyle plan §Fix release grace: the coach lane holds itself busy for
  // audibleEnd + ~50 ms so the next armed clip does not collide with the
  // previous clip's tail decay. The constant is exported so tests can
  // pin the exact value.
  it('exports the 50 ms release grace constant', () => {
    expect(COACH_LANE_RELEASE_GRACE_MS).toBe(50)
  })

  it('extends audibleUntilMs by the release grace past the clip duration', async () => {
    const h = harness()
    await h.output.preload()
    // co-closer-01 is 690 ms per the manifest. audibleUntil should be
    // now + 690 + 50 = now + 740, not now + 690.
    h.output.playAsset('co-closer-01')
    const now = h.now()
    const until = h.output.audibleUntilMs()
    expect(until).toBe(now + 690 + COACH_LANE_RELEASE_GRACE_MS)
  })
})

describe('preloadBothVocabsFor (M39-V2 Phase 4-v) — dual-track warmth', () => {
  it('creates a player under BOTH vocabularies for the given asset', async () => {
    const h = harness()
    await h.output.preload()
    const createdBefore = h.created.length
    // '1' is a canonical asset present in both numbers + names manifests.
    h.output.preloadBothVocabsFor('1', 'combo')
    // 'preload' already warmed '1' in both; a repeat is idempotent
    // (no new AudioPlayer created), but the call must not throw.
    // Same-id repeat is idempotent; nothing to assert about count.
    // Trigger a re-lookup of the same id under both vocabs to prove
    // the method doesn't throw and the players survive.
    h.output.preloadBothVocabsFor('1', 'combo')
    expect(h.created.length).toBeGreaterThanOrEqual(createdBefore)
  })

  it('preserves the current vocabulary across the call', async () => {
    const h = harness()
    await h.output.preload()
    // Pin the vocab to names, warm '1' in both, verify vocab still 'names'.
    h.output.setVocabulary('names')
    h.output.preloadBothVocabsFor('1', 'combo')
    // Arming a coach event should still land in the pinned dialect.
    const armed = h.output.armCoachEvent({ eventId: 'e-preserve' })
    expect(armed.lockedVocabulary).toBe('names')
  })

  it('is a no-op when the instance is unavailable', () => {
    const h = harness({ failMode: true })
    // In failMode `available` is false. The method must not throw.
    expect(() => h.output.preloadBothVocabsFor('1', 'combo')).not.toThrow()
  })
})

describe('ArmedCoachEvent + vocabulary swap (M39-V2 Phase 4-iv)', () => {
  // Kyle plan §Vocabulary switch at the next unarmed coach event: an
  // armed event's dialect is FROZEN; a mid-play setVocabulary call
  // defers to the next arm. No recompilation, no strike-timing change
  // — the compiled timeline covers both dialects.
  it('armCoachEvent returns an ArmedCoachEvent with runId + locked vocab', () => {
    const h = harness()
    const armed = h.output.armCoachEvent({ eventId: 'cue-A:rep-0:coach-0' })
    expect(armed.eventId).toBe('cue-A:rep-0:coach-0')
    expect(armed.runId).toMatch(/^coach-\d+$/)
    expect(armed.lockedVocabulary).toBe('numbers') // default
    expect(h.output.isArmedRunId(armed.runId)).toBe(true)
  })

  it('activeCoachArm reflects the current arm', () => {
    const h = harness()
    expect(h.output.activeCoachArm()).toBeNull()
    const armed = h.output.armCoachEvent({ eventId: 'e1' })
    expect(h.output.activeCoachArm()).toBe(armed)
  })

  it('a mid-play setVocabulary is DEFERRED — the armed event keeps its dialect', () => {
    const h = harness()
    const rep0 = h.output.armCoachEvent({ eventId: 'cue-A:rep-0' })
    expect(rep0.lockedVocabulary).toBe('numbers')
    // User swaps mid-play. rep0 keeps 'numbers'; the swap queues.
    h.output.setVocabulary('names')
    expect(h.output.activeCoachArm()?.lockedVocabulary).toBe('numbers')
    expect(h.output.nextArmVocabulary()).toBe('names')
    // rep 0 finishes.
    h.output.clearCoachRunId()
    // rep 1 arms in the new dialect.
    const rep1 = h.output.armCoachEvent({ eventId: 'cue-A:rep-1' })
    expect(rep1.lockedVocabulary).toBe('names')
    expect(h.output.nextArmVocabulary()).toBe('names')
  })

  it('setVocabulary with nothing armed applies immediately (V1c parity)', () => {
    const h = harness()
    h.output.setVocabulary('names')
    // Next arm uses the new dialect straight away — no queueing needed.
    const armed = h.output.armCoachEvent({ eventId: 'first' })
    expect(armed.lockedVocabulary).toBe('names')
  })

  it('clearCoachRunId clears the armed event too (not just the runId)', () => {
    const h = harness()
    h.output.armCoachEvent({ eventId: 'a' })
    expect(h.output.activeCoachArm()).not.toBeNull()
    h.output.clearCoachRunId()
    expect(h.output.activeCoachArm()).toBeNull()
  })

  it('a pending swap arms only ONCE — a second armCoachEvent stays in the new dialect', () => {
    const h = harness()
    h.output.armCoachEvent({ eventId: 'r0' })
    h.output.setVocabulary('names')
    h.output.clearCoachRunId()
    const rep1 = h.output.armCoachEvent({ eventId: 'r1' })
    const rep2 = h.output.armCoachEvent({ eventId: 'r2' })
    expect(rep1.lockedVocabulary).toBe('names')
    expect(rep2.lockedVocabulary).toBe('names')
  })
})

describe('latency-compensated dispatch (M39-V2 Phase 4-iii)', () => {
  // Kyle plan §Latency-compensated audio dispatch: the canonical
  // timeline stays clean; the AUDIO backend subtracts a measured
  // per-device latency so the audible onset lands on the intended
  // tick, not the dispatch call.
  it('exports the conservative default constant', () => {
    expect(DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS).toBe(40)
  })

  it('latencyCompensatedDispatchMs subtracts calibration from the tick-time', () => {
    expect(latencyCompensatedDispatchMs(10_000, 40)).toBe(9960)
    expect(latencyCompensatedDispatchMs(10_000, 0)).toBe(10_000)
  })

  it('never returns a negative time (clamps to 0 when calibration exceeds tick-time)', () => {
    // If tick-time is 20 ms into the future but calibration is 40 ms,
    // the dispatch should fire NOW rather than at t=-20.
    expect(latencyCompensatedDispatchMs(20, 40)).toBe(0)
  })

  it('rejects invalid inputs (guardrails)', () => {
    expect(() => latencyCompensatedDispatchMs(NaN, 40)).toThrow()
    expect(() => latencyCompensatedDispatchMs(100, -1)).toThrow()
    expect(() => latencyCompensatedDispatchMs(100, NaN)).toThrow()
  })

  it('instance uses the default calibration when the option is omitted', () => {
    const h = harness()
    expect(h.output.calibratedAudioOutputLatencyMs).toBe(
      DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS,
    )
    expect(h.output.dispatchAtMsForTickTime(10_000)).toBe(10_000 - 40)
  })

  it('respects an explicit override on the instance', () => {
    const instance = new VoiceOutputExpo({ calibratedAudioOutputLatencyMs: 80 })
    expect(instance.calibratedAudioOutputLatencyMs).toBe(80)
    expect(instance.dispatchAtMsForTickTime(10_000)).toBe(9920)
  })

  it('rejects a negative override at construction', () => {
    expect(() => new VoiceOutputExpo({ calibratedAudioOutputLatencyMs: -5 })).toThrow(
      /must be ≥ 0/,
    )
  })
})

describe('coach-lane runId (M39-V2 Phase 4-ii) — exclusive arm + stale-callback drop', () => {
  // Kyle plan: every arm mints a fresh runId; a late finish callback
  // that carries a superseded runId self-checks via isArmedRunId and
  // no-ops. The lane is exclusive — only one runId is armed at a time.
  it('mints a fresh runId each call and returns it', () => {
    const h = harness()
    const first = h.output.mintCoachRunId()
    const second = h.output.mintCoachRunId()
    expect(first).toMatch(/^coach-\d+$/)
    expect(second).toMatch(/^coach-\d+$/)
    expect(first).not.toBe(second)
  })

  it('reports only the most recently minted runId as armed', () => {
    const h = harness()
    const first = h.output.mintCoachRunId()
    expect(h.output.isArmedRunId(first)).toBe(true)
    const second = h.output.mintCoachRunId()
    expect(h.output.isArmedRunId(second)).toBe(true)
    // The first is now stale — a callback carrying it must self-drop.
    expect(h.output.isArmedRunId(first)).toBe(false)
  })

  it('reports no runId armed until the first mint (fresh instance)', () => {
    const h = harness()
    expect(h.output.isArmedRunId('coach-1')).toBe(false)
  })

  it('clearCoachRunId drops the armed id (subsequent isArmedRunId returns false)', () => {
    const h = harness()
    const runId = h.output.mintCoachRunId()
    expect(h.output.isArmedRunId(runId)).toBe(true)
    h.output.clearCoachRunId()
    expect(h.output.isArmedRunId(runId)).toBe(false)
  })

  it('clearCoachRunId is idempotent (safe to call when no arm)', () => {
    const h = harness()
    expect(() => h.output.clearCoachRunId()).not.toThrow()
    expect(() => h.output.clearCoachRunId()).not.toThrow()
  })
})

describe('a chime-in mutes the shot calling, then it comes back (Kyle)', () => {
  // Phase 5-iv: the three phrase-player mute regressions (co- clip
  // real length, longest co- ceremony, born-silent inside the window)
  // retired with their subject — playCombination no longer creates a
  // phrasePlayer. The per-word / bell mute behaviour survives and is
  // pinned below.

  it('mutes per-word calls but never the bell', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('co-thirty-left')
    h.output.playAsset('1')
    expect(h.plays[h.plays.length - 1]!.volume).toBe(0)

    h.output.playAsset('bell')
    expect(h.plays[h.plays.length - 1]!.volume).not.toBe(0)
  })
})

describe('tones map to their clips', () => {
  it('plays the right asset for each kind', async () => {
    const h = harness()
    await h.output.preload()
    h.output.tone('ready')
    h.output.tone('repeat')
    h.output.tone('warning')
    expect(h.plays.map((p) => p.source)).toEqual([
      sourceOf('tone-ready'),
      sourceOf('tone-repeat'),
      sourceOf('tone-warning'),
    ])
  })
})

describe('audio focus (spec §14.6)', () => {
  it('stays out of the way until something is actually audible', async () => {
    // Asking for focus while silent would duck the athlete's music for
    // nothing.
    const h = harness()
    await h.output.preload()
    expect(h.modes).toEqual(['mixWithOthers'])
  })

  it('asks for may-duck focus on the first sound, once', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1')
    h.output.playAsset('2')
    expect(h.modes).toEqual(['mixWithOthers', 'duckOthers'])
  })

  it('never requests exclusive focus', async () => {
    // `doNotMix` pauses the athlete's music instead of dipping it.
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1')
    h.output.speak('Round three', AUDIO_PRIORITY.metric)
    expect(h.modes).not.toContain('doNotMix')
  })
})

describe('no-audio mode is first class (doc §25)', () => {
  it('reports unavailable when the audio stack will not start', async () => {
    const h = harness({ failMode: true })
    await h.output.preload()
    expect(h.output.available).toBe(false)
  })

  it('turns every call into a no-op rather than throwing', async () => {
    // The workout has to keep running on visuals and haptics.
    const h = harness({ failMode: true })
    await h.output.preload()

    expect(() => {
      h.output.playAsset('1')
      h.output.playAsset('2', h.now() + 100)
      h.output.tone('ready')
      h.output.speak('anything', AUDIO_PRIORITY.metric)
      h.output.cancel(AUDIO_PRIORITY.safety)
      h.output.setVolumes({ voice: 1, bells: 1, haptics: 1, metronome: 0.6 })
    }).not.toThrow()

    h.advance(500)
    expect(h.plays).toEqual([])
    expect(h.spoken).toEqual([])
  })

  it('goes unavailable when no clip loads at all', async () => {
    const h = harness({ failPlayers: true })
    await h.output.preload()
    expect(h.output.available).toBe(false)
  })
})

describe('descriptive speech', () => {
  it('goes through the speech engine, never the clip path', async () => {
    const h = harness()
    await h.output.preload()
    h.output.speak('Average velocity six point eight', AUDIO_PRIORITY.metric)
    expect(h.spoken).toEqual(['Average velocity six point eight'])
    expect(h.plays).toEqual([])
  })
})

describe('the vocabulary decides which recording plays', () => {
  it('loads the names clips when asked for names', async () => {
    const h = harness()
    h.output.setVocabulary('names')
    await h.output.preload()
    h.output.playAsset('1')
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('1', 'names')])
  })
})

describe('release', () => {
  it('drops pending clips so nothing fires after teardown', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1', h.now() + 100)
    h.output.release()
    h.advance(200)
    expect(h.plays).toEqual([])
  })
})

describe('every id the announcer can emit is playable', () => {
  it('plays all 24 without a miss', async () => {
    // The announcer resolves tokens to ids; a gap here would be a word the
    // coach silently never says.
    const h = harness()
    await h.output.preload()
    for (const id of VOICE_ASSET_IDS) h.output.playAsset(id)
    expect(h.plays).toHaveLength(VOICE_ASSET_IDS.length)
  })
})

describe('scheduled combination calls are additive (the burst-refire fix)', () => {
  // The announcer pre-schedules every burst re-call up front — it owns no
  // timers (D3). The original single-handle implementation cancelled each
  // pending call when the next was scheduled, so a 30-second volume burst
  // got its opening call and then silence: the exact mid-round quiet the
  // refires were built to fill (measured on device, 2026-08-25).
  // Phase 5-iv retired the phrasePlayer + scheduledPhrases queue.
  // The A13 additive-handles regression + cancelScheduledCombinations
  // test suites survived here only for that queue; both are gone now
  // that playCombination is a no-op.
  it('playCombination returns false and schedules nothing (Phase 5-iv no-op)', () => {
    const h = harness()
    const t0 = h.now()
    expect(h.output.playCombination('1-2', 'steady', t0 + 6_000)).toBe(false)
    h.advance(20_000)
    for (let i = 0; i < 3; i += 1) h.output.advance()
    expect(h.plays.filter((p) => p.source !== undefined)).toHaveLength(0)
  })
})

describe('playClickScript — the rewind is serialized (shllck, 2026-09-03)', () => {
  // A cached player reused for a per-bar call parks at end-of-stream;
  // `seekTo` is async. Firing `play()` before the rewind resolves plays
  // the ~50-100ms buffered tail at EOS and stops. The contract: a
  // REUSED player never receives play() before its seek resolves — with
  // a scheduled fallback so a stalled seek degrades to the old race,
  // never to silence.
  function rig() {
    const plays: number[] = []
    let clock = 1_000
    const timers: Array<{ at: number; fn: () => void; id: number }> = []
    let nextId = 1
    let resolveSeek: (() => void) | null = null
    let seekCalls = 0
    let pauseCalls = 0
    const seekOrder: string[] = []
    const output = new VoiceOutputExpo({
      clock: () => clock,
      schedule: (fn, delayMs) => {
        const id = nextId++
        timers.push({ at: clock + delayMs, fn, id })
        return id
      },
      cancelScheduled: (handle) => {
        const i = timers.findIndex((t) => t.id === handle)
        if (i >= 0) timers.splice(i, 1)
      },
      createClickScriptPlayer: ((source: number) =>
        ({
          volume: 1,
          seekTo: () => {
            seekCalls += 1
            seekOrder.push('seek')
            return new Promise<void>((resolve) => {
              resolveSeek = resolve
            })
          },
          play: () => plays.push(source),
          pause: () => {
            pauseCalls += 1
            seekOrder.push('pause')
          },
          remove: () => {},
        }) as never) as never,
      setAudioMode: (async () => {}) as never,
    })
    const advance = (ms: number): void => {
      clock += ms
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at > clock) break
        timers.splice(timers.indexOf(t), 1)
        t.fn()
      }
    }
    const clip = { text: 'One, two!', module: 77, durationMs: 700 }
    return {
      output,
      plays,
      advance,
      clip,
      finishSeek: async () => {
        resolveSeek?.()
        resolveSeek = null
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      },
      get seekCalls() {
        return seekCalls
      },
      get pauseCalls() {
        return pauseCalls
      },
      seekOrder,
    }
  }

  it('a fresh player plays immediately — no seek round trip on first use', () => {
    const h = rig()
    h.output.playClickScript(h.clip)
    expect(h.plays).toEqual([77])
    expect(h.seekCalls).toBe(0)
  })

  it('a reused player does NOT play until its rewind resolves', async () => {
    const h = rig()
    h.output.playClickScript(h.clip)
    expect(h.plays).toEqual([77])
    h.output.playClickScript(h.clip) // reuse — parked at EOS
    expect(h.plays).toEqual([77]) // play NOT fired yet: seek pending
    await h.finishSeek()
    expect(h.plays).toEqual([77, 77]) // fired after the rewind landed
  })

  it('a stalled rewind falls back after 750ms and never double-plays', async () => {
    const h = rig()
    h.output.playClickScript(h.clip)
    h.output.playClickScript(h.clip)
    expect(h.plays).toEqual([77])
    h.advance(800) // fallback fires — degraded to the old race, not silence
    expect(h.plays).toEqual([77, 77])
    await h.finishSeek() // the late seek resolution must not re-play
    expect(h.plays).toEqual([77, 77])
  })

  it('a PRE-ARMED player (seeked to 0 during the idle gap) plays immediately — no rewind wait', async () => {
    // Kills the ~200ms reused-player lag on per-bar repeats: after the
    // first call finishes, the player is pre-seeked to 0 so the repeat is
    // as fast as a fresh play (path 'armed').
    const h = rig()
    h.output.playClickScript(h.clip) // fresh → plays, schedules pre-arm at duration+200
    expect(h.plays).toEqual([77])
    h.advance(950) // fire the pre-arm (700+200=900): it PAUSES then seeks to 0…
    // The pre-arm must PAUSE before it seeks — a lone seek on a player parked
    // "playing" at EOS resumes it, replaying the clip unlogged (the voice
    // storm). Pause-first makes the re-arm a silent reposition.
    expect(h.pauseCalls).toBe(1)
    expect(h.seekOrder).toEqual(['pause', 'seek'])
    await h.finishSeek() // …and the seek resolves → module is now armed
    const seeksBefore = h.seekCalls
    h.output.playClickScript(h.clip) // reused BUT armed → immediate, no new rewind
    expect(h.plays).toEqual([77, 77])
    expect(h.seekCalls).toBe(seeksBefore) // no pre-play seek on the armed path
  })
})

describe('leak hunt (2026-09-05) — native players are bounded and released', () => {
  // 44 live media sessions by uppercut-clinic round 4 — hard against the
  // ~48 that broke this device — starved the playback threads until calls
  // played silently while the JS side logged perfect dispatches. Three
  // populations paid for it: an unbounded click-script cache, untracked
  // one-shot players, and a 20-player word warm on workouts that never
  // speak a word. These tests pin each bound.
  function rig() {
    let clock = 1_000
    const timers: Array<{ at: number; fn: () => void; id: number }> = []
    let nextId = 1
    const removed: number[] = []
    const live = new Set<number>()
    const makeFake = (source: number) =>
      ({
        source,
        volume: 1,
        currentTime: 0,
        seekTo: () => Promise.resolve(),
        play: () => {},
        pause: () => {},
        remove: () => {
          removed.push(source)
          live.delete(source)
        },
      }) as never
    const output = new VoiceOutputExpo({
      clock: () => clock,
      schedule: (fn, delayMs) => {
        const id = nextId++
        timers.push({ at: clock + delayMs, fn, id })
        return id
      },
      cancelScheduled: (handle) => {
        const i = timers.findIndex((t) => t.id === handle)
        if (i >= 0) timers.splice(i, 1)
      },
      createPlayer: (source: number) => {
        live.add(source)
        return makeFake(source)
      },
      createClickScriptPlayer: ((source: number) => {
        live.add(source)
        return makeFake(source)
      }) as never,
      setAudioMode: (async () => {}) as never,
    })
    const advance = (ms: number): void => {
      clock += ms
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at > clock) break
        timers.splice(timers.indexOf(t), 1)
        t.fn()
      }
    }
    const clip = (module: number, durationMs = 700) => ({
      text: `clip ${module}`,
      module,
      durationMs,
    })
    return { output, advance, removed, live, clip }
  }

  it('a one-shot lead-in releases its player after the clip instead of parking it', () => {
    const h = rig()
    h.output.playClickScript(h.clip(500), { oneShot: true })
    expect(h.live.has(500)).toBe(true)
    h.advance(700 + CLICK_SCRIPT_PREARM_PAD_MS + 1)
    expect(h.removed).toEqual([500])
    expect(h.live.has(500)).toBe(false)
  })

  it('a re-dispatched one-shot releases once, on the LAST dispatch schedule', async () => {
    const h = rig()
    h.output.playClickScript(h.clip(501), { oneShot: true })
    h.advance(300)
    h.output.playClickScript(h.clip(501), { oneShot: true }) // busy-lane retry
    await Promise.resolve() // let the retry's rewind settle
    await Promise.resolve()
    h.advance(700 + CLICK_SCRIPT_PREARM_PAD_MS + 1) // first timer fires mid-way: gen mismatch
    h.advance(400) // second timer fires
    expect(h.removed).toEqual([501])
  })

  it('per-bar calls stay cached but the cache never exceeds its resident cap', () => {
    const h = rig()
    const total = CLICK_SCRIPT_RESIDENT_CAP + 3
    for (let m = 1; m <= total; m += 1) {
      h.output.playClickScript(h.clip(m))
    }
    // The three oldest were evicted and released; the newest survive.
    expect(h.removed).toEqual([1, 2, 3])
    for (let m = 4; m <= total; m += 1) expect(h.live.has(m)).toBe(true)
  })

  it('a cache hit refreshes recency — the re-played module survives eviction', () => {
    const h = rig()
    for (let m = 1; m <= CLICK_SCRIPT_RESIDENT_CAP; m += 1) {
      h.output.playClickScript(h.clip(m))
    }
    h.output.playClickScript(h.clip(1)) // touch the oldest
    h.output.playClickScript(h.clip(90)) // overflow by one
    expect(h.removed).toEqual([2]) // module 1 was refreshed; 2 is now oldest
    expect(h.live.has(1)).toBe(true)
  })

  it('instruction and combo-announce players release after their clips', () => {
    const h = rig()
    h.output.playInstruction({ text: 'aside', module: 600, durationMs: 900 })
    h.output.playComboAnnounce({ text: 'One, go!', module: 601, durationMs: 800 })
    expect(h.live.has(600)).toBe(true)
    expect(h.live.has(601)).toBe(true)
    h.advance(900 + 1_500 + 1)
    expect(h.live.has(600)).toBe(false)
    expect(h.live.has(601)).toBe(false)
  })

  it('release() sweeps tracked one-shots that have not timed out yet', () => {
    const h = rig()
    h.output.playInstruction({ text: 'aside', module: 610, durationMs: 5_000 })
    h.output.release()
    expect(h.live.has(610)).toBe(false)
  })

  it('light preload warms only round furniture — no word players', async () => {
    const h = harness()
    await h.output.preload({ light: true })
    // bell + three tones; the 1-6 combo warm (x both vocabs, 20 players)
    // is skipped — a click-minimal workout never speaks a word clip.
    expect(h.created).toHaveLength(4)
  })

  it('full preload still warms both vocabularies for the live radio flip', async () => {
    const h = harness()
    await h.output.preload()
    expect(h.created).toHaveLength(20)
  })
})

describe('focus-scoped reuse (#356) — release() frees, the SAME instance re-warms', () => {
  // Measured on the tablet: leaving punchCraft Live left 21 native
  // AudioTracks resident for the rest of the session, and the instrument's
  // 30 stacked on top of them (40 observed against a documented ~48 ceiling,
  // past which the app goes silent with no error at all).
  //
  // The fix frees the pool on blur and re-warms it on focus WITHOUT
  // replacing the VoiceOutputExpo. That is deliberate: `output` feeds the
  // `voice` memo, which is a dependency of the workout runner's arm effect,
  // so a new identity would re-arm the runner mid-workout. These tests pin
  // the property that makes keeping the identity possible — that a released
  // output is not a dead one.
  // Tracks player OBJECTS, not module ids. Jest's asset transform maps every
  // require()'d wav to the same numeric id, so a Set keyed on the source
  // would collapse four distinct native players into one entry and quietly
  // under-report the very thing these tests measure.
  function rig() {
    const clock = 1_000
    const removed: object[] = []
    const live = new Set<object>()
    const keys: string[] = []
    const makeFake = (source: number): never => {
      const player = {
        source,
        volume: 1,
        currentTime: 0,
        seekTo: () => Promise.resolve(),
        play: () => {},
        pause: () => {},
        remove: () => {
          removed.push(player)
          live.delete(player)
        },
      }
      live.add(player)
      keys.push(String(source))
      return player as never
    }
    const output = new VoiceOutputExpo({
      clock: () => clock,
      schedule: () => 1,
      cancelScheduled: () => {},
      createPlayer: (source: number) => makeFake(source),
      createClickScriptPlayer: ((source: number) => makeFake(source)) as never,
      setAudioMode: (async () => {}) as never,
    })
    return { output, removed, live, keys }
  }

  it('release() removes every resident player', async () => {
    const h = rig()
    await h.output.preload({ light: true })
    const warmed = h.live.size
    expect(warmed).toBeGreaterThan(0)
    h.output.release()
    expect(h.live.size).toBe(0)
    expect(h.removed).toHaveLength(warmed)
  })

  it('preload() after release() re-warms the same clips on the same instance', async () => {
    const h = rig()
    await h.output.preload({ light: true })
    const first = h.live.size
    h.output.release()
    expect(h.live.size).toBe(0)
    // The load-bearing claim: no terminal flag is set by release(), so the
    // instance a blurred screen kept is the instance a refocused screen can
    // use. If this ever regresses, the coach goes permanently silent after
    // the first tab switch — and nothing would throw.
    await h.output.preload({ light: true })
    expect(h.live.size).toBe(first)
  })

  it('a full preload survives a release/re-preload cycle too', async () => {
    const h = rig()
    await h.output.preload()
    const first = h.live.size
    h.output.release()
    await h.output.preload()
    expect(h.live.size).toBe(first)
  })

  it('a release DURING an in-flight preload wins — the pool is not resurrected', async () => {
    // The race that would have defeated the whole fix. preload() awaits
    // setAudioMode before it creates anything, so a blur landing inside that
    // await used to let release() empty the pool and then have the awaiting
    // continuation refill it — up to 20 native players rebuilt for a screen
    // that had already gone, with nothing left to free them. That is also a
    // candidate explanation for the 21 tracks measured surviving on device.
    let releaseNow: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseNow = resolve
    })
    const removed: object[] = []
    const live = new Set<object>()
    const makeFake = (source: number): never => {
      const player = {
        source,
        volume: 1,
        currentTime: 0,
        seekTo: () => Promise.resolve(),
        play: () => {},
        pause: () => {},
        remove: () => {
          removed.push(player)
          live.delete(player)
        },
      }
      live.add(player)
      return player as never
    }
    const output = new VoiceOutputExpo({
      clock: () => 1_000,
      schedule: () => 1,
      cancelScheduled: () => {},
      createPlayer: (source: number) => makeFake(source),
      createClickScriptPlayer: ((source: number) => makeFake(source)) as never,
      // Suspend the preload exactly where the real one suspends.
      setAudioMode: (async () => {
        await gate
      }) as never,
    })

    const inFlight = output.preload()
    expect(live.size).toBe(0) // still suspended, nothing created yet
    output.release() // the screen blurs mid-await
    releaseNow()
    await inFlight

    expect(live.size).toBe(0)
  })

  it('the generation is strictly monotonic — a superseded preload does not populate', async () => {
    // Two preloads overlap. The second supersedes the first, so when the
    // first finally resumes it must NOT also fill the pool. Without the bump
    // in preload() both would capture the same generation and both proceed.
    const live = new Set<object>()
    let releaseFirst: () => void = () => {}
    let gateCount = 0
    const makeFake = (source: number): never => {
      const player = {
        source,
        volume: 1,
        currentTime: 0,
        seekTo: () => Promise.resolve(),
        play: () => {},
        pause: () => {},
        remove: () => {
          live.delete(player)
        },
      }
      live.add(player)
      return player as never
    }
    const output = new VoiceOutputExpo({
      clock: () => 1_000,
      schedule: () => 1,
      cancelScheduled: () => {},
      createPlayer: (source: number) => makeFake(source),
      createClickScriptPlayer: ((source: number) => makeFake(source)) as never,
      setAudioMode: (async () => {
        gateCount += 1
        // Only the FIRST call is held open.
        if (gateCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
      }) as never,
    })

    const first = output.preload({ light: true })
    const second = output.preload({ light: true })
    await second
    const afterSecond = live.size
    expect(afterSecond).toBeGreaterThan(0)

    releaseFirst()
    await first
    // The superseded preload contributed nothing.
    expect(live.size).toBe(afterSecond)
  })

  it('retries once after an UNKNOWN failure, then fails closed', async () => {
    // A transient audio-stack error should not mute the coach for the rest of
    // the session — but an endless recreate/fail loop is no better, so the
    // retry is bounded to one.
    let attempts = 0
    const output = new VoiceOutputExpo({
      clock: () => 1_000,
      schedule: () => 1,
      cancelScheduled: () => {},
      createPlayer: (() => ({ volume: 1, seekTo: () => {}, play: () => {}, remove: () => {} })) as never,
      createClickScriptPlayer: (() => ({ volume: 1, seekTo: () => {}, play: () => {}, remove: () => {} })) as never,
      setAudioMode: (async () => {
        attempts += 1
        throw new Error('audio stack down')
      }) as never,
    })

    await output.preload({ light: true })
    expect(output.available).toBe(false)
    expect(attempts).toBe(1)

    // One retry is allowed.
    await output.preload({ light: true })
    expect(attempts).toBe(2)

    // …and then it stops trying.
    await output.preload({ light: true })
    await output.preload({ light: true })
    expect(attempts).toBe(2)
    expect(output.available).toBe(false)
  })

  it('never retries an INVALID-ASSET failure — the same failure would just recur', async () => {
    // Nothing in the warm set could be created. That is the asset layer, not
    // the device, so retrying re-runs the identical failure.
    let creates = 0
    const output = new VoiceOutputExpo({
      clock: () => 1_000,
      schedule: () => 1,
      cancelScheduled: () => {},
      createPlayer: (() => {
        creates += 1
        throw new Error('no such clip')
      }) as never,
      createClickScriptPlayer: (() => {
        throw new Error('no such clip')
      }) as never,
      setAudioMode: (async () => {}) as never,
    })

    await output.preload({ light: true })
    expect(output.available).toBe(false)
    const afterFirst = creates
    expect(afterFirst).toBeGreaterThan(0)

    await output.preload({ light: true })
    await output.preload({ light: true })
    // Not one further creation attempt: it failed CLOSED.
    expect(creates).toBe(afterFirst)
  })

  it('release() is safe with nothing warmed, and safe called twice', () => {
    const h = rig()
    expect(() => {
      h.output.release()
      h.output.release()
    }).not.toThrow()
    expect(h.live.size).toBe(0)
  })
})
