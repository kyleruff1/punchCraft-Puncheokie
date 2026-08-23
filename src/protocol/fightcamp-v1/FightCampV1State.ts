/**
 * FightCampV1 decoder state.
 *
 * The state carries only what the pure decoder needs across frames:
 *   - firmwareMajorVersion — drives the v>=4 vs v<4 record-layout switch
 *     (H11 §Field layout: v>=4 is 9-byte records, v<4 is 13-byte records).
 *   - connectionGeneration — mirrors the transport's connection generation
 *     (§11.5) so downstream stages can bind decoded events to a specific
 *     connection lifetime without the decoder having to touch BLE state.
 *
 * Pure types + pure helpers. No I/O, no side effects, no RN / Expo / BLE
 * / SQLite imports. Do not add any.
 *
 * Spec refs: §11.4 (component boundaries), §15.1 (dependency direction),
 * §16 (decoder / adapter versioning), §21.1–21.2 (protocol adapter shape).
 * Protocol ref: docs/protocol/hypotheses.md H11.
 */

export interface FightCampV1State {
  /**
   * Leading integer of the tracker's Software Revision string, e.g. "4"
   * from "4.2.1". H11 selects the record layout on this value: v>=4 uses
   * a 9-byte record, v<4 uses a 13-byte record.
   */
  firmwareMajorVersion: number
  /**
   * Mirror of ConnectionStatus.generation (§11.5). The decoder is pure —
   * it does not manage this counter, it only propagates it into events
   * that need it.
   */
  connectionGeneration: number
}

/**
 * Initial state used when we have not yet read Device Information
 * Service. We default the firmware to 4 because every v1 tracker we've
 * probed so far reports major version >= 4; if a v<4 tracker appears the
 * caller must read Software Revision and reseed state via
 * `parseFirmwareMajor` before decoding.
 */
export const INITIAL_STATE: FightCampV1State = {
  firmwareMajorVersion: 4,
  connectionGeneration: 0,
}

/**
 * Parse the leading integer of a Software Revision string. Accepts the
 * common forms "4", "4.2", "4.2.1", "3.14"; ignores anything after the
 * first non-digit run. Returns 4 as a safe default when the string is
 * empty, non-numeric, or otherwise unparseable — matches INITIAL_STATE
 * so callers can pass any value they read without special-casing.
 */
export function parseFirmwareMajor(softwareRevision: string): number {
  if (typeof softwareRevision !== 'string' || softwareRevision.length === 0) {
    return 4
  }
  const match = softwareRevision.match(/^\s*(\d+)/)
  if (!match) {
    return 4
  }
  const parsed = Number.parseInt(match[1] as string, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 4
  }
  return parsed
}
