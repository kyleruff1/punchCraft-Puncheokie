/**
 * The avatar's lead track (Kyle, on-glass 2026-09-02): the round's punch
 * schedule, read AHEAD of the work clock by a fixed offset so the figure
 * demonstrates each form before its node lights — "a trainer training,
 * between the voice and the avatar showing."
 *
 * A pure TIME-SHIFT, never an acceleration: every entry keeps the exact
 * due times and windows the nodes walk; the reader simply samples the
 * track at `workElapsedMs + leadMs`. The consumer (PunchAvatarCard via
 * CueStage) runs its unchanged strike→retract→guard cycle on whatever
 * entry it is handed, so windows, flip durations and guard parks are all
 * untouched.
 *
 * Ordering doctrine preserved by construction: the lead is a constant,
 * the cursor is monotonic, and sampling can only ever run BEHIND the
 * shifted clock under load — the avatar cannot run further ahead than
 * the authored lead and cannot lap a rep.
 */
import type { CueInstance } from './CueTimeline'

/** One punch occurrence on the round's track, in work-clock ms. */
export interface AvatarTrackEntry {
  cueId: string
  tokenIndex: number
  dueMs: number
}

/**
 * Flatten a round's sequence cues into the chronological punch track —
 * the same `scheduledStartMs + tokenOffsetsMs[i]` moments the walk
 * lights nodes on.
 */
export function buildAvatarTrack(cues: readonly CueInstance[]): AvatarTrackEntry[] {
  const entries: AvatarTrackEntry[] = []
  for (const cue of cues) {
    if (cue.scoring !== 'sequence') continue
    cue.tokens.forEach((token, tokenIndex) => {
      if (token.kind !== 'punch') return
      entries.push({
        cueId: cue.id,
        tokenIndex,
        dueMs: cue.scheduledStartMs + (cue.tokenOffsetsMs[tokenIndex] ?? 0),
      })
    })
  }
  entries.sort((a, b) => a.dueMs - b.dueMs)
  return entries
}

/**
 * The entry the avatar should be demonstrating at `workElapsedMs`, with
 * the track shifted `leadMs` ahead: the LAST punch whose due time is
 * within the shifted clock. `fromIndex` is the monotonic cursor from the
 * previous sample — pass the returned index back in to stay O(1) per
 * tick. Returns -1 before the first entry comes into lead range.
 */
export function avatarTargetIndex(
  entries: readonly AvatarTrackEntry[],
  workElapsedMs: number,
  leadMs: number,
  fromIndex: number,
): number {
  const shifted = workElapsedMs + leadMs
  let index = Math.max(-1, fromIndex)
  while (index + 1 < entries.length && entries[index + 1]!.dueMs <= shifted) {
    index += 1
  }
  return index
}
