/**
 * Rhythm Map parity harness (M2).
 *
 * The safety net for relocating the announcer's arithmetic: before the
 * executor swap, the compiled map must predict every sound the current
 * event-driven announcer produces — same phrase placements, same refire
 * grid, same ready tones — across the hand-authored samples and seeded
 * generated workouts. Any drift is a compiler bug, caught here rather than
 * on the bag.
 *
 * Per-word calls are the one sanctioned deviation: the map places them at
 * the announce lead while the live path plans word-by-word placement from
 * measured clip lengths at dispatch. The map's time bounds that plan; the
 * test asserts containment rather than equality for those.
 */
import { CueAnnouncer } from '../../coach/CueAnnouncer'
import { defaultVoiceCoachPolicy } from '../../coach/VoiceCoachPolicy'
import type { VoiceOutputPort } from '../../coach/VoiceOutputPort'
import { CueEngine, DEFAULT_LEAD_TIMES } from '../CueEngine'
import { expandTimeline } from '../CueTimeline'
import { compileRoundRhythmMap } from '../RhythmMap'
import { generateWorkout } from '../../workout/generateWorkout'
import { defaultRecipe } from '../../workout/WorkoutRecipe'
import { threeRoundFundamentals } from '../../workout/samples/threeRoundFundamentals'
import { getSampleWorkout } from '../../workout/samples'
import { createFakeClock } from '@testing/fakeClock'

const PHRASE_MS = 1200
const WORD_MS = 400
const durationFor = (combination: string): number | undefined =>
  combination.includes('-') ? PHRASE_MS : undefined

interface Recorded {
  kind: 'phrase' | 'tone' | 'per-word'
  at: number
  detail: string
}

function driveRound(
  workout: Parameters<typeof expandTimeline>[0],
  roundIndex: number,
  mode: 'events' | 'map' = 'events',
) {
  const timeline = expandTimeline(workout, 'orthodox', 100)
  const round = timeline[roundIndex]!
  const clock = createFakeClock()
  const recorded: Recorded[] = []

  const output: VoiceOutputPort = {
    playAsset: (asset, atMs) => {
      if (asset === 'tone-ready') {
        recorded.push({ kind: 'tone', at: atMs ?? clock.now(), detail: 'ready' })
      }
    },
    cancel: () => undefined,
    speak: () => undefined,
    tone: () => undefined,
    setVolumes: () => undefined,
    playPhrase: (assets, startAt) => {
      recorded.push({ kind: 'per-word', at: startAt ?? clock.now(), detail: assets.join('+') })
    },
    playCombination: (combination, _cadence, atMs) => {
      recorded.push({ kind: 'phrase', at: atMs ?? clock.now(), detail: combination })
      return true
    },
    combinationDurationMs: (combination) => durationFor(combination),
    assetDurationMs: () => WORD_MS,
  }

  const announcer = new CueAnnouncer({
    policy: defaultVoiceCoachPolicy(),
    output,
    cadence: 'steady',
    vocabulary: 'numbers',
    delivery: 'call-ahead',
  })

  const engine = new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock })
  engine.subscribe((e) => announcer.onCueEvent(e))
  engine.onSessionPhase({ type: 'work-entered', roundIndex, nowMs: clock.now() })

  const map = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
  if (mode === 'map') announcer.setRound(round, map)

  let at = 0
  while (at < round.workDurationMs) {
    at += 50
    clock.advance(50)
    engine.tick(at)
    if (mode === 'map') announcer.onTick(at, clock.now())
  }

  return { round, recorded, map }
}

function describeParity(name: string, workout: Parameters<typeof expandTimeline>[0]) {
  describe(name, () => {
    it('round 1: every compiled call, refire and tone matches the live announcer', () => {
      const { round, recorded, map } = driveRound(workout, 0)

      const livePhrases = recorded
        .filter((r) => r.kind === 'phrase')
        .map((r) => `${r.detail}@${Math.round(r.at)}`)
        .sort()
      const mapPhrases = map.events
        .filter(
          (e) =>
            (e.kind === 'call' || e.kind === 'refire') &&
            e.payload !== null &&
            'mode' in e.payload &&
            e.payload.mode === 'phrase',
        )
        .map((e) => {
          const payload = e.payload as { combination: string }
          return `${payload.combination}@${Math.round(e.atMs)}`
        })
        .sort()
      expect(mapPhrases).toEqual(livePhrases)

      // Ready tones: identical multisets of times. (The live announcer skips
      // the tone for a cue whose announce never fired — e.g. a cue at the
      // very bell — so compare against the compiled events for cues the
      // engine actually announced.)
      const liveTones = recorded
        .filter((r) => r.kind === 'tone')
        .map((r) => Math.round(r.at))
        .sort((a, b) => a - b)
      const mapTones = map.events
        .filter((e) => e.kind === 'tone')
        .map((e) => Math.round(e.atMs))
        .sort((a, b) => a - b)
      for (const tone of liveTones) {
        expect(mapTones).toContain(tone)
      }

      // Per-word calls: the map bounds the live plan — the live start must
      // sit inside [previewAt, scheduledStart] of the owning cue, and every
      // per-word cue in the map must have produced a live call.
      const perWordCues = map.events.filter(
        (e) => e.kind === 'call' && e.payload !== null && 'mode' in e.payload && e.payload.mode === 'per-word',
      )
      const livePerWord = recorded.filter((r) => r.kind === 'per-word')
      expect(livePerWord.length).toBe(perWordCues.length)
      for (const event of perWordCues) {
        const cue = round.cues.find((c) => c.id === event.cueId)!
        const hit = livePerWord.find((r) => r.at >= cue.previewAt && r.at <= cue.scheduledStartMs)
        expect(hit).toBeDefined()
      }
    })
  })
}

function describeExecutor(name: string, workout: Parameters<typeof expandTimeline>[0]) {
  describe(`${name} (executor mode)`, () => {
    it('dispatches every live map event within a tick of its compiled time', () => {
      const { recorded, map } = driveRound(workout, 0, 'map')

      const mapPhrases = map.events.filter(
        (e) =>
          (e.kind === 'call' || e.kind === 'refire') &&
          e.payload !== null &&
          'mode' in e.payload &&
          e.payload.mode === 'phrase',
      )
      const livePhrases = recorded.filter((r) => r.kind === 'phrase')
      // Every compiled phrase call fires (no cue ends early in an unmatched
      // drive), each within one 50ms tick of its map time.
      expect(livePhrases.length).toBe(mapPhrases.length)
      const sortedLive = [...livePhrases].sort((a, b) => a.at - b.at)
      const sortedMap = [...mapPhrases].sort((a, b) => a.atMs - b.atMs)
      sortedMap.forEach((event, i) => {
        const live = sortedLive[i]!
        expect(live.detail).toBe((event.payload as { combination: string }).combination)
        expect(live.at).toBeGreaterThanOrEqual(event.atMs)
        expect(live.at).toBeLessThanOrEqual(event.atMs + 60)
      })

      const mapTones = map.events.filter((e) => e.kind === 'tone')
      const liveTones = recorded.filter((r) => r.kind === 'tone')
      expect(liveTones.length).toBe(mapTones.length)
    })
  })
}

describeParity('three-round fundamentals', threeRoundFundamentals)
describeExecutor('three-round fundamentals', threeRoundFundamentals)
describeExecutor(
  'generated (seed rhythm-map-parity)',
  generateWorkout({ ...defaultRecipe(), seed: 'rhythm-map-parity' }),
)
describeParity('establish the jab', getSampleWorkout('establish-the-jab-20').workout)
describeParity(
  'generated (seed rhythm-map-parity)',
  generateWorkout({ ...defaultRecipe(), seed: 'rhythm-map-parity' }),
)
describeParity(
  'generated (seed rhythm-map-parity-2, pressure)',
  generateWorkout({ ...defaultRecipe(), seed: 'rhythm-map-parity-2', cadenceProfile: 'pressure' }),
)
