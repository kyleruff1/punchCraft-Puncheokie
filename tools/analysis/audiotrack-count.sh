#!/usr/bin/env bash
# Count the AudioTrack objects OUR APP owns (GH #356).
#
# The app goes totally silent, with no error, once it can no longer create an
# AudioTrack — src/audio/VoiceOutputExpo.ts documents the ceiling at roughly
# 48. System-wide counts are useless for that: they include every other app.
# `dumpsys audio` tags each AudioPlaybackConfiguration with `u/pid:<uid>/<pid>`,
# so filtering on our pid gives the number that actually matters.
#
#   tools/analysis/audiotrack-count.sh            # one reading
#   tools/analysis/audiotrack-count.sh --watch    # every 2s until Ctrl-C
#   tools/analysis/audiotrack-count.sh --label "live then audition"
#
# Readings are only comparable when you say what was on screen — always pass
# a label when recording a before/after.
set -uo pipefail

PACKAGE="${PUNCH_PACKAGE:-com.kyleruff.punchcraft}"
LABEL=""
WATCH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --watch) WATCH=1 ;;
    --label) LABEL="${2:-}"; shift ;;
    --package) PACKAGE="${2:-}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

reading() {
  local pid
  pid="$(adb shell "pidof $PACKAGE" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
  if [ -z "$pid" ]; then
    echo "app not running ($PACKAGE)"
    return 1
  fi

  # Count ON THE DEVICE, never by piping the dump back to the host: the dump
  # is large enough that the adb pipe truncates it, which silently produced
  # readings that disagreed with each other by 30 tracks while I was writing
  # this. Only the two integers cross the wire.
  #
  # Match `AudioPlaybackConfiguration` lines ONLY, not every line containing
  # "AudioTrack". `dumpsys audio` holds two things that both mention the type:
  # the LIVE registry of playback configurations, and a historical event log
  # of "new player" creations. A bare `grep -c AudioTrack` sums them and
  # roughly DOUBLES the answer — that is where issue #356's headline "70
  # AudioTrack objects" came from.
  #
  # A track sitting in 'stopped' still owns its AudioTrack — that IS the leak,
  # so never filter by state.
  local counts ours total
  counts="$(adb shell "dumpsys audio > /data/local/tmp/audiotracks.txt 2>/dev/null;
             grep -c '^ *AudioPlaybackConfiguration.*type:android.media.AudioTrack' /data/local/tmp/audiotracks.txt;
             grep '^ *AudioPlaybackConfiguration.*type:android.media.AudioTrack' /data/local/tmp/audiotracks.txt | grep -c '/$pid '" \
             2>/dev/null | tr -d '\r')"
  total="$(printf '%s\n' "$counts" | sed -n '1p')"
  ours="$(printf '%s\n' "$counts" | sed -n '2p')"
  total="${total:-0}"
  ours="${ours:-0}"
  local others=$((total - ours))

  local stamp
  stamp="$(date +%H:%M:%S)"
  printf '%s  ours=%-4s others=%-4s system=%-4s pid=%-7s %s\n' \
    "$stamp" "$ours" "$others" "$total" "$pid" "$LABEL"

  # The documented failure threshold. Warn well before it: the app dies
  # silently AT the ceiling, so a reading in the 40s is already a problem.
  if [ "$ours" -ge 40 ]; then
    echo "    WARNING: $ours is within reach of the ~48 ceiling — see GH #356"
  fi
}

if [ "$WATCH" -eq 1 ]; then
  while true; do
    reading
    sleep 2
  done
else
  reading
fi
