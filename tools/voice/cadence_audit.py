"""Static cadence drift audit — 100 % of the phrase library, no mic.

Kyle's precise ask (2026-08-28): measure the exact offset from
"end of noise on each word" to "corresponding punch node lighting up",
per-clip and per-token, then find the clips where that offset is
inconsistent (varies across tokens or across the library). A library
with uniform end-of-word → ring-fire offsets is what the future scalable
mapping architecture guarantees; the audit measures how far we are from
it today.

## What it measures

For each phrase clip WITH populated wordMarks (endOffsetMs baked in):

- **endToRingMs[N]**: at the current placement rule
  (`startAt = firstStrikeMs - readyToneMs - lengthMs`), how many ms after
  the coach's Nth word ENDS does ring N light up? Formula:
    `endToRingMs[N] = beatsToMs(N, bpm) + readyToneMs + (lengthMs - endOffsetMs[N])`
  Positive = ring lags coach; negative = ring precedes end-of-word.
- **meanEndToRingMs**: average across the clip's tokens.
- **spreadEndToRingMs**: max(endToRingMs) − min(endToRingMs). This is
  the WITHIN-clip drift Kyle hears: if the first ring fires 150 ms after
  the first word and the last ring fires 900 ms after the last word,
  spread = 750 ms and the coach's rhythm doesn't match the ring rhythm.
- **stdDevEndToRingMs**: statistical variability of the offset.

Legacy metric (kept for continuity but no longer the ranking key):
- **cadenceDriftMs[N]**: `(wordOnset[N] - wordOnset[0]) - beatsToMs(N, bpm)`.
  Ranks clips by internal cadence mismatch; noisy on compact previews.

## Per-word onsets/ends

- Manifest's `wordMarks` when populated with `endOffsetMs` (the
  primary source; 127/776 today after the endOffsetMs backfill).
- Otherwise envelope-based re-detection here in Python.
- Otherwise Whisper turbo with `word_timestamps=True` (onset-only;
  end-of-word estimated as onset + 300 ms — coarse fallback).

## Output

- `tools/analysis/reports/cadence-audit.json` — full ledger, per clip:
  onsetsMs, endsMs, endToRingMs, spreadEndToRingMs, stdDevEndToRingMs,
  meanEndToRingMs, source. Machine-readable.
- Printable summary: histogram of spread across library, top-25 clips
  with largest spread (worst within-clip drift), and the median
  cross-clip endToRingMs (the CANDIDATE target K for the eventual
  scalable rail).

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

# The rail's constant: ring N fires this long after word N's audible
# envelope ends. Tunable; kept in one place so the audit's rail-mode
# simulation and the runtime placement math agree. See rail_default_K().
DEFAULT_RAIL_K_MS = 120

# ------------------------------------------------------------- manifest parse

_ENTRY_RE = re.compile(
    r'\{\s*cueId:\s*"([^"]+)",[\s\S]*?'
    r'combination:\s*"([^"]+)",\s*'
    r'cadence:\s*"([^"]+)",\s*'
    r'vocabulary:\s*"([^"]+)",\s*'
    r'performance:\s*"([^"]+)",\s*'
    r'tokens:\s*(\[[^\]]*\]),\s*'
    r'durationMs:\s*(\d+),\s*'
    r'wordMarks:\s*(\[[^\]]*\]),\s*'
    r'(?:wordMarksSource:\s*"[^"]*",\s*)?'
    r'(?:startPadMs:\s*-?\d+,\s*)?'
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

def per_token_marks_from_manifest(entry: dict) -> tuple[list[float], list[float | None]] | None:
    """Return (onsets, ends) when wordMarks cover every token. ends[N] may
    be None for legacy marks lacking `endOffsetMs`."""
    marks = entry["wordMarks"]
    if len(marks) != len(entry["tokens"]):
        return None
    marks = sorted(marks, key=lambda m: m["tokenIndex"])
    if [m["tokenIndex"] for m in marks] != list(range(len(entry["tokens"]))):
        return None
    onsets = [float(m["offsetMs"]) for m in marks]
    ends: list[float | None] = [
        float(m["endOffsetMs"]) if isinstance(m.get("endOffsetMs"), (int, float)) else None
        for m in marks
    ]
    return onsets, ends


def per_token_onsets_from_marks(entry: dict) -> list[float] | None:
    result = per_token_marks_from_manifest(entry)
    return None if result is None else result[0]


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


def per_token_marks_from_envelope(entry: dict) -> tuple[list[float], list[float]] | None:
    """Envelope-peak span detector, returns (onsets, ends). Same algorithm
    as make-phrase-clips.mjs:measureWordSpans. Deterministic, mic-free.
    """
    import wave
    import struct
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
    window_ms = int(round((window / sample_rate) * 1000))

    spans: list[tuple[float, float]] = []
    in_word = False
    below_for = 0
    cur_start = 0
    last_loud = 0
    for at_ms, peak in envelope:
        if peak >= threshold:
            if not in_word:
                cur_start = at_ms
                in_word = True
            last_loud = at_ms
            below_for = 0
        elif in_word:
            below_for += 1
            if below_for >= min_gap_windows:
                spans.append((float(cur_start), float(last_loud + window_ms)))
                in_word = False
    if in_word:
        spans.append((float(cur_start), float(last_loud + window_ms)))

    if len(spans) != expected:
        return None
    return [s[0] for s in spans], [s[1] for s in spans]


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

def score(
    entry: dict,
    onsets: list[float],
    ends: list[float | None],
    bpm: int,
    ready_tone_ms: int,
) -> dict:
    """Kyle's precise metric: for each token N with a known end-of-word,
    compute the milliseconds between word[N] ending and ring[N] lighting
    under the current placement rule (startAt = firstStrikeMs − readyToneMs
    − lengthMs). The library's goal is a NARROW distribution of this offset
    across every token in every clip — that's what the scalable rail
    guarantees. spread + stdDev measure how far a clip is from that goal.

    Legacy `cadenceDriftMs` is kept alongside so we can compare rankings
    while the metric is being calibrated.
    """
    length_ms = entry["durationMs"]

    # Legacy per-token cadence drift (onset-based).
    align_offset_ms = round(onsets[0] - length_ms - ready_tone_ms, 1)
    cadence_drift = []
    for n in range(1, len(onsets)):
        cadence_drift.append(round((onsets[n] - onsets[0]) - beats_to_ms(n, bpm), 1))
    max_abs_drift = round(max((abs(d) for d in cadence_drift), default=0.0), 1)

    # Precise end-of-word → ring metric.
    end_to_ring: list[float | None] = []
    for n, end in enumerate(ends):
        if end is None:
            end_to_ring.append(None)
        else:
            end_to_ring.append(round(beats_to_ms(n, bpm) + ready_tone_ms + (length_ms - end), 1))
    measured = [v for v in end_to_ring if v is not None]

    if measured:
        mean = round(sum(measured) / len(measured), 1)
        spread = round(max(measured) - min(measured), 1)
        var = sum((v - mean) ** 2 for v in measured) / len(measured)
        std_dev = round(var ** 0.5, 1)
    else:
        mean = spread = std_dev = None

    return {
        "onsetsMs": [round(o, 1) for o in onsets],
        "endsMs": [None if e is None else round(e, 1) for e in ends],
        "endToRingMs": end_to_ring,
        "meanEndToRingMs": mean,
        "spreadEndToRingMs": spread,
        "stdDevEndToRingMs": std_dev,
        "alignOffsetMs": align_offset_ms,
        "cadenceDriftMs": cadence_drift,
        "maxAbsDriftMs": max_abs_drift,
    }


# --------------------------------------------------------------- main

def rail_default_K() -> int:
    return DEFAULT_RAIL_K_MS


def main() -> int:
    only_arg = next((a for a in sys.argv[1:] if a.startswith("--only=")), None)
    only = set(only_arg[len("--only="):].split(",")) if only_arg else None
    limit_arg = next((a for a in sys.argv[1:] if a.startswith("--limit=")), None)
    limit = int(limit_arg[len("--limit="):]) if limit_arg else None
    rail_arg = next((a for a in sys.argv[1:] if a.startswith("--rail")), None)
    rail_mode = rail_arg is not None
    rail_k = DEFAULT_RAIL_K_MS
    if rail_arg and "=" in rail_arg:
        try:
            rail_k = int(rail_arg.split("=", 1)[1])
        except ValueError:
            pass

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
        # Prefer manifest wordMarks (deterministic + carries endOffsetMs);
        # fall back to a fresh envelope scan (also carries ends); Whisper
        # is the last resort and only knows onsets (ends are estimated).
        marks = per_token_marks_from_manifest(entry)
        source = "wordMarks"
        if marks is None or all(e is None for e in marks[1]):
            env = per_token_marks_from_envelope(entry)
            if env is not None:
                marks = (env[0], list(env[1]))
                source = "envelope"
        if marks is None:
            onsets = per_token_onsets_from_whisper(entry, ensure_asr())
            if onsets is not None:
                # Whisper is onset-only; estimate end-of-word as +300 ms per
                # word or clip end, whichever is smaller. Coarse; flagged so
                # a Kyle-eye can see which rows to trust.
                length_ms = entry["durationMs"]
                ends = [min(o + 300.0, float(length_ms)) for o in onsets]
                marks = (onsets, ends)
                source = "whisper"
        if marks is None:
            onsets = None
        else:
            onsets, ends = marks
        if onsets is None:
            rows.append({**{k: entry[k] for k in ("cueId", "combination", "cadence", "vocabulary")},
                         "tokens": entry["tokens"], "durationMs": entry["durationMs"],
                         "source": "unavailable", "onsetsMs": None, "endsMs": None,
                         "endToRingMs": None, "meanEndToRingMs": None,
                         "spreadEndToRingMs": None, "stdDevEndToRingMs": None,
                         "alignOffsetMs": None, "cadenceDriftMs": None,
                         "maxAbsDriftMs": None})
            continue
        scored = score(entry, onsets, ends, bpm, ready_tone_ms)
        rows.append({**{k: entry[k] for k in ("cueId", "combination", "cadence", "vocabulary")},
                     "tokens": entry["tokens"], "durationMs": entry["durationMs"],
                     "source": source, **scored})
        if (idx + 1) % 100 == 0:
            print(f"  ...{idx + 1}/{len(entries)} scored", flush=True)

    measured = [r for r in rows if r["source"] != "unavailable"]
    unavailable = [r for r in rows if r["source"] == "unavailable"]
    aligned = [r for r in measured if r["maxAbsDriftMs"] < AUDIBLE_DRIFT_MS]
    ratio = len(aligned) / len(measured) if measured else 0.0

    # Precise-metric summary (Kyle's ask: end-of-word to ring-fire).
    with_end = [r for r in measured if r.get("spreadEndToRingMs") is not None]
    within_clip_tight = [r for r in with_end if r["spreadEndToRingMs"] < 60.0]
    within_ratio = len(within_clip_tight) / len(with_end) if with_end else 0.0
    means = [r["meanEndToRingMs"] for r in with_end]
    if means:
        means_sorted = sorted(means)
        mid = means_sorted[len(means_sorted) // 2]
        cross_mean = sum(means) / len(means)
        cross_var = sum((m - cross_mean) ** 2 for m in means) / len(means)
        cross_std = cross_var ** 0.5
    else:
        mid = cross_mean = cross_std = 0.0

    # Sort worst first: by the new spread metric (per-clip within-drift).
    with_end.sort(key=lambda r: r["spreadEndToRingMs"], reverse=True)
    # Keep the legacy list too for the tail of the report.
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

    print(f"\n=== end-of-word to ring-fire (Kyle's precise metric) ===")
    print(f"clips with endOffsetMs: {len(with_end)}/{len(measured)}")
    print(f"within-clip spread < 60 ms: {len(within_clip_tight)}/{len(with_end)} = {within_ratio*100:.1f}%")
    print(f"cross-clip meanEndToRingMs: median {mid:.0f} ms  mean {cross_mean:.0f} ms  stdDev {cross_std:.0f} ms")
    print(f"(a rail-mode library should have per-clip spread ~ 0 and cross-clip stdDev ~ 0 around a constant K)")

    print(f"\n=== legacy: |maxAbsDriftMs|<{AUDIBLE_DRIFT_MS}: {len(aligned)}/{len(measured)} = {ratio*100:.1f}% ===")
    for v in ("numbers", "techniques"):
        m = sum(1 for r in measured if r["vocabulary"] == v)
        a = sum(1 for r in aligned if r["vocabulary"] == v)
        if m:
            print(f"  {v}: {a}/{m} = {a/m*100:.1f}%")
    if unavailable:
        print(f"  unavailable (couldn't measure): {len(unavailable)}")

    print(f"\nTop-25 offenders (worst spreadEndToRingMs — the ear-drift signal):")
    for r in with_end[:25]:
        print(f"  spread={r['spreadEndToRingMs']:>6.1f}ms  mean={r['meanEndToRingMs']:>6.1f}ms  "
              f"{r['cueId']:<40}  endToRing={r['endToRingMs']}  ({r['source']})")

    if rail_mode:
        # The scalable rail: ring N fires K ms after word N's envelope ends.
        # By construction, endToRingMs[N] = K for all N in every clip that
        # has populated wordMarks. Clips without wordMarks fall back to the
        # beat grid and keep their pre-rail drift.
        rail_eligible = with_end  # Every clip with per-token endOffsetMs.
        rail_ineligible = [r for r in measured if r.get("spreadEndToRingMs") is None]
        eligible_ratio = len(rail_eligible) / len(measured) if measured else 0.0
        # For rail-eligible clips: perfect uniformity by construction — all
        # tokens end K ms before their ring. We report this to make the
        # win-picture explicit; the *actual* audit-under-rail is trivial.
        print(f"\n=== rail-mode simulation (K = {rail_k} ms) ===")
        print(f"eligible (has endOffsetMs): {len(rail_eligible)}/{len(measured)} "
              f"= {eligible_ratio * 100:.1f}%")
        print(f"under the rail, eligible clips have endToRingMs = {rail_k} ms for every token "
              f"(spread = 0, stdDev = 0) by construction.")
        print(f"ineligible clips ({len(rail_ineligible)}) fall back to the beat grid — their "
              "current drift is the ledger above.")
        for v in ("numbers", "techniques"):
            m = sum(1 for r in measured if r["vocabulary"] == v)
            e = sum(1 for r in rail_eligible if r["vocabulary"] == v)
            if m:
                print(f"  {v}: {e}/{m} eligible = {e/m*100:.1f}%")

    print(f"\nreport -> {REPORT_PATH}")
    return 1 if unavailable else 0


if __name__ == "__main__":
    raise SystemExit(main())
