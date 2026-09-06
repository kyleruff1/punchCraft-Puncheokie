# Strike Articulation & Motif Grammar (authoritative — v2 Phase 3.5)

Kyle's design, 2026-09-05, verbatim below. Extends `harmonic-field-v2.md`
with the technique layer, inserted after Safe 3×3 and before movement
projection. Tracked as M40-20/21/22 (+ M44 for guided wiring and the
classifier).

---

The foundation is missing one explicit layer: a **strike-articulation and
motif compiler**. The harmonic field should continue deciding which notes are
legal. Punch type should decide **how those notes move, attack, bend, and
repeat**. That separation creates obvious punch-specific changes without
allowing every punch to throw the song into a different key or unrelated
chord.

The governing rule:

> **Harmony supplies the note pool. Punch type supplies the musical gesture.
> Velocity supplies the gesture's strength. Acceleration supplies its attack.
> Punch rate supplies arrangement energy.**

That is the distinction between an interactive instrument and a random MIDI
trigger.

## 1. Do not let punch type directly select arbitrary chords

Jab→Dm9 / Cross→G9 / Hook→C6/9 / Uppercut→Am11 would become chaotic: a fast
combination forces four harmony changes in under a second. Instead, preserve
the harmonic coordinate for a bounded phrase and let each strike transform
the arpeggiator within it: jab = stepwise motion · cross = strong interval
leap and landing · hook = curved/reversed motion · uppercut = rising motion
and pitch scoop · body variation = lower inversion, darker filter, low
transient. The notes still come from the legal pool; the type changes contour
and articulation, not the tonal world.

## 2. Recognize the tracker limitation explicitly

**Guided PunchEoke**: the compiled score knows the expected token
(1, 1B, 2, 2B, 3, 3B, 4, 4B, 5, 5B, 6, 6B) — apply all twelve signatures
deterministically. **Free Jam**: the tracker reliably supplies hand,
velocity, acceleration peak, timing, rate, alternation; its raw type code is
NOT yet a reliable technique identifier and does not securely identify a
body target. Free Jam needs a confidence-gated identity pipeline:

```ts
export interface StrikeIdentity {
  source: 'guided-score' | 'device-classifier' | 'hand-gesture' | 'generic'
  token?: StrikeToken
  family?: 'straight' | 'hook' | 'uppercut'
  level?: 'head' | 'body'
  confidence: number
}
```

Policy: guided-score token → full twelve-strike signature. Classifier
confidence ≥ 0.80 → classified family (body modifier only when independently
reliable). 0.55–0.79 → family contour only, target neutral. Lower → generic
hand-specific response. **Do not map raw type bytes 0–5 to techniques until
the per-device capture campaign validates those semantics.**

## 3. Compose the twelve signatures from three dimensions

family (straight/hook/uppercut) × relative hand (lead/rear) × target
(head/body).

**Family → contour**: straight = linear step or decisive skip, tight short
tongued brass · hook = pendulum/reversal/curved traversal, wider gate,
lateral wah/pan arc · uppercut = rising traversal + octave lift, legato
scoop, upward filter/pitch motion.

**Lead/rear → direction and entry**: lead = lower/earlier pool entry,
negative rotation, cooler/leftward motion, setup emphasis · rear = higher
entry, positive rotation, stronger landing, warmer/rightward, power
emphasis. Physical left/right still controls stereo placement; in
switch-stance guided mode, semantic lead/rear shapes the phrase while the
physical hand keeps the output lane.

**Head/body → register and weight**: head = normal/upper inversion,
brighter filter, clearer attack · body = SAME pitch classes in a lower
inversion, sub-octave stab, darker filter, low drum emphasis — a body shot
sounds like a lower, heavier version of the same idea, never a different
scale.

## 4. Twelve default strike signatures

| Token | Signature | Immediate | Arpeggiator response |
|---|---|---|---|
| 1 | Lead jab | Short bright entry-tone stab | Step upward through two adjacent legal tones |
| 1B | Lead body jab | Stab one octave lower; low transient | Same step motion from a lower inversion |
| 2 | Rear cross | Strong fifth/upper-anchor stab | Skip one pool tone, then land firmly |
| 2B | Rear body cross | Lower fifth/sub accent | Same skip-and-land, darker and lower |
| 3 | Lead hook | Leftward wah/pan sweep | Reverse into a short pendulum arc |
| 3B | Lead body hook | Low lateral transient | Lower-inversion pendulum, darker gate |
| 4 | Rear hook | Rightward sweep, stronger accent | Mirrored pendulum, positive rotation |
| 4B | Rear body hook | Low rightward impact | Mirrored lower-inversion pendulum |
| 5 | Lead uppercut | Upward scoop | Three-step rise with a brief octave pulse |
| 5B | Lead body uppercut | Scoop from one octave below | Rise from lower inversion into the pool |
| 6 | Rear uppercut | Strong upward scoop and landing | Rising phrase from the rear-side rotation |
| 6B | Rear body uppercut | Heavy low scoop | Lower rise, forceful root/fifth landing |

Type also controls attack shape, gate length, filter motion, stereo curve,
transient choice, octave treatment — recognizable even when pitch movement
is subtle.

## 5. Four musical timescales

| Timescale | Trigger | Result |
|---|---|---|
| Immediate | Punch arrival | Stab, drum transient, wah attack |
| Next arp step | First legal subdivision | Small technique-specific motif response |
| Harmonic boundary | ~every 500 ms | Chord/cell + rotation commit |
| Phrase/bar boundary | ~every 1–4 s | Persistent pattern + arrangement change |

This is the anti-chaos mechanism. Immediate: every accepted live punch →
one stab, one transient, one short filter/pitch gesture. Next-step: jab
advances one tone, cross jumps to an anchor, hook reverses direction,
uppercut lifts. Harmonic commit: coalesce requests, one resolved cell,
voice-lead bass and pool together — never a chord per flurry punch. Phrase
commit: the ordered punch types compile a new 8-step motif.

## 6. Technique phrase window

Default: 960 transport ticks (1,000 ms at 60 BPM); max 4 explicit strike
identities; additional punches increase accents/activity/density but never
lengthen the motif.

```ts
export interface TechniquePhraseIntent {
  phraseId: string
  sourceEventIds: readonly string[]
  strikeTokens: readonly StrikeToken[]
  startedAtTick: number
  closesAtTick: number
  averageVelocity01: number
  maximumAcceleration01: number
  activityLayer: 0 | 1 | 2 | 3
}
```

The current phrase keeps playing while the new one is collected; immediate
stabs keep the interface responsive.

## 7. Compile combinations into musical operations

Never map tokens to fixed MIDI notes — map to operations over the current
legal pool:

```ts
export type ArpOperation =
  | { kind: 'advance'; amount: number }
  | { kind: 'skip'; amount: number }
  | { kind: 'reverse'; steps: number }
  | { kind: 'land'; role: 'root' | 'fifth' | 'upper-anchor' }
  | { kind: 'octave-pulse'; amount: -1 | 1 }
  | { kind: 'lower-inversion'; steps: number }
```

Base operations: 1 = advance 1, advance 1 · 2 = skip 2, land fifth/upper
anchor · 3 = reverse 3, curved role sequence · 4 = reverse 3, opposite
rotation · 5 = advance 2, octave-pulse up, settle extension · 6 = advance 3,
octave-pulse up, land root/fifth · B modifier = lower inversion + sub-octave
immediate stab + darker filter. The same 1-2-3-2 gesture + Dm9 = one valid
Dm9 phrase; + F6/9 = one valid F6/9 phrase — contour recognizable, every
note legal.

## 8. Eight-step motif rules

1 preserve punch order · 2 ≤8 arp steps · 3 chord tones only in Safe ·
4 mode tones as passing notes only in Guided/Full Modal · 5 body may change
octave/timbre, never pitch class · 6 ≤1 octave jump per phrase unless a
peak punch · 7 no two consecutive large leaps · 8 stable final tone
(root/fifth/upper root) · 9 hooks reverse/pendulum, never a new chord ·
10 uppercuts rise but settle inside the pool · 11 >4 punches raise gate
accents/depth/wah/drums, never unlimited notes · 12 same field state +
tokens + velocities → same motif, always.

## 9. Example: 1-2-3-2 on Dm9

Roles: F foundation · C color · 5 fifth · E extension · U upper anchor.
Semantics: 1 = foundation→color · 2 = fifth→upper anchor · 3 = reverse into
a short arc · 2 = land firmly on fifth/root. Illustrative 8-step output:
**F · C · 5 · U · 5 · C · 5 · F** — setup, power leap, curved hook
movement, firm cross landing. For 1B-2-3-2 the first step gets lower
octave/darker filter/low transient; the phrase stays in the same harmonic
world.

## 10. Persistence policy

**Micro motif**: every identified punch affects the next 1–3 arp steps —
always enabled, short-lived, obvious. **Persistent family pattern**: the
full topology changes only at phrase close when ≥2 punches of one family
dominate, when the guided score requests it, or by bar-boundary rule —
straight-dominant → Up/Punch Weave · hook-dominant → Pendulum/mirrored
Pendulum · uppercut-dominant → Fanfare/Riser · mixed → compiled combination
motif. Never thrash the selector during a combination.

## 11. Arrangement rail

Scenes: **pocket** (bass, 3-step depth, sparse punctuation, long gate, low
filter) → **groove** (4-step, steady pulse, clear stabs) → **drive**
(6-step, stronger percussion, wider stereo, more extensions) → **peak**
(8-step, full drums, brighter brass, peak-only whammy, max clouds). Rules:
activity raises ≤1 scene per bar; inactivity lowers ≤1 per 1–2 bars; scene
changes at bar boundaries only; the two latched fundamentals never move
without a punch.

## 12. Sound causality

One primary responsibility per input: semantic type → contour/articulation ·
hand → lane/direction/stereo · velocity zone → harmonic destination/tone
role · velocity-in-zone → bend/filter/motif strength · acceleration → stab
velocity/transient weight/attack brightness · punch rate → arp rate/depth/
scene · alternation → width/extensions · peak event → controlled octave
whammy · body modifier → lower inversion/dark filter/sub accent.

## 13. Data model

```ts
export interface StrikeArticulationProfile {
  family: 'straight' | 'hook' | 'uppercut'
  immediate: {
    stabRole: 'entry' | 'root' | 'fifth' | 'upper-anchor'
    baseGateMs: number
    velocityGain: number
    filterShape: 'snap' | 'lateral-wah' | 'rising-scoop'
    drumClass: 'light' | 'power' | 'sweep' | 'lift'
  }
  microArp: { operations: readonly ArpOperation[]; maximumSteps: number }
  persistentPattern: {
    patternId: 'up' | 'punch-weave' | 'pendulum' | 'reverse-pendulum' | 'riser' | 'fanfare'
    requiredEvidence: number
    commitQuantization: 'pulse' | 'bar'
  }
}
export interface HandArticulationModifier {
  rotationDelta: number
  directionSign: -1 | 1
  stereoPosition: number
  accentMultiplier: number
}
export interface TargetArticulationModifier {
  octaveOffset: -1 | 0
  cutoffMultiplier: number
  gateMultiplier: number
  lowTransientGain: number
}
```

`resolveStrikeArticulation(token)` → {token, familyProfile, handModifier,
targetModifier}.

## 14. Compiled technique result

```ts
export interface CompiledTechniqueMotif {
  motifId: string
  sourceStrikeEventIds: readonly string[]
  sourceTokens: readonly StrikeToken[]
  harmonicCellId: string
  poolIndices: readonly number[]
  octaveOffsets: readonly number[]
  accentValues: readonly number[]
  gateMultipliers: readonly number[]
  family: 'straight' | 'hook' | 'uppercut' | 'mixed'
  commitTick: number
  expiresAtTick: number
}
```

The gesture references it: `technique: {identity, immediateSignatureId,
microMutation, pendingPhraseId?}`. MIDI, cube projection, and visual
pattern projection consume the SAME motif object.

## 15. Plan amendment — Phase 3.5

Deliverables: strikeArticulationCatalog.ts · techniquePhraseAccumulator.ts ·
compileTechniqueMotif.ts · gestureCompiler emission (immediate signature +
next-step mutation) · brassArpEngine micro-mutation without phase restart ·
field visuals project the same motif. Initial scope: guided-score full
twelve; Free Jam hand+generic (classifier only above threshold); chord
tones only; persistent commit once per pulse; immediate stab/transient
every punch. Do NOT wait for Guarded Chromatic or telegraphing.

## 16. Acceptance tests

1 · 1/2/3/5 audibly distinct contours in one pool. 2 · 1B = same classes,
lower/darker. 3 · 3/4 mirrored hook motion. 4 · 5/6 upward contours
settling legally. 5 · fast 1-2-3-2 = one coherent phrase, not four
restarts. 6 · stab + transient every punch. 7 · ≤1 harmony change per
commit boundary. 8 · ≤1 persistent-pattern change per pulse/bar. 9 · >4
punches = energy, not unbounded notes. 10 · Safe = chord tones only.
11 · guided applies exact twelve-token signatures. 12 · free mode never
claims technique/body from untrusted raw codes. 13 · same events → same
motif and fieldHash. 14 · MIDI arp and projected visuals share the
CompiledTechniqueMotif. 15 · arrangement moves Pocket→Peak only through
bounded bar-level transitions.

## Recommended default behavior

WORLD D Dorian Brass · FREEDOM Safe 3×3 · HARMONIC COMMIT 500 ms ·
TECHNIQUE PHRASE WINDOW 1,000 ms / max 4 explicit strikes · IMMEDIATE
stab + drum + short filter gesture every punch · MICRO next 1–3 arp steps
reflect the family · PERSISTENT recompiled once per pulse from the ordered
phrase · ARRANGEMENT pocket/groove/drive/peak, one level per bar ·
HARMONIC SAFETY chord tones only · PEAK one-octave whammy, return to
center.

> A jab, cross, hook, and uppercut each leave an unmistakably different
> mark on the running brass phrase. Combinations become coherent motifs.
> Velocity makes those gestures stronger, acceleration makes them hit
> harder, and sustained activity wakes the arrangement up — while the
> Harmonic Field prevents the athlete from accidentally leaving the song's
> tonal world.
