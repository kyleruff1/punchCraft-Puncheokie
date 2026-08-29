"""Session report — correlate mic utterances against what the app scheduled.

This is A4's real fix. `speech_gaps.py` measures the room-mic envelope
by itself; it has no idea what clip *should* have played. This tool
joins the room-mic utterances with the logcat's `puncheokie.voice.play`
events (via the monitor session's `manifest.json.audioT0EpochMs` anchor)
and cross-references the expected clip length from the shipped
manifests. Every utterance gets classified as one of:

  MATCH  — measured length within ±TOL of the expected clip
  SHORT  — measured length shorter (truncation, likely another clip
           preempted this one)
  LONG   — measured length longer (overlap, two clips at once)
  DRIFT  — matched, but envelope centre offset from launch time > DRIFT
  UNKN   — mic utterance with no logged voice.play near it

Also reports every logged `voice.play` with no matching mic utterance
(SILENT — the app said it played but nothing came out).

Usage:
    python tools/audition/session_report.py <session-dir>
      [--tol 250]       # utterance length tolerance (ms) around expected
      [--drift 300]     # centre-of-envelope alignment tolerance (ms)
      [--match-window 800]  # ms window to match a launch to an utterance
      [--report out.json]

Dependencies: numpy + soundfile (F:/voice-tools/venv).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import soundfile as sf

# ---------------------------------------------------------------------------
# Manifest scrape (no TS parse — the tools venv has no TS runtime).

PHRASE_ENTRY = re.compile(
    r"cueId:\s*\"(?P<cueId>[^\"]+)\",[\s\S]*?"
    r"combination:\s*\"(?P<combo>[^\"]+)\",[\s\S]*?"
    r"cadence:\s*\"(?P<cadence>[^\"]+)\",[\s\S]*?"
    r"vocabulary:\s*\"(?P<vocab>[^\"]+)\",[\s\S]*?"
    r"performance:\s*\"(?P<perf>[^\"]+)\",[\s\S]*?"
    r"durationMs:\s*(?P<dur>\d+)"
)
CALLOUT_ENTRY = re.compile(r"'(?P<id>[a-z0-9-]+)':\s*\{\s*durationMs:\s*(?P<dur>\d+)")


def load_expected(repo_root: str) -> Dict[Tuple[str, ...], int]:
    """Build a lookup table for `voice.play` payloads → expected ms.

    Keyed by the tuple of fields we can pull from a logcat row so a payload
    like `{combination:'1-2', cadence:'pressure', vocabulary:'numbers'}` or
    `{asset:'co-first-look-01'}` can both be resolved.
    """
    table: Dict[Tuple[str, ...], int] = {}
    phrase = os.path.join(repo_root, "src", "audio", "voiceAssets", "phraseManifest.ts")
    if os.path.exists(phrase):
        text = open(phrase, encoding="utf-8", errors="ignore").read()
        for m in PHRASE_ENTRY.finditer(text):
            dur = int(m["dur"])
            # Two lookup keys per phrase, so logcat rows can match by
            # either the cueId (preferred; single field) or the split
            # (combination, cadence, vocab, perf) tuple.
            table[("phrase", m["combo"], m["cadence"], m["vocab"], m["perf"])] = dur
            table[("cue", m["cueId"])] = dur
    callout = os.path.join(repo_root, "src", "audio", "voiceAssets", "calloutManifest.ts")
    if os.path.exists(callout):
        text = open(callout, encoding="utf-8", errors="ignore").read()
        for m in CALLOUT_ENTRY.finditer(text):
            table[("asset", m["id"])] = int(m["dur"])
    return table


# ---------------------------------------------------------------------------
# Mic envelope (same as speech_gaps.py, factored out).

def envelope(x: np.ndarray, rate: int, win_ms: float = 20.0):
    hop = max(1, int(rate * win_ms / 1000.0))
    trimmed = x[: len(x) - len(x) % hop].reshape(-1, hop)
    return np.sqrt((trimmed.astype(np.float64) ** 2).mean(axis=1)), hop


def utterances(wav_path: str, min_gap_s: float = 0.18, min_utter_s: float = 0.12):
    """Return list of (start_s, end_s) for every mic utterance."""
    data, rate = sf.read(wav_path, dtype="float32", always_2d=True)
    x = data[:, 0]
    env, hop = envelope(x, rate)
    hop_s = hop / rate
    noise = float(np.percentile(env, 30))
    peak = float(np.percentile(env, 99.5))
    gate = max(noise * 3.5, peak * 0.10)
    loud = env > gate
    min_gap_frames = max(1, int(min_gap_s / hop_s))
    idx = np.flatnonzero(loud)
    if idx.size == 0:
        return []
    spans: List[Tuple[float, float]] = []
    start = idx[0]
    prev = idx[0]
    for i in idx[1:]:
        if i - prev > min_gap_frames:
            spans.append((start * hop_s, (prev + 1) * hop_s))
            start = i
        prev = i
    spans.append((start * hop_s, (prev + 1) * hop_s))
    return [(a, b) for a, b in spans if (b - a) >= min_utter_s]


# ---------------------------------------------------------------------------
# Logcat parse — we only look for lines that carry `voice.play`.

LOG_TS = re.compile(r"^\s*(\d+)\.(\d+)")
LOG_ASSET = re.compile(r"asset:\s*'([^']+)'")
LOG_CUEID = re.compile(r"cueId:\s*'([^']+)'")
LOG_COMBO = re.compile(r"combination:\s*'([^']+)'")
LOG_CADENCE = re.compile(r"cadence:\s*'([^']+)'")
LOG_VOCAB = re.compile(r"vocabulary:\s*'([^']+)'")
LOG_PERF = re.compile(r"performance:\s*'([^']+)'")
LOG_DUR = re.compile(r"durationMs:\s*(\d+)")


def parse_log(path: str, audio_t0_ms: int) -> List[dict]:
    """Return one event per `puncheokie.voice.play` record.

    logcat wraps `{...}` payloads across several lines that share the
    same epoch stamp. We stitch the trailing continuation lines back
    into the header row so `cueId`, `combination`, `durationMs` etc.
    are all visible to a single search.
    """
    events: List[dict] = []
    pending_header: Optional[dict] = None
    header_ts: Optional[int] = None
    tail: List[str] = []

    def flush() -> None:
        nonlocal pending_header, tail, header_ts
        if pending_header is None:
            return
        blob = " ".join(tail)
        cue = LOG_CUEID.search(blob)
        asset = LOG_ASSET.search(blob)
        combo = LOG_COMBO.search(blob)
        cadence = LOG_CADENCE.search(blob)
        vocab = LOG_VOCAB.search(blob)
        perf = LOG_PERF.search(blob)
        dur = LOG_DUR.search(blob)
        events.append({
            "t": pending_header["t"],
            "kind": "asset" if asset else "phrase",
            "asset": asset.group(1) if asset else None,
            "cueId": cue.group(1) if cue else None,
            "combination": combo.group(1) if combo else None,
            "cadence": cadence.group(1) if cadence else None,
            "vocabulary": vocab.group(1) if vocab else None,
            "performance": (perf.group(1) if perf else "push"),
            "logged_duration_ms": int(dur.group(1)) if dur else None,
        })
        pending_header = None
        tail = []
        header_ts = None

    for ln in open(path, encoding="utf-8", errors="ignore"):
        m = LOG_TS.search(ln)
        if not m:
            continue
        epoch_ms = int(m.group(1)) * 1000 + int(m.group(2)[:3])
        rel_s = (epoch_ms - audio_t0_ms) / 1000
        if "voice.play" in ln:
            flush()
            pending_header = {"t": rel_s}
            header_ts = epoch_ms
            tail = [ln]
        elif pending_header is not None and header_ts is not None and epoch_ms == header_ts:
            tail.append(ln)
        else:
            flush()
    flush()
    return events


def expected_ms(ev: dict, table: Dict[Tuple[str, ...], int]) -> Optional[int]:
    if ev["kind"] == "asset" and ev["asset"]:
        return table.get(("asset", ev["asset"]))
    # `cueId` is the strongest key when it's present.
    if ev.get("cueId"):
        v = table.get(("cue", ev["cueId"]))
        if v is not None:
            return v
    if ev["kind"] == "phrase" and ev["combination"]:
        key = ("phrase", ev["combination"], ev["cadence"], ev["vocabulary"], ev["performance"] or "push")
        v = table.get(key)
        if v is not None:
            return v
    # Fall back to the app's own logged duration.
    return ev.get("logged_duration_ms")


# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("session_dir")
    ap.add_argument("--tol", type=int, default=250,
                    help="utterance length tolerance around expected clip (ms)")
    ap.add_argument("--drift", type=int, default=300,
                    help="alignment drift tolerance between launch time and envelope start (ms)")
    ap.add_argument("--match-window", type=int, default=800,
                    help="ms window to match a launch to a mic utterance")
    ap.add_argument("--report", type=str, default=None,
                    help="write the machine-readable report to this path")
    ap.add_argument("--repo-root", type=str, default=None,
                    help="override repo root (default: two levels up from this script)")
    args = ap.parse_args()

    repo_root = args.repo_root or os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    session = args.session_dir
    if not os.path.isdir(session):
        print(f"not a directory: {session}", file=sys.stderr)
        return 2
    manifest_path = os.path.join(session, "manifest.json")
    if not os.path.exists(manifest_path):
        print(f"missing {manifest_path}; run tools/audition/anchor.mjs first",
              file=sys.stderr)
        return 2
    man = json.load(open(manifest_path, encoding="utf-8"))
    audio_t0_ms = int(man.get("audioT0EpochMs") or 0)
    if not audio_t0_ms:
        print("manifest.json has no audioT0EpochMs; run anchor.mjs",
              file=sys.stderr)
        return 2

    wav_path = os.path.join(session, "capture.wav")
    log_path = os.path.join(session, "log.txt")
    print(f"session : {session}")
    print(f"repo    : {repo_root}")

    table = load_expected(repo_root)
    print(f"clips   : {len(table)} in manifests")

    utters = utterances(wav_path)
    print(f"mic     : {len(utters)} utterances")

    launches = parse_log(log_path, audio_t0_ms)
    print(f"launches: {len(launches)} voice.play events")

    tol_s = args.tol / 1000.0
    drift_s = args.drift / 1000.0
    window_s = args.match_window / 1000.0

    matched: List[dict] = []
    unmatched_utters = list(range(len(utters)))
    silent_launches: List[dict] = []

    # Greedy match: pair every launch to the nearest utterance start
    # within +window and not already taken.
    taken = set()
    for ev in launches:
        best = -1
        best_gap = window_s + 1
        for i, (a, _b) in enumerate(utters):
            if i in taken:
                continue
            gap = a - ev["t"]
            if -0.1 <= gap <= window_s and abs(gap) < best_gap:
                best = i
                best_gap = abs(gap)
        if best == -1:
            silent_launches.append(ev)
            continue
        taken.add(best)
        a, b = utters[best]
        measured_ms = round((b - a) * 1000)
        expected = expected_ms(ev, table)
        if expected is None:
            verdict = "UNKN-CLIP"
        elif measured_ms > expected + int(tol_s * 1000):
            verdict = "LONG"
        elif measured_ms < expected - int(tol_s * 1000):
            verdict = "SHORT"
        elif abs(best_gap) > drift_s:
            verdict = "DRIFT"
        else:
            verdict = "MATCH"
        matched.append({
            "launch_t": round(ev["t"], 2),
            "utter_start": round(a, 2),
            "utter_len_ms": measured_ms,
            "expected_ms": expected,
            "drift_ms": round(best_gap * 1000),
            "verdict": verdict,
            "label": ev["asset"] or ev.get("cueId") or f"{ev.get('combination')} @ {ev.get('cadence')}/{ev.get('vocabulary')}",
        })
    for i in range(len(utters)):
        if i in taken:
            continue
        a, b = utters[i]
        matched.append({
            "launch_t": None,
            "utter_start": round(a, 2),
            "utter_len_ms": round((b - a) * 1000),
            "expected_ms": None,
            "drift_ms": None,
            "verdict": "UNKN-UTTER",
            "label": "(no launched clip nearby)",
        })
    matched.sort(key=lambda r: r["utter_start"])

    counts: Dict[str, int] = {}
    for r in matched:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    counts["SILENT"] = len(silent_launches)

    print(f"\nverdicts: {counts}")
    print(f"\n{'t':>7}  {'utter':>8} {'expect':>7} {'drift':>6}  verdict  label")
    for r in matched:
        exp = f"{r['expected_ms']:>6}" if r["expected_ms"] is not None else "     -"
        drf = f"{r['drift_ms']:>+6}" if r["drift_ms"] is not None else "     -"
        t = f"{r['utter_start']:7.2f}"
        print(f"{t}  {r['utter_len_ms']:>6}ms {exp}ms {drf}ms  {r['verdict']:<10} {r['label']}")

    if silent_launches:
        print(f"\n{len(silent_launches)} launched clips with NO matching mic utterance:")
        for ev in silent_launches[:20]:
            label = ev["asset"] or ev.get("cueId") or f"{ev.get('combination')} @ {ev.get('cadence')}/{ev.get('vocabulary')}"
            print(f"  {ev['t']:7.2f}s  {label}")
        if len(silent_launches) > 20:
            print(f"  ... +{len(silent_launches) - 20} more")

    if args.report:
        json.dump({
            "session": session,
            "counts": counts,
            "matched": matched,
            "silent_launches": silent_launches,
        }, open(args.report, "w", encoding="utf-8"), indent=2)
        print(f"\nreport: {args.report}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
