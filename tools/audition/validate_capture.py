"""Tier-1 capture validator — as-heard verdicts for every auditioned clip.

Takes the room recording + playlog from record-audition.mjs and judges each
clip AS PLAYED THROUGH THE TABLET SPEAKER — the truth Tier 0 cannot reach:
speaker character, full-volume behavior, and what actually survives the air.

Slicing is anchor + log deltas: the double START chirp is located by matched
filter (its dominant frequency measured from the chirp asset itself), and
each clip's slice is anchor + (play.atMs − start.atMs). Separator chirps
refine: when a detected chirp lands within ±250 ms of a predicted boundary,
the slice snaps to it; a chirp-count mismatch keeps the log-delta slices and
flags the run. Slice insets keep chirp bleed out of the ASR.

Per slice: Whisper transcription (raw + slowed for tempo-fitted clips),
match against THAT clip's scripted text (the playlog says which clip it is —
no guessing), SNR against the inter-clip floor, and a tail-truncation check
(speech energy still present in the following gap).

Run:
  F:/voice-tools/venv/Scripts/python.exe tools/audition/validate_capture.py \
      --capture <wav> --playlog <json> \
      [--expectations tools/analysis/expectations.json] [--out <dir>]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent / "voice"))
from asr_match import match_score  # noqa: E402

CHIRP_ASSET = Path("assets/spike-voice/tone-short.wav")
CHIRP_SNAP_MS = 250
HEAD_INSET_MS = 120
TAIL_INSET_MS = 100
PASS_MIN_SCORE = 0.85
FAIL_MAX_SCORE = 0.60
SLOWED_MIN_RATE = 1.1

INITIAL_PROMPT = (
    "Boxing coach calls: one, two, three, four, five, six, bee, body, jab, cross, "
    "lead hook, rear hook, lead uppercut, rear uppercut, slip, roll, duck, pull, "
    "bob and weave, pivot, step off, circle, cut off the ring, reset, go, stop, "
    "switch, coast for fifteen seconds, coast for half a minute."
)


def frame_rms(y: np.ndarray, sr: int, hop_ms: float = 5.0, win_ms: float = 20.0):
    hop = max(1, int(sr * hop_ms / 1000))
    win = max(hop, int(sr * win_ms / 1000))
    frames = np.lib.stride_tricks.sliding_window_view(y, win)[::hop]
    return np.sqrt(np.mean(frames**2, axis=1) + 1e-12), hop / sr


def chirp_dominant_hz() -> float:
    import librosa

    chirp, sr = librosa.load(str(CHIRP_ASSET), sr=None, mono=True)
    spectrum = np.abs(np.fft.rfft(chirp * np.hanning(len(chirp))))
    return float(np.fft.rfftfreq(len(chirp), 1 / sr)[int(np.argmax(spectrum))])


def band_energy(y: np.ndarray, sr: int, freq: float, hop_ms: float = 5.0):
    """Narrow-band energy envelope around the chirp frequency (Goertzel-ish
    via STFT bin) — chirps light this band up far above speech."""
    import librosa

    hop = max(1, int(sr * hop_ms / 1000))
    n_fft = 1024
    stft = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    bin_lo = np.searchsorted(freqs, freq * 0.92)
    bin_hi = max(bin_lo + 1, np.searchsorted(freqs, freq * 1.08))
    band = stft[bin_lo:bin_hi].mean(axis=0)
    rest = stft.mean(axis=0) + 1e-9
    return band / rest, hop / sr


def find_chirps(y: np.ndarray, sr: int, freq: float) -> list[float]:
    ratio, hop_s = band_energy(y, sr, freq)
    threshold = max(3.0, float(np.percentile(ratio, 99)) * 0.5)
    mask = ratio > threshold
    times = []
    start = None
    for i, on in enumerate(mask):
        if on and start is None:
            start = i
        elif not on and start is not None:
            times.append(start * hop_s)
            start = None
    return times


def snr_db(seg: np.ndarray, noise_rms: float) -> float:
    seg_rms = float(np.sqrt(np.mean(seg**2) + 1e-12))
    return round(20 * np.log10(seg_rms / (noise_rms + 1e-12)), 1)


def atempo_chain(factor: float) -> str:
    stages = []
    remaining = factor
    while remaining < 0.5:
        stages.append(0.5)
        remaining /= 0.5
    stages.append(remaining)
    return ",".join(f"atempo={s:.4f}" for s in stages)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", required=True)
    parser.add_argument("--playlog", required=True)
    parser.add_argument("--expectations", default="tools/analysis/expectations.json")
    parser.add_argument("--out", default=None)
    parser.add_argument("--model", default="turbo")
    args = parser.parse_args()

    import librosa
    import soundfile as sf
    import torch
    import whisper

    playlog = json.loads(Path(args.playlog).read_text(encoding="utf-8"))
    events = playlog["events"]
    start_event = next(e for e in events if e["event"] == "start")
    plays = [e for e in events if e["event"] == "play"]
    if not plays:
        raise SystemExit("playlog has no play events")

    expectations = json.loads(Path(args.expectations).read_text(encoding="utf-8"))
    by_key = {e["key"]: e for e in expectations["entries"]}

    y, sr = librosa.load(args.capture, sr=16000, mono=True)
    y = y.astype(np.float32)
    rms_all, _ = frame_rms(y, sr)
    noise_rms = float(np.percentile(rms_all, 15))

    # ---- anchor: the double START chirp
    freq = chirp_dominant_hz()
    chirps = find_chirps(y, sr, freq)
    anchor = None
    for i in range(len(chirps) - 1):
        if 0.1 < chirps[i + 1] - chirps[i] < 0.8:
            anchor = chirps[i + 1]  # start.atMs logged right after 2nd chirp
            break
    if anchor is None:
        raise SystemExit(f"double start chirp not found ({len(chirps)} chirps detected)")
    print(f"anchor at {anchor:.2f}s; {len(chirps)} chirps detected for {len(plays)} plays")

    def capture_time(at_ms: float) -> float:
        return anchor + (at_ms - start_event["atMs"]) / 1000.0

    # ---- slices: log deltas, snapped to separator chirps where they agree
    boundaries = []
    for i, play in enumerate(plays):
        t = capture_time(play["atMs"])
        near = [c for c in chirps if abs(c - t) < CHIRP_SNAP_MS / 1000 + 0.35]
        # The separator chirp precedes the clip; the clip starts after it.
        snapped = max(near) + 0.12 + 0.2 if near else t
        boundaries.append(snapped if abs(snapped - t) < 0.5 else t)
    ends = boundaries[1:] + [min(len(y) / sr, boundaries[-1] + 4.0)]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = whisper.load_model(args.model, device=device)

    results = []
    started = time.time()
    with tempfile.TemporaryDirectory(prefix="capture-") as tmp:
        for i, play in enumerate(plays):
            key = play["key"]
            expect = by_key.get(key)
            a = int(max(0, boundaries[i]) * sr)
            b = int(max(0, ends[i] - 0.35) * sr)  # stop before the next chirp
            seg = y[a:b]
            if len(seg) < sr // 10 or expect is None:
                results.append({"key": key, "verdict": "fail", "severity": 100,
                                "error": "empty slice or unknown key", "checks": {}})
                continue

            if expect["kind"] == "tone":
                spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
                dom = float(np.fft.rfftfreq(len(seg), 1 / sr)[int(np.argmax(spectrum))])
                ok = abs(dom - expect["freqHz"]) <= expect["freqHz"] * 0.1
                results.append({
                    "key": key, "kind": "tone", "verdict": "pass" if ok else "fail",
                    "severity": 0 if ok else 40,
                    "checks": {"dominantFreqHz": round(dom, 1), "expectedFreqHz": expect["freqHz"],
                               "snrDb": snr_db(seg, noise_rms)},
                })
                continue

            def transcribe(audio: np.ndarray) -> str:
                r = model.transcribe(audio, language="en", temperature=0.0,
                                     condition_on_previous_text=False,
                                     initial_prompt=INITIAL_PROMPT, fp16=(device == "cuda"))
                return r["text"].strip()

            raw_text = transcribe(seg)
            raw = match_score(expect["text"], raw_text)
            best, best_text, won = raw, raw_text, "raw"
            rate = float(expect.get("tempoRate") or 1.0)
            if rate >= SLOWED_MIN_RATE:
                slow_path = Path(tmp) / f"{i}.wav"
                sf.write(slow_path, seg, sr)
                slowed_path = Path(tmp) / f"{i}.slow.wav"
                subprocess.run(
                    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(slow_path),
                     "-af", atempo_chain(1.0 / rate), "-ar", "16000", "-ac", "1", str(slowed_path)],
                    check=True)
                slow_audio, _ = librosa.load(str(slowed_path), sr=16000, mono=True)
                slow_text = transcribe(slow_audio.astype(np.float32))
                slow = match_score(expect["text"], slow_text)
                if slow["score"] > raw["score"]:
                    best, best_text, won = slow, slow_text, "slowed"

            # Tail truncation: speech energy right at the slice end suggests
            # the clip ran into the next chirp.
            tail = seg[-int(0.12 * sr):]
            tail_hot = float(np.sqrt(np.mean(tail**2))) > noise_rms * 6

            score = best["score"]
            if score < FAIL_MAX_SCORE:
                verdict = "fail"
            elif score < PASS_MIN_SCORE or best["filler"] or tail_hot:
                verdict = "suspect"
            else:
                verdict = "pass"
            severity = round((1 - score) * 100) + (15 if best["filler"] else 0) + (10 if tail_hot else 0)

            results.append({
                "key": key, "kind": expect["kind"], "verdict": verdict, "severity": severity,
                "score": score, "expectedText": expect["text"],
                "heard": {"raw": raw_text, "won": won, "best": best_text},
                "missing": best["missing"], "extra": best["extra"], "filler": best["filler"],
                "checks": {"snrDb": snr_db(seg, noise_rms), "tailHot": tail_hot,
                           "sliceAtS": round(boundaries[i], 2),
                           "sliceMs": round((ends[i] - boundaries[i]) * 1000)},
            })
            if (i + 1) % 25 == 0:
                print(f"  {i + 1}/{len(plays)}  ({time.time() - started:.0f}s)")

    totals = {"pass": 0, "suspect": 0, "fail": 0}
    for r in results:
        totals[r["verdict"]] += 1

    out_dir = Path(args.out or f"tools/analysis/reports/capture-{time.strftime('%Y%m%d-%H%M%S')}")
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = {"runId": out_dir.name, "tier": 1, "capture": args.capture,
            "chirpsDetected": len(chirps), "plays": len(plays), "totals": totals}
    (out_dir / "report.json").write_text(
        json.dumps({**meta, "clips": results}, indent=1) + "\n", encoding="utf-8")

    flagged = sorted((r for r in results if r["verdict"] != "pass"), key=lambda r: -r["severity"])
    lines = ["# Tier-1 as-heard validation", "",
             f"- capture: {args.capture}",
             f"- **pass {totals['pass']} / suspect {totals['suspect']} / fail {totals['fail']}**",
             "", "| key | verdict | score | heard | SNR dB | flags |", "|---|---|---|---|---|---|"]
    for r in flagged[:50]:
        ch = r.get("checks", {})
        flags = []
        if r.get("filler"):
            flags.append("filler")
        if r.get("missing"):
            flags.append(f"missing:{'/'.join(r['missing'][:4])}")
        if ch.get("tailHot"):
            flags.append("tail-hot")
        heard = (r.get("heard") or {}).get("best", r.get("error", ""))
        lines.append(f"| {r['key']} | {r['verdict']} | {r.get('score', '-')} | "
                     f"{str(heard)[:44]} | {ch.get('snrDb', '')} | {', '.join(flags)} |")
    if len(flagged) > 50:
        lines.append(f"\n…and {len(flagged) - 50} more — see report.json.")
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\npass {totals['pass']} / suspect {totals['suspect']} / fail {totals['fail']}")
    print(f"Report: {out_dir / 'report.md'}")


if __name__ == "__main__":
    main()
