"""Apply a phrase-level pitch contour and aged timbre, via Praat.

Reads a JSON spec on stdin:

    [{"path": "...", "contour": [{"normalizedTime": 0.0, "offset": -0.3}, ...],
      "shiftSemitones": -0.85, "driftSemitones": 0.14, "driftHz": 4.2}]

Prints `OK <path>` or `FAIL <path> <message>` per file, editing in place.

## Why Praat rather than a filter chain

A filter can shift a whole clip's pitch. It cannot make the voice *rise
through the setup and fall on the finish*, which is the entire sing-song
character — that needs the pitch tier of the recording rewritten point by
point while the rest of the signal is preserved. Parselmouth exposes Praat's
manipulation for exactly this, and it runs at build time only: nothing here
ships in the app.

## Aging without frailty

The drift is deliberately small (±0.10–0.18 st at 3.5–5 Hz). Enough that the
voice is not machine-steady; far below the point where it reads as a wobble.
A pronounced vibrato sounds infirm or comedic, and the target is weathered
authority — an old cornerman is *certain*, not shaky.
"""

from __future__ import annotations

import json
import math
import sys

import parselmouth
from parselmouth.praat import call

# Praat needs a plausible pitch range to build a manipulation. A male voice
# with the low end open enough for an aged baritone.
PITCH_FLOOR_HZ = 60.0
PITCH_CEILING_HZ = 320.0
# Manipulation quality degrades badly outside a sensible ratio range; a
# combination should never need more than a couple of semitones either way.
# Raised from 3.0 once the contour gained an expression multiplier: at the
# theatrical setting a four-strike phrase asks for close to +/-4 st, and
# clamping at 3.0 silently flattened exactly the peaks under test.
MAX_ABS_SEMITONES = 4.5


def semitones_to_ratio(semitones: float) -> float:
    return 2.0 ** (semitones / 12.0)


def contour_offset(contour: list[dict], position: float) -> float:
    """Linear interpolation between contour points, in semitones."""
    if not contour:
        return 0.0
    if position <= contour[0]["normalizedTime"]:
        return float(contour[0]["offset"])
    for earlier, later in zip(contour, contour[1:]):
        start, end = earlier["normalizedTime"], later["normalizedTime"]
        if start <= position <= end:
            span = end - start
            if span <= 0:
                return float(later["offset"])
            t = (position - start) / span
            return float(earlier["offset"]) + t * (float(later["offset"]) - float(earlier["offset"]))
    return float(contour[-1]["offset"])


def last_voiced_region(sound: parselmouth.Sound) -> tuple[float, float] | None:
    """The start and end time of the final run of voiced frames.

    This is the power-punch syllable, located from the audio rather than
    guessed from a token count — the synthesizer reports no word boundaries,
    and on a longer combination a fixed fraction drifts off the actual word.
    """
    pitch = sound.to_pitch(time_step=0.01, pitch_floor=PITCH_FLOOR_HZ,
                           pitch_ceiling=PITCH_CEILING_HZ)
    frequencies = pitch.selected_array["frequency"]
    times = pitch.xs()
    voiced = [i for i, f in enumerate(frequencies) if f > 0]
    if not voiced:
        return None
    end_index = voiced[-1]
    start_index = end_index
    # Walk back through the contiguous voiced run, tolerating the one- or
    # two-frame unvoiced gaps inside a vowel.
    gap = 0
    for i in range(end_index - 1, -1, -1):
        if frequencies[i] > 0:
            start_index = i
            gap = 0
        else:
            gap += 1
            if gap > 3:
                break
    return float(times[start_index]), float(times[end_index])


def finish_offset(finish: dict, region: tuple[float, float], time: float) -> float:
    """The finish ramp at `time`, in semitones — zero outside the region.

    Rises to `peakSemitones` around the vowel core, then to `endSemitones` at
    the very end (positive ends up: a shout). Anchoring to the measured region
    is what makes the ending inflection land on the last word for a phrase of
    any length.
    """
    if not finish:
        return 0.0
    start, end = region
    if time <= start or end <= start:
        return 0.0
    peak = float(finish.get("peakSemitones", 0.0))
    tail = float(finish.get("endSemitones", 0.0))
    frac = (time - start) / (end - start)
    core = 0.45
    if frac <= core:
        return peak * (frac / core)
    return peak + (tail - peak) * ((frac - core) / (1.0 - core))


def apply(entry: dict) -> None:
    path = entry["path"]
    sound = parselmouth.Sound(path)
    duration = sound.get_total_duration()
    if duration <= 0:
        raise ValueError("empty sound")

    manipulation = call(sound, "To Manipulation", 0.01, PITCH_FLOOR_HZ, PITCH_CEILING_HZ)
    pitch_tier = call(manipulation, "Extract pitch tier")

    contour = entry.get("contour") or []
    shift = float(entry.get("shiftSemitones", 0.0))
    drift = float(entry.get("driftSemitones", 0.0))
    drift_hz = float(entry.get("driftHz", 4.0))

    finish = entry.get("finish")
    region = last_voiced_region(sound) if finish else None

    # Rewrite the tier on a fine grid so the movement is smooth rather than
    # stepped — a stepped contour is audible as a warble.
    steps = max(24, int(duration / 0.01))
    for index in range(steps + 1):
        position = index / steps
        time = position * duration
        semitones = shift + contour_offset(contour, position)
        if region is not None:
            semitones += finish_offset(finish, region, time)
        if drift > 0:
            semitones += drift * math.sin(2 * math.pi * drift_hz * time)
        semitones = max(-MAX_ABS_SEMITONES, min(MAX_ABS_SEMITONES, semitones))
        call(pitch_tier, "Multiply frequencies", time, time + duration / steps,
             semitones_to_ratio(semitones))

    call([pitch_tier, manipulation], "Replace pitch tier")
    resynth = call(manipulation, "Get resynthesis (overlap-add)")
    resynth.save(path, parselmouth.SoundFileFormat.WAV)


def main() -> int:
    spec = json.load(sys.stdin)
    for entry in spec:
        try:
            apply(entry)
            print(f"OK {entry['path']}", flush=True)
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
            print(f"FAIL {entry['path']} {exc}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
