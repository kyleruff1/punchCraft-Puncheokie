/**
 * The versioned harmonic-settings blob (M40-18 #322): canonical-full
 * writes, garbage tolerance, schemaVersion gating, and the session-scoped
 * generation counter the jam's reset semantics hang off.
 */
import { SETTINGS_KEYS } from '@storage/migrations/006_app_settings'
import type { SettingsRepository } from '@storage/repositories/SettingsRepository'
import {
  __resetInstrumentSettingsForTests,
  DEFAULT_HARMONIC_OPTIONS,
  useInstrumentSettingsStore,
} from '@state/useInstrumentSettingsStore'

function makeRepo(stored: Record<string, unknown> = {}) {
  const writes: Record<string, unknown> = {}
  const repo = {
    read: <T,>(key: string, fallback: T): T => (key in stored ? (stored[key] as T) : fallback),
    write: (key: string, value: unknown): void => {
      writes[key] = value
    },
  } as unknown as SettingsRepository
  return { repo, writes }
}

beforeEach(() => {
  __resetInstrumentSettingsForTests()
})

afterAll(() => {
  __resetInstrumentSettingsForTests()
})

const HKEY = SETTINGS_KEYS.instrumentHarmonic

it('nothing stored → the canonical defaults (safe-3×3 / orbit / 480)', () => {
  const { repo } = makeRepo()
  useInstrumentSettingsStore.getState().load(repo)
  const s = useInstrumentSettingsStore.getState()
  expect(s.harmonicFreedom).toBe('safe-3x3')
  expect(s.harmonicNavigation).toBe('orbit')
  expect(s.harmonicCommitIntervalTicks).toBe(480)
  expect(s.harmonicGeneration).toBe(0)
})

it('every set writes the canonical FULL blob and a reload round-trips it', () => {
  const { repo, writes } = makeRepo()
  useInstrumentSettingsStore.getState().load(repo)
  useInstrumentSettingsStore.getState().setHarmonicOptions({ freedom: 'full-6x6' })
  // Partial in, canonical full out — omitted ≡ stored-default hashing.
  expect(writes[HKEY]).toEqual({
    schemaVersion: 1,
    freedom: 'full-6x6',
    navigation: DEFAULT_HARMONIC_OPTIONS.navigation,
    commitIntervalTicks: DEFAULT_HARMONIC_OPTIONS.commitIntervalTicks,
  })

  __resetInstrumentSettingsForTests()
  const second = makeRepo({ [HKEY]: writes[HKEY] })
  useInstrumentSettingsStore.getState().load(second.repo)
  expect(useInstrumentSettingsStore.getState().harmonicFreedom).toBe('full-6x6')
  expect(useInstrumentSettingsStore.getState().harmonicNavigation).toBe('orbit')
})

it('a wrong schemaVersion drops the WHOLE blob to defaults, never half-reads', () => {
  const { repo } = makeRepo({
    [HKEY]: { schemaVersion: 2, freedom: 'full-6x6', navigation: 'absolute', commitIntervalTicks: 960 },
  })
  useInstrumentSettingsStore.getState().load(repo)
  const s = useInstrumentSettingsStore.getState()
  expect(s.harmonicFreedom).toBe('safe-3x3')
  expect(s.harmonicNavigation).toBe('orbit')
  expect(s.harmonicCommitIntervalTicks).toBe(480)
})

it('garbage fields fall to defaults individually under a valid version', () => {
  const { repo } = makeRepo({
    [HKEY]: { schemaVersion: 1, freedom: 'chaos-9x9', navigation: 'absolute', commitIntervalTicks: 333 },
  })
  useInstrumentSettingsStore.getState().load(repo)
  const s = useInstrumentSettingsStore.getState()
  expect(s.harmonicFreedom).toBe('safe-3x3') // invalid → default
  expect(s.harmonicNavigation).toBe('absolute') // valid → kept
  expect(s.harmonicCommitIntervalTicks).toBe(480) // 333 is no grid value
})

it('the generation bumps on EVERY harmonic set and never persists', () => {
  const { repo, writes } = makeRepo()
  useInstrumentSettingsStore.getState().load(repo)
  useInstrumentSettingsStore.getState().setHarmonicOptions({ navigation: 'absolute' })
  useInstrumentSettingsStore.getState().setHarmonicOptions({ commitIntervalTicks: 960 })
  expect(useInstrumentSettingsStore.getState().harmonicGeneration).toBe(2)
  expect(writes[HKEY]).not.toHaveProperty('harmonicGeneration')
  expect(writes[HKEY]).toEqual({
    schemaVersion: 1,
    freedom: 'safe-3x3',
    navigation: 'absolute',
    commitIntervalTicks: 960,
  })
  // A reload leaves the session counter alone — it is invalidation state,
  // not a setting.
  useInstrumentSettingsStore.getState().load(repo)
  expect(useInstrumentSettingsStore.getState().harmonicGeneration).toBe(2)
})
