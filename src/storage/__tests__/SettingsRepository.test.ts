/**
 * SettingsRepository (M34-05).
 *
 * The behaviour worth pinning is the recovery policy: a settings row that
 * cannot be read falls back to defaults rather than throwing. That is the
 * **opposite** of `generated_workouts`, where a corrupt payload must surface
 * loudly — there the row *is* the record of what happened, and substituting a
 * default would fabricate history. Here it is a preference, and refusing to
 * start a workout over one would be the worse failure.
 */
import { createMigratedDb } from './helpers/memoryDb'
import { SettingsRepository } from '../repositories/SettingsRepository'
import { SETTINGS_KEYS } from '../migrations/006_app_settings'

interface Prefs {
  mode: string
  loud: boolean
}

const DEFAULTS: Prefs = { mode: 'standard', loud: false }

function harness() {
  const db = createMigratedDb()
  return { db, repo: new SettingsRepository(db) }
}

// ---------------------------------------------------------------------------

describe('round trip', () => {
  it('returns the fallback when nothing was ever written', () => {
    const h = harness()
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS)).toEqual(DEFAULTS)
  })

  it('reads back what it wrote', () => {
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'full', loud: true })
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS)).toEqual({ mode: 'full', loud: true })
  })

  it('overwrites rather than accumulating rows', () => {
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'a', loud: false })
    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'b', loud: false })

    const count = h.db.raw
      .prepare('SELECT COUNT(*) AS n FROM app_settings')
      .get() as { n: number }
    expect(count.n).toBe(1)
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS).mode).toBe('b')
  })

  it('keeps keys apart', () => {
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'full', loud: false })
    h.repo.write(SETTINGS_KEYS.voiceVolumes, { mode: 'other', loud: true })
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS).mode).toBe('full')
  })

  it('clears back to the default', () => {
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'full', loud: true })
    h.repo.clear(SETTINGS_KEYS.voicePolicy)
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS)).toEqual(DEFAULTS)
  })
})

describe('a stored object that has fallen behind the type', () => {
  it('gains the fields it never had, from the fallback', () => {
    // An older install wrote `{mode}` before `loud` existed. It must come back
    // complete rather than with an undefined the UI then renders as blank.
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'full' })
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS)).toEqual({
      mode: 'full',
      loud: false,
    })
  })

  it('keeps the stored value where one exists', () => {
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, { loud: true })
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS)).toEqual({
      mode: 'standard',
      loud: true,
    })
  })
})

describe('an unreadable row falls back rather than throwing', () => {
  const badValues = [
    ['malformed json', '{not json'],
    ['a bare string', '"loud"'],
    ['a number', '42'],
    ['null', 'null'],
    // An array would spread index keys over the fallback and produce nonsense.
    ['an array', '[1,2,3]'],
  ] as const

  it.each(badValues)('recovers from %s', (_label, stored) => {
    const h = harness()
    h.db.raw
      .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(SETTINGS_KEYS.voicePolicy, stored, '2026-08-23T00:00:00.000Z')

    expect(() => h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS)).not.toThrow()
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS)).toEqual(DEFAULTS)
  })

  it('can be written over afterwards', () => {
    // Recovery has to leave the table usable, not just survive one read.
    const h = harness()
    h.db.raw
      .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      .run(SETTINGS_KEYS.voicePolicy, '{broken', '2026-08-23T00:00:00.000Z')

    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'full', loud: true })
    expect(h.repo.read(SETTINGS_KEYS.voicePolicy, DEFAULTS).mode).toBe('full')
  })
})

describe('the wall clock is display only (spec §3.2, §18.3)', () => {
  it('stamps updated_at without anything ordering by it', () => {
    const h = harness()
    h.repo.write(SETTINGS_KEYS.voicePolicy, { mode: 'full', loud: false }, '2026-01-02T03:04:05Z')
    const row = h.db.raw
      .prepare('SELECT updated_at FROM app_settings WHERE key = ?')
      .get(SETTINGS_KEYS.voicePolicy) as { updated_at: string }
    expect(row.updated_at).toBe('2026-01-02T03:04:05Z')
  })
})
