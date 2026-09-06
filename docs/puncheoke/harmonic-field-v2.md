# PunchEoke Harmonic Field v2 (authoritative)

Kyle's design, 2026-09-05, verbatim below. Successor to
`brass-cube-design.md`: the Brass Cube becomes the default WORLD inside one
harmonic field engine. The foundation slice (design §27 Phases 1–3 + the
commit grid §12 + the five-selection UI §1) is tracked as M40-16.

---

The current design is already musically coherent. The next step is not to add
more unrelated modes. It is to formalize one **harmonic field engine** that can
expose different amounts of freedom while keeping the same mapping pipeline.

The closest Kaossilator analogy is not a continuous XY pad, because the
trackers do not report continuous position. PunchEoke should behave as an
**event-latched Kaoss surface**:

```text
Current harmonic coordinate
          ↓
Punch produces a movement intent
          ↓
Movement is constrained by the selected rail
          ↓
A destination is previewed
          ↓
Destination commits on the rhythmic boundary
          ↓
Bass, brass arp, stab, drums, cube and clouds
all receive the same compiled gesture
```

The immediate punch stab and drum provide physical feedback at impact. The held
harmony and arpeggiator change on the grid. That combination should feel
responsive without sacrificing musical order.

## 1. Tighten the product around five selections

```text
WORLD      What key, mode and chord vocabulary exist?
FREEDOM    How many musical movements and pitch choices are available?
NAVIGATION How do punches move through the field?
PATTERN    How does the arpeggiator traverse the selected harmony?
SOUND      Which synth patch and tracker modulation routes are active?
```

Basic setup: WORLD Dorian Brass · FREEDOM Safe 3×3 · NAVIGATION Harmonic
Rails · PATTERN Punch Weave · SOUND Mai Tai Brass + Mojito Bass.

Advanced view: root key, mode, chord bank, left/right-axis resolution, harmony
guard, pattern retrigger behavior, commit grid, voice-leading behavior, four
virtual-patch routes. This is more understandable than listing fifteen highly
specific performance modes.

## 2. Preserve the single-mapping architecture

```text
InstrumentWorldManifest → compileHarmonicField() → CompiledHarmonicField
  → resolvePunchMovement() → CompiledPunchGesture
      ├── bass · brass arpeggio · stab · percussion
      └── cube coordinate · cloud response · telegraph display
```

Do not create independent logic for MIDI notes, cube destinations, pattern
transforms, cloud colors, or safe transitions — all fields on the same
compiled gesture. (v2 gesture sketch: source, movement {navigationMode
absolute|rail|orbit|guided, sourceCellId, requestedCellId, resolvedCellId,
railId?, movementClass, resolutionReason?}, harmony {chordNodeId, bassNote,
entryTone, arpPool, activityLayer}, pattern {patternId, transformedSteps,
rotation, direction, retrigger}, transition {commitTick, durationMs, glideType
hold|voice-led|elastic|whammy}, visual {current/destination coordinates,
projectedArpNotes, hueDegrees, tension01} — plus `fieldHash` verified by both
the tablet and PunchBridge.)

## 3. The field remains six by six

X = left-hand harmonic selection, Y = right-hand tone/rotation selection,
Z = activity layer. 6 × 6 = 36 harmonic cells; × 4 activity layers = 144
expressive states. Users do not need immediate access to all 36 cells — the
**Freedom** setting groups the six physical velocity zones into a smaller
surface.

## 4. Surface sizes

The underlying field always remains 6×6; lower freedom groups zones into bands:

```ts
export type SurfaceResolution = 3 | 4 | 6
export const ZONE_TO_SURFACE_BAND = {
  3: [0, 0, 1, 1, 2, 2],
  4: [0, 0, 1, 2, 3, 3],
  6: [0, 1, 2, 3, 4, 5],
} as const
```

- **Safe 3×3** — 9 immediately understandable controls; still exposes all six
  chords/tones over repeated punches by cycling predictably inside each band.
- **Guided 4×4** — 16 immediate controls; strong intermediate default.
- **Full Modal 6×6** — every zone directly selects a chord state or entry
  tone; expressive but harmonically safe (one key, one mode).
- **Guarded Chromatic** — 12 pitch classes exposed; the harmony resolver
  limits persistent clashes.
- **Open Chromatic** — raw requests accepted; the true experimental mode.

## 5. D Dorian Brass as the default world

| Node | Chord | Role | Tension |
|---:|---|---|---:|
| 0 | Dm9 | Home | 0.00 |
| 1 | Dm11 | Open home | 0.15 |
| 2 | F6/9 | Lift | 0.32 |
| 3 | Am11 | Motion | 0.48 |
| 4 | C6/9 | Pressure | 0.68 |
| 5 | G9 | Maximum modal tension | 0.90 |

Soft left punches: home and openness. Medium: movement and lift. Hard:
pressure and tension. The bank remains fully D Dorian (D E F G A B C) — a hard
punch moves to a more tense region of the same modal world, never to an
arbitrary bad chord.

## 6. Safe 3×3 mapping

**Left axis**: zones 0–1 → HOME (Dm9, Dm11) · zones 2–3 → MOTION (F6/9, Am11)
· zones 4–5 → PRESSURE (C6/9, G9). Repeated hits in one band alternate its two
members (Dm9 → Dm11 → Dm9 …) — variation without unpredictability.

**Right axis** — tone roles, not array positions:

```ts
export type HarmonicToneRole =
  | 'root' | 'third' | 'fifth' | 'color' | 'extension' | 'upper-anchor'
```

FOUNDATION {root, fifth} · COLOR {third, sixth-or-seventh} · AIR
{ninth-or-eleventh, upper root}; repeated right-hand hits alternate the band's
two roles.

| Left \ Right | Foundation | Color | Air |
|---|---|---|---|
| Home | Stable home | Minor color | Open Dorian |
| Motion | Moving foundation | Harmonic motion | Floating extension |
| Pressure | Strong tension | Dominant color | Maximum energy |

Left hand chooses how tense the harmony is; right hand chooses grounded,
colorful, or airy.

## 7. Guided 4×4 mapping

Left bands: 0 HOME (Dm9/Dm11) · 1 LIFT (F6/9) · 2 MOTION (Am11/C6/9) ·
3 TENSION (G9). Right roles: 0 Root · 1 Fifth · 2 Color · 3 Extension.
Multi-node bands use a deterministic orbit.

## 8. Full 6×6 mapping

Left zone directly selects chord node 0–5; right zone directly selects pool
tone 0–5 — closest to an event-driven Kaossilator surface. Example: left 4 =
C6/9, right 5 = upper C → coordinate (4,5); Mojito glides to C, the arp morphs
to the C6/9 pool, the stab hits upper C, the cube moves to (4,5,Z).

## 9. Navigation modes

- **Absolute** — velocity directly selects a band/cell; same intensity, same
  destination; easiest to learn.
- **Rail** — velocity expresses movement intent relative to the current state
  (soft → toward home; firm → neighbor; hard → toward tension); the engine
  picks a legal destination from the transition graph.
- **Orbit** — a band chooses a family; repeated punches cycle it (Home orbit
  Dm9→Dm11→…; Foundation orbit root→fifth→…).
- **Guided Path** — an authored progression; the punch chooses among the next
  permitted branches (soft/firm/hard), all telegraphed beforehand.

## 10. Safety modes as graph constraints

```ts
export interface HarmonicNode {
  id: string; chordName: string; bassNote: number
  tonePool: readonly HarmonicTone[]; tension01: number
  stability: 'home' | 'stable' | 'motion' | 'tension'
  visualCoordinate: [number, number]
}
export interface HarmonicEdge {
  fromNodeId: string; toNodeId: string
  movementClass: 'stay' | 'resolve' | 'step' | 'skip' | 'tension' | 'release'
  tensionDelta: number; bassLeapSemitones: number
  minimumFreedom: 'safe' | 'guided' | 'full' | 'chromatic'
  cost: number
}
export interface HarmonicRail {
  id: string; name: string; nodeIds: readonly string[]
  wrap: boolean; homeNodeIds: readonly string[]; tensionNodeIds: readonly string[]
}
```

Example rails — HOME: Dm9 ↔ Dm11 ↔ F6/9 · MOTION: Dm9→F6/9→Am11→C6/9→Dm9 ·
PRESSURE: Dm9→Am11→C6/9→G9→Dm9 · OPEN DORIAN: all six nodes, voice-led.

## 11. Music-theory rules (enforced by the field compiler, not Studio One)

1. **Modal containment** — in modal safety modes every latched/arpeggiated
   tone belongs to the mode (D Dorian: D E F G A B C); chromatic bends may
   pass through, held destinations stay modal.
2. **Entry tones are chord tones** — the stab is always a member of the
   current pool unless melodic passing tones are explicitly enabled.
3. **Retain common tones** on chord changes (Dm9→F6/9 keeps D F A C).
4. **Voice-lead every pool transition** — precompute all 36 pool-transition
   mappings: nearest legal destination per source tone, no voice crossing,
   prefer common tones, most movements within a third, preserve register.
5. **Limit bass leaps by safety level** — Safe ≤7 st, Guided ≤9, Full ≤12,
   Open unrestricted; larger leaps reserved for genuine peak punches.
6. **Tension follows physical intensity** in tension-ordered worlds,
   consistent across keys.
7. **No automatic pitch drift** — punch rate may alter arp speed/gate/depth/
   effects/extensions, never the two latched choices; a new punch is required
   to change the harmonic coordinate.
8. **Chromatic tension has a policy** — persistent / transient-only / guarded
   / tension-release (survives N arp steps then resolves). Default Guarded
   Chromatic: raw chromatic stab + safe resolved latched harmony.
9. **Keep voice registers separated** — Mojito bass MIDI 29–55, Mai Tai arp
   50–86, stab 50–96; the bass never crosses above the brass pool.
10. **Z adds density, not new harmonic rules** — reveals root/fifth → third/
    seventh → ninth → eleventh → octave, only from the current legal pool.
11. **Whammy returns to harmonic center** — never leave the bend displaced.

## 12. Separate harmonic commit rate from arpeggiator rate

The arp runs 60–240 notes/min, but harmonic coordinates change on a separate
**harmonic commit grid**. Default: master pulse 60 BPM, commit twice per pulse
(every 500 ms). Settings: Responsive 250 ms · **Groove 500 ms (default)** ·
Cinematic 1000 ms. The window gathers punches, recognizes short hand
sequences, shows the pending destination, coalesces flurries, commits
cleanly — while the ch4 stab and ch10 transient still fire the instant the
punch lands.

## 13. A reliable punch-gesture grammar

Hand identity and timestamps are trustworthy (the punch-type byte is not).
Collect the hand sequence within one commit window:

| Gesture | Harmonic interpretation |
|---|---|
| `L` | Change/move the harmonic node |
| `R` | Change entry tone or arp rotation |
| `LL` | Skip farther along the harmonic rail |
| `RR` | Rotate the pool farther or flip pattern direction |
| `LR` | Diagonal move; unlock one extension |
| `RL` | Reverse/descending motion or resolve one tension step |
| `LRL` | Add a response tone and return toward home |
| `RLR` | Inversion or upper-register flourish |
| `LRLR` | Fanfare/cadence transform |
| Punch after long pause | Bias toward home or a clean phrase opening |

Velocity distribution within the gesture controls magnitude (small/normal/
tension-or-octave move); acceleration keeps controlling attack, brightness,
wah and transient strength — never the core harmonic identity. Example: L
(medium) at 0 ms + R (hard) at 180 ms inside a 500 ms window → gesture `LR`
→ diagonal chord move + extension entry tone + six-step depth unlock; stabs
sounded at 0 and 180 ms; the field commits at 500 ms.

## 14. Deterministic pattern extension

Keep `0-2-1-3-2-4-3-5` as **pattern DNA**; transform it deterministically:

| Input | Transformation |
|---|---|
| Single left | Preserve phase; morph chord tones |
| Single right | Rotate starting position |
| `LL` | Skip every second pool tone |
| `RR` | Reverse or pendulum direction |
| `LR` | Add one extension tone |
| `RL` | Descending answer phrase |
| Alternating streak | Increase phrase depth |
| Same-hand streak | Introduce a pedal tone |
| Peak punch | Temporary octave lift |
| Pause then punch | Begin from root or nearest stable tone |

Same state + same gesture → same transformed pattern, always. No randomness in
the core control path (controlled variation may use a session seed later, but
must remain replayable).

## 15. Pattern projection and telegraphing

Three levels: (1) **candidate movement fan** before a punch (SOFT/FIRM/HARD
ghost destinations; cool colors for left paths, warm for right); (2) **pending
destination** after a punch (requested + resolved coordinate + circular
countdown to the grid commit — "the boxer threw the sound toward a
destination"); (3) **projected arpeggio path** — the next four/eight scheduled
tones as moving points (current solid, next three bright ghosts, rest faint;
on a chord change the old path bends through the voice-leading transition).
The visual projection and the MIDI arpeggiator must consume the same
transformed pattern array.

## 16. Branch telegraphing during gesture recognition

After the first punch in a window, show the possible second-hit branches
(L → harmonic move · LL → rail skip · LR → diagonal extension move); unused
branches disappear when the second punch lands. Guided Path emphasizes the
preferred branch. This makes the grammar learnable without a tutorial.

## 17. Rail safety profiles (data, not code paths)

```ts
export interface RailSafetyProfile {
  id: string; name: string
  leftBandCount: 3 | 4 | 6; rightBandCount: 3 | 4 | 6
  maximumTensionDelta: number; maximumBassLeapSemitones: number
  allowedPitchSource: 'chord-tones' | 'mode-tones' | 'guarded-chromatic' | 'free-chromatic'
  allowedGestureShapes: readonly string[]
  harmonicQueueDepth: 1 | 2
  chromaticPolicy: 'none' | 'transient-only' | 'guarded' | 'persistent'
  resolutionBiasAfterSilence: boolean
}
```

Safe Rails (3×3, chord tones, L/R/LR/RL, queue 1, bass ≤ fifth, no chromatic)
· Guided Rails (4×4, +mode tones, doubles, bass ≤ sixth, one rail step per
commit) · Full Modal (6×6, full grammar, queue ≤2, bass ≤ octave) · Guarded
Chromatic (12 classes, raw chromatic stabs, resolved held harmony) · Open
Field (no correction, no constraint, full grammar).

## 18. Resolution should be visible, not hidden

```ts
interface HarmonicResolution {
  requestedCellId: string; resolvedCellId: string
  reason: 'exact' | 'rail-limit' | 'bass-leap-limit' | 'tension-limit'
        | 'chromatic-guard' | 'voice-leading'
}
```

Requested cell: brief hollow flash. Resolved cell: solid landing glow.
Transition ribbon connects them — the instrument never feels like it ignored
the punch.

## 19. Tension and resolution without unwanted autonomous notes

Inactivity changes the **next movement rules**, never the held notes: after
1.5 s the next soft left punch resolves to a home node; after 3 s home
destinations get stronger visual emphasis; the held chord remains until a
punch occurs. An optional clearly-labeled **Auto Resolve** mode may glide home
without a punch.

## 20. Activity-layer rules

Keep the ladder (Z0 60/min·75%·3 → Z1 120·65%·4 → Z2 180·55%·6 → Z3
240·45%·8) and add harmonic density: Z0 root/fifth/color · Z1 +seventh-or-
sixth · Z2 +ninth-or-eleventh · Z3 full pool + octave reinforcement. Legal
pitch classes never change: more activity → more horn movement, shorter
notes, more extensions, more filter motion.

## 21. Instrument worlds

A World = key + mode + curated chord nodes + tension order + safe transition
graph + tone-role definitions + recommended patterns. Curate; do not generate
generically at first. Worlds: **Dorian Brass** (D; modal, athletic, open,
funky) · **Pentatonic Orbit** (D minor pent; very forgiving) · **Blues
Pressure** (E minor blues; blue note transient/passing) · **Mixolydian
Drive** (G; rock/funk dominant energy) · **Chromatic Cage** (C; electronic,
Guarded Chromatic default) · **Whole-Tone Float** (symmetric, dreamlike). Key
changes transpose the whole world preserving degrees, roles, tension order,
graph, and voice-leading rules.

## 22. Manifest design

`InstrumentWorldManifest` (schemaVersion 2): id/name, rootPitchClass, mode
{id, pitchClasses}, harmonicNodes, edges, rails, toneRoleGroups
{safe3/guided4/full6}, safetyProfiles, patternGrammar, instrumentProfileId.
Compiled: `CompiledHarmonicField` {worldId, fieldHash, rootMidiNote, nodes,
cells, transitionTable, voiceLeadingTable, patternTransforms} with each cell
fully compiled {cellId, x, y, chordNodeId, toneRole, bassNote, entryTone,
arpPool, tension01, colorHue}. Runtime performs lookups, never music-theory
derivation.

## 23. Movement resolver

`PunchMovementIntent` {hand, rawZone, surfaceBand, velocity01,
acceleration01, gestureShape, currentCellId, currentTick} →
`resolveMovement(field, profile, intent)` looks up
`transitionTable[currentCellId | profile.id | gestureShape | surfaceBand]`
and returns the projected primary gesture. The runtime does not inspect mode
intervals or chord spelling.

## 24. Three queue behaviors

**Latest Wins** (default): newest left + newest right requests commit once at
the boundary. **Two-Step Queue**: retain up to two movements, commit over two
boundaries. **Gesture Fold** (default at dead-sprint): collect all hits in
the window into ONE pattern transform + one destination — an L-R-L-R flurry
becomes one diagonal move + fanfare pattern + extension unlock + higher
activity, not four abrupt chord changes.

## 25. Recommended user-facing modes

1. **Brass Home** (default): Dorian Brass · Safe 3×3 · Absolute + Orbit ·
   Punch Weave · Continuous Morph · chord tones only.
2. **Brass Explorer**: Guided 4×4 · Harmonic Rails · voice-led commits.
3. **Full Dorian Cube**: Full 6×6 · Absolute · Continuous Morph.
4. **Pentatonic Orbit**: Minor Pentatonic · Guided 4×4 · Orbit · Pendulum.
5. **Guarded Chromatic**: Chromatic Cage · Full 6×6 · raw chromatic stabs ·
   guarded held harmony.
6. **Punch Gesture Lab**: Full Modal · Gesture Fold · all gestures ·
   telegraph branches visible.
7. **Chord Forge**: left = root/function, right = interval/quality,
   activity = voicing density.
8. **Call and Response**: two-bar call · two-bar response window · punches
   quantized as the answer phrase · engine answers from the resulting cell.

## 26. UI blueprint

Main performance screen: world/freedom/pattern/Z header · ghost projected arp
path · the 3×3 (or 4×4/6×6) node surface with HOME/MOTION/PRESSURE ×
FOUNDATION/COLOR/AIR · PENDING gesture → destination readout with commit
countdown ring · NEXT arp tones · per-hand intensity + rate. Visual language:
solid = sounding, pulsing ghost = pending commit, faint = available
destinations, curved ribbon = voice-led transition, orbiting dots = next arp
notes, outer ring = time to commit, color temperature = tension, cloud
density = activity/acceleration. Note names hideable.

## 27. Development order

1. Annotate the existing chord bank (roles, tension, categories, edges) — no
   sound change.
2. Compile all 36 cells (bass, entry tone, pool, coordinate, tension).
3. Add Safe 3×3 (grouped zones + deterministic two-member orbiting) — the
   largest usability improvement with minimal risk.
4. Add Guided 4×4 and Full 6×6 (same field, three resolutions).
5. Add movement projection (destination tables per cell/profile/gesture/band).
6. Add pending-cell telegraphing (destination + boundary countdown).
7. Add gesture folding (hand sequences inside the commit window).
8. Add deterministic pattern transformations (next eight arp notes compiled
   from the gesture).
9. Add Guarded Chromatic (raw chromatic stab + safe resolution held).
10. Add authoring tools (field inspector: nodes, edges, all mappings, all 36
    voicings, voice-leading distances, unsafe intervals, projected output).

## 28. Acceptance criteria

1. One `CompiledPunchGesture` per punch, used by MIDI and visuals.
2. Safe 3×3 exposes exactly three movement classes × three tone classes.
3. Repeated punches in a band cycle predictably, never randomly.
4. Full 6×6 exposes all six chords and six tone roles directly.
5. Every sustained/arpeggiated pitch in modal modes belongs to the mode.
6. Every immediate entry tone belongs to the current chord (unless chromatic
   transient mode).
7. Chord changes use a precomputed voice-leading table.
8. Bass leaps obey the safety profile.
9. Activity changes density/effects, never latched pitch autonomously.
10. A punch produces an immediate stab even when the commit is quantized.
11. The pending destination appears before its boundary commit.
12. The projected arp path exactly matches PunchBridge's notes.
13. `L R LL RR LR RL` always produce deterministic transformations.
14. A flurry folds into one coherent harmonic gesture.
15. Tablet and PunchBridge reject gestures with the wrong `fieldHash`.
16. The same recorded punch sequence recreates the same harmonic path under
    the same world/profile/fieldHash.

## Recommended starting configuration

WORLD D Dorian Brass · SURFACE Safe 3×3 · LEFT Home/Motion/Pressure · RIGHT
Foundation/Color/Air · NAVIGATION Absolute with deterministic orbit ·
HARMONIC COMMIT 120/min (500 ms) · ARP Punch Weave · RETRIGGER Continuous
Morph · Z 60/120/180/240 · BASS Mojito root-following voice-led glide · ARP
Mai Tai brass mono voice-led pool morph · STAB Mai Tai poly immediate entry
tone · TRANSIENT Superior Drummer 3 · CHROMATIC disabled except peak-punch
whammy · TELEGRAPHING pending cell + next four arp notes.

> **Freedom changes how many safe choices the boxer can make; it does not
> replace the harmonic engine. Navigation changes how those choices move
> through the field; it does not redefine the notes. Pattern transforms change
> the order of legal tones; they do not create a second harmony map.**
