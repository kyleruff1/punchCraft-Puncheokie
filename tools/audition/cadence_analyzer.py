"""Live cadence analyzer — walks a monitor-session trio and measures
call-vs-ring drift under real dispatch conditions.

The static audit (`tools/voice/cadence_audit.py`) predicts drift for every
clip in the library from wordMarks / envelope / whisper — the ledger of
"what SHOULD misalign." This tool measures what actually DID misalign in
one recorded workout: real launch latencies, real RN starvation gaps, real
Whisper word timestamps against the mic capture, and — critically — the
real `puncheokie.cue.tokenDue` events the runner logged (Part A).

## Status (2026-09-07): TIER-2, mic only

The phrase-play half of this analyzer is retired with the per-punch phrase
corpus (V2 Phase 5-iv). The standing live check is now mic-free:

    node tools/analysis/observed-timing.mjs --session <dir>

which joins the silent playhead observer's real onsets and ends (GH #291)
to the runner's dispatch records — no Whisper, no ffmpeg, no room. Reach for
THIS tool only when the runtime schedule is provably right and the audio
still reads drifty to the ear: that is a clip-render question, and only a
microphone can answer it. The `tokenDue` parser lives in
`tools/audition/logparse.py` and is shared.

## Inputs

A session directory produced by `tools/audition/monitor-session.mjs`:

    manifest.json     startedEpochMs, endedEpochMs, shots[], anchors
    log.txt           adb logcat -v epoch -s ReactNativeJS:I
    capture.wav       Focusrite recording (48 kHz mono)

## Method

1. Read anchors from manifest (audio-t0, logcat-first). If absent, compute
   via `tools/audition/anchor.mjs`.
2. Parse `puncheokie.cue.tokenDue` and `puncheokie.voice.play` from the
   log; group tokenDue events by cueId.
3. For each phrase-mode play:
   - Slice `capture.wav` from launchEpoch − 150 ms to launchEpoch +
     durationMs + 250 ms.
   - Whisper turbo with `word_timestamps=True`; canonicalise; align to
     tokens in play order.
   - Per-token measured offset = mic_word_epoch − scheduled_ring_epoch.
   - Compare against Part B prediction; flag matchesAudit as
     yes / no / worse.
4. Emit `cadence-report.json` in the session dir + a printable table
   sorted by |offset| descending.

## Output

    tools/analysis/monitor/<name>/cadence-report.json

Top of the printable report:
    N/M cues within ±80 ms · worst K listed below

## Usage

    node tools/audition/anchor.mjs <sessionDir>       # if manifest lacks anchors
    F:/voice-tools/venv/Scripts/python.exe tools/audition/cadence_analyzer.py <sessionDir>
"""

from __future__ import annotations

import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "voice"))

from asr_match import canonical_tokens

AUDIBLE_DRIFT_MS = 80


def _find_ffmpeg() -> str:
    """Match the render pipeline's ffmpeg lookup so this tool works on
    the same box without extra config."""
    import shutil
    p = shutil.which("ffmpeg")
    if p:
        return p
    winget = os.path.expanduser(
        "~/AppData/Local/Microsoft/WinGet/Packages/"
        "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/"
        "ffmpeg-9.0-full_build/bin/ffmpeg.exe"
    )
    if os.path.exists(winget):
        return winget
    raise RuntimeError("ffmpeg not found on PATH or in the winget install location")

_TOKEN_DUE_RE = re.compile(
    r"^\s*(\d+\.\d+)\s.*puncheokie\.cue\.tokenDue.*"
    r"cueId:\s*'([^']+)'.*combination:\s*'([^']+)'.*"
    r"tokenIndex:\s*(\d+).*ordinal:\s*(-?\d+).*"
    r"workElapsedMs:\s*(\d+).*monotonicTimeMs:\s*(\d+)",
    re.DOTALL,
)

# RETIRED (V2 Phase 5-iv, commit 369a2c6): the per-punch phrase corpus is
# gone, and with it the `'combination phrase playing'` message and its
# `cueId` / `cadence` / `launchLateMs` fields. This regex matched nothing on
# every capture since — `parse_log` returned zero plays and every consumer
# printed a clean "0 rows" instead of failing. It is kept, disabled, only so
# nobody re-derives it from an old report.
#
# What a coach play looks like today (src/audio/VoiceOutputExpo.ts):
#   '[puncheokie.voice.play] clip playing', { asset, kind, label, playId,
#     traceId, path, dispatchMs, durationMs, volume, … }
# Parse it with tools/audition/logparse.py, which also reads the silent
# observer's `puncheokie.voice.observed` records (GH #291) — those carry the
# real onset and end, which is what this file's mic pass was approximating.
_VOICE_PLAY_RE = None


def parse_log(log_path: str) -> tuple[list[dict], list[dict]]:
    """Return (tokenDue events, phrase-play events). Multi-line-safe: each
    log line's continuation lines carry the same epoch prefix, so we glue
    ReactNativeJS: lines back into one record before regexing.
    """
    lines = open(log_path, encoding="utf-8", errors="replace").readlines()
    # Glue continuations: any line whose ReactNativeJS payload starts with
    # a leading space belongs to the previous record.
    records: list[str] = []
    for line in lines:
        stripped = line.rstrip("\n")
        m = re.match(r"^\s*(\d+\.\d+)\s+\d+\s+\d+\s+[IWEF]\s+ReactNativeJS:\s*(.*)$", stripped)
        if not m:
            continue
        epoch_prefix, payload = m.group(1), m.group(2)
        # A continuation payload doesn't start with a quoted event name.
        if records and not payload.lstrip().startswith("'["):
            records[-1] = records[-1] + " " + payload.strip()
        else:
            records.append(stripped)

    token_due, voice_play = [], []
    for rec in records:
        m = _TOKEN_DUE_RE.search(rec)
        if m:
            token_due.append({
                "epochMs": int(round(float(m.group(1)) * 1000)),
                "cueId": m.group(2),
                "combination": m.group(3),
                "tokenIndex": int(m.group(4)),
                "ordinal": int(m.group(5)),
                "workElapsedMs": int(m.group(6)),
                "monotonicTimeMs": int(m.group(7)),
            })
            continue
        m = _VOICE_PLAY_RE.search(rec) if _VOICE_PLAY_RE is not None else None
        if m:
            voice_play.append({
                "epochMs": int(round(float(m.group(1)) * 1000)),
                "cueId": m.group(2),
                "combination": m.group(3),
                "cadence": m.group(4),
                "durationMs": int(m.group(5)),
                "launchLateMs": int(m.group(6)) if m.group(6) else 0,
            })
    if token_due and not voice_play:
        print(
            "note: 0 phrase plays — the per-punch phrase corpus was retired in\n"
            "      V2 Phase 5-iv, so this tool's Whisper pass has nothing to align.\n"
            "      The mic-free replacement is:\n"
            "        node tools/analysis/observed-timing.mjs --session <dir>",
            file=sys.stderr,
        )
    return token_due, voice_play


def load_anchors(session_dir: str) -> dict:
    manifest_path = os.path.join(session_dir, "manifest.json")
    try:
        manifest = json.load(open(manifest_path, encoding="utf-8"))
    except FileNotFoundError:
        manifest = {}
    if manifest.get("audioT0EpochMs") is None:
        # Best-effort inline; better to instruct the caller to run anchor.mjs.
        raise SystemExit(
            f"manifest.json is missing audioT0EpochMs — run: node tools/audition/anchor.mjs {session_dir}"
        )
    return manifest


def slice_and_transcribe(capture_path: str, audio_t0_ms: int, start_epoch_ms: int, end_epoch_ms: int, asr):
    """Slice via ffmpeg (byte-identical to the CLI path that produces
    per-word timestamps) and whisper-transcribe. Returns per-word
    {word, epochMs, endEpochMs} lists.

    Using Python's `wave` module to slice + Whisper's numpy path
    collapsed multi-word phrases into a single span; ffmpeg avoids that.
    """
    import subprocess
    import tempfile

    start_s = max(0.0, (start_epoch_ms - audio_t0_ms) / 1000.0)
    end_s = max(start_s + 0.05, (end_epoch_ms - audio_t0_ms) / 1000.0)
    duration_s = end_s - start_s

    ffmpeg = _find_ffmpeg()
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
             "-ss", f"{start_s:.3f}", "-t", f"{duration_s:.3f}",
             "-i", capture_path, "-ac", "1", "-ar", "16000",
             tmp.name],
            check=True,
        )
        result = asr.transcribe(
            tmp.name,
            language="en",
            temperature=0.0,
            condition_on_previous_text=False,
            word_timestamps=True,
            fp16=True,
        )
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            heard_start = start_epoch_ms + int(round(float(w["start"]) * 1000))
            heard_end = start_epoch_ms + int(round(float(w["end"]) * 1000))
            words.append({
                "word": w["word"],
                "epochMs": heard_start,
                "endEpochMs": heard_end,
            })
    return words


_DIGIT_MAP = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
              "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6"}


def _token_key(token: str) -> str:
    lower = token.lower()
    if lower.endswith("b") and lower[:-1].isdigit():
        return _DIGIT_MAP[lower[:-1]]
    if lower.isdigit():
        return _DIGIT_MAP[lower]
    return lower


def align_to_tokens(tokens: list[str], heard_words: list[dict]) -> list[tuple[int, int] | None]:
    """Greedy: for each token in order, pick the first unassigned heard
    word whose canonical form matches. Returns per-token (startEpoch,
    endEpoch) or None. Both times matter for the rail: end-of-word is
    the anchor Kyle judges against ring fire.
    """
    onsets: list[tuple[int, int] | None] = []
    cursor = 0
    for token in tokens:
        want = _token_key(token)
        # Compare against Whisper's word — canonicalise the same way as the
        # token audit does so 'B' folds to 'bee' etc.
        found: tuple[int, int] | None = None
        while cursor < len(heard_words):
            heard = heard_words[cursor]["word"]
            key = canonical_tokens(heard)
            head_num = None
            if key:
                if key[0] in {"one", "two", "three", "four", "five", "six"}:
                    head_num = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6"}[key[0]]
                else:
                    head_num = key[0]
            cursor += 1
            if head_num == want or head_num == _DIGIT_MAP.get(want, want):
                w = heard_words[cursor - 1]
                found = (w["epochMs"], w["endEpochMs"])
                break
        onsets.append(found)
    return onsets


def load_audit_predictions() -> dict:
    path = os.path.join("tools", "analysis", "reports", "cadence-audit.json")
    try:
        rep = json.load(open(path, encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return {row["cueId"]: row for row in rep.get("rows", [])}


def matches_audit(measured_drift: list[float | None], audit_row: dict | None) -> str:
    if audit_row is None or audit_row.get("cadenceDriftMs") is None:
        return "no-prediction"
    predicted = audit_row["cadenceDriftMs"]
    if len(predicted) != len(measured_drift):
        return "shape-mismatch"
    # Sign and magnitude both roughly match?
    for p, m in zip(predicted, measured_drift):
        if m is None:
            return "unmeasured"
        if abs(m - p) > 100:
            return "no"
        if abs(m) > abs(p) + 100:
            return "worse"
    return "yes"


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: cadence_analyzer.py <session_dir>", file=sys.stderr)
        return 1
    session_dir = sys.argv[1]
    manifest = load_anchors(session_dir)
    audio_t0 = manifest["audioT0EpochMs"]

    log_path = os.path.join(session_dir, "log.txt")
    if not os.path.exists(log_path):
        log_path = os.path.join(session_dir, "logcat.txt")
    token_due, voice_play = parse_log(log_path)

    print(f"session: {session_dir}")
    print(f"  audio_t0_epoch = {audio_t0}")
    print(f"  token-due events: {len(token_due)}   phrase plays: {len(voice_play)}")

    # Group token-due by (cueId, tokenIndex): the earliest epoch is the
    # scheduled ring fire (later duplicates come from the beat cursor guard).
    scheduled: dict[tuple[str, int], int] = {}
    for e in token_due:
        key = (e["cueId"], e["tokenIndex"])
        if key not in scheduled or e["epochMs"] < scheduled[key]:
            scheduled[key] = e["epochMs"]

    audit = load_audit_predictions()

    import whisper
    print("  loading whisper turbo...", flush=True)
    asr = whisper.load_model("turbo")

    capture_path = os.path.join(session_dir, "capture.wav")
    rows = []
    for play in voice_play:
        cue_id = play["cueId"]
        tokens = play["combination"].split("-")
        # Slice around the play: launch − 150 to launch + duration + 250.
        # Slice window is generous — RN dispatch + expo-audio buffer +
        # Android audio stack + Focusrite input can push the ACTUAL audio
        # by hundreds of ms after the voice.play log timestamp. A tight
        # ±150 ms window misses the audio entirely; ±1800 ms on the tail
        # gives Whisper enough runway to find every word even on a
        # laggy stack.
        heard_words = slice_and_transcribe(
            capture_path,
            audio_t0,
            play["epochMs"] - 400,
            play["epochMs"] + play["durationMs"] + 1800,
            asr,
        )
        aligned = align_to_tokens(tokens, heard_words)

        # Rail metric: end-of-word to ring-fire, per token. This is what
        # Kyle's ear is actually judging. Positive = ring lags coach's
        # end-of-word; the target under the rail is a small consistent K.
        end_to_ring: list[float | None] = []
        # Legacy: onset to ring, kept for continuity across older reports.
        onset_to_ring: list[float | None] = []
        for i, pair in enumerate(aligned):
            sched = scheduled.get((cue_id, i))
            if pair is None or sched is None:
                end_to_ring.append(None)
                onset_to_ring.append(None)
            else:
                onset_epoch, end_epoch = pair
                end_to_ring.append(float(sched - end_epoch))
                onset_to_ring.append(float(sched - onset_epoch))
        measured_pairs = [v for v in end_to_ring if v is not None]
        max_abs = max((abs(d) for d in measured_pairs), default=None)
        if measured_pairs:
            mean = sum(measured_pairs) / len(measured_pairs)
            spread = max(measured_pairs) - min(measured_pairs)
            var = sum((v - mean) ** 2 for v in measured_pairs) / len(measured_pairs)
            std = var ** 0.5
        else:
            mean = spread = std = None

        rows.append({
            "cueId": cue_id,
            "combination": play["combination"],
            "cadence": play["cadence"],
            "playEpochMs": play["epochMs"],
            "durationMs": play["durationMs"],
            "launchLateMs": play["launchLateMs"],
            "endToRingMs": end_to_ring,
            "onsetToRingMs": onset_to_ring,
            "meanEndToRingMs": None if mean is None else round(mean, 1),
            "spreadEndToRingMs": None if spread is None else round(spread, 1),
            "stdDevEndToRingMs": None if std is None else round(std, 1),
            "maxAbsDriftMs": max_abs,  # legacy field
            "matchesAudit": matches_audit(onset_to_ring, audit.get(cue_id)),
        })

    with_end = [r for r in rows if r["spreadEndToRingMs"] is not None]
    tight = [r for r in with_end if r["spreadEndToRingMs"] < 60.0]
    tight_ratio = len(tight) / len(with_end) if with_end else 0.0
    means = [r["meanEndToRingMs"] for r in with_end]
    if means:
        cross_mean = sum(means) / len(means)
        cross_var = sum((m - cross_mean) ** 2 for m in means) / len(means)
        cross_std = cross_var ** 0.5
    else:
        cross_mean = cross_std = 0.0

    with_end.sort(key=lambda r: r["spreadEndToRingMs"], reverse=True)

    report_path = os.path.join(session_dir, "cadence-report.json")
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump({
            "audibleDriftMs": AUDIBLE_DRIFT_MS,
            "plays": len(rows),
            "measured": len(with_end),
            "tightWithin60ms": len(tight),
            "tightRatio": round(tight_ratio, 3),
            "crossClipMeanEndToRingMs": round(cross_mean, 1),
            "crossClipStdDevMs": round(cross_std, 1),
            "rows": rows,
        }, fh, indent=1)

    print(f"\n=== end-of-word to ring-fire (mic-measured) ===")
    print(f"clips with measurable end-of-word: {len(with_end)}/{len(rows)}")
    print(f"within-clip spread < 60 ms: {len(tight)}/{len(with_end)} = {tight_ratio * 100:.1f}%")
    print(f"cross-clip meanEndToRingMs: mean {cross_mean:.0f} ms  stdDev {cross_std:.0f} ms")
    print(f"(rail's target: uniform K ms across the session; K = 120 by default)")
    print("\nWorst offenders (top 20 by within-clip spread):")
    for r in with_end[:20]:
        print(f"  spread={r['spreadEndToRingMs']:>6.1f}ms  mean={r['meanEndToRingMs']:>6.1f}ms  "
              f"{r['cueId']:<40}  endToRing={r['endToRingMs']}  launchLate={r['launchLateMs']}")
    print(f"\nreport -> {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
