# Execution backends — Studio One & Toontrack division of responsibility

> Design authority (Kyle, 2026-09-05, verbatim; second-pass review companion).
> Studio One and Toontrack change the **execution strategy**, but not the
> Harmonic Field's source-of-truth architecture.

Studio One can provide host timing, MIDI sequencing, Note FX such as an
arpeggiator, instrument hosting, automation, and effects. Superior Drummer 3
and EZdrummer provide deep MIDI groove libraries, grid editing, quantization,
swing, timing/velocity manipulation, MIDI mapping, and host-synchronized
song-track behavior. Those tools can eliminate substantial audio-engine work.
They should remain **execution and authoring backends**, however — not become
hidden alternate mappings that the tablet cannot predict or replay.

## Recommended division of responsibility

| Component               | Owns                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Harmonic Field compiler | Legal notes, cells, chord pools, safety rails, transitions, motifs                   |
| PunchBridge             | Punch aggregation, commit decisions, clock adaptation, MIDI/CC output, logging       |
| Studio One              | Instruments, effects, automation, optional Note FX arpeggiation                      |
| Mai Tai/Mojito          | Sustained bass, brass tone, glide, wah, pitch expression                             |
| Toontrack               | Drum sounds, percussion articulations, grooves, fills, humanization                  |
| Tablet                  | Harmonic-field display, pending destination, projected pattern, tracker interaction  |

The rule remains:

> Studio One and Toontrack may perform a compiled plan, but they must not
> independently decide what the punch means.

For example, a hook can still compile to:

```text
Current chord pool: Dm9
Motif transform: reverse pendulum
Pattern rate: 120 notes/minute
Gate: 65%
Drum response: snare/flam articulation
Commit: next 500 ms boundary
```

Studio One may render the brass sound and Toontrack may render the drum
response. Neither should independently choose a different chord or
reinterpret the hook.

# Three arpeggiator execution modes

## 1. Bridge Exact

PunchBridge emits every arpeggiator Note On and Note Off.

```text
Harmonic Field
    ↓
Exact eight-step MIDI phrase
    ↓
PunchBridge tick engine
    ↓
Mai Tai
```

This remains the production default because:

- The projected notes on the tablet can be exact.
- Record/replay is deterministic.
- Every played MIDI event has a known event ID.
- Technique micro-mutations can affect only the next one to three steps.
- Continuous morphing and voice leading stay under our control.
- Studio One receives ordinary MIDI and provides the sound.

Studio One acts as the sound host, while PunchBridge remains the sequencer.

## 2. Studio One Note FX

PunchBridge sends a held chord or tone pool into Studio One, and Studio
One's Note FX arpeggiator generates the actual running notes.

```text
Harmonic Field
    ↓
Held six-note chord pool
    ↓
Studio One Arpeggiator
    ↓
Mai Tai
```

Useful for rapid sound experimentation, trying patterns in the DAW,
auditioning rates/gates/octave ranges/directions, and letting a producer
modify the performance without changing application code.

The limitation is observability. Unless PunchBridge knows the exact
arpeggiator preset and reproduces its algorithm, the tablet cannot
guarantee that its projected next-note trail is the same sequence Studio
One is generating. Therefore this mode declares:

```ts
projectionAccuracy: 'exact' | 'pattern-symbolic' | 'unavailable'
```

For an unmapped Studio One preset, `projectionAccuracy = 'pattern-symbolic'`:
the app can show "Pendulum · 120/min · six-note depth · upper rotation" but
must not claim "Next notes: A, D, F, C" unless that sequence is known.

## 3. Imported DAW Pattern

The strongest long-term compromise: design an arpeggio in Studio One, then
render/export it as MIDI and convert it into a PunchEoke pattern manifest.

```text
Design in Studio One
        ↓
Export MIDI
        ↓
Normalize pitches to chord-pool indices
        ↓
Store tick/gate/accent pattern
        ↓
PunchBridge performs it exactly
```

Studio One's editing workflow without turning Studio One into an opaque
runtime authority. A Studio One pattern `D4 A4 F4 C5 A4 E5 C5 F5` becomes:

```ts
{
  id: 'studio-fanfare-01',
  lengthTicks: 1920,
  steps: [
    { atTick: 0,    poolIndex: 0 },
    { atTick: 240,  poolIndex: 2 },
    { atTick: 480,  poolIndex: 1 },
    { atTick: 720,  poolIndex: 3 },
    { atTick: 960,  poolIndex: 2 },
    { atTick: 1200, poolIndex: 4 },
    { atTick: 1440, poolIndex: 3 },
    { atTick: 1680, poolIndex: 5 },
  ],
}
```

The pattern then applies to any legal chord pool.

# The execution-backend contract (lands in M40-22A)

Keep `brassArpEngine` as the implementation, behind an interface:

```ts
export type PatternExecutionBackendId =
  | 'bridge-exact'
  | 'studio-one-note-fx'
  | 'imported-midi'

export interface PatternBackendCapabilities {
  exactStepProjection: boolean
  supportsLiveRateChange: boolean
  supportsLiveGateChange: boolean
  supportsPatternRotation: boolean
  supportsContinuousMorph: boolean
  supportsMicroMutations: boolean
  supportsVoiceLeading: boolean
}

export interface PatternExecutionBackend {
  readonly id: PatternExecutionBackendId
  readonly capabilities: PatternBackendCapabilities
  prepare(plan: CompiledPatternPlan): Promise<void>
  applyHarmonicCommit(commit: CompiledHarmonicCommit): void
  applyMicroMutation(mutation: CompiledMicroMutation): void
  updateActivity(activity: CompiledActivityState): void
  panic(): void
}
```

Bridge Exact declares the full-true capability set. Studio One Note FX
starts conservative (everything false except voice leading) — capabilities
are enabled individually only after the installed Studio One 4 environment
is probed for reliable MIDI/automation control of the corresponding
parameter. Never assume a Note FX control can be remotely mapped just
because the arpeggiator exists.

## One compiled pattern plan

All backends consume the same plan:

```ts
export interface CompiledPatternStep {
  stepId: string
  atTick: number
  poolIndex: number
  octaveOffset: number
  gateTicks: number
  accent01: number
}

export interface CompiledPatternPlan {
  planId: string
  fieldHash: string
  patchGeneration: number
  patternId: string
  startTick: number
  lengthTicks: number
  steps: readonly CompiledPatternStep[]
  rateTicks: number
  gateRatio: number
  swing: number
  retrigger: 'quantized-rotate' | 'hard-retrigger' | 'continuous-morph'
  hostDirective?: {
    studioOnePresetId: string
    verifiedPresetVersion: string
    rateMacro?: number
    gateMacro?: number
    octaveMacro?: number
    patternMacro?: number
  }
}
```

The `steps` remain canonical even when the selected backend does not use
them directly: Bridge Exact plays them; Imported MIDI plays steps imported
from Studio One; Studio One Note FX uses `hostDirective` and treats steps
as a design/reference projection. No separate Studio One pattern map
exists outside this object.

# Clock authority must be explicit

Each performance session has exactly one:

```ts
export type PerformanceClockAuthority = 'punchbridge' | 'studio-one-host'
```

**PunchBridge authority** (this release): PunchBridge owns the 60 BPM
transport, sends exact notes, Studio One renders, Toontrack receives
percussion events. Matches the existing system; tablet telegraphing stays
deterministic.

**Studio One host authority** (a later studio-performance mode, M45-06):
Studio One owns tempo/transport, PunchBridge follows a host timing feed,
Note FX runs against host tempo, the tablet receives mirrored transport
state. Do not ship until PunchBridge has a reliable host-position adapter —
entering "60 BPM" in both programs is not synchronization.

The session handshake includes:

```ts
interface PerformanceClockContract {
  authority: 'punchbridge' | 'studio-one-host'
  beatsPerMinute: number
  ticksPerBeat: 960
  transportGeneration: number
  transportEpochId: string
}
```

# Toontrack's role

Toontrack does not control the melodic arpeggiator; it is the interactive
rhythm and transient layer (drum-scene and fill execution, never harmonic
authority).

```ts
export interface CompiledDrumScene {
  sceneId: string
  startsAtTick: number
  lengthTicks: number
  grooveId: string
  intensity: 'pocket' | 'groove' | 'drive' | 'peak'
  variation: number
  fillPolicy: 'none' | 'phrase-end' | 'bar-end' | 'gesture-triggered'
  punchTransientMode: 'direct' | 'groove-layered' | 'off'
}
```

| Tracker behavior         | Toontrack result                           |
| ------------------------ | ------------------------------------------ |
| Individual strike        | Direct drum articulation                   |
| Acceleration             | Drum MIDI velocity                         |
| Punch rate               | Groove intensity scene                     |
| Alternation              | Hi-hat/open-hat or stereo percussion layer |
| Hook-heavy guided phrase | Tom or sweeping percussion accent          |
| Uppercut-heavy phrase    | Rising tom/fill gesture                    |
| Peak strike              | Crash or stacked accent                    |
| Phrase completion        | Fill at next bar boundary                  |

The groove scene changes only on a bar or phrase boundary. Immediate punch
transients still fire at punch arrival.

## Author grooves in Toontrack, execute them predictably

```text
Select or build groove in Superior Drummer
        ↓
Adjust quantization, swing, velocity and humanization
        ↓
Export/drag MIDI
        ↓
Store MIDI with PunchEoke
        ↓
Assign stable grooveId
```

```ts
interface DrumPatternManifest {
  grooveId: string
  source: 'superior-drummer' | 'ezdrummer' | 'studio-one' | 'puncheoke'
  lengthTicks: number
  events: readonly {
    atTick: number
    midiNote: number
    velocity: number
    gateTicks: number
  }[]
  sourcePresetName?: string
  sourceContentHash: string
}
```

Studio One or Toontrack remains the creative editor; PunchEoke retains a
deterministic representation.

# Recommended hybrid mode (production default)

```text
CLOCK       PunchBridge
HARMONY     PunchEoke Harmonic Field
ARPEGGIATOR PunchBridge exact-note engine
SYNTHESIS   Studio One — Mojito bass, Mai Tai brass, Mai Tai stab
DRUMS       Superior Drummer 3
EFFECTS     Studio One inserts and automation
AUTHORING   Studio One + Toontrack editors → MIDI imported into manifests
```

Exact projected notes, exact replay, rich synthesis/effects, detailed
percussion, full DAW authoring — no duplicate harmonic or timing authority.

# Ticket placement

- **M40-22A (#326)**: PatternExecutionBackend + BridgeExactPatternBackend
  (the only production backend this milestone) + backend-neutral
  CompiledPatternPlan; projected notes exact for this backend; Studio One
  and imported-MIDI implementations deferred.
- **M40-17 (#321)**: PerformanceClockContract on the v2 hello; bridge
  rejects any authority other than 'punchbridge' this release.
- **M45-05**: Studio One pattern authoring + MIDI import (P2).
- **M45-06**: Studio One Note FX execution backend (P3; requires
  studio-one-host clock authority + a capability probe of the installed
  environment; telegraphing pattern-symbolic unless preset mirrored).
- **M45-07**: Toontrack groove scenes (P2; curated bank, grooveId
  manifests, scene→groove mapping, bar/phrase-quantized changes).

## Bottom line

Studio One and Toontrack avoid writing a synthesizer, a drum sampler, a
full groove editor, and potentially some runtime arpeggiator behavior.
They do **not** remove the need for PunchEoke to own the semantic pattern
plan wherever exact visual telegraphing, deterministic replay, safety-rail
validation, tracker-to-music causality, and tablet/PC identity are
required.

> **Studio One and Toontrack may author, render, humanize, and process the
> performance. PunchEoke still decides the notes, legal movements, commit
> boundaries, and semantic relationship to each punch.**

References: PreSonus Studio One 4.1 Reference Manual; Toontrack Superior
Drummer 3 product documentation.
