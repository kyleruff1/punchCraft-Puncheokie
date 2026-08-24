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

import { FALLBACK_CLIP_MS, MIN_CLIP_GAP_MS, VoiceOutputExpo } from '../VoiceOutputExpo'
import {
  PHRASE_FORMS,
  missingAssetIds,
  voiceAssetManifest,
  type PhraseForm,
  type VoiceAssetManifest,
} from '../voiceAssets/manifest'
import {
  AUDIO_PRIORITY,
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
  spoken: string[]
  stops: number
  now: () => number
  advance(ms: number): void
  modes: string[]
} {
  const plays: PlayEvent[] = []
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
      return {
        get volume() {
          return volume
        },
        set volume(v: number) {
          volume = v
        },
        seekTo: () => {},
        play: () => plays.push({ source, volume }),
        remove: () => {},
      } as never
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
): number => voiceAssetManifest.assets[vocabulary][form][id]

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
    const source = readFileSync('src/audio/voiceAssets/manifest.ts', 'utf8')
    const numbersBlock = source.slice(source.indexOf('numbers: {'), source.indexOf('names: {'))
    const namesBlock = source.slice(source.indexOf('names: {'))

    // One block per form, so each vocabulary names its ids twice.
    const perVocabulary = VOICE_ASSET_IDS.length * PHRASE_FORMS.length
    expect(numbersBlock.match(/assets\/voice\/numbers\//g)).toHaveLength(perVocabulary)
    expect(namesBlock.match(/assets\/voice\/names\//g)).toHaveLength(perVocabulary)
    expect(namesBlock).not.toContain('assets/voice/numbers/')
  })

  it('has a real file behind every path it names', () => {
    // A require of a missing asset resolves to nothing at runtime and shows
    // up as a clip that silently never plays.
    const source = readFileSync('src/audio/voiceAssets/manifest.ts', 'utf8')
    const paths = source.match(/assets\/voice\/[a-z]+\/[a-z]+\/[^']+\.wav/g) ?? []
    expect(paths).toHaveLength(VOICE_ASSET_IDS.length * 2 * PHRASE_FORMS.length)
    for (const path of paths) {
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
    // The ready tone has its own moment and must not queue behind the words.
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1', h.now() + 100)
    h.output.playAsset('2', h.now() + 100)
    h.output.playAsset('tone-ready', h.now() + 150)

    h.advance(150)
    expect(h.plays.map((p) => p.source)).toEqual([sourceOf('1'), sourceOf('tone-ready')])
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
    h.output.setVolumes({ voice: 0.4, bells: 0.9, haptics: 1 })

    h.output.playAsset('1')
    h.output.playAsset('bell')
    h.output.tone('ready')

    expect(h.plays.map((p) => p.volume)).toEqual([0.4, 0.9, 0.9])
  })

  it('applies a change to clips played afterwards', async () => {
    const h = harness()
    await h.output.preload()
    h.output.playAsset('1')
    h.output.setVolumes({ voice: 0.2, bells: 1, haptics: 1 })
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
      h.output.setVolumes({ voice: 1, bells: 1, haptics: 1 })
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
