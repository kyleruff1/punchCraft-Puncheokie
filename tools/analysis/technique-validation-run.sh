#!/usr/bin/env bash
# Autonomous multi-workout technique-audio validation (Kyle, 2026-09-03).
#
# Five scenarios chosen for distinct stressors on the technique bank:
#   body-work        @100  fused-body translations ("body cross") at density
#   uppercut-clinic  @85   the longest technique words on the slowest click
#   speed-combos     @120  tightest strides — compact calls under pressure
#   three-round-fundamentals @120  two-page sets + walkout lead-in
#   pump-and-coast   @100  pump bars ("Jab, jab, jab, jab!") + coast silence
#
# Per scenario: mic-monitored (Focusrite) first-round drive with the
# Techniques radio tapped pre-start, then the offset/truncation analyzer
# (min-segment 40ms so any shllck regression reports as tiny span/clip)
# and the expectation verifier against <id>.techniques.json.
#
# Usage: bash tools/analysis/technique-validation-run.sh <adb-serial> <out-root>
set -u
SERIAL="$1"
ROOT="$2"
PY="F:/voice-tools/venv/Scripts/python.exe"
mkdir -p "$ROOT"
SUMMARY="$ROOT/summary.txt"
: > "$SUMMARY"

# monitor-session's --duration is MINUTES (durationMin), and it only
# writes manifest.json at the duration cap or SIGINT — a first-round
# drive is ~4-5 min, so CAP_MIN must exceed it and we wait the monitor
# out rather than killing it (a hard kill loses manifest.json → the
# analyzer's anchor). The output dir must exist BEFORE the monlog
# redirect or the whole monitor subshell silently fails to launch.
CAP_MIN=7

for W in body-work uppercut-clinic speed-combos three-round-fundamentals pump-and-coast; do
  OUT="$ROOT/$W"
  echo "=== $W ===" | tee -a "$SUMMARY"
  # Cold app restart per scenario: every run exercises boot → walkout →
  # round 1 from scratch, no state bleed between workouts.
  adb -s "$SERIAL" shell am force-stop com.kyleruff.punchcraft
  sleep 2
  adb -s "$SERIAL" shell monkey -p com.kyleruff.punchcraft -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  MARK=$(date +%s)
  until adb -s "$SERIAL" logcat -d -t 300 2>/dev/null | grep -q 'Running "main"'; do
    sleep 5
    [ $(( $(date +%s) - MARK )) -gt 240 ] && { echo "boot timeout — relaunch" | tee -a "$SUMMARY"; adb -s "$SERIAL" shell monkey -p com.kyleruff.punchcraft -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; MARK=$(date +%s); }
  done
  rm -rf "$OUT"
  (node tools/audition/monitor-session.mjs --duration="$CAP_MIN" --device="$SERIAL" --out="$OUT" > "$OUT.monlog" 2>&1 &)
  until [ -f "$OUT/capture.wav" ]; do sleep 1; done
  sleep 4
  node tools/analysis/drive-workout-first-round.mjs --workout="$W" --vocab=techniques --no-screen --device="$SERIAL" 2>&1 | tail -3 | tee -a "$SUMMARY"
  # Wait the monitor out (writes manifest.json + anchors at its cap).
  while tasklist 2>/dev/null | grep -qi "ffmpeg.exe"; do sleep 10; done
  "$PY" tools/audition/call_offset_analysis.py "$OUT" --min-segment-ms=40 2>&1 | tail -12 | tee -a "$SUMMARY"
  node tools/analysis/verify-first-round.mjs --manifest "tools/analysis/manifests/$W.techniques.json" --session "$OUT" 2>&1 | tail -6 | tee -a "$SUMMARY"
  echo "" | tee -a "$SUMMARY"
done
echo "ALL SCENARIOS COMPLETE" | tee -a "$SUMMARY"
