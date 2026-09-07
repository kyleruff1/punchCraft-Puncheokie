"""Log-only rail-runtime verifier — no mic required.

Answers "is the runtime actually driving rings off word ends (the rail) or
still on the beat grid?" from a capture's log plus the per-token word marks.
For every played clip that HAS per-token marks:

- expected: ring[N] = clip onset + endMs[N] + RAIL_K_MS
- actual:   ring[N] = the earliest `puncheokie.cue.tokenDue` for the runtime
            cue instance owning this play, at that tokenIndex
- deviation: actual − expected. Under a working rail this is ~0 for every
             rail-eligible clip.

## Read this before trusting a zero

Two things changed under this tool and it reported "0 rows" through both:

1. `src/audio/voiceAssets/phraseManifest.ts`, which it used to regex for
   `wordMarks`, was DELETED when V2 Phase 5-iv retired the per-punch phrase
   corpus (commit 369a2c6). Marks now come from
   `tools/analysis/reports/phrase-timing.json` — regenerate with
   `node --import ./tools/analysis/wav-stub.mjs --import tsx
   tools/analysis/phrase-timing-dump.mjs`.
2. **The rail is not engaged at runtime.** The workout runner passes
   `wordMarksFor: () => undefined` and `CueEngine.fireDueTokens` reads
   `cue.tokenOffsetsMs` — rings are on the beat grid by construction, and
   the 218 combo-announce clips carry no speech marks. So on a current
   capture this tool is EXPECTED to find zero eligible plays; that is the
   rail's status, not a parse failure. It says so rather than printing 0 %.

The mic-free measurement that does work today is
`node tools/analysis/observed-timing.mjs --session <dir>` — it measures
combo-announce end → first ring and per-slot call breath from the silent
playhead observer (GH #291). Whisper-based mic verification stays Tier-2,
for when the runtime schedule is right but the audio still reads drifty.

Usage: F:/voice-tools/venv/Scripts/python.exe tools/audition/rail_verify.py <session_dir>
"""
from __future__ import annotations
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from logparse import (  # noqa: E402
    load_phrase_timing,
    load_timing_constants,
    parse_token_due,
    parse_voice_observed,
    parse_voice_play,
    session_log,
    stitch,
)


def rail_k_ms() -> float:
    """RAIL_K_MS from the dumped constants — never a literal in this file."""
    rail = load_timing_constants().get("rail", {})
    k = rail.get("RAIL_K_MS")
    if k is None:
        raise SystemExit("timing-constants.json has no rail.RAIL_K_MS — regenerate it")
    if rail.get("RAIL_K_MS_spine") not in (None, k):
        print(f"WARN: RAIL_K_MS differs — RhythmMap {k} vs RhythmSpine {rail['RAIL_K_MS_spine']}")
    return float(k)


def cue_id_of(play: dict) -> str | None:
    """The runtime cue a play belongs to.

    A combo-announce's `traceId` IS its slotId, which opens with the cueId
    (`sp1-b4#0:rep-0:combo-announce:…`). A click-script's traceId is
    `<slot>#<dispatchAtMs>` and names no cue — those join by slot instead,
    which is `observed-timing.mjs`'s breath measurement, not this tool's.
    """
    trace = play.get("traceId")
    if not trace or ":" not in trace:
        return None
    return trace.split(":")[0]


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rail_verify.py <session_dir>", file=sys.stderr)
        return 1
    session = sys.argv[1]

    marks_by_cue = load_phrase_timing()
    k_ms = rail_k_ms()
    records = stitch(session_log(session))
    tokendue = parse_token_due(records)
    plays = parse_voice_play(records)
    observed = {o["playId"]: o for o in parse_voice_observed(records) if o.get("playId")}

    if not tokendue:
        print("no puncheokie.cue.tokenDue events in the log — was a workout actually run?", file=sys.stderr)
        return 1
    if not plays:
        print("no puncheokie.voice.play events in the log", file=sys.stderr)
        return 1

    # Bucket runtime tokenDue by cueId, chronologically, on the APP clock.
    by_runtime_cue: dict[str, list[dict]] = {}
    for e in sorted(tokendue, key=lambda x: (x["monotonicTimeMs"] or x["epochMs"] or 0)):
        by_runtime_cue.setdefault(e["cueId"], []).append(e)

    rows = []
    skipped_no_marks = 0
    skipped_no_cue = 0
    for play in plays:
        cue = cue_id_of(play)
        if cue is None:
            skipped_no_cue += 1
            continue
        entry = marks_by_cue.get(cue) or {}
        words = entry.get("words") or []
        if len(words) < 2:
            skipped_no_marks += 1
            continue
        events = by_runtime_cue.get(cue)
        if not events:
            continue
        # The observed onset is the truth about when the clip STARTED; the
        # dispatch is only when JS asked. Fall back to dispatch when the
        # observer was off (the numbers are then dev-client-contaminated).
        obs = observed.get(play.get("playId"))
        onset = (obs or {}).get("onsetMs") or play.get("dispatchMs")
        if onset is None:
            continue
        fires = {e["tokenIndex"]: e["monotonicTimeMs"] for e in events if e["monotonicTimeMs"] is not None}
        deviations = []
        for i, word in enumerate(sorted(words, key=lambda w: w["tokenIndex"])):
            expected = onset + float(word["endMs"]) + k_ms
            actual = fires.get(i)
            deviations.append(None if actual is None else round(actual - expected, 1))
        measured = [v for v in deviations if v is not None]
        if not measured:
            continue
        rows.append({
            "cueId": cue,
            "label": play.get("label"),
            "source": entry.get("wordMarksSource", "unknown"),
            "onsetSource": "observed" if obs else "dispatch",
            "deviationMs": deviations,
            "meanDeviationMs": round(sum(measured) / len(measured), 1),
            "spreadMs": round(max(measured) - min(measured), 1),
        })

    print(f"session: {session}")
    print(f"parsed: {len(tokendue)} tokenDue events, {len(plays)} plays, {len(observed)} observations")
    print(f"rail K: {k_ms:.0f} ms   marks loaded: {len(marks_by_cue)} clips\n")

    if not rows:
        print("=== no rail-eligible plays ===")
        print(f"  plays with no cue in their traceId: {skipped_no_cue}")
        print(f"  plays whose cue has no per-token marks: {skipped_no_marks}")
        print("")
        print("  This is the expected result today: the runner passes")
        print("  `wordMarksFor: () => undefined` and CueEngine.fireDueTokens reads")
        print("  `tokenOffsetsMs`, so rings are on the beat grid, and the combo-announce")
        print("  clips carry no speech marks (0/218). The rail is INERT, not broken.")
        print("  Measure what does exist with:")
        print("    node tools/analysis/observed-timing.mjs --session " + session)
        return 3

    all_dev = [d for r in rows for d in r["deviationMs"] if d is not None]
    dev_mean = sum(all_dev) / len(all_dev)
    dev_std = (sum((d - dev_mean) ** 2 for d in all_dev) / len(all_dev)) ** 0.5

    print("=== rail runtime verification ===")
    print(f"rail-eligible plays: {len(rows)} / {len(plays)} ({len(rows) / len(plays) * 100:.1f}%)")
    print("per-token deviation from expected (actual - expected):")
    print(f"  cross-clip mean: {dev_mean:+.1f} ms   stdDev: {dev_std:.1f} ms")
    print("  target under a working rail: mean and stdDev ~ 0\n")

    by_src: dict[str, list] = {}
    for r in rows:
        by_src.setdefault(r["source"], []).append(r)
    print("=== by wordMarks source ===")
    for src, rs in sorted(by_src.items(), key=lambda x: -len(x[1])):
        dev = [d for r in rs for d in r["deviationMs"] if d is not None]
        if not dev:
            continue
        m = sum(dev) / len(dev)
        s = (sum((d - m) ** 2 for d in dev) / len(dev)) ** 0.5
        median_spread = sorted(r["spreadMs"] for r in rs)[len(rs) // 2]
        print(f"  {src:>18}: {len(rs):>3} clips  |  mean dev {m:+7.1f}ms  stdDev {s:6.1f}ms  |  median spread {median_spread:5.1f}ms")

    rows.sort(key=lambda r: r["spreadMs"], reverse=True)
    print("\nTop-20 worst by per-clip spread:")
    for r in rows[:20]:
        print(f"  spread={r['spreadMs']:>6.1f}ms  mean={r['meanDeviationMs']:>+7.1f}ms  "
              f"{r['cueId']:<40}  {r['source']:<18}  dev={r['deviationMs']}")

    out_path = os.path.join(session, "rail-verify-report.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({
            "railKMs": k_ms,
            "plays": len(plays),
            "railEligible": len(rows),
            "meanDeviationMs": round(dev_mean, 1),
            "stdDevDeviationMs": round(dev_std, 1),
            "bySource": {
                src: {
                    "clips": len(rs),
                    "medianSpreadMs": sorted(r["spreadMs"] for r in rs)[len(rs) // 2],
                }
                for src, rs in by_src.items() if rs
            },
            "rows": rows,
        }, fh, indent=1)
    print(f"\nreport -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
