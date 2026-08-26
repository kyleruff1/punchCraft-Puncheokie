/**
 * Mid-round silence regression (found on tape, 2026-08-25).
 *
 * A live workout recorded through the room mic showed the coach going quiet
 * for 24-33 seconds at a stretch mid-round. The playback log narrowed it to
 * volume-burst blocks: announced once at their head, then nothing for the
 * whole window. The engine + announcer were innocent — this integration
 * drive proves they emit re-calls throughout every burst — and the actual
 * loss was VoiceOutputExpo's single pending-phrase handle (see its own
 * regression test). This test pins the domain half: for the real
 * Three-Round Fundamentals timeline, every burst window in round 1 must
 * receive periodic combination calls, not just its opener.
 */
import { CueAnnouncer } from '../../coach/CueAnnouncer'
import { defaultVoiceCoachPolicy } from '../../coach/VoiceCoachPolicy'
import type { VoiceOutputPort } from '../../coach/VoiceOutputPort'
import { CueEngine, DEFAULT_LEAD_TIMES } from '../CueEngine'
import { expandTimeline } from '../CueTimeline'
import { threeRoundFundamentals } from '../../workout/samples/threeRoundFundamentals'
import { createFakeClock } from '@testing/fakeClock'

describe('burst blocks keep the coach speaking (mid-round silence regression)', () => {
  it('re-calls the motif inside every round-1 burst window', () => {
    const timeline = expandTimeline(threeRoundFundamentals, 'orthodox', 100)
    const round = timeline[0]!
    const bursts = round.cues.filter((c) => c.scoring === 'count')
    expect(bursts.length).toBeGreaterThan(0)

    const clock = createFakeClock()
    const phraseCalls: Array<{ at: number; combination: string }> = []
    const output: VoiceOutputPort = {
      playAsset: () => undefined,
      cancel: () => undefined,
      speak: () => undefined,
      tone: () => undefined,
      setVolumes: () => undefined,
      playCombination: (combination, _cadence, atMs) => {
        phraseCalls.push({ at: atMs ?? clock.now(), combination })
        return true
      },
      combinationDurationMs: () => 1200,
      assetDurationMs: () => 400,
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
    engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: clock.now() })

    let at = 0
    while (at < round.workDurationMs) {
      at += 50
      clock.advance(50)
      engine.tick(at)
    }

    for (const burst of bursts) {
      // Calls strictly inside the window, past the opener: the refires.
      const inside = phraseCalls.filter(
        (c) => c.at > burst.scheduledStartMs + 1_000 && c.at < burst.windowEndMs - 1_000,
      )
      expect(inside.length).toBeGreaterThanOrEqual(
        Math.floor((burst.windowEndMs - burst.scheduledStartMs) / 10_000),
      )
      // And no re-call may be silent for longer than ~8s inside the window.
      const times = [burst.scheduledStartMs, ...inside.map((c) => c.at)].sort((a, b) => a - b)
      for (let i = 1; i < times.length; i += 1) {
        expect(times[i]! - times[i - 1]!).toBeLessThanOrEqual(8_000)
      }
    }
  })
})
