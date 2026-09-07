"""Shared logcat parsing for the audition tools (GH #292, plan C5).

Every Python tool here used to carry its own regexes against log messages,
and two of them matched messages the app no longer emits — so they reported
"0 rows" on a perfectly good capture instead of failing loudly. The record
shapes live here now, in ONE place, with a note per record about what the
runtime actually writes today.

Record shapes as of 2026-09-07 (see src/diagnostics/logger.ts — the sink
prints FIELDS only, so every timestamp a tool needs is an explicit field):

  puncheokie.cue.tokenDue        roundIndex cueId combination tokenIndex
                                 ordinal workElapsedMs monotonicTimeMs
                                 scheduledMs
  puncheokie.round.boundary      transition roundIndex workElapsedMs
                                 monotonicTimeMs
  puncheokie.voice.play          asset kind label playId traceId path
                                 dispatchMs durationMs volume …
  puncheokie.voice.observed      playId kind label outcome dispatchMs
                                 onsetMs endMs onsetLatencyMs
                                 observedDurationMs expectedDurationMs

RETIRED — do not re-add: `'combination phrase playing'` with `cueId`,
`cadence` and `launchLateMs`. V2 Phase 5-iv retired the per-punch phrase
corpus (commit 369a2c6); nothing emits that message. A regex for it matches
nothing on any current capture.

Two clock domains appear in a capture and they are NOT interchangeable:
`monotonicTimeMs` / `dispatchMs` / `onsetMs` are `performance.now()` inside
the app; the log line's own leading timestamp is the host's. Join on the
app's fields wherever both exist (Rule 6 — monotonic for ordering).
"""
from __future__ import annotations

import os
import re

# `adb logcat -v time`:      `MM-DD HH:MM:SS.mmm I/ReactNativeJS(pid): body`
_LOGCAT_TIME = re.compile(
    r"^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+\w/\w+\(\s*\d+\):\s*(.*)$"
)
# monitor-session.mjs writes epoch-prefixed lines instead.
_MONITOR = re.compile(r"^\s*(\d+\.\d+)\s+\d+\s+\d+\s+[IWEF]\s+ReactNativeJS:\s*(.*)$")


def stitch(log_path: str) -> list[dict]:
    """Glue React Native's multi-line object payloads back into one record.

    Returns `[{'epochMs': int|None, 'body': str}]`. A payload that does not
    open with a quoted event name (`'[`) continues the record before it —
    the same rule tools/analysis/logcat.mjs applies on the Node side.
    """
    with open(log_path, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()

    records: list[dict] = []
    for line in lines:
        epoch_ms: int | None = None
        payload: str | None = None

        m = _MONITOR.match(line)
        if m:
            epoch_ms = int(round(float(m.group(1)) * 1000))
            payload = m.group(2)
        else:
            m = _LOGCAT_TIME.match(line)
            if m:
                hh, mm, ss, ms = m.group(3), m.group(4), m.group(5), m.group(6)
                # Milliseconds since midnight — only DIFFERENCES are used.
                epoch_ms = ((int(hh) * 60 + int(mm)) * 60 + int(ss)) * 1000 + int(ms)
                payload = m.group(7)
        if payload is None:
            continue

        if records and not payload.lstrip().startswith("'["):
            records[-1]["body"] += " " + payload.strip()
        else:
            records.append({"epochMs": epoch_ms, "body": payload})
    return records


def field(body: str, key: str) -> str | None:
    """One field out of a record body: `key: 'str'`, `key: "str"` or `key: 12`."""
    m = re.search(
        rf"{key}:\s*'([^']*)'|{key}:\s*\"([^\"]*)\"|{key}:\s*(-?[0-9.eE+]+)", body
    )
    if not m:
        return None
    return m.group(1) if m.group(1) is not None else (m.group(2) if m.group(2) is not None else m.group(3))


def num(body: str, key: str) -> float | None:
    v = field(body, key)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def records_with_tag(records: list[dict], tag: str) -> list[dict]:
    return [r for r in records if r["body"].startswith(f"'[{tag}]")]


def parse_token_due(records: list[dict]) -> list[dict]:
    """Ring fires. `monotonicTimeMs` is the app clock; `epochMs` the host's."""
    out = []
    for r in records_with_tag(records, "puncheokie.cue.tokenDue"):
        body = r["body"]
        out.append({
            "epochMs": r["epochMs"],
            "roundIndex": num(body, "roundIndex"),
            "cueId": field(body, "cueId"),
            "combination": field(body, "combination"),
            "tokenIndex": int(num(body, "tokenIndex") or 0),
            "ordinal": num(body, "ordinal"),
            "workElapsedMs": num(body, "workElapsedMs"),
            "monotonicTimeMs": num(body, "monotonicTimeMs"),
            "scheduledMs": num(body, "scheduledMs"),
        })
    return out


def parse_voice_play(records: list[dict]) -> list[dict]:
    """Every coach play. `playId` joins to `puncheokie.voice.observed`."""
    out = []
    for r in records_with_tag(records, "puncheokie.voice.play"):
        body = r["body"]
        out.append({
            "epochMs": r["epochMs"],
            "playId": field(body, "playId"),
            "kind": field(body, "kind"),
            "label": field(body, "label"),
            "asset": field(body, "asset"),
            "traceId": field(body, "traceId"),
            "path": field(body, "path"),
            "text": field(body, "text"),
            "dispatchMs": num(body, "dispatchMs"),
            "durationMs": num(body, "durationMs"),
            "volume": num(body, "volume"),
        })
    return out


def parse_voice_observed(records: list[dict]) -> list[dict]:
    """The silent playhead observer's closed observations (GH #291)."""
    out = []
    for r in records_with_tag(records, "puncheokie.voice.observed"):
        body = r["body"]
        out.append({
            "epochMs": r["epochMs"],
            "playId": field(body, "playId"),
            "kind": field(body, "kind"),
            "label": field(body, "label"),
            "outcome": field(body, "outcome"),
            "dispatchMs": num(body, "dispatchMs"),
            "onsetMs": num(body, "onsetMs"),
            "endMs": num(body, "endMs"),
            "onsetLatencyMs": num(body, "onsetLatencyMs"),
            "observedDurationMs": num(body, "observedDurationMs"),
            "expectedDurationMs": num(body, "expectedDurationMs"),
        })
    return out


def parse_boundaries(records: list[dict]) -> list[dict]:
    out = []
    for r in records_with_tag(records, "puncheokie.round.boundary"):
        body = r["body"]
        out.append({
            "epochMs": r["epochMs"],
            "transition": field(body, "transition"),
            "roundIndex": num(body, "roundIndex"),
            "workElapsedMs": num(body, "workElapsedMs"),
            "monotonicTimeMs": num(body, "monotonicTimeMs"),
        })
    return out


def session_log(session_dir: str) -> str:
    """`log.txt` (monitor-session) or `logcat.txt` (drive/suite), whichever exists."""
    for name in ("log.txt", "logcat.txt"):
        path = os.path.join(session_dir, name)
        if os.path.exists(path):
            return path
    raise SystemExit(f"no log.txt or logcat.txt in {session_dir}")


PHRASE_TIMING_DUMP = os.path.join("tools", "analysis", "reports", "phrase-timing.json")


def load_phrase_timing(path: str = PHRASE_TIMING_DUMP) -> dict:
    """Per-token word onsets/ends by cueId.

    `src/audio/voiceAssets/phraseManifest.ts` — which every tool here used to
    regex — was DELETED in V2 Phase 5-iv. The surviving timing lives in
    `src/domain/programs/phraseTimingManifest.ts`; dump it with

      node --import ./tools/analysis/wav-stub.mjs --import tsx \\
        tools/analysis/phrase-timing-dump.mjs
    """
    import json

    if not os.path.exists(path):
        raise SystemExit(
            f"{path} not found — regenerate it with:\n"
            "  node --import ./tools/analysis/wav-stub.mjs --import tsx "
            "tools/analysis/phrase-timing-dump.mjs"
        )
    with open(path, encoding="utf-8") as fh:
        return json.load(fh).get("byCueId", {})


def load_timing_constants() -> dict:
    """The runtime constants, dumped from TypeScript by build-cadence-grid.mjs."""
    import json

    path = os.path.join("tools", "analysis", "reports", "timing-constants.json")
    if not os.path.exists(path):
        raise SystemExit(
            f"{path} not found — regenerate it with:\n"
            "  node tools/analysis/timing-constants.mjs"
        )
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
