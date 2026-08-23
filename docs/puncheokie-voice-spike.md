# M34-01 — Voice playback latency, audio focus, and Spotify coexistence

**Issue:** [#195](https://github.com/kyleruff1/punchCraft-Puncheokie/issues/195) ·
**Status:** GO (with one deferred manual check) · **Measured:** 2026-08-23

Go/no-go spike deciding how the Voice Coach produces sound. It answers three
questions: can a cached clip hit a scheduled deadline with low enough jitter,
must the numbers be pre-rendered, and what happens to third-party playback when
the app asks for audio focus.

---

## Verdict

**GO.** Preloaded cached clips hit **34.4 ms of jitter** on the tablet, well
inside the ~100 ms budget the issue set as the gate. The `follow-the-call`
style does not need to be deferred, and `Coach Shorthand + tones` does not need
to ship alone.

**Runtime TTS is ruled out for anything time-critical**, decisively and by a
wide margin — see the table. This is not a preference; a single spoken number
has **616.7 ms** of jitter, which is longer than the whole T−0.75 s announce
lead. D16's pre-rendering rule is now backed by measurement rather than
expectation.

---

## Setup

| | |
|---|---|
| Device | Lenovo TB125FU (Tab P11 Gen 2), Android 13 |
| Build | debug dev-client, Expo SDK **57.0.15** (unchanged), RN 0.86.2 |
| New modules | `expo-audio ~57.0.4`, `expo-speech ~57.0.1` |
| Native | `npx expo prebuild --platform android`, `assembleDebug`, dev-client reinstalled |
| Known-good APK | `artifacts/punchlab-debug-2026-08-22.apk` preserved before the rebuild (CLAUDE.md rule 5); new build archived as `artifacts/punchcraft-debug-2026-08-23-audio.apk` |
| Harness | `src/app/dev/voice-latency.tsx` (spike branch only) |
| Clips | `tools/spike/make-voice-test-assets.mjs` — synthetic WAV tones |
| Screen | on, unlocked, landscape; device volume ~70%; no third-party playback |
| N | 30 reps per case, 1.2 s apart |

### Why tones rather than recorded words

A synthetic tone starts at full amplitude on sample zero. A spoken word ramps
in over tens of milliseconds, and that ramp is indistinguishable from latency.
Measuring the thing you want to measure required removing the ramp.

---

## What was actually timed — and what was not

**Timed:** `trigger → the playhead advancing past zero`, read from
`AudioPlayer.currentTime`.

**Not timed:** the DAC, the mixer and the speaker. Those add a further constant
that no in-app measurement can observe.

That limitation matters less than it looks, because **the gate is jitter**, and
a constant offset cancels out of `p95 − median`. The absolute offset only
affects the lead-time constant, and it is a one-time calibration (below). It
cannot change the GO.

### Ruling out the obvious measurement artifact

`currentTime` could in principle have been a value refreshed only on the
player's status tick, in which case every number here would be the polling
interval wearing a latency costume. **The data falsifies that:** the status
interval defaults to 500 ms, and the observed values run 90.6–186.7 ms — every
single one below one tick. The property reads through to native.

The remaining measurement error is the 1 ms poll quantisation plus JS
scheduling, which is small against a 34 ms jitter figure.

### The one number that still needs a human

Absolute acoustic latency — trigger to sound leaving the speaker — needs an
external recorder (a second phone beside the tablet, inspect the waveform). It
sets the lead-time constant in M36-03 and nothing else. Audio sampling would
have measured it in-app, but that path requires `RECORD_AUDIO`, and a
microphone permission is not worth granting for a measurement the fallback
already covers.

---

## Latency table (`interruptionMode: mixWithOthers`)

Nearest-rank percentiles, so every figure is a real observation (spec §19.2 —
p95, never an average).

| Case | n | median | p95 | **jitter (p95−median)** | Verdict |
|---|---:|---:|---:|---:|---|
| **Preloaded clip** | 30 | 149.9 ms | 184.3 ms | **34.4 ms** | **passes** |
| Cold clip (new player per rep) | 29 | 173.7 ms | 236.8 ms | 63.1 ms | passes, but worse |
| `expo-speech` phrase ("one two three two") | 29 | 184.3 ms | 307.9 ms | 123.6 ms | **fails** |
| `expo-speech` single number ("one") | 30 | 247.8 ms | 864.5 ms | **616.7 ms** | **fails badly** |

Preloaded raw samples (ms), in order:

```
120.5 149.9 152.3 137.7 100.0 186.7 168.2 167.6 165.5 146.3
118.8 117.0 181.6 148.8 138.5 140.9 154.4 153.2 117.9 117.7
170.2 169.9 184.3 158.6 149.0 167.7 150.6 133.8 173.7  90.6
```

`n=29` on three cases: one rep hit the timeout and was recorded as missing
rather than substituted. A missing measurement is honest; an invented one is
not.

### Reading the table

**Preloading halves the jitter** (34.4 vs 63.1 ms) and takes ~24 ms off the
median. Every clip must be in a player before the countdown ends — which is
already what M34-04's `preload()` is for.

**The single-number TTS result is the striking one.** A short utterance is
*worse* than a long one (616.7 vs 123.6 ms jitter), because the per-call engine
wake-up dominates when there is little speech to amortise it over. That is
exactly the shape of workload the coach has — dozens of one-syllable calls —
so TTS is worst precisely where the coach needs it most.

---

## Decisions

### 1. Asset format: **WAV**, uncompressed, mono

Recorded as a decision with a caveat: **the m4a / ogg comparison the issue
asked for was not run.** This workstation has no AAC or Vorbis encoder
(no `ffmpeg`, `sox`, or equivalent), so the variants could not be produced.

Choosing WAV anyway is defensible rather than a dodge:

- For a **preloaded** clip, decode happens at load, not at play. Format affects
  preload cost and package size, not the number the gate measures.
- The whole vocabulary is ~50–60 clips under one second each (D16). At 44.1 kHz
  mono 16-bit that is roughly **2–4 MB total** — small enough that compression
  buys little and costs decoder variance.
- WAV is what the D16 Kokoro-82M pipeline emits, so it is also the
  no-conversion option.

**If M34-04 wants the comparison**, it needs an encoder on the build machine
and 15 minutes; the harness already reports per-case start cost. Revisit only
if the packaged size actually becomes a problem.

### 2. Numbers must be pre-rendered — **confirmed by measurement**

D16 already required this. The spike turns it from a design preference into a
measured fact: runtime TTS for a single number carries 616.7 ms of jitter
against a 750 ms announce lead. It would routinely miss the cue it was called
for.

`expo-speech` stays for **descriptive** text only — round summaries, metric
callouts, accessibility — exactly as doc §18.2 splits it.

### 3. Ducking: request `duckOthers`, and only while audible

`expo-audio` exposes the platform focus request as
`setAudioModeAsync({ interruptionMode })`:

- `'mixWithOthers'` — no focus request at all. Other apps are untouched.
- `'duckOthers'` — transient may-duck. Other apps lower their volume and keep
  playing.
- `'doNotMix'` — exclusive. **Never use this**: it pauses the athlete's music.

This is a platform request and nothing more. The app never reads, alters,
records or analyses another app's audio (spec §14.6).

---

## Audio focus and Spotify — **partially verified**

What was confirmed on device:

- The `duckOthers` focus request is available through the locked SDK 57
  `expo-audio` and does not require any custom native code.
- **Requesting focus costs essentially nothing.** A clean 30-rep preloaded run
  under each mode:

  | Mode | n | median | p95 | jitter |
  |---|---:|---:|---:|---:|
  | `mixWithOthers` | 30 | 149.9 ms | 184.3 ms | 34.4 ms |
  | `duckOthers` | 30 | 151.3 ms | 193.0 ms | 41.7 ms |

  A 1.4 ms difference in median and 7 ms in jitter — within run-to-run noise
  at this sample size. Asking for focus is not a latency decision.

  (An earlier duck run reported a 1058 ms jitter. It was contaminated: an
  edit-triggered reload cleared the cached player mid-run, so the opening reps
  measured loading rather than playback — the log showed `loaded=false`. It was
  re-run from a cold app start rather than reported.)

**What was not verified, and why:** whether Spotify actually ducks and restores
requires Spotify to be playing on the tablet. Spotify is installed, but
starting playback on the user's account is their call, not mine — it touches
their listening history and recommendations. Confirming the duck is also a
listening judgement.

### Manual protocol to close this out (5 minutes)

1. Start any track in Spotify on the tablet and let it play.
2. Open the dev client → `punchcraft://dev/voice-latency`.
3. Press **Run (duck others)** and listen through the first few reps.
4. Note: does the music dip when the tone plays? Does it return to full volume
   after? Does it ever *pause* rather than dip? Does the first ducked play take
   noticeably longer than the rest?
5. Press **Run (mix)** and confirm the music is not affected at all.

A pause rather than a dip would mean the focus request is being escalated, and
would need investigating before M34-05 ships the D1 opt-in.

---

## Consequences for the rest of M34

| Issue | What this decides |
|---|---|
| **M34-04** | Format WAV; `preload()` is mandatory, not an optimisation; `speak()` reachable only from descriptive paths; `interruptionMode: 'duckOthers'` requested while audible, `'mixWithOthers'` otherwise; never `'doNotMix'` |
| **M34-03** | Lead times stay at the doc §18.3 defaults (750 / 100 ms). The measured 150 ms median start latency fits inside the 650 ms between announce and ready tone with room to spare |
| **M34-05** | The D1 gate is a policy decision, not a technical one — no platform obstacle found |
| **M36-02** | Inherits the manual Spotify protocol above |
| **M36-03** | Tunes the lead-time constant once the acoustic offset is calibrated |

### For the announcer's phrase-fit check

`CueAnnouncer` skips a phrase that cannot finish before the combination starts,
but only against **measured** clip durations. This spike measured start
latency, not clip durations — those come from the generated assets in M34-04.
Until then the fit check stays inert, which is the correct default: guessing a
duration would produce skips nobody could explain.

---

## Not done

Listed plainly rather than left to be discovered:

- **m4a / ogg start-cost comparison** — no encoder available (§Decisions 1).
- **Absolute acoustic latency** — needs an external recorder; affects only the
  lead-time constant, not the GO.
- **Spotify duck/restore observation** — needs the user's account and ears
  (protocol above).
- **Release-build numbers** — everything here is a debug build with Metro
  attached. Release is expected to be no worse, but it is untested.
- **Permanent focus loss handling** (a call arriving mid-workout) — deferred to
  M34-04, where the queue that must survive it lives.
