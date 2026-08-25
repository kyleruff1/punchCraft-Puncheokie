# Voice reference provenance

`cornerman-reference.wav` is the voice-cloning reference for the Coach voice.
Every rendered clip inherits its character from this file, so its licensing is
the licensing of the shipped audio — which is why the chain is recorded here
rather than left in a commit message.

## Source

| | |
|---|---|
| Work | *Treasure Island* by Robert Louis Stevenson — LibriVox **full-cast dramatic reading** |
| Archive item | [`treasure_island_dram_1306_librivox`](https://archive.org/details/treasure_island_dram_1306_librivox) |
| File | `treasureisland_20_stevenson.mp3` (Chapter 20, "Silver's Embassy") |
| Extract | 300.0 s – 315.0 s, resampled to 24 kHz mono |
| SHA-256 | `e2fdf76f196f3db9a53a52b49378c86be6ce2ab563d5ec897954c538828f5cdc` |

Reproduce with:

```bash
ffmpeg -ss 300 -t 15 -i treasureisland_20_stevenson.mp3 -ar 24000 -ac 1 cornerman-reference.wav
```

## Licensing

**CC0 1.0 Universal** (public domain dedication) —
`http://creativecommons.org/publicdomain/zero/1.0/`, as recorded on the archive
item's metadata.

Two independent reasons the audio is free of copyright:

1. **The text** — Stevenson died in 1894; *Treasure Island* (1883) is long out
   of copyright worldwide.
2. **The recording** — LibriVox volunteers dedicate their recordings to the
   public domain (CC0). That dedication covers derivative use, which is what
   voice cloning is.

## Why this reference and not another

Deliberately **not** a recognisable performance by an identifiable actor. Voices
such as Mickey Goldmill (Burgess Meredith) or Painty the Pirate (Patrick Pinney,
a Viacom/Paramount character) were considered and rejected: cloning them would
engage both the underlying rights in the character and the performer's own
voice and publicity rights, which survive the performer in several
jurisdictions. The archetype — a boisterous, theatrical, bellowing showman — is
not ownable; a specific person's voice is. This reference gets the archetype
from a source that carries no such claim.

## If this file changes

Changing the reference changes the voice of every clip in the corpus. Treat it
like a decoder version: update this file, bump `PERSONA_VERSION` in
`persona.mjs`, and re-render the whole corpus so no clip is left in the old
voice.
