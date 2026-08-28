"""Render phrases with Chatterbox, cloning the cornerman reference voice.

Drop-in replacement for `kokoro_render.py`: same stdin/stdout contract, so
`make-phrase-clips.mjs` and `make-voice-clips.mjs` can switch engines without
changing anything downstream. Beats, trimming, pitch contour and texture all
run afterwards exactly as before.

Reads a JSON spec on stdin:

    {
      "reference": "tools/voice/reference/cornerman-reference.wav",
      "jobs": [{"path": "...", "text": "...", "exaggeration": 0.7,
                "cfgWeight": 0.4, "minDurationMs": 500, "maxDurationMs": 1600}]
    }

`minDurationMs` and `maxDurationMs` bound a best-of-N retry. Chatterbox is
markedly unstable on the short inputs this project renders — it sometimes runs
long, and it sometimes silently *drops a syllable* to run short (measured: a
"one two" take clipping to a 370ms "one"). The first version of this bounded
only the upper end and preferred the shortest take, which reinforced the
truncated ones and shipped clips that garbled after tempo fit. Both bounds
now: a take that undershoots means a word was dropped, a take that overshoots
means the model kept generating past the phrase. The renderer keeps rolling
until a take lands inside the window, and falls back to the take closest to
the middle of the window when nothing does.

## The ASR gate

A job may carry `expectText` — the exact text the take must say. When present,
every duration-eligible candidate is transcribed with Whisper (loaded once,
lazily, beside Chatterbox — the take is still natural-rate speech here, before
the tempo fit, which is Whisper's best case) and scored against `expectText`
via `asr_match.py`, the same scorer the offline validators use. A take is
accepted only when it is in bounds AND scores at least `asrMinScore` (job or
spec level, default 0.85). Duration bounds alone let a take through that says
the wrong words at the right length; this is the gate that catches dropped
syllables and inserted "oooooh" fillers at the source. When nothing passes,
the best take seen (highest score, then closest-to-middle) is written anyway —
never worse than the old behavior — and the verdict says so.

Per job the renderer prints `OK <path> <durationMs>[ tags]` or
`FAIL <path> <message>` (unchanged), plus a machine-readable
`VERDICT {json}` line carrying every candidate's duration/score/transcript,
so the caller can write a render report instead of discarding the story.
Then `DONE <n> in <s>s`.

Unlike Kokoro this runs on the GPU and clones a reference voice rather than
blending speaker embeddings — the persona lives in
`tools/voice/reference/cornerman-reference.wav` (see PROVENANCE.md), not in a
blend table. There is deliberately **no speed parameter**: Chatterbox has none,
and time-fitting is done downstream in `make-phrase-clips.mjs` where the same
formant-preserving stretch already used for texture is available.

Requires the F: toolchain venv, not the repo's default Python — see
tools/voice/README.md.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from asr_match import canonical_tokens, match_score  # noqa: E402

MODEL_DEVICE = "cuda"
DEFAULT_ASR_MIN_SCORE = 0.85

# Whisper decode settings for gating: score only, no word timestamps — the
# candidate is short, natural-rate speech. The prompt establishes the domain
# vocabulary so "bee" is not heard as noise.
ASR_PROMPT = (
    "Boxing coach calls: one, two, three, four, five, six, bee, body, jab, cross, "
    "lead hook, rear hook, lead uppercut, rear uppercut, slip, roll, duck, pull, "
    "bob and weave, pivot, step off, circle, cut off the ring, reset, go, stop, switch, coast."
)


def _load_whisper(device: str):
    import whisper

    return whisper.load_model("turbo", device=device)


def _transcribe_candidate(asr_model, samples, sample_rate: int, prompt: str | None = ASR_PROMPT) -> str:
    import numpy as np
    from scipy.signal import resample_poly

    audio = samples.astype(np.float32)
    if sample_rate != 16000:
        # 24k -> 16k is exactly 2/3; resample_poly handles any rational ratio.
        from math import gcd

        g = gcd(16000, sample_rate)
        audio = resample_poly(audio, 16000 // g, sample_rate // g).astype(np.float32)
    result = asr_model.transcribe(
        audio,
        language="en",
        temperature=0.0,
        condition_on_previous_text=False,
        initial_prompt=prompt,
        fp16=True,
    )
    return result["text"].strip()


def _is_token_exact(asr_model, samples, sample_rate: int, expect_text: str, transcript: str) -> bool:
    """Token-exact acceptance for `asrExact` jobs.

    The prompted transcript is checked first; on a miss, a promptless second
    opinion clears prompt-regurgitation hallucinations on short clips
    without excusing a genuinely wrong take.
    """
    want = canonical_tokens(expect_text)
    if canonical_tokens(transcript) == want:
        return True
    return canonical_tokens(_transcribe_candidate(asr_model, samples, sample_rate, prompt=None)) == want


def main() -> int:
    try:
        import numpy as np
        import soundfile as sf
        import torch  # noqa: F401  (imported for the CUDA check below)
        from chatterbox.tts import ChatterboxTTS
    except Exception as exc:  # pragma: no cover - environment guard
        print(f"FAIL - {exc}. See tools/voice/README.md for the venv setup.", flush=True)
        return 1

    spec = json.load(sys.stdin)
    reference = spec.get("reference")
    if not reference:
        print("FAIL - no reference voice given", flush=True)
        return 1

    device = MODEL_DEVICE if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        # Not fatal — but a full corpus on CPU is hours rather than minutes, so
        # say so loudly rather than let it look like a hang.
        print("FAIL - CUDA unavailable; refusing to render a corpus on CPU.", flush=True)
        return 1

    try:
        model = ChatterboxTTS.from_pretrained(device=device)
    except Exception as exc:
        print(f"FAIL - could not load Chatterbox: {exc}", flush=True)
        return 1

    started = time.time()
    jobs = spec["jobs"]
    attempts_cap = int(spec.get("attempts", 5))
    spec_min_score = float(spec.get("asrMinScore", DEFAULT_ASR_MIN_SCORE))

    # The gate model loads once, and only when some job actually asks for it.
    asr_model = None
    if any(j.get("expectText") for j in jobs):
        print("LOAD whisper turbo (ASR gate)", flush=True)
        try:
            asr_model = _load_whisper(device)
        except Exception as exc:
            print(f"FAIL - could not load whisper for the ASR gate: {exc}", flush=True)
            return 1

    for entry in jobs:
        path = entry["path"]
        min_ms = entry.get("minDurationMs")
        max_ms = entry.get("maxDurationMs")
        expect_text = entry.get("expectText")
        gated = bool(expect_text) and asr_model is not None
        # Token-exact mode: fuzzy similarity tolerates a dropped/doubled
        # token in repeat-heavy combos (1-1-2 shipped saying "one, two");
        # an asrExact job additionally requires the exact canonical token
        # sequence before a take is accepted.
        exact = bool(entry.get("asrExact")) and gated
        min_score = float(entry.get("asrMinScore", spec_min_score))
        bounded = min_ms is not None or max_ms is not None
        attempts = int(entry.get("attempts", attempts_cap)) if (bounded or gated) else 1

        def in_bounds(ms: float) -> bool:
            if min_ms is not None and ms < float(min_ms):
                return False
            if max_ms is not None and ms > float(max_ms):
                return False
            return True

        # Distance to the middle of the window — used as a fallback tiebreak
        # when no take lands inside the window at all.
        def middleness(ms: float) -> float:
            if min_ms is not None and max_ms is not None:
                mid = (float(min_ms) + float(max_ms)) / 2.0
            elif min_ms is not None:
                mid = float(min_ms)
            elif max_ms is not None:
                mid = float(max_ms)
            else:
                mid = ms
            return abs(ms - mid)

        try:
            takes = []  # every candidate: {samples, durationMs, score, transcript}
            accepted = None
            for _attempt in range(attempts):
                wav = model.generate(
                    entry["text"],
                    audio_prompt_path=reference,
                    exaggeration=float(entry.get("exaggeration", 0.7)),
                    cfg_weight=float(entry.get("cfgWeight", 0.4)),
                )
                samples = wav.detach().cpu().numpy()
                if samples.ndim > 1:
                    samples = samples.squeeze()
                duration_ms = len(samples) / model.sr * 1000

                take = {"samples": samples, "durationMs": duration_ms, "score": None, "transcript": None, "exact": None}
                duration_ok = in_bounds(duration_ms)
                # Transcribing an out-of-window take is wasted GPU: it cannot
                # be accepted, and the fallback ranking below still sees it.
                if gated and duration_ok:
                    take["transcript"] = _transcribe_candidate(asr_model, samples, model.sr)
                    take["score"] = match_score(expect_text, take["transcript"])["score"]
                    if exact and take["score"] >= min_score:
                        take["exact"] = _is_token_exact(
                            asr_model, samples, model.sr, expect_text, take["transcript"]
                        )
                takes.append(take)

                if duration_ok and (
                    not gated or (take["score"] >= min_score and (not exact or take["exact"]))
                ):
                    accepted = take
                    break

            if accepted is None:
                # Never worse than the old behavior: write the best take seen —
                # highest transcript score first, then closest to the middle of
                # the duration window.
                accepted_take = max(
                    takes,
                    key=lambda t: (
                        1 if t.get("exact") else 0,
                        (t["score"] if t["score"] is not None else -1.0),
                        -middleness(t["durationMs"]),
                    ),
                )
            else:
                accepted_take = accepted
            samples, duration_ms = accepted_take["samples"], accepted_take["durationMs"]
            sf.write(path, samples.astype(np.float32), model.sr)

            # Report a take that landed outside the window rather than letting
            # it pass silently — that is exactly the defect that shipped
            # garbled clips in the first place. `SHORT` means a syllable was
            # dropped; `OVER` means the model kept generating; `ASR` means it
            # never transcribed as the scripted words.
            tag = ""
            if accepted is None:
                if min_ms is not None and duration_ms < float(min_ms):
                    tag = f" SHORT under {round(float(min_ms))}"
                elif max_ms is not None and duration_ms > float(max_ms):
                    tag = f" OVER {round(float(max_ms))}"
                elif gated:
                    tag = f" ASR {accepted_take['score']}"
            print(f"OK {path} {round(duration_ms)}{tag}", flush=True)
            print(
                "VERDICT "
                + json.dumps({
                    "path": path,
                    "accepted": accepted is not None,
                    "durationMs": round(duration_ms),
                    "score": accepted_take["score"],
                    "expectText": expect_text,
                    "attempts": len(takes),
                    "takes": [
                        {
                            "durationMs": round(t["durationMs"]),
                            "score": t["score"],
                            "transcript": t["transcript"],
                            "exact": t.get("exact"),
                        }
                        for t in takes
                    ],
                }),
                flush=True,
            )
        except Exception as exc:
            print(f"FAIL {path} {exc}", flush=True)

    print(f"DONE {len(jobs)} in {round(time.time() - started, 1)}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
