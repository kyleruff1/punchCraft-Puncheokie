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
