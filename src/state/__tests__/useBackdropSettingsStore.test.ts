import {
  __resetBackdropSettingsForTests,
  useBackdropSettingsStore,
} from '../useBackdropSettingsStore'
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import type { SettingsRepository } from '@storage/repositories/SettingsRepository'

function fakeRepo(stored?: unknown) {
  const writes: Array<{ key: string; value: unknown }> = []
  const repo = {
    read: <T,>(_key: string, fallback: T): T =>
      stored === undefined ? fallback : ({ ...fallback, ...(stored as object) } as T),
    write: (key: string, value: unknown) => {
      writes.push({ key, value })
    },
  } as unknown as SettingsRepository
  return { repo, writes }
}

const store = () => useBackdropSettingsStore.getState()

beforeEach(() => {
  __resetBackdropSettingsForTests()
})

describe('useBackdropSettingsStore', () => {
  it('defaults to standard, unloaded', () => {
    expect(store().quality).toBe('standard')
    expect(store().loaded).toBe(false)
  })

  it('load reads the stored quality and marks loaded', () => {
    const { repo } = fakeRepo({ quality: 'reduced' })
    store().load(repo)
    expect(store().quality).toBe('reduced')
    expect(store().loaded).toBe(true)
  })

  it('load degrades a retired or corrupted value to the default (D22)', () => {
    const { repo } = fakeRepo({ quality: 'ultra-mega' })
    store().load(repo)
    expect(store().quality).toBe('standard')
  })

  it('setQuality updates state and persists an object under the backdrop key', () => {
    const { repo, writes } = fakeRepo()
    store().load(repo)
    store().setQuality('off')
    expect(store().quality).toBe('off')
    expect(writes).toEqual([{ key: SETTINGS_KEYS.backdrop, value: { quality: 'off' } }])
  })

  it('setQuality before any load still updates state and does not throw', () => {
    expect(() => store().setQuality('reduced')).not.toThrow()
    expect(store().quality).toBe('reduced')
  })
})
