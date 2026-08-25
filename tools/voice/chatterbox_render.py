"""Render phrases with Chatterbox, cloning the cornerman reference voice.

Drop-in replacement for `kokoro_render.py`: same stdin/stdout contract, so
`make-phrase-clips.mjs` and `make-voice-clips.mjs` can switch engines without
changing anything downstream. Beats, trimming, pitch contour and texture all
run afterwards exactly as before.

Reads a JSON spec on stdin:

    {
      "reference": "tools/voice/reference/cornerman-reference.wav",
      "jobs": [{"path": "...", "text": "...", "exaggeration": 0.7,
                "cfgWeight": 0.4, "minDurationMs": 500, "maxDurationMs": 1600}]
    }

`minDurationMs` and `maxDurationMs` bound a best-of-N retry. Chatterbox is
markedly unstable on the short inputs this project renders — it sometimes runs
long, and it sometimes silently *drops a syllable* to run short (measured: a
"one two" take clipping to a 370ms "one"). The first version of this bounded
only the upper end and preferred the shortest take, which reinforced the
truncated ones and shipped clips that garbled after tempo fit. Both bounds
now: a take that undershoots means a word was dropped, a take that overshoots
means the model kept generating past the phrase. The renderer keeps rolling
until a take lands inside the window, and falls back to the take closest to
the middle of the window when nothing does.

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
    attempts_cap = int(spec.get("attempts", 5))

    for entry in jobs:
        path = entry["path"]
        min_ms = entry.get("minDurationMs")
        max_ms = entry.get("maxDurationMs")
        bounded = min_ms is not None or max_ms is not None
        attempts = attempts_cap if bounded else 1

        def in_bounds(ms: float) -> bool:
            if min_ms is not None and ms < float(min_ms):
                return False
            if max_ms is not None and ms > float(max_ms):
                return False
            return True

        # Distance to the middle of the window — used as a fallback tiebreak
        # when no take lands inside the window at all.
        def middleness(ms: float) -> float:
            if min_ms is not None and max_ms is not None:
                mid = (float(min_ms) + float(max_ms)) / 2.0
            elif min_ms is not None:
                mid = float(min_ms)
            elif max_ms is not None:
                mid = float(max_ms)
            else:
                mid = ms
            return abs(ms - mid)

        try:
            fallback = None  # (samples, duration_ms) — the closest-to-mid take seen
            accepted = None
            for _attempt in range(attempts):
                wav = model.generate(
                    entry["text"],
                    audio_prompt_path=reference,
                    exaggeration=float(entry.get("exaggeration", 0.7)),
                    cfg_weight=float(entry.get("cfgWeight", 0.4)),
                )
                samples = wav.detach().cpu().numpy()
                if samples.ndim > 1:
                    samples = samples.squeeze()
                duration_ms = len(samples) / model.sr * 1000
                if fallback is None or middleness(duration_ms) < middleness(fallback[1]):
                    fallback = (samples, duration_ms)
                if in_bounds(duration_ms):
                    accepted = (samples, duration_ms)
                    break

            samples, duration_ms = accepted if accepted else fallback
            sf.write(path, samples.astype(np.float32), model.sr)
            # Report a take that landed outside the window rather than letting
            # it pass silently — that is exactly the defect that shipped
            # garbled clips in the first place. `SHORT` means a syllable was
            # dropped; `OVER` means the model kept generating.
            if accepted:
                tag = ""
            elif min_ms is not None and duration_ms < float(min_ms):
                tag = f" SHORT under {round(float(min_ms))}"
            elif max_ms is not None and duration_ms > float(max_ms):
                tag = f" OVER {round(float(max_ms))}"
            else:
                tag = ""
            print(f"OK {path} {round(duration_ms)}{tag}", flush=True)
        except Exception as exc:
            print(f"FAIL {path} {exc}", flush=True)

    print(f"DONE {len(jobs)} in {round(time.time() - started, 1)}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
