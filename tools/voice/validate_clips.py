"""Tier-0 clip validator — judge every shipped voice WAV against its script.

For each entry in tools/analysis/expectations.json (built by
export-expectations.mjs), this transcribes the clip with Whisper and scores
the transcript against the text the generator rendered, plus a set of
acoustic checks aimed at the known Chatterbox failure modes:

- dropped syllables (transcript missing scripted words, duration under the
  promised window);
- the "oooooh" artifact (an inserted filler vowel in the transcript, and/or
  a long stretch of voiced audio not covered by any transcribed word);
- runaway takes (duration over the window), ragged edges (leading/trailing
  silence), and — rank-only, because the alimiter makes flat-tops normal —
  crest factor.

Phrase clips ship tempo-fitted at 1.35-2x, which degrades ASR, so every
sped clip is transcribed twice: as-is and slowed back down (ffmpeg atempo
at 1/rate); the better-scoring transcript wins and the report records which.

Tones are not speech: they are checked by dominant frequency and duration.

Run (the Chatterbox venv has whisper + torch CUDA):
  F:/voice-tools/venv/Scripts/python.exe tools/voice/validate_clips.py \
      [--expectations tools/analysis/expectations.json] \
      [--out-dir tools/analysis/reports/<ts>] [--only-keys k1,k2] \
      [--png flagged|all|none] [--limit N] [--model turbo]

The verdict thresholds are deliberately in one block below — Phase A tunes
them against hand-verified clips before anything is auto-flagged for
re-render.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from asr_match import match_score  # noqa: E402

# ---------------------------------------------------------------- thresholds

PASS_MIN_SCORE = 0.85          # at or above: the words are there
FAIL_MAX_SCORE = 0.60          # below: the clip does not say its script
FILLER_FAIL_SCORE = 0.75       # filler vowel present AND score below this -> fail
VOWEL_SPAN_FLAG_MS = 300       # unexplained voiced stretch longer than this -> suspect
EDGE_SILENCE_FLAG_MS = 400     # leading+trailing quiet beyond this -> note
SLOWED_PASS_MIN_RATE = 1.1     # transcribe a slowed copy when tempoRate >= this
WORD_COVER_TOLERANCE_S = 0.1   # voiced audio within this of a word interval is explained
TONE_FREQ_TOLERANCE = 0.08     # dominant frequency within 8% of spec
TONE_DURATION_TOLERANCE = 0.25 # duration within 25% of spec

INITIAL_PROMPT = (
    "Boxing coach calls: one, two, three, four, five, six, bee, body, jab, cross, "
    "lead hook, rear hook, lead uppercut, rear uppercut, slip, roll, duck, pull, "
    "bob and weave, pivot, step off, circle, cut off the ring, reset, go, stop, "
    "switch, coast for fifteen seconds, coast for half a minute."
)

FFMPEG = "ffmpeg"


# ------------------------------------------------------------------ acoustic


def load_audio(path: Path, sr: int | None = None) -> tuple[np.ndarray, int]:
    import librosa

    y, rate = librosa.load(str(path), sr=sr, mono=True)
    return y.astype(np.float32), int(rate)


def frame_rms(y: np.ndarray, sr: int, hop_ms: float = 10.0, win_ms: float = 25.0) -> tuple[np.ndarray, float]:
    hop = max(1, int(sr * hop_ms / 1000))
    win = max(hop, int(sr * win_ms / 1000))
    if len(y) < win:
        return np.array([math.sqrt(float(np.mean(y**2)) + 1e-12)]), hop / sr
    frames = np.lib.stride_tricks.sliding_window_view(y, win)[::hop]
    return np.sqrt(np.mean(frames**2, axis=1) + 1e-12), hop / sr


def edge_silence_ms(y: np.ndarray, sr: int) -> tuple[float, float]:
    rms, hop_s = frame_rms(y, sr)
    threshold = float(rms.max()) * 0.02
    above = np.nonzero(rms > threshold)[0]
    if len(above) == 0:
        total = len(y) / sr * 1000
        return total, total
    lead = above[0] * hop_s * 1000
    trail = (len(rms) - 1 - above[-1]) * hop_s * 1000
    return round(lead, 1), round(trail, 1)


def voiced_spans(y: np.ndarray, sr: int) -> list[tuple[float, float]]:
    """Energetic spans in seconds — relative threshold; loudnorm makes
    absolute thresholds meaningless."""
    rms, hop_s = frame_rms(y, sr)
    mask = rms > float(rms.max()) * 0.07
    spans: list[tuple[float, float]] = []
    start = None
    for i, on in enumerate(mask):
        if on and start is None:
            start = i
        elif not on and start is not None:
            spans.append((start * hop_s, i * hop_s))
            start = None
    if start is not None:
        spans.append((start * hop_s, len(mask) * hop_s))
    # Merge gaps under 60ms — a plosive dip is not the end of a span.
    merged: list[tuple[float, float]] = []
    for s, e in spans:
        if merged and s - merged[-1][1] < 0.06:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return merged


def unexplained_voiced_ms(y: np.ndarray, sr: int, words: list[dict]) -> float:
    """Longest contiguous voiced stretch not covered by any transcribed word."""
    intervals = [
        (w["start"] - WORD_COVER_TOLERANCE_S, w["end"] + WORD_COVER_TOLERANCE_S) for w in words
    ]
    worst = 0.0
    for s, e in voiced_spans(y, sr):
        cursor = s
        # Walk the span, subtracting word coverage.
        while cursor < e:
            covering = [iv for iv in intervals if iv[0] <= cursor < iv[1]]
            if covering:
                cursor = max(iv[1] for iv in covering)
            else:
                nxt = min((iv[0] for iv in intervals if iv[0] > cursor), default=e)
                worst = max(worst, min(nxt, e) - cursor)
                cursor = min(nxt, e)
    return round(worst * 1000, 1)


def crest_db(y: np.ndarray) -> float:
    rms = math.sqrt(float(np.mean(y**2)) + 1e-12)
    peak = float(np.max(np.abs(y)) + 1e-12)
    return round(20 * math.log10(peak / rms), 1)


def dominant_freq_hz(y: np.ndarray, sr: int) -> float:
    spectrum = np.abs(np.fft.rfft(y * np.hanning(len(y))))
    freqs = np.fft.rfftfreq(len(y), 1 / sr)
    return float(freqs[int(np.argmax(spectrum))])


def atempo_chain(factor: float) -> str:
    """ffmpeg atempo filter chain for one slowdown factor (atempo needs >= 0.5)."""
    stages = []
    remaining = factor
    while remaining < 0.5:
        stages.append(0.5)
        remaining /= 0.5
    stages.append(remaining)
    return ",".join(f"atempo={s:.4f}" for s in stages)


def make_slowed_copy(path: Path, rate: float, tmp_dir: Path) -> Path:
    out = tmp_dir / f"{path.stem}.slow.wav"
    chain = atempo_chain(1.0 / rate)
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
         "-af", chain, "-ar", "16000", "-ac", "1", str(out)],
        check=True,
    )
    return out


# --------------------------------------------------------------- validation


def transcribe(model, audio: np.ndarray, prompted: bool = True) -> dict:
    result = model.transcribe(
        audio,
        language="en",
        temperature=0.0,
        condition_on_previous_text=False,
        initial_prompt=INITIAL_PROMPT if prompted else None,
        word_timestamps=True,
        fp16=True,
    )
    words = [
        {"word": w["word"].strip(), "start": float(w["start"]), "end": float(w["end"])}
        for seg in result["segments"]
        for w in seg.get("words", [])
    ]
    return {"text": result["text"].strip(), "words": words}


def validate_speech(entry: dict, model, tmp_dir: Path) -> dict:
    path = Path(entry["file"])
    y_native, sr_native = load_audio(path)
    duration_ms = round(len(y_native) / sr_native * 1000, 1)
    lead_ms, trail_ms = edge_silence_ms(y_native, sr_native)

    y_raw16, _ = load_audio(path, sr=16000)
    raw = transcribe(model, y_raw16)
    raw_match = match_score(entry["text"], raw["text"])

    slowed = None
    slowed_match = None
    y_slow16 = None
    rate = float(entry.get("tempoRate") or 1.0)
    if rate >= SLOWED_PASS_MIN_RATE:
        slow_path = make_slowed_copy(path, rate, tmp_dir)
        y_slow16, _ = load_audio(slow_path, sr=16000)
        slowed = transcribe(model, y_slow16)
        slowed_match = match_score(entry["text"], slowed["text"])
        slow_path.unlink(missing_ok=True)

    candidates = [("raw", raw, raw_match, y_raw16)]
    if slowed is not None:
        candidates.append(("slowed", slowed, slowed_match, y_slow16))

    # A very low score can be the vocabulary prompt hijacking the decode (the
    # model recites the prompt or loops) rather than the clip itself — retry
    # unprompted before condemning the audio.
    if max(m["score"] for _, _, m, _ in candidates) < 0.3:
        bare = transcribe(model, y_raw16, prompted=False)
        candidates.append(("raw-noprompt", bare, match_score(entry["text"], bare["text"]), y_raw16))
        if y_slow16 is not None:
            bare_slow = transcribe(model, y_slow16, prompted=False)
            candidates.append(
                ("slowed-noprompt", bare_slow, match_score(entry["text"], bare_slow["text"]), y_slow16)
            )

    best_version, best, best_match, y_cover = max(candidates, key=lambda c: c[2]["score"])
    sr_cover = 16000

    vowel_ms = unexplained_voiced_ms(y_cover, sr_cover, best["words"])
    if best_version.startswith("slowed"):
        vowel_ms = round(vowel_ms * rate, 1)  # report in original timebase

    bounds = entry.get("boundsMs") or {}
    advisory = bool(entry.get("boundsAdvisory"))
    under = bounds and duration_ms < bounds["minMs"]
    over = bounds and duration_ms > bounds["maxMs"]
    duration_miss = bool(under or over)

    score = best_match["score"]
    filler = best_match["filler"]

    if score < FAIL_MAX_SCORE or (duration_miss and not advisory) or (filler and score < FILLER_FAIL_SCORE):
        verdict = "fail"
    elif score < PASS_MIN_SCORE or vowel_ms > VOWEL_SPAN_FLAG_MS or filler or duration_miss:
        verdict = "suspect"
    else:
        verdict = "pass"

    severity = round((1 - score) * 100)
    severity += 25 if vowel_ms > VOWEL_SPAN_FLAG_MS else 0
    severity += 20 if (duration_miss and not advisory) else (10 if duration_miss else 0)
    severity += 15 if filler else 0
    severity += 10 if (lead_ms + trail_ms) > EDGE_SILENCE_FLAG_MS else 0

    return {
        "key": entry["key"],
        "kind": entry["kind"],
        "file": entry["file"],
        "verdict": verdict,
        "severity": severity,
        "score": score,
        "expectedText": entry["text"],
        "transcripts": {
            "raw": raw["text"],
            "slowed": slowed["text"] if slowed else None,
            "won": best_version,
        },
        "missing": best_match["missing"],
        "extra": best_match["extra"],
        "filler": filler,
        "checks": {
            "durationMs": duration_ms,
            "boundsMs": bounds or None,
            "boundsAdvisory": advisory,
            "durationMiss": "under" if under else ("over" if over else None),
            "leadSilenceMs": lead_ms,
            "trailSilenceMs": trail_ms,
            "unexplainedVoicedMs": vowel_ms,
            "crestDb": crest_db(y_native),
        },
        "words": best["words"],
    }


def validate_tone(entry: dict) -> dict:
    path = Path(entry["file"])
    y, sr = load_audio(path)
    duration_ms = round(len(y) / sr * 1000, 1)
    freq = dominant_freq_hz(y, sr)
    freq_ok = abs(freq - entry["freqHz"]) <= entry["freqHz"] * TONE_FREQ_TOLERANCE
    duration_ok = abs(duration_ms - entry["durationMs"]) <= entry["durationMs"] * TONE_DURATION_TOLERANCE
    verdict = "pass" if (freq_ok and duration_ok) else "fail"
    return {
        "key": entry["key"],
        "kind": "tone",
        "file": entry["file"],
        "verdict": verdict,
        "severity": 0 if verdict == "pass" else 40,
        "checks": {
            "durationMs": duration_ms,
            "expectedDurationMs": entry["durationMs"],
            "dominantFreqHz": round(freq, 1),
            "expectedFreqHz": entry["freqHz"],
        },
    }


# ------------------------------------------------------------------- report


def write_png(result: dict, out_dir: Path) -> str | None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        y, sr = load_audio(Path(result["file"]))
        t = np.arange(len(y)) / sr
        fig, (ax_wave, ax_spec) = plt.subplots(2, 1, figsize=(11, 6), sharex=True)
        ax_wave.plot(t, y, linewidth=0.4, color="#1EBBC4")
        ax_wave.set_ylabel("amplitude")
        heard = result.get("transcripts", {}).get("raw", "")
        ax_wave.set_title(
            f"{result['key']}  [{result['verdict']}]  score={result.get('score', '-')}\n"
            f"expected: {result.get('expectedText', '')!r}   heard: {heard!r}",
            fontsize=9,
        )
        # Word intervals from the winning transcript (already in the analyzed
        # timebase for raw wins; approximate for slowed wins).
        for w in result.get("words", []):
            ax_wave.axvspan(w["start"], w["end"], color="#54E8EF", alpha=0.15)
        ax_spec.specgram(y, Fs=sr, NFFT=512, noverlap=384, cmap="magma")
        ax_spec.set_ylabel("Hz")
        ax_spec.set_xlabel("s")
        fig.tight_layout()
        png_dir = out_dir / "png"
        png_dir.mkdir(exist_ok=True)
        name = result["key"].replace("/", "_") + ".png"
        fig.savefig(png_dir / name, dpi=90)
        plt.close(fig)
        return f"png/{name}"
    except Exception as error:  # PNG is a nicety; never sink the run on it.
        print(f"  png failed for {result['key']}: {error}")
        return None


def write_markdown(out_dir: Path, results: list[dict], meta: dict) -> None:
    totals = {"pass": 0, "suspect": 0, "fail": 0}
    for r in results:
        totals[r["verdict"]] += 1
    flagged = sorted(
        (r for r in results if r["verdict"] != "pass"),
        key=lambda r: -r["severity"],
    )
    lines = [
        "# Tier-0 clip validation",
        "",
        f"- run: {meta['runId']}  model: {meta['model']}  clips: {len(results)}",
        f"- **pass {totals['pass']} / suspect {totals['suspect']} / fail {totals['fail']}**",
        "",
        "| key | verdict | score | heard (raw) | flags |",
        "|---|---|---|---|---|",
    ]
    for r in flagged[:40]:
        checks = r.get("checks", {})
        flags = []
        if r.get("filler"):
            flags.append(f"filler:{'/'.join(r['filler'])}")
        if r.get("missing"):
            flags.append(f"missing:{'/'.join(r['missing'][:4])}")
        if checks.get("durationMiss"):
            flags.append(f"duration-{checks['durationMiss']}({checks['durationMs']}ms)")
        if checks.get("unexplainedVoicedMs", 0) > VOWEL_SPAN_FLAG_MS:
            flags.append(f"vowel-span:{checks['unexplainedVoicedMs']}ms")
        heard = (r.get("transcripts", {}) or {}).get("raw", "")
        lines.append(
            f"| {r['key']} | {r['verdict']} | {r.get('score', '-')} | {heard[:48]} | {', '.join(flags)} |"
        )
    if len(flagged) > 40:
        lines.append(f"\n…and {len(flagged) - 40} more flagged clips — see report.json.")
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


# --------------------------------------------------------------------- main


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expectations", default="tools/analysis/expectations.json")
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--only-keys", default=None)
    parser.add_argument("--png", choices=["flagged", "all", "none"], default="flagged")
    parser.add_argument("--png-cap", type=int, default=60)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--model", default="turbo")
    args = parser.parse_args()

    data = json.loads(Path(args.expectations).read_text(encoding="utf-8"))
    entries = [e for e in data["entries"] if e.get("exists", True)]
    if args.only_keys:
        wanted = {k.strip() for k in args.only_keys.split(",") if k.strip()}
        entries = [e for e in entries if e["key"] in wanted]
    if args.limit:
        entries = entries[: args.limit]

    run_id = time.strftime("%Y%m%d-%H%M%S")
    out_dir = Path(args.out_dir or f"tools/analysis/reports/{run_id}")
    out_dir.mkdir(parents=True, exist_ok=True)

    speech = [e for e in entries if e["kind"] in ("phrase", "word")]
    tones = [e for e in entries if e["kind"] == "tone"]

    import torch
    import whisper

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading whisper {args.model} on {device}…")
    model = whisper.load_model(args.model, device=device)

    results: list[dict] = []
    started = time.time()
    with tempfile.TemporaryDirectory(prefix="clipqa-") as tmp:
        tmp_dir = Path(tmp)
        for i, entry in enumerate(speech):
            try:
                results.append(validate_speech(entry, model, tmp_dir))
            except Exception as error:
                results.append({
                    "key": entry["key"], "kind": entry["kind"], "file": entry["file"],
                    "verdict": "fail", "severity": 100, "error": str(error), "checks": {},
                })
            if (i + 1) % 25 == 0:
                elapsed = time.time() - started
                print(f"  {i + 1}/{len(speech)} clips  ({elapsed:.0f}s)")

    for entry in tones:
        try:
            results.append(validate_tone(entry))
        except Exception as error:
            results.append({
                "key": entry["key"], "kind": "tone", "file": entry["file"],
                "verdict": "fail", "severity": 100, "error": str(error), "checks": {},
            })

    png_targets = []
    if args.png == "all":
        png_targets = results
    elif args.png == "flagged":
        png_targets = sorted(
            (r for r in results if r["verdict"] != "pass"), key=lambda r: -r["severity"]
        )
    for r in png_targets[: args.png_cap]:
        r["png"] = write_png(r, out_dir)

    totals = {"pass": 0, "suspect": 0, "fail": 0}
    for r in results:
        totals[r["verdict"]] += 1
    meta = {
        "runId": run_id,
        "tier": 0,
        "model": args.model,
        "expectations": args.expectations,
        "totals": totals,
    }
    # `words` made the PNGs; it is bulky and derivable, so it stays out of the JSON.
    slim = [{k: v for k, v in r.items() if k != "words"} for r in results]
    (out_dir / "report.json").write_text(
        json.dumps({**meta, "clips": slim}, indent=1) + "\n", encoding="utf-8"
    )
    write_markdown(out_dir, results, meta)

    print(f"\npass {totals['pass']} / suspect {totals['suspect']} / fail {totals['fail']}")
    print(f"Report: {out_dir / 'report.md'}  (+ report.json, png/)")


if __name__ == "__main__":
    main()
