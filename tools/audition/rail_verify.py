"""Log-only rail-runtime verifier — no mic required.

Answers "is the runtime actually driving rings off word ends (rail) or
still on the beat grid?" from a monitor-session's log.txt + the shipped
phraseManifest.ts. For every phrase clip that played:

- expected: ring[N] wall = play_epoch + endOffsetMs[N] + RAIL_K_MS
- actual:   ring[N] wall = the earliest puncheokie.cue.tokenDue for the
            runtime cue instance owning this play, at that tokenIndex
- deviation: actual − expected. Under a working rail this is ~0 for
             every rail-eligible clip.

Reports:
- rail-eligible ratio (clips whose wordMarks cover every token + have
  endOffsetMs)
- cross-clip mean/stdDev of per-token deviations (target: ~0)
- median per-clip spread by wordMarks source (target: <60 ms)

This is the FIRST-pass check after any rail-touching change and after
any monitor-session capture. Whisper-based mic verification stays as
Tier-2 for the cases where the runtime schedule is right but the audio
still reads drifty (rare — usually a clip render issue, not a rail one).

Usage: F:/voice-tools/venv/Scripts/python.exe tools/audition/rail_verify.py <session_dir>
"""
from __future__ import annotations
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# cadence_analyzer sets sys.stdout to a utf-8 wrapper at import time —
# don't re-wrap or the buffer is closed under us.
from cadence_analyzer import parse_log  # noqa: E402

RAIL_K_MS = 120
MANIFEST_PATH = os.path.join("src", "audio", "voiceAssets", "phraseManifest.ts")

_ENTRY = re.compile(
    r'cueId:\s*"([^"]+)",[\s\S]*?durationMs:\s*(\d+),\s*'
    r'wordMarks:\s*(\[[^\]]*\]),\s*wordMarksSource:\s*"([^"]+)"',
    re.DOTALL,
)


def load_manifest():
    marks: dict[str, list] = {}
    sources: dict[str, str] = {}
    text = open(MANIFEST_PATH, encoding="utf-8").read()
    for m in _ENTRY.finditer(text):
        cue = m.group(1)
        marks[cue] = json.loads(m.group(3))
        sources[cue] = m.group(4)
    return marks, sources


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rail_verify.py <session_dir>", file=sys.stderr)
        return 1
    session = sys.argv[1]

    marks_by_cue, source_by_cue = load_manifest()
    tokendue, plays = parse_log(os.path.join(session, "log.txt"))
    if not tokendue or not plays:
        print("no token-due or voice.play events in the log", file=sys.stderr)
        return 1

    # Bucket runtime tokenDue events by runtime cueId, in chronological order.
    by_runtime_cue: dict[str, list[dict]] = {}
    for e in sorted(tokendue, key=lambda x: x["epochMs"]):
        by_runtime_cue.setdefault(e["cueId"], []).append(e)

    # Match each play to a runtime cue by nearest-first-tokenDue-in-window.
    used = set()
    rows = []
    for p in sorted(plays, key=lambda x: x["epochMs"]):
        cue = p["cueId"]
        marks = marks_by_cue.get(cue, [])
        if len(marks) < 2:
            continue
        if not all(isinstance(m.get("endOffsetMs"), (int, float)) for m in marks):
            continue
        candidate = None
        best_gap = 10_000
        for rt_cue, events in by_runtime_cue.items():
            if rt_cue in used:
                continue
            first = events[0]["epochMs"]
            if first < p["epochMs"] - 100 or first > p["epochMs"] + 3000:
                continue
            gap = first - p["epochMs"]
            if gap < best_gap:
                best_gap = gap
                candidate = rt_cue
        if candidate is None:
            continue
        used.add(candidate)

        fires = {e["tokenIndex"]: e["epochMs"] for e in by_runtime_cue[candidate]}
        deviations = []
        for i, m in enumerate(marks):
            expected = p["epochMs"] + float(m["endOffsetMs"]) + RAIL_K_MS
            actual = fires.get(i)
            deviations.append(None if actual is None else actual - expected)
        measured = [v for v in deviations if v is not None]
        if not measured:
            continue
        rows.append({
            "cueId": cue,
            "runtimeCueId": candidate,
            "source": source_by_cue.get(cue, "unknown"),
            "deviationMs": deviations,
            "meanDeviationMs": round(sum(measured) / len(measured), 1),
            "spreadMs": round(max(measured) - min(measured), 1),
        })

    if not rows:
        print("no rail-eligible plays found (no clips had populated wordMarks + endOffsetMs)")
        return 1

    all_dev = [d for r in rows for d in r["deviationMs"] if d is not None]
    dev_mean = sum(all_dev) / len(all_dev)
    dev_std = (sum((d - dev_mean) ** 2 for d in all_dev) / len(all_dev)) ** 0.5

    print(f"session: {session}")
    print(f"parsed: {len(tokendue)} tokenDue events, {len(plays)} phrase plays\n")
    print(f"=== rail runtime verification ===")
    print(f"rail-eligible plays: {len(rows)} / {len(plays)} ({len(rows)/len(plays)*100:.1f}%)")
    print(f"per-token deviation from expected (actual - expected):")
    print(f"  cross-clip mean: {dev_mean:+.1f} ms   stdDev: {dev_std:.1f} ms")
    print(f"  target under a working rail: mean and stdDev ~ 0\n")

    by_src: dict[str, list] = {}
    for r in rows:
        by_src.setdefault(r["source"], []).append(r)
    print(f"=== by wordMarks source ===")
    for src, rs in sorted(by_src.items(), key=lambda x: -len(x[1])):
        dev = [d for r in rs for d in r["deviationMs"] if d is not None]
        if not dev:
            continue
        m = sum(dev) / len(dev)
        s = (sum((d - m) ** 2 for d in dev) / len(dev)) ** 0.5
        median_spread = sorted(r["spreadMs"] for r in rs)[len(rs) // 2]
        print(f"  {src:>18}: {len(rs):>3} clips  |  mean dev {m:+7.1f}ms  stdDev {s:6.1f}ms  |  median spread {median_spread:5.1f}ms")

    rows.sort(key=lambda r: r["spreadMs"], reverse=True)
    print(f"\nTop-20 worst by per-clip spread:")
    for r in rows[:20]:
        print(f"  spread={r['spreadMs']:>6.1f}ms  mean={r['meanDeviationMs']:>+7.1f}ms  "
              f"{r['cueId']:<40}  {r['source']:<18}  dev={r['deviationMs']}")

    out_path = os.path.join(session, "rail-verify-report.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({
            "railKMs": RAIL_K_MS,
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
