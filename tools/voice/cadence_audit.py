"""Static cadence drift audit — 100 % of the phrase library, no mic.

Kyle hears the coach's call and the ring-highlight animation at
~75 % clean, drift set-dependent. This tool scores every one of the 776
phrase clips against the beat grid the workout runner would use, so we
can find the ~25 % that drift without a live workout — and, more usefully,
we can find them BEFORE they land on the bag.

## What it measures

For each phrase clip:

- **alignment_offset_ms**: how the current placement rule
  (`startAt = firstStrikeMs - readyToneMs - lengthMs`) lands the FIRST
  spoken word relative to the first ring fire. Negative = coach speaks
  before ring 0 (this is the call-ahead contract; ~500–800 ms is normal).
- **cadence_drift_ms[N]** for N ≥ 1: how much the internal spacing of
  spoken words differs from the ring beat grid:
  `(wordOnset[N] - wordOnset[0]) - beatsToMs(N, nominalBpm)`. Positive =
  coach's Nth word falls behind ring N; negative = gets ahead. This is
  the drift Kyle hears — cadence mismatch inside a clip.
- **max_abs_drift_ms** = max |cadence_drift_ms|. The 80 ms bar is the
  "audible" threshold; count of clips below it should match Kyle's ear.

## Per-word onsets

- Manifest's `wordMarks` when populated (127/776 today — the free ground
  truth).
- Otherwise Whisper turbo with `word_timestamps=True`, aligned to token
  order by canonicalising the transcript (asr_match.canonical_tokens).

## Output

- `tools/analysis/reports/cadence-audit.json` — full ledger, one row per
  clip, machine-readable.
- Printable top-25 offenders + aligned-ratio summary.
- Exit 1 iff clips have `source=unavailable` (audit could not measure);
  a fully-measured library exits 0 even with many failures — a real
  drift is a finding, not an error.

Usage:
  node tools/voice/build-cadence-grid.mjs
  F:/voice-tools/venv/Scripts/python.exe tools/voice/cadence_audit.py \
      [--only=cueId,cueId,...] [--limit=N]
"""

from __future__ import annotations

import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asr_match import canonical_tokens

MANIFEST = os.path.join("src", "audio", "voiceAssets", "phraseManifest.ts")
GRID = os.path.join("tools", "voice", "cadence-grid.json")
REPORT_DIR = os.path.join("tools", "analysis", "reports")
REPORT_PATH = os.path.join(REPORT_DIR, "cadence-audit.json")

AUDIBLE_DRIFT_MS = 80  # Kyle's ear-check bar.

# ------------------------------------------------------------- manifest parse

_ENTRY_RE = re.compile(
    r'\{\s*cueId:\s*"([^"]+)",[\s\S]*?'
    r'combination:\s*"([^"]+)",\s*'
    r'cadence:\s*"([^"]+)",\s*'
    r'vocabulary:\s*"([^"]+)",\s*'
    r'performance:\s*"([^"]+)",\s*'
    r'tokens:\s*(\[[^\]]*\]),\s*'
    r'durationMs:\s*(\d+),\s*'
    r"wordMarks:\s*(\[[^\]]*\]),\s*"
    r"module:\s*require\('([^']+)'\)",
)


def parse_manifest() -> list[dict]:
    text = open(MANIFEST, encoding="utf-8").read()
    entries: list[dict] = []
    for m in _ENTRY_RE.finditer(text):
        cue_id, combo, cadence, vocab, perf, tokens_s, dur_s, wm_s, wav_rel = m.groups()
        # Relative path is `../../../assets/...` from src/audio/voiceAssets;
        # normalise to repo-root-relative.
        wav = os.path.normpath(
            os.path.join(os.path.dirname(MANIFEST), wav_rel)
        ).replace("\\", "/")
        entries.append({
            "cueId": cue_id,
            "combination": combo,
            "cadence": cadence,
            "vocabulary": vocab,
            "performance": perf,
            "tokens": json.loads(tokens_s),
            "durationMs": int(dur_s),
            "wordMarks": json.loads(wm_s),
            "wav": wav,
        })
    return entries


# ---------------------------------------------------------------- beat grid

def load_grid():
    grid = json.load(open(GRID, encoding="utf-8"))
    return {
        "bpm": {p["id"]: p["nominalBpm"] for p in grid["profiles"].values()},
        "readyToneMs": grid["leadTimes"]["readyToneMs"],
    }


def beats_to_ms(beats: int | float, bpm: int) -> float:
    return (beats * 60_000.0) / bpm


# --------------------------------------------------------------- word onsets

def per_token_onsets_from_marks(entry: dict) -> list[float] | None:
    """Use populated wordMarks when they cover every token."""
    marks = entry["wordMarks"]
    if len(marks) != len(entry["tokens"]):
        return None
    marks = sorted(marks, key=lambda m: m["tokenIndex"])
    if [m["tokenIndex"] for m in marks] != list(range(len(entry["tokens"]))):
        return None
    return [float(m["offsetMs"]) for m in marks]


_DIGIT_WORDS = {"one": 0, "two": 1, "three": 2, "four": 3, "five": 4, "six": 5, "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5}


def _token_key(token: str) -> str:
    """Canonical head word for a token: '1b' -> 'one', 'slip' -> 'slip'."""
    lower = token.lower()
    if lower.endswith("b") and lower[:-1].isdigit():
        digit = lower[:-1]
    elif lower.isdigit():
        digit = lower
    else:
        return lower  # movement words like 'slip', 'roll' — match as-is
    return {"1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six"}[digit]


def per_token_onsets_from_envelope(entry: dict) -> list[float] | None:
    """Envelope-peak onset detector, mirrors make-phrase-clips.mjs:159.

    12 % of peak, 50 ms gap between onsets. Returns None unless the
    detected count matches the token count — the same guard the manifest
    uses. Deterministic and mic-free; the preferred fallback when the
    shipped `wordMarks` are empty.
    """
    import wave
    expected = len(entry["tokens"])
    try:
        with wave.open(entry["wav"], "rb") as wf:
            sample_rate = wf.getframerate()
            channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            frames = wf.getnframes()
            raw = wf.readframes(frames)
    except Exception:
        return None
    if sampwidth != 2:
        return None
    import struct
    fmt = f"<{frames * channels}h"
    samples = struct.unpack(fmt, raw)
    if channels > 1:
        samples = [max(abs(samples[i * channels + c]) for c in range(channels)) for i in range(frames)]
    else:
        samples = [abs(s) for s in samples]

    window = max(1, int(sample_rate * 0.01))
    envelope: list[tuple[int, int]] = []
    for f in range(0, frames, window):
        end = min(f + window, frames)
        peak = max(samples[f:end])
        envelope.append((int(round((f / sample_rate) * 1000)), peak))
    loudest = max(peak for _, peak in envelope)
    if loudest == 0:
        return None
    threshold = loudest * 0.12
    min_gap_windows = 5

    onsets: list[float] = []
    in_word = False
    below_for = 0
    for at_ms, peak in envelope:
        if peak >= threshold:
            if not in_word:
                onsets.append(float(at_ms))
                in_word = True
            below_for = 0
        elif in_word:
            below_for += 1
            if below_for >= min_gap_windows:
                in_word = False
    return onsets if len(onsets) == expected else None


def per_token_onsets_from_whisper(entry: dict, asr) -> list[float] | None:
    """Fall back to Whisper word_timestamps → align to the token order."""
    try:
        result = asr.transcribe(
            entry["wav"],
            language="en",
            temperature=0.0,
            condition_on_previous_text=False,
            word_timestamps=True,
            fp16=True,
        )
    except Exception as exc:  # noqa: BLE001
        return None

    words: list[dict] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            words.append({"text": w["word"], "start": float(w["start"]) * 1000.0})

    # Canonicalise transcript words the same way the token audit does, then
    # walk the expected token order picking the FIRST unassigned matching
    # onset. This is deliberately greedy — repeat-heavy combos (1-1-2) get
    # their leading and trailing "one" from the two heard "one"s in order.
    heard = []
    for w in words:
        tokens = canonical_tokens(w["text"])
        if not tokens:
            continue
        heard.append({"key": tokens[0], "start": w["start"]})

    onsets: list[float] = []
    heard_cursor = 0
    for token in entry["tokens"]:
        want = _token_key(token)
        found = None
        while heard_cursor < len(heard):
            if heard[heard_cursor]["key"] == want:
                found = heard[heard_cursor]["start"]
                heard_cursor += 1
                break
            heard_cursor += 1
        if found is None:
            return None
        onsets.append(found)
    return onsets


# --------------------------------------------------------------- scoring

def score(entry: dict, onsets: list[float], bpm: int, ready_tone_ms: int) -> dict:
    length_ms = entry["durationMs"]
    align_offset_ms = round(onsets[0] - length_ms - ready_tone_ms, 1)
    drift = []
    for n in range(1, len(onsets)):
        expected_span = beats_to_ms(n, bpm)
        actual_span = onsets[n] - onsets[0]
        drift.append(round(actual_span - expected_span, 1))
    max_abs = round(max((abs(d) for d in drift), default=0.0), 1)
    return {
        "onsetsMs": [round(o, 1) for o in onsets],
        "alignOffsetMs": align_offset_ms,
        "cadenceDriftMs": drift,
        "maxAbsDriftMs": max_abs,
    }


# --------------------------------------------------------------- main

def main() -> int:
    only_arg = next((a for a in sys.argv[1:] if a.startswith("--only=")), None)
    only = set(only_arg[len("--only="):].split(",")) if only_arg else None
    limit_arg = next((a for a in sys.argv[1:] if a.startswith("--limit=")), None)
    limit = int(limit_arg[len("--limit="):]) if limit_arg else None

    entries = parse_manifest()
    if only is not None:
        entries = [e for e in entries if e["cueId"] in only]
    if limit is not None:
        entries = entries[:limit]

    # Multi-token only — no cadence to check on a single-word clip.
    entries = [e for e in entries if len(e["tokens"]) >= 2]

    grid = load_grid()
    bpm_of = grid["bpm"]
    ready_tone_ms = grid["readyToneMs"]

    print(f"auditing {len(entries)} multi-token phrase clips")
    print(f"  bpm: {bpm_of}   readyToneMs: {ready_tone_ms}")

    # Lazy-load Whisper only when a fallback is needed.
    asr = None
    def ensure_asr():
        nonlocal asr
        if asr is None:
            import whisper
            print("  loading whisper turbo (fallback for unpopulated wordMarks)...", flush=True)
            asr = whisper.load_model("turbo")
        return asr

    rows = []
    for idx, entry in enumerate(entries):
        bpm = bpm_of[entry["cadence"]]
        onsets = per_token_onsets_from_marks(entry)
        source = "wordMarks"
        if onsets is None:
            onsets = per_token_onsets_from_envelope(entry)
            if onsets is not None:
                source = "envelope"
        if onsets is None:
            onsets = per_token_onsets_from_whisper(entry, ensure_asr())
            if onsets is not None:
                source = "whisper"
        if onsets is None:
            rows.append({**{k: entry[k] for k in ("cueId", "combination", "cadence", "vocabulary")},
                         "tokens": entry["tokens"], "durationMs": entry["durationMs"],
                         "source": "unavailable", "onsetsMs": None,
                         "alignOffsetMs": None, "cadenceDriftMs": None,
                         "maxAbsDriftMs": None})
            continue
        scored = score(entry, onsets, bpm, ready_tone_ms)
        rows.append({**{k: entry[k] for k in ("cueId", "combination", "cadence", "vocabulary")},
                     "tokens": entry["tokens"], "durationMs": entry["durationMs"],
                     "source": source, **scored})
        if (idx + 1) % 100 == 0:
            print(f"  ...{idx + 1}/{len(entries)} scored", flush=True)

    measured = [r for r in rows if r["source"] != "unavailable"]
    unavailable = [r for r in rows if r["source"] == "unavailable"]
    aligned = [r for r in measured if r["maxAbsDriftMs"] < AUDIBLE_DRIFT_MS]
    ratio = len(aligned) / len(measured) if measured else 0.0

    # Sort worst first for the report.
    measured.sort(key=lambda r: r["maxAbsDriftMs"], reverse=True)

    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as fh:
        json.dump({
            "audibleDriftMs": AUDIBLE_DRIFT_MS,
            "total": len(rows),
            "measured": len(measured),
            "unavailable": len(unavailable),
            "alignedCount": len(aligned),
            "alignedRatio": round(ratio, 3),
            "byVocab": {
                v: {
                    "measured": sum(1 for r in measured if r["vocabulary"] == v),
                    "aligned": sum(1 for r in aligned if r["vocabulary"] == v),
                }
                for v in ("numbers", "techniques")
            },
            "rows": measured + unavailable,
        }, fh, indent=1)

    print(f"\naligned (|maxAbsDriftMs|<{AUDIBLE_DRIFT_MS}): {len(aligned)}/{len(measured)} "
          f"= {ratio*100:.1f}% (Kyle's ear: ~75%)")
    for v in ("numbers", "techniques"):
        m = sum(1 for r in measured if r["vocabulary"] == v)
        a = sum(1 for r in aligned if r["vocabulary"] == v)
        if m:
            print(f"  {v}: {a}/{m} = {a/m*100:.1f}%")
    if unavailable:
        print(f"  unavailable (couldn't measure): {len(unavailable)}")

    print(f"\nTop-25 offenders (worst |maxAbsDriftMs|):")
    for r in measured[:25]:
        print(f"  {r['maxAbsDriftMs']:>6.1f} ms  {r['cueId']:<40}  "
              f"onsets={r['onsetsMs']}  drift={r['cadenceDriftMs']}  ({r['source']})")

    print(f"\nreport -> {REPORT_PATH}")
    return 1 if unavailable else 0


if __name__ == "__main__":
    raise SystemExit(main())
