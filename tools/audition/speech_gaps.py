"""Measure the coach's speech rhythm straight from a room capture.

No clock anchor, no logcat correlation: this reads capture.wav, finds
every utterance by its envelope, and reports how long each one lasted
and how much silence followed it. That answers two questions Kyle asks
by ear:

  * "empty space after he speaks"  -> the gap column
  * "audio glitches"               -> an utterance whose length differs
    from the clip's nominal duration, or one broken into fragments by a
    dropout (visible as a very short gap inside a call)

Usage:
    python tools/audition/speech_gaps.py <session-dir-or-wav> [--floor 0.02]
        [--min-gap 0.18] [--min-utter 0.12] [--from 0] [--to 999]

Dependencies: numpy + soundfile (already in F:/voice-tools/venv).
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import soundfile as sf


def load(path: str):
    if os.path.isdir(path):
        path = os.path.join(path, "capture.wav")
    data, rate = sf.read(path, dtype="float32", always_2d=True)
    return data[:, 0], rate, path


def envelope(x: np.ndarray, rate: int, win_ms: float = 20.0):
    """RMS envelope on `win_ms` hops."""
    hop = max(1, int(rate * win_ms / 1000.0))
    trimmed = x[: len(x) - len(x) % hop].reshape(-1, hop)
    return np.sqrt((trimmed.astype(np.float64) ** 2).mean(axis=1)), hop


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--floor", type=float, default=0.0, help="absolute RMS gate (0 = auto)")
    ap.add_argument("--min-gap", type=float, default=0.18, help="silence (s) that separates utterances")
    ap.add_argument("--min-utter", type=float, default=0.12, help="shortest utterance to report (s)")
    ap.add_argument("--from", dest="start_s", type=float, default=0.0)
    ap.add_argument("--to", dest="end_s", type=float, default=float("inf"))
    args = ap.parse_args()

    x, rate, path = load(args.path)
    total_s = len(x) / rate
    lo = int(max(0.0, args.start_s) * rate)
    hi = int(min(total_s, args.end_s) * rate)
    x = x[lo:hi]
    if len(x) == 0:
        print("empty range")
        return 1

    env, hop = envelope(x, rate)
    hop_s = hop / rate
    noise = float(np.percentile(env, 30))
    peak = float(np.percentile(env, 99.5))
    gate = args.floor if args.floor > 0 else max(noise * 3.5, peak * 0.10)

    print(f"file      {path}")
    print(f"window    {args.start_s:.1f}s .. {min(total_s, args.end_s):.1f}s  of {total_s:.1f}s")
    print(f"noise p30 {noise:.5f}   peak p99.5 {peak:.5f}   gate {gate:.5f}")

    loud = env > gate
    # Close pinholes shorter than min-gap so one word is not split by a
    # glottal stop; anything longer stays a real gap.
    min_gap_frames = max(1, int(args.min_gap / hop_s))
    idx = np.flatnonzero(loud)
    if idx.size == 0:
        print("\nno speech above the gate — was the coach audible on this input?")
        return 0

    spans = []
    start = idx[0]
    prev = idx[0]
    for i in idx[1:]:
        if i - prev > min_gap_frames:
            spans.append((start, prev))
            start = i
        prev = i
    spans.append((start, prev))
    spans = [(a, b) for a, b in spans if (b - a + 1) * hop_s >= args.min_utter]

    if not spans:
        print("\nno utterance longer than --min-utter")
        return 0

    print(f"\n{'#':>3} {'start':>8} {'len':>7} {'gap after':>10}")
    lens, gaps = [], []
    for n, (a, b) in enumerate(spans):
        start_s = args.start_s + a * hop_s
        dur = (b - a + 1) * hop_s
        lens.append(dur)
        if n + 1 < len(spans):
            gap = (spans[n + 1][0] - b - 1) * hop_s
            gaps.append(gap)
            gap_txt = f"{gap * 1000:8.0f}ms"
        else:
            gap_txt = "        —"
        print(f"{n:>3} {start_s:7.2f}s {dur * 1000:6.0f}ms {gap_txt:>10}")

    def stats(name, vals, unit_ms=True):
        if not vals:
            return
        arr = np.array(vals) * (1000 if unit_ms else 1)
        print(
            f"{name:<12} n={len(arr):<4} mean={arr.mean():7.0f}  median={np.median(arr):7.0f}"
            f"  min={arr.min():7.0f}  max={arr.max():7.0f}  sd={arr.std():6.0f}"
        )

    print()
    stats("utterance", lens)
    stats("gap", gaps)
    if gaps:
        long_gaps = [g for g in gaps if g > 1.2]
        print(
            f"\ngaps over 1.2s: {len(long_gaps)} of {len(gaps)}"
            + (f"  (largest {max(long_gaps):.2f}s)" if long_gaps else "")
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
