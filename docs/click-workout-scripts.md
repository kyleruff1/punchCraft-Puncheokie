# punchCraft — Click-Track Workout Scripts (all 10 predetermined sets)

> Generated from `CLICK_MAPS` (the running library) by `tools/analysis/gen-workout-scripts.ts` — the maps ARE these tables; regenerate after any map edit.
>
> Every spoken element is bracket-tagged for the corpus bank:
>
> - `<<SINGLE CLIP>>` — one unique full utterance: render as ONE clip (walkouts, section lead-ins, rest scripts).
> - `[[COMPONENT HITS]]` — audio built from the token component bank (numbers / fused-bees), one clip per token, for if/when per-hit calling ships. Click sets currently run coach-minimal: **the click is the audio**; these rows are the future per-hit script.
>
> Bar notation: `[ n ]` = punch slot, `[ . ]` = rest slot. Slot width: `@1x` = 1 beat · `@1.5x` = 2/3 beat · `@2x` = 1/2 beat (double-time under the same click). Stride: 4-slot @1x = 2 measures/rep · @1.5x/@2x = 1 m/rep · 8-slot @1x = 3 m/rep · 8-slot @2x = 1.5 m/rep. The breath after each bar is part of the stride and doubles as the visual page-clear.

---

## Three-Round Fundamentals  `three-round-fundamentals`

**120 BPM · 3 rounds × 4:00 work · 120 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/three-round-fundamentals>>
Three-Round Fundamentals. Three rounds, four minutes each, one-twenty on the click. The basics, done right — jabs, crosses, hooks, walked to the beat. Find your rhythm and keep it. On the bell.
```

### Round 1 — “Find the rhythm”

**§1.1 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s1>>
"Pump: ones only, straight time — 10 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§1.2 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s2>>
"One, two, one, two — straight time, 15 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s3>>
"One, one, two — straight time, 10 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§1.4 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s4>>
"One, two, one, two — double-time, 20 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.5 PUNCTUATED BAR (breath baked into slot 4)** — 15 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s5>>
"One, two, three — time-and-a-half, 15 bars."

  [ 1 ][ 2 ][ 3 ][ . ]  @1.5x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

**§1.6 COMBO BAR** — 10 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s6>>
"Three, two, three, two — straight time, 5 bars."

  [ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 5   (4 punches/bar -> 20 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | two | three | two
```

**§1.7 PUNCTUATED BAR (breath baked into slot 4)** — 5 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s7>>
"Two, three, two — time-and-a-half, 5 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @1.5x   x 5   (3 punches/bar -> 15 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_Round 1 totals: 120 measures · **290 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/three-round-fundamentals/r1>>
Good round. Breathe — hands stay up. Next: stack the pages. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 2 — “Stack the pages”

**§2.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s1>>
"Big phrase — two pages: one, two, one, two, three, two, three, two. straight time, 10 times through."

  [ 1 ][ 2 ][ 1 ][ 2 ][ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 10   (8 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two | three | two | three | two
```

**§2.2 PUMP BAR (single punch, four slots)** — 10 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s2>>
"Pump: ones only, double-time — 10 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s3>>
"Two, three, two — straight time, 15 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @1x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

**§2.4 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s4>>
"One, two, three, two — time-and-a-half, 20 bars."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

**§2.5 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s5>>
"One, four, three, two — straight time, 10 bars."

  [ 1 ][ 4 ][ 3 ][ 2 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | four | three | two
```

**§2.6 PUMP BAR (single punch, four slots)** — 10 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s6>>
"Pump: ones only, time-and-a-half — 10 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 2 totals: 120 measures · **325 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/three-round-fundamentals/r2>>
Good round. Breathe — hands stay up. Next: put it together. First up when we come back: One, two, one, two. Water if you need it. Ready on the bell.
```

### Round 3 — “Put it together”

**§3.1 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s1>>
"One, two, one, two — straight time, 20 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§3.2 COMBO BAR** — 22 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s2>>
"Five, two, five, two — straight time, 11 bars."

  [ 5 ][ 2 ][ 5 ][ 2 ]  @1x   x 11   (4 punches/bar -> 44 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: five | two | five | two
```

**§3.3 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s3>>
"Long set: ones only, double-time — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s4>>
"One, two, three — time-and-a-half, 20 bars."

  [ 1 ][ 2 ][ 3 ][ . ]  @1.5x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

**§3.5 TWO-PAGE SET (8 slots, paged as 2 bars)** — 18 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s5>>
"Big phrase — two pages: one, one, two, three, two, three, two. straight time, 6 times through."

  [ 1 ][ 1 ][ 2 ][ 3 ][ 2 ][ 3 ][ 2 ][ . ]  @1x   x 6   (7 punches/bar -> 42 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | three | two | three | two | (rest)
```

_Round 3 totals: 120 measures · **306 punches**_

---

## Establish the Jab  `establish-the-jab-20`

**100 BPM · 4 rounds × 4:00 work · 100 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/establish-the-jab-20>>
Establish the Jab. Four rounds at one hundred beats. Tonight the jab is home — everything starts there, everything comes back there. Own the range. On the bell.
```

### Round 1 — “The jab is home”

**§1.1 PUMP BAR (single punch, four slots)** — 30 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s1>>
"Pump: ones only, straight time — 15 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s2>>
"One, one, two — straight time, 10 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§1.3 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s3>>
"Long set: ones only, double-time — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§1.4 COMBO BAR** — 15 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s4>>
"One, two, one, one — time-and-a-half, 15 bars."

  [ 1 ][ 2 ][ 1 ][ 1 ]  @1.5x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | one | one
```

**§1.5 PUMP BAR (single punch, four slots)** — 15 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s5>>
"Pump: ones only, time-and-a-half — 15 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 1 totals: 100 measures · **290 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/establish-the-jab-20/r1>>
Good round. Breathe — hands stay up. Next: doubling up. First up when we come back: One, two, one, two. Water if you need it. Ready on the bell.
```

### Round 2 — “Doubling up”

**§2.1 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r2s1>>
"One, two, one, two — straight time, 10 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§2.2 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r2s2>>
"Long set: ones only, double-time — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r2s3>>
"One, one, two — straight time, 15 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§2.4 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r2s4>>
"One, one, one, two — time-and-a-half, 30 bars."

  [ 1 ][ 1 ][ 1 ][ 2 ]  @1.5x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | two
```

_Round 2 totals: 100 measures · **285 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/establish-the-jab-20/r2>>
Good round. Breathe — hands stay up. Next: jab into the cross. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 3 — “Jab into the cross”

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r3s1>>
"Big phrase — two pages: one, one, one, one, one, one, two. straight time, 10 times through."

  [ 1 ][ 1 ][ 1 ][ 1 ][ 1 ][ 1 ][ 2 ][ . ]  @1x   x 10   (7 punches/bar -> 70 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one | one | one | two | (rest)
```

**§3.2 PUMP BAR (single punch, four slots)** — 30 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r3s2>>
"Long set: ones only, double-time — 30 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§3.3 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r3s3>>
"One, two, one, one — straight time, 10 bars."

  [ 1 ][ 2 ][ 1 ][ 1 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | one
```

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r3s4>>
"One, one, two — time-and-a-half, 20 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 3 totals: 100 measures · **290 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/establish-the-jab-20/r3>>
Good round. Breathe — hands stay up. Next: own the range. First up when we come back: Long set: ones only, straight time. Water if you need it. Ready on the bell.
```

### Round 4 — “Own the range”

**§4.1 PUMP BAR (single punch, four slots)** — 40 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r4s1>>
"Long set: ones only, straight time — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§4.2 PUMP BAR (single punch, four slots)** — 40 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r4s2>>
"Long set: ones only, double-time — 40 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 40   (4 punches/bar -> 160 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§4.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r4s3>>
"One, one, two — time-and-a-half, 20 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 4 totals: 100 measures · **300 punches**_

---

## Switch by Round  `switch-by-round`

**85 BPM · 4 rounds × 4:00 work · 85 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/switch-by-round>>
Switch by Round. Four rounds, eighty-five on the click — orthodox, southpaw, orthodox, southpaw. Same hands, opposite world. Stay honest in both. On the bell.
```

### Round 1 — “Orthodox base”  ·  stance: **ORTHODOX**

**§1.1 COMBO BAR** — 32 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r1s1>>
"One, two, one, two — straight time, 16 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r1s2>>
"Two, three, two — straight time, 10 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

**§1.3 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r1s3>>
"One, two, one, two — double-time, 16 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 17 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r1s4>>
"One, two, three — time-and-a-half, 17 bars."

  [ 1 ][ 2 ][ 3 ][ . ]  @1.5x   x 17   (3 punches/bar -> 51 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_Round 1 totals: 85 measures · **209 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/switch-by-round/r1>>
Good round. Breathe — hands stay up. Next: southpaw mirror. First up when we come back: Three, two, three, two. Water if you need it. Ready on the bell.
```

### Round 2 — “Southpaw mirror”  ·  stance: **SOUTHPAW**

**§2.1 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r2s1>>
"Three, two, three, two — straight time, 14 bars."

  [ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | two | three | two
```

**§2.2 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r2s2>>
"One, two, one, two — time-and-a-half, 20 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r2s3>>
"One, one, two — straight time, 10 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§2.4 COMBO BAR** — 17 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r2s4>>
"Two, one, two, one — double-time, 17 bars."

  [ 2 ][ 1 ][ 2 ][ 1 ]  @2x   x 17   (4 punches/bar -> 68 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | one | two | one
```

_Round 2 totals: 85 measures · **234 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/switch-by-round/r2>>
Good round. Breathe — hands stay up. Next: orthodox pressure. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 3 — “Orthodox pressure”  ·  stance: **ORTHODOX**

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 27 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r3s1>>
"Big phrase — two pages: one, two, one, two, two, three, two. straight time, 9 times through."

  [ 1 ][ 2 ][ 1 ][ 2 ][ 2 ][ 3 ][ 2 ][ . ]  @1x   x 9   (7 punches/bar -> 63 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two | two | three | two | (rest)
```

**§3.2 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r3s2>>
"One, two, one, two — double-time, 18 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r3s3>>
"Two, three, two — straight time, 10 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r3s4>>
"Three, two, three — time-and-a-half, 20 bars."

  [ 3 ][ 2 ][ 3 ][ . ]  @1.5x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: three | two | three | (rest)
```

_Round 3 totals: 85 measures · **225 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/switch-by-round/r3>>
Good round. Breathe — hands stay up. Next: southpaw finish. First up when we come back: One, two, three, two. Water if you need it. Ready on the bell.
```

### Round 4 — “Southpaw finish”  ·  stance: **SOUTHPAW**

**§4.1 COMBO BAR** — 32 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r4s1>>
"One, two, three, two — straight time, 16 bars."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

**§4.2 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r4s2>>
"Two, three, two, three — time-and-a-half, 16 bars."

  [ 2 ][ 3 ][ 2 ][ 3 ]  @1.5x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | three
```

**§4.3 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r4s3>>
"One, two, one, two — straight time, 8 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 8   (4 punches/bar -> 32 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§4.4 PUNCTUATED BAR (breath baked into slot 4)** — 21 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r4s4>>
"One, one, two — double-time, 21 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 21   (3 punches/bar -> 63 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 4 totals: 85 measures · **223 punches**_

---

## Heavy Hands  `heavy-hands`

**180 BPM · 4 rounds × 4:00 work · 180 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/heavy-hands>>
Heavy Hands. Four rounds, one-eighty on the click. Hooks and crosses with weight behind them — sit down on every shot. On the bell.
```

### Round 1 — “Sit down on the cross”

**§1.1 COMBO BAR** — 50 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s1>>
"One, two, one, two — straight time, 25 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 25   (4 punches/bar -> 100 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.2 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s2>>
"Three, two, three, two — straight time, 20 bars."

  [ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | two | three | two
```

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s3>>
"Two, three, two — time-and-a-half, 30 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @1.5x   x 30   (3 punches/bar -> 90 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

**§1.4 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s4>>
"One, two, one, two — double-time, 40 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 40   (4 punches/bar -> 160 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.5 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s5>>
"One, one, two — straight time, 10 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 1 totals: 180 measures · **460 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/heavy-hands/r1>>
Good round. Breathe — hands stay up. Next: hooks off the cross. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 2 — “Hooks off the cross”

**§2.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 45 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s1>>
"Big phrase — two pages: one, two, three, two, three, two, three, two. straight time, 15 times through."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 15   (8 punches/bar -> 120 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | three | two | three | two
```

**§2.2 COMBO BAR** — 25 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s2>>
"Two, three, two, three — time-and-a-half, 25 bars."

  [ 2 ][ 3 ][ 2 ][ 3 ]  @1.5x   x 25   (4 punches/bar -> 100 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | three
```

**§2.3 COMBO BAR** — 35 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s3>>
"One, two, one, two — double-time, 35 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 35   (4 punches/bar -> 140 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 40 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s4>>
"Three, two, three — straight time, 20 bars."

  [ 3 ][ 2 ][ 3 ][ . ]  @1x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | two | three | (rest)
```

**§2.5 PUMP BAR (single punch, four slots)** — 35 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s5>>
"Long set: ones only, time-and-a-half — 35 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 35   (4 punches/bar -> 140 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 2 totals: 180 measures · **560 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/heavy-hands/r2>>
Good round. Breathe — hands stay up. Next: double up. First up when we come back: One, two, three, two. Water if you need it. Ready on the bell.
```

### Round 3 — “Double up”

**§3.1 COMBO BAR** — 60 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r3s1>>
"One, two, three, two — straight time, 30 bars."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

**§3.2 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r3s2>>
"Three, two, three, two — double-time, 30 bars."

  [ 3 ][ 2 ][ 3 ][ 2 ]  @2x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: three | two | three | two
```

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 60 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r3s3>>
"Two, three, two — straight time, 30 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @1x   x 30   (3 punches/bar -> 90 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

**§3.4 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r3s4>>
"One, two, one, two — time-and-a-half, 30 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1.5x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_Round 3 totals: 180 measures · **450 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/heavy-hands/r3>>
Good round. Breathe — hands stay up. Next: heavy finish. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 4 — “Heavy finish”

**§4.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 60 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r4s1>>
"Big phrase — two pages: one, one, two, three, two, three, two. straight time, 20 times through."

  [ 1 ][ 1 ][ 2 ][ 3 ][ 2 ][ 3 ][ 2 ][ . ]  @1x   x 20   (7 punches/bar -> 140 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | three | two | three | two | (rest)
```

**§4.2 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r4s2>>
"One, two, one, two — double-time, 40 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 40   (4 punches/bar -> 160 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§4.3 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r4s3>>
"Three, two, three, two — straight time, 20 bars."

  [ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | two | three | two
```

**§4.4 PUNCTUATED BAR (breath baked into slot 4)** — 40 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r4s4>>
"Two, three, two — time-and-a-half, 40 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @1.5x   x 40   (3 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_Round 4 totals: 180 measures · **500 punches**_

---

## Speed Combos  `speed-combos`

**240 BPM · 4 rounds × 4:00 work · 240 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/speed-combos>>
Speed Combos. Four rounds at two-forty — the fastest click we own. Short combinations, quick hands, no wasted motion. Breathe between bars. On the bell.
```

### Round 1 — “Fast hands”

**§1.1 COMBO BAR** — 60 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s1>>
"One, two, one, two — straight time, 30 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 40 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s2>>
"One, one, two — time-and-a-half, 40 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 40   (3 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§1.3 COMBO BAR** — 60 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s3>>
"One, two, one, two — double-time, 60 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 60   (4 punches/bar -> 240 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 40 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s4>>
"Two, three, two — double-time, 40 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @2x   x 40   (3 punches/bar -> 120 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

**§1.5 PUMP BAR (single punch, four slots)** — 40 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s5>>
"Long set: ones only, straight time — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 1 totals: 240 measures · **680 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/speed-combos/r1>>
Good round. Breathe — hands stay up. Next: doubles at pace. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 2 — “Doubles at pace”

**§2.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 60 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r2s1>>
"Big phrase — two pages: one, two, one, two, one, one, two. straight time, 20 times through."

  [ 1 ][ 2 ][ 1 ][ 2 ][ 1 ][ 1 ][ 2 ][ . ]  @1x   x 20   (7 punches/bar -> 140 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two | one | one | two | (rest)
```

**§2.2 COMBO BAR** — 80 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r2s2>>
"One, two, one, two — double-time, 80 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 80   (4 punches/bar -> 320 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§2.3 PUMP BAR (single punch, four slots)** — 40 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r2s3>>
"Long set: ones only, time-and-a-half — 40 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 40   (4 punches/bar -> 160 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§2.4 COMBO BAR** — 60 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r2s4>>
"Two, one, two, one — straight time, 30 bars."

  [ 2 ][ 1 ][ 2 ][ 1 ]  @1x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | one | two | one
```

_Round 2 totals: 240 measures · **740 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/speed-combos/r2>>
Good round. Breathe — hands stay up. Next: pages at speed. First up when we come back: Long set: ones only, double-time. Water if you need it. Ready on the bell.
```

### Round 3 — “Pages at speed”

**§3.1 PUMP BAR (single punch, four slots)** — 40 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s1>>
"Long set: ones only, double-time — 40 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 40   (4 punches/bar -> 160 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§3.2 COMBO BAR** — 80 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s2>>
"One, two, one, two — straight time, 40 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 40   (4 punches/bar -> 160 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 60 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s3>>
"One, two, three — time-and-a-half, 60 bars."

  [ 1 ][ 2 ][ 3 ][ . ]  @1.5x   x 60   (3 punches/bar -> 180 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

**§3.4 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s4>>
"Big phrase — two pages: one, two, one, two, two, three, two. double-time, 20 times through."

  [ 1 ][ 2 ][ 1 ][ 2 ][ 2 ][ 3 ][ 2 ][ . ]  @2x   x 20   (7 punches/bar -> 140 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two | two | three | two | (rest)
```

**§3.5 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s5>>
"One, one, two — double-time, 30 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 30   (3 punches/bar -> 90 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 3 totals: 240 measures · **730 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/speed-combos/r3>>
Good round. Breathe — hands stay up. Next: empty the tank. First up when we come back: One, two, one, two. Water if you need it. Ready on the bell.
```

### Round 4 — “Empty the tank”

**§4.1 COMBO BAR** — 50 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r4s1>>
"One, two, one, two — double-time, 50 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 50   (4 punches/bar -> 200 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§4.2 PUNCTUATED BAR (breath baked into slot 4)** — 50 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r4s2>>
"One, one, two — time-and-a-half, 50 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 50   (3 punches/bar -> 150 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§4.3 COMBO BAR** — 70 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r4s3>>
"One, two, one, two — straight time, 35 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 35   (4 punches/bar -> 140 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§4.4 PUNCTUATED BAR (breath baked into slot 4)** — 70 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r4s4>>
"Two, three, two — double-time, 70 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @2x   x 70   (3 punches/bar -> 210 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_Round 4 totals: 240 measures · **700 punches**_

---

## Uppercut Clinic  `uppercut-clinic`

**85 BPM · 4 rounds × 4:00 work · 85 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/uppercut-clinic>>
Uppercut Clinic. Four rounds, eighty-five on the click. Fives and sixes up the middle — bend the knees, rip them short. On the bell.
```

### Round 1 — “Up the middle”

**§1.1 COMBO BAR** — 32 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r1s1>>
"Five, two, five, two — straight time, 16 bars."

  [ 5 ][ 2 ][ 5 ][ 2 ]  @1x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: five | two | five | two
```

**§1.2 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r1s2>>
"One, six, one, six — straight time, 10 bars."

  [ 1 ][ 6 ][ 1 ][ 6 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | six | one | six
```

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r1s3>>
"Six, five, six — time-and-a-half, 16 bars."

  [ 6 ][ 5 ][ 6 ][ . ]  @1.5x   x 16   (3 punches/bar -> 48 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: six | five | six | (rest)
```

**§1.4 COMBO BAR** — 17 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r1s4>>
"Five, two, five, two — double-time, 17 bars."

  [ 5 ][ 2 ][ 5 ][ 2 ]  @2x   x 17   (4 punches/bar -> 68 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: five | two | five | two
```

_Round 1 totals: 85 measures · **220 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/uppercut-clinic/r1>>
Good round. Breathe — hands stay up. Next: uppercut off the jab. First up when we come back: One, two, five, two. Water if you need it. Ready on the bell.
```

### Round 2 — “Uppercut off the jab”

**§2.1 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r2s1>>
"One, two, five, two — straight time, 14 bars."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

**§2.2 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r2s2>>
"Five, six, five, six — time-and-a-half, 20 bars."

  [ 5 ][ 6 ][ 5 ][ 6 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: five | six | five | six
```

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r2s3>>
"Two, five, two — straight time, 10 bars."

  [ 2 ][ 5 ][ 2 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | five | two | (rest)
```

**§2.4 COMBO BAR** — 17 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r2s4>>
"One, six, one, six — double-time, 17 bars."

  [ 1 ][ 6 ][ 1 ][ 6 ]  @2x   x 17   (4 punches/bar -> 68 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | six | one | six
```

_Round 2 totals: 85 measures · **234 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/uppercut-clinic/r2>>
Good round. Breathe — hands stay up. Next: pairs and pages. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 3 — “Pairs and pages”

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 27 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r3s1>>
"Big phrase — two pages: five, two, five, two, six, five, six. straight time, 9 times through."

  [ 5 ][ 2 ][ 5 ][ 2 ][ 6 ][ 5 ][ 6 ][ . ]  @1x   x 9   (7 punches/bar -> 63 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: five | two | five | two | six | five | six | (rest)
```

**§3.2 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r3s2>>
"Five, six, five, six — double-time, 18 bars."

  [ 5 ][ 6 ][ 5 ][ 6 ]  @2x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: five | six | five | six
```

**§3.3 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r3s3>>
"One, six, three, two — straight time, 10 bars."

  [ 1 ][ 6 ][ 3 ][ 2 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | six | three | two
```

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r3s4>>
"Six, five, six — time-and-a-half, 20 bars."

  [ 6 ][ 5 ][ 6 ][ . ]  @1.5x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: six | five | six | (rest)
```

_Round 3 totals: 85 measures · **235 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/uppercut-clinic/r3>>
Good round. Breathe — hands stay up. Next: clinic finish. First up when we come back: Five, six, five, six. Water if you need it. Ready on the bell.
```

### Round 4 — “Clinic finish”

**§4.1 COMBO BAR** — 32 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r4s1>>
"Five, six, five, six — straight time, 16 bars."

  [ 5 ][ 6 ][ 5 ][ 6 ]  @1x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: five | six | five | six
```

**§4.2 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r4s2>>
"One, two, five, six — time-and-a-half, 16 bars."

  [ 1 ][ 2 ][ 5 ][ 6 ]  @1.5x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | five | six
```

**§4.3 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r4s3>>
"Six, five, two — straight time, 8 bars."

  [ 6 ][ 5 ][ 2 ][ . ]  @1x   x 8   (3 punches/bar -> 24 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: six | five | two | (rest)
```

**§4.4 COMBO BAR** — 21 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r4s4>>
"Five, two, five, two — double-time, 21 bars."

  [ 5 ][ 2 ][ 5 ][ 2 ]  @2x   x 21   (4 punches/bar -> 84 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: five | two | five | two
```

_Round 4 totals: 85 measures · **236 punches**_

---

## Progressive Buildup  `progressive-buildup`

**100 BPM · 4 rounds × 4:00 work · 100 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/progressive-buildup>>
Progressive Buildup. Four rounds at one hundred. We build it one punch at a time — one, then one-two, then one-two-three, then the whole phrase. On the bell.
```

### Round 1 — “One”

**§1.1 PUMP BAR (single punch, four slots)** — 50 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r1s1>>
"Long set: ones only, straight time — 25 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 25   (4 punches/bar -> 100 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§1.2 PUMP BAR (single punch, four slots)** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r1s2>>
"Long set: ones only, time-and-a-half — 30 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§1.3 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r1s3>>
"Long set: ones only, double-time — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 1 totals: 100 measures · **300 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/progressive-buildup/r1>>
Good round. Breathe — hands stay up. Next: one-two. First up when we come back: One, two, one, two. Water if you need it. Ready on the bell.
```

### Round 2 — “One-two”

**§2.1 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r2s1>>
"One, two, one, two — straight time, 20 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§2.2 COAST BAR (rest-heavy — recovery in rhythm)** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r2s2>>
"Coast bar — one, two, then breathe the empty beats. Stay moving."

  [ 1 ][ 2 ][ . ][ . ]  @1x   x 15   (2 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

**§2.3 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r2s3>>
"One, two, one, two — time-and-a-half, 30 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1.5x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_Round 2 totals: 100 measures · **230 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/progressive-buildup/r2>>
Good round. Breathe — hands stay up. Next: one-two-three. First up when we come back: One, two, three. Water if you need it. Ready on the bell.
```

### Round 3 — “One-two-three”

**§3.1 PUNCTUATED BAR (breath baked into slot 4)** — 50 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r3s1>>
"One, two, three — straight time, 25 bars."

  [ 1 ][ 2 ][ 3 ][ . ]  @1x   x 25   (3 punches/bar -> 75 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

**§3.2 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r3s2>>
"One, two, three, two — time-and-a-half, 30 bars."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1.5x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r3s3>>
"One, two, three — double-time, 20 bars."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_Round 3 totals: 100 measures · **255 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/progressive-buildup/r3>>
Good round. Breathe — hands stay up. Next: the whole phrase. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 4 — “The whole phrase”

**§4.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r4s1>>
"Big phrase — two pages: one, two, three, two, one, two, three. straight time, 10 times through."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1 ][ 2 ][ 3 ][ . ]  @1x   x 10   (7 punches/bar -> 70 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one | two | three | (rest)
```

**§4.2 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r4s2>>
"One, two, three, two — straight time, 20 bars."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

**§4.3 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r4s3>>
"Big phrase — two pages: one, two, three, two, one, two, three. double-time, 20 times through."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1 ][ 2 ][ 3 ][ . ]  @2x   x 20   (7 punches/bar -> 140 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one | two | three | (rest)
```

_Round 4 totals: 100 measures · **290 punches**_

---

## Body Work  `body-work`

**100 BPM · 4 rounds × 4:00 work · 100 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/body-work>>
Body Work. Four rounds at one hundred. Downstairs tonight — body jabs, body crosses, dig to the ribs. Elbows in. On the bell.
```

### Round 1 — “Downstairs”

**§1.1 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/body-work/r1s1>>
"One, two-bee, one, two-bee — straight time, 15 bars."

  [ 1 ][ 2b][ 1 ][ 2b]  @1x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | one | two-bee
```

**§1.2 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r1s2>>
"Coast bar — one-bee, two-bee, then breathe the empty beats. Stay moving."

  [ 1b][ 2b][ . ][ . ]  @1x   x 10   (2 punches/bar -> 20 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one-bee | two-bee | (rest) | (rest)
```

**§1.3 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/body-work/r1s3>>
"One, two-bee, one, two-bee — time-and-a-half, 30 bars."

  [ 1 ][ 2b][ 1 ][ 2b]  @1.5x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | one | two-bee
```

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r1s4>>
"One, one-bee, two — double-time, 20 bars."

  [ 1 ][ 1b][ 2 ][ . ]  @2x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one-bee | two | (rest)
```

_Round 1 totals: 100 measures · **260 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/body-work/r1>>
Good round. Breathe — hands stay up. Next: dig to the body. First up when we come back: Two-bee, three-bee, two-bee. Water if you need it. Ready on the bell.
```

### Round 2 — “Dig to the body”

**§2.1 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/body-work/r2s1>>
"Two-bee, three-bee, two-bee — straight time, 15 bars."

  [ 2b][ 3b][ 2b][ . ]  @1x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two-bee | three-bee | two-bee | (rest)
```

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/body-work/r2s2>>
"One, two, three-bee — time-and-a-half, 30 bars."

  [ 1 ][ 2 ][ 3b][ . ]  @1.5x   x 30   (3 punches/bar -> 90 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three-bee | (rest)
```

**§2.3 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r2s3>>
"One-bee, two-bee, one-bee, two-bee — double-time, 20 bars."

  [ 1b][ 2b][ 1b][ 2b]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | two-bee | one-bee | two-bee
```

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r2s4>>
"One, two-bee, three — straight time, 10 bars."

  [ 1 ][ 2b][ 3 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | (rest)
```

_Round 2 totals: 100 measures · **245 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/body-work/r2>>
Good round. Breathe — hands stay up. Next: mixing floors. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 3 — “Mixing floors”

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/body-work/r3s1>>
"Big phrase — two pages: one, two-bee, one, two-bee, three, two-bee, three. straight time, 10 times through."

  [ 1 ][ 2b][ 1 ][ 2b][ 3 ][ 2b][ 3 ][ . ]  @1x   x 10   (7 punches/bar -> 70 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | one | two-bee | three | two-bee | three | (rest)
```

**§3.2 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/body-work/r3s2>>
"Two, three-bee, two — straight time, 15 bars."

  [ 2 ][ 3b][ 2 ][ . ]  @1x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three-bee | two | (rest)
```

**§3.3 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r3s3>>
"One, two-bee, one, two-bee — time-and-a-half, 20 bars."

  [ 1 ][ 2b][ 1 ][ 2b]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | one | two-bee
```

**§3.4 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r3s4>>
"Long set: two-bees only, double-time — 20 bars. Go with the click."

  [ 2b][ 2b][ 2b][ 2b]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two-bee | two-bee | two-bee | two-bee
```

_Round 3 totals: 100 measures · **275 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/body-work/r3>>
Good round. Breathe — hands stay up. Next: body finish. First up when we come back: One, two-bee, three, two-bee. Water if you need it. Ready on the bell.
```

### Round 4 — “Body finish”

**§4.1 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/body-work/r4s1>>
"One, two-bee, three, two-bee — straight time, 20 bars."

  [ 1 ][ 2b][ 3 ][ 2b]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | two-bee
```

**§4.2 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r4s2>>
"Coast bar — one-bee, two-bee, then breathe the empty beats. Stay moving."

  [ 1b][ 2b][ . ][ . ]  @1.5x   x 20   (2 punches/bar -> 40 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one-bee | two-bee | (rest) | (rest)
```

**§4.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r4s3>>
"One, six, three-bee — straight time, 10 bars."

  [ 1 ][ 6 ][ 3b][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | six | three-bee | (rest)
```

**§4.4 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r4s4>>
"One, two-bee, one, two-bee — double-time, 20 bars."

  [ 1 ][ 2b][ 1 ][ 2b]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two-bee | one | two-bee
```

_Round 4 totals: 100 measures · **230 punches**_

---

## Pace Pusher  `pace-pusher`

**180 BPM · 4 rounds × 4:00 work · 180 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/pace-pusher>>
Pace Pusher. Four rounds, one-eighty on the click. Same combination, three speeds — straight time, time-and-a-half, then double-time on the same beat. The ladder never lies. On the bell.
```

### Round 1 — “The ladder”

**§1.1 COMBO BAR** — 60 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r1s1>>
"One, two, one, two — straight time, 30 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.2 COMBO BAR** — 60 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r1s2>>
"One, two, one, two — time-and-a-half, 60 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1.5x   x 60   (4 punches/bar -> 240 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§1.3 COMBO BAR** — 60 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r1s3>>
"One, two, one, two — double-time, 60 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @2x   x 60   (4 punches/bar -> 240 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_Round 1 totals: 180 measures · **600 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/pace-pusher/r1>>
Good round. Breathe — hands stay up. Next: ladder the jab. First up when we come back: One, one, two. Water if you need it. Ready on the bell.
```

### Round 2 — “Ladder the jab”

**§2.1 PUNCTUATED BAR (breath baked into slot 4)** — 50 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r2s1>>
"One, one, two — straight time, 25 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 25   (3 punches/bar -> 75 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 50 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r2s2>>
"One, one, two — time-and-a-half, 50 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 50   (3 punches/bar -> 150 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 50 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r2s3>>
"One, one, two — double-time, 50 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 50   (3 punches/bar -> 150 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

**§2.4 PUMP BAR (single punch, four slots)** — 30 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r2s4>>
"Pump: ones only, straight time — 15 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 2 totals: 180 measures · **435 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/pace-pusher/r2>>
Good round. Breathe — hands stay up. Next: ladder the hook. First up when we come back: Two, three, two. Water if you need it. Ready on the bell.
```

### Round 3 — “Ladder the hook”

**§3.1 PUNCTUATED BAR (breath baked into slot 4)** — 60 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r3s1>>
"Two, three, two — straight time, 30 bars."

  [ 2 ][ 3 ][ 2 ][ . ]  @1x   x 30   (3 punches/bar -> 90 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

**§3.2 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r3s2>>
"Two, three, two, three — time-and-a-half, 40 bars."

  [ 2 ][ 3 ][ 2 ][ 3 ]  @1.5x   x 40   (4 punches/bar -> 160 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | three
```

**§3.3 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r3s3>>
"Two, three, two, three — double-time, 40 bars."

  [ 2 ][ 3 ][ 2 ][ 3 ]  @2x   x 40   (4 punches/bar -> 160 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | three | two | three
```

**§3.4 COMBO BAR** — 40 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r3s4>>
"One, two, one, two — straight time, 20 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_Round 3 totals: 180 measures · **490 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/pace-pusher/r3>>
Good round. Breathe — hands stay up. Next: all rates at once. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 4 — “All rates at once”

**§4.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 36 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s1>>
"Big phrase — two pages: one, two, three, two, three, two, three, two. straight time, 12 times through."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 12   (8 punches/bar -> 96 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | three | two | three | two
```

**§4.2 COMBO BAR** — 36 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s2>>
"One, two, three, two — time-and-a-half, 36 bars."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1.5x   x 36   (4 punches/bar -> 144 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

**§4.3 COMBO BAR** — 36 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s3>>
"One, two, three, two — double-time, 36 bars."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @2x   x 36   (4 punches/bar -> 144 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

**§4.4 COMBO BAR** — 36 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s4>>
"One, two, one, two — time-and-a-half, 36 bars."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1.5x   x 36   (4 punches/bar -> 144 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

**§4.5 PUMP BAR (single punch, four slots)** — 36 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s5>>
"Long set: ones only, double-time — 36 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 36   (4 punches/bar -> 144 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 4 totals: 180 measures · **672 punches**_

---

## Pump & Coast  `pump-and-coast`

**100 BPM · 4 rounds × 4:00 work · 100 measures/round · click audible, coach minimal**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/pump-and-coast>>
Pump and Coast. Four rounds at one hundred. Bursts and breathers — when we pump, you empty it; when we coast, you recover on your feet. On the bell.
```

### Round 1 — “Pump, then breathe”

**§1.1 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s1>>
"Pump: ones only, straight time — 10 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§1.2 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s2>>
"Coast bar — one, then breathe the empty beats. Stay moving."

  [ 1 ][ . ][ . ][ . ]  @1x   x 10   (1 punches/bar -> 10 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | (rest) | (rest)
```

**§1.3 PUMP BAR (single punch, four slots)** — 10 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s3>>
"Pump: twos only, double-time — 10 bars. Go with the click."

  [ 2 ][ 2 ][ 2 ][ 2 ]  @2x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | two | two | two
```

**§1.4 COAST BAR (rest-heavy — recovery in rhythm)** — 30 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s4>>
"Coast bar — one, two, then breathe the empty beats. Stay moving."

  [ 1 ][ . ][ 2 ][ . ]  @1x   x 15   (2 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | two | (rest)
```

**§1.5 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s5>>
"Long set: ones only, time-and-a-half — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 1 totals: 100 measures · **200 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/pump-and-coast/r1>>
Good round. Breathe — hands stay up. Next: coast is a choice. First up when we come back: Pump: ones only, double-time. Water if you need it. Ready on the bell.
```

### Round 2 — “Coast is a choice”

**§2.1 PUMP BAR (single punch, four slots)** — 15 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s1>>
"Pump: ones only, double-time — 15 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§2.2 COAST BAR (rest-heavy — recovery in rhythm)** — 30 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s2>>
"Coast bar — one, then breathe the empty beats. Stay moving."

  [ 1 ][ . ][ . ][ . ]  @1x   x 15   (1 punches/bar -> 15 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | (rest) | (rest)
```

**§2.3 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s3>>
"Pump: twos only, straight time — 10 bars. Go with the click."

  [ 2 ][ 2 ][ 2 ][ 2 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | two | two | two
```

**§2.4 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s4>>
"Coast bar — one, two, then breathe the empty beats. Stay moving."

  [ 1 ][ 2 ][ . ][ . ]  @1x   x 10   (2 punches/bar -> 20 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

**§2.5 PUNCTUATED BAR (breath baked into slot 4)** — 15 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s5>>
"One, one, two — time-and-a-half, 15 bars."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 2 totals: 100 measures · **180 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/pump-and-coast/r2>>
Good round. Breathe — hands stay up. Next: two-page pump. First up when we come back: Big phrase. Water if you need it. Ready on the bell.
```

### Round 3 — “Two-page pump”

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r3s1>>
"Big phrase — two pages: one, one, one, one, two, two, two, two. straight time, 10 times through."

  [ 1 ][ 1 ][ 1 ][ 1 ][ 2 ][ 2 ][ 2 ][ 2 ]  @1x   x 10   (8 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one | two | two | two | two
```

**§3.2 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r3s2>>
"Coast bar — one, two, then breathe the empty beats. Stay moving."

  [ 1 ][ . ][ 2 ][ . ]  @1x   x 10   (2 punches/bar -> 20 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | two | (rest)
```

**§3.3 PUMP BAR (single punch, four slots)** — 30 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r3s3>>
"Long set: ones only, double-time — 30 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§3.4 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r3s4>>
"Coast bar — one, two, then breathe the empty beats. Stay moving."

  [ 1 ][ 2 ][ . ][ . ]  @1.5x   x 20   (2 punches/bar -> 40 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_Round 3 totals: 100 measures · **260 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/pump-and-coast/r3>>
Good round. Breathe — hands stay up. Next: big pump home. First up when we come back: Long set: ones only, straight time. Water if you need it. Ready on the bell.
```

### Round 4 — “Big pump home”

**§4.1 PUMP BAR (single punch, four slots)** — 40 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r4s1>>
"Long set: ones only, straight time — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§4.2 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r4s2>>
"Coast bar — one, then breathe the empty beats. Stay moving."

  [ 1 ][ . ][ . ][ . ]  @1x   x 10   (1 punches/bar -> 10 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | (rest) | (rest)
```

**§4.3 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r4s3>>
"Long set: ones only, double-time — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

**§4.4 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r4s4>>
"Long set: ones only, time-and-a-half — 20 bars. Go with the click."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 4 totals: 100 measures · **250 punches**_

---

## Corpus-bank tally (what this document orders up)

| family | count | bracket |
|---|---|---|
| walkouts | 10 | `<<SINGLE CLIP>>` |
| section lead-ins | 164 | `<<SINGLE CLIP>>` |
| rest scripts | 29 | `<<SINGLE CLIP>>` |
| token components (1-6, fused 1b-6b) | 12 (+ silence) | `[[COMPONENT HITS]]` |

Fused-body rule rides along: every `-bee` component renders from hyphenated text (`"Two-bee"`), never spaced, per the settled A/B/C.
