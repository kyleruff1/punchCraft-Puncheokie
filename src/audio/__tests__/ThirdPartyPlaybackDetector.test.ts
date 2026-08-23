/**
 * Playback detection (M34-05, D1).
 *
 * The point of this suite is the distinction the D1 gate depends on: *no
 * playback* and *cannot tell* are different answers, and a detector that
 * blurs them would let the coach talk over someone's music while looking
 * correct.
 */
import {
  PLAYBACK_DETECTION_UNAVAILABLE_NOTICE,
  StaticPlaybackDetector,
  UnavailablePlaybackDetector,
  createPlaybackDetector,
} from '../ThirdPartyPlaybackDetector'
import { defaultVoiceCoachPolicy, voiceAllowed } from '@domain/coach/VoiceCoachPolicy'

// ---------------------------------------------------------------------------

describe('a detector that cannot detect says so', () => {
  it('reports unavailable', async () => {
    const detector = new UnavailablePlaybackDetector()
    expect(detector.available).toBe(false)
  })

  it('returns false, which callers must not read as "nothing is playing"', async () => {
    // It returns false because it has nothing to report, not because it
    // looked. `available` is what tells them apart.
    const detector = new UnavailablePlaybackDetector()
    expect(await detector.isActive()).toBe(false)
    expect(detector.available).toBe(false)
  })

  it('never fires a subscriber', () => {
    const detector = new UnavailablePlaybackDetector()
    const seen: boolean[] = []
    const off = detector.subscribe((a) => seen.push(a))
    off()
    expect(seen).toEqual([])
  })

  it('is what the app builds today', () => {
    // When the native read lands, this one line changes.
    expect(createPlaybackDetector().available).toBe(false)
  })

  it('has a notice that says what the app cannot do and what to do about it', () => {
    const notice = PLAYBACK_DETECTION_UNAVAILABLE_NOTICE.toLowerCase()
    expect(notice).toContain('cannot tell')
    expect(notice).toContain('music')
    // An actionable instruction, not just an apology.
    expect(notice).toContain('turn the voice coach off')
  })
})

describe('a working detector reports changes', () => {
  it('starts from the value it was given', async () => {
    expect(await new StaticPlaybackDetector(true).isActive()).toBe(true)
    expect(await new StaticPlaybackDetector().isActive()).toBe(false)
  })

  it('notifies subscribers when playback starts and stops', () => {
    const detector = new StaticPlaybackDetector(false)
    const seen: boolean[] = []
    detector.subscribe((a) => seen.push(a))

    detector.set(true)
    detector.set(false)
    expect(seen).toEqual([true, false])
  })

  it('does not notify when nothing changed', () => {
    // The gate is re-evaluated per notification; repeating an unchanged value
    // would churn it for nothing.
    const detector = new StaticPlaybackDetector(false)
    const seen: boolean[] = []
    detector.subscribe((a) => seen.push(a))
    detector.set(false)
    expect(seen).toEqual([])
  })

  it('stops notifying after unsubscribe', () => {
    const detector = new StaticPlaybackDetector(false)
    const seen: boolean[] = []
    const off = detector.subscribe((a) => seen.push(a))
    off()
    detector.set(true)
    expect(seen).toEqual([])
  })
})

describe('the gate still behaves once a detector exists', () => {
  it('closes when playback starts without an opt-in', async () => {
    const detector = new StaticPlaybackDetector(true)
    const policy = defaultVoiceCoachPolicy()
    expect(voiceAllowed(policy, await detector.isActive())).toBe(false)
  })

  it('opens after the athlete opts in', async () => {
    const detector = new StaticPlaybackDetector(true)
    const policy = { ...defaultVoiceCoachPolicy(), overlayOptIn: true }
    expect(voiceAllowed(policy, await detector.isActive())).toBe(true)
  })
})
