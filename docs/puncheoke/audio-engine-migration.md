# Instrument audio engine migration — expo-audio → Oboe

**Status:** scoped, not started. **Decision: migrate.**

## Why

Measured on the TB125FU, n=30 per case, `mixWithOthers`, playhead method:

| case | median | jitter |
|---|---|---|
| ARMED — instrument hot path | 127 ms | 76.8 ms |
| **ARMED — real kit one-shot** | **111.4 ms** | **55.6 ms** |

The gate was *migrate if median > 60 ms or jitter > 25 ms*. Both are roughly
double. Jitter is the one that decides it: a constant offset can be
compensated, jitter cannot, and for a percussive instrument where the fist
gives the ear an unambiguous t=0 it reads as slap-back.

The async `seekTo` was **not** the cause — it accounts for ~25 ms (152 → 127).
The engine is the cost.

It cannot be tuned. expo-audio is Media3 ExoPlayer pinned to the main looper
(`AudioPlayer.kt:37-56`), and media3 floors its PCM buffer at
`MIN_PCM_BUFFER_DURATION_US = 250_000`, so its tracks are never admitted to
the FastMixer. On device: our tracks carry `Flags 0x000` with a 16416-frame
buffer while a fast path (`AUDIO_OUTPUT_FLAG_FAST`, latency 10.33 ms) sits
COLD_IDLE, and the tablet declares `android.hardware.audio.low_latency`.

**Target:** `react-native-audio-api@0.13.3` (Software Mansion) — Oboe 1.9.3 →
AAudio, `PerformanceMode::LowLatency`, `SharingMode::Exclusive`, 128-frame
render quantum (2.67 ms at 48 kHz).

## Three things that make this cheaper than it looks

1. **The WAV bank is reusable byte-for-byte.** `decodeAudioData` accepts a
   Metro module id directly (`src/types.ts:257`, `AudioDecoder.ts:57-61`), which
   is exactly what `InstrumentBankClip.module` already holds. No `expo-asset`,
   no `downloadAsync`.
2. **It REMOVES ~32 AudioTracks.** The instrument's entire footprint becomes
   *one* Oboe stream; every stab and drum is an `AudioBufferSourceNode` inside
   that one stream's graph. Today it is 30 pooled players + 2 playlists. This
   materially relieves the ~48 ceiling behind #356/#357 rather than adding to it.
3. **It fixes a musical defect.** Today a fast repeat of the *same* stab does
   pause → `seekTo(0)` → play, which **truncates the sounding note**
   (`InstrumentVoiceOutput.ts:409-448`). Under source nodes both ring out.

## The costs, stated plainly

- **A new dev-client APK must be built and installed.** Oboe is C++/CMake; it
  cannot arrive over Metro. The current APK keeps working for any bundle that
  does not import the library, but the moment one does it throws at import.
  **Zero on-device verification is possible until a build completes.**
- **RN 0.86.2 is not in the library's compatibility matrix**, which tops out at
  0.85 and has no 0.13.x row at all. Its own dev app at tag 0.13.3 pins RN
  0.85.0 with an *exact* reanimated match (4.5.1) and near-exact worklets
  (0.10.1 vs our 0.10.4); main develops against 0.86/0.87. Likely fine — must be
  proven by the build, which is why that is step 0.
- **Dev-mode decode is a network dependency.** Under `__DEV__` the decoder
  fetches bundled assets from Metro over HTTP (`AudioDecoder.ts:96-99`); release
  reads them locally. Preload will be slower and flakier on-device in dev.
- The Windows/Git-bash trap in the library's `download-prebuilt-binaries.sh`
  is **already defused** in 0.13.3.

## Plan

Each step is independently shippable and verifiable. This is the only audio
path the instrument has, so no big-bang rewrite.

| # | step | effort |
|---|---|---|
| 0 | **Build-only spike.** Add the dep, nothing else. Prove it compiles and boots. | 1–4 h |
| 1 | **`armed-oboe` case** in the latency harness. Instrument untouched. Verify with `dumpsys media.audio_flinger` that the track is admitted to the fast mixer. | 2–4 h |
| 2 | **Cut the seam.** Extract an interface, add a flag, factory both branches to the OLD class. Zero behaviour change; existing suite green with no edits. | 2–3 h |
| 3 | **New engine, one-shots only.** Loops stay on expo-audio so the flag is a true A/B. Verify by ear with REPLAY CAPTURED JAM. | — |
| 4 | **Default the flag to oboe.** Real gloves, coach coexistence regression, leak soak. | — |
| 5 | **Move bed/bass loops**, delete the carried playlist code. | — |
| 6 | **Delete the old engine.** One-way door; gated on two real sessions. | — |

Steps 0–2 carry no product risk. Step 2 is what makes every later step
reversible *on the tablet without a rebuild* — which matters because Metro
cannot watch `F:\`, so every edit costs a Metro restart plus a cold app restart.

## What gets deleted

`fireOneShot` is exactly 90 lines (`InstrumentVoiceOutput.ts:366-455`). Five of
them — the armed fast path at `:403-407` — are the actual work and become
`src.start()`. The other ~85 exist solely because ExoPlayer one-shots are
stateful streams that must be rewound before they can sound again: the
`scheduleRearm` closure, the retrigger branch, the stalled-seek fallback, the
generation guards.

## Kill criteria

- **K1 (step 0):** will not compile against NDK 27.2.12479018 / compileSdk 36 /
  Kotlin 2.1.20 / RN 0.86.2, and no nearby tag does either. Abandon if the fix
  needs a fork or a downgrade other parts of the app depend on. Cost of
  learning: 1–4 h, no product code touched.
- **K2 (step 1):** the new engine's track *also* shows `Flags 0x000` and a large
  buffer. Then the tablet is refusing the fast path for a device or policy
  reason, not a media3 one, and the premise is void. Kill immediately.
- **K3 (step 1) — the important one:** `armed-oboe` still measures ~100 ms or
  jitter above ~25 ms. Then the engine was never the bottleneck and the cost is
  elsewhere, most plausibly the BLE→JS hop. This is the check that stops us
  optimising the wrong thing, and it is why step 1 comes before any product code.
