"""Render phrases with Kokoro-82M, using blended voice profiles.

Reads a JSON spec on stdin:

    {
      "blends": {"aged-authoritative": {"am_michael": 0.55, ...}, ...},
      "jobs": [{"path": "...", "text": "...", "speed": 1.15, "blend": "..."}]
    }

Prints `OK <path> <durationMs>` or `FAIL <path> <message>` per job, so one bad
phrase is reported rather than taking the batch down.

## Blending

`Kokoro.create()` accepts a voice tensor directly, and `get_voice_style()`
returns one, so a persona is a weighted sum of the shipped voices — no model
changes, no PyTorch, nothing downloaded at runtime.

Interpolating voice embeddings is **not** linearly related to perceived age or
emotion. The weights here are starting hypotheses to be judged by ear, not a
formula, which is exactly why the audition renders several and compares them.

`am_santa` is used only as age colour and never as the clarity foundation: it
has far less training material than `am_michael`, `am_fenrir` or `am_puck`,
and leaning on it costs intelligibility — the one thing a punch call cannot
afford to lose.
"""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Mapping
from pathlib import Path

import numpy as np

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL = MODEL_DIR / "kokoro-v1.0.onnx"
VOICES = MODEL_DIR / "voices-v1.0.bin"


def blend(kokoro, weights: Mapping[str, float]) -> np.ndarray:
    """Weighted sum of voice style tensors, normalised to sum to one."""
    if not weights:
        raise ValueError("at least one voice is required")
    total = sum(weights.values())
    if total <= 0:
        raise ValueError("voice weights must have a positive sum")

    blended = None
    for name, weight in weights.items():
        if weight < 0:
            raise ValueError(f"negative weight for {name}")
        style = np.asarray(kokoro.get_voice_style(name), dtype=np.float32)
        scaled = style * (weight / total)
        if blended is None:
            blended = scaled
        elif blended.shape != scaled.shape:
            raise ValueError(f"{name} has shape {scaled.shape}, expected {blended.shape}")
        else:
            blended = blended + scaled
    return blended


def main() -> int:
    if not MODEL.exists() or not VOICES.exists():
        print(
            f"FAIL - model files missing under {MODEL_DIR}. See tools/voice/README.md.",
            flush=True,
        )
        return 1

    try:
        from kokoro_onnx import Kokoro
        import soundfile as sf
    except ImportError as exc:  # pragma: no cover - environment problem
        print(f"FAIL - {exc}. Install with: pip install kokoro-onnx soundfile", flush=True)
        return 1

    spec = json.load(sys.stdin)
    kokoro = Kokoro(str(MODEL), str(VOICES))

    voices: dict[str, object] = {}
    for name, weights in spec.get("blends", {}).items():
        try:
            voices[name] = blend(kokoro, weights)
        except Exception as exc:  # noqa: BLE001 - report and carry on
            print(f"FAIL - blend {name}: {exc}", flush=True)

    started = time.time()
    for entry in spec["jobs"]:
        path = entry["path"]
        try:
            voice = voices.get(entry["blend"]) if entry.get("blend") else None
            if voice is None:
                raise ValueError(f"blend {entry.get('blend')!r} is unavailable")
            samples, rate = kokoro.create(
                entry["text"],
                voice=voice,
                speed=float(entry.get("speed", 1.0)),
                lang="en-us",
            )
            sf.write(path, samples, rate)
            print(f"OK {path} {round(len(samples) / rate * 1000)}", flush=True)
        except Exception as exc:  # noqa: BLE001 - one bad phrase must not stop the batch
            print(f"FAIL {path} {exc}", flush=True)

    print(f"DONE {len(spec['jobs'])} in {round(time.time() - started, 1)}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
