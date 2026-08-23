/**
 * FightCamp v1 protocol decoder — pure functions, no I/O.
 *
 * Turns a RawBleFrame captured on CHAR.DATA_STREAM (ca281069) into zero
 * or more normalized TrackerPunchEvents. All behavior below is
 * transcribed line-by-line from docs/protocol/hypotheses.md H11, which
 * in turn comes from the decompiled Hykso Android app:
 *   - artifacts/reversing/hykso-src/sources/com/hykso/hyksofit/session/d.java
 *     — the `Punch` class; owns the velocity piecewise curve and the
 *       "is a real punch" / "is power" predicates.
 *   - artifacts/reversing/hykso-src/sources/X/a0.java
 *     — the BroadcastReceiver that splits the notification payload into
 *       fixed-width records (9 bytes for firmware v>=4, 13 bytes for
 *       v<4) before handing each record to `Punch`.
 *
 * Non-negotiables (task brief §Non-negotiables):
 *   - No RN / Expo / SQLite / a BLE library. Type-only imports from
 *     '@ble/bleTypes' and '@/domain/punch/*' are the only cross-package
 *     references.
 *   - velocityUnit is ALWAYS 'tracker-unit' (§4.3). Never claim m/s,
 *     mph, g, force, power, or energy. The literal 'power' can appear
 *     inside punchType — that's a punch classification, not a unit.
 *   - Decoder is versioned. decoderId = 'fightcamp-v1',
 *     decoderVersion = '1.0.0'.
 *   - Every emitted event carries sourceFrameId + decoderId +
 *     decoderVersion + qualityFlags + both velocityRaw and
 *     velocityCalibrated.
 *
 * Spec refs: §4.3 (velocity labeling), §11.4 (component boundaries),
 * §12.5 (normalized punch event contract), §15.1 (dependency direction),
 * §16 (decoder / adapter versioning), §17.1 (data types), §18.2
 * (deterministic decoders), §21.1–21.2 (protocol adapter shape).
 */

import type { RawBleFrame } from '@ble/bleTypes'
import type { PunchType, TrackerPunchEvent } from '@/domain/punch/PunchEvent'
import type { PunchQualityFlag } from '@/domain/punch/PunchQuality'
import type { FightCampV1State } from './FightCampV1State'
import { CHAR, FIGHTCAMP_SERVICE_UUID } from './FightCampV1Commands'

export const DECODER_ID = 'fightcamp-v1'
export const DECODER_VERSION = '1.0.0'

export interface DecodeFrameResult {
  events: TrackerPunchEvent[]
  malformed: boolean
  unknown: boolean
  notes?: string[]
}

/**
 * Decode one BLE frame into zero or more TrackerPunchEvents.
 *
 * Contract (H11):
 *   - Frames not on FIGHTCAMP_SERVICE_UUID / CHAR.DATA_STREAM are
 *     returned as `{ events: [], malformed: false, unknown: true }` with
 *     an explanatory note. This is not an error — the transport may
 *     surface heartbeat / status frames on other characteristics.
 *   - Payload is base64-decoded with a small pure-JS decoder so the
 *     module stays runtime-agnostic (no Node Buffer dependency).
 *   - Record width is 9 bytes when state.firmwareMajorVersion >= 4,
 *     else 13 bytes.
 *   - Payload length not a multiple of the record width →
 *     `{ events: [], malformed: true, unknown: false }` with an
 *     explanatory note. We never throw.
 *   - Otherwise we split the payload into records and decode each
 *     independently. See `decodeRecordV4Plus` / `decodeRecordV3` for
 *     the per-record field layout.
 */
export function decodeFrame(
  frame: RawBleFrame,
  state: FightCampV1State,
): DecodeFrameResult {
  if (
    frame.serviceUuid.toLowerCase() !== FIGHTCAMP_SERVICE_UUID ||
    frame.characteristicUuid.toLowerCase() !== CHAR.DATA_STREAM
  ) {
    return {
      events: [],
      malformed: false,
      unknown: true,
      notes: ['not a fightcamp data-stream frame'],
    }
  }

  let payload: Uint8Array
  try {
    payload = base64ToBytes(frame.valueBase64)
  } catch (err) {
    return {
      events: [],
      malformed: true,
      unknown: false,
      notes: [`base64 decode failed: ${(err as Error).message}`],
    }
  }

  const recordWidth = state.firmwareMajorVersion >= 4 ? 9 : 13
  if (payload.length === 0 || payload.length % recordWidth !== 0) {
    return {
      events: [],
      malformed: true,
      unknown: false,
      notes: [
        `payload length ${payload.length} not a multiple of record width ${recordWidth}`,
      ],
    }
  }

  const events: TrackerPunchEvent[] = []
  const recordCount = payload.length / recordWidth
  for (let i = 0; i < recordCount; i++) {
    const start = i * recordWidth
    const record = payload.subarray(start, start + recordWidth)
    const decoded =
      recordWidth === 9
        ? decodeRecordV4Plus(record)
        : decodeRecordV3(record)

    const qualityFlags: PunchQualityFlag[] = []
    // §12.5 punchType enum has no 'kick'; type 0 and type 5 are
    // Hykso's "not a real punch" markers (see Punch.a() — returns true
    // only when type != 0 && type != 5). We still emit the event so
    // Session can filter; we only flag `unknownType` when the mapping
    // fell through to 'unknown' because the raw enum was out of the
    // known set (i.e. not 0..5).
    if (decoded.punchType === 'unknown' && decoded.punchTypeRaw !== 0 && decoded.punchTypeRaw !== 5) {
      qualityFlags.push('unknownType')
    }

    const event: TrackerPunchEvent = {
      id: `${frame.id}-r${i}`,
      sourceFrameId: frame.id,
      deviceId: frame.deviceId,
      // Hand comes from the connection metadata per H11 — the decoder
      // just forwards what the transport captured.
      hand: frame.handAtCapture,
      trackerTimestampMs: decoded.trackerTimestampMs,
      receivedMonotonicTimeMs: frame.monotonicTimeMs,
      receivedWallTimeIso: frame.wallTimeIso,
      punchTypeRaw: decoded.punchTypeRaw,
      punchType: decoded.punchType,
      // Per task brief: the raw device byte, before any scaling.
      velocityRaw: decoded.velocityByteRaw,
      velocityCalibrated: decoded.velocityCalibrated,
      // §4.3: never claim a physical unit for a raw decoder value.
      velocityUnit: 'tracker-unit',
      recovered: false,
      decoderId: DECODER_ID,
      decoderVersion: DECODER_VERSION,
      qualityFlags,
    }
    events.push(event)
  }

  return { events, malformed: false, unknown: false }
}

// ---------------------------------------------------------------------------
// Per-record decoders
// ---------------------------------------------------------------------------

interface DecodedRecord {
  punchTypeRaw: number
  punchType: PunchType
  accelerationRaw: number
  trackerTimestampMs: number
  velocityByteRaw: number
  velocityCalibrated: number
}

/**
 * v>=4 record layout (9 bytes) — H11 §Field layout, source:
 *   Punch.<init>(byte[]) in com/hykso/hyksofit/session/d.java
 *
 *   byte[0]        : uint8   punchType  (small enum)
 *   byte[1..2]     : uint16  accelerationRaw (LE)
 *   byte[3..6]     : uint32  epochSeconds    (LE, UNSIGNED)
 *   byte[7]        : uint8   subSecondByte   (0..255 → 0..999 ms via *1000/256)
 *   byte[8]        : uint8   velocityByteRaw (piecewise-scaled below)
 *
 * Velocity curve (Punch.b() + piecewise in Punch):
 *   v = velocityByteRaw / 2
 *   if v <= 4  → velocity = v * 0.5
 *   elif v <= 8 → velocity = (v - 4) * 3 + 2
 *   else       → velocity = (v - 8) * 6 + 14
 *   if type in {1, 2} (power) → velocity *= 1.7
 */
function decodeRecordV4Plus(bytes: Uint8Array): DecodedRecord {
  const b0 = bytes[0] as number
  const b1 = bytes[1] as number
  const b2 = bytes[2] as number
  const b3 = bytes[3] as number
  const b4 = bytes[4] as number
  const b5 = bytes[5] as number
  const b6 = bytes[6] as number
  const b7 = bytes[7] as number
  const b8 = bytes[8] as number

  const punchTypeRaw = b0
  const accelerationRaw = b1 | (b2 << 8)

  // Force UNSIGNED 32-bit interpretation. `x >>> 0` on the OR'd bytes
  // would clobber the top bit as signed; we build the value in
  // floating point instead so the epoch stays correct past 2038.
  const epochSeconds =
    b3 + b4 * 0x100 + b5 * 0x10000 + b6 * 0x1000000

  const subSecondByte = b7
  const trackerTimestampMs =
    epochSeconds * 1000 + Math.floor((subSecondByte * 1000) / 256)

  const velocityByteRaw = b8
  const vRaw = velocityByteRaw / 2
  let velocity: number
  if (vRaw <= 4) {
    velocity = vRaw * 0.5
  } else if (vRaw <= 8) {
    velocity = (vRaw - 4) * 3 + 2
  } else {
    velocity = (vRaw - 8) * 6 + 14
  }
  if (punchTypeRaw === 1 || punchTypeRaw === 2) {
    velocity = velocity * 1.7
  }

  return {
    punchTypeRaw,
    punchType: mapType(punchTypeRaw),
    accelerationRaw,
    trackerTimestampMs,
    velocityByteRaw,
    velocityCalibrated: velocity,
  }
}

/**
 * v<4 record layout (13 bytes) — H11 §Field layout. Kept for legacy
 * firmware; every tracker we've probed reports v>=4.
 *
 *   byte[0]        : uint8   punchType
 *   byte[1]        : (reserved / unused)
 *   byte[2..3]     : uint16  accelerationRaw (LE)
 *   byte[4..7]     : uint32  epochSeconds    (LE, UNSIGNED)
 *   byte[8]        : uint8   subSecondByte
 *   byte[9..10]    : (reserved / unused)
 *   byte[11]       : uint8   velocityByteRaw (raw / 2, no piecewise,
 *                                              no power boost)
 *   byte[12]       : (reserved / unused)
 */
function decodeRecordV3(bytes: Uint8Array): DecodedRecord {
  const b0 = bytes[0] as number
  const b2 = bytes[2] as number
  const b3 = bytes[3] as number
  const b4 = bytes[4] as number
  const b5 = bytes[5] as number
  const b6 = bytes[6] as number
  const b7 = bytes[7] as number
  const b8 = bytes[8] as number
  const b11 = bytes[11] as number

  const punchTypeRaw = b0
  const accelerationRaw = b2 | (b3 << 8)
  const epochSeconds =
    b4 + b5 * 0x100 + b6 * 0x10000 + b7 * 0x1000000
  const subSecondByte = b8
  const trackerTimestampMs =
    epochSeconds * 1000 + Math.floor((subSecondByte * 1000) / 256)
  const velocityByteRaw = b11
  const velocityCalibrated = velocityByteRaw / 2

  return {
    punchTypeRaw,
    punchType: mapType(punchTypeRaw),
    accelerationRaw,
    trackerTimestampMs,
    velocityByteRaw,
    velocityCalibrated,
  }
}

/**
 * Map the raw punch-type enum to §12.5 PunchType.
 *
 * Hykso source is authoritative only for `type in {1, 2}` = power
 * (Punch.b()) and `type in {0, 5}` = "not a real punch" (Punch.a()).
 * Assignment of types 3 and 4 to specific techniques ('straight',
 * 'uppercut') is a working guess pending an isolated-punch capture;
 * revisit before shipping user-facing technique labels.
 */
function mapType(type: number): PunchType {
  switch (type) {
    case 0:
      return 'unknown'
    case 1:
      return 'power'
    case 2:
      return 'power'
    case 3:
      return 'straight'
    case 4:
      return 'uppercut'
    case 5:
      return 'unknown'
    default:
      return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// Base64 → Uint8Array (pure JS, no Node Buffer)
// ---------------------------------------------------------------------------

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const BASE64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(256)
  for (let i = 0; i < 256; i++) table[i] = -1
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i
  }
  // URL-safe variants map to the same values so we accept both.
  table['-'.charCodeAt(0)] = 62
  table['_'.charCodeAt(0)] = 63
  return table
})()

/**
 * Decode a standard or URL-safe base64 string into a Uint8Array.
 * Ignores ASCII whitespace inside the input. Throws on any other
 * unexpected character so the decoder can flag the frame as malformed
 * rather than silently emit garbage.
 */
function base64ToBytes(input: string): Uint8Array {
  if (typeof input !== 'string') {
    throw new Error('base64 input is not a string')
  }
  // Strip whitespace and padding (padding is not needed to compute
  // length once we know the number of significant chars).
  let significant = 0
  const codes = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) continue
    if (c === 0x3d /* '=' */) continue
    const v = BASE64_LOOKUP[c]
    if (v === undefined || v === -1) {
      throw new Error(`invalid base64 character at position ${i}`)
    }
    codes[significant++] = v
  }

  const outLen = Math.floor((significant * 6) / 8)
  const out = new Uint8Array(outLen)
  let buffer = 0
  let bitsCollected = 0
  let outIndex = 0
  for (let i = 0; i < significant; i++) {
    buffer = (buffer << 6) | (codes[i] as number)
    bitsCollected += 6
    if (bitsCollected >= 8) {
      bitsCollected -= 8
      out[outIndex++] = (buffer >> bitsCollected) & 0xff
    }
  }
  return out
}
