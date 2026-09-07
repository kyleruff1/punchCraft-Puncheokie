/**
 * QA store (GH #291): a persisted flag that must FAIL CLOSED, and an
 * ephemeral staged run that must never reach disk.
 */
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import type { SettingsRepository } from '@storage/repositories/SettingsRepository'

import { __resetQaStoreForTests, isQaEnabled, useQaStore, type StagedQaRun } from '../useQaStore'

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

const store = () => useQaStore.getState()

const run = (over: Partial<StagedQaRun> = {}): StagedQaRun => ({
  workout: 'body-work',
  vocab: 'numbers',
  sim: 'captured-jam',
  simForce: false,
  autostart: true,
  requestedAtMs: 1_000,
  autostartConsumed: false,
  ...over,
})

beforeEach(() => {
  __resetQaStoreForTests()
})

describe('useQaStore', () => {
  it('defaults to off, unloaded, with no staged run', () => {
    expect(store().enabled).toBe(false)
    expect(store().loaded).toBe(false)
    expect(store().run).toBeNull()
    expect(isQaEnabled()).toBe(false)
  })

  it('load reads the stored flag and marks loaded', () => {
    const { repo } = fakeRepo({ enabled: true })
    store().load(repo)
    expect(store().enabled).toBe(true)
    expect(store().loaded).toBe(true)
    expect(isQaEnabled()).toBe(true)
  })

  it('load fails CLOSED on a corrupted row — only literal true is on', () => {
    // "on" grants autostart to an externally reachable URL, so a garbage
    // value must never round up to enabled.
    for (const stored of [{ enabled: 'true' }, { enabled: 1 }, { enabled: null }, {}]) {
      __resetQaStoreForTests()
      store().load(fakeRepo(stored).repo)
      expect(store().enabled).toBe(false)
    }
  })

  it('setEnabled updates state and persists exactly { enabled } under the qa key', () => {
    const { repo, writes } = fakeRepo()
    store().load(repo)
    store().setEnabled(true)
    expect(store().enabled).toBe(true)
    expect(writes).toEqual([{ key: SETTINGS_KEYS.qa, value: { enabled: true } }])
  })

  it('setEnabled before any load still updates state and does not throw', () => {
    expect(() => store().setEnabled(true)).not.toThrow()
    expect(store().enabled).toBe(true)
  })

  it('a staged run is never persisted', () => {
    const { repo, writes } = fakeRepo()
    store().load(repo)
    store().stageRun(run())
    store().consumeAutostart()
    store().clearRun()
    expect(writes).toEqual([])
  })

  it('consumeAutostart flips the flag on the staged run only', () => {
    store().stageRun(run())
    store().consumeAutostart()
    expect(store().run?.autostartConsumed).toBe(true)
    expect(store().run?.autostart).toBe(true)
  })

  it('consumeAutostart with nothing staged is a no-op', () => {
    expect(() => store().consumeAutostart()).not.toThrow()
    expect(store().run).toBeNull()
  })

  it('clearRun drops the staged run', () => {
    store().stageRun(run())
    store().clearRun()
    expect(store().run).toBeNull()
  })
})
