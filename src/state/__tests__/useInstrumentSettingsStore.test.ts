/**
 * Instrument settings store — tablet-voice routing + texture (M40-15 #319).
 *
 * The rules that must not quietly regress:
 *
 * - OUTPUT defaults to 'bridge': a fresh install (and every install that
 *   never touched the row) keeps today's PC-rig path byte-for-byte (R5).
 * - the two fields persist as ONE merged blob under `instrumentTablet`,
 *   so either setter alone never clobbers the other's stored value.
 * - a stored value that is no longer (or never was) valid falls to the
 *   default on load — a renamed texture must not brick the jam screen.
 *
 * Runs against real SQLite through the `node:sqlite` helper, so
 * persistence behaves here as it does on device.
 */
import { createMigratedDb } from '@storage/__tests__/helpers/memoryDb'
import { SettingsRepository } from '@storage/repositories/SettingsRepository'
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'

import {
  __resetInstrumentSettingsForTests,
  useInstrumentSettingsStore,
} from '../useInstrumentSettingsStore'

function harness() {
  const db = createMigratedDb()
  const repo = new SettingsRepository(db)
  useInstrumentSettingsStore.getState().load(repo)
  return { db, repo, store: () => useInstrumentSettingsStore.getState() }
}

beforeEach(() => {
  __resetInstrumentSettingsForTests()
})

describe('defaults (R5: the bridge path stays untouched)', () => {
  it('starts on bridge output with the brass texture', () => {
    const h = harness()
    expect(h.store().outputTarget).toBe('bridge')
    expect(h.store().textureId).toBe('brass')
    expect(h.store().loaded).toBe(true)
  })

  it('reset restores the defaults for the next suite', () => {
    const h = harness()
    h.store().setOutputTarget('both')
    h.store().setTextureId('pluck')
    __resetInstrumentSettingsForTests()
    expect(useInstrumentSettingsStore.getState().outputTarget).toBe('bridge')
    expect(useInstrumentSettingsStore.getState().textureId).toBe('brass')
    expect(useInstrumentSettingsStore.getState().loaded).toBe(false)
  })
})

describe('persistence — one merged blob', () => {
  it('a routing change survives a reload', () => {
    const h = harness()
    h.store().setOutputTarget('tablet')

    __resetInstrumentSettingsForTests()
    useInstrumentSettingsStore.getState().load(new SettingsRepository(h.db))
    expect(useInstrumentSettingsStore.getState().outputTarget).toBe('tablet')
    expect(useInstrumentSettingsStore.getState().textureId).toBe('brass')
  })

  it('a texture change survives a reload without clobbering the output', () => {
    const h = harness()
    h.store().setOutputTarget('both')
    h.store().setTextureId('pluck')

    __resetInstrumentSettingsForTests()
    useInstrumentSettingsStore.getState().load(new SettingsRepository(h.db))
    expect(useInstrumentSettingsStore.getState().outputTarget).toBe('both')
    expect(useInstrumentSettingsStore.getState().textureId).toBe('pluck')
  })

  it('every setter writes ALL fields under the one key', () => {
    const h = harness()
    h.store().setTextureId('pluck')
    expect(
      h.repo.read(SETTINGS_KEYS.instrumentTablet, { output: 'missing', texture: 'missing' }),
    ).toEqual({ output: 'bridge', texture: 'pluck', mode: 'arp', engine: 'expo' })

    h.store().setOutputTarget('tablet')
    expect(
      h.repo.read(SETTINGS_KEYS.instrumentTablet, { output: 'missing', texture: 'missing' }),
    ).toEqual({ output: 'tablet', texture: 'pluck', mode: 'arp', engine: 'expo' })

    h.store().setVoiceMode('notes')
    expect(
      h.repo.read(SETTINGS_KEYS.instrumentTablet, { output: 'missing', texture: 'missing' }),
    ).toEqual({ output: 'tablet', texture: 'pluck', mode: 'notes' })
  })

  it('a mode change survives a reload without clobbering its siblings', () => {
    const h = harness()
    h.store().setTextureId('pluck')
    h.store().setVoiceMode('notes')

    __resetInstrumentSettingsForTests()
    useInstrumentSettingsStore.getState().load(new SettingsRepository(h.db))
    expect(useInstrumentSettingsStore.getState().voiceMode).toBe('notes')
    expect(useInstrumentSettingsStore.getState().textureId).toBe('pluck')
  })
})

describe('stored garbage falls to defaults', () => {
  it('an unknown output or texture never reaches the state', () => {
    const db = createMigratedDb()
    const repo = new SettingsRepository(db)
    repo.write(SETTINGS_KEYS.instrumentTablet, { output: 'loudspeaker', texture: 'accordion' })

    useInstrumentSettingsStore.getState().load(repo)
    expect(useInstrumentSettingsStore.getState().outputTarget).toBe('bridge')
    expect(useInstrumentSettingsStore.getState().textureId).toBe('brass')
  })

  it('a partial blob keeps the valid half', () => {
    const db = createMigratedDb()
    const repo = new SettingsRepository(db)
    repo.write(SETTINGS_KEYS.instrumentTablet, { output: 'both' })

    useInstrumentSettingsStore.getState().load(repo)
    expect(useInstrumentSettingsStore.getState().outputTarget).toBe('both')
    expect(useInstrumentSettingsStore.getState().textureId).toBe('brass')
  })

  it('a pre-mode blob (no mode field) falls to arp, garbage mode too', () => {
    const db = createMigratedDb()
    const repo = new SettingsRepository(db)
    repo.write(SETTINGS_KEYS.instrumentTablet, { output: 'tablet', texture: 'pluck' })
    useInstrumentSettingsStore.getState().load(repo)
    expect(useInstrumentSettingsStore.getState().voiceMode).toBe('arp')

    repo.write(SETTINGS_KEYS.instrumentTablet, { output: 'tablet', texture: 'pluck', mode: 'karaoke' })
    useInstrumentSettingsStore.getState().load(repo)
    expect(useInstrumentSettingsStore.getState().voiceMode).toBe('arp')
  })
})
