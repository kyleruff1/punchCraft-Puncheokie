"""Jab-batch keep-better pass (listening-lab finding #11).

For every re-rendered techniques phrase clip: the WINNER between the
fresh take and git HEAD is the one whose Whisper transcript contains the
expected number of "jab"s (the defect being fixed — "jab" degrading to
"chap"); speaker similarity to the cornerman reference breaks ties.
Losers are restored from HEAD. Prints a summary; exits 0 always so the
overnight runner continues to the manifest refresh.

Usage: venv python tools/voice/jab_keep_better.py <keys-file>
"""

import subprocess
import sys
import tempfile
import os

import numpy as np
import whisper
from resemblyzer import VoiceEncoder, preprocess_wav

BASE = "assets/voice/phrases/cornerman"
REFERENCE = "tools/voice/reference/cornerman-reference.wav"

keys = open(sys.argv[1], encoding="utf8").read().strip().split(",")
model = whisper.load_model("turbo")
encoder = VoiceEncoder(verbose=False)
ref = encoder.embed_utterance(preprocess_wav(REFERENCE))


def jab_expected(combination: str) -> int:
    return sum(1 for t in combination.split("-") if t.rstrip("b") == "1")


def score(path: str, expected: int):
    r = model.transcribe(path, language="en", condition_on_previous_text=False)
    text = " ".join(s["text"] for s in r["segments"]).lower()
    jabs = text.count("jab")
    try:
        emb = encoder.embed_utterance(preprocess_wav(path))
        sim = float(np.dot(ref, emb) / (np.linalg.norm(ref) * np.linalg.norm(emb)))
    except Exception:
        sim = 0.0
    return min(jabs, expected), sim, text.strip()


kept, restored, missing = 0, 0, 0
for key in keys:
    combination = key.split(".")[0]
    expected = jab_expected(combination)
    rel = f"{BASE}/{key}.wav"
    if not os.path.exists(rel):
        missing += 1
        continue
    head = subprocess.run(
        ["git", "show", f"HEAD:{rel}"], capture_output=True
    )
    if head.returncode != 0:
        kept += 1  # brand-new clip; nothing to compare
        continue
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tf.write(head.stdout)
        old_path = tf.name
    try:
        new_jabs, new_sim, new_text = score(rel, expected)
        old_jabs, old_sim, _ = score(old_path, expected)
        new_wins = (new_jabs, round(new_sim, 3)) >= (old_jabs, round(old_sim, 3))
        if new_wins:
            kept += 1
        else:
            with open(rel, "wb") as f:
                f.write(head.stdout)
            restored += 1
        print(
            f"{key}: new jabs {new_jabs}/{expected} sim {new_sim:.3f} | "
            f"old jabs {old_jabs}/{expected} sim {old_sim:.3f} -> "
            f"{'KEEP-NEW' if new_wins else 'RESTORED'}"
        )
    finally:
        os.unlink(old_path)

print(f"SUMMARY kept={kept} restored={restored} missing={missing} of {len(keys)}")
