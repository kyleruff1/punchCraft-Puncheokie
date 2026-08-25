# Voice Coach asset generation

Two generators, two jobs.

| Script | Produces | Renderer |
|---|---|---|
| `make-voice-clips.mjs` | 96 per-word clips (`assets/voice/<vocabulary>/<form>/`) | Windows SAPI |
| `make-phrase-clips.mjs` | 64 whole-combination phrases (`assets/voice/phrases/`) | Kokoro-82M |

Per-word clips are the **fallback and singles** path. Combinations are called
as whole phrases — a combination stitched from separate word recordings cannot
become one utterance, because a speaker shortens phonemes and shifts stress
across a phrase and none of that survives independent rendering.

## Prerequisites

Only needed to *regenerate* assets. The generated clips are committed, so a
normal checkout builds and runs without any of this.

```bash
winget install --id Gyan.FFmpeg
pip install kokoro-onnx soundfile
```

winget does not refresh the current shell's `PATH`; the generator looks in
both places and fails with the install command rather than silently skipping
post-processing.

### Kokoro model files (~350 MB, gitignored)

```bash
mkdir -p tools/voice/models
curl -L -o tools/voice/models/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o tools/voice/models/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

Kokoro is Apache-2.0, fully local, and needs no API key — which is why D16
names it. Nothing is synthesized at runtime and nothing leaves the machine.

## Running

```bash
node tools/voice/make-voice-clips.mjs
node tools/voice/make-phrase-clips.mjs
```

The phrase generator reads its combination list **from the sample workouts**
rather than a list of its own. A second list drifts, and the failure is
silent: the workout calls a combination, no phrase exists, and the coach
quietly falls back to the per-word path.

It also writes `src/audio/voiceAssets/phraseManifest.ts`. Do not edit that by
hand — a generated manifest cannot describe clips that were not produced.

## Known gap: word timing

Kokoro exposes no per-word boundaries, and a natural delivery runs words
together, so there are no envelope gaps to measure them from either. The
generator reports how many phrases got usable marks; today that is almost
none.

Consequence: **circle activation stays on the cue clock.** Driving visuals
from playback position needs either a renderer that reports word boundaries
(Azure Speech does) or a forced aligner. This is the one thing the platform
synthesizer did better — SAPI's `SpeakProgress` gave exact offsets — and it is
worth knowing before assuming Kokoro is a pure upgrade.

## After Metro sees new assets

Adding or moving asset directories invalidates Metro's file map on Windows,
and it does not recover on its own — the app fails to resolve a clip that is
plainly on disk. Restart with a cleared cache:

```bash
npx expo start --dev-client --port 8081 --clear
```

## The QA loop: validate, hotfix, re-verify

Chatterbox is seedless and unstable on short inputs — a rendered clip can
drop a syllable or replace a word with a filler vowel ("Oh!") while landing
inside its duration window. The loop that catches this:

**Validate everything on disk** (Tier 0 — no hardware in the loop):

```bash
node tools/voice/export-expectations.mjs
F:/voice-tools/venv/Scripts/python.exe tools/voice/validate_clips.py
```

The exporter recomputes what every clip should say from the same
`compilePhrase`/`compileAdlib` calls the generators render with (never a
hand-copied list). The validator transcribes each clip with Whisper on the
GPU — both as-is and slowed back down by its tempo-fit rate — scores the
transcript with `asr_match.py`, runs the acoustic checks (duration window,
edge silence, unexplained-voiced-time for the "oooh" artifact, tone
frequency), and writes `tools/analysis/reports/<ts>/` with `report.md`,
`report.json`, and a waveform+spectrogram PNG per flagged clip.

**Hotfix the flagged clips** — a subset re-render through the ASR gate
(every candidate take must transcribe as its script before it ships;
verdicts land in `tools/analysis/render-report*.json`):

```bash
node tools/voice/make-phrase-clips.mjs --only-keys=<key1,key2,…> --attempts=12
node tools/voice/make-voice-clips.mjs  --only-ids=<id1,id2,…>   --attempts=12
node tools/voice/make-phrase-clips.mjs --manifest-only   # refresh durations
```

Subset renders deliberately skip the index and app manifest; the
`--manifest-only` pass rebuilds both from the full set on disk. Same-name
overwrites need only a Metro reload on the device.

**Stubborn phrases** get an entry in `tools/voice/overrides.json`
(gitignored artifacts live in `tools/analysis/`; overrides are committed):

```json
{ "1-2b.steady.numbers.push":
  { "text": "One! Two! Bee!", "cfgWeight": 0.5, "attempts": 16 } }
```

`text` respells what the coach says (it becomes both the rendered text and
what the gate expects); `cfgWeight`/`exaggeration` trade expressiveness for
text fidelity; `minMs`/`maxMs` override the final-file duration window.

**Re-verify just the fixes:**

```bash
F:/voice-tools/venv/Scripts/python.exe tools/voice/validate_clips.py --only-keys=<keys>
```
