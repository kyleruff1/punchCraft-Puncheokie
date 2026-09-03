/**
 * Minimal typings for prosody.mjs, for the TypeScript tools that consume
 * the spoken-form tables (gen-workout-scripts.ts). Only what they use —
 * the module's full surface stays JS-documented in prosody.mjs itself.
 */
export function spokenFor(
  token: string | number,
  options?: { vocabulary?: 'numbers' | 'techniques'; cadence?: string },
): string

export function isMovement(token: string): boolean
