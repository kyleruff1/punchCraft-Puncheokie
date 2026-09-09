"""Re-score a phrase-token-audit report with the current canonical folds.

The audit report stores each clip's expected/heard canonical sequences;
when a fold is added to `phrase_token_audit.canonical` after a long run
(e.g. uppercut -> upper), this re-derives the fail list from the stored
sequences without re-transcribing 776 clips.

Usage: venv python tools/voice/rescore_token_audit.py [report.json]
"""

from __future__ import annotations

import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asr_match import expand_numerals  # noqa: E402

PATH = sys.argv[1] if len(sys.argv) > 1 else "tools/analysis/reports/phrase-token-audit.json"

FOLDS = {"uppercut": "upper"}


def fold(tokens: list[str]) -> list[str]:
    """The current canonical folds, applied to a stored token sequence.

    `expand_numerals` matters as much as FOLDS: Whisper writes a spoken count
    as a NUMERAL — the coach says "thirty four bars" and the transcript reads
    "34 bars" — which is a two-token replace against copy written in words.
    That alone was 102 of the 141 failures in the 2026-09-07 click-bank
    audit, every one of them on a clip whose audio is correct.
    """
    return expand_numerals([FOLDS.get(t, t) for t in tokens])


with open(PATH, encoding="utf-8") as fh:
    report = json.load(fh)

fails = []
for key, r in sorted(report["results"].items()):
    ok = fold(r["expected"]) == fold(r["heard"])
    if not ok:
        fails.append(key)
        print(f"FAIL {key}: want {' '.join(r['expected'])} | heard {' '.join(r['heard'])}")

numbers = [k for k in fails if ".numbers." in k]
techniques = [k for k in fails if ".techniques." in k]
print(f"\n{len(fails)}/{report['total']} FAIL after folds "
      f"({len(numbers)} numbers, {len(techniques)} techniques)")
print("\nNUMBERS-SIDE KEYS:\n" + ",".join(numbers))
print("\nTECHNIQUES-SIDE KEYS:\n" + ",".join(techniques))
