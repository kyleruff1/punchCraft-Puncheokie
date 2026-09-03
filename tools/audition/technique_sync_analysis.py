"""Technique CALL-vs-shot sync analysis (Kyle, 2026-09-03).

The visual lane (nodes + avatar) is dialed in perfectly and rides the
authored grid on the work clock. This measures the ONE decoupled lane —
the coach CALL audio — against it, per bar:

    breath = firstNodeLightup - callAudioEnd     (ms, positive = lead)

positive = the call finishes that many ms BEFORE the bar's first shot
lights ("a breath before every shot"); <= 0 is the forbidden case.

LOG-PRIMARY (reliable, per bar, no fragile mic segmentation):
  callEnd  = dispatchEpoch + rewindMs + PLAYER_LATENCY_MS + durationMs
  nodeEpoch = workEnteredEpoch + tokenDue.workElapsedMs   (tokenIndex 0)
All but PLAYER_LATENCY_MS come straight from the device log; the constant
(play() → audible) is calibrated once from the mic and is a pure additive
bias, so it does NOT affect the per-set SPREAD (the variance Kyle hears).
Each call is paired to the next same-motif token0 node after its dispatch.

Usage: python technique_sync_analysis.py <session-dir>
       [--player-latency=<ms>] (default 90) [--target-breath=<ms>] (default 250)
"""
import re
import sys
from pathlib import Path

import numpy as np

MON = Path(next((a for a in sys.argv[1:] if not a.startswith("--")),
                "tools/analysis/monitor/tech-sync"))
PLAYER_LATENCY_MS = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--player-latency=")), 90)
TARGET_BREATH_MS = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--target-breath=")), 250)


def dev_ms(line):
    m = re.match(r"\s*(\d{10}\.\d+)", line)
    return float(m.group(1)) * 1000.0 if m else None


lines = (MON / "log.txt").read_text(encoding="utf-8", errors="replace").splitlines()
work_epoch = None
work_elapsed0 = 0.0
nodes = {}   # motif -> sorted list of node epochs (token0)
calls = []   # {devMs, motif, durMs, rewindMs}
for i, line in enumerate(lines):
    if "puncheokie.round.boundary" in line:
        ctx = "\n".join(lines[i : i + 4])
        if "'work-entered'" in ctx and work_epoch is None:
            work_epoch = dev_ms(line)
            we = re.search(r"workElapsedMs: ([\d.]+)", ctx)
            work_elapsed0 = float(we.group(1)) if we else 0.0
    if "cue.tokenDue" in line:
        ctx = "\n".join(lines[i : i + 8])
        ti = re.search(r"tokenIndex: (\d+)", ctx)
        combo = re.search(r"combination: '([^']+)'", ctx)
        we = re.search(r"workElapsedMs: ([\d.]+)", ctx)
        if ti and ti.group(1) == "0" and combo and we and work_epoch is not None:
            nodes.setdefault(combo.group(1), []).append(work_epoch + float(we.group(1)) - work_elapsed0)
    if "clickScript.dispatch" in line:
        ctx = "\n".join(lines[i : i + 6])
        slot = re.search(r"slot: '([^']+)'", ctx)
        dur = re.search(r"durationMs: (\d+)", ctx)
        t = dev_ms(line)
        if t and slot and slot.group(1).startswith("call/") and dur:
            # rewindMs is on the paired voice.play line (same clip) just before/after.
            rw = None
            for j in range(max(0, i - 8), min(len(lines), i + 2)):
                rm = re.search(r"rewindMs: (\d+)", lines[j])
                if rm:
                    rw = int(rm.group(1))
            calls.append({"devMs": t, "motif": slot.group(1)[5:],
                          "durMs": int(dur.group(1)), "rewindMs": rw or 0})

if work_epoch is None or not calls or not nodes:
    print(f"cannot align: work_epoch={work_epoch} calls={len(calls)} node-motifs={len(nodes)}")
    sys.exit(1)
for m in nodes:
    nodes[m].sort()

# --- pair each call to the next same-motif token0 node after dispatch -------
used = {m: 0 for m in nodes}
per_motif = {}
for c in sorted(calls, key=lambda c: c["devMs"]):
    lst = nodes.get(c["motif"], [])
    k = used.get(c["motif"], 0)
    while k < len(lst) and lst[k] < c["devMs"]:
        k += 1
    if k >= len(lst):
        continue
    node = lst[k]
    used[c["motif"]] = k + 1
    # Reject cross-section/cross-round mismatches: a call's bar node lights
    # within one stride (widest ~8.5s) of its dispatch. Beyond that the
    # walk has jumped a gap (interrupted capture) — skip, don't pollute.
    if node - c["devMs"] > 11000:
        continue
    call_end = c["devMs"] + c["rewindMs"] + PLAYER_LATENCY_MS + c["durMs"]
    per_motif.setdefault(c["motif"], []).append(node - call_end)

flat = [b for v in per_motif.values() for b in v]
if not flat:
    print("no call/node pairs")
    sys.exit(1)

print(f"calls={len(calls)} paired={len(flat)}  (PLAYER_LATENCY={PLAYER_LATENCY_MS}ms — additive bias only)")
print(f"\n{'motif':22s} n   breath_mean  spread   worst-lead  late(<=0)")
for motif in sorted(per_motif):
    b = per_motif[motif]
    print(f"{motif:22s} {len(b):<3d} {np.mean(b):+7.0f}ms  {np.std(b):4.0f}ms  {min(b):+6.0f}ms     {sum(1 for x in b if x <= 0)}")

arr = np.array(flat)
print(f"\nACROSS ALL SETS: n={len(arr)} mean={arr.mean():+.0f}ms sd={arr.std():.0f}ms "
      f"min={arr.min():+.0f}ms max={arr.max():+.0f}ms late(<=0)={int((arr<=0).sum())}")
shift = TARGET_BREATH_MS - arr.min()
print(f"\nBlanket shift to put the WORST-case lead at +{TARGET_BREATH_MS}ms (never-late floor): "
      f"call track EARLIER by {shift:+.0f}ms.")
print(f"  -> mean ~{arr.mean()+shift:+.0f}ms, min ~+{TARGET_BREATH_MS}ms, max ~{arr.max()+shift:+.0f}ms.")
print(f"Residual cross-set spread stays {arr.std():.0f}ms sd (a blanket shift cannot tighten it — "
      f"that comes from the pre-arm/variance work).")
