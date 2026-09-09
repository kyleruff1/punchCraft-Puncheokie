# Dorian Brass Cube — latched, quantized brass sequencer (authoritative)

Kyle's design, 2026-09-05, verbatim below. This is the first-build target for
the Puncheoke arpeggiator era. It supersedes the pentatonic anchor-arp first
build (`arpeggiator-design.md` — its anchor/dyad/interval chord-generation
modes remain as later presets) and absorbs the whammy/wah-combine requirement
(expression lanes ride the running pattern; the octave whammy is reserved for
exceptional peak punches).

---

Construct this as a **latched, quantized brass sequencer**, not as a direct
"one punch equals one isolated note" device.

The musical state should continue running between punches. Each tracker event
changes one part of that state:

```text
Left-hand velocity zone  → harmonic/chord selection
Right-hand velocity zone → arpeggio starting tone/inversion
Punch activity           → arpeggio rate and density
Acceleration              → brass attack, brightness, and wah depth
Punch timing              → retrigger, accent, direction, and transition
```

A punch should create an immediate audible accent, but the underlying chord and
arpeggio should change on the next rhythmic boundary. That gives the user both
physical responsiveness and musical coherence.

# Recommended first preset: Dorian Brass Cube

For this particular instrument, I would use **D Dorian** rather than D minor
pentatonic.

```text
D Dorian:
D – E – F – G – A – B – C
```

D minor pentatonic remains a strong general Note Cube default. D Dorian is
better for this brass-arpeggio patch because it supports a coherent family of
minor, major, dominant, suspended, ninth, and eleventh chords without leaving
one tonal environment.

The cube becomes:

```text
X axis = left-hand velocity zone
Y axis = right-hand velocity zone
Z axis = recent activity layer
```

Each axis is sample-and-hold:

* A left punch changes X and leaves Y alone.
* A right punch changes Y and leaves X alone.
* Activity changes Z but does not change the chord's fundamental identity.
* The resulting coordinate remains active until new punches alter it.

## Left-hand zones: chord bank

Use the left glove as the harmonic conductor.

| Left zone | Chord | Six-note arpeggio pool |
| --------: | ----- | ---------------------- |
|         0 | Dm9   | `D F A C E D′`         |
|         1 | F6/9  | `F A C D G F′`         |
|         2 | G9    | `G B D F A G′`         |
|         3 | Am11  | `A C E G D A′`         |
|         4 | C6/9  | `C E G A D C′`         |
|         5 | Dm11  | `D F A C E G`          |

These chords are related but distinct:

* `Dm9` is home.
* `F6/9` is open and brighter.
* `G9` supplies the strongest funk/brass tension.
* `Am11` sounds suspended and mobile.
* `C6/9` is broad and resolved without sounding final.
* `Dm11` returns home with greater density.

Higher left-hand punch velocity moves through those zones. Zone hysteresis
should keep marginal punches from jumping between adjacent chords.

## Right-hand zones: arpeggio start tone

Use the right glove to choose where the arpeggio enters the current chord.

| Right zone | Start position                       |
| ---------: | ------------------------------------ |
|          0 | Root                                 |
|          1 | Third or first color tone            |
|          2 | Fifth                                |
|          3 | Seventh, sixth, or second color tone |
|          4 | Ninth or eleventh                    |
|          5 | Upper root or highest extension      |

For Dm9:

```text
Zone 0 → D
Zone 1 → F
Zone 2 → A
Zone 3 → C
Zone 4 → E
Zone 5 → upper D
```

This gives the punches an easily audible relationship. Harder right punches
generally start the phrase higher in the harmonic structure, while harder left
punches select a different chord.

# Rotating the arpeggio to the selected start note

Suppose the active chord is:

```text
Dm9:
D3 F3 A3 C4 E4 D5
```

A right-hand zone-2 punch selects `A`. Rotate and octave-wrap the pool:

```text
A3 C4 E4 D5 F5 A5
```

The selected tone is now the lowest note and therefore the first note of an
upward arpeggio.

A deterministic rotation function is:

```ts
function rotateAscending(
  notes: readonly number[],
  startIndex: number,
): number[] {
  if (notes.length === 0) {
    throw new Error("Cannot rotate an empty note pool");
  }

  const result: number[] = [];
  let previous = Number.NEGATIVE_INFINITY;

  for (let offset = 0; offset < notes.length; offset += 1) {
    const sourceIndex =
      (startIndex + offset) % notes.length;

    let note = notes[sourceIndex];

    while (note <= previous) {
      note += 12;
    }

    result.push(note);
    previous = note;
  }

  return result;
}
```

This is also how you can control a simple upward Studio One arpeggiator without
depending on note-on arrival order: make the intended starting tone the lowest
note of the supplied inversion.

# Arpeggio pattern

Do not use plain ascending notes for every patch. A six-note brass pool sounds
more intentional with a recurring fan or weave pattern.

A useful eight-step default is:

```text
0 – 2 – 1 – 3 – 2 – 4 – 3 – 5
```

For the unrotated Dm9 pool:

```text
D – A – F – C – A – E – C – D′
```

Call this pattern **Punch Weave**.

Other selectable patterns can be:

```text
UP
0 1 2 3 4 5

DOWN
5 4 3 2 1 0

FANFARE
0 2 4 1 3 5

PENDULUM
0 2 4 5 3 1

PUNCH WEAVE
0 2 1 3 2 4 3 5
```

The pattern is applied after the note pool is rotated to the punch-selected
starting tone.

# Activity controls speed, not arbitrary pitch

Use the same 60 BPM foundation as the workout engine.

| Activity layer | Arpeggio rate | Step interval | Suggested pattern depth |
| -------------: | ------------: | ------------: | ----------------------- |
|       0 — Idle |  60 notes/min |      1,000 ms | First 2–3 notes         |
|    1 — Working | 120 notes/min |        500 ms | 4 notes                 |
|    2 — Driving | 180 notes/min |        333 ms | 6 notes                 |
|     3 — Flurry | 240 notes/min |        250 ms | Full 8-step pattern     |

Suggested gate lengths:

|    Rate | Note gate |
| ------: | --------: |
|  60/min |       75% |
| 120/min |       65% |
| 180/min |       55% |
| 240/min |    42–48% |

The shorter gates at high rates prevent brass releases from accumulating into
an indistinct mass.

Activity-layer changes should have hysteresis and should become effective on a
beat or subdivision boundary. Do not change arpeggiator rate immediately in the
middle of a note.

A reasonable rate detector is:

```text
Z0: below 0.75 punches/second
Z1: 0.75–1.75 punches/second
Z2: 1.75–3.25 punches/second
Z3: above 3.25 punches/second
```

Tune those thresholds from real sessions.

# Immediate punch response versus quantized musical change

This distinction will make the instrument feel much better.

Every punch produces two responses.

## Immediate response

Triggered as soon as the live tracker event arrives:

```text
Short brass accent on the selected anchor note
Percussive Toontrack transient
Wah/filter envelope
Visual cloud or cube impact
```

## Quantized response

Committed on the next arpeggiator step:

```text
New chord
New inversion/start note
New arpeggio rate
New pattern direction
New held bass note
```

This means the punch always feels responsive, but network jitter and irregular
punch timing do not destroy the musical grid.

A good event path is:

```text
Punch received
    ├── play immediate accent
    ├── update visual impact
    └── stage harmonic state
                  ↓
       next rhythmic boundary
                  ↓
       commit chord/start/rate
```

When several punches arrive before the same boundary:

* Every punch may trigger an impact transient.
* Retain the newest valid zone change for each hand.
* Accumulate their activity energy.
* Commit one coherent harmonic state on the boundary.

Do not restart the entire eight-step arpeggio six times during a six-punch
flurry.

# Arpeggiator retrigger policy

Offer three behaviors.

## Quantized Rotate — recommended default

The current sequence continues until the next step. The new punch-selected tone
becomes the next starting position.

```text
No hard gap
No off-grid restart
Punch still changes the musical direction
```

## Hard Retrigger

Each committed punch restarts step zero of the rotated pattern.

This is dramatic but can become repetitive during flurries.

## Continuous Morph

The arpeggio keeps its current phase. Chord tones and inversion change
underneath it at the next step.

This is the smoothest mode and works well with sustained synth brass.

For the default patch, use **Quantized Rotate**.

# Studio One routing

Studio One 4 provides Note FX including Arpeggiator, Chorder, and Repeater. For
a prototype, PunchBridge can send a held chord into the Arpeggiator. If
PunchBridge sends only a root, place Chorder before Arpeggiator; if PunchBridge
sends the complete six-note chord, omit Chorder. Sending the full chord is
preferable because it keeps the harmonic mapping inside your one shared
PunchBridge manifest.

Use this session layout:

```text
MIDI channel 2  → Low Brass / Bass Root — Mojito or low-brass instrument — no fast arpeggio
MIDI channel 3  → Main Brass Arpeggio — Mai Tai synth brass or sampled brass
MIDI channel 4  → Immediate Brass Accent — short brass stab — one event per punch
MIDI channel 10 → Superior Drummer / EZdrummer — impact and rhythmic transient
```

## Track 1 — Low harmonic anchor

Use Mojito, a low synth-brass patch, or a low sampled brass patch.

```text
Left punch selects chord.
Bass changes to the chord root.
Note remains held until another left punch changes it.
Glide approximately 80–180 ms.
```

Do not arpeggiate the bass rapidly. The low root gives the upper brass movement
a stable floor.

## Track 2 — Main brass arpeggio

Use Mai Tai for the most controllable first implementation. Mai Tai provides
two oscillators, multimode filters, two tempo-synchronizable LFOs, a 16-slot
modulation matrix, mono glide, rhythmic gating, modulation effects, delay,
reverb, distortion, and pan.

A starting synth-brass patch:

```text
Oscillator 1: saw
Oscillator 2: saw
Oscillator 2 detune: +4 to +8 cents
Sub oscillator: low amount
Filter: 24 dB low-pass
Filter drive: moderate
Attack: 10–25 ms
Decay: 180–350 ms
Sustain: 55–75%
Release: 120–260 ms
Filter envelope: positive
Punch control: moderate
```

For fast arpeggiation, synth brass is generally more predictable than a long
sampled ensemble. A realistic sampled brass layer can be added selectively on
the first note of each phrase or on hard punches.

## Track 3 — Immediate brass hit

Use a short stab, marcato, or synth-brass accent. Each punch plays the
currently selected anchor note immediately. This gives the boxer direct
feedback even though the full harmonic transition waits for a quantized
boundary.

## Track 4 — Impact transient

Use Superior Drummer or EZdrummer for short physical punctuation:

```text
Light punch  → rim, shaker, or muted hit
Medium punch → snare/tom layer
Hard punch   → deeper tom, kick, or impact
Peak punch   → crash or larger accent
```

Keep the transient short so a flurry does not create an uncontrolled wash.

# Studio One Arpeggiator versus PunchBridge arpeggiator

Support both backends behind the same preset manifest.

## Studio One Note FX backend

PunchBridge sends held chord notes. Studio One performs the pattern.

Advantages: quick to prototype; easy to audition patterns; uses the Studio One
interface; little desktop scheduling code.

Limitations: exact phase reset and selected start-note behavior may depend on
the Note FX configuration; dynamic rate and pattern changes may be less
deterministic; mobile visuals and Studio One can accidentally develop separate
notions of arpeggiator phase.

## PunchBridge tick backend — recommended production path

PunchBridge owns the arpeggio pattern and emits each MIDI note from the same
tick-native mapping used for the cube.

Studio One remains responsible for: instrument synthesis, oscillators, filters,
LFOs, wah, pitch bend, reverb, delay, compression, recording.

PunchBridge is responsible for: chord generation, starting note, pattern order,
rate, gate, quantization, Note On and Note Off timing.

This is the stronger final architecture because the audible note sequence, cube
animation, and recorded gesture all derive from one compiled map.

Use:

```ts
type ArpeggiatorBackend =
  | "studio-one-note-fx"
  | "punchbridge-tick";
```

The musical preset remains identical whichever backend performs the final note
sequencing.

# Tracker-to-music mapping

Use only reliable tracker inputs in free-play mode.

| Tracker-derived input         | Musical result                    |
| ----------------------------- | --------------------------------- |
| Left-hand velocity zone       | Select chord                      |
| Right-hand velocity zone      | Select start degree/inversion     |
| Velocity position within zone | Brass brightness or wah depth     |
| Acceleration peak             | Accent velocity and filter attack |
| Punches per second            | Arpeggiator rate and density      |
| Gap from previous punch       | Glide duration                    |
| Rapid alternation             | Stereo width or pendulum pattern  |
| Same-hand repetition          | Reaccent current role             |
| New velocity peak             | Octave scoop or brass fall        |
| Recovered event               | No live musical output            |

The unresolved `punchTypeRaw` should not select brass articulations in
free-play mode.

In Guided mode, the expected program token can add reliable articulation:

| Programmed punch | Brass treatment                                 |
| ---------------- | ----------------------------------------------- |
| `1`, `2`         | Clean, immediate brass attack                   |
| `1B`, `2B`       | Same pitch family with sub-octave reinforcement |
| `3`, `4`         | Lateral filter or stereo sweep                  |
| `3B`, `4B`       | Darker sweep and low transient                  |
| `5`, `6`         | Upward pitch/filter scoop                       |
| `5B`, `6B`       | Lower, heavier upward scoop                     |

# Oscillation design

Keep oscillator movement synchronized to the same master tempo.

A strong Mai Tai configuration is:

```text
LFO 1: synchronized to 1/4 note, modulates filter cutoff lightly
LFO 2: synchronized to 1/8 note, modulates pan, character, or pitch by only a few cents
Gater: normally low or disabled, increased only at activity layers Z2 and Z3
```

Map activity to **depth**, not continuously varying free-running frequency:

```text
Low activity: almost no LFO modulation
Working:      slight filter breathing
Driving:      stronger filter movement and stereo width
Flurry:       rhythmic gating, wider modulation, greater drive
```

Keeping LFO rates tempo-synchronized prevents the oscillation from drifting
against the arpeggio.

# Wah and pitch-transition mapping

Use acceleration and velocity for different purposes.

```text
Acceleration:                    how hard the brass envelope opens
Velocity within the selected zone: how far the wah/filter travels
Zone distance:                   how long the pitch transition takes
Punch rate:                      how quickly the wah closes
```

Example:

```text
Low acceleration:  MIDI velocity 50, mild filter opening
High acceleration: MIDI velocity 118, filter opens aggressively, immediate brass accent
One-zone change:   70–120 ms glide
Four-zone change:  180–280 ms glide
```

A new peak strike can add:

```text
+12-semitone rise
short brass fall
brief pitch overshoot
extra octave layer
```

Use those only for exceptional punches. A full whammy gesture on every hit will
obscure the harmony.

# Suggested compiled cube structure

Compile the 36 X/Y harmonic states in advance.

```ts
type Zone = 0 | 1 | 2 | 3 | 4 | 5;

interface CompiledBrassCubeCell {
  cellId: string;

  leftZone: Zone;
  rightZone: Zone;

  chordName: string;
  bassMidiNote: number;

  naturalPool: readonly number[];
  rotatedPool: readonly number[];

  startIndex: Zone;
  startMidiNote: number;

  arpPattern: readonly number[];
}

interface BrassActivityLayer {
  layer: 0 | 1 | 2 | 3;

  notesPerMinute: 60 | 120 | 180 | 240;
  gateRatio: number;
  patternLength: number;

  lfoDepth: number;
  wahMultiplier: number;
  transientMultiplier: number;
}

interface BrassCubePreset {
  schemaVersion: 1;

  id: string;
  name: string;

  rootPitchClass: number;
  mode: "dorian";

  leftChordBank: readonly ChordDefinition[];

  rightStartIndices: readonly [0, 1, 2, 3, 4, 5];

  pattern: readonly number[];

  activityLayers: readonly BrassActivityLayer[];

  arpBackend: "studio-one-note-fx" | "punchbridge-tick";
}
```

Every punch should compile into one semantic gesture:

```ts
interface CompiledBrassGesture {
  eventId: string;
  mapHash: string;

  immediateAccent: {
    midiNote: number;
    midiVelocity: number;
    channel: number;
  };

  quantizedChange: {
    effectiveAtTick: number;

    cubeCellId: string;
    bassMidiNote: number;

    chordMidiNotes: readonly number[];

    arpStartIndex: number;
    arpPattern: readonly number[];

    notesPerMinute: 60 | 120 | 180 | 240;
  };

  modulation: {
    wahPeak: number;
    wahReleaseMs: number;
    filterBrightness: number;
    lfoDepth: number;
    glideMs: number;
  };
}
```

The cube visualizer, PunchBridge MIDI backend, and session recorder should
consume this same gesture.

# Example performance

Initial state:

```text
Left zone 0: Dm9
Right zone 0: start on D
Activity Z1: 120 notes/min
```

The brass arpeggio runs from D.

A hard left punch lands in zone 2:

```text
Immediate: G brass stab
Next quantized step: chord changes to G9, bass changes to G,
arpeggio is voice-led into the new pool
```

A medium right punch lands in zone 4:

```text
Immediate: A accent
Next quantized step: G9 remains active, arpeggio rotation changes to start from A
```

The user begins alternating rapidly:

```text
Activity rises to Z3
Rate becomes 240 notes/min
Pattern expands to all eight steps
Wah recovery shortens
Stereo width increases
Brass remains harmonically inside G9
```

The punching stops:

```text
No pitch changes occur
Activity falls gradually
Arpeggio returns to 180, then 120, then 60 notes/min
Filter closes slightly
The last chord and start position remain latched
```

That behavior is understandable: punches establish the musical state, while
physical effort determines how animated that state becomes.

# Recommended first build

Use this exact configuration:

```text
Preset:            Dorian Brass Cube
Key:               D
Left-hand role:    Select chord
Right-hand role:   Select arpeggio start tone
Chord bank:        Dm9, F6/9, G9, Am11, C6/9, Dm11
Arpeggio:          Punch Weave 0-2-1-3-2-4-3-5
Activity rates:    60 / 120 / 180 / 240 notes per minute
Bass:              Mojito, channel 2
Main arp:          Mai Tai synth brass, channel 3
Immediate accent:  Short brass patch, channel 4
Impact:            Toontrack, channel 10
Default backend:   PunchBridge tick scheduler
Prototype backend: Studio One Note FX Arpeggiator
```

The defining interaction should be:

> A left punch chooses the harmonic world. A right punch chooses where the
> brass phrase enters that world. Continued punching accelerates and energizes
> the arpeggio without losing the chord, and every hit still produces an
> immediate physical accent.
