# Voice reference provenance

`cornerman-reference.wav` is the voice-cloning reference for the Coach voice.
Every rendered clip inherits its character from this file, so its licensing is
the licensing of the shipped audio — which is why the chain is recorded here
rather than left in a commit message.

## Source

| | |
|---|---|
| Origin | **Original recording by Kyle Ruff**, the project owner, performing the coach |
| Recorded | 2026-08-24 |
| Source file | `chatterbox_boxing_coach.wav` — 30.4s, 16 kHz mono |
| Extract | 4.65 s – 20.65 s (16 s), resampled to 24 kHz mono |
| SHA-256 | `0e43cae5002b3a307526ec4388b3776b7fdec079556fe0c43bf450720a06ed81` |

The extract skips 4.65 s of leading silence and takes sixteen seconds of
continuous speech — comfortably inside the 7–20 s Chatterbox clones best from.
Reproduce with:

```bash
ffmpeg -ss 4.65 -t 16 -i chatterbox_boxing_coach.wav -ar 24000 -ac 1 cornerman-reference.wav
```

## Licensing

**Owned outright.** The reference is the project owner's own voice, recorded for
this purpose. No third-party rights attach to the recording, the performance or
the voice itself, so the rendered corpus carries no licensing obligation and no
attribution requirement.

## Why this reference and not another

Deliberately **not** a recognisable performance by an identifiable actor.
Voices such as Mickey Goldmill (Burgess Meredith) and Painty the Pirate (Patrick
Pinney, a Viacom/Paramount character) were considered and rejected: cloning them
would engage both the rights in the character and the performer's own voice and
publicity rights, which survive the performer in several jurisdictions.

Public-domain archive material was auditioned next — a US Army bayonet-drill
instructor (1938, a government work) and Long John Silver from a CC0 LibriVox
dramatic reading of *Treasure Island*. Both were legally clean but read as
restrained: an archive is full of people **reading**, and the brief called for
someone **performing** — a boisterous showman bellowing at a crowd. An original
recording was the shortest path to that, and it is the cleanest provenance
available.

## If this file changes

Changing the reference changes the voice of every clip in the corpus. Treat it
like a decoder version: update this file, bump `PERSONA_VERSION` in
`personas.mjs`, and re-render the whole corpus so no clip is left in the old
voice.

---

## Update 2026-08-30 — cornerman-5 (canonical Jonathan self-intro)

**File**: `cornerman-reference.wav` (5.653 s, 24 kHz mono PCM 16-bit LE)
**SHA-256**: `822c06aa701ed6b3f72a68a431f4af056744102f86496248bb20ede6ca8ecb76`
**Persona version**: `cornerman-4` → `cornerman-5`
**v4 preserved on disk as**: `cornerman-reference-v4.wav` (SHA
`0e43cae5002b3a307526ec4388b3776b7fdec079556fe0c43bf450720a06ed81`) —
kept for rollback.

### Why the swap

The v4 reference (16 s from Kyle's `chatterbox_boxing_coach.wav`
recording, above) was character-loaded — "a boisterous showman
bellowing at a crowd" per the original brief. That character bled into
every clip and pulled the corpus toward a specific bellowing register
Kyle later heard as accent drift across categories (2026-08-30, Pass 5
of the 11-round protocol).

The rendered `intro-hello` clip landed closer to Jonathan's *canonical*
voice — declarative, neutral, self-introducing ("Hello! Welcome to
Punchcraft. I'm your coach, Jonathan Punchcraft.") — and Kyle named it
directly as "the purest example of his canon voice." Reseeding future
renders from that clip pulls the whole corpus toward the canonical
register instead of the showman register.

### Source

- **Copied verbatim** from
  `assets/voice/numbers/standalone/intro-hello.wav`, the Chatterbox
  render produced by `tools/voice/make-intro-clips.mjs` cloning from
  the v4 reference. Text: "Hello! Welcome to Punchcraft. I'm your
  coach, Jonathan Punchcraft."
- Duration 5.653 s. Below the 7-20 s Chatterbox sweet spot but Kyle
  accepted the tradeoff — a shorter, canonically-on-voice reference is
  preferred over a longer character-loaded one.

Reproduce with:

```bash
cp assets/voice/numbers/standalone/intro-hello.wav \
   tools/voice/reference/cornerman-reference.wav
```

### Known tradeoffs (from workflow review 2026-08-30)

- **Post-broadcast** — the source clip went through
  `make-intro-clips.mjs`'s texture chain (150-7200 Hz band-limit,
  compression, presence shelf, softclip, limiter, loudnorm). Chatterbox
  will now reproduce broadcast-processed timbre on top of a fresh
  broadcast pass at render time, compounding the processing each
  generation. Kyle accepted this against the alternative (a texture-off
  re-render, ~2 min GPU) to keep the swap zero-cost.
- **Circular sourcing** — the source is itself a Chatterbox clone of
  v4, so the "canonical Jonathan" character is Chatterbox's own
  averaged interpretation of Kyle's original recording, not an external
  anchor. Fully external anchoring would require a fresh recording of
  Kyle reading the same text into a mic — deferred.
- **`PERSONA_VERSION` bump does not automatically invalidate rendered
  wavs** — the current render scripts do not consult the version field
  when deciding whether to skip an existing clip. A follow-on
  `--force` re-render of the full corpus is required for the swap to
  take effect on shipped audio.

### Licensing

Inherits from v4 (§Licensing above): the source recording is Kyle's
own voice; the Chatterbox clone in the intro-hello file is derived
solely from that recording. No third-party rights attach.

### Rollback

```bash
cp tools/voice/reference/cornerman-reference-v4.wav \
   tools/voice/reference/cornerman-reference.wav
# then revert personas.mjs's version bump and re-render the corpus
```

## cornerman-selfref-30s.wav (2026-09-01)

Self-clone reference for the `cornerman2` persona: a 31.7 s concatenation
of six SHIPPED renders from `assets/voice/numbers/standalone/`
(intro-hello, intro-rounds-4, intro-program-{beginner,intermediate,advanced}-steady,
intro-letsgo), all produced by the `cornerman` persona from
`cornerman-reference.wav`. No new source material enters the chain — the
licensing of this reference is exactly the licensing of
`cornerman-reference.wav`, one generation removed. Purpose: new batches
clone the production sound (texture chain included) instead of the raw
extract, so they match what the athlete already hears.

## cornerman3-selfref-30s.wav (2026-09-02)

Clean self-clone reference for the `cornerman3` persona — the echo fix.
Diagnosis: every cornerman2 clip carried THREE broadcast passes (v5
reference = textured render; selfref = concat of shipped textured clips;
plus the render-time chain), and the chain's `aecho` taps compound per
pass — Kyle heard it as "echoey and lo-fi". Ruling (2026-09-02): keep
the broadcast character, remove the echo, rebuild from existing raw
material.

Built by `tools/voice/bakeoff-clean-voice.mjs`: the same six intro lines
as the cornerman2 selfref, re-rendered fresh from
`cornerman-reference-v4.wav` (Kyle's raw recording, zero texture passes)
with NO texture applied, concatenated to ~31 s at 24 kHz mono. One clean
generation: Chatterbox's averaging tames v4's bellowing register the way
the v5 swap did, without baking any production chain into the timbre.
Chosen over v4-direct and dry-broadcast variants in the 2026-09-02
bake-off (B2): reference = this file, texture = `broadcast-dry-gentle`
(broadcast minus `aecho`, compressor eased to 8:1 @ -28 dB, makeup 6).

Licensing: derives solely from `cornerman-reference-v4.wav` (Kyle's own
voice) via Chatterbox renders — no third-party rights attach. The
texture chain is now applied EXACTLY ONCE, at render time; a future
reference must never be built from textured output again.

### Rollback

```
# personas.mjs: remove/ignore cornerman3, render with --persona=cornerman2
# (assets per persona live side by side; manifests name the persona dir)
```
