"""Ad-hoc session hearing test — how well does the mic hear the coach?

Takes a room recording of the tablet playing a workout (no playback log
needed — this predates the Tier-2 logging) and answers: what did the coach
say, when, and how intelligible was it?

Method: energy-based segmentation of the capture into sound events; tones
are identified by dominant frequency against the synthesized tone specs
(bell 660Hz, ready 1320Hz, repeat 990Hz, warning 520Hz); speech events are
transcribed with Whisper and fuzzy-matched against the entire expectation
library (tools/analysis/expectations.json) to identify which clip most
likely played. The report is a timeline with per-utterance intelligibility.

This is a listening instrument, not a verdict machine: without a playback
log it cannot know what SHOULD have played, only how well what DID play
could be understood. Tier 2 proper (validate_session.py) adds the log.

Run:
  F:/voice-tools/venv/Scripts/python.exe tools/audition/analyze_session.py \
      --capture <wav> [--expectations tools/analysis/expectations.json] \
      [--out tools/analysis/reports/session-<ts>]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent / "voice"))
from asr_match import match_score  # noqa: E402

TONES = {
    "bell": 660.0,
    "tone-ready": 1320.0,
    "tone-repeat": 990.0,
    "tone-warning": 520.0,
}
TONE_FREQ_TOLERANCE = 0.10
MIN_EVENT_MS = 120
MERGE_GAP_MS = 350
PAD_MS = 150

INITIAL_PROMPT = (
    "Boxing coach calls: one, two, three, four, five, six, bee, body, jab, cross, "
    "lead hook, rear hook, lead uppercut, rear uppercut, slip, roll, duck, pull, "
    "bob and weave, pivot, step off, circle, cut off the ring, reset, go, stop, "
    "switch, coast for fifteen seconds, coast for half a minute."
)


def frame_rms(y: np.ndarray, sr: int, hop_ms: float = 10.0, win_ms: float = 25.0):
    hop = max(1, int(sr * hop_ms / 1000))
    win = max(hop, int(sr * win_ms / 1000))
    frames = np.lib.stride_tricks.sliding_window_view(y, win)[::hop]
    return np.sqrt(np.mean(frames**2, axis=1) + 1e-12), hop / sr


def find_events(y: np.ndarray, sr: int) -> list[tuple[float, float]]:
    """Sound events in seconds, threshold set off the noise floor."""
    rms, hop_s = frame_rms(y, sr)
    floor = np.percentile(rms, 20)
    peak = rms.max()
    threshold = max(floor * 4, peak * 0.04)
    mask = rms > threshold
    events: list[tuple[float, float]] = []
    start = None
    below = 0
    gap_frames = int(MERGE_GAP_MS / 1000 / hop_s)
    for i, on in enumerate(mask):
        if on:
            if start is None:
                start = i
            below = 0
        elif start is not None:
            below += 1
            if below >= gap_frames:
                events.append((start * hop_s, (i - below) * hop_s))
                start = None
    if start is not None:
        events.append((start * hop_s, len(mask) * hop_s))
    return [(s, e) for s, e in events if (e - s) * 1000 >= MIN_EVENT_MS]


def classify_tone(seg: np.ndarray, sr: int) -> str | None:
    spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    freqs = np.fft.rfftfreq(len(seg), 1 / sr)
    dom = float(freqs[int(np.argmax(spectrum))])
    # A tone concentrates its energy: the dominant bin dwarfs the median.
    tonality = float(spectrum.max()) / (float(np.median(spectrum)) + 1e-9)
    if tonality < 50:
        return None
    for name, freq in TONES.items():
        if abs(dom - freq) <= freq * TONE_FREQ_TOLERANCE:
            return name
    return None


def snr_db(seg: np.ndarray, noise_rms: float) -> float:
    seg_rms = float(np.sqrt(np.mean(seg**2) + 1e-12))
    return round(20 * np.log10(seg_rms / (noise_rms + 1e-12)), 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", required=True)
    parser.add_argument("--expectations", default="tools/analysis/expectations.json")
    parser.add_argument("--out", default=None)
    parser.add_argument("--model", default="turbo")
    args = parser.parse_args()

    import librosa
    import torch
    import whisper

    y, sr = librosa.load(args.capture, sr=16000, mono=True)
    y = y.astype(np.float32)
    rms_all, _ = frame_rms(y, sr)
    noise_rms = float(np.percentile(rms_all, 20))

    expectations = json.loads(Path(args.expectations).read_text(encoding="utf-8"))
    library = [e for e in expectations["entries"] if e["kind"] in ("phrase", "word")]

    events = find_events(y, sr)
    print(f"{len(events)} sound events in {len(y) / sr:.0f}s of capture")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = whisper.load_model(args.model, device=device)

    timeline = []
    for start_s, end_s in events:
        a = max(0, int((start_s - PAD_MS / 1000) * sr))
        b = min(len(y), int((end_s + PAD_MS / 1000) * sr))
        seg = y[a:b]
        tone = classify_tone(seg, sr)
        entry = {
            "atS": round(start_s, 2),
            "durMs": round((end_s - start_s) * 1000),
            "snrDb": snr_db(seg, noise_rms),
        }
        if tone:
            entry["kind"] = "tone"
            entry["tone"] = tone
            timeline.append(entry)
            continue

        result = model.transcribe(
            seg,
            language="en",
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=INITIAL_PROMPT,
            fp16=(device == "cuda"),
        )
        heard = result["text"].strip()
        entry["kind"] = "speech"
        entry["heard"] = heard
        if heard:
            best = max(
                (dict(key=e["key"], **match_score(e["text"], heard)) for e in library),
                key=lambda m: m["score"],
            )
            entry["bestMatch"] = {"key": best["key"], "score": best["score"]}
        timeline.append(entry)

    speech = [t for t in timeline if t["kind"] == "speech" and t.get("heard")]
    matched = [t for t in speech if t.get("bestMatch", {}).get("score", 0) >= 0.8]
    tones = [t for t in timeline if t["kind"] == "tone"]

    out_dir = Path(args.out or f"tools/analysis/reports/session-{time.strftime('%Y%m%d-%H%M%S')}")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "session.json").write_text(json.dumps(timeline, indent=1) + "\n", encoding="utf-8")

    lines = [
        "# Session hearing test",
        "",
        f"- capture: {args.capture}",
        f"- events: {len(timeline)}  tones: {len(tones)}  utterances: {len(speech)}",
        f"- clearly identified (match >= 0.8): {len(matched)}/{len(speech)}",
        "",
        "| t | kind | heard | best match | score | SNR dB |",
        "|---|---|---|---|---|---|",
    ]
    for t in timeline:
        if t["kind"] == "tone":
            lines.append(f"| {t['atS']:.1f}s | tone | {t['tone']} | | | {t['snrDb']} |")
        else:
            bm = t.get("bestMatch") or {}
            lines.append(
                f"| {t['atS']:.1f}s | speech | {t.get('heard', '')[:44]} | "
                f"{bm.get('key', '')} | {bm.get('score', '')} | {t['snrDb']} |"
            )
    (out_dir / "session.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"clearly identified {len(matched)}/{len(speech)} utterances; report: {out_dir / 'session.md'}")


if __name__ == "__main__":
    main()
