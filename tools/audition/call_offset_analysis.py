"""Mic-anchored call timing analysis (Kyle, 2026-09-01).

Aligns the monitor capture to the device log via the round-start bell,
then for every clickScript dispatch measures: (a) audible onset offset vs
dispatch time, (b) audible span vs the clip's manifest duration — a span
materially shorter than the clip on an ISOLATED call is a playback
truncation, not a render defect.
"""
import json
import re
import sys
import wave
from datetime import datetime
from pathlib import Path

import numpy as np

MON = Path(sys.argv[1] if len(sys.argv) > 1 else "tools/analysis/monitor/calls-offset-1")

# --- audio envelope ---------------------------------------------------------
with wave.open(str(MON / "capture.wav"), "rb") as w:
    sr = w.getframerate()
    n = w.getnframes()
    raw = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32)
    if w.getnchannels() == 2:
        raw = raw.reshape(-1, 2).mean(axis=1)
# High-pass (kill rumble) via first difference, then 10ms RMS envelope.
hp = np.diff(raw, prepend=raw[0])
win = int(sr * 0.010)
env = np.sqrt(np.convolve(hp * hp, np.ones(win) / win, mode="same"))
env_ms = env[:: int(sr / 100)]  # 10ms hop
noise = np.percentile(env_ms, 20)
loud = np.percentile(env_ms, 99)
thresh = noise + 0.10 * (loud - noise)

# Voice segments: above threshold, min 250ms, joined across gaps < 120ms.
above = env_ms > thresh
segments = []
start = None
gap = 0
for i, a in enumerate(above):
    if a:
        if start is None:
            start = i
        gap = 0
    elif start is not None:
        gap += 1
        if gap > 40:  # 400ms — join across inter-word gaps
            end = i - gap
            if (end - start) * 10 >= 250:
                segments.append((start * 10, (end - start) * 10))
            start = None
if start is not None:
    segments.append((start * 10, (len(above) - start) * 10))

# --- log parse --------------------------------------------------------------
log = (MON / "log.txt").read_text(encoding="utf-8", errors="replace")


def dev_ms(line):
    m = re.match(r"\s*(\d{10}\.\d+)", line)
    if m:
        return float(m.group(1)) * 1000.0
    m = re.match(r"(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d\d\d)", line)
    if not m:
        return None
    mo, d, h, mi, s, ms = map(int, m.groups())
    return ((mo * 31 + d) * 86400 + h * 3600 + mi * 60 + s) * 1000 + ms


lines = log.splitlines()
dispatches = []  # (devMs, kind, slot, durationMs from manifest lookup later)
bell_ms = None
for i, line in enumerate(lines):
    if "round.boundary" in line and "work-entered" not in line:
        pass
    if "puncheokie.round.boundary" in line:
        ctx = "\n".join(lines[i : i + 4])
        if "'work-entered'" in ctx and bell_ms is None:
            bell_ms = dev_ms(line)
    if "clickScript.dispatch" in line:
        ctx = "\n".join(lines[i : i + 6])
        kind = re.search(r"kind: '(\w[\w-]*)'", ctx)
        slot = re.search(r"slot: '([^']+)'", ctx)
        dur = re.search(r"durationMs: (\d+)", ctx)
        t = dev_ms(line)
        if t and slot:
            dispatches.append(
                {
                    "devMs": t,
                    "kind": kind.group(1) if kind else "?",
                    "slot": slot.group(1),
                    "durMs": int(dur.group(1)) if dur else None,
                }
            )

if bell_ms is None or not dispatches:
    print("no bell/dispatches in log — cannot align")
    sys.exit(1)

# --- align: epoch logcat vs manifest audioT0EpochMs (direct) ---------------
manifest = json.load(open(MON / "manifest.json", encoding="utf-8"))
t0 = manifest.get("anchors", {}).get("audioT0EpochMs") or manifest["startedEpochMs"]
offset = -t0  # audioMs = devEpochMs + offset
half = len(env_ms) // 2
bell_audio_ms = int(np.argmax(env_ms[:half]) * 10)
print(f"segments={len(segments)} audioT0={t0} bell(audio)={bell_audio_ms} bell(dev->audio)={bell_ms + offset:.0f}")

# --- per-dispatch match -----------------------------------------------------
rows = []
for d in dispatches:
    a = d["devMs"] + offset
    # nearest segment onset within +-900ms
    best = None
    for s0, span in segments:
        if abs(s0 - a) < 900:
            if best is None or abs(s0 - a) < abs(best[0] - a):
                best = (s0, span)
    rows.append((d, a, best))

iso, dense = [], []
print("\nkind      slot                        onset-late  span  clip  span/clip")
for d, a, best in rows:
    if best is None:
        print(f"{d['kind']:9s} {d['slot']:27s} NO-AUDIO-MATCH")
        continue
    onset_late = best[0] - a
    ratio = best[1] / d["durMs"] if d["durMs"] else float("nan")
    print(f"{d['kind']:9s} {d['slot']:27s} {onset_late:+6.0f}ms {best[1]:5d} {d['durMs'] or 0:5d}  {ratio:4.2f}")
    (iso if d["slot"].startswith("call/1-2-1-2") or d["kind"] != "call" else dense).append((onset_late, ratio))

if iso:
    ol = [x[0] for x in iso]
    rt = [x[1] for x in iso]
    print(f"\nisolated calls/leads: n={len(iso)} onset-late p50={np.median(ol):.0f}ms  span/clip p50={np.median(rt):.2f}")
if dense:
    ol = [x[0] for x in dense]
    rt = [x[1] for x in dense]
    print(f"dense calls:          n={len(dense)} onset-late p50={np.median(ol):.0f}ms  span/clip p50={np.median(rt):.2f}")
