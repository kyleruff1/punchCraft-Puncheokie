"""Render phrases with Chatterbox, cloning the cornerman reference voice.

Drop-in replacement for `kokoro_render.py`: same stdin/stdout contract, so
`make-phrase-clips.mjs` and `make-voice-clips.mjs` can switch engines without
changing anything downstream. Beats, trimming, pitch contour and texture all
run afterwards exactly as before.

Reads a JSON spec on stdin:

    {
      "reference": "tools/voice/reference/cornerman-reference.wav",
      "jobs": [{"path": "...", "text": "...", "exaggeration": 0.7,
                "cfgWeight": 0.4}]
    }

Prints `OK <path> <durationMs>` or `FAIL <path> <message>` per job, so one bad
job never sinks a batch, then `DONE <n> in <s>s`.

Unlike Kokoro this runs on the GPU and clones a reference voice rather than
blending speaker embeddings — the persona lives in
`tools/voice/reference/cornerman-reference.wav` (see PROVENANCE.md), not in a
blend table. There is deliberately **no speed parameter**: Chatterbox has none,
and time-fitting is done downstream in `make-phrase-clips.mjs` where the same
formant-preserving stretch already used for texture is available.

Requires the F: toolchain venv, not the repo's default Python — see
tools/voice/README.md.
"""

from __future__ import annotations

import json
import sys
import time

MODEL_DEVICE = "cuda"


def main() -> int:
    try:
        import numpy as np
        import soundfile as sf
        import torch  # noqa: F401  (imported for the CUDA check below)
        from chatterbox.tts import ChatterboxTTS
    except Exception as exc:  # pragma: no cover - environment guard
        print(f"FAIL - {exc}. See tools/voice/README.md for the venv setup.", flush=True)
        return 1

    spec = json.load(sys.stdin)
    reference = spec.get("reference")
    if not reference:
        print("FAIL - no reference voice given", flush=True)
        return 1

    device = MODEL_DEVICE if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        # Not fatal — but a full corpus on CPU is hours rather than minutes, so
        # say so loudly rather than let it look like a hang.
        print("FAIL - CUDA unavailable; refusing to render a corpus on CPU.", flush=True)
        return 1

    try:
        model = ChatterboxTTS.from_pretrained(device=device)
    except Exception as exc:
        print(f"FAIL - could not load Chatterbox: {exc}", flush=True)
        return 1

    started = time.time()
    jobs = spec["jobs"]
    for entry in jobs:
        path = entry["path"]
        try:
            wav = model.generate(
                entry["text"],
                audio_prompt_path=reference,
                exaggeration=float(entry.get("exaggeration", 0.7)),
                cfg_weight=float(entry.get("cfgWeight", 0.4)),
            )
            samples = wav.detach().cpu().numpy()
            if samples.ndim > 1:
                samples = samples.squeeze()
            sf.write(path, samples.astype(np.float32), model.sr)
            print(f"OK {path} {round(len(samples) / model.sr * 1000)}", flush=True)
        except Exception as exc:
            print(f"FAIL {path} {exc}", flush=True)

    print(f"DONE {len(jobs)} in {round(time.time() - started, 1)}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
