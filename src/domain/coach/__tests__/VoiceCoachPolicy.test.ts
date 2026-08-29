/**
 * Voice Coach policy (M34-02, doc §18, §25, D1).
 *
 * The gate suite is the one that matters. Every other assertion here is
 * about a coach being chattier or terser than someone wanted; the D1 table
 * is about the app talking over someone's music without being asked, which
 * is the single behaviour the design says must never happen.
 */
import {
  defaultVoiceCoachPolicy,
  shouldSpeak,
  voiceAllowed,
  type SpokenCategory,
  type VoiceCoachPolicy,
  type VoiceMode,
  type VoiceStyle,
} from '../VoiceCoachPolicy'
import { AUDIO_PRIORITY } from '../VoiceOutputPort'

const ALL_CATEGORIES: SpokenCategory[] = [
  'punch-command',
  'stance-change',
  'defense',
  'footwork',
  'bell',
  'final-countdown',
  'metric',
  'coaching-reminder',
  'gap-filler',
]

const policy = (over: Partial<VoiceCoachPolicy> = {}): VoiceCoachPolicy => ({
  ...defaultVoiceCoachPolicy(),
  ...over,
})

// ---------------------------------------------------------------------------

describe('the D1 gate (spec §13.5, §14.6)', () => {
  it('opens when nothing else is playing', () => {
    expect(voiceAllowed(policy(), false)).toBe(true)
  })

  it('closes the moment third-party playback starts, without an opt-in', () => {
    expect(voiceAllowed(policy(), true)).toBe(false)
  })

  it('opens over playback only after an explicit opt-in', () => {
    expect(voiceAllowed(policy({ overlayOptIn: true }), true)).toBe(true)
  })

  it('stays shut in mode off however the opt-in is set', () => {
    expect(voiceAllowed(policy({ mode: 'off' }), false)).toBe(false)
    expect(voiceAllowed(policy({ mode: 'off', overlayOptIn: true }), true)).toBe(false)
  })

  it('is the full truth table — nothing else opens it', () => {
    const table: Array<[VoiceMode, boolean, boolean, boolean]> = [
      // mode, playbackActive, overlayOptIn, allowed
      ['off', false, false, false],
      ['off', false, true, false],
      ['off', true, false, false],
      ['off', true, true, false],
      ['minimal', false, false, true],
      ['minimal', true, false, false],
      ['minimal', true, true, true],
      ['standard', false, false, true],
      ['standard', true, false, false],
      ['standard', true, true, true],
      ['full', false, false, true],
      ['full', true, false, false],
      ['full', true, true, true],
    ]
    for (const [mode, active, optIn, allowed] of table) {
      expect([mode, active, optIn, voiceAllowed(policy({ mode, overlayOptIn: optIn }), active)]).toEqual(
        [mode, active, optIn, allowed],
      )
    }
  })

  it('defaults the opt-in to off', () => {
    // The default is the whole decision. A true here would silently make
    // every new install speak over the user's music.
    expect(defaultVoiceCoachPolicy().overlayOptIn).toBe(false)
  })

  it('never has a style or vocabulary that opens it', () => {
    // Choosing a vocabulary is not consent to speak over music (D15).
    const styles: VoiceStyle[] = ['call-and-go', 'follow-the-call', 'minimal']
    for (const style of styles) {
      expect(voiceAllowed(policy({ style, vocabulary: 'names' }), true)).toBe(false)
      expect(voiceAllowed(policy({ style, vocabulary: 'numbers' }), true)).toBe(false)
    }
  })
})

describe('the shipped defaults (D22, D18)', () => {
  it('calls every set rather than beeping repetitions', () => {
    // Coach Shorthand beeps every repetition after the first (§18.1). Against
    // generated workouts, whose blocks repeat two to four times, that made most
    // calls tones rather than speech — which is what moved the default.
    expect(defaultVoiceCoachPolicy().style).toBe('call-and-go')
  })

  it('speaks technique names, not numbers', () => {
    // Names teach while they call; numbers stay one tap away in settings.
    expect(defaultVoiceCoachPolicy().vocabulary).toBe('names')
  })
})

describe('mode off silences everything (doc §25)', () => {
  it('yields no true for any category', () => {
    const p = policy({ mode: 'off' })
    for (const category of ALL_CATEGORIES) {
      expect([category, shouldSpeak(p, category, false)]).toEqual([category, false])
      expect([category, shouldSpeak(p, category, true)]).toEqual([category, false])
    }
  })
})

describe('a combination is never interrupted (doc §18)', () => {
  it('holds metric, coaching-reminder AND gap-filler while one is running', () => {
    const p = policy({ mode: 'full' })
    expect(shouldSpeak(p, 'metric', true)).toBe(false)
    expect(shouldSpeak(p, 'coaching-reminder', true)).toBe(false)
    // A0 (#254): gap-filler must respect the same in-combo hold, even
    // though the compiler only places these lines in audited silence.
    expect(shouldSpeak(p, 'gap-filler', true)).toBe(false)
  })

  it('still allows them between combinations', () => {
    const p = policy({ mode: 'full' })
    expect(shouldSpeak(p, 'metric', false)).toBe(true)
    expect(shouldSpeak(p, 'coaching-reminder', false)).toBe(true)
    expect(shouldSpeak(p, 'gap-filler', false)).toBe(true)
  })

  it('never suppresses a bell or a punch command mid-combination', () => {
    // The bell ends the round whatever is happening; the punch command *is*
    // the combination.
    const p = policy({ mode: 'full' })
    expect(shouldSpeak(p, 'bell', true)).toBe(true)
    expect(shouldSpeak(p, 'punch-command', true)).toBe(true)
  })
})

describe('mode decides how much is said', () => {
  it('minimal speaks only stance changes, round events and metrics', () => {
    const p = policy({ mode: 'minimal' })
    expect(shouldSpeak(p, 'stance-change', false)).toBe(true)
    expect(shouldSpeak(p, 'bell', false)).toBe(true)
    expect(shouldSpeak(p, 'final-countdown', false)).toBe(true)
    expect(shouldSpeak(p, 'metric', false)).toBe(true)

    expect(shouldSpeak(p, 'punch-command', false)).toBe(false)
    expect(shouldSpeak(p, 'defense', false)).toBe(false)
    expect(shouldSpeak(p, 'footwork', false)).toBe(false)
    expect(shouldSpeak(p, 'coaching-reminder', false)).toBe(false)
    // Minimal is the athlete's quiet-coach opt-in: the gap-filler
    // rotation stays out too, same as coaching-reminder.
    expect(shouldSpeak(p, 'gap-filler', false)).toBe(false)
  })

  it('standard says everything but the optional coaching reminder', () => {
    const p = policy({ mode: 'standard' })
    expect(shouldSpeak(p, 'coaching-reminder', false)).toBe(false)
    expect(shouldSpeak(p, 'punch-command', false)).toBe(true)
    expect(shouldSpeak(p, 'defense', false)).toBe(true)
  })

  it('standard PERMITS gap-filler — the fix for A0 (#254)', () => {
    // Regression: the shipped default was `standard`, but every
    // scheduled encouragement was dispatched via `coaching-reminder`
    // and silently vetoed here. 6 rotation fillers + 2 power-strike
    // calls per round were compiled and thrown away. `gap-filler`
    // splits those lines off so `standard` keeps them audible while
    // still holding back the mid-combination reminder.
    const p = policy({ mode: 'standard' })
    expect(shouldSpeak(p, 'gap-filler', false)).toBe(true)
  })

  it('full adds the coaching reminder', () => {
    expect(shouldSpeak(policy({ mode: 'full' }), 'coaching-reminder', false)).toBe(true)
  })
})

describe('mode and style each set a ceiling', () => {
  it('lets the more restrictive of the two win', () => {
    // Someone who picked the Minimal behaviour asked for a quiet coach. A
    // mode of `full` must not talk over that choice.
    const p = policy({ mode: 'full', style: 'minimal' })
    expect(shouldSpeak(p, 'punch-command', false)).toBe(false)
    expect(shouldSpeak(p, 'coaching-reminder', false)).toBe(false)
    expect(shouldSpeak(p, 'bell', false)).toBe(true)
  })

  it('does not let a talkative style widen a minimal mode', () => {
    const p = policy({ mode: 'minimal', style: 'follow-the-call' })
    expect(shouldSpeak(p, 'punch-command', false)).toBe(false)
  })
})

describe('the announcement switches', () => {
  it('silences metrics when they are turned off', () => {
    expect(shouldSpeak(policy({ metricAnnouncements: 'off' }), 'metric', false)).toBe(false)
  })

  it('silences the final countdown when it is turned off (doc §25)', () => {
    expect(shouldSpeak(policy({ finalTenSecondWarning: false }), 'final-countdown', false)).toBe(
      false,
    )
    expect(shouldSpeak(policy({ finalTenSecondWarning: true }), 'final-countdown', false)).toBe(true)
  })
})

describe('the priority order matches doc §18.2 exactly', () => {
  it('ranks safety above the bell, and the bell above a punch command', () => {
    expect(AUDIO_PRIORITY.safety).toBeLessThan(AUDIO_PRIORITY.bell)
    expect(AUDIO_PRIORITY.bell).toBeLessThan(AUDIO_PRIORITY.punchCommand)
    expect(AUDIO_PRIORITY.punchCommand).toBeLessThan(AUDIO_PRIORITY.defenseFootwork)
    expect(AUDIO_PRIORITY.defenseFootwork).toBeLessThan(AUDIO_PRIORITY.metric)
    expect(AUDIO_PRIORITY.metric).toBeLessThan(AUDIO_PRIORITY.coachingReminder)
  })

  it('is the six documented levels and nothing more', () => {
    expect(Object.keys(AUDIO_PRIORITY)).toEqual([
      'safety',
      'bell',
      'punchCommand',
      'defenseFootwork',
      'metric',
      'coachingReminder',
    ])
  })
})
