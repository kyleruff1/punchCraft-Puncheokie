<!--
PROVENANCE. Kyle authored this design in chat on 2026-09-06. Sections 1-18
below are his text VERBATIM. Sections 19-35 existed in the original message
but were lost to context truncation; their operative rules survive in the
approved implementation plan and are restated in "19-35 (reconstructed)" at
the end. If Kyle still has the original, replace that section with his text.

This file is the source of truth for the drum mode. The domain code cites it
by section number.
-->

PunchEoke Superior Drummer 3 Punch Kit — Detailed Design Plan

1. Product concept

PunchEoke Drum Kit should make the boxer feel as though the bag is a distributed drum kit without reducing the instrument to twelve unrelated sample triggers.

The central musical metaphor is:

JABS       = TIMEKEEPER
             ride cymbal pulse

CROSSES    = BACKBEAT
             strong snare articulation

HOOKS      = MOVEMENT
             rack toms + arpeggiator direction

UPPERCUTS  = FILL AND LIFT
             floor toms + rising musical motion

BODY SHOTS = LOW-END WEIGHT
             kick reinforcement + lower/darker articulation

This division is intuitive because each punch family occupies a distinct musical role:

- Jabs establish time.
- Crosses punctuate the backbeat.
- Hooks move laterally through the kit and redirect the arpeggio.
- Uppercuts travel through the low toms and create fills.
- The "B" suffix adds a low-frequency kick layer without redefining the strike family.

The instrument should have two simultaneous response layers:

Immediate punch layer
  Every accepted punch produces an immediate drum response.

Persistent song layer
  Punch activity alters the groove, arpeggiator, fills,
  and arrangement on musical boundaries.

The immediate layer supplies physical causality. The persistent layer prevents the result from sounding like unrelated drum samples.

Superior Drummer 3 is appropriate for this because it includes extensively sampled acoustic and electronic drums, detailed articulations, velocity-oriented e-drum behavior, a large MIDI library, a grid editor, quantize and swing tools, user-sample import, multi-output routing, and an internal mixer with effects.

---

2. Architectural rule

The drum system must follow the existing single-mapping architecture:

TrackerPunchEvent
        ↓
StrikeIdentity
        ↓
compileDrumGesture()
        ↓
CompiledDrumGesture
        ├── immediate SD3 hits
        ├── body/kick layers
        ├── arpeggiator mutation
        ├── groove intent
        ├── fill intent
        └── visual response

Do not implement separate mapping logic inside:

PunchBridge
Studio One
Superior Drummer
the tablet visualizer
the workout runner

Those components may perform the compiled gesture, but they must not reinterpret what the punch means.

The domain layer should output logical articulations such as:

ride-bow
snare-rimshot
rack-tom-high
floor-tom-low
kick-main

A separate Superior Drummer mapping profile resolves those logical IDs into the MIDI note numbers required by the active SD3 kit.

This keeps the strike logic independent of:

- The loaded SD3 library.
- The selected kit preset.
- Custom MIDI remapping.
- MIDI-note differences between drum products.
- Future replacement of Superior Drummer with another drum sampler.

---

3. Strike-identity limitations

The full twelve-strike drum mapping is authoritative only when the application has a trustworthy strike identity.

Guided mode

The compiled workout score supplies the expected token:

1, 1B, 2, 2B, 3, 3B, 4, 4B, 5, 5B, 6, 6B

Guided mode may use the complete mapping.

Classified free-jam mode

A future validated classifier may identify:

straight
hook
uppercut
body/head

The full mapping is applied only when confidence passes the configured threshold.

Generic free-jam mode

Until tracker type semantics are validated, Free Jam must not claim that a raw type byte represents a jab, hook, or uppercut.

A safe temporary mapping is:

Physical left punch:
  configurable left drum articulation

Physical right punch:
  configurable right drum articulation

Velocity:
  articulation intensity

Acceleration:
  MIDI velocity

Punch rate:
  groove energy

The UI should identify this as a Two-Piece Free Kit, not as technique recognition.

export interface StrikeIdentity {
  source:
    | "guided-score"
    | "device-classifier"
    | "manual-audition"
    | "generic";

  token?: StrikeToken;

  family?:
    | "jab"
    | "cross"
    | "hook"
    | "uppercut";

  target?: "head" | "body";

  confidence: number;
}

Recommended policy:

guided-score:
  use exact token

classifier confidence ≥ 0.80:
  use full classified family

classifier confidence 0.55–0.79:
  use broad family contour only

classifier confidence < 0.55:
  use generic hand response

---

4. Core kit roles

Use one coherent acoustic-kit layout.

Ride cymbal
  Jabs

Snare
  Crosses

High and middle rack toms
  Hooks

High and low floor toms
  Uppercuts

Kick
  Body-shot reinforcement

Crash
  Phrase punctuation and genuine peak events only

Closed hi-hat or shaker
  Generated groove backbone

The crash should not represent an ordinary punch family. It should remain rare enough to feel consequential.

Good crash triggers include:

- A new session peak.
- The final strike of a completed eight-hit phrase.
- A bar-ending high-velocity "6".
- Entry into the "peak" arrangement scene.
- An explicitly authored guided-workout climax.

Recommended crash cooldown:

Minimum:
2 complete bars

Exception:
explicit authored ceremony or workout ending

---

5. Detailed twelve-strike mapping

5.1 Default mapping table

Token| Boxing meaning| Primary SD3 articulation| Additional body layer| Arpeggiator effect| Groove role
"1"| Lead jab| Ride bow| None| Advance one legal tone| Timekeeper
"1B"| Lead body jab| Ride bell| Kick| Lower entry, then advance| Timekeeper + low end
"2"| Rear cross| Snare center or rimshot| None| Skip and land on power anchor| Backbeat
"2B"| Rear body cross| Lower/darker snare hit| Kick| Lower power-anchor landing| Backbeat + low end
"3"| Lead hook| High rack tom| None| Reverse/arc left| Lateral movement
"3B"| Lead body hook| High rack tom| Kick| Lower reverse arc| Lateral movement + low end
"4"| Rear hook| Mid rack tom| None| Rotate/arc right| Lateral movement
"4B"| Rear body hook| Mid rack tom| Kick| Lower mirrored arc| Lateral movement + low end
"5"| Lead uppercut| High floor tom| None| Rise two steps| Fill/lift
"5B"| Lead body uppercut| High floor tom| Kick| Rise from lower inversion| Fill/lift + low end
"6"| Rear uppercut| Low floor tom| None| Rise and land on upper anchor| Fill/landing
"6B"| Rear body uppercut| Low floor tom| Kick| Heavy lower rise and landing| Fill/landing + low end

5.2 Why the body modifier adds kick

The "B" suffix should behave consistently:

Main strike family:
unchanged

Main articulation:
retained or changed to a darker variant

Low-frequency layer:
kick added

Melodic treatment:
one octave lower or lower inversion

Filter treatment:
darker

Visual response:
lower-screen compression

This makes body shots immediately recognizable without inventing twelve unrelated musical concepts.

A body-heavy combination can create too many kick triggers, so kick intents must pass through a merge policy described later.

---

6. Logical articulation catalog

Do not put SD3 note numbers in the strike catalog.

export type LogicalDrumArticulation =
  | "ride-bow"
  | "ride-bell"
  | "ride-tight"
  | "snare-center"
  | "snare-rimshot"
  | "snare-body"
  | "rack-tom-high"
  | "rack-tom-mid"
  | "floor-tom-high"
  | "floor-tom-low"
  | "kick-main"
  | "kick-sub"
  | "hihat-closed"
  | "hihat-open"
  | "crash-main"
  | "rim-click";

Each strike signature refers to those IDs:

export interface StrikeDrumSignature {
  token: StrikeToken;

  family:
    | "jab"
    | "cross"
    | "hook"
    | "uppercut";

  primary: {
    normal: LogicalDrumArticulation;
    accent?: LogicalDrumArticulation;
    peak?: LogicalDrumArticulation;
  };

  layers: readonly {
    articulation: LogicalDrumArticulation;
    condition:
      | "always"
      | "body"
      | "high-velocity"
      | "new-peak"
      | "phrase-ending";
    velocityMultiplier: number;
  }[];

  arpMutation:
    | "advance"
    | "power-land"
    | "reverse-left"
    | "arc-right"
    | "rise-left"
    | "rise-right";

  grooveRole:
    | "timekeeper"
    | "backbeat"
    | "movement"
    | "fill";

  timingPolicy:
    | "immediate"
    | "soft-grid"
    | "grid";
}

---

7. Superior Drummer mapping profile

Superior Drummer permits custom MIDI input mapping, and Toontrack’s own technical guidance distinguishes between global input remapping in Settings → MIDI In/E-drums and kit/preset-specific mapping in the Drums property controls. Save a dedicated mapping preset rather than assuming the factory MIDI notes remain unchanged.

export interface Sd3MappingProfile {
  schemaVersion: 1;

  profileId: string;
  profileHash: string;

  libraryName: string;
  kitPresetName: string;
  sd3MappingPresetName: string;

  midiChannel: number;

  articulations: Readonly<
    Partial<
      Record<
        LogicalDrumArticulation,
        {
          note: number;

          required: boolean;

          group:
            | "kick"
            | "snare"
            | "rack-tom"
            | "floor-tom"
            | "cymbal"
            | "hat"
            | "percussion";

          chokeGroup?: string;
        }
      >
    >
  >;

  capabilities: {
    rideBow: boolean;
    rideBell: boolean;
    tightRide: boolean;
    snareRimshot: boolean;
    separateFloorToms: boolean;
    cymbalChoke: boolean;
    subKick: boolean;
  };
}

Mapping-profile setup procedure

1. Open the Studio One PunchEoke template.
2. Load the desired Superior Drummer kit.
3. Load or create the SD3 MIDI In/E-drums preset named:

PunchEoke Kit v1

4. Identify each desired articulation in SD3.
5. Record its incoming MIDI note in the PunchBridge profile.
6. Test each logical articulation from a bridge diagnostic screen.
7. Save the SD3 mapping preset.
8. Save the Studio One song template.
9. Hash the PunchBridge profile.
10. Include the profile hash in session diagnostics.

The app should never assume that “ride bow is MIDI note X.” The profile is the source of truth.

Mapping diagnostic

PunchBridge should provide:

TEST KICK
TEST SNARE CENTER
TEST SNARE RIMSHOT
TEST RACK TOM HIGH
TEST RACK TOM MID
TEST FLOOR TOM HIGH
TEST FLOOR TOM LOW
TEST RIDE BOW
TEST RIDE BELL
TEST CRASH

Each test should log:

logical articulation
resolved MIDI note
MIDI channel
velocity
profile ID
profile hash

---

8. Tracker values and musical responsibility

Keep causality simple.

Tracker-derived value| Primary musical responsibility
Exact strike token| Drum family and articulation
Physical/semantic hand| Kit side and stereo character
"accelerationRaw" normalized| MIDI hit velocity
"velocityRaw" normalized| Accent selection and expression strength
Punch rate| Groove/arrangement energy
Alternation| Stereo movement and groove openness
Body suffix| Kick layer and darker/lower treatment
New peak| Rare crash or peak accent
Recovered event| No live drum output

Use normalized acceleration for the sampled drum’s MIDI velocity because it most closely represents impact intensity within the available event data.

Use normalized hand velocity for:

- Choosing normal versus accented articulation.
- Arpeggiator mutation strength.
- Filter and room modulation.
- Body-layer strength.
- Fill length.
- Peak eligibility.

Do not make one raw byte control every musical property.

---

9. MIDI velocity curves

Use family-specific velocity floors so the musical role stays clear.

function mapDrumVelocity(
  acceleration01: number,
  minimum: number,
  maximum: number,
  gamma = 0.72,
): number {
  const normalized = Math.max(
    0,
    Math.min(1, acceleration01),
  );

  return Math.round(
    minimum
      + (maximum - minimum)
        * Math.pow(normalized, gamma),
  );
}

Suggested starting ranges:

Articulation family| MIDI velocity
Ride jab| 42–104
Snare cross| 80–127
Rack-tom hook| 62–119
Floor-tom uppercut| 75–127
Body kick layer| 64–123
Crash peak| 100–127
Generated ghost note| 18–45

Accent selection

Velocity01 < 0.65:
normal articulation

Velocity01 0.65–0.84:
accent articulation

Velocity01 ≥ 0.85:
peak-capable articulation

Examples:

Jab:
normal → ride bow
accent → stronger ride bow
peak → ride bell

Cross:
normal → snare center
accent → hard center
peak → rimshot

Hook:
normal → rack tom center
peak → stronger tom or optional tom-rim stack

Uppercut:
normal → floor tom
peak → layered floor tom

A crash remains subject to its independent cooldown even when velocity is high.

MIDI note duration

The MIDI gate sent to SD3 can remain short:

25–40 ms

Superior Drummer supplies the acoustic sample tail. Do not confuse MIDI note length with the audible cymbal or tom decay.

---

10. Timing architecture

The drum instrument needs four timing scales.

Punch arrival
  Immediate physical response

Next arpeggiator step
  Small strike-specific melodic mutation

Harmonic/groove commit boundary
  Persistent groove or harmony update

Bar boundary
  Arrangement scene, fill, and kit-density update

All four must derive from the same PunchBridge transport.

Transport:
960 ticks per 60 BPM master pulse

Quarter pulse:
240 ticks / 250 ms

Half pulse:
480 ticks / 500 ms

Full pulse:
960 ticks / 1,000 ms

4/4 bar:
3,840 ticks / 4,000 ms at 60 BPM

Do not create a separate Superior Drummer clock.

Studio One and SD3 are the performance and mixing backend. PunchBridge remains the semantic and exact-event scheduler whenever the tablet must display deterministic projected events.

---

11. Direct-hit timing modes

Immediate

Punch arrives
→ send MIDI immediately

Best for:

- Free Kit.
- Latency testing.
- Maximum physical responsiveness.

Soft Grid — recommended

The bridge considers the next valid drum subdivision.

function resolveSoftGridTime(
  nowMs: number,
  nextBoundaryMs: number,
  maximumWaitMs: number,
): number {
  const waitMs =
    nextBoundaryMs - nowMs;

  if (
    waitMs >= 0
    && waitMs <= maximumWaitMs
  ) {
    return nextBoundaryMs;
  }

  return nowMs;
}

Recommended maximum wait:

45 ms

Behavior:

Punch just before a grid point:
hold briefly and land exactly on it.

Punch well away from a grid point:
play immediately.

Punch arrives after the intended boundary:
play immediately; never wait for a full later beat.

Full Grid

Every hit moves to the next selected subdivision.

Use only for:

- Deliberate composition mode.
- Demonstrations.
- Guided score playback.
- A user who explicitly prefers stronger quantization.

Do not make full quantization the default because a 250 ms worst-case wait would make a punch instrument feel disconnected.

---

12. One direct layer and one groove layer

Direct layer

Every accepted live punch can produce:

- One primary drum articulation.
- Zero or one body kick layer.
- One immediate melodic stab.
- One transient visual.
- One short arpeggiator mutation.

Groove layer

The groove layer continues between punches and is modified only on legal musical boundaries.

It may include:

- Closed hi-hat or shaker.
- Sparse kick support.
- Low-velocity ghost snare.
- Occasional tom pickup.
- Bar-boundary fill.
- Phrase-boundary crash.

The groove should not continuously duplicate the direct ride and snare strikes. The athlete’s punches remain the foreground performance.

---

13. Arrangement scenes

Use the existing arrangement authority:

export type ArrangementScene =
  | "pocket"
  | "groove"
  | "drive"
  | "peak";

Pocket

Generated layer:
sparse closed hat
minimal kick
no automatic strong snare
no automatic ride

Punch layer:
fully exposed

Arp:
3-step depth
60 notes/minute

Groove

Generated layer:
closed-hat eighths
light kick framework
very low ghost snare if no cross supplies the backbeat

Arp:
4-step depth
120 notes/minute

Drive

Generated layer:
denser hats
syncopated kick support
occasional low ghost-snare reinforcement
small tom pickup

Arp:
6-step depth
180 notes/minute

Peak

Generated layer:
driving hats
stronger kick
phrase-ending fills
rare bar-boundary crash

Arp:
8-step depth
240 notes/minute

Scene transitions must remain:

bar-quantized
at most one scene upward per bar
at most one scene downward per one or two bars

Immediate punch hits continue regardless of scene.

---

14. Family activity envelopes

Maintain separate short-lived activity values:

export interface DrumFamilyEnergy {
  jab: number;
  cross: number;
  hook: number;
  uppercut: number;
  body: number;
}

On a punch:

familyEnergy[selectedFamily] =
  Math.min(
    1,
    familyEnergy[selectedFamily]
      + 0.12
      + velocity01 * 0.20,
  );

if (target === "body") {
  familyEnergy.body =
    Math.min(
      1,
      familyEnergy.body
        + 0.12
        + velocity01 * 0.18,
    );
}

Decay:

Jab:       approximately 1.2 seconds
Cross:     approximately 1.5 seconds
Hook:      approximately 2.0 seconds
Uppercut:  approximately 2.4 seconds
Body:      approximately 1.8 seconds

At bar boundaries, those values influence the arrangement:

High jab energy:
stronger timekeeper lane

High cross energy:
stronger backbeat support

High hook energy:
tom movement and pendulum arp tendency

High uppercut energy:
tom-fill eligibility

High body energy:
kick density

They do not independently change chords.

---

15. Hooks as the groove and arpeggiator control

Hooks should be the family with the strongest influence on phrase direction.

Lead hook "3"

Immediate:

High rack tom
Lateral filter movement toward the lead side

Arpeggiator:

Reverse the next 2–3 steps
Rotate entry −1
Create a leftward arc

Persistent behavior:

Two or more lead hooks in one phrase:
request reverse-pendulum pattern

Rear hook "4"

Immediate:

Mid rack tom
Lateral filter movement toward the rear side

Arpeggiator:

Rotate entry +1
Move forward, then return
Create a rightward arc

Persistent behavior:

Two or more rear hooks in one phrase:
request forward pendulum

Hook combinations

3-4:
high-to-mid rack-tom sweep
forward pendulum
wider stereo movement

4-3:
mid-to-high rack-tom answer
reverse pendulum

3-2:
tom arc into snare landing

4-2:
rear-side tom arc into strong snare

3-4-3-2:
tom pendulum followed by backbeat resolution

Hooks should not change the chord simply because they occurred. They transform the melodic and rhythmic motion inside the current legal harmonic pool.

---

16. Uppercuts as tom fills

Uppercuts should produce a clear vertical/low-kit identity.

Lead uppercut "5"

High floor tom
Short upward arp movement
Left-side floor-tom visual

Rear uppercut "6"

Low floor tom
Stronger landing
Right-side floor-tom visual

Uppercut phrases

5-6:
high floor tom → low floor tom

6-5:
low floor tom → high floor tom answer

5-6-5-6:
four-part floor-tom fill

5-6-3-2:
floor-tom rise → rack-tom turn → snare landing

1-2-5-6:
ride/snare setup → two-tom finish

An uppercut-dominant phrase may schedule one generated tom fill at the next phrase or bar boundary.

Limits:

Maximum generated tom fill:
one per bar

Maximum fill length:
8 subdivisions

Ordinary uppercut:
no crash

Peak or phrase-ending uppercut:
crash eligible, subject to cooldown

---

17. Body-shot kick policy

Every guided "B" token creates a kick intent.

A body combination can produce several kick intents in rapid succession, so kicks need their own merger.

export interface KickIntent {
  sourceEventId: string;
  desiredTick: number;
  velocity: number;
  priority: number;
}

Merge kicks when they occur:

within 35 ms

or

inside the same 240-tick subdivision

Merged velocity:

function mergeKickVelocity(
  velocities: readonly number[],
): number {
  const strongest =
    Math.max(...velocities);

  const additionalEnergy =
    velocities
      .filter(value => value !== strongest)
      .reduce(
        (sum, value) =>
          sum + value * 0.16,
        0,
      );

  return Math.min(
    127,
    Math.round(
      strongest + additionalEnergy,
    ),
  );
}

Priority:

Direct body punch:
highest

Generated groove kick:
lower

Ghost or decorative kick:
lowest

A direct body kick replaces a generated kick close to the same tick rather than producing an accidental double trigger.

---

18. Ride-cymbal density control

Jab flurries can create excessive cymbal tail buildup.

---

## 19-35 (reconstructed — NOT Kyle's verbatim text)

Lost to truncation. These are the operative rules carried into the approved
plan; treat them as provisional and replace with the original when available.

- **19. Collision matrix** - two articulations landing in the same subdivision
  resolve by kit group; a direct hit always outranks a generated one.
- **21. Suppression** - a generated groove hit is suppressed when a direct hit
  of the same kit group lands close to the same tick.
- **22. `DrumPatternManifest`** - authored groove patterns, imported through
  the bridge.
- **23. Pattern set** - Pocket 01 / Groove 01 / Drive 01 / Peak 01, one per
  arrangement scene.
- **26. `CompiledDrumGesture`** - immediate hits, arp mutation, groove intent,
  fill intent, visual response (shape given in section 2).
- **27. `DrumEventQueue`** - soft-grid quantization, merging, cooldowns,
  stale-generation and duplicate-id rejection.
- **33. Blind ear test** - equal intensity, randomised tokens. Targets:
  jab-vs-cross >=90%, cross-vs-hook >=85%, hook-vs-uppercut >=85%,
  head-vs-body >=90%. Then rate tests at 1/2/4/6 punches per second listening
  for ride-tail overload, snare machine-gunning and kick duplication.
- **35. Decisive scenario** - `1-1-2-3-2-5-6-2B` end to end.
