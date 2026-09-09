/**
 * FightCampV1Decoder — golden-byte pin tests.
 *
 * These tests are the source of truth for the decoder's behavior on real
 * probe bytes and on the H11-defined boundaries. They import only the
 * decoder module and the shared BLE type surface — no RN / SQLite / BLE
 * library — to preserve the §15.1 dependency direction.
 */

import type { RawBleFrame } from '../../../ble/bleTypes'
import { decodeFrame } from '../FightCampV1Decoder'
import type { FightCampV1State } from '../FightCampV1State'
import fixture from '../fixtures/spike-mt4wm1d8-fx6x.json'

const PUNCH_SERVICE = 'ca280069-5470-4e34-94dd-caf160200b29'
const PUNCH_CHAR = 'ca281069-5470-4e34-94dd-caf160200b29'

const hexToBase64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64')

interface BuildFrameOpts {
  hex: string
  id?: string
  serviceUuid?: string
  characteristicUuid?: string
  monotonicTimeMs?: number
  wallTimeIso?: string
}

const buildFrame = (opts: BuildFrameOpts): RawBleFrame => ({
  id: opts.id ?? 'frame-test',
  captureId: 'cap-test',
  deviceId: 'EA:69:2D:9C:FD:53',
  handAtCapture: 'unknown',
  monotonicTimeMs: opts.monotonicTimeMs ?? 1000,
  wallTimeIso: opts.wallTimeIso ?? '2026-08-22T21:50:00.000Z',
  direction: 'notification',
  serviceUuid: opts.serviceUuid ?? PUNCH_SERVICE,
  characteristicUuid: opts.characteristicUuid ?? PUNCH_CHAR,
  valueBase64: hexToBase64(opts.hex),
  valueHex: opts.hex,
  connectionGeneration: 1,
})

// The decoder's FightCampV1State uses firmwareMajorVersion (not the
// protocol-adapter-level ProtocolState.firmwareVersion); the adapter
// translates at its boundary.
const v4State = (): FightCampV1State => ({ firmwareMajorVersion: 4, connectionGeneration: 1 })
const legacyState = (): FightCampV1State => ({ firmwareMajorVersion: 3, connectionGeneration: 1 })

describe('FightCampV1Decoder', () => {
  it('decodes the H11 golden sample 011001a0518a6a530a', () => {
    const frame = buildFrame({ hex: '011001a0518a6a530a', id: 'golden' })
    const result = decodeFrame(frame, v4State())

    expect(result.events).toHaveLength(1)
    const event = result.events[0]!
    expect(event.punchTypeRaw).toBe(1)
    // H12: the type byte is not a device-portable technique classifier, so
    // punchType is deliberately 'unknown' for every byte. punchTypeRaw is
    // the honest datum and is asserted above.
    expect(event.punchType).toBe('unknown')
    // H11 had a math error: the LE uint32 0xa0518a6a is 1787449760, which is
    // 2026-08-23T01:49:20 UTC (not 2026-08-22T19:29:20 as first written up).
    // Recomputed and locked in here; H11 note corrected in the same commit.
    expect(event.trackerTimestampMs).toBe(new Date('2026-08-23T01:49:20.324Z').getTime())
    expect(event.velocityRaw).toBe(10)
    expect(event.velocityCalibrated).toBeCloseTo(8.5, 9)
    expect(event.velocityUnit).toBe('tracker-unit')
    // Bytes 1-2 LE: 0x10 + 0x01*256 = 272 — promoted onto the event
    // verbatim (instrument-design §14, migration 008).
    expect(event.accelerationRaw).toBe(272)
    expect(event.sourceFrameId).toBe('golden')
    expect(event.decoderId).toBe('fightcamp-v1')
    expect(event.decoderVersion).toBe('1.0.0')
    expect(Array.isArray(event.qualityFlags)).toBe(true)
  })

  describe('buffer drains are marked recovered, not live (2026-08-29)', () => {
    // The golden sample's device timestamp is 2026-08-23T01:49:20.324Z;
    // each case below varies only the frame's ARRIVAL time around it.
    const at = (iso: string) =>
      decodeFrame(buildFrame({ hex: '011001a0518a6a530a', wallTimeIso: iso }), v4State())
        .events[0]!

    it('a punch that arrives promptly is live', () => {
      // Air latency and the 3.9ms timestamp quantization live in here.
      expect(at('2026-08-23T01:49:20.500Z').recovered).toBe(false)
      expect(at('2026-08-23T01:49:22.000Z').recovered).toBe(false)
    })

    it('a punch drained from the tracker seconds later is recovered', () => {
      // The measured case: records surfacing 22-66s after they were
      // thrown, when a reconnect writes mode-normal.
      expect(at('2026-08-23T01:49:42.324Z').recovered).toBe(true)
      expect(at('2026-08-23T01:50:26.324Z').recovered).toBe(true)
    })

    it('leaves a punch live when the call cannot be made', () => {
      // Undecidable inputs must not silently drop a real punch out of
      // scoring: an unparseable arrival time stays live...
      expect(at('not-a-timestamp').recovered).toBe(false)
      // ...as does a device clock running AHEAD of the host's.
      expect(at('2026-08-23T01:49:00.000Z').recovered).toBe(false)
    })

    it('marks every record of a multi-record drain', () => {
      const result = decodeFrame(
        buildFrame({
          hex: '05bd006f518a6a86040570006f518a6abc04',
          wallTimeIso: '2026-08-23T02:30:00.000Z',
        }),
        v4State(),
      )
      expect(result.events.map((e) => e.recovered)).toEqual([true, true])
    })
  })

  it('splits 18-byte payload into two 9-byte records', () => {
    const frame = buildFrame({ hex: '05bd006f518a6a86040570006f518a6abc04', id: 'multi' })
    const result = decodeFrame(frame, v4State())

    expect(result.events).toHaveLength(2)
    expect(result.events[0]!.id).toBe('multi-r0')
    expect(result.events[1]!.id).toBe('multi-r1')
    expect(result.events[0]!.sourceFrameId).toBe('multi')
    expect(result.events[1]!.sourceFrameId).toBe('multi')
    // Each record keeps its own acceleration: 0xbd = 189, 0x70 = 112.
    expect(result.events[0]!.accelerationRaw).toBe(189)
    expect(result.events[1]!.accelerationRaw).toBe(112)
  })

  it('flags malformed on odd-length payload', () => {
    const frame = buildFrame({ hex: 'deadbeef', id: 'garbage' })
    const result = decodeFrame(frame, v4State())

    expect(result.events).toHaveLength(0)
    expect(result.malformed).toBe(true)
    expect(result.unknown).toBe(false)
  })

  it('skips frames not on the ca281069 characteristic', () => {
    const frame = buildFrame({
      hex: '011001a0518a6a530a',
      id: 'batt',
      serviceUuid: '0000180f-0000-1000-8000-00805f9b34fb',
      characteristicUuid: '00002a19-0000-1000-8000-00805f9b34fb',
    })
    const result = decodeFrame(frame, v4State())

    expect(result.events).toHaveLength(0)
    expect(result.unknown).toBe(true)
  })

  it('never claims a technique — punchType is "unknown" for every type byte (H12)', () => {
    // The type byte is not a device-portable classifier: the same technique
    // yields different bytes on different trackers. punchTypeRaw is the
    // honest datum; punchType must not invent a label from it.
    for (const byte of [0, 1, 2, 3, 4, 5, 6, 7, 255]) {
      const hex = `${byte.toString(16).padStart(2, '0')}1001a0518a6a530a`
      const result = decodeFrame(buildFrame({ hex, id: `t-${byte}` }), v4State())
      expect(result.events).toHaveLength(1)
      const event = result.events[0]!
      expect(event.punchTypeRaw).toBe(byte)
      expect(event.punchType).toBe('unknown')
    }
  })

  it('applies the vendor ×1.7 multiplier for type bytes 1 and 2 but not 3', () => {
    // velocityRaw byte = 10 → v = 5.0 → piecewise = 5.0
    // type in {1,2} → *= 1.7 → 8.5; type 3 → stays 5.0
    const mkHex = (t: string) => `${t}1001a0518a6a530a`
    const type1 = decodeFrame(buildFrame({ hex: mkHex('01'), id: 't1' }), v4State())
    const type2 = decodeFrame(buildFrame({ hex: mkHex('02'), id: 't2' }), v4State())
    const type3 = decodeFrame(buildFrame({ hex: mkHex('03'), id: 't3' }), v4State())

    expect(type1.events[0]!.velocityCalibrated).toBeCloseTo(8.5, 9)
    expect(type2.events[0]!.velocityCalibrated).toBeCloseTo(8.5, 9)
    expect(type3.events[0]!.velocityCalibrated).toBeCloseTo(5.0, 9)
  })

  it('piecewise velocity scaling at boundaries', () => {
    // The H11 formula operates on v = raw / 2.0 with boundaries at v<=4 and v<=8.
    // Raw byte 8 → v=4 (low boundary) → 4 * 0.5 = 2.0
    // Raw byte 16 → v=8 (mid boundary) → (8-4)*3 + 2 = 14.0
    // Raw byte 32 → v=16 (large) → (16-8)*6 + 14 = 62.0
    // Use type 3 to avoid the ×1.7 power boost.
    const mk = (velByte: string) => `031001a0518a6a53${velByte}`
    const low = decodeFrame(buildFrame({ hex: mk('08'), id: 'low' }), v4State())
    const mid = decodeFrame(buildFrame({ hex: mk('10'), id: 'mid' }), v4State())
    const hi = decodeFrame(buildFrame({ hex: mk('20'), id: 'hi' }), v4State())

    expect(low.events[0]!.velocityCalibrated).toBeCloseTo(2.0, 9)
    expect(mid.events[0]!.velocityCalibrated).toBeCloseTo(14.0, 9)
    expect(hi.events[0]!.velocityCalibrated).toBeCloseTo(62.0, 9)
  })

  it('iterates the whole fixture and produces >= 22 events with all-numeric timestamps', () => {
    let total = 0
    for (const record of fixture.records) {
      const frame = buildFrame({ hex: record.valueHex, id: `fx-${record.seq}` })
      const result = decodeFrame(frame, v4State())
      for (const event of result.events) {
        total += 1
        expect(typeof event.trackerTimestampMs).toBe('number')
        expect(event.trackerTimestampMs).toBeGreaterThan(0)
      }
    }
    expect(total).toBeGreaterThanOrEqual(22)
  })

  it('(v<4) parses a synthetic 13-byte legacy record', () => {
    // Legacy layout: byte 0 type, bytes 2..3 accel LE, bytes 4..7 epoch LE,
    // byte 8 subSecond, byte 11 velocityRaw (simple raw/2.0, no piecewise).
    //  0  1  2  3    4  5  6  7    8  9 10  11 12
    // 03 00 64 00   a0 51 8a 6a   00 00 00  08 00
    const hex = '030064' + '00' + 'a0518a6a' + '00' + '000008' + '00'
    const frame = buildFrame({ hex, id: 'legacy' })
    const result = decodeFrame(frame, legacyState())

    expect(result.events).toHaveLength(1)
    const event = result.events[0]!
    expect(event.punchTypeRaw).toBe(3)
    expect(event.velocityRaw).toBe(8)
    expect(event.velocityCalibrated).toBeCloseTo(4.0, 9)
    expect(event.velocityUnit).toBe('tracker-unit')
    // Legacy layout reads accel from bytes 2-3 LE: 0x64 = 100.
    expect(event.accelerationRaw).toBe(100)
  })
})
