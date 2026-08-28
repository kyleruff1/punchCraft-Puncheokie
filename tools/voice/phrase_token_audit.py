"""Token-sequence audit for the phrase library — Tier 0, exactness.

The render gate scores fuzzy ASR similarity (>= 0.8), which tolerates a
dropped or doubled token in repeat-heavy combos: 1-1-2 shipped saying
"one, two" and Kyle heard the hole live at the bag. This audit re-checks
EVERY shipped phrase clip for the exact token sequence — missing, extra,
or reordered canonical tokens are a FAIL, no similarity slack.

EVERY future phrase batch ends with this audit.

Usage:
  node tools/voice/make-phrase-clips.mjs --dump-expectations=<json>
  F:/voice-tools/venv/Scripts/python.exe tools/voice/phrase_token_audit.py \
      <expectations.json> [--only=key1,key2,...]

Writes tools/analysis/reports/phrase-token-audit.json (gitignored) and
prints one FAIL line per defective clip.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asr_match import FILLER_VOWELS, canonical_tokens  # noqa: E402

# Same decode settings as the render gate (chatterbox_render.py) — a
# different prompt or temperature here would make the audit disagree with
# the gate about the same audio.
ASR_PROMPT = (
    "Boxing coach calls: one, two, three, four, five, six, bee, body, jab, cross, "
    "lead hook, rear hook, lead uppercut, rear uppercut, slip, roll, duck, pull, "
    "bob and weave, pivot, step off, circle, cut off the ring, reset, go, stop, switch, coast."
)

REPORT_DIR = os.path.join("tools", "analysis", "reports")
REPORT_PATH = os.path.join(REPORT_DIR, "phrase-token-audit.json")

# The ONE canonicalization for exactness checks — shared with the render
# gate's asrExact mode so the audit and the gate can never disagree.
canonical = canonical_tokens


def main() -> int:
    expectations_path = sys.argv[1]
    only_arg = next((a for a in sys.argv[2:] if a.startswith("--only=")), None)
    only = set(only_arg[len("--only="):].split(",")) if only_arg else None

    with open(expectations_path, encoding="utf-8") as fh:
        expectations: dict[str, dict] = json.load(fh)

    jobs = [
        (key, entry)
        for key, entry in sorted(expectations.items())
        if (only is None or key in only) and os.path.exists(entry["wav"])
    ]
    skipped = [key for key, entry in sorted(expectations.items()) if not os.path.exists(entry["wav"])]
    print(f"auditing {len(jobs)} clips ({len(skipped)} expectations have no wav)")

    import numpy as np  # noqa: F401 — whisper needs it importable
    import soundfile as sf
    import whisper
    from scipy.signal import resample_poly
    from math import gcd

    model = whisper.load_model("turbo")

    results = {}
    fails = []
    for index, (key, entry) in enumerate(jobs):
        samples, rate = sf.read(entry["wav"], dtype="float32")
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        if rate != 16000:
            g = gcd(16000, rate)
            samples = resample_poly(samples, 16000 // g, rate // g).astype("float32")
        def transcribe(prompt):
            return model.transcribe(
                samples,
                language="en",
                temperature=0.0,
                condition_on_previous_text=False,
                initial_prompt=prompt,
                fp16=True,
            )["text"].strip()

        want = canonical(entry["text"])
        transcript = transcribe(ASR_PROMPT)
        got = canonical(transcript)
        ok = want == got
        if not ok:
            # On short clips the domain prompt can be regurgitated as a
            # hallucinated tail ("slip two three four five six bee jab
            # jab..."); a promptless second opinion clears those without
            # excusing a genuinely wrong clip.
            transcript = transcribe(None)
            got2 = canonical(transcript)
            if want == got2:
                ok = True
                got = got2
        results[key] = {
            "ok": ok,
            "expected": want,
            "heard": got,
            "transcript": transcript,
            "filler": [t for t in got if t in FILLER_VOWELS],
        }
        if not ok:
            fails.append(key)
            print(f"FAIL {key}: want {' '.join(want)} | heard {' '.join(got)}")
        if (index + 1) % 50 == 0:
            print(f"  ...{index + 1}/{len(jobs)} ({len(fails)} fails)", flush=True)

    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as fh:
        json.dump(
            {"total": len(jobs), "fails": fails, "results": results},
            fh,
            indent=1,
        )
    print(f"\n{len(fails)}/{len(jobs)} FAIL -> {REPORT_PATH}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
