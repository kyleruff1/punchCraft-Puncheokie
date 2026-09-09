# Puncheoke Harmonic Cube: Punch-Driven Instrument Design

> Authoritative product design for the Puncheoke instrument (Kyle,
> 2026-09-05). Musical behavior — zones, scale, harmony modes, transitions,
> cube, clouds, MIDI mapping, phases, acceptance criteria — is specified
> HERE; the repo execution plan maps it onto code. Tracker-protocol facts
> referenced below are verified in the session schematic
> (12 claims adversarially checked 2026-09-05); see also
> `docs/protocol/hypotheses.md` H01–H12.

## Product premise

The FightCamp v1 trackers are well suited to a **sample-and-hold performance
instrument**.

They cannot act like a continuous theremin because they do not report hand
position between punches. Each accepted punch can instead sample a new musical
coordinate, move one or more virtual voices to that coordinate, and hold the
resulting sound until another punch changes it.

That limitation becomes the central mechanic:

> Every punch lands on a musical coordinate. The coordinate remains active,
> the note remains held, and the next punch bends or jumps the instrument into
> a new state.

The instrument should combine four layers:

1. **Latched harmony** — persistent notes selected by punch velocity and hand.
2. **Punch transients** — short percussive sounds triggered by each impact.
3. **Continuous modulation** — punch rate, alternation, and acceleration shape
   timbre and effects.
4. **Reactive visuals** — a harmonized cube and colored clouds display the
   same state sent to the synthesizer.

The result is not merely "punches trigger MIDI notes." It is a two-handed
physical instrument whose state is continuously rewritten by the boxer.

---

## 1. Constraints established by the tracker protocol

The reliable live inputs are:

```text
Physical hand
Raw velocity byte
Peak acceleration
Tracker timestamp
Arrival timestamp
Recent punch interval
Recent punch rate
Left/right alternation
Optional raw type code
```

The following restrictions should shape the design:

* There is no continuous IMU stream.
* There is no glove position between punches.
* Hand is supplied by the tracker slot, not the punch payload.
* `velocityCalibrated` should not be used as the principal pitch input because
  the vendor applies a type-dependent multiplier.
* `velocityRaw` is more suitable for a stable per-hand coordinate after
  calibration.
* `accelerationRaw` is currently discarded and should be promoted into
  `TrackerPunchEvent`.
* `punchTypeRaw` is not yet a trustworthy universal strike classifier.
* Buffered `recovered` events are too late to drive live music.
* One indication can contain two punch records, so record ordering and tracker
  timestamps must be preserved.

The application should therefore distinguish two musical operating modes.

### Free Instrument mode

Uses only trustworthy event properties:

```text
hand
velocityRaw
accelerationRaw
event timing
recent activity
```

It does not claim to recognize jab, cross, hook, uppercut, head, or body
unless a per-device classifier has been validated.

### Guided Instrument mode

Uses the workout score's expected strike token:

```text
1, 1B, 2, 2B, 3, 3B, 4, 4B, 5, 5B, 6, 6B
```

The canonical program token determines the musical articulation. The tracker
confirms that a punch occurred at the expected time and with the expected
hand.

This gives Puncheoke access to all twelve strike identities without pretending
the tracker independently classified them.

---

## 2. System architecture

The recommended signal path is:

```text
FightCamp trackers
        │
        ▼
Android punchCraft/Puncheoke app
        │
        ├── Decode punch
        ├── Normalize features
        ├── Compile one musical gesture
        ├── Update Harmonic Cube visuals
        └── Send musical gesture to PC
                    │
                    ▼
             PunchBridge desktop service
                    │
                    ▼
             Virtual MIDI destination
                    │
                    ▼
                Studio One
                    │
        ┌───────────┼─────────────┐
        ▼           ▼             ▼
  Left synth    Right synth    Impact layer
```

The phone or tablet remains the tracker central. The Windows PC does not
connect to the trackers directly while the mobile app is using them.

The mobile app should send a **semantic musical gesture**, not raw MIDI bytes.
The Windows bridge translates that gesture into MIDI messages.

This preserves:

* Full tracker precision.
* Future non-MIDI outputs.
* Visual/audio consistency.
* One mapping authority.
* Easier recording and diagnostics.

Studio One can receive a configured MIDI input as a keyboard/controller, and
its External Devices setup includes MPE enablement and pitch-range
configuration. That supports either one conventional MIDI channel per hand or
a later MPE implementation. Toontrack products can also be loaded as
instrument or effect plug-ins inside Studio One, making them suitable for the
percussive impact layer. ([PreSonus Support][1])

---

## 3. Preserve the single-mapping architecture

Puncheoke should follow the same architectural rule as the workout timing
engine:

> One manifest defines the relationship between tracker features, musical
> output, and visual output. Audio and graphics consume the same compiled
> gesture.

Do not create:

```text
MIDI mapping
Visual cube mapping
Cloud-color mapping
Haptic mapping
```

as independent logic.

Instead:

```text
PunchInstrumentManifest
        │
        ▼
MusicalGestureCompiler
        │
        ▼
CompiledPunchGesture
        ├── MIDI actions
        ├── cube coordinate
        ├── cloud response
        └── transient response
```

### Input event

```ts
export interface MusicalPunchInput {
  eventId: string;
  hand: "left" | "right";
  trackerTimestampMs?: number;
  receivedMonotonicTimeMs: number;
  velocityRaw: number;
  accelerationRaw?: number;
  punchTypeRaw?: number;
  recovered: boolean;
  expectedStrikeToken?:
    | "1" | "1B"
    | "2" | "2B"
    | "3" | "3B"
    | "4" | "4B"
    | "5" | "5B"
    | "6" | "6B";
}
```

### Derived musical gesture

```ts
export interface CompiledPunchGesture {
  schemaVersion: 1;
  sessionId: string;
  eventId: string;
  mapHash: string;
  source: {
    hand: "left" | "right";
    trackerTimestampMs?: number;
    receivedMonotonicTimeMs: number;
    velocity01: number;
    acceleration01: number;
    punchRate01: number;
    gapSincePreviousPunchMs: number;
    alternating: boolean;
    expectedStrikeToken?: string;
  };
  cube: {
    leftZone: number;
    rightZone: number;
    activityLayer: number;
    changedAxis:
      | "left"
      | "right";
    targetCoordinate: [
      number,
      number,
      number
    ];
  };
  voice: {
    voiceId:
      | "left"
      | "right";
    midiChannel: number;
    targetNote: number;
    noteVelocity: number;
    brightness: number;
    expression: number;
    transition:
      | "attack"
      | "retrigger"
      | "glide"
      | "scoop"
      | "sweep";
    transitionDurationMs: number;
    pitchOvershootCents: number;
  };
  transient: {
    note: number;
    velocity: number;
    layer:
      | "straight"
      | "hook"
      | "uppercut"
      | "generic";
  };
  visual: {
    quadrant:
      | "upper-left"
      | "lower-left"
      | "upper-right"
      | "lower-right";
    hueDegrees: number;
    opacity: number;
    radius: number;
    persistenceMs: number;
    transitionRibbonMs: number;
  };
}
```

The mobile visual renderer and the PC MIDI bridge both receive the same
`CompiledPunchGesture`.

---

## 4. The Harmonic Cube

The cube should represent the persistent musical state of both hands.

Use three axes:

```text
X axis = current left-hand velocity zone
Y axis = current right-hand velocity zone
Z axis = current activity layer
```

A punch updates only one hand axis:

```text
Left punch:
  changes X
  Y remains where the previous right punch left it
Right punch:
  changes Y
  X remains where the previous left punch left it
```

The activity layer changes according to recent punching:

```text
Z0 = resting or sparse
Z1 = steady
Z2 = active combination
Z3 = sprint/flurry
```

This creates a persistent coordinate:

```text
(left zone, right zone, activity layer)
```

Example:

```text
Left hand currently occupies velocity zone 2.
Right hand currently occupies velocity zone 5.
The user is throwing at flurry pace.
Cube coordinate:
(2, 5, 3)
```

The left and right axes determine the held notes. The Z axis controls harmonic
density, modulation, cloud turbulence, and optional generated chord tones.

This is preferable to making activity continuously change the primary pitch.
A held note should remain musically stable while effects evolve around it.

---

## 5. Six velocity zones per hand

Use six velocity zones because they map naturally to the six numbered punch
families and to a six-note scale lattice.

The zones should be calibrated independently for each tracker and hand.

```ts
export interface HandInstrumentCalibration {
  rawVelocityLow: number;
  rawVelocityHigh: number;
  rawAccelerationLow?: number;
  rawAccelerationHigh?: number;
  zoneBoundaries: readonly [
    number,
    number,
    number,
    number,
    number
  ];
}
```

A practical calibration session is:

```text
10 comfortable punches per hand
10 medium punches per hand
10 hard punches per hand
```

Use robust percentiles rather than the absolute minimum and maximum:

```text
low anchor  = approximately 10th–15th percentile
high anchor = approximately 90th–95th percentile
```

Normalize:

```ts
function normalize(
  value: number,
  low: number,
  high: number,
): number {
  const denominator =
    Math.max(0.001, high - low);
  const linear =
    Math.max(
      0,
      Math.min(
        1,
        (value - low) / denominator,
      ),
    );
  return linear * linear * (3 - 2 * linear);
}
```

Quantize:

```ts
function velocityZone(
  velocity01: number,
): 0 | 1 | 2 | 3 | 4 | 5 {
  return Math.min(
    5,
    Math.floor(velocity01 * 6),
  ) as 0 | 1 | 2 | 3 | 4 | 5;
}
```

Use hysteresis so a boxer repeatedly landing close to a boundary does not
flicker between two notes:

```text
A zone change must cross the boundary
by an additional 3–5% before it commits.
```

The visual cube should show the zone boundaries during calibration.

---

## 6. First musical scale

Begin with a minor pentatonic scale plus the octave:

```text
D
F
G
A
C
D
```

That produces six zones and generally tolerates arbitrary two-hand
combinations better than a seven-note major scale.

### Left-hand plane

```text
Zone 0 → D2
Zone 1 → F2
Zone 2 → G2
Zone 3 → A2
Zone 4 → C3
Zone 5 → D3
```

### Right-hand plane

```text
Zone 0 → D4
Zone 1 → F4
Zone 2 → G4
Zone 3 → A4
Zone 4 → C5
Zone 5 → D5
```

This provides a clearly audible register separation:

```text
Left tracker  = low voice
Right tracker = high voice
```

The user can choose the basis:

```text
Physical-hand mode:
  left tracker always controls low voice
  right tracker always controls high voice
Stance-relative mode:
  lead hand controls low voice
  rear hand controls high voice
```

Physical-hand mode should be the default because the auditory relationship
remains stable when stance changes.

---

## 7. Harmonic locking options

Independent scale zones are expressive, but some combinations will be more
tense than others. Offer three harmony modes.

### Free Scale

Each hand selects its exact scale-zone note.

```text
Left and right voices are independent.
```

This is the most instrument-like mode.

### Harmonic Lock

The left voice acts as the harmonic anchor.
The right punch requests a scale zone, but the mapper chooses the closest
note that forms an allowed interval above the current left note:

```text
minor third
major third
perfect fourth
perfect fifth
minor sixth
major sixth
octave
```

This makes almost every two-hand state intentionally consonant.

### Interval Lock

The right voice maintains a selected interval relative to the left:

```text
octave
fifth
third
sixth
```

A left-hand pitch change bends both voices together. A right-hand punch
changes the selected interval or upper inversion.

This is the simplest mode for an immediately musical demonstration.

---

## 8. Sample-and-hold note behavior

Each hand owns one monophonic latched voice:

```ts
export interface LatchedVoiceState {
  hand: "left" | "right";
  midiChannel: number;
  currentZone: number | null;
  currentNote: number | null;
  noteOn: boolean;
  lastPunchAtMs: number | null;
  lastVelocity01: number;
}
```

### First punch from a hand

```text
Send Note On.
Hold the note indefinitely.
Illuminate the corresponding cube axis.
```

### New zone from the same hand

```text
Transition from the old note to the new note.
Do not create a growing stack of held notes.
```

### Same zone from the same hand

```text
Keep the pitch.
Retrigger the transient/envelope.
Increase the visual cloud.
```

### Punch from the opposite hand

```text
Leave the first hand's note held.
Update the opposite voice.
The two notes form a dyad.
```

### Session stop or connection loss

```text
Send Note Off for all active voices.
Center pitch bend.
Send All Notes Off.
Clear the visual latch state.
```

A watchdog should also release notes when the PC bridge loses its heartbeat.

---

## 9. Transition logic

A new note should rarely jump abruptly unless the selected instrument mode is
percussive.

Use an elastic musical transition:

```text
small note change + slow punching
  → slow expressive glide
large note change + slow punching
  → longer bend
fast flurry
  → short, tight transition
same note
  → no pitch bend; retrigger only
```

Example:

```ts
function transitionDurationMs(
  zoneDistance: number,
  punchRate01: number,
): number {
  const distanceContribution =
    zoneDistance * 30;
  const slowPlayingContribution =
    (1 - punchRate01) * 145;
  return Math.round(
    Math.max(
      35,
      Math.min(
        320,
        45
          + distanceContribution
          + slowPlayingContribution,
      ),
    ),
  );
}
```

Suggested behavior:

| Condition             | Transition         |
| --------------------- | ------------------ |
| Same zone             | Envelope retrigger |
| Adjacent zone, flurry | 35–70 ms           |
| Adjacent zone, sparse | 120–180 ms         |
| Three-zone jump       | 150–260 ms         |
| Maximum jump          | 220–320 ms         |

Use the same transition duration for:

```text
MIDI pitch movement
cube cursor movement
visual transition ribbon
cloud displacement
```

### Small pitch overshoot

A hard strike can overshoot the target by approximately 5–15 cents before
settling. That creates an elastic impact sensation without making the melody
noticeably out of tune.

```text
Soft strike:
  no overshoot
Medium strike:
  4–7 cents
Hard strike:
  8–12 cents
Peak strike:
  up to 15 cents
```

The pitch should settle quickly to the exact scale note.

---

## 10. MIDI implementation

Start with ordinary MIDI 1.0 using one channel per hand.

```text
Channel 2 = left sustained voice
Channel 3 = right sustained voice
Channel 10 = punch transient/percussion layer
```

Recommended controller mapping:

| Musical value        | MIDI output                    |
| -------------------- | ------------------------------ |
| Pitch zone           | Note number                    |
| Acceleration         | Note velocity                  |
| Velocity within zone | CC74 or fine pitch bend        |
| Recent punch rate    | Mod wheel/CC1                  |
| Sustained activity   | Expression/CC11 or effect send |
| Left/right           | Channel and pan                |
| Transition           | Pitch bend or synth portamento |
| Peak strike          | Accent note or octave layer    |

A two-channel design is sufficient for independently bent left and right
voices. MPE becomes useful later when either hand can hold several
simultaneous notes or when each note needs independent pressure, pitch, and
timbre.

Studio One can be configured to receive the bridge as a keyboard-style MIDI
input. Its device setup also exposes MPE and pitch-range configuration, which
is useful when the instrument graduates from conventional channel-per-hand
operation to MPE. ([PreSonus Support][1])

### Preferred Studio One track layout

```text
Track 1 — Left Hand Synth
  Input: PunchBridge channel 2
  Monophonic or legato patch
  Lower register
  Slight left pan
Track 2 — Right Hand Synth
  Input: PunchBridge channel 3
  Matching or complementary patch
  Upper register
  Slight right pan
Track 3 — Punch Transient
  Input: PunchBridge channel 10
  Drum, impact, metallic, or sampled hit layer
Track 4 — Optional Harmonic Layer
  Generated from activity Z-axis
  Chord extension, shimmer, or sub voice
```

A Toontrack instrument can serve as the punch-transient layer, while a
sustained synthesizer handles the latched notes. Toontrack documents loading
its instruments as plug-ins inside Studio One. ([Toontrack][2])

---

## 11. PC companion application

Create a small desktop service named provisionally:

```text
PunchBridge
```

A TypeScript/Node implementation matches the rest of the application stack.

Responsibilities:

```text
Accept WebSocket connection from the tablet
Validate map version and session identity
Receive CompiledPunchGesture messages
Maintain left/right MIDI voice state
Generate Note On, Note Off, pitch bend, and CC messages
Expose connection and latency diagnostics
Send acknowledgments to the tablet
Issue All Notes Off on disconnect
```

### Network message

```ts
export interface PunchBridgeMessage {
  type: "punch-gesture";
  schemaVersion: 1;
  sessionId: string;
  sequence: number;
  mapHash: string;
  sentAtMonotonicMs: number;
  gesture: CompiledPunchGesture;
}
```

### Acknowledgment

```ts
export interface PunchBridgeAck {
  type: "gesture-ack";
  sessionId: string;
  sequence: number;
  receivedAtPcMs: number;
  midiDispatchedAtPcMs: number;
}
```

The app can estimate network and bridge delay from the acknowledgments.

Use WebSocket first. The event frequency is low, implementation is
straightforward, and reliability is more important than shaving a small
amount of protocol overhead.

The bridge should abstract the MIDI output:

```ts
export interface MidiOutputBackend {
  open(): Promise<void>;
  send(bytes: readonly number[]): void;
  allNotesOff(): void;
  close(): void;
}
```

Possible implementations include:

```text
Existing virtual MIDI loopback port
Windows MIDI Services loopback
Direct hardware MIDI output
Future VST3-native bridge
```

The current Windows MIDI stack is in active transition and Microsoft's MIDI
Services releases now include MIDI loopback tooling, while also documenting
evolving compatibility and preview components. Keep the MIDI backend
replaceable instead of binding the module permanently to one virtual-port
product. ([GitHub][3])

A conventional loopback product such as loopMIDI is specifically designed to
connect MIDI applications on Windows, but its official compatibility page
still lists Windows 7 through 10. It is a reasonable local prototype
candidate only after verifying it on this particular Windows 11
installation. ([Tobias Erichsen][4])

---

## 12. Guided twelve-strike articulations

In Guided Instrument mode, the expected workout token can shape the sound.
The token should alter articulation, not replace the velocity-zone pitch
system.

| Token family | Musical articulation                         |
| ------------ | -------------------------------------------- |
| `1`, `2`     | Immediate clean attack                       |
| `1B`, `2B`   | Darker attack with sub layer                 |
| `3`, `4`     | Lateral sweep or stereo arc                  |
| `3B`, `4B`   | Darker sweep with short low transient        |
| `5`, `6`     | Rising scoop into the target note            |
| `5B`, `6B`   | Lower, heavier scoop with reduced brightness |

### Straights

```text
Fast attack
Minimal pitch ornament
Narrow stereo movement
Clear rhythmic definition
```

### Hooks

```text
Curved filter movement
Short stereo sweep toward the punch hand
Slightly wider transient
```

### Uppercuts

```text
Brief upward pitch or filter scoop
Vertical visual cloud movement
Longer attack contour
```

### Body variations

```text
Main held note remains harmonically stable
Add one-octave-lower transient or subharmonic
Reduce filter brightness
Paint the lower visual quadrant
```

Do not map body shots to a completely unrelated pitch set. The user should
perceive them as lower, heavier versions of the same musical language.

---

## 13. Free-mode use of `punchTypeRaw`

Until the type-code capture campaign produces a reliable per-device model, do
not name raw codes as punch techniques.

It can still be used experimentally as a **texture selector**:

```text
raw type 0 → texture A
raw type 1 → texture B
raw type 2 → texture C
...
```

The interface should label this:

```text
Tracker Texture
```

not:

```text
Detected Punch Type
```

The effect may be musically useful even when its biomechanical meaning
remains unknown.

A future classifier can use:

```text
device ID
raw type
raw velocity
raw acceleration
hand
inter-punch interval
guided expected token
```

but should expose confidence and fall back to generic articulation when
uncertain.

The GPU can help train or explore such a classifier after a substantial
labeled corpus exists. It cannot recreate continuous motion data the firmware
never transmitted.

---

## 14. Handling acceleration

Promote `accelerationRaw` into the live punch event before building the
instrument.

```ts
export interface TrackerPunchEvent {
  // existing fields...
  accelerationRaw?: number;
}
```

Normalize it independently per tracker:

```text
Acceleration should not be treated as verified physical g-force
until its scale has been validated.
Use calibrated percentile units first.
```

Recommended mapping:

```text
VelocityRaw:
  pitch coordinate
AccelerationRaw:
  note attack
  brightness
  transient loudness
  cloud opacity
Punch rate:
  modulation and harmonic density
```

This produces three distinct forms of expression rather than forcing one
sensor byte to control everything.

---

## 15. Event timing and late data

### Live events

Trigger the musical gesture as soon as the decoded event reaches the
application.

Use tracker timestamps for:

```text
ordering
inter-punch interval
alternation detection
flurry detection
```

Use arrival time for:

```text
immediate audio dispatch
network diagnostics
visual response
```

### Recovered events

When:

```ts
event.recovered === true
```

do not play them as current notes.

Options:

```text
Store normally
Display as a faint historical ghost
Use them in an after-session replay
Exclude them from live sound
```

A punch received 20 seconds late must not suddenly move the instrument.

### Two records in one BLE frame

Sort by tracker timestamp.

For live performance:

```text
Play the first event immediately.
Schedule the second using its relative tracker-time gap,
but cap that reconstruction delay to a small range.
```

Suggested cap:

```text
minimum reconstructed gap: 20 ms
maximum reconstructed gap: 100 ms
```

This preserves the sense of a double without making already-late sound
substantially later.

Record the original tracker separation for diagnostics.

---

## 16. Visual design

### Persistent cube cursor

The cube shows:

```text
Current left velocity zone
Current right velocity zone
Current activity layer
Current two-note harmonic state
```

The active cell remains illuminated until the state changes.

A left punch moves the cursor along the X axis.
A right punch moves it along the Y axis.
Punch-rate activity moves the perceived depth or illuminates a deeper Z
layer.

### Quadrant cloud painting

Use four visual quadrants.

In Guided Instrument mode:

```text
Upper-left  = left-hand head strike
Lower-left  = left-hand body strike
Upper-right = right-hand head strike
Lower-right = right-hand body strike
```

In Free Instrument mode, where head/body is not known:

```text
Upper-left  = harder left strikes
Lower-left  = lighter left strikes
Upper-right = harder right strikes
Lower-right = lighter right strikes
```

A punch paints a cloud with:

| Signal                 | Visual property            |
| ---------------------- | -------------------------- |
| Scale degree           | Hue                        |
| Hand                   | Horizontal quadrant        |
| Body/head or intensity | Vertical quadrant          |
| Velocity               | Radius and displacement    |
| Acceleration           | Opacity and brightness     |
| Punch rate             | Turbulence and persistence |
| Alternation            | Center convergence         |
| Note transition        | Ribbon between cube cells  |

The cloud should persist for several seconds and gradually thin.

A held note remains visible as:

```text
glowing cube coordinate
slowly breathing halo
persistent hand-colored anchor
```

A pitch transition draws a curved or elastic ribbon from the old coordinate
to the new one. The ribbon duration is the same `transitionDurationMs` used
by MIDI.

### Color model

Assign one hue to each of the six scale zones:

```text
Zone 0 → deep cyan
Zone 1 → blue
Zone 2 → violet
Zone 3 → magenta
Zone 4 → amber
Zone 5 → white-gold
```

Left and right can vary the hue slightly:

```text
left  = cooler variant
right = warmer variant
```

This makes pitch changes visible even when the user does not understand the
note names.

---

## 17. Activity and harmonic density

Recent punch rate should control the Z axis and musical complexity.

```ts
export type ActivityLayer =
  | 0
  | 1
  | 2
  | 3;
```

Example mapping:

| Layer | Recent activity | Musical result                              |
| ----: | --------------- | ------------------------------------------- |
|     0 | Sparse/resting  | Two dry held voices                         |
|     1 | Steady          | Add subtle chorus or delay                  |
|     2 | Combination     | Add fifth or octave reinforcement           |
|     3 | Sprint          | Add shimmer, arpeggiator, or harmonic cloud |

The Z layer should rise quickly and decay gradually:

```text
Punching builds musical density.
Rest strips the instrument back to the two held notes.
```

Do not continuously alter the root note as activity decays. Effects can
decay; the latched hand notes should remain fixed until another punch changes
them.

---

## 18. Haptic character

The trackers cannot currently provide return haptics.

The system can still create physical feedback through sound:

```text
Each punch triggers a short low-frequency transient.
Acceleration controls its amplitude.
Velocity controls its pitch or spectral weight.
```

With a subwoofer or tactile transducer, this becomes genuinely physical.

Recommended impact layer:

```text
30–60 ms attack transient
short low-frequency body
fast limiter
no long bass tail during flurries
```

Use strict limiting. A six-punch-per-second flurry can accumulate
low-frequency energy rapidly.

Optional tablet vibration can accompany events, but it is secondary because
the boxer is not holding the tablet.

---

## 19. Instrument modes

### Octave Hold

```text
Left hand controls lower octave.
Right hand controls upper octave.
Each hand holds its last velocity-zone note.
```

This is the recommended first mode.

### Harmonic Lock

```text
Left hand selects the root/anchor.
Right hand selects a compatible interval.
All combinations remain intentionally harmonized.
```

### Chord Forge

```text
Left hand changes chord root.
Right hand changes inversion or extension.
Punch rate adds chord density.
```

### Drum and Drone

```text
Each hand maintains one held drone.
Every punch also triggers a strong transient or drum voice.
```

This makes immediate use of Toontrack or other sampled percussion.

### Guided PunchScore

```text
The workout score supplies the 12-strike token.
Velocity selects pitch.
Strike family selects articulation.
Body/head selects visual quadrant and low-frequency layer.
```

### Velocity Theremin

This should be presented as:

```text
Sample-and-hold theremin
```

not a continuous theremin.

```text
Punch velocity samples the coordinate.
The note remains held.
The next punch bends to a new coordinate.
```

---

## 20. Recommended first playable preset

### Preset name

```text
Two-Handed Pentatonic
```

### Pitch layout

```text
Left:
D2 F2 G2 A2 C3 D3
Right:
D4 F4 G4 A4 C5 D5
```

### Sound behavior

```text
One sustained monophonic synth per hand
Soft attack, moderate release
Legato/portamento enabled
Left panned 15% left
Right panned 15% right
```

### Punch mapping

```text
velocityRaw normalized per hand
  → one of six pitch zones
accelerationRaw normalized per hand
  → MIDI velocity 40–127
  → filter brightness
same-hand new zone
  → 80–240 ms pitch transition
same-hand same zone
  → retrigger attack without changing pitch
opposite-hand punch
  → update the second held voice
alternating punches within 450 ms
  → increase central visual convergence
  → raise delay/reverb send
new peak velocity
  → add short octave shimmer
```

### Activity mapping

```text
0–1 punches/sec:
  dry two-note field
1–3 punches/sec:
  subtle delay and cloud movement
3–5 punches/sec:
  additional fifth/octave layer
5+ punches/sec:
  harmonic shimmer and dense visual cloud
```

This preset requires no punch-type classifier and should be musically legible
within the first prototype.

---

## 21. Example gesture

Assume:

```text
Current state:
  left zone 2 = G2
  right zone 3 = A4
New event:
  right hand
  velocity01 = 0.88
  acceleration01 = 0.72
  previous punch was left, 210 ms earlier
```

The compiled result might be:

```json
{
  "cube": {
    "leftZone": 2,
    "rightZone": 5,
    "activityLayer": 2,
    "changedAxis": "right",
    "targetCoordinate": [2, 5, 2]
  },
  "voice": {
    "voiceId": "right",
    "midiChannel": 3,
    "targetNote": 74,
    "noteVelocity": 103,
    "brightness": 92,
    "expression": 108,
    "transition": "glide",
    "transitionDurationMs": 84,
    "pitchOvershootCents": 10
  },
  "visual": {
    "quadrant": "upper-right",
    "hueDegrees": 48,
    "opacity": 0.82,
    "radius": 0.14,
    "persistenceMs": 4700,
    "transitionRibbonMs": 84
  }
}
```

The right synth glides from A4 to D5. The left G2 remains held. The cube
cursor moves from `(2, 3, 1)` to `(2, 5, 2)`. A warm cloud blooms in the
upper-right quadrant, and the alternating-hand event pulls both clouds toward
the center.

---

## 22. Recording and replay

Store every compiled musical gesture:

```ts
export interface RecordedInstrumentGesture {
  sessionId: string;
  sequence: number;
  trackerEventId: string;
  trackerTimestampMs?: number;
  mapHash: string;
  gesture: CompiledPunchGesture;
}
```

This enables:

```text
Exact session replay
MIDI export
Studio One recording
Visual replay
Mapping comparison
Calibration review
Performance sharing
```

The same punch session can later be replayed through a different sound preset
without reinterpreting the tracker protocol.

Store both:

```text
raw tracker event
compiled musical gesture
```

That lets future mapping revisions re-render old performances.

---

## 23. Reliability requirements

The instrument must never leave stuck notes.

Send an emergency release when:

```text
Workout or jam ends
BLE session stops
App backgrounds unexpectedly
PC bridge disconnects
WebSocket heartbeat fails
MIDI destination closes
Instrument preset changes
Map hash changes mid-session
```

Emergency MIDI sequence:

```text
Note Off for known active notes
Pitch bend center on active channels
CC 123 — All Notes Off
CC 120 — All Sound Off, optional emergency path
```

Do not trigger live sound for:

```text
recovered events
duplicate event IDs
malformed records
events from an obsolete connection generation
events from an inactive session
```

Use the tracker's punch-count characteristic as a diagnostic cross-check. A
counter discrepancy can report that notifications were lost, but the app
should not fabricate musical events for punches whose timing and velocity are
unknown.

---

## 24. Development phases

### Phase 1 — Event plumbing

```text
Promote accelerationRaw into TrackerPunchEvent
Add per-hand velocity normalization
Add per-hand acceleration normalization
Filter recovered events from live instrument output
Preserve two-record frame ordering
```

Deliverable:

```text
Effects Lab displays hand, raw velocity,
normalized velocity, acceleration, and punch interval.
```

### Phase 2 — Desktop bridge

```text
Create PunchBridge WebSocket server
Connect to one virtual MIDI destination
Send test Note On/Note Off messages
Add heartbeat and All Notes Off watchdog
Add mapHash validation
```

Deliverable:

```text
Tablet test button plays one Studio One synth note.
```

### Phase 3 — One-hand sample-and-hold

```text
Left tracker selects six notes
Last note remains held
Next punch changes the note
Same-zone punch retriggers the envelope
```

Deliverable:

```text
A boxer can play a stable six-note instrument
with one hand.
```

### Phase 4 — Two-hand octave instrument

```text
Left and right use separate channels
Each hand maintains its own held note
Opposite-hand strikes create a dyad
Transition curves are implemented
```

Deliverable:

```text
Two-hand Pentatonic preset.
```

### Phase 5 — Harmonic Cube

```text
Render 6 × 6 cube state
Add four activity layers
Add persistent coordinate glow
Add transition ribbons
```

Deliverable:

```text
Every audible state has an equivalent visible coordinate.
```

### Phase 6 — Cloud painting

```text
Paint hand-specific quadrants
Map note to hue
Map acceleration to opacity
Map velocity to radius
Map rate to persistence and turbulence
```

Deliverable:

```text
A complete performance leaves a temporary colored visual field.
```

### Phase 7 — Guided twelve-strike articulation

```text
Read expected strike token from CompiledWorkoutScore
Map straights, hooks, uppercuts, and body variants
Add guided PunchScore mode
```

Deliverable:

```text
Programmed punch combinations become melodic articulations.
```

### Phase 8 — Optional type-code research

```text
Capture labeled events
Train per-device classifier
Expose confidence
Fallback when uncertain
```

Deliverable:

```text
Experimental free-play articulation without overstating accuracy.
```

### Phase 9 — Studio performance system

```text
Save MIDI
Replay sessions
Add preset library
Add optional PC GPU visualization
Add multichannel recording template
```

---

## 25. Use of the RTX 5070 Ti

The GPU is not needed for the MIDI mapping or note-latch logic.

It becomes useful for:

```text
High-density volumetric cloud rendering
Large-screen 3D Harmonic Cube visualization
WebGPU particle fields
Session replay at high visual fidelity
Offline classifier experiments
Neural or spectral sound-design tooling
```

A practical split is:

```text
Tablet:
  Tracker connections
  Musical gesture authority
  Compact real-time visual
  Workout/jam controls
PC:
  Studio One synthesis
  MIDI bridge
  High-resolution optional visualization
  Recording and replay
```

The PC visualizer can consume the same `CompiledPunchGesture` WebSocket
messages as PunchBridge. It must not independently remap tracker values.

---

## 26. Acceptance criteria for the first instrument

The first playable build should satisfy all of these:

1. One live punch creates one musical gesture.
2. A recovered punch creates no live MIDI event.
3. Left and right hands control independent held voices.
4. A note remains held until its owning hand punches again or the session
   ends.
5. Repeating the same velocity zone retriggers the sound without creating a
   stuck duplicate note.
6. Moving to another zone produces a bounded, smooth transition.
7. Harder punches create stronger attacks without changing calibration
   unpredictably.
8. The cube coordinate and MIDI target originate from the same compiled
   gesture.
9. Visual transition duration matches musical glide duration.
10. A network or BLE disconnect clears all active notes.
11. Numeric and guided strike semantics do not depend on the provisional raw
    type code.
12. The same recorded event stream replays deterministically under the same
    map hash.
13. The PC bridge and tablet report the same session ID, sequence, and map
    hash.
14. A two-hand alternating flurry increases harmonic density and visual
    turbulence without generating an uncontrolled pile of sustained notes.
15. Studio One can record the resulting MIDI performance as an ordinary
    instrument performance.

---

## Recommended first milestone

Build only this path initially:

```text
FightCamp event
    ↓
velocityRaw per-hand normalization
    ↓
six-zone pitch selection
    ↓
left/right latched voice state
    ↓
WebSocket semantic gesture
    ↓
PunchBridge
    ↓
MIDI channels 2 and 3
    ↓
two Studio One synth tracks
```

Use the Two-Handed Pentatonic preset and omit type recognition, guided
articulations, cloud simulation, and MPE until the note latch feels immediate
and musically predictable.

The decisive test is:

> A left punch selects and holds a low note. A right punch adds and holds a
> high note. Each later punch changes only its hand's voice through a short
> elastic bend, while the same persistent coordinate appears in the Harmonic
> Cube. A fast alternating combination produces a coherent changing harmony
> rather than a burst of disconnected notes.

[1]: https://support.presonus.com/hc/en-us/articles/8851104081933-Studio-One-6-How-Do-I-Setup-a-MIDI-Hardware-Keyboard-Synthesizer "Studio One 6: How Do I Setup a MIDI Hardware Keyboard/Synthesizer"
[2]: https://www.toontrack.com/faq/how-do-i-add-my-toontrack-product-as-a-plug-in-in-studio-one/ "How do I add my Toontrack product as a plug-in in Studio One"
[3]: https://github.com/microsoft/MIDI/releases "Releases · microsoft/MIDI"
[4]: https://www.tobias-erichsen.de/software/loopmidi.html "loopMIDI"
