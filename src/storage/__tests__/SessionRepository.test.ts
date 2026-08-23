/**
 * SessionRepository — round-trip fidelity, ordering, cascade behaviour, and
 * the read-only boundary around `session_metrics`.
 *
 * Runs against a real in-memory SQLite (node:sqlite, no new dependency) with
 * migrations 001–003 applied, so constraints and cascades are exercised for
 * real rather than simulated (§21).
 */

import { readFileSync } from 'node:fs'

import {
  SessionRepository,
  type SessionPunchEventInput,
} from '@storage/repositories/SessionRepository'

import { createMigratedDb, type MemoryDb } from './helpers/memoryDb'

let db: MemoryDb
let repo: SessionRepository

beforeEach(() => {
  db = createMigratedDb()
  repo = new SessionRepository(db)
})

afterEach(() => {
  db.close()
})

const punch = (over: Partial<SessionPunchEventInput> = {}): SessionPunchEventInput => ({
  id: 'evt-1',
  sourceFrameId: 'frame-1',
  captureId: null,
  deviceId: null,
  deviceAddress: 'EA:69:2D:9C:FD:53',
  hand: 'right',
  trackerTimestampMs: 1787456260328,
  receivedMonotonicTimeMs: 1000,
  receivedWallTimeIso: '2026-08-23T03:37:40.471Z',
  sequence: 7,
  punchTypeRaw: 3,
  punchType: 'unknown',
  velocityRaw: 5,
  velocityCalibrated: 1.25,
  velocityUnit: 'tracker-unit',
  recovered: false,
  decoderId: 'fightcamp-v1',
  decoderVersion: '1.0.0',
  qualityFlags: ['duringPause'],
  sessionId: 's1',
  roundId: null,
  calibrationProfileId: 'cal-right-1',
  rejectionReason: null,
  ...over,
})

describe('create / getById', () => {
  it('round-trips every session field', () => {
    const created = repo.create({
      id: 's1',
      mode: 'puncheokie',
      status: 'ready',
      startedAtIso: '2026-08-23T03:00:00.000Z',
      startedMonotonicMs: 12_345.5,
      activeDurationMs: 0,
      timerConfigJson: '{"rounds":3,"workMs":180000,"restMs":60000}',
      generatedWorkoutId: 'gw-1',
      spotifyPlaylistId: 'spotify:playlist:abc',
      leftCalibrationId: 'cal-left-1',
      rightCalibrationId: 'cal-right-1',
      notes: 'first real run',
    })

    expect(repo.getById('s1')).toEqual(created)
    expect(created).toEqual({
      id: 's1',
      mode: 'puncheokie',
      status: 'ready',
      startedAt: '2026-08-23T03:00:00.000Z',
      endedAt: null,
      startedMonotonicMs: 12_345.5,
      endedMonotonicMs: null,
      activeDurationMs: 0,
      timerConfigJson: '{"rounds":3,"workMs":180000,"restMs":60000}',
      generatedWorkoutId: 'gw-1',
      spotifyPlaylistId: 'spotify:playlist:abc',
      leftCalibrationId: 'cal-left-1',
      rightCalibrationId: 'cal-right-1',
      notes: 'first real run',
      quality: {
        duplicatesSuppressed: 0,
        rejectedEvents: 0,
        unmatchedEvents: 0,
        malformedEvents: 0,
      },
      createdAt: expect.any(String),
    })
  })

  it('defaults an unspecified session to configuring with null optionals', () => {
    const s = repo.create({ id: 's2', mode: 'velocity-test' })
    expect(s.status).toBe('configuring')
    expect(s.generatedWorkoutId).toBeNull()
    expect(s.timerConfigJson).toBeNull()
    expect(s.activeDurationMs).toBe(0)
  })

  it('generates a unique id when none is supplied', () => {
    const a = repo.create({ mode: 'punchcraft' })
    const b = repo.create({ mode: 'punchcraft' })
    expect(a.id).not.toBe(b.id)
    expect(repo.getById(a.id)?.id).toBe(a.id)
  })

  it('returns null for an unknown id', () => {
    expect(repo.getById('nope')).toBeNull()
  })
})

describe('list', () => {
  beforeEach(() => {
    repo.create({ id: 'old', mode: 'punchcraft', status: 'completed', startedMonotonicMs: 100 })
    repo.create({ id: 'new', mode: 'puncheokie', status: 'completed', startedMonotonicMs: 900 })
    repo.create({ id: 'never-started', mode: 'puncheokie', status: 'cancelled' })
  })

  it('orders by the monotonic start, most recent first, unstarted last', () => {
    expect(repo.list().map((s) => s.id)).toEqual(['new', 'old', 'never-started'])
  })

  it('filters by mode and by status', () => {
    expect(repo.list({ mode: 'puncheokie' }).map((s) => s.id)).toEqual(['new', 'never-started'])
    expect(repo.list({ status: 'cancelled' }).map((s) => s.id)).toEqual(['never-started'])
  })

  it('paginates', () => {
    expect(repo.list({ limit: 1 }).map((s) => s.id)).toEqual(['new'])
    expect(repo.list({ limit: 1, offset: 1 }).map((s) => s.id)).toEqual(['old'])
  })
})

describe('markEnded', () => {
  it('writes the final status, wall end, monotonic end and active duration', () => {
    repo.create({ id: 's1', mode: 'punchcraft', status: 'work', startedMonotonicMs: 1000 })
    const ended = repo.markEnded({
      id: 's1',
      status: 'completed',
      endedAtIso: '2026-08-23T03:20:00.000Z',
      endedMonotonicMs: 1_201_000,
      activeDurationMs: 540_000,
    })
    expect(ended).toMatchObject({
      status: 'completed',
      endedAt: '2026-08-23T03:20:00.000Z',
      endedMonotonicMs: 1_201_000,
      activeDurationMs: 540_000,
    })
  })

  it('returns null for an unknown session', () => {
    expect(
      repo.markEnded({
        id: 'nope',
        status: 'completed',
        endedAtIso: 't',
        endedMonotonicMs: 1,
        activeDurationMs: 1,
      }),
    ).toBeNull()
  })
})

describe('appendRound', () => {
  beforeEach(() => {
    repo.create({ id: 's1', mode: 'punchcraft', status: 'work' })
  })

  it('round-trips every round field', () => {
    const round = repo.appendRound({
      id: 'r1',
      sessionId: 's1',
      roundNumber: 1,
      workStartedAtIso: '2026-08-23T03:00:00.000Z',
      workEndedAtIso: '2026-08-23T03:03:00.000Z',
      restStartedAtIso: '2026-08-23T03:03:00.000Z',
      restEndedAtIso: '2026-08-23T03:04:00.000Z',
      workStartedMonotonicMs: 1000,
      workEndedMonotonicMs: 181_000,
      restStartedMonotonicMs: 181_000,
      restEndedMonotonicMs: 241_000,
    })
    expect(repo.getRoundById('r1')).toEqual(round)
    expect(round).toEqual({
      id: 'r1',
      sessionId: 's1',
      roundNumber: 1,
      workStartedAt: '2026-08-23T03:00:00.000Z',
      workEndedAt: '2026-08-23T03:03:00.000Z',
      restStartedAt: '2026-08-23T03:03:00.000Z',
      restEndedAt: '2026-08-23T03:04:00.000Z',
      workStartedMonotonicMs: 1000,
      workEndedMonotonicMs: 181_000,
      restStartedMonotonicMs: 181_000,
      restEndedMonotonicMs: 241_000,
    })
  })

  it('numbers rounds sequentially when no number is given', () => {
    repo.appendRound({ sessionId: 's1' })
    repo.appendRound({ sessionId: 's1' })
    repo.appendRound({ sessionId: 's1' })
    expect(repo.listRounds('s1').map((r) => r.roundNumber)).toEqual([1, 2, 3])
  })

  it('refuses a round on a session that does not exist', () => {
    expect(() => repo.appendRound({ sessionId: 'ghost' })).toThrow(/FOREIGN KEY/i)
  })
})

describe('appendPunchEvent', () => {
  beforeEach(() => {
    repo.create({ id: 's1', mode: 'puncheokie', status: 'work' })
  })

  it('round-trips every punch-event field, including the migration-002 columns', () => {
    repo.appendPunchEvent(punch())
    const [stored] = repo.listPunchEvents('s1')
    expect(stored).toEqual(punch())
  })

  it('stores an undefined optional as SQL NULL and reads it back as undefined', () => {
    repo.appendPunchEvent(
      punch({
        trackerTimestampMs: undefined,
        sequence: undefined,
        punchTypeRaw: undefined,
        punchType: undefined,
        velocityRaw: undefined,
        velocityCalibrated: undefined,
      }),
    )
    const stored = repo.listPunchEvents('s1')[0]!
    expect(stored.trackerTimestampMs).toBeUndefined()
    expect(stored.sequence).toBeUndefined()
    expect(stored.velocityCalibrated).toBeUndefined()
    // velocity_unit is never optional (§4.3).
    expect(stored.velocityUnit).toBe('tracker-unit')
  })

  it('links an event to a round and filters by it', () => {
    const round = repo.appendRound({ id: 'r1', sessionId: 's1' })
    repo.appendPunchEvent(punch({ id: 'in-round', roundId: round.id }))
    repo.appendPunchEvent(punch({ id: 'no-round', trackerTimestampMs: 2 }))
    expect(repo.listPunchEvents('s1', { roundId: 'r1' }).map((e) => e.id)).toEqual(['in-round'])
  })

  it('orders events by monotonic time, not by insertion or wall time', () => {
    repo.appendPunchEvent(
      punch({ id: 'late', receivedMonotonicTimeMs: 5000, trackerTimestampMs: 5 }),
    )
    repo.appendPunchEvent(
      punch({ id: 'early', receivedMonotonicTimeMs: 100, trackerTimestampMs: 1 }),
    )
    expect(repo.listPunchEvents('s1').map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('keeps a rejected event queryable and can filter it out', () => {
    repo.appendPunchEvent(punch({ id: 'ok' }))
    repo.appendPunchEvent(
      punch({ id: 'rejected', trackerTimestampMs: 2, rejectionReason: 'outside-work-interval' }),
    )
    expect(repo.listPunchEvents('s1')).toHaveLength(2)
    expect(repo.listPunchEvents('s1', { includeRejected: false }).map((e) => e.id)).toEqual(['ok'])
    expect(repo.listPunchEvents('s1')[1]?.rejectionReason).toBe('outside-work-interval')
  })

  it('rejects a reason code outside the documented §18.2 enum', () => {
    expect(() =>
      repo.appendPunchEvent(
        punch({
          // Outside the enum. OR IGNORE would silently drop the CHECK
          // violation, so the repository has to catch this itself.
          rejectionReason: 'vibes' as never,
        }),
      ),
    ).toThrow(/unknown rejection_reason "vibes"/)
    expect(repo.listPunchEvents('s1')).toHaveLength(0)
  })

  it('suppresses a compound-key duplicate and counts it instead of raising', () => {
    expect(repo.appendPunchEvent(punch({ id: 'a' }))).toEqual({ inserted: true, duplicate: false })
    // Same device + tracker timestamp + type byte + velocity byte = one punch.
    expect(repo.appendPunchEvent(punch({ id: 'b', sourceFrameId: 'frame-2' }))).toEqual({
      inserted: false,
      duplicate: true,
    })
    expect(repo.listPunchEvents('s1')).toHaveLength(1)
    expect(repo.getById('s1')?.quality.duplicatesSuppressed).toBe(1)
  })

  it('counts a rejected event, and a decoder-invalid one as malformed too', () => {
    repo.appendPunchEvent(punch({ id: 'r1', rejectionReason: 'unexpected-tracker' }))
    repo.appendPunchEvent(
      punch({ id: 'r2', trackerTimestampMs: 2, rejectionReason: 'decoder-invalid' }),
    )
    expect(repo.getById('s1')?.quality).toEqual({
      duplicatesSuppressed: 0,
      rejectedEvents: 2,
      unmatchedEvents: 0,
      malformedEvents: 1,
    })
  })
})

describe('quality counters', () => {
  it('accumulates counters additively', () => {
    repo.create({ id: 's1', mode: 'puncheokie', status: 'work' })
    repo.addQualityCounters('s1', { unmatchedEvents: 2 })
    repo.addQualityCounters('s1', { unmatchedEvents: 3, rejectedEvents: 1 })
    expect(repo.getById('s1')?.quality).toEqual({
      duplicatesSuppressed: 0,
      rejectedEvents: 1,
      unmatchedEvents: 5,
      malformedEvents: 0,
    })
  })

  it('round-trips per-tracker gap totals and replaces them on re-upsert', () => {
    repo.create({ id: 's1', mode: 'puncheokie', status: 'work' })
    repo.upsertTrackerQuality({
      sessionId: 's1',
      trackerKey: 'EA:69:2D:9C:FD:53',
      hand: 'right',
      gapCount: 2,
      gapTotalMs: 480.5,
      reconnectCount: 1,
      updatedAtIso: '2026-08-23T03:10:00.000Z',
    })
    repo.upsertTrackerQuality({
      sessionId: 's1',
      trackerKey: 'D1:11:11:11:11:11',
      hand: 'left',
      gapCount: 0,
      gapTotalMs: 0,
      updatedAtIso: '2026-08-23T03:10:00.000Z',
    })
    repo.upsertTrackerQuality({
      sessionId: 's1',
      trackerKey: 'EA:69:2D:9C:FD:53',
      hand: 'right',
      gapCount: 3,
      gapTotalMs: 900,
      reconnectCount: 2,
      updatedAtIso: '2026-08-23T03:12:00.000Z',
    })

    const rows = repo.listTrackerQuality('s1')
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.trackerKey === 'EA:69:2D:9C:FD:53')).toEqual({
      sessionId: 's1',
      trackerKey: 'EA:69:2D:9C:FD:53',
      deviceId: null,
      hand: 'right',
      gapCount: 3,
      gapTotalMs: 900,
      reconnectCount: 2,
      updatedAt: '2026-08-23T03:12:00.000Z',
    })
  })
})

describe('session_metrics reads', () => {
  beforeEach(() => {
    repo.create({ id: 's1', mode: 'punchcraft', status: 'completed' })
    repo.appendRound({ id: 'r1', sessionId: 's1', roundNumber: 1 })
    // M22-03 owns these writes; this test seeds them directly, exactly as the
    // MetricsEngine seam will.
    db.execSync(`
      INSERT INTO session_metrics (id, session_id, round_id, metric_key, metric_value, metric_unit, calculation_version, calculated_at)
        VALUES ('m1','s1',NULL,'punch_count',120,'count','1.0.0','2026-08-23T03:20:00.000Z'),
               ('m2','s1',NULL,'punch_count',118,'count','2.0.0','2026-08-23T04:00:00.000Z'),
               ('m3','s1','r1','punch_count',40,'count','1.0.0','2026-08-23T03:20:00.000Z');
    `)
  })

  it('reads every metric row for a session with its calculation version', () => {
    const all = repo.listMetrics('s1')
    expect(all).toHaveLength(3)
    expect(all.find((m) => m.id === 'm3')).toEqual({
      id: 'm3',
      sessionId: 's1',
      roundId: 'r1',
      metricKey: 'punch_count',
      metricValue: 40,
      metricUnit: 'count',
      calculationVersion: '1.0.0',
      calculatedAt: '2026-08-23T03:20:00.000Z',
    })
    expect(all.find((m) => m.id === 'm1')?.roundId).toBeNull()
  })

  it('scopes to the session (round_id NULL) or to one round', () => {
    expect(
      repo
        .listMetrics('s1', { roundId: null })
        .map((m) => m.id)
        .sort(),
    ).toEqual(['m1', 'm2'])
    expect(repo.listMetrics('s1', { roundId: 'r1' }).map((m) => m.id)).toEqual(['m3'])
  })

  it('filters by calculation version and picks the highest by default', () => {
    expect(repo.listMetrics('s1', { calculationVersion: '2.0.0' }).map((m) => m.id)).toEqual(['m2'])
    expect(repo.getMetric('s1', 'punch_count', { roundId: null })?.calculationVersion).toBe('2.0.0')
    expect(
      repo.getMetric('s1', 'punch_count', { roundId: null, calculationVersion: '1.0.0' })?.id,
    ).toBe('m1')
    expect(repo.getMetric('s1', 'nothing_here')).toBeNull()
  })

  it('exposes no write path for session_metrics — M22-03 owns those writes', () => {
    const source = readFileSync(require.resolve('@storage/repositories/SessionRepository'), 'utf8')
    expect(source).not.toMatch(/INTO\s+session_metrics/i)
    expect(source).not.toMatch(/UPDATE\s+session_metrics/i)
    expect(source).not.toMatch(/DELETE\s+FROM\s+session_metrics/i)
  })
})

describe('delete', () => {
  const seed = (): void => {
    db.execSync(`
      INSERT INTO ble_captures (id, started_at) VALUES ('cap1','t');
      INSERT INTO ble_frames
        (id, capture_id, monotonic_time_ms, wall_time_iso, direction, service_uuid,
         characteristic_uuid, value_base64, value_hex, connection_generation)
        VALUES ('frame-1','cap1',1,'t','notification','svc','chr','AA==','00',1);
    `)
    repo.create({ id: 's1', mode: 'puncheokie', status: 'completed' })
    repo.create({ id: 's2', mode: 'puncheokie', status: 'completed' })
    repo.appendRound({ id: 'r1', sessionId: 's1' })
    repo.appendPunchEvent(punch({ roundId: 'r1', captureId: 'cap1' }))
    repo.upsertTrackerQuality({ sessionId: 's1', trackerKey: 'EA:69:2D:9C:FD:53' })
    db.execSync(`
      INSERT INTO session_metrics (id, session_id, round_id, metric_key, metric_value, metric_unit, calculation_version, calculated_at)
        VALUES ('m1','s1',NULL,'punch_count',10,'count','1.0.0','t');
    `)
  }

  it('cascades to rounds, punch_events, metrics and quality counters', () => {
    seed()
    expect(repo.delete('s1')).toBe(true)

    expect(repo.getById('s1')).toBeNull()
    expect(db.count('SELECT COUNT(*) AS n FROM rounds')).toBe(0)
    expect(db.count('SELECT COUNT(*) AS n FROM punch_events')).toBe(0)
    expect(db.count('SELECT COUNT(*) AS n FROM session_metrics')).toBe(0)
    expect(db.count('SELECT COUNT(*) AS n FROM session_tracker_quality')).toBe(0)
  })

  it('never deletes the raw frames or the capture the events came from', () => {
    seed()
    repo.delete('s1')

    expect(db.count('SELECT COUNT(*) AS n FROM ble_frames')).toBe(1)
    expect(db.count('SELECT COUNT(*) AS n FROM ble_captures')).toBe(1)
  })

  it('leaves other sessions alone and reports a miss', () => {
    seed()
    repo.delete('s1')
    expect(repo.getById('s2')).not.toBeNull()
    expect(repo.delete('ghost')).toBe(false)
  })
})
