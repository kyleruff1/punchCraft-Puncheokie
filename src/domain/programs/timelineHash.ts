/**
 * Timeline fingerprint — deterministic content hash for a compiled
 * cue's `strikes[]` + coach event arrays (M39-V2 Phase 3, Kyle
 * amendments 2026-08-30).
 *
 * The V1c "shared authority" idea used `===` reference equality
 * across consumers. That works inside one JS service but doesn't
 * survive worklet copies, serialization to a diagnostic payload, or
 * native-module boundaries. Kyle's amendment: use a portable
 * fingerprint instead.
 *
 *     TimelineIdentity = { revision, cueId, timelineHash }
 *
 * A consumer sharing a timeline shares the same fingerprint. `===`
 * remains a local unit-test convenience.
 *
 * ## Why not `crypto.createHash`
 *
 * React Native / Expo doesn't ship Node's crypto module, and this
 * hash runs in the domain layer (pure TS, no React/Native imports —
 * spec §15.1). A small pure-TS 32-bit hash is enough: the compiled
 * timeline for one cue is tiny (dozens of strikes, at most), so a
 * 32-bit space with rare-in-practice collisions is safe as an
 * identity fingerprint. Two timelines that hash-match are trusted
 * to be equal; two that don't are trusted to differ. A production
 * failure of that trust would fall back on the revision+cueId
 * primary keys and re-compare via the identity comparator below.
 *
 * ## What gets hashed
 *
 * The stable content of the compiled timeline — every field a
 * consumer would notice. Field ORDER matters (JSON serialization
 * with a fixed key order); numeric values are hashed as their
 * `toString()` for portability across JS/native boundaries.
 *
 * Pure. Deterministic. Same input → same output every call.
 */

/**
 * FNV-1a 32-bit — a fast, well-distributed non-cryptographic hash.
 * Public-domain algorithm; no third-party dep. Adequate for this
 * fingerprint use because we're not defending against adversaries.
 */
const FNV_PRIME = 0x01000193 // 2^24 + 2^8 + 0x93
const FNV_OFFSET_BASIS = 0x811c9dc5 // 2166136261

function fnv1a32(bytes: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes.charCodeAt(i)
    // `Math.imul` is the portable 32-bit multiply that survives V8
    // + Hermes + JSC without silently promoting to double precision.
    hash = Math.imul(hash, FNV_PRIME)
  }
  // Force unsigned so `.toString(16)` doesn't sign-extend on
  // negative results.
  return hash >>> 0
}

/**
 * The portable identity of a compiled cue timeline. Consumers that
 * claim to share a timeline share this triple; a mismatch is a hard
 * "these are different" signal even across worklet / native / IPC
 * boundaries.
 */
export interface TimelineIdentity {
  revision: number
  cueId: string
  timelineHash: string
}

/**
 * Hash arbitrary compiled-timeline content into a stable 8-char
 * hex string. Caller decides what to feed in — typically the
 * `strikes[]` + each coach track's `events[]`, JSON-serialized
 * with a fixed key order (achieved via the `stableKeys` helper).
 *
 * Prefixed `'v2:'` so the fingerprint identifies its schema
 * generation — a future breaking change to what gets hashed can
 * migrate to `'v3:'` and stale fingerprints won't collide.
 */
export function hashTimelineContent(content: unknown): string {
  const serialized = stableStringify(content)
  const hash = fnv1a32(serialized).toString(16).padStart(8, '0')
  return `v2:${hash}`
}

/**
 * Deep equality on `TimelineIdentity` — the portable comparator two
 * consumers use to decide "same timeline?". If hashes differ the
 * timelines differ; if hashes match, the revision+cueId is
 * the tie-break so two cues with identical strike content in
 * different rounds still classify distinctly.
 */
export function sameTimelineIdentity(
  a: TimelineIdentity,
  b: TimelineIdentity,
): boolean {
  return (
    a.revision === b.revision &&
    a.cueId === b.cueId &&
    a.timelineHash === b.timelineHash
  )
}

// ---------------------------------------------------------------------------
// Stable JSON serialization — required so the hash of `{a: 1, b: 2}`
// matches the hash of `{b: 2, a: 1}` regardless of object-key
// insertion order. JS's `JSON.stringify` preserves insertion order,
// which is undefined behavior for hashing.
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
    )
    return `{${parts.join(',')}}`
  }
  // functions, symbols, bigints — not part of the compiled timeline shape
  return JSON.stringify(String(value))
}
