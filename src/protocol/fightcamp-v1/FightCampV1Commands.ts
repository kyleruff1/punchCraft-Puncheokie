/**
 * FightCampV1 custom-service UUIDs and mode-command byte tables.
 *
 * Every constant here is transcribed from the decompiled Hykso Android
 * app. See:
 *   - artifacts/reversing/hykso-src/sources/m1/C0477c.java (UUIDs)
 *   - artifacts/reversing/hykso-src/sources/m1/AbstractC0475a.java
 *     (single-byte mode command payloads for the COMMAND1 channel)
 *   - docs/protocol/hypotheses.md H07 / H07-REVISED / H11
 *
 * Pure constants only. No RN / Expo / BLE / SQLite imports. Do not add
 * any.
 *
 * Spec refs: §11.4 (component boundaries), §15.1 (dependency direction),
 * §17.1 (data types), §21.1–21.2 (protocol adapter shape).
 */

/** FightCamp v1 custom primary service. C0477c.java line 63. */
export const FIGHTCAMP_SERVICE_UUID = 'ca280069-5470-4e34-94dd-caf160200b29'

/** Nordic Legacy DFU primary service, present in the tracker's normal
 * firmware (H06). Recognized by inspectGatt() so it can flag firmware-flash
 * feasibility in the adapter's notes without requiring an active DFU flow. */
export const NORDIC_LEGACY_DFU_SERVICE_UUID = '00001530-1212-efde-1523-785feabcd123'

/**
 * The ten custom characteristics under FIGHTCAMP_SERVICE_UUID that the
 * Hykso reference implementation touches. Keys are our internal names —
 * chosen from H07 / H07-REVISED / H11 observations, since the Hykso
 * source only names them by field ordinals.
 *
 *   COMMAND1        (ca281071, read/write)  — mode command channel; single
 *                                              byte from MODE_COMMAND_1_BYTES.
 *   COMMAND2        (ca281072, read/write)  — secondary command channel;
 *                                              single byte from MODE_COMMAND_2_BYTES.
 *   DATA_STREAM     (ca281069, indicate)    — punch event stream (H07-REVISED,
 *                                              H10). This is the ONLY
 *                                              characteristic the decoder
 *                                              accepts frames from.
 *   DEVICE_INFO_READ(ca281070, read)        — fixed device-info blob.
 *   NOTIFY_STATUS   (ca281073, read/notify) — status / heartbeat channel.
 *   CONFIG_1074/5/6                          — configurable device settings
 *                                              (sample rate / sensitivity /
 *                                              hand / LED / sleep timer,
 *                                              guarded behind dev mode).
 *   COMMAND_ACK     (ca281078, indicate)    — command acknowledgements.
 *   LEGACY_COMMAND  (ca281079, write)       — historical "start punch
 *                                              session" channel; H07-REVISED
 *                                              confirmed it is a no-op on
 *                                              current firmware.
 */
export const CHAR = {
  COMMAND1: 'ca281071-5470-4e34-94dd-caf160200b29',
  COMMAND2: 'ca281072-5470-4e34-94dd-caf160200b29',
  DATA_STREAM: 'ca281069-5470-4e34-94dd-caf160200b29',
  DEVICE_INFO_READ: 'ca281070-5470-4e34-94dd-caf160200b29',
  NOTIFY_STATUS: 'ca281073-5470-4e34-94dd-caf160200b29',
  CONFIG_1074: 'ca281074-5470-4e34-94dd-caf160200b29',
  CONFIG_1075: 'ca281075-5470-4e34-94dd-caf160200b29',
  CONFIG_1076: 'ca281076-5470-4e34-94dd-caf160200b29',
  COMMAND_ACK: 'ca281078-5470-4e34-94dd-caf160200b29',
  /** Legacy name for CLOCK_SYNC (ca281079). Kept for existing callers;
   * new code should prefer CLOCK_SYNC. Same UUID, same characteristic. */
  LEGACY_COMMAND: 'ca281079-5470-4e34-94dd-caf160200b29',
  /**
   * Clock-sync write channel — 5 bytes: LE uint32 Unix epoch seconds,
   * followed by one sub-second byte `(millis % 1000) * 256 / 1000`.
   * Hykso writes to this characteristic FIRST in its start-session
   * sequence (`j1/e.java` :g() line 262-268); without this write the
   * tracker sits connected and idle and never emits punch frames.
   * Supersedes the earlier H07-REVISED reading that this channel was
   * a no-op on current firmware.
   */
  CLOCK_SYNC: 'ca281079-5470-4e34-94dd-caf160200b29',
} as const

/**
 * Build the 5-byte clock-sync payload Hykso writes to `CLOCK_SYNC` at the
 * start of every session. Matches the encoding decoded in
 * FightCampV1Decoder — writing `now` here means punch frames report
 * timestamps aligned to `now`.
 */
export function buildClockSyncBytes(nowMs: number): Uint8Array {
  const seconds = Math.floor(nowMs / 1000)
  const millis = nowMs - seconds * 1000
  const subSecond = Math.floor((millis * 256) / 1000) & 0xff
  const bytes = new Uint8Array(5)
  bytes[0] = seconds & 0xff
  bytes[1] = (seconds >>> 8) & 0xff
  bytes[2] = (seconds >>> 16) & 0xff
  bytes[3] = (seconds >>> 24) & 0xff
  bytes[4] = subSecond
  return bytes
}

/** Uint8Array → lowercase hex string (no separators). */
export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0
    out += b.toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Single-byte payloads accepted by COMMAND1 (ca281071). Named per
 * AbstractC0475a.java's static HashMap (Idle / Normal / Gym / Fetch /
 * Test / Normal Kick / Shutdown). Bytes 16 / 17 / 18 are present as
 * `byte[] {16}`, `{17}`, `{18}` constants (fields h/i/j) but not named
 * in the mode-label map — kept here as unnamed16/17/18 so the adapter
 * can still emit them.
 */
export type ModeCommand1 =
  | 'idle'
  | 'normal'
  | 'gym'
  | 'fetch'
  | 'test'
  | 'normalKick'
  | 'shutdown'
  | 'unnamed16'
  | 'unnamed17'
  | 'unnamed18'

export const MODE_COMMAND_1_BYTES: Record<ModeCommand1, number> = {
  idle: 0,
  normal: 1,
  gym: 2,
  fetch: 3,
  test: 4,
  normalKick: 5,
  shutdown: 15,
  unnamed16: 16,
  unnamed17: 17,
  unnamed18: 18,
}

/**
 * Single-byte payloads accepted by COMMAND2 (ca281072). The Hykso source
 * only exercises three values here; their meaning is not yet named.
 */
export type ModeCommand2 = 'zero' | 'one' | 'two'

export const MODE_COMMAND_2_BYTES: Record<ModeCommand2, number> = {
  zero: 0,
  one: 1,
  two: 2,
}
