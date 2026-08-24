"""Render combination phrases with Kokoro-82M (D16's named voice).

Reads a JSON spec on stdin and writes one WAV per entry:

    [{"path": "...", "text": "One two, three two!", "speed": 1.15}, ...]

Prints one `OK <path> <durationMs>` line per rendered phrase, or
`FAIL <path> <message>`, so the Node generator can report per-phrase rather
than failing the whole batch on one bad entry.

Why Kokoro rather than the platform synthesizer: it is fully local, needs no
key, is Apache-2.0, and — the part that matters here — it does not sound like
an assistant reading a list. A boxing coach is a person talking.

Kokoro has no SSML, so prosody comes from the text itself: words inside a
group are separated by spaces, groups by a comma, and the phrase ends on an
exclamation. Cadence is a `speed` multiplier applied at synthesis, which is a
different performance rather than a recording played faster.

The model files are not in the repo (~350 MB). See tools/voice/README.md.
"""

import json
import sys
import time
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL = MODEL_DIR / "kokoro-v1.0.onnx"
VOICES = MODEL_DIR / "voices-v1.0.bin"


def main() -> int:
    if not MODEL.exists() or not VOICES.exists():
        print(
            f"FAIL - model files missing under {MODEL_DIR}. "
            "See tools/voice/README.md for the download commands.",
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

    started = time.time()
    for entry in spec:
        path = entry["path"]
        try:
            samples, rate = kokoro.create(
                entry["text"],
                voice=entry.get("voice", "am_michael"),
                speed=float(entry.get("speed", 1.0)),
                lang="en-us",
            )
            sf.write(path, samples, rate)
            print(f"OK {path} {round(len(samples) / rate * 1000)}", flush=True)
        except Exception as exc:  # noqa: BLE001 - one bad phrase must not stop the batch
            print(f"FAIL {path} {exc}", flush=True)

    print(f"DONE {len(spec)} in {round(time.time() - started, 1)}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
