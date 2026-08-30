# Audio corpus catalog

The one document a contributor reads before farming out new voice clips. Every clip category that ships in the app is listed once, with its id pattern, manifest, render command, and pronunciation rules. If a rule or a directory is not written here, it does not exist.

Companion: `docs/audio-validation-rulebook.md` — the checklist a validator walks after a render batch.
Roadmap: [M39 #278](https://github.com/kyleruff1/punchCraft-Puncheokie/issues/278) — the corpus re-render milestone this doc gates on.

## Doctrine

- **BPM is authored, never derived.** Each cadence renders at a fixed base speed (`prosody.mjs:198-204`); the runtime never rate-shifts a clip to hit a beat grid.
- **Canonical Jonathan reference.** `tools/voice/reference/cornerman-reference.wav` (v5, SHA `822c06aa…`) is the one voice-clone source. Swapping it swaps every voice in the corpus — see `tools/voice/reference/PROVENANCE.md`.
- **Single-directory rule.** New Chatterbox wavs land in `assets/voice/numbers/standalone/`. Adding a fresh directory under `assets/voice/` breaks Metro's Windows file map; the manifest's four vocabulary/form directories are populated by copy, not by rendering into each.
- **One performance per cadence.** The cornerman persona pins `performances:['push']` (`personas.mjs:57-67`). teach/work/push remain a live selection axis, but only push is on disk today — teach/work re-renders would triple corpus size for no audible difference.
- **Delivery, never tempo.** Energy comes from `exaggeration`, `cfgWeight`, contour depth, and finish. `fitRateForJob` accepts only per-key `override.tempo`; a blanket vocabulary tighten was reverted the same night words started finishing ahead of punches (`make-phrase-clips.mjs:422-434`).
- **Rail K = 120 ms is the one project constant.** `RhythmMap.ts:255` and every audit/simulator (`cadence_audit.py`, `rail_verify.py`) all read the same 120 — ring N fires 120 ms after word N's audible envelope ends.

## Category table

| # | Category | Purpose | Id pattern | Count | Manifest | Render command |
|---|---|---|---|---|---|---|
| 1 | Whole-phrase combination clips | The utterance the live coach speaks for each combination at each cadence | `{combo}.{cadence}.{vocab}.{perf}` | 776 | `src/audio/voiceAssets/phraseManifest.ts` | `node tools/voice/make-phrase-clips.mjs` |
| 2 | Per-token word clips | Single-word calls for technical cadences and the per-word fallback | Bare id (`1`..`6`, `slip`, `bell`, …) | 132 | `src/audio/voiceAssets/manifest.ts` | `node tools/voice/make-voice-clips.mjs` |
| 3 | Walkout intro segments | Pre-round walkout announcement, played by IntroPlayer | `intro-hello`, `intro-rounds-{n}`, `intro-program-*`, `intro-letsgo` | 25 | `src/audio/voiceAssets/introManifest.ts` | `node tools/voice/make-intro-clips.mjs` |
| 4 | Round-warning openers + countdowns | Rest-end opener plus per-round countdown, aligned to the ding | `warn-opener-NN`, `warn-round-N` | 26 | `src/audio/voiceAssets/introManifest.ts` | `node tools/voice/make-intro-clips.mjs` |
| 5 | Power-strikes announcement | The one in-round call when the strike window widens for power | `power-strikes` | 1 | `src/audio/voiceAssets/introManifest.ts` | `node tools/voice/make-intro-clips.mjs --only-ids=power-strikes` |
| 6 | Set-ceremony call-outs | The coach's per-motif tags, buildup markers, coast/final tails | `co-{theme}-NN` | 67 | `src/audio/voiceAssets/calloutManifest.ts` | `node tools/voice/make-callout-clips.mjs` |
| 7 | Round theme clips (rest-side) | "Coming up — the Square Builder!" previews during rest | `theme-{slug}` | 21 | `src/audio/voiceAssets/calloutManifest.ts` | `node tools/voice/make-callout-clips.mjs` |
| 8 | Inter-round recovery walkthroughs | The corner working the fighter during the 60 s rest | `rec-{scriptId}-s{N}` | 91 | `src/audio/voiceAssets/recoveryManifest.ts` | `node tools/voice/make-recovery-clips.mjs` |
| 9 | Block-level cornerman instructions | Coach's line at a block boundary, matched to `WorkoutBlock.instruction` | `in-{slug}-NN` | 0 (manifest ready) | `src/audio/voiceAssets/instructionManifest.ts` | `node tools/voice/make-instruction-clips.mjs` |
| 10 | Silence tracks | Playable holds so JS never sequences a pause | `silence-{ms}` | 18 | `src/audio/voiceAssets/silenceManifest.ts` | `ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t <sec> silence-<ms>.wav` |
| 11 | Persona audition clips | Dev-only listening test (Kokoro blends). Not on the runtime path. | `{phrase}.{vocab}.{perf}.{blend}` | 20 | `src/audio/voiceAssets/auditionManifest.ts` | `node tools/voice/make-audition.mjs` |

Total wavs on disk today: **1381** (`find assets/voice -name '*.wav' | wc -l`).

## 1. Whole-phrase combination clips

The primary path `VoiceOutputExpo.playCombination` looks up so a combo sounds like one coach speaking, not stitched digits. Driven by `tools/voice/corpus.mjs` (`combinationsFromCorpus` × `CADENCES` × `VOCABULARIES`) from the workout motif library.

- **Location**: `assets/voice/phrases/cornerman/*.wav` (persona-scoped subdir)
- **Runtime consumer**: `src/audio/VoiceOutputExpo.ts::playCombination()` calls `findPhraseAsset(combination, cadence, vocabulary, performance, persona)`. `src/app/(tabs)/punchcraft/_useWorkoutRunner.ts` also reads `startPadMs`. `src/app/(tabs)/punchcraft/live.tsx` filters recipes to clips that exist.
- **Delivery**: Old-School Cornerman persona — aged-melodic blend, theatrical expression, broadcast texture, shout finish. Techniques vocab renders hotter (`exaggeration:1.35`, `cfgWeight:0.25` — `make-phrase-clips.mjs:465-472`). Aged drift 0.14 semitones / 4.2 Hz. `PERFORMANCES` pinned to `['push']`.
- **Timing**: Word→strike fit lives in `plan.speed × tempoCalibration × override.tempo`. Never blanket-tighten (see doctrine).
- **Wordmarks chain**: envelope-strict → envelope-relaxed → Whisper backfill (`tools/voice/whisper_word_spans.py`). Envelope detector tightened to 0.12 start / 0.25 end (2026-08-28). Rail-sanity guard drops marks that would fire rings <150 ms apart.

Example ids: `1-2b.steady.numbers.push`, `2-3-6.pressure.techniques.push`, `1-4-2-3-6-5.technical.numbers.push`.

## 2. Per-token word clips (VoiceAssetId set)

The single-word bark the runtime plays for technical cadences and as the per-word fallback when no phrase clip exists. A lone command should land, not sound like a shouted combination ending.

- **Location**: `assets/voice/{numbers,names}/{standalone,combo}/*.wav` — four directories, same ids, different renderings. Every id lives in **all four** dirs because the manifest's directory guard requires each vocabulary/form section to own its file.
- **Runtime consumer**: `src/audio/VoiceOutputExpo.ts::playAsset(id)` resolves through `voiceAssetManifest.assets[vocabulary][form][id]`. `CueAnnouncer` dispatches punch/defense/footwork cues to it.
- **Delivery**: Same cornerman persona, but always `performance:'work'` with `finish:'land'` (`make-voice-clips.mjs:205-211`). A firm bark, not a shouted phrase-ender.
- **Forms**: `standalone` at announcement pace (`FORM_SPEED.standalone=1.18`), `combo` re-rendered quicker (`FORM_SPEED.combo=1.5`). `combo` is a different render, not the standalone sped up — that would smear consonants.

Id examples: digits `1`..`6`, `slip`, `roll`, `duck`, `bob-weave`, `cut-off-ring`, `body`, `breathe`, `reset`, `switch`, plus tones `bell`, `tone-ready`, `tone-repeat`, `tone-warning`, `coast-15`, `coast-30`, `coast-45`, `coast-60`.

## 3. Walkout intro segments

Composed pre-round walkout: hello + round count + tier/cadence program line + let's go. Played by `IntroPlayer` during an extended pre-round countdown so the first bell waits for the coach.

- **Source**: inline `SEGMENTS[]` in `make-intro-clips.mjs` (`NUMBER_WORDS 2-12 × TIER_LINES × PACE_WORDS`).
- **Location**: `assets/voice/numbers/standalone/intro-*.wav` (kept in this dir because a fresh dir breaks Metro's Windows file map).
- **Runtime consumer**: `src/audio/introPlan.ts` composes the walkout playlist from `INTRO_SEGMENTS`. `src/app/(tabs)/punchcraft/live.tsx` reads durations for pre-round offset math. `RoundWarningPlayer.ts` also reads `INTRO_SEGMENTS['warn-round-N']` and `warn-opener-NN`.
- **Delivery**: `compileAdlib` with `performance:'work'`, `finish:'land'`, production expression + texture. Chatterbox `EXAGGERATION.work`, `attempts: 8`, `asrMinScore: 0.8`. Render bounds 900-14000 ms.
- **Pronunciation**: `Jonathan` (not `Johnathan` — Whisper normalises the silent H away and the ASR gate would flunk it). `Punchcraft` rendered as one word so "Jonathan-Punchcraft" reads without a pause (`make-intro-clips.mjs:66-73`).

Ids: `intro-hello`, `intro-rounds-{2..12}`, `intro-program-{beginner|intermediate|advanced}-{technical|steady|pressure|sprint}`, `intro-letsgo`.

## 4. Round-warning openers + countdowns

Every rest ends with a rotating opener line ("Break's over, champ!") then a per-round countdown ("It's time to get ready for round two, in three… two… one!"). Two separate clips: countdown pacing stays identical across every opener variant because they are separate files.

- **Location**: `assets/voice/numbers/standalone/warn-opener-{01..15}.wav` (15) + `warn-round-{2..12}.wav` (11) = 26 files.
- **Runtime consumer**: `src/audio/RoundWarningPlayer.ts` picks the opener via rotation and plays it back-to-back with `warn-round-<n>` through a native playlist.
- **Delivery**: `compileAdlib` work/land — energy sits **under** the phrase-clip shout.

## 5. Power-strikes announcement

One in-round call fired when the strike window widens to signal that the slow pace is for power, not rest ("Okay, some power strikes — slow down a bit!"). Must land inside one inter-strike gap (≥ 5 s window).

- **Location**: `assets/voice/numbers/standalone/power-strikes.wav`
- **Manifest note**: today lives in `INTRO_SEGMENTS` and its wav is copied to the four manifest dirs by hand after rendering. M39 absorbs this into `make-callout-clips.mjs`'s four-directory automation — see the retirement list.
- **Runtime consumer**: fired by id from the runtime when the map schedules a power-strikes window.

## 6. Set-ceremony call-outs (in-round)

The coach procuring every set inside a round — first-look intros, per-motif tags ("Okay, get ready — ones and twos!"), buildup markers, coast/thirty/final-round ceremony tails. `RhythmMap` reserves ceremony time from measured durations.

- **Source**: `tools/voice/callouts.json → inRound` (67 entries; variant slots `-01`/`-02`/`-03` picked by fill-time RNG).
- **Location**: rendered once into `assets/voice/numbers/standalone/co-*.wav`, then **copied** to the other three vocabulary/form dirs by `make-callout-clips.mjs`.
- **Runtime consumer**: `VoiceOutputExpo.playAsset(id)` — these are `VoiceAssetId`s. `CALLOUT_CLIPS[id].durationMs` feeds the schedule (`VoiceOutputExpo.ts:816`, `:831`). `src/domain/workout/setupCallouts.ts` selects the callout for each RhythmMap event.
- **Delivery**: `compileAdlib` work/land, Chatterbox `EXAGGERATION.work`, `attempts: 8`, `asrMinScore: 0.8`, bounds 700-9000 ms.
- **Text style**: full sentences with mid-line em-dashes (`callouts.json:2,49-51`) — never colons.

Id examples: `co-first-look-01`, `co-ones-twos-03`, `co-hooks-02`, `co-buildup-start-03`, `co-closer-13`, `co-power-coast-01`, `co-thirty-01`, `co-final-round-02`.

## 7. Round theme clips (rest-side)

Rest-side previews of the next round's ladder theme, played by `RoundWarningPlayer` alongside the countdown.

- **Source**: `tools/voice/callouts.json → themes` (21 entries).
- **Location**: `assets/voice/numbers/standalone/theme-*.wav` — kept in that dir **only**, not copied to the other three. Not part of the `VoiceAssetId` union; outside the manifest port.
- **Runtime consumer**: `RoundWarningPlayer.ts` uses `themeClipFor(theme)`. `src/app/(tabs)/punchcraft/live.tsx` also imports it for its planner.

Id examples: `theme-jab-volume-ladder`, `theme-square-builder`, `theme-body-to-head-staircase`.

## 8. Inter-round recovery walkthroughs

The cornerman working the corner during the 60-second rest — one script per rest, played as a native playlist (segment / silence / segment / silence) so JS never sequences the audio at runtime. Same doctrine `IntroPlayer` locked in.

- **Source**: `tools/voice/recovery.json` (20 scripts, 91 total segments; each segment carries `text` + `pauseAfterMs`; corpus caps total at 45 s).
- **Location**: `assets/voice/numbers/standalone/rec-*.wav` (one wav per segment — 91 files).
- **Manifest note**: `RECOVERY_SCRIPTS` records per-segment `durationMs`/`pauseAfterMs` and `measuredTotalMs`. Scripts exceeding the 45 s cap are excluded with a console error.
- **Runtime consumer**: `src/audio/RecoveryPlayer` builds one native playlist per rest. `src/app/(tabs)/punchcraft/live.tsx` picks the script from `RECOVERY_SCRIPTS`.
- **Delivery**: quieter than the work shout. `compileAdlib` work/land, but Chatterbox intensity varies per segment:

| Intensity | exaggeration | cfgWeight | Applies to |
|---|---|---|---|
| CALM (default) | 0.7 | 0.5 | default |
| QUIET | 0.6 | 0.55 | scripts with `deliveryMode:'quiet_cornerman'` |
| READY | 0.85 | 0.45 | last segment of every script (firmer readiness cue, not a shout) |

Bounds 1500-12000 ms. Held silence in the script ships as real silence tracks — never faked into the wav.

- **Pronunciation**: anatomical clarity is required (misheard hold instructions send the body the wrong way). `cfgWeight` runs tighter than the phrase side for text fidelity.

## 9. Block-level cornerman instructions

The coach's line at a block boundary ("Breathe.", "Empty the tank.", "Final thirty. Nothing held back."). Paired to `WorkoutBlock.instruction` by **exact-text match** so a new line does not need a code change.

- **Source**: `tools/voice/instructions.json` (32 frozen ids; the file's `_comment` describes the frozen-id + variant-slot policy).
- **Location**: `assets/voice/numbers/standalone/in-*.wav` — flat, not vocabulary-scoped.
- **Runtime consumer**: `src/app/(tabs)/punchcraft/_useWorkoutRunner.ts` calls `instructionClipFor(block.instruction)`. Missing entry leaves the block silent; nothing crashes. Threaded via A11 (#265) from `WorkoutBlock.instruction → CueInstance.instruction`.
- **Delivery**: `compileAdlib` work/land, Chatterbox `EXAGGERATION.work`, `attempts: 8`, `asrMinScore: 0.8`, bounds 500-6000 ms. Texture chain matches callouts.

**Status**: manifest ships **empty** today. The WS4 render batch has not run; zero `in-*.wav` on disk. All 32 ids are queued in `instructions.json`.

## 10. Silence tracks

Playable holds shipped as real wav assets so the walkout playlist and `RecoveryPlayer` never let JS bridge a pause — the doctrine that keeps native audio in charge of sequencing.

- **Generation**: no `make-*.mjs`; produced with `ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t <sec> silence-<ms>.wav`. 24 kHz mono matches the voice clips so the playlist never renegotiates format (documented in `silenceManifest.ts` header).
- **Runtime consumer**: `IntroPlayer` + `RecoveryPlayer` schedule these as real tracks; `silenceFor(gapMs)` resolves the module.

Gaps covered: 350, 800, 900, 1000, 1200, 1400, 1500, 1600, 1700, 1800, 2000, 2200, 2500, 3000, 3500, 4000, 4500, 5000 ms (18 files). Covers the sentence breath, the quantized landing-beat range, and the recovery corpus hold set.

## 11. Persona audition clips

Dev-only listening test for the decisive per-round persona A/B (round 6 = 4 voice blends × 5 phrases). Not production audio.

- **Source**: inline `PHRASES` × `BLENDS` in `make-audition.mjs`.
- **Location**: `assets/voice/audition/*.wav`.
- **Delivery**: theatrical / shout / broadcast pinned; only the Kokoro blend varies. Uses the Kokoro renderer, not Chatterbox.
- **Runtime consumer**: `src/app/dev/clip-audition.tsx` only. No runtime workout path consumes these.

## Pronunciation rules

### Fused Xbee body shots (numbers vocabulary only)

- A body-shot token `Nb` (`1b`..`6b`) in the **numbers** vocabulary renders as `One-bee`, `Two-bee`, `Three-bee`, `Four-bee`, `Five-bee`, `Six-bee` — digit word, hyphen, lowercase `bee`. One lexical unit, two distinguishable syllables, single breath. (`prosody.mjs:96-107`)
- Spelling `bee` (three letters) is mandatory so that `lowercaseInterior` folds to `one-bee` and the sound survives as `/biː/` rather than the letter name `/bʌ/`. (`prosody.mjs:105-106`)
- Rejected spellings (do not use): `One bee` (space, full pause), `Onebee` (fused, blurs to one syllable), `One, bee` (comma, wrong emphasis), `One... bee` (ellipsis, too spaced). Only `One-bee` — Kyle A/B/C 2026-08-28. (`feedback-fused-bee-pronunciation.md`)
- **Numbers only.** The techniques vocabulary renders body shots as `Body <technique>` (target front-loaded — the boxer knows the shot type as soon as they hear "body"). `spokenFor('2b',{vocabulary:'techniques'}) => 'Body cross'`. (`prosody.mjs:88-93`)
- The ASR canonicaliser expands a heard fused `2B` back to `['two','bee']` so token-exact audits accept whichever form Whisper produced. (`asr_match.py:85-106`)
- Whisper variants `b`, `be`, `bea` all fold to `bee` before scoring. (`asr_match.py:28-32`)

### Hyphenation and grouping

- Tight-vs-spaced spoken hyphenation is derived, not authored. `groupTokens` auto-pairs punches (`1-2-3-2 → [['1','2'],['3','2']]`); movements always stand alone. (`prosody.mjs:119-139`)
- Group separators are performance-dependent: teach uses `... ` (ellipsis); work and push both use `, ` (comma). A comma is deliberately kept in push — running groups together reads flatter, not more urgent. (`prosody.mjs:150-182`)
- A movement token forces `MOVEMENT_BEAT = '... '` on **both** sides regardless of performance; a plain comma next to a movement produced no measurable pause. (`prosody.mjs:374,385-396`)
- A movement group is followed by `!` when it is not the last group — the `!` forces the synthesiser to land the word hard and restores sentence-case for the next group. (`prosody.mjs:406-416`)
- Authored `spokenGroups` from corpus v1 override auto-pairing and enable **phased mode**. `1-4-2-3-6-5` with `[[1,4],[2,3],[6,5]]` renders `One-FOUR... two-THREE... six-FIVE!` — three motifs, never six flat digits. (`prosody.mjs:473-485,395-416`, `corpus.mjs:83-85`)
- Sentence case, not Title Case: `lowercaseInterior` lowercases every letter word except the first. Title case invited the synth to hit each word as its own emphatic unit. (`prosody.mjs:356-365`)
- Terminal punctuation is performance-dependent: teach `.`, work and push `!`. (`prosody.mjs:150-182`)

### Text overrides

- `tools/voice/overrides.json` is a keyed table read identically by both generators and by `export-expectations.mjs`. Keys: full clip key (`combo.cadence.vocab.perf`) for phrases; `vocabulary/form/id` or `word:id` for words (variant wins over `word:`). (`make-phrase-clips.mjs:282-294`, `make-voice-clips.mjs:178-191`, `export-expectations.mjs:33-37,116`)
- Recognised fields: `text` (respelling — becomes both the render text **and** the ASR gate expectation), `cfgWeight`, `exaggeration`, `attempts`, `minMs`/`maxMs` (final-file bounds, **pre** tempo-fit), `tempo` (per-clip fit multiplier; `<1` = compress less).
- When `override.text` is set, `plan.renderedText` is replaced before the ASR gate is fed, so a respelled clip is validated against what it actually says. (`make-phrase-clips.mjs:342-343`)
- Manual override texts for numbers-side body shots **must preserve the hyphen** — comma / space / ellipsis break the fusion contract. (`overrides.json:172`)
- No vocabulary-wide tempo multipliers. `fitRateForJob` only accepts a per-key `override.tempo`; a blanket tighten was reverted the same night. (`make-phrase-clips.mjs:422-434`)

### Numbers vs techniques vocabulary

Numbers map (fixed): `1=One, 2=Two, 3=Three, 4=Four, 5=Five, 6=Six`. Digits outside 1..6 fall through as the raw string. (`prosody.mjs:31`)

Techniques map (fixed): `1=Jab, 2=Cross, 3=Lead hook, 4=Rear hook, 5=Lead uppercut, 6=Rear uppercut`. Each has `full` and `compact` forms. Compact forms are used only in `pressure` and `sprint` cadences — "Lead uppercut to the body" cannot fit in a sprint window without rushing to mush. (`prosody.mjs:44-51,70-93`)

Techniques are named `lead`/`rear`, never `left`/`right` — a lead hook is a left hook orthodox and a right hook southpaw. A side-named call is wrong every time the athlete switches stance. (`prosody.mjs:36-42`)

### Movements and defence

Fixed spoken forms in `MOVEMENT_WORDS` (`prosody.mjs:54-66`):

| Token | Rendered |
|---|---|
| `slip` | Slip |
| `roll` | Roll |
| `duck` | Duck |
| `pull` | Pull |
| `bob-weave` | Bob and weave |
| `pivot` | Pivot |
| `step-off` / `step off` | Step off |
| `circle` | Circle |
| `cut-off-ring` | Cut off the ring |
| `reset` | Reset |

A single movement token compiles as a single-strike clip (`profile === 'single'`), not a combination. (`prosody.mjs:522-523`)

### Coast and coach lines

Coast announcements are whole sentences, never stitched at runtime (`wordCorpus.mjs:40-47`):

| Id | Text |
|---|---|
| `coast-15` | Coast for fifteen seconds |
| `coast-30` | Coast for half a minute |
| `coast-45` | Coast for forty-five seconds |
| `coast-60` | Coast for a minute |

Coach shorthand with fixed spellings: `double-up=Double up`, `put-it-on-em=Put it on em`, `touch-and-go=Touch and go`, `breathe=Breathe`, `hands-up=Hands up`. (`wordCorpus.mjs:48-55`)

### ASR canonicalisation

`asr_match.py` is the one canonicaliser used by both the render gate and every offline validator — living in one place is what stops the gate and the audit ever disagreeing about the same audio.

- Digits and homophones collapse: `1/won→one`, `2/to/too→two`, `3/tree→three`, `4/for/fore→four`, `5→five`, `6→six`. (`asr_match.py:33-45`)
- `uppercut` / `upper-cut` fold to `uppercut`, then the exactness pass folds `uppercut→upper` because compact cadences script `lead upper` and Whisper's LM autocompletes the technique name. (`asr_match.py:47-52,89-106`)
- `n` and `'n` fold to `and`. Adjacent merges: `(upper,cut)→uppercut`, `(step,off)→stepoff`. (`asr_match.py:49-59`)
- Filler vowels (`oh`, `ooh`, `whoa`, `ah`, `uh`, `hmm`, …) are **deliberately not folded** — an inserted `ooh` the coach never scripted must cost score and show up in `extra`. Elongated forms collapse: `/o+h*/ → 'ooh'`, `/a+h*/ → 'ah'`. (`asr_match.py:62-82`)

## Retirement list (M39)

| What | Reason |
|---|---|
| Jokes (`rec-jokes-*`, `joke-*`) | Retired 2026-08-30. Zero `joke-*.wav` and zero `rec-joke-*.wav` remain on disk. `make-recovery-clips.mjs` header still preserves the one-directory rule the jokes established, but the corpus itself is gone. The 20 `recovery.json` scripts fill the rest-side minute now. |
| Sprint-cadence phrase renders that miss the new grid | M39 cadence-lab re-render tightens the phrase-tempo grid-lock (`project-phrase-tempo-grid-lock` memory + `fitRateForJob` — "timing wildly off" revert 2026-08-27). Sprint slice re-renders under the new grid; any wav that cannot land inside the new cue window is discarded before the manifest is written. |
| Persona audition clips (`assets/voice/audition/*.wav`) | Round 6 was the last decisive round (aged-melodic won). The 20 wavs are only referenced by `src/app/dev/clip-audition.tsx` and can be pruned once the M39 corpus lands. Not on the runtime workout path. |
| `power-strikes` copy-by-hand pattern | The inline comment in `make-intro-clips.mjs` still says the wav must be "copied to the four manifest dirs by hand after rendering". M39 absorbs this into `make-callout-clips.mjs`'s four-directory automation, retiring the manual step. |

## How to add a new clip

Every category follows the same five-step recipe. Do not skip validation; a re-render is cheaper than an in-flight bug.

1. **Author the spoken text.** Follow the pronunciation rules above — fused `Xbee` if it is a numbers-side body shot, `lead`/`rear` for techniques, em-dashes for callouts, no `left`/`right`. Sentence case; the compiler adds terminal punctuation.
2. **Add the id to its source JSON or module.** Phrases: extend the workout motif library (the corpus generator picks it up automatically). Callouts: `tools/voice/callouts.json`. Recovery: `tools/voice/recovery.json`. Instructions: `tools/voice/instructions.json` (id is frozen once assigned). Intro/warn/power: inline `SEGMENTS[]` in `make-intro-clips.mjs`. Per-token words: `tools/voice/wordCorpus.mjs`. Per-clip text respellings or delivery knobs: `tools/voice/overrides.json`.
3. **Render.** Use the category's render command from the table above. Scope with `--only-ids=` or `--only=` when possible so the GPU pass is short. `--manifest-only` refreshes the manifest without re-rendering wavs.
4. **Validate.** Walk the pass workflow in `docs/audio-validation-rulebook.md`. At minimum: `phrase_token_audit.py` (or `validate_clips.py` for non-phrase categories), `cadence_audit.py` (for phrases), `speaker_audit.py`, and `validate_clips.py` for signal.
5. **Commit** the wav(s), the updated JSON source, and the regenerated manifest together. The manifest and its wavs move as one artefact.
