/**
 * PunchEventRepository — SQL shape, transaction discipline, dedup accounting.
 *
 * Backed by a recording fake rather than real SQLite, because expo-sqlite is a
 * native module and these must run on the Windows workstation (§21). The fake
 * models the two behaviours the repository actually reasons about: the
 * transaction verbs it emits, and `total_changes()` advancing only for rows
 * that were genuinely inserted.
 */

import type { SqlBindValue, SqlPort, SqlStatement } from '@storage/SqlPort'
import {
  PunchEventRepository,
  type PunchEventInsertInput,
} from '@storage/repositories/PunchEventRepository'

/**
 * Fake database. `dedupeKeys` decides which inserts "land": a row whose key is
 * already present does not advance total_changes, exactly as INSERT OR IGNORE
 * behaves against the unique index in migration 002.
 */
class FakeDb implements SqlPort {
  readonly exec: string[] = []
  readonly inserts: SqlBindValue[][] = []
  private changes = 0
  private readonly seen = new Set<string>()
  failOnInsert = false

  constructor(private readonly keyOf: (params: SqlBindValue[]) => string) {}

  execSync(sql: string): void {
    this.exec.push(sql)
  }

  prepareSync(sql: string): SqlStatement {
    const isInsert = sql.includes('INSERT OR IGNORE INTO punch_events')
    const isTotalChanges = sql.includes('total_changes()')
    // Arrow functions so `this` stays the FakeDb instance without aliasing.
    return {
      executeSync: <TRow = unknown>(params: SqlBindValue[]) => {
        if (isTotalChanges) {
          return { getAllSync: () => [{ n: this.changes } as unknown as TRow] }
        }
        if (isInsert) {
          if (this.failOnInsert) throw new Error('constraint exploded')
          this.inserts.push(params)
          const key = this.keyOf(params)
          if (!this.seen.has(key)) {
            this.seen.add(key)
            this.changes++
          }
        }
        return { getAllSync: () => [] as TRow[] }
      },
      finalizeSync: () => {},
    }
  }
}

// Column order in the INSERT: device_address is index 4, tracker ts 6,
// type byte 10, velocity byte 12 — the compound dedup key from migration 002.
const dedupKey = (p: SqlBindValue[]): string => `${p[4]}|${p[6]}|${p[10]}|${p[12]}`

const evt = (over: Partial<PunchEventInsertInput> = {}): PunchEventInsertInput => ({
  id: 'evt-1',
  sourceFrameId: 'frame-1',
  captureId: 'cap-1',
  deviceId: 'dev-1',
  deviceAddress: 'EA:69:2D:9C:FD:53',
  hand: 'right',
  trackerTimestampMs: 1787456260328,
  receivedMonotonicTimeMs: 1000,
  receivedWallTimeIso: '2026-08-23T03:37:40.471Z',
  punchTypeRaw: 3,
  punchType: 'unknown',
  velocityRaw: 5,
  velocityCalibrated: 1.25,
  velocityUnit: 'tracker-unit',
  recovered: false,
  decoderId: 'fightcamp-v1',
  decoderVersion: '1.0.0',
  qualityFlags: [],
  ...over,
})

describe('PunchEventRepository', () => {
  it('is a no-op for an empty batch and touches no transaction', () => {
    const db = new FakeDb(dedupKey)
    const repo = new PunchEventRepository(db)

    expect(repo.insertMany([])).toEqual({ submitted: 0, inserted: 0, duplicates: 0 })
    expect(db.exec).toEqual([])
  })

  it('wraps a batch in a single BEGIN/COMMIT', () => {
    const db = new FakeDb(dedupKey)
    const repo = new PunchEventRepository(db)

    repo.insertMany([evt({ id: 'a' }), evt({ id: 'b', trackerTimestampMs: 2 })])

    expect(db.exec).toEqual(['BEGIN', 'COMMIT'])
    expect(db.inserts).toHaveLength(2)
  })

  it('counts compound-key duplicates instead of reporting them as inserted', () => {
    const db = new FakeDb(dedupKey)
    const repo = new PunchEventRepository(db)

    // Same device + tracker timestamp + type byte + velocity byte = one punch,
    // even though the surrogate ids and source frames differ (a re-sync).
    const result = repo.insertMany([
      evt({ id: 'a', sourceFrameId: 'f1' }),
      evt({ id: 'b', sourceFrameId: 'f2' }),
      evt({ id: 'c', sourceFrameId: 'f3', trackerTimestampMs: 999 }),
    ])

    expect(result).toEqual({ submitted: 3, inserted: 2, duplicates: 1 })
  })

  it('rolls back and rethrows when the insert fails', () => {
    const db = new FakeDb(dedupKey)
    db.failOnInsert = true
    const repo = new PunchEventRepository(db)

    expect(() => repo.insertMany([evt()])).toThrow('constraint exploded')
    expect(db.exec).toEqual(['BEGIN', 'ROLLBACK'])
  })

  it('serialises quality flags as JSON and booleans as 0/1', () => {
    const db = new FakeDb(dedupKey)
    const repo = new PunchEventRepository(db)

    repo.insertMany([evt({ recovered: true, qualityFlags: ['duringPause'] })])

    const params = db.inserts[0]!
    expect(params[15]).toBe(1) // recovered
    expect(params[18]).toBe('["duringPause"]') // quality_flags
  })

  it('writes undefined optional fields as SQL NULL, not undefined', () => {
    const db = new FakeDb(dedupKey)
    const repo = new PunchEventRepository(db)

    repo.insertMany([
      evt({
        trackerTimestampMs: undefined,
        sequence: undefined,
        punchTypeRaw: undefined,
        velocityRaw: undefined,
        velocityCalibrated: undefined,
      }),
    ])

    const params = db.inserts[0]!
    for (const idx of [6, 9, 10, 12, 13]) {
      expect(params[idx]).toBeNull()
    }
  })
})
