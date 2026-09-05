/**
 * Voice settings store and its persistence (M34-05, D1, spec §13.5).
 *
 * One rule carries this file: **`overlayOptIn` moves only when the athlete
 * moves it.** Everything else is preference plumbing. The tests below try the
 * ways it could be set by accident — a general patch, a JSON-shaped patch that
 * types never saw, a mode change, a reload of an older stored object — and
 * assert it stays put.
 *
 * Runs against real SQLite through the `node:sqlite` helper, so persistence
 * behaves here as it does on device.
 */
import { createMigratedDb } from '@storage/__tests__/helpers/memoryDb'
import { SettingsRepository } from '@storage/repositories/SettingsRepository'
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import {
  __resetVoiceSettingsForTests,
  useVoiceSettingsStore,
} from '../useVoiceSettingsStore'
import { defaultVoiceCoachPolicy } from '@domain/coach/VoiceCoachPolicy'

function harness() {
  const db = createMigratedDb()
  const repo = new SettingsRepository(db)
  useVoiceSettingsStore.getState().load(repo)
  return { db, repo, store: () => useVoiceSettingsStore.getState() }
}

beforeEach(() => {
  __resetVoiceSettingsForTests()
})

// ---------------------------------------------------------------------------

describe('the D1 opt-in defaults off and stays off (spec §13.5)', () => {
  it('starts false on a fresh install', () => {
    const h = harness()
    expect(h.store().policy.overlayOptIn).toBe(false)
  })

  it('is not moved by a general policy patch', () => {
    const h = harness()
    h.store().setOverlayOptIn(true)
    h.store().setPolicy({ mode: 'full' })
    expect(h.store().policy.overlayOptIn).toBe(true)

    h.store().setOverlayOptIn(false)
    h.store().setPolicy({ mode: 'minimal', style: 'call-and-go' })
    expect(h.store().policy.overlayOptIn).toBe(false)
  })

  it('ignores an overlayOptIn smuggled into a patch', () => {
    // The type forbids it, but a patch can arrive from stored JSON that the
    // types never saw. A single accidental one of these would make the app
    // talk over someone's music and nothing would fail.
    const h = harness()
    h.store().setPolicy({ overlayOptIn: true } as never)
    expect(h.store().policy.overlayOptIn).toBe(false)
  })

  it('is not turned on by changing mode, style or vocabulary', () => {
    const h = harness()
    h.store().setPolicy({ mode: 'full' })
    h.store().setPolicy({ style: 'follow-the-call' })
    h.store().setPolicy({ vocabulary: 'names' })
    h.store().setPolicy({ metricAnnouncements: 'periodic' })
    expect(h.store().policy.overlayOptIn).toBe(false)
  })

  it('moves when the toggle the athlete owns asks it to', () => {
    const h = harness()
    h.store().setOverlayOptIn(true)
    expect(h.store().policy.overlayOptIn).toBe(true)
    h.store().setOverlayOptIn(false)
    expect(h.store().policy.overlayOptIn).toBe(false)
  })
})

describe('a retired style is migrated on load (D22)', () => {
  it('moves an install off coach-shorthand rather than leaving it beeping', () => {
    // The style is gone from the UI, so an install still carrying it would beep
    // its repetitions forever with no control left to explain why. This is the
    // path that fixes a device that has already stored the old value — the
    // athlete never has to know it happened.
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, {
      ...defaultVoiceCoachPolicy(),
      style: 'coach-shorthand',
    })

    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)

    expect(useVoiceSettingsStore.getState().policy.style).toBe('call-and-go')
  })

  it('writes the migration back, so it happens once rather than every launch', () => {
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, {
      ...defaultVoiceCoachPolicy(),
      style: 'coach-shorthand',
    })

    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)

    const stored = h.repo.read(SETTINGS_KEYS.voicePolicy, defaultVoiceCoachPolicy())
    expect(stored.style).toBe('call-and-go')
  })

  it('leaves a style that still exists alone', () => {
    const h = harness()
    h.store().setPolicy({ style: 'follow-the-call' })

    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)

    expect(useVoiceSettingsStore.getState().policy.style).toBe('follow-the-call')
  })
})

describe('settings survive a restart', () => {
  it('reloads the policy the athlete chose', () => {
    const h = harness()
    h.store().setPolicy({ mode: 'minimal', vocabulary: 'names' })
    h.store().setOverlayOptIn(true)

    // A fresh store over the same database is what a relaunch looks like.
    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)

    expect(useVoiceSettingsStore.getState().policy).toMatchObject({
      mode: 'minimal',
      vocabulary: 'names',
      overlayOptIn: true,
    })
  })

  it('reloads the volumes', () => {
    const h = harness()
    h.store().setVolumes({ voice: 0.5, bells: 0.25, haptics: 0, metronome: 0.6 })

    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)

    expect(useVoiceSettingsStore.getState().volumes).toEqual({
      voice: 0.5,
      bells: 0.25,
      haptics: 0,
      metronome: 0.6,
    })
  })

  it('fills in a field that did not exist when the row was written', () => {
    // An older install has no `vocabulary`. It should come back as the
    // default rather than undefined.
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'full', overlayOptIn: true })

    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)

    const policy = useVoiceSettingsStore.getState().policy
    expect(policy.mode).toBe('full')
    expect(policy.vocabulary).toBe(defaultVoiceCoachPolicy().vocabulary)
    expect(policy.overlayOptIn).toBe(true)
  })

  it('marks itself loaded so a screen never writes over unread values', () => {
    expect(useVoiceSettingsStore.getState().loaded).toBe(false)
    const h = harness()
    expect(h.store().loaded).toBe(true)
  })
})

describe('a corrupt stored setting does not stop a workout', () => {
  it('falls back to defaults rather than throwing', () => {
    // A settings table is not worth crashing over. This is the opposite of
    // the generated_workouts policy, where a corrupt payload must surface —
    // there the row *is* the record of what happened.
    const h = harness()
    h.db.raw
      .prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(SETTINGS_KEYS.voicePolicy, '{not json', '2026-08-23T00:00:00.000Z')

    __resetVoiceSettingsForTests()
    expect(() => useVoiceSettingsStore.getState().load(h.repo)).not.toThrow()
    expect(useVoiceSettingsStore.getState().policy).toEqual(defaultVoiceCoachPolicy())
  })

  it('falls back when the stored value is not an object', () => {
    const h = harness()
    h.db.raw
      .prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(SETTINGS_KEYS.voiceVolumes, '"loud"', '2026-08-23T00:00:00.000Z')

    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)
    expect(useVoiceSettingsStore.getState().volumes.voice).toBe(1)
  })

  it('never resurrects the opt-in from a corrupt row', () => {
    // The worst version of a bad fallback: garbage in the table turning
    // consent on.
    const h = harness()
    h.db.raw
      .prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(SETTINGS_KEYS.voicePolicy, '[]', '2026-08-23T00:00:00.000Z')

    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)
    expect(useVoiceSettingsStore.getState().policy.overlayOptIn).toBe(false)
  })
})

describe('the development click defaults off and persists', () => {
  it('starts off on a fresh install (dev instrumentation never defaults audible)', () => {
    const h = harness()
    expect(h.store().clickEnabled).toBe(false)
  })

  it('flips on and off through its own setter', () => {
    const h = harness()
    h.store().setClickEnabled(true)
    expect(h.store().clickEnabled).toBe(true)
    h.store().setClickEnabled(false)
    expect(h.store().clickEnabled).toBe(false)
  })

  it('survives a restart', () => {
    const h = harness()
    h.store().setClickEnabled(true)

    __resetVoiceSettingsForTests()
    useVoiceSettingsStore.getState().load(h.repo)

    expect(useVoiceSettingsStore.getState().clickEnabled).toBe(true)
  })

  it('falls back to off (never a surprise audible click) on a corrupt row', () => {
    const h = harness()
    h.db.raw
      .prepare('INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(SETTINGS_KEYS.click, '{not json', '2026-09-04T00:00:00.000Z')

    __resetVoiceSettingsForTests()
    expect(() => useVoiceSettingsStore.getState().load(h.repo)).not.toThrow()
    expect(useVoiceSettingsStore.getState().clickEnabled).toBe(false)
  })

  it('is absent → off for an install predating the click setting', () => {
    // No click row was ever written; the merge-over-default read returns off.
    const h = harness()
    expect(h.store().clickEnabled).toBe(false)
  })
})

describe('writes reach the database immediately', () => {
  it('does not wait for a flush that might never come', () => {
    const h = harness()
    h.store().setPolicy({ mode: 'minimal' })

    const row = h.db.raw
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(SETTINGS_KEYS.voicePolicy) as { value_json: string } | undefined
    expect(JSON.parse(row?.value_json ?? '{}')).toMatchObject({ mode: 'minimal' })
  })

  it('keeps one row per key rather than appending', () => {
    const h = harness()
    h.store().setPolicy({ mode: 'minimal' })
    h.store().setPolicy({ mode: 'full' })
    const count = h.db.raw
      .prepare('SELECT COUNT(*) AS n FROM app_settings WHERE key = ?')
      .get(SETTINGS_KEYS.voicePolicy) as { n: number }
    expect(count.n).toBe(1)
  })
})
