# Puncheoke transitions & expression — glide, whammy, wah

> Design supplement (Kyle, 2026-09-05), authoritative alongside
> `instrument-design.md` + `note-cube-design.md`. Scope: how a latched
> voice MOVES and BREATHES — pitch transitions and filter/wah expression —
> and the Studio One 4 instrument assignments.

## Division of labor

| Channel | Hand | Instrument | Character |
|---|---|---|---|
| 2 | Left | **Mojito** (later; Mai Tai first) | Lower register, portamento, darker filter |
| 3 | Right | **Mai Tai** | Upper register, glide + bend, wah/formant |
| 10 | — | Superior Drummer / EZdrummer | Short punch transients, no latched notes |

First implementation: **two Mai Tai instances** for identical transition
behavior on both hands; swap the low voice to Mojito once stable.
Toontrack stays the later transient layer — not the place for held-note
transitions.

## 1. Pitch transitions

**Portamento/glide is the primary mechanism** for cube navigation. Mai Tai
supports mono + Glide (1 ms–1 s) with independent up/down bend ranges;
Mojito has Glide/Glide Time. The MIDI sequence for a legato glide:

```text
1. Old note remains on.
2. Note On (new note).
3. Mono/legato synth glides old → new.
4. Note Off (old note) 5–15 ms AFTER the new Note On (tune per synth).
```

**Pitch bend is an ornament, not the primary mover.** Gestures:

| Transition | Pitch behavior | Duration |
|---|---|---|
| Clean Glide | Portamento only | 50–250 ms |
| Punch Scoop | −1..−2 semitones → center | 70–160 ms |
| Elastic | Destination, +10–30 cents, center | 90–220 ms |
| Whammy Rise | Center → +12 semitones | 200–450 ms |
| Whammy Dive | Center → −12 semitones | 200–500 ms |

Full-octave effects are selective (peak events), never every punch.
Standard 14-bit bend (0 / 8192 / 16383); PunchBridge's configured range
MUST match the synth preset's Bend range. One monophonic channel per hand
makes channel-wide bend correct by construction.

## 2. Wah

**Option A (first): the synth's own filter.** Mai Tai band-pass, resonance
45–65%, Mod Wheel (CC1) → Filter Cutoff in the mod matrix. PunchBridge
sends a short CC1 envelope per punch:

```text
baseline (≈18) → peak (25–50 ms attack) → baseline (150–350 ms release)
```

Tracker mapping: acceleration → peak opening; velocity → intensity +
attack; punch rate → release tightening; hand → independent channel; new
peak → stronger sweep. Reference formula:

```ts
peak = 55 + acceleration01 * 60 + velocity01 * 12         // clamp 0..127
attackMs = 55 - velocity01 * 30
releaseMs = 360 - punchRate01 * 220 - velocity01 * 60
baseline = 18
```

Isolated hard punch = broad wah; fast combination = short tight motions.

**Option B (later): Ampire Pedalboard wah** after the synth, mapped via
Control Link (needs Studio One ≥ 4.6 + Ampire license). Better for the
recognizable pedal character; more setup.

**Option C (signature): formant wah** — Mai Tai Character Talky/Voxil,
second CC → Character Sound; harder punches pronounce a stronger vowel.

## 3. Transition profiles live in the INSTRUMENT PROFILE

Never in the scale definition. Shapes:

```ts
PitchTransitionProfile { mode: none|glide|scoop|elastic|whammy-rise|whammy-dive;
  bendRangeSemitones; minimumDurationMs; maximumDurationMs;
  scoopSemitones; overshootCents }
WahTransitionProfile { backend: none|synth-filter|ampire-wah|formant;
  controllerCc; baselineValue; min/max peak; min/max attackMs; min/max releaseMs }
```

Example Mai Tai lead: elastic, bend ±12, 55–260 ms, scoop 1.5, overshoot
18 cents; wah CC1 baseline 18, peak 70–120, attack 20–55 ms, release
110–360 ms; resetOnDisconnect.

## 4. Tracker → transition mapping

| Tracker value | Destination |
|---|---|
| Velocity zone | Target note |
| Zone distance | Glide length |
| Velocity within zone | Pitch overshoot |
| Acceleration peak | Wah peak + transient attack |
| Punch rate | Wah release + glide tightening |
| Alternating hands | Stereo movement / opposite wah polarity |
| New velocity peak | Optional octave whammy accent |
| Same zone repeated | Retrigger + wah, no pitch change |
| Recovered event | No live sound |

## 5. Studio One 4 setup

- External device: **New Keyboard**, Receive From = PunchBridge port,
  all channels, **Split Channels enabled**.
- Track 1: input ch2 → Mojito (or Mai Tai #1) — left/bass.
- Track 2: input ch3 → Mai Tai — right/lead.
- Track 3: input ch10 → Superior Drummer / EZdrummer — transients.
- Mai Tai: Mono ON, Glide ON (~80–180 ms), Bend ±12, mod matrix
  Mod Wheel → Filter Cutoff (BP 12dB ladder, resonance 45–65%), optional
  CC → Character Sound (Talky/Voxil).
- Mojito: Glide/Glide Time for portamento; wah via Control Link or
  Ampire later.

## 6. State cleanup (always)

On session start/end, WS disconnect, MIDI destination change, patch
change, DAW unresponsive, tracker loss: bend → 8192, wah CC → baseline,
sustain off, known Note Offs, CC 123. Never leave bend at +12 or a wah
open across a disconnect.

## 7. First-implementation presets

- **Clean** — portamento only.
- **Elastic Wah** — portamento + 10–20 cent overshoot + short wah.
- **Whammy** — portamento normally; larger scoop on hard punches; full
  octave rise only on a peak event; wah opens with acceleration.
