# Audio validation rulebook

The checklist any validator — human or agent — walks before signing off on a render batch. Five rules, one pass workflow, one failure playbook. If a rule is not on this page, the batch does not need to satisfy it.

Companion: `docs/audio-corpus.md` — the catalog of what exists and what each category should sound like.
Roadmap: [M39 #278](https://github.com/kyleruff1/punchCraft-Puncheokie/issues/278).

## The five rules

### 1. Voice identity — matches canonical Jonathan reference, no accent drift

**Pass condition**: every clip's d-vector embedding is within 1.5 standard deviations of the batch mean cosine similarity against `tools/voice/reference/cornerman-reference.wav` (v5, SHA `822c06aa…`). No clip is an outlier.

**Why the rule exists**: Chatterbox is seedless. The same job can render a different-sounding take on a re-run — `intro-rounds-4` once landed clearly Australian while transcribing perfectly. The ASR gate cannot catch that.

**Tool**: `tools/voice/speaker_audit.py`.

```
F:/voice-tools/venv/Scripts/python.exe tools/voice/speaker_audit.py
```

Defaults to the announcer glob (`intro-*`, `warn-*`, `co-*`, `theme-*`, `joke-*`). Pass explicit globs for phrase batches.

**Thresholds**: `OUTLIER` when z-score `< -1.5` against the batch mean. No absolute floor — the batch is its own baseline.

**Failure recovery**: re-render the flagged clip(s) with `--only-ids=` or `--only-keys=`, then run `phrase_keep_better.py` (phrase batches) or re-audit. If the same clip drifts across three fresh takes, escalate — the reference may need swapping (see §Escalation).

### 2. Text fidelity — ASR ≥ 0.8, fused Xbee, correct hyphenation

**Pass condition**: for every phrase clip, `canonical_tokens(heard) == canonical_tokens(expected)` — hard equality, no similarity slack. For non-phrase categories the render gate has already required score ≥ 0.8 (or the per-job override); the offline validator flags anything that has since regressed.

**Why the rule exists**: fuzzy 0.85 let repeat-heavy combos ship saying "one, two" for `1-1-2` — a dropped token that scores acceptable on similarity but is wrong on content. The exact-token audit closed that hole. Fused Xbee body shots also fail silently under fuzzy scoring if Whisper hears "one B" instead of "one bee".

**Tools**: 
- Phrase library: `tools/voice/phrase_token_audit.py` (Tier-1 gate).
- Non-phrase: `tools/voice/validate_clips.py` (Tier-0 signal + ASR validator).
- Both delegate scoring to `tools/voice/asr_match.py` — the single canonicaliser.

```
node tools/voice/make-phrase-clips.mjs --dump-expectations=tools/analysis/expectations.json
F:/voice-tools/venv/Scripts/python.exe tools/voice/phrase_token_audit.py tools/analysis/expectations.json
```

**Thresholds**:

| Setting | Value | Source |
|---|---|---|
| `DEFAULT_ASR_MIN_SCORE` (render gate) | 0.85 | `chatterbox_render.py` |
| `PASS_MIN_SCORE` (validate_clips) | 0.85 | `validate_clips.py` |
| `FAIL_MAX_SCORE` | 0.60 | `validate_clips.py` |
| `FILLER_FAIL_SCORE` | 0.75 | filler vowel + score below this → fail |
| Phrase audit | exact `canonical_tokens` equality | `phrase_token_audit.py` |
| `--asr-exact` (per-job) | token equality on the render take | `make-phrase-clips.mjs` |

**Fused Xbee**: numbers-side body shots must transcribe as either `Xbee` (which the canonicaliser expands to `['X', 'bee']`) or as two tokens `X bee`. `X b` alone fails; `Xbee` fused into one token by Whisper is accepted because `_CANONICAL['b'|'be'|'bea'] = 'bee'` (`asr_match.py:28-32`).

**Hyphenation**: no direct validator — the render pipeline enforces it structurally (`prosody.mjs` compiles the spelling; `overrides.json` respellings must preserve the hyphen). The text-fidelity audit catches downstream damage: if a hyphen is lost, the fused body shot transcribes as two words with a gap and the token audit is unaffected but `cadence_audit.py` reports an unusual `spreadEndToRingMs` because the envelope changes shape.

**Failure recovery**: see §Failure playbook.

### 3. Grid fit — ±5% preferred, ±10% max, beyond → re-render

**Pass condition**: every phrase clip's measured `endToRingMs` at each token position is within ±5% of `RAIL_K_MS` (120 ms), i.e. within `[114, 126]` ms. Anything outside `[108, 132]` ms (±10%) is a re-render.

**Why the rule exists**: the scalable rail places ring N at `wordEnd[N] + 120 ms`. Drift outside 5% is what Kyle hears as "the coach is off the rings on X-Y-Z". Beyond 10% the audible landing shifts a full inter-strike gap on fast cadences.

**Tools**:
- Offline (100% library, no mic): `tools/voice/cadence_audit.py` — the Tier-1 cadence-lab gate.
- Live (mic-anchored): `tools/audition/cadence_analyzer.py` — the runtime counterpart.
- Log-only rail check (no mic): `tools/audition/rail_verify.py` — first-pass check that the runtime actually uses the rail rather than the beat grid.

```
node tools/voice/build-cadence-grid.mjs
F:/voice-tools/venv/Scripts/python.exe tools/voice/cadence_audit.py --rail
```

**Thresholds**:

| Setting | Value | Source |
|---|---|---|
| `RAIL_K_MS` | 120 ms | `RhythmMap.ts:255`, mirrored in `cadence_audit.py`, `rail_verify.py` |
| Legacy `AUDIBLE_DRIFT_MS` (max-abs) | 80 ms | `cadence_audit.py` |
| Within-clip tight | `spreadEndToRingMs < 60 ms` | `cadence_audit.py` |
| Rulebook: preferred | drift within ±5% of `RAIL_K_MS` (`±6 ms`) | this doc |
| Rulebook: max | drift within ±10% of `RAIL_K_MS` (`±12 ms`) | this doc |
| Envelope detector | 12% of peak, 50 ms min gap | `cadence_audit.py` |
| Whisper end-of-word fallback | onset + 300 ms | `cadence_audit.py` |

The audit exits **1 iff any clip is `source='unavailable'`** (could not measure). A fully-measured library with drifting clips exits 0 — a real drift is a finding, not an error. The rulebook thresholds above are enforced by the reviewer walking the report, not by the audit's exit code.

**Failure recovery**: see §Failure playbook. First remedy is a per-key `override.tempo` in `overrides.json`; never a vocabulary-wide tempo change.

### 4. Wordmarks coverage — 100% target, 75% floor

**Pass condition**: every phrase clip in the manifest has populated `wordMarks` with `endOffsetMs` for every token (100% target). A batch below 75% coverage does not ship.

**Why the rule exists**: rail placement is used only when `railMarks` cover every token and every mark has `endOffsetMs`; otherwise the runtime falls back to the classic beat-grid placement. A clip without wordmarks is a clip on the old timing, and no amount of cadence-audit polish will help it.

**Tool**: `tools/voice/build_phrase_timing.py` — compiles `src/audio/voiceAssets/phraseTimingManifest.ts` and lists every `(combination, cadence)` with `wordMarksSource == 'none'` as a re-render candidate.

```
F:/voice-tools/venv/Scripts/python.exe tools/voice/build_phrase_timing.py
```

The three-source chain the render pipeline walks (in order): envelope-strict → envelope-relaxed → `tools/voice/whisper_word_spans.py` (Whisper backfill). `whisper_word_spans.py` returns `ok=true` only when the aligned word count matches the expected token count; a mismatch stays unpopulated rather than shipping wrong marks.

**Thresholds**: no numeric gate in the tool — the reviewer reads `tools/analysis/reports/phrase-timing-audit.json` and confirms `wordMarksSource != 'none'` for at least 75% of `(combination, cadence)` rows (each row covers both vocabs). The 100% target is a re-render trigger for any remaining `'none'` rows before the batch is called done.

**Failure recovery**: for each `wordMarksSource=none` row, re-render with `make-phrase-clips.mjs --only=<combo> --attempts=10`. The Whisper backfill runs automatically as the third source. If a specific token position still refuses to align, add an `override.text` respelling that Whisper hears more cleanly.

### 5. Signal — validate_clips.py peak, DC, edge-silence, filler

**Pass condition**: every clip passes `validate_clips.py` with `verdict='pass'`. No `fail` rows; `suspect` rows reviewed and either accepted or bumped to re-render.

**Why the rule exists**: the render gate accepts a take that transcribes; it does not judge signal shape. A clip can score well on ASR while having 400 ms of leading silence, a runaway `oooooh` filler stretch, or a duration overshoot that shifts the whole schedule.

**Tool**: `tools/voice/validate_clips.py`.

```
F:/voice-tools/venv/Scripts/python.exe tools/voice/validate_clips.py --png flagged
```

**Thresholds**:

| Setting | Value |
|---|---|
| `PASS_MIN_SCORE` | 0.85 |
| `FAIL_MAX_SCORE` | 0.60 |
| `FILLER_FAIL_SCORE` | 0.75 (filler vowel + score below this → fail) |
| `VOWEL_SPAN_FLAG_MS` | 300 (unexplained voiced stretch beyond → suspect) |
| `EDGE_SILENCE_FLAG_MS` | 400 (leading + trailing quiet beyond → severity bump) |
| `SLOWED_PASS_MIN_RATE` | 1.1 (transcribe a slowed copy when `tempoRate >= 1.1`) |
| `WORD_COVER_TOLERANCE_S` | 0.1 |
| `TONE_FREQ_TOLERANCE` | 0.08 (dominant freq within 8% of spec) |
| `TONE_DURATION_TOLERANCE` | 0.25 |
| Duration bounds | from `expectations.boundsMs` unless `boundsAdvisory` |

Tones are validated separately by dominant frequency (FFT) and duration only — not speech.

The tool never exits non-zero on defective clips; it always writes `tools/analysis/reports/<runId>/report.json` + `report.md` (+ `png/`) and prints `pass X / suspect Y / fail Z`. Failures are read from `verdict='fail'` rows.

**Failure recovery**: see §Failure playbook.

## The pass workflow

Six steps, run top to bottom. Each step names its tool and its pass line. Do not proceed to the next step until the current step passes — a downstream tool will misdiagnose upstream damage.

### Step 1 — Render

```
node tools/voice/make-phrase-clips.mjs [--only=<combo>] [--attempts=10] [--asr-exact]
```

Pass line: every job prints `OK <path> <durationMs>` from `chatterbox_render.py`. Any `FAIL` line is investigated before continuing. `SHORT` / `OVER` / `ASR` tags mean the best-of-N could not satisfy the gate but the closest take was written anyway — treat as `suspect` and flag for re-render.

### Step 2 — ASR / text-fidelity check

Phrase batches:
```
node tools/voice/make-phrase-clips.mjs --dump-expectations=tools/analysis/expectations.json
F:/voice-tools/venv/Scripts/python.exe tools/voice/phrase_token_audit.py tools/analysis/expectations.json
```
Pass line: `total N, fails 0` — the audit exits 0. Any `FAIL` line names a clip and is fixed via §Failure playbook before Step 3.

Non-phrase batches: `validate_clips.py` (also covers Step 6 for these) — `pass X / suspect 0 / fail 0`.

If this was a re-render wave, run the keep-better pass first so the audit sees the best of the two takes:
```
F:/voice-tools/venv/Scripts/python.exe tools/voice/phrase_keep_better.py tools/analysis/expectations.json <keys-file>
```

### Step 3 — Wordmarks pipeline

```
F:/voice-tools/venv/Scripts/python.exe tools/voice/build_phrase_timing.py
```
Pass line: `tools/analysis/reports/phrase-timing-audit.json` shows ≥75% of `(combination, cadence)` rows with `wordMarksSource != 'none'`; the goal is 100% before the batch is signed off. Any `'none'` rows are re-rendered per §4 recovery.

### Step 4 — Cadence audit

```
node tools/voice/build-cadence-grid.mjs
F:/voice-tools/venv/Scripts/python.exe tools/voice/cadence_audit.py --rail
```
Pass line: exit 0 (no `source='unavailable'`) **and** the reviewer confirms per-clip `spreadEndToRingMs < 60 ms` and per-token `endToRingMs` within ±10% of `RAIL_K_MS`. The top-25 worst-spread table names any clip that misses the ±5% preferred band.

### Step 5 — Speaker / voice-identity audit

```
F:/voice-tools/venv/Scripts/python.exe tools/voice/speaker_audit.py <glob>
```
Pass line: no `OUTLIER` row in the printed 25 lowest — every clip's z-score against the batch mean is ≥ -1.5. Outliers are re-rendered until they stop drifting; three failures in a row escalate.

### Step 6 — Signal audit

```
F:/voice-tools/venv/Scripts/python.exe tools/voice/validate_clips.py --png flagged
```
Pass line: `pass X / suspect Y / fail 0`. Every `suspect` row is read; either accept it with a note or bump to re-render. Zero `fail` rows required.

## Failure playbook

One paragraph per common failure. All fixes preserve provenance: overwrite in place, commit the new wav and the manifest together.

**ASR score under 0.8** — usually a garbled or too-short take. First try `--only-keys=<key> --attempts=10`; the best-of-N cap defaults to 5 and pushing to 10 clears most transient losses. If the take still scores low, add `--asr-exact` (forces `canonical_tokens` equality on the render take) and re-render. If the text itself is ambiguous to Whisper, add an `override.text` respelling in `overrides.json` — the render gate and the offline audit will both see the new spelling because `export-expectations.mjs` reads the same file. After the re-render, run `phrase_keep_better.py` so the winner is chosen against the previous take rather than blindly overwritten.

**Xbee transcribed as two words** — the `canonical_tokens` fold accepts either `Xbee` fused or `X bee` split, so a two-word transcript by itself is not a failure. What matters is the spoken output: if the reviewer hears a gap ("one … B" rather than "One-bee"), the source spelling has lost the hyphen. Check `overrides.json` for the clip's `text` field and confirm it reads `three-bee`, never `three bee` / `threebee` / `three, bee`. Re-render after the fix; the audit passes when `heard` matches the expected canonical form and speaker/cadence downstream do not flag the clip.

**Wordmarks `source=none`** — the envelope detector could not lock word boundaries and the Whisper backfill returned `ok=false`. Re-render with `--attempts=10` first; a cleaner take usually envelopes cleanly. If the same clip resists across three renders, the token boundary itself is the problem — often a fused `Xbee` where the envelope collapses the two syllables. Add an `override.text` respelling that separates the two more distinctly (Kyle's contract is the hyphen; do not violate it, but per-clip you can force `Three bee` in the render text alone if the hyphen would fail to envelope — audit-side canonicalisation will still accept it). Confirm by re-running `build_phrase_timing.py` and checking the row is no longer `'none'`.

**Cadence outside ±5%** — the per-clip fit rate is off. First read the `cadence_audit.py` top-25 table: if the drift is one direction across many clips in a cadence, the base `CADENCE_SPEED` may be miscalibrated (rare — do not touch it without a plan discussion). If a single clip drifts, add `override.tempo` in `overrides.json` (`<1` compresses less; `>1` compresses more) and re-render just that key. Never blanket-tighten a vocabulary — the last time was reverted the same night words started finishing ahead of punches.

**Cadence outside ±10%** — hard re-render trigger. Do not ship. Same per-clip `override.tempo` remedy; if two `override.tempo` attempts do not land the clip inside ±10%, the phrase itself is longer than its cue window and the cue window is the wrong thing to fit against — flag the recipe rather than the render.

**Peak / DC / edge-silence out of bounds** — signal shape rather than content. `validate_clips.py` `suspect` rows call out which flag fired. Leading silence >400 ms usually means Chatterbox took a breath before speaking — a re-render with `--attempts=10` fixes it. Trailing silence usually means the tempo fit clipped the release — check `tempoRate` in the manifest and consider bumping the per-clip `maxMs` in overrides. A runaway `oooooh` stretch (VOWEL_SPAN_FLAG_MS >300 ms with a filler vowel in `extra`) is a synth artefact; re-render and if it survives, add `override.exaggeration` slightly lower (0.9) to calm the take.

## Escalation

Escalate to a human reviewer (Kyle) when any of the following happens; the loop below is otherwise self-terminating on any single clip.

- **Same clip fails three attempts.** Three fresh renders that all miss the same rule mean the recipe (the token sequence, the cue window, the vocabulary asymmetry) is the problem — not the render. File a note against the recipe rather than the wav.
- **Voice-identity failure requires a reference swap.** If a category-wide speaker drift lands (many clips flagged `OUTLIER` in one batch after a persona-adjacent change), the fix may be a reference swap rather than a re-render. Do not swap the reference without going through the `tools/voice/reference/PROVENANCE.md` process: record source, licensing, and rollback path; bump `PERSONA_VERSION` in `personas.mjs`; re-render the whole corpus (the version bump does not automatically invalidate rendered wavs — a `--force` full re-render is required).
- **`cadence_audit.py` exits 1.** Any clip with `source='unavailable'` means the audit could not measure a clip — usually a missing wav or a broken manifest row. Fix the manifest before treating anything else as a cadence finding.
- **A rule threshold change is proposed.** The five rules and their thresholds are the contract with the render pipeline; changing one (e.g. relaxing the ±5% preferred band, dropping the wordmarks floor) is a doc change, not an audit change. Propose it in the plan file and update this rulebook and `docs/audio-corpus.md` together.
