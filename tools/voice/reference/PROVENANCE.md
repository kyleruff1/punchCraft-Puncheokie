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
