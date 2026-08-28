"""Whisper turbo word-onset backfill for wordMarks that the envelope pass
couldn't find.

Consumed by `make-phrase-clips.mjs` as the third and last source in the
`wordMarks` chain: envelope-strict → envelope-relaxed → this. Reads a
JSON job list on stdin, writes JSON results to stdout — one line per job
so partial progress is preserved on interrupt.

Stdin JSON (list of jobs):
  [{"cueId": "...", "wav": "path/to.wav", "tokens": ["1b", "1", "2"]}, ...]

Stdout JSON (list of results, one per job):
  {"cueId": "...", "onsets": [30, 400, 780], "ends": [220, 620, 1050], "ok": true}
  {"cueId": "...", "onsets": null, "ends": null, "ok": false, "reason": "..."}

Onset/end are milliseconds into the clip. `ok=true` only when the
detected word count matches the expected token count AFTER canonical
folding (asr_match.canonical_tokens). This keeps the fallback honest —
a mismatch stays unpopulated rather than shipping wrong marks.

Word-end times come straight from Whisper's `word_timestamps=True`
segment.words[N].end field.
"""

from __future__ import annotations

import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asr_match import canonical_tokens

_DIGIT_MAP = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6"}


def token_key(token: str) -> str:
    lower = token.lower()
    if lower.endswith("b") and lower[:-1].isdigit():
        return lower[:-1]  # '1b' matches heard 'one' -> '1'
    if lower.isdigit():
        return lower
    return lower


def whisper_key(word_text: str) -> str | None:
    tokens = canonical_tokens(word_text)
    if not tokens:
        return None
    head = tokens[0]
    return _DIGIT_MAP.get(head, head)


def process(model, job):
    try:
        result = model.transcribe(
            job["wav"],
            language="en",
            temperature=0.0,
            condition_on_previous_text=False,
            word_timestamps=True,
            fp16=True,
        )
    except Exception as exc:  # noqa: BLE001
        return {"cueId": job["cueId"], "onsets": None, "ends": None,
                "ok": False, "reason": f"transcribe: {exc}"}

    heard: list[dict] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            heard.append({"start_ms": float(w["start"]) * 1000.0,
                          "end_ms": float(w["end"]) * 1000.0,
                          "text": w["word"]})

    # Greedy align token order to heard order. A repeat-heavy combo (1-1-2)
    # takes its two "one"s from the first two heard "one"s in order.
    onsets: list[float] = []
    ends: list[float] = []
    cursor = 0
    for token in job["tokens"]:
        want = token_key(token)
        matched = None
        while cursor < len(heard):
            key = whisper_key(heard[cursor]["text"])
            cursor += 1
            if key == want:
                matched = heard[cursor - 1]
                break
        if matched is None:
            return {"cueId": job["cueId"], "onsets": None, "ends": None,
                    "ok": False, "reason": f"unmatched token {token} in transcript"}
        onsets.append(round(matched["start_ms"], 1))
        ends.append(round(matched["end_ms"], 1))

    return {"cueId": job["cueId"], "onsets": onsets, "ends": ends, "ok": True}


def main() -> int:
    jobs = json.load(sys.stdin)
    if not jobs:
        return 0

    print(f"LOADING whisper turbo (word_timestamps=True) for {len(jobs)} clips",
          file=sys.stderr, flush=True)
    import whisper
    model = whisper.load_model("turbo")

    for i, job in enumerate(jobs):
        out = process(model, job)
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()
        if (i + 1) % 25 == 0:
            print(f"  ...{i + 1}/{len(jobs)}", file=sys.stderr, flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
