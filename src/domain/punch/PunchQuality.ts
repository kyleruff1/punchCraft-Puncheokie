/**
 * Quality flags that may be attached to a normalized punch event.
 *
 * Spec references: §9.5 (quality metrics), §12.5 (normalized punch event
 * contract), §12.6 (deduplication and gap handling).
 *
 * Pure types only. No runtime code. No RN / Expo / BLE / SQLite imports.
 */

export type PunchQualityFlag =
  | 'malformed'
  | 'duplicate'
  | 'clipped'
  | 'outsideActiveInterval'
  | 'userRejected'
  | 'duringPause'
  | 'recovered'
  | 'calibrationOutOfRange'
  | 'zeroLength'
  | 'unknownType'
