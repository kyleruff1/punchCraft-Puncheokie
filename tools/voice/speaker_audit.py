"""Speaker-consistency audit — catches accent/voice drift the ASR gate cannot.

Chatterbox is seedless: a take can transcribe perfectly and still wander
off the reference voice (Kyle caught intro-rounds-4 sounding Australian).
This scores clips against the cornerman reference with a resemblyzer
d-vector cosine similarity and prints outliers.

Usage:
  F:/voice-tools/venv/Scripts/python.exe tools/voice/speaker_audit.py [glob ...]
Defaults to the announcer library (intro-*, warn-*, co-*, theme-*, joke-*).
"""

import glob
import os
import sys

import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav

REFERENCE = os.environ.get("SPEAKER_AUDIT_REFERENCE", "tools/voice/reference/cornerman3-selfref-30s.wav")
# The announcer library's home, and the default every glob is resolved
# against. Overridable because the click-script bank lives elsewhere
# (assets/voice/click-scripts/<persona>/) — before this it silently matched
# zero files there and printed `clips=0 mean=nan`, which reads like a pass.
BASE = os.environ.get("SPEAKER_AUDIT_BASE", "assets/voice/numbers/standalone/")
DEFAULT_GLOBS = ["intro-*.wav", "warn-*.wav", "co-*.wav", "theme-*.wav", "joke-*.wav"]

patterns = sys.argv[1:] or DEFAULT_GLOBS
files = sorted({f for p in patterns for f in glob.glob(BASE + p)})

encoder = VoiceEncoder(verbose=False)
ref = encoder.embed_utterance(preprocess_wav(REFERENCE))

rows = []
for path in files:
    try:
        emb = encoder.embed_utterance(preprocess_wav(path))
        sim = float(np.dot(ref, emb) / (np.linalg.norm(ref) * np.linalg.norm(emb)))
        rows.append((sim, path))
    except Exception as exc:  # noqa: BLE001 — report and continue
        print(f"ERR  {path}: {exc}")

rows.sort()
sims = np.array([r[0] for r in rows])
mean, sd = float(sims.mean()), float(sims.std())
print(f"clips={len(rows)} mean={mean:.3f} sd={sd:.3f}")
print("--- lowest similarity first (z < -1.5 flagged OUTLIER):")
for sim, path in rows[:25]:
    z = (sim - mean) / sd if sd > 0 else 0.0
    flag = "OUTLIER" if z < -1.5 else ""
    print(f"{sim:.3f}  z={z:+.2f}  {path.split('/')[-1]}  {flag}")
