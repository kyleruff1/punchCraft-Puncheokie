"""Keep-better pass for phrase re-render waves (generalizes jab_keep_better).

For every re-rendered phrase clip: the WINNER between the fresh take and
git HEAD is decided by (token-exactness, speaker-similarity) — a take
that says the right tokens beats one that doesn't, and among equals the
one closer to the cornerman reference wins. Losers are restored from
HEAD. Exits 0 always so a batch runner continues to the manifest refresh.

Token exactness uses the same canonicalization as the token audit
(phrase_token_audit.canonical) against the expectations dump, so this
tool and the audit can never disagree about the same audio.

Usage:
  venv python tools/voice/phrase_keep_better.py <expectations.json> <keys-file>
  (keys-file: comma- or newline-separated clip keys)
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import whisper
from resemblyzer import VoiceEncoder, preprocess_wav

from phrase_token_audit import ASR_PROMPT, canonical

REFERENCE = os.environ.get("KEEP_BETTER_REFERENCE", "tools/voice/reference/cornerman3-selfref-30s.wav")

with open(sys.argv[1], encoding="utf-8") as fh:
    expectations = json.load(fh)
keys = [k for k in open(sys.argv[2], encoding="utf8").read().replace("\n", ",").split(",") if k]

model = whisper.load_model("turbo")
encoder = VoiceEncoder(verbose=False)
ref = encoder.embed_utterance(preprocess_wav(REFERENCE))


def score(path: str, expected_tokens: list[str]):
    def transcribe(prompt):
        return model.transcribe(
            path,
            language="en",
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=prompt,
            fp16=True,
        )["text"]

    # Audit parity: a promptless second opinion clears the prompt-
    # regurgitation hallucinations short clips provoke. Without it this
    # arbiter restored audit-verified fixes (wave 3, 2026-08-27).
    heard = canonical(transcribe(ASR_PROMPT))
    exact = 1 if heard == expected_tokens else 0
    if not exact:
        heard2 = canonical(transcribe(None))
        if heard2 == expected_tokens:
            exact, heard = 1, heard2
    try:
        emb = encoder.embed_utterance(preprocess_wav(path))
        sim = float(np.dot(ref, emb) / (np.linalg.norm(ref) * np.linalg.norm(emb)))
    except Exception:
        sim = 0.0
    return exact, sim, " ".join(heard)


kept, restored, missing = 0, 0, 0
for key in keys:
    entry = expectations.get(key)
    if entry is None or not os.path.exists(entry["wav"]):
        missing += 1
        print(f"{key}: no expectation or no wav — skipped")
        continue
    rel = entry["wav"]
    expected_tokens = canonical(entry["text"])
    head = subprocess.run(["git", "show", f"HEAD:{rel}"], capture_output=True)
    if head.returncode != 0:
        kept += 1  # brand-new clip; nothing to compare
        continue
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tf.write(head.stdout)
        old_path = tf.name
    try:
        new_exact, new_sim, new_heard = score(rel, expected_tokens)
        old_exact, old_sim, old_heard = score(old_path, expected_tokens)
        new_wins = (new_exact, round(new_sim, 3)) >= (old_exact, round(old_sim, 3))
        if new_wins:
            kept += 1
        else:
            with open(rel, "wb") as f:
                f.write(head.stdout)
            restored += 1
        print(
            f"{key}: new exact={new_exact} sim {new_sim:.3f} [{new_heard}] | "
            f"old exact={old_exact} sim {old_sim:.3f} [{old_heard}] -> "
            f"{'KEEP-NEW' if new_wins else 'RESTORED'}"
        )
    finally:
        os.unlink(old_path)

print(f"SUMMARY kept={kept} restored={restored} missing={missing} of {len(keys)}")
