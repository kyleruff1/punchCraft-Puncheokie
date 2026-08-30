# V1c ring / avatar sync — the plan

Kyle's Pass 5 rerun (2026-08-30, commits `21e2091` + `c80f9cc`) landed
the audio wins ("audio sounds vastly improved and consistent and
cleaned up") but broke visual sync. Kyle's observations, verbatim:

- "it no longer syncs with the avatar and ring mapping"
- "it seems like there are interfering maps"
- "still have double ones and only the first ring lighting up"
- "double pumps on each of the ones, then spastic way too fast lighting
  switches randomly, and double pumps"
- "when the clock starts, he should start on the new combo"

## Root cause

**The engine grid lives in ONE place — `CueEngine.fireDueTokens` —
while every OTHER visual consumer still reads the beat grid.**

Concretely:
- `CueEngine.fireDueTokens` (commit `6531e8d`) reads
  `visualOffsetsMs ?? phraseTokenTimesMs ?? tokenOffsetsMs` — rings
  fire on engine slots.
- `RhythmSpine.beatsFor` (line 152) reads
  `phraseTokenTimesMs ?? tokenOffsetsMs` — the avatar frame timing
  and the on-screen beat structure both use the OLD chain, no engine.
- `RhythmSpine.pulsesFor` (line 213) reads `cue.tokenOffsetsMs`
  directly — volume-burst pulses ignore engine offsets entirely.
- `CueMatcher.scheduledMomentMs` (V1c) reads
  `expectedStrikeOffsetsMs ?? tokenOffsetsMs` — scoring uses the
  V1c expected-strike, but that field is unpopulated everywhere
  today (V1c-full's block-authoring migration hasn't landed).

The result on Speed Combos with `metronome.enabled: true`:
- Rings light on engine slots (250 ms steps at sprint).
- Avatar animates on beat-grid slots (137 ms / 275 ms for
  `[0, 0.55]` offsets at engine bpm 240).
- Voice fires on the compiled RhythmMap's own schedule (which
  uses `phraseTokenTimesMs ?? tokenOffsetsMs` — same as spine).

Three different clocks, all pretending to be the same.

## The fix — one shared authority chain

Every visual consumer must resolve token times through the SAME
priority chain the ring engine uses:

    visualOffsetsMs ?? phraseTokenTimesMs ?? tokenOffsetsMs

This is exactly the chain `CueEngine.fireDueTokens` already uses.
Extract it into a helper and share it.

### Concrete diff (three files)

1. **`src/domain/programs/tokenOffsets.ts`** (new, tiny module):
   ```ts
   export function tokenOffsetFor(cue: CueInstance, tokenIndex: number): number {
     return cue.visualOffsetsMs?.[tokenIndex]
         ?? cue.phraseTokenTimesMs?.[tokenIndex]
         ?? cue.tokenOffsetsMs[tokenIndex]
         ?? 0
   }
   export function tokenOffsetsFor(cue: CueInstance): readonly number[] {
     if (cue.visualOffsetsMs) return cue.visualOffsetsMs
     if (cue.phraseTokenTimesMs) return cue.phraseTokenTimesMs
     return cue.tokenOffsetsMs
   }
   ```
   Pure. Zero React/Expo. Testable in isolation.

2. **`RhythmSpine.beatsFor` (line 152)**: swap
   `const offsets = cue.phraseTokenTimesMs ?? cue.tokenOffsetsMs`
   → `const offsets = tokenOffsetsFor(cue)`.
   Avatar frame timing (`avatarFrameMs = combo span / (2 × strikes)`)
   automatically follows because the span is derived from `offsets`.

3. **`CueEngine.fireDueTokens`**: replace the inline ternary with
   `tokenOffsetFor(cue, tokenIndex)`. No behavior change — proves the
   helper matches the ring engine byte-for-byte.

Volume-burst `pulsesFor` (line 213) stays on `cue.tokenOffsetsMs` for
this ship — burst blocks don't get `visualOffsetsMs` populated today,
so nothing changes. If/when count-scored blocks author density, extend
`pulsesFor` to `tokenOffsetsFor(cue)` in a follow-up.

## The other issues Kyle called out

Once the shared-authority chain lands, several observations resolve
automatically:

- **"only the first ring lighting up"** — was the shipped
  `windowEndMs` bug (commit `c80f9cc`). Already fixed. Should hold
  under the shared chain.
- **"double pumps on each of the ones"** — `1-1` combo has two
  tokens both mapped to punch node "1", so the SAME ring lights
  twice per rep. That's authored behavior; not a bug. If it reads
  wrong on-screen, the avatar/ring UI's node dedup rule needs
  authoring — separate ticket.
- **"spastic way too fast lighting switches randomly"** — this is
  the avatar/ring desync described above. Shared chain fixes it.
- **"when the clock starts, he should start on the new combo"** —
  the announce currently fires on `cue-announcing` (a lead time
  BEFORE the cue's scheduledStartMs). If Kyle wants the announce
  ON the bell, that's a different offset — probably
  `voice at scheduledStartMs` instead of `voice at
  scheduledStartMs - announceMs`. Add a `voicePolicy = 'announce-then-work'`-specific offset override.

## Order of operations (single commit)

1. Add `tokenOffsets.ts` helper + tests (pure module).
2. Swap `RhythmSpine.beatsFor` + `CueEngine.fireDueTokens` to use
   the helper.
3. Extend the property-test in `RhythmSpine.test.ts` — a cue with
   `visualOffsetsMs` populated MUST return those exact times from
   `beatsFor` (currently would return `tokenOffsetsMs`).
4. Extend a property-test in `CueEngine.test.ts` — visualOffsetsMs
   still wins over phraseTokenTimesMs + tokenOffsetsMs (regression
   guard on the byte-identity claim).
5. Gates: tsc + jest + lint.
6. On-device: cold-restart, re-run Speed Combos, verify avatar and
   rings now animate on the SAME clock, and the voice track (which
   is on a third clock — the RhythmMap's) stays where it was.

Deferred to a follow-up:
- **Voice-clock alignment**: the compiled RhythmMap does its own
  scheduling. If the announce should fire ON the bell instead of
  the cue-announcing lead, the map compile pass needs to know
  about `voicePolicy = 'announce-then-work'` and shift the map
  event to `scheduledStartMs` instead of `scheduledStartMs -
  announceMs`. Small, but a distinct fix from the visual sync.
- **Count-scored engine offsets** if density authoring lands.

## What to expect on-device after this ship

- Rings and avatar frames tick on the SAME engine grid at engine
  cadences. No more "interfering maps" for engine samples.
- Voice announce still fires ~announceMs before the bell (unchanged
  for now — the deferred follow-up above).
- Legacy samples (technical / steady / non-engine) byte-identical
  to today via the fallback chain.
- Speed Combos, Heavy Hands, Pace Pusher, Three-Round Fundamentals
  all inherit the fix (they're the 4 samples with
  `metronome.enabled: true`).

## Rollback

- Revert the helper's import in `RhythmSpine.beatsFor` (one line)
  to restore the old chain. `CueEngine` and the helper module can
  stay — they're additive.
- Or full revert of the commit if the shared chain has an
  unintended consequence.
