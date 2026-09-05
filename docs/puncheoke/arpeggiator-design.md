# Puncheoke Arpeggiator — design (authoritative)

Kyle's design, 2026-09-05, verbatim below. This supersedes any earlier framing that
put the arpeggiator inside the DAW: the engine lives in PunchBridge (the stock
Studio One Note FX arpeggiator cannot change rate/pattern/density per punch from
MIDI input), the domain computes the chord pool deterministically, and Studio One
just receives the stepped notes.

## Architectural rulings (orchestrator, binding on the implementation)

- Arp engine: PunchBridge stepper on the injectable `RampScheduler` (testable with
  the FakeScheduler, like the wah/bend ramps).
- Domain computes per punch (either hand): ordered pool notes, exposed count,
  travel mode, step interval, deterministic seed (`fnv1a(eventId)`), carried as an
  additive optional `arp` block on `CompiledPunchGesture`. Schema version stays 1;
  with voicing mode `latch` (default) the wire is byte-identical to before.
- Voicing modes on the patch: `latch` (today), `arp-anchor` (default arp),
  `arp-dyad`, `arp-interval` — semantics per Kyle's three modes below.
- Z ladder (final recommended version wins over the earlier sketch):
  exposed count `[2, 4, 5, 6]` by activity layer Z0..Z3; rates 60/120/180/240
  notes per minute at a 60 BPM master pulse (`arpPulseBpm` patch field); travel
  Z0 `up`, Z1/Z2 `ping-pong`, Z3 `random-walk`. Kyle's "up/down" and "pendulum"
  examples both reduce to ping-pong over their differently-sized pools.
- Bridge rendering in arp modes: LEFT channel keeps the single held-bass latch
  (glide/wah/ornament unchanged, now voiced by Mojito); RIGHT channel becomes the
  arp lane (Mai Tai) — steps overlap slightly (legato) so Mono+Glide glides
  between them, the per-punch wah still fires, a new punch swaps the pool
  seamlessly mid-pattern, panic stops the stepper.
- random-walk is a seeded LCG constrained to the exposed pool — reproducible.

## Studio One division of labor (applied 2026-09-05)

- Punch L (ch2): **Mojito** — held bass/root, Legato mode, Glide Time ~204 ms,
  no arpeggiation, pan L24.
- Punch R (ch3): **Mai Tai** — the arp lane: dual saw, Mono + Glide, Bend ±12,
  BP 12dB Ladder res 55%, Mod Wheel (CC1) → Filter Cutoff +63.6% (wah), pan R24.
- Template "Puncheoke Jam" carries this layout. No Note FX devices are used.
- Open item: Mojito's pitch-bend range is not confirmed at ±12, so the elastic
  ornament may read smaller on the bass; revisit with a per-voice bend range in
  the instrument profile if Kyle wants deeper bass dives.

---

## Kyle's design (verbatim)

If your default scale is D minor pentatonic:

D – F – G – A – C

then I would avoid conventional major/minor triads as the default arpeggiator
source. A lot of standard triads introduce notes outside that five-note set.

For this instrument, the more natural approach is to build open pentatonic
voicings from the two currently latched hand notes.

A good default rule is:

> Treat the lower held note as the anchor, then build the arpeggio from
> pentatonic notes above it using fourths, fifths, octaves, and selected thirds.

For example, if the left hand is holding D and the right hand is holding A,
generate:

D2 – A2 – D3 – F3 – A3

That gives you a D minor-ish suspended/power sound without locking you into a
traditional chord.

Some strong default chord shapes would be:

| Name | Notes in D | Character |
| --- | --- | --- |
| Dm7(no5) | D F C | Dark, open |
| Dm7 | D F A C | Familiar minor |
| Dsus4 | D G A | Open, athletic |
| D5 | D A | Very stable |
| D5 add ♭7 | D A C | Rock/blues |
| Dm11 shell | D F C G | Spacious |
| Pentatonic stack | D G C F A | Wide, ambiguous |
| Octave/fifth stack | D A D A | Powerful, minimal |

For PunchBridge, I would make the default arpeggiator chord generator use this
order:

ROOT, FIFTH, OCTAVE, MINOR THIRD, MINOR SEVENTH, FOURTH/11TH

So on D:

D – A – D – F – C – G

That pattern is difficult to make sound bad.

The arpeggiator does not need to play all six tones every time. Your activity
layer can decide how much of the structure is exposed:

- Low activity: D – A
- Steady: D – A – D
- Driving: D – A – D – F
- High activity: D – A – D – F – C
- Sprint: D – A – D – F – C – G

That would work especially well with the system you have already designed,
because punch rate controls harmonic density without changing the actual held
notes.

For oscillation, I would make the arpeggio travel differently according to
activity:

- Calm: up — D A D F
- Working: up/down — D A D F D A
- Driving: pendulum — D A F A D A F A
- Sprint: random-walk constrained to chord tones — D A C F A G C D...

Keep it constrained to the current chord pool rather than random MIDI notes.

A particularly effective default would be a 1/8-note arpeggiator synchronized to
your 60 BPM master pulse:

- 60 BPM master, 2 arp steps per pulse = 120 notes/minute = 500 ms per step

Then when the athlete gets more active:

- Z0: 1 note/beat = 60/min
- Z1: 2 notes/beat = 120/min
- Z2: triplets = 180/min
- Z3: 4 notes/beat = 240/min

That mirrors the exact rhythmic framework already used by your workout engine.

For two-hand interaction, I would use one of three chord-generation modes.

**Anchor mode** is the safest. The left hand defines the bass/root region, while
the right hand changes an upper chord tone. The arp fills remaining notes from
D minor pentatonic.

Example: Left = D, Right = C → Generated: D – A – C – F – G

**Dyad expansion** treats both held notes as mandatory chord tones and fills
around them.

Held: G + D → Expanded: G – D – F – A – C

**Interval mode** uses the distance between the two held notes to choose the
chord flavor:

- Unison/octave → power/open chord
- Minor third → minor 7 flavor
- Perfect fourth → suspended/11 flavor
- Perfect fifth → power/7 flavor
- Minor seventh → open dominant/minor color

That would make the physical relationship between punches audible.

For Mai Tai/Mojito, a strong starting setup would be:

- Mojito: holds the left-hand bass/root, no arpeggiator, slow glide
- Mai Tai: receives generated upper chord tones, arpeggiator enabled, moderate
  resonance, wah/filter modulation from acceleration

That avoids turning the bass into a busy sequence while still allowing the
right-hand voice to become animated.

My recommended default patch would therefore be:

- Key: D, Scale: D minor pentatonic
- Bass voice: left hand, single held note
- Arpeggio chord: D – A – D – F – C – G
- Arpeggiator: up/down
- Z0: D – A; Z1: D – A – D – F; Z2: D – A – D – F – C; Z3: D – A – D – F – C – G
- Rate: 60 / 120 / 180 / 240 notes per minute based on activity layer

That would give the instrument a very coherent identity: your punches select the
harmonic coordinates, while your punching intensity progressively wakes up the
arpeggiator around those coordinates.
