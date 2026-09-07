# punchCraft — Click-Track Workout Scripts (all 22 predetermined sets)

> Generated from `allClickMaps()` (the running library — the hand-authored `CLICK_MAPS` plus the composed quick catalogue) by `tools/analysis/gen-workout-scripts.ts` — the maps ARE these tables; regenerate after any map edit.
>
> Every spoken element is bracket-tagged for the corpus bank:
>
> - `<<SINGLE CLIP>>` — one unique full utterance: render as ONE clip (walkouts, section lead-ins, rest scripts).
> - `[[COMPONENT HITS]]` — the per-bar layer, REALIZED as loop calls: after a section's first bar, the coach calls the motif every bar ("One, two, one, two!"), fitted under the bar's stride. Pump bars call the single punch. Lead-ins and rest scripts are wired; each round's FIRST lead-in is voiced PRE-BELL (walkout for round one, warn ceremony for the rest), so the bell releases straight into punches.
>
> Bar notation: `[ n ]` = punch slot, `[ . ]` = rest slot. Slot width: `@1x` = 1 beat · `@1.5x` = 2/3 beat · `@2x` = 1/2 beat (double-time under the same click). Stride: 4-slot @1x = 2 measures/rep · @1.5x/@2x = 1 m/rep · 8-slot @1x = 3 m/rep · 8-slot @2x = 1.5 m/rep. The breath after each bar is part of the stride and doubles as the visual page-clear.

---

## Three-Round Fundamentals  `three-round-fundamentals`

**120 BPM · 3 rounds × 4:00 work · 120 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/three-round-fundamentals>>
Three-Round Fundamentals. Three rounds, four minutes each, one-twenty on the click. The basics, done right — jabs, crosses, hooks, walked to the beat. Find your rhythm and keep it. On the bell.
```

### Round 1 — “Build the base”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUMP BAR (single punch, four slots)** — 18 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s1>>
"Pump: ones only, straight time — nine bars. Set the range. Every one comes home."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s2>>
"One, two, one, two — straight time, thirteen bars. Loose shoulders. Let the two arrive behind the one."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s3>>
"One, one, two — straight time, nine bars. Leave the fourth slot open. Reset there."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 9   (3 punches/bar -> 27 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s4>>
"One, two, one — double-time, eighteen bars. Three quick shots, then clear the page."

  [ 1 ][ 2 ][ 1 ][ . ]  @2x   x 16   (3 punches/bar -> 48 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.5 PUNCTUATED BAR (breath baked into slot 4)** — 13 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s5>>
"One, two, three — time-and-a-half, thirteen bars. Turn the three and take the empty slot."

  [ 1 ][ 2 ][ 3 ][ . ]  @1.5x   x 13   (3 punches/bar -> 39 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.6 COMBO BAR** — 10 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s6>>
"Three, two, three, two — straight time, five bars. Short and balanced. Finish each pair back in guard."

  [ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 5   (4 punches/bar -> 20 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.7 PUNCTUATED BAR (breath baked into slot 4)** — 5 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r1s7>>
"One, three, two — time-and-a-half, five bars. One, three, two. Let the last two land together."

  [ 1 ][ 3 ][ 2 ][ . ]  @1.5x   x 5   (3 punches/bar -> 15 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | three | two | (rest)
```

_Round 1 totals: 106 row measures + 14 pad measures = 120 · **237 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/three-round-fundamentals/r1>>
Good first round. Let the arms hang for a breath, then bring the hands back home. Round two changes levels: first set is one, two, one, two — then one-bee, two, three, two on page two. Stay loose and be ready on the bell.
```

### Round 2 — “Change levels”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 27 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s1>>
"Big phrase — two pages: one, two, one, two, one-bee, two, three, two. Straight time, nine times through. Page one stays upstairs. Page two drops the one-bee, then comes right back up."

  [ 1 ][ 2 ][ 1 ][ 2 ][ 1b][ 2 ][ 3 ][ 2 ]  @1x   x 9   (8 punches/bar -> 72 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two | one-bee | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUMP BAR (single punch, four slots)** — 9 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s2>>
"Pump: one-bees only, double-time — nine bars. Touch the body and get the hand straight back."

  [ 1b][ 1b][ 1b][ 1b]  @2x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | one-bee | one-bee | one-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 28 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s3>>
"One, two-bee, three — straight time, fourteen bars. One, two-bee, three. Leave the last slot empty."

  [ 1 ][ 2b][ 3 ][ . ]  @1x   x 14   (3 punches/bar -> 42 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s4>>
"One, two, three, two — time-and-a-half, eighteen bars. Four clean beats. Do not rush the three."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1.5x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.5 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s5>>
"One, four, two, three — straight time, nine bars. Trace the square: one, four, two, three."

  [ 1 ][ 4 ][ 2 ][ 3 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | four | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.6 COMBO BAR** — 10 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r2s6>>
"One-bee, two, one, two — time-and-a-half, ten bars. Start low, finish high. Keep the rhythm even."

  [ 1b][ 2 ][ 1 ][ 2 ]  @1.5x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one-bee | two | one | two
```

_Round 2 totals: 108 row measures + 12 pad measures = 120 · **290 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/three-round-fundamentals/r2>>
That round added the floor change. Take two slow breaths and shake out the shoulders. Last round puts the pieces together; first set is one, two, three, two in straight time. Hear the four-count before the bell.
```

### Round 3 — “Put it together”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 COMBO BAR** — 36 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s1>>
"One, two, three, two — straight time, eighteen bars. This is your home combination. Smooth first, strong finish."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s2>>
"One, five, two, three — straight time, ten bars. Bring the five up the middle, then turn the three."

  [ 1 ][ 5 ][ 2 ][ 3 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | five | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s3>>
"One, one, two — double-time, eighteen bars. Fast double one into two. Fourth slot is your reset."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s4>>
"One, six, three — time-and-a-half, twenty bars. One, six, three. Stay compact and breathe on the empty slot."

  [ 1 ][ 6 ][ 3 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | six | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.5 TWO-PAGE SET (8 slots, paged as 2 bars)** — 18 measures

```text
<<SINGLE CLIP  lead-in/three-round-fundamentals/r3s5>>
"Big phrase — two pages: one, one, two, three, two, five, two, breathe. Straight time, six times through. Page one builds the entry. Page two finishes two, five, two, then breathe."

  [ 1 ][ 1 ][ 2 ][ 3 ][ 2 ][ 5 ][ 2 ][ . ]  @1x   x 6   (7 punches/bar -> 42 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | three | two | five | two | (rest)
```

_Round 3 totals: 110 row measures + 10 pad measures = 120 · **262 punches**_

---

## Establish the Jab  `establish-the-jab-20`

**100 BPM · 4 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/establish-the-jab-20>>
Establish the Jab. Four rounds at one hundred beats. Tonight the jab is home — everything starts there, everything comes back there. Own the range. On the bell.
```

### Round 1 — “The jab is home”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUMP BAR (single punch, four slots)** — 26 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s1>>
"Pump: ones only, straight time — thirteen bars. Touch, recover, touch again. No reaching."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s2>>
"One, one, two — straight time, nine bars. Double one, then two. Fourth slot is quiet."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 9   (3 punches/bar -> 27 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUMP BAR (single punch, four slots)** — 16 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s3>>
"Long set: one-bees only, double-time — eighteen bars. Same lead hand, lower target. Keep your eyes up."

  [ 1b][ 1b][ 1b][ 1b]  @2x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | one-bee | one-bee | one-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 COMBO BAR** — 15 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s4>>
"One, two, one, three — time-and-a-half, fifteen bars. The one comes back before the three turns."

  [ 1 ][ 2 ][ 1 ][ 3 ]  @1.5x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | one | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.5 PUMP BAR (single punch, four slots)** — 15 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r1s5>>
"Pump: ones only, time-and-a-half — fifteen bars. Finish the round owning the lead hand. Crisp, not tense."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 1 totals: 90 row measures + 10 pad measures = 100 · **263 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/establish-the-jab-20/r1>>
Good. You found the lead hand upstairs and downstairs. Next round doubles it and starts turning the corner. First set is one, one, two, three in straight time. Roll the shoulders once and meet the bell ready.
```

### Round 2 — “Double and angle”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r2s1>>
"One, one, two, three — straight time, nine bars. Two ones open the door. Two, three closes it."

  [ 1 ][ 1 ][ 2 ][ 3 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r2s2>>
"One, one, two — double-time, eighteen bars. Quick double one, two, then an empty slot."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 28 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r2s3>>
"One-bee, one, two — straight time, fourteen bars. Low one, high one, two. Reset on four."

  [ 1b][ 1 ][ 2 ][ . ]  @1x   x 14   (3 punches/bar -> 42 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one-bee | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r2s4>>
"One, one, three, two — time-and-a-half, thirty bars. Double one, three, two. Keep the feet underneath you."

  [ 1 ][ 1 ][ 3 ][ 2 ]  @1.5x   x 28   (4 punches/bar -> 112 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | three | two
```

_Round 2 totals: 92 row measures + 8 pad measures = 100 · **244 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/establish-the-jab-20/r2>>
The jab is starting to create openings now. Breathe out long and let the forearms relax. Round three mixes head and body: two pages starting one, one, two, one-bee. Keep the lead hand busy without getting stiff.
```

### Round 3 — “Jab to body and head”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 27 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r3s1>>
"Big phrase — two pages: one, one, two, one-bee, one, two, three, breathe. Straight time, nine times through. Page one ends downstairs. Page two climbs back up one, two, three, then breathe."

  [ 1 ][ 1 ][ 2 ][ 1b][ 1 ][ 2 ][ 3 ][ . ]  @1x   x 9   (7 punches/bar -> 63 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | one-bee | one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 PUMP BAR (single punch, four slots)** — 27 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r3s2>>
"Long set: one-bees only, double-time — twenty-nine bars. Fast body ones. Small bend, fast return."

  [ 1b][ 1b][ 1b][ 1b]  @2x   x 27   (4 punches/bar -> 108 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | one-bee | one-bee | one-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r3s3>>
"One, two, one-bee, two — straight time, ten bars. High, high, low, high. Keep every line straight."

  [ 1 ][ 2 ][ 1b][ 2 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one-bee | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r3s4>>
"One, one, two — time-and-a-half, eighteen bars. Double one, two, breathe. Same rhythm every time."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 3 totals: 92 row measures + 8 pad measures = 100 · **265 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/establish-the-jab-20/r3>>
Three rounds in, the jab should feel like a steering wheel. Last round is range control. First set is ones only in straight time; after that we speed the double one into two. Take a sip if you want it, then hands home.
```

### Round 4 — “Own the range”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 PUMP BAR (single punch, four slots)** — 38 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r4s1>>
"Long set: ones only, straight time — nineteen bars. Long, clean ones. Make the bag meet the end of the punch."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 19   (4 punches/bar -> 76 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 PUNCTUATED BAR (breath baked into slot 4)** — 38 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r4s2>>
"One, one, two — double-time, forty bars. Double one, two, reset. Fast hands without falling in."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 38   (3 punches/bar -> 114 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/establish-the-jab-20/r4s3>>
"One-bee, one, two — time-and-a-half, eighteen bars. Finish low-high-high. Leave the fourth slot empty and finish balanced."

  [ 1b][ 1 ][ 2 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one-bee | one | two | (rest)
```

_Round 4 totals: 94 row measures + 6 pad measures = 100 · **244 punches**_

---

## Switch by Round  `switch-by-round`

**85 BPM · 4 rounds × 4:00 work · 85 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/switch-by-round>>
Switch by Round. Four rounds, eighty-five on the click — orthodox, southpaw, orthodox, southpaw. Same hands, opposite world. Stay honest in both. On the bell.
```

### Round 1 — “Orthodox base”  ·  stance: **ORTHODOX**

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r1s1>>
"One, two, three, two — straight time, fifteen bars. Build it from the lead side and finish behind the rear hand."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r1s2>>
"One, one, two — straight time, eight bars. Double one, two. Fourth slot is your stance check."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 8   (3 punches/bar -> 24 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r1s3>>
"One, two, three — double-time, sixteen bars. Three quick shots. Stop clean before the next bar."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 16   (3 punches/bar -> 48 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 15 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r1s4>>
"One, two-bee, three — time-and-a-half, seventeen bars. One upstairs, two-bee downstairs, three back upstairs."

  [ 1 ][ 2b][ 3 ][ . ]  @1.5x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | (rest)
```

_Round 1 totals: 77 row measures + 8 pad measures = 85 · **177 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/switch-by-round/r1>>
Orthodox round is banked. Square up for a moment, breathe, then put the right foot forward for southpaw. The numbers do not change. First set is still one, two, three, two — make the mirror feel just as honest.
```

### Round 2 — “Southpaw mirror”  ·  stance: **SOUTHPAW**

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r2s1>>
"One, two, three, two — straight time, thirteen bars. Same four numbers, new stance. Do not let the rear foot trail."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r2s2>>
"One, one, two, three — time-and-a-half, eighteen bars. Double one, two, three. Let the stance do the work."

  [ 1 ][ 1 ][ 2 ][ 3 ]  @1.5x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r2s3>>
"One-bee, one, two — straight time, nine bars. Body one, head one, two. Reset your base on four."

  [ 1b][ 1 ][ 2 ][ . ]  @1x   x 9   (3 punches/bar -> 27 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one-bee | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 17 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r2s4>>
"One, two, three — double-time, seventeen bars. Fast one, two, three. Stay centered when the speed rises."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 17   (3 punches/bar -> 51 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_Round 2 totals: 77 row measures + 8 pad measures = 85 · **194 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/switch-by-round/r2>>
Good mirror round. Switch back to orthodox and let the hips settle before the bell. Pressure round next: two pages beginning one, two, three, two. Page two changes level and keeps the same lead-rear logic.
```

### Round 3 — “Orthodox pressure”  ·  stance: **ORTHODOX**

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 24 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r3s1>>
"Big phrase — two pages: one, two, three, two, one-bee, two, three, breathe. Straight time, eight times through. Page one is the clean four. Page two goes body one, two, three, then breathe."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1b][ 2 ][ 3 ][ . ]  @1x   x 8   (7 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one-bee | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 PUNCTUATED BAR (breath baked into slot 4)** — 17 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r3s2>>
"One, one, two — double-time, seventeen bars. Double one, two. Quick burst, clean stop."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 17   (3 punches/bar -> 51 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r3s3>>
"Two, three, two — straight time, nine bars. Two, three, two. Compact and balanced."

  [ 2 ][ 3 ][ 2 ][ . ]  @1x   x 9   (3 punches/bar -> 27 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r3s4>>
"One, six, three — time-and-a-half, twenty bars. One, six, three. Let the six rise, then turn the three."

  [ 1 ][ 6 ][ 3 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | six | three | (rest)
```

_Round 3 totals: 77 row measures + 8 pad measures = 85 · **188 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/switch-by-round/r3>>
One more stance change. Southpaw for the finish. First set is one, two, three, two in straight time, then we add the square and the uppercut entry. Take one slow breath in, long breath out, and set the feet.
```

### Round 4 — “Southpaw finish”  ·  stance: **SOUTHPAW**

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r4s1>>
"One, two, three, two — straight time, fourteen bars. Own the familiar four from the opposite stance."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 COMBO BAR** — 14 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r4s2>>
"One, four, two, three — time-and-a-half, fourteen bars. One, four, two, three. Trace the square without crossing the feet."

  [ 1 ][ 4 ][ 2 ][ 3 ]  @1.5x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | four | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r4s3>>
"One, two, five, two — straight time, eight bars. One, two, five, two. Short five, straight finish."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 8   (4 punches/bar -> 32 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.4 PUNCTUATED BAR (breath baked into slot 4)** — 19 measures

```text
<<SINGLE CLIP  lead-in/switch-by-round/r4s4>>
"One, one, two — double-time, twenty-one bars. Double one, two, breathe. Finish fast and disciplined."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 19   (3 punches/bar -> 57 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 4 totals: 77 row measures + 8 pad measures = 85 · **201 punches**_

---

## Heavy Hands  `heavy-hands`

**120 BPM · 4 rounds × 4:00 work · 120 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/heavy-hands>>
Heavy Hands. Four rounds, one-twenty on the click. Hooks and crosses with weight behind them — sit down on every shot. On the bell.
```

### Round 1 — “Build the power line”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s1>>
"One, two, three — straight time, fifteen bars. One, two, three. Give the power room to land, then reset."

  [ 1 ][ 2 ][ 3 ][ . ]  @1x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 24 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s2>>
"One, two, three, two — straight time, twelve bars. One, two, three, two. Stay heavy without getting slow."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 12   (4 punches/bar -> 48 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s3>>
"Two, three, two — time-and-a-half, eighteen bars. Two, three, two. Sit down, then get back under yourself."

  [ 2 ][ 3 ][ 2 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 24 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s4>>
"One, two, three — double-time, twenty-six bars. Three fast power shots, one empty slot. Do not chase the bag."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 24   (3 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.5 PUNCTUATED BAR (breath baked into slot 4)** — 14 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r1s5>>
"One, one, two — straight time, seven bars. Double one, two. Finish the round behind the straight shot."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 7   (3 punches/bar -> 21 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 1 totals: 110 row measures + 10 pad measures = 120 · **240 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/heavy-hands/r1>>
Good power round. Heavy does not mean tight — open the hands inside the gloves and breathe. Next is hooks off the straight line. First set is two pages: one, two, three, two; then one, four, three, two.
```

### Round 2 — “Hooks off the line”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 27 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s1>>
"Big phrase — two pages: one, two, three, two, one, four, three, two. Straight time, nine times through. Page one finishes three, two. Page two brings the four before the three-two."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1 ][ 4 ][ 3 ][ 2 ]  @1x   x 9   (8 punches/bar -> 72 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one | four | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COMBO BAR** — 15 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s2>>
"One, four, three, two — time-and-a-half, fifteen bars. One, four, three, two. Turn the threes and fours; do not swing them."

  [ 1 ][ 4 ][ 3 ][ 2 ]  @1.5x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | four | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 22 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s3>>
"One, two, three — double-time, twenty-two bars. Fast one, two, three, then space. Power stays organized."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 22   (3 punches/bar -> 66 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 24 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s4>>
"Three, two, three — straight time, twelve bars. Three, two, three. Keep the threes short and bring the two straight home."

  [ 3 ][ 2 ][ 3 ][ . ]  @1x   x 12   (3 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.5 PUNCTUATED BAR (breath baked into slot 4)** — 22 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r2s5>>
"One, three, two — time-and-a-half, twenty-four bars. One, three, two. Turn the corner and finish through the middle."

  [ 1 ][ 3 ][ 2 ][ . ]  @1.5x   x 22   (3 punches/bar -> 66 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | three | two | (rest)
```

_Round 2 totals: 110 row measures + 10 pad measures = 120 · **300 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/heavy-hands/r2>>
That was the hook round. Let the shoulders drop and breathe through the nose if you can. Round three adds uppercuts to the heavy combinations. First set stays one, two, three, two — then we bring the five into the finish.
```

### Round 3 — “Power in layers”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 COMBO BAR** — 36 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r3s1>>
"One, two, three, two — straight time, eighteen bars. Four strong shots, same shape every rep."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r3s2>>
"Three, two, three — double-time, twenty bars. Three, two, three. Quick power, then settle."

  [ 3 ][ 2 ][ 3 ][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: three | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 38 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r3s3>>
"Two, three, two — straight time, nineteen bars. Two, three, two. Keep the chin behind the shoulders."

  [ 2 ][ 3 ][ 2 ][ . ]  @1x   x 19   (3 punches/bar -> 57 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r3s4>>
"One, two, five, two — time-and-a-half, twenty bars. One, two, five, two. Drive the five short and finish straight."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_Round 3 totals: 112 row measures + 8 pad measures = 120 · **263 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/heavy-hands/r3>>
Three done. Shake the arms once and let them get heavy again. Final round starts with a seven-shot two-page chain: one, one, two, three; then two, five, two, breathe. Build pressure without losing form.
```

### Round 4 — “Heavy finish”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 36 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r4s1>>
"Big phrase — two pages: one, one, two, three, two, five, two, breathe. Straight time, twelve times through. Page one gets you in. Page two is two, five, two, then breathe."

  [ 1 ][ 1 ][ 2 ][ 3 ][ 2 ][ 5 ][ 2 ][ . ]  @1x   x 12   (7 punches/bar -> 84 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | three | two | five | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 PUNCTUATED BAR (breath baked into slot 4)** — 24 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r4s2>>
"One, two, three — double-time, twenty-six bars. Fast one, two, three. Leave the fourth slot for balance."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 24   (3 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r4s3>>
"One, four, three, two — straight time, thirteen bars. Square it up: one, four, three, two. Heavy and compact."

  [ 1 ][ 4 ][ 3 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | four | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.4 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/heavy-hands/r4s4>>
"Two, three, two — time-and-a-half, twenty-six bars. Two, three, two. Keep landing clean until the bell."

  [ 2 ][ 3 ][ 2 ][ . ]  @1.5x   x 26   (3 punches/bar -> 78 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_Round 4 totals: 112 row measures + 8 pad measures = 120 · **286 punches**_

---

## Speed Combos  `speed-combos`

**120 BPM · 4 rounds × 4:00 work · 120 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/speed-combos>>
Speed Combos. Four rounds at one-twenty on the click. Short combinations, quick hands, no wasted motion. Breathe between bars. On the bell.
```

### Round 1 — “Fast hands, clean stops”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s1>>
"One, two, one, two — straight time, fourteen bars. Fast does not mean wild. Four straight slots and back to guard."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s2>>
"One, one, two — time-and-a-half, eighteen bars. Double one, two, empty fourth slot. Let the reset stay visible."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 COAST BAR (rest-heavy — recovery in rhythm)** — 26 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s3>>
"Coast bar — one, two, empty, empty, double-time, twenty-eight bars. One, two, then two empty slots. Speed lives inside the pair."

  [ 1 ][ 2 ][ . ][ . ]  @2x   x 26   (2 punches/bar -> 52 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s4>>
"Two, three, two — double-time, eighteen bars. Two, three, two. Three fast hits, then clear the page."

  [ 2 ][ 3 ][ 2 ][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.5 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r1s5>>
"Long set: ones only, straight time — ten bars. Finish with fast clean ones. No reaching."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 1 totals: 110 row measures + 10 pad measures = 120 · **256 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/speed-combos/r1>>
Good speed, now let the hands loosen. Next round is doubles at pace. First set is two pages: one, one, two, one; then two, three, two, breathe. The empty slots matter just as much as the fast ones.
```

### Round 2 — “Doubles at pace”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r2s1>>
"Big phrase — two pages: one, one, two, one, two, three, two, breathe. Straight time, ten times through. Page one doubles the lead and reloads it. Page two finishes two, three, two, then breathe."

  [ 1 ][ 1 ][ 2 ][ 1 ][ 2 ][ 3 ][ 2 ][ . ]  @1x   x 10   (7 punches/bar -> 70 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | one | two | three | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 34 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r2s2>>
"One, one, two — double-time, thirty-six bars. Double one, two. One slot off, then do it again."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 34   (3 punches/bar -> 102 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r2s3>>
"One-bee, one, two — time-and-a-half, eighteen bars. Body one, head one, two. Fast level change, clean exit."

  [ 1b][ 1 ][ 2 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one-bee | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r2s4>>
"One, two, three, two — straight time, fifteen bars. One, two, three, two. Let the four-count breathe even at speed."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_Round 2 totals: 112 row measures + 8 pad measures = 120 · **286 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/speed-combos/r2>>
Two rounds down. Drop the shoulders and slow your breathing. Round three makes you read longer pages at speed. First up is double one, two with the fourth slot open; then the one-two-three-two comes back in straight time.
```

### Round 3 — “Pages at speed”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s1>>
"One, one, two — double-time, eighteen bars. Quick double one, two. Stop on the empty slot."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 COMBO BAR** — 38 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s2>>
"One, two, three, two — straight time, nineteen bars. Four clean slots. Make speed look calm."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 19   (4 punches/bar -> 76 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 25 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s3>>
"One, two, three — time-and-a-half, twenty-seven bars. One, two, three, breathe. Keep the three compact."

  [ 1 ][ 2 ][ 3 ][ . ]  @1.5x   x 25   (3 punches/bar -> 75 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 TWO-PAGE SET (8 slots, paged as 2 bars)** — 15 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s4>>
"Big phrase — two pages: one, two, one, two, three, two, breathe, breathe. Double-time, ten times through. Page one is four straight slots. Page two is three, two, then two empty slots."

  [ 1 ][ 2 ][ 1 ][ 2 ][ 3 ][ 2 ][ . ][ . ]  @2x   x 10   (6 punches/bar -> 60 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two | three | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.5 PUNCTUATED BAR (breath baked into slot 4)** — 14 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r3s5>>
"One, one, two — double-time, fourteen bars. Double one, two, reset. Stay sharp late."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 14   (3 punches/bar -> 42 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 3 totals: 110 row measures + 10 pad measures = 120 · **307 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/speed-combos/r3>>
Last round coming. You do not need to outrun the click; you need to own the openings. First set is one, two, three with the fourth slot empty at double-time. Then we change the shape without changing the discipline.
```

### Round 4 — “Empty the tank cleanly”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 PUNCTUATED BAR (breath baked into slot 4)** — 24 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r4s1>>
"One, two, three — double-time, twenty-four bars. One, two, three, stop. Fast burst, clean recovery."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 24   (3 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 PUNCTUATED BAR (breath baked into slot 4)** — 24 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r4s2>>
"One, one, two — time-and-a-half, twenty-four bars. Double one, two. Keep the lead hand alive."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 24   (3 punches/bar -> 72 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 COMBO BAR** — 34 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r4s3>>
"One, two, five, two — straight time, seventeen bars. One, two, five, two. Speed up the hands, not the posture."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 17   (4 punches/bar -> 68 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.4 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/speed-combos/r4s4>>
"Two, three, two — double-time, thirty-two bars. Two, three, two, empty slot. Last push — stay accurate."

  [ 2 ][ 3 ][ 2 ][ . ]  @2x   x 30   (3 punches/bar -> 90 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_Round 4 totals: 112 row measures + 8 pad measures = 120 · **302 punches**_

---

## Uppercut Clinic  `uppercut-clinic`

**85 BPM · 4 rounds × 4:00 work · 85 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/uppercut-clinic>>
Uppercut Clinic. Four rounds, eighty-five on the click. Fives and sixes up the middle — bend the knees, rip them short. On the bell.
```

### Round 1 — “Find the short line”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r1s1>>
"One, two, five, two — straight time, fifteen bars. One, two, five, two. Keep the five short."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r1s2>>
"One, six, three, two — straight time, eight bars. One, six, three, two. Rise through the six, turn the three."

  [ 1 ][ 6 ][ 3 ][ 2 ]  @1x   x 8   (4 punches/bar -> 32 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | six | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r1s3>>
"Five, six, five — time-and-a-half, sixteen bars. Five, six, five. Three short shots and a reset."

  [ 5 ][ 6 ][ 5 ][ . ]  @1.5x   x 16   (3 punches/bar -> 48 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: five | six | five | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 15 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r1s4>>
"One, five, two — double-time, seventeen bars. One, five, two. Fast and compact, then stop."

  [ 1 ][ 5 ][ 2 ][ . ]  @2x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | five | two | (rest)
```

_Round 1 totals: 77 row measures + 8 pad measures = 85 · **185 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/uppercut-clinic/r1>>
Good. The uppercuts should feel short, not scooped. Next round brings the body into the same lines. First set is one, two, five, two; after that the five-bee starts showing up. Breathe and keep the elbows close.
```

### Round 2 — “Change the level”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r2s1>>
"One, two, five, two — straight time, thirteen bars. Same home combination. Let the five split the straight shots."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r2s2>>
"One, two, five-bee, two — time-and-a-half, eighteen bars. One, two, five-bee, two. Small level change, fast finish."

  [ 1 ][ 2 ][ 5b][ 2 ]  @1.5x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | five-bee | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r2s3>>
"Two, five, two — straight time, nine bars. Two, five, two. Stay over the knees."

  [ 2 ][ 5 ][ 2 ][ . ]  @1x   x 9   (3 punches/bar -> 27 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | five | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 17 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r2s4>>
"One, six, three — double-time, seventeen bars. One, six, three. Quick up the middle and around the side."

  [ 1 ][ 6 ][ 3 ][ . ]  @2x   x 17   (3 punches/bar -> 51 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | six | three | (rest)
```

_Round 2 totals: 77 row measures + 8 pad measures = 85 · **194 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/uppercut-clinic/r2>>
Now you have the head and body uppercut lines. Round three turns them into longer phrases. First set is two pages: one, two, five-bee, two; then one, six-bee, three, breathe. Keep the punches short enough to repeat.
```

### Round 3 — “Pairs and pages”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 24 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r3s1>>
"Big phrase — two pages: one, two, five-bee, two, one, six-bee, three, breathe. Straight time, eight times through. Page one works the five-bee. Page two works the six-bee into three, then breathe."

  [ 1 ][ 2 ][ 5b][ 2 ][ 1 ][ 6b][ 3 ][ . ]  @1x   x 8   (7 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five-bee | two | one | six-bee | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 PUNCTUATED BAR (breath baked into slot 4)** — 17 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r3s2>>
"Five, six, three — double-time, seventeen bars. Five, six, three. Tight burst, clean reset."

  [ 5 ][ 6 ][ 3 ][ . ]  @2x   x 17   (3 punches/bar -> 51 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: five | six | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r3s3>>
"One, six, three, two — straight time, nine bars. One, six, three, two. Finish straight."

  [ 1 ][ 6 ][ 3 ][ 2 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | six | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r3s4>>
"Six, five, two — time-and-a-half, twenty bars. Six, five, two. Keep the six and five underneath the shoulders."

  [ 6 ][ 5 ][ 2 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: six | five | two | (rest)
```

_Round 3 totals: 77 row measures + 8 pad measures = 85 · **197 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/uppercut-clinic/r3>>
One round left. Let the elbows hang for a breath and loosen the forearms. Clinic finish starts one, two, five, two, then one, six-bee, three, two. Short punches, strong posture, ready on the bell.
```

### Round 4 — “Clinic finish”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r4s1>>
"One, two, five, two — straight time, fourteen bars. One, two, five, two. Make it automatic."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 COMBO BAR** — 14 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r4s2>>
"One, six-bee, three, two — time-and-a-half, fourteen bars. One, six-bee, three, two. Body to head without standing tall."

  [ 1 ][ 6b][ 3 ][ 2 ]  @1.5x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | six-bee | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r4s3>>
"Two, five, two — straight time, eight bars. Two, five, two. Three compact shots."

  [ 2 ][ 5 ][ 2 ][ . ]  @1x   x 8   (3 punches/bar -> 24 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | five | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.4 PUNCTUATED BAR (breath baked into slot 4)** — 19 measures

```text
<<SINGLE CLIP  lead-in/uppercut-clinic/r4s4>>
"Five, two, three — double-time, twenty-one bars. Five, two, three. Fast finish, then breathe."

  [ 5 ][ 2 ][ 3 ][ . ]  @2x   x 19   (3 punches/bar -> 57 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: five | two | three | (rest)
```

_Round 4 totals: 77 row measures + 8 pad measures = 85 · **193 punches**_

---

## Progressive Buildup  `progressive-buildup`

**100 BPM · 4 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/progressive-buildup>>
Progressive Buildup. Four rounds at one hundred. We build it one punch at a time — one, then one-two, then one-two-three, then the whole phrase. On the bell.
```

### Round 1 — “Build the entry”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUMP BAR (single punch, four slots)** — 48 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r1s1>>
"Long set: ones only, straight time — twenty-four bars. Start with the one and make every rep look the same."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 24   (4 punches/bar -> 96 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r1s2>>
"One, one, two — time-and-a-half, twenty-eight bars. Now double the one and add the two. Fourth slot stays open."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 26   (3 punches/bar -> 78 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r1s3>>
"One, one, two, three — double-time, twenty bars. Add the three to the end. Keep the build connected."

  [ 1 ][ 1 ][ 2 ][ 3 ]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | three
```

_Round 1 totals: 94 row measures + 6 pad measures = 100 · **254 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/progressive-buildup/r1>>
That is the idea: add without losing what came before. Round two starts with one, two, one, two in straight time, then gives you a coast bar to feel the spacing. Breathe easy and remember the shape.
```

### Round 2 — “Add the two”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 36 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r2s1>>
"One, two, one, two — straight time, eighteen bars. One, two, one, two. Establish the straight rhythm."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COAST BAR (rest-heavy — recovery in rhythm)** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r2s2>>
"Coast bar — one, two, empty, empty, straight time, fifteen bars. One, two, then two empty slots. Let the rhythm keep moving while you reset."

  [ 1 ][ 2 ][ . ][ . ]  @1x   x 15   (2 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r2s3>>
"One, one, two, three — time-and-a-half, thirty bars. Double one, two, three. Carry the entry cleanly into the three."

  [ 1 ][ 1 ][ 2 ][ 3 ]  @1.5x   x 28   (4 punches/bar -> 112 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | three
```

_Round 2 totals: 94 row measures + 6 pad measures = 100 · **214 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/progressive-buildup/r2>>
Good. Now the three becomes part of the chain. First set next round is one, two, three with the fourth slot empty; then we close it with one, two, three, two. Keep building, never scrambling.
```

### Round 3 — “Add the three”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 PUNCTUATED BAR (breath baked into slot 4)** — 46 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r3s1>>
"One, two, three — straight time, twenty-three bars. One, two, three, breathe. Own the three-count."

  [ 1 ][ 2 ][ 3 ][ . ]  @1x   x 23   (3 punches/bar -> 69 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r3s2>>
"One, two, three, two — time-and-a-half, thirty bars. Now close it with the two. Same first three, one more finish."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1.5x   x 28   (4 punches/bar -> 112 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r3s3>>
"One, two, three — double-time, twenty bars. Run the three-count faster, then stop on the empty slot."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_Round 3 totals: 94 row measures + 6 pad measures = 100 · **241 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/progressive-buildup/r3>>
Last round is where the pieces become phrases. First two-page set is one, two, three, two; then one, two, five, breathe. After that the square shows up. Take a breath and see the pages before the bell.
```

### Round 4 — “Build the chain”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r4s1>>
"Big phrase — two pages: one, two, three, two, one, two, five, breathe. Straight time, ten times through. Page one is the familiar four. Page two keeps one, two and changes the finish to five."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1 ][ 2 ][ 5 ][ . ]  @1x   x 10   (7 punches/bar -> 70 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one | two | five | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 COMBO BAR** — 34 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r4s2>>
"One, four, two, three — straight time, eighteen bars. Trace the square: one, four, two, three. New shape, same calm rhythm."

  [ 1 ][ 4 ][ 2 ][ 3 ]  @1x   x 17   (4 punches/bar -> 68 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | four | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/progressive-buildup/r4s3>>
"Big phrase — two pages: one, two, three, two, one, six, three, breathe. Double-time, twenty times through. Page one is one, two, three, two. Page two is one, six, three, breathe. Finish the build strong."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1 ][ 6 ][ 3 ][ . ]  @2x   x 20   (7 punches/bar -> 140 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one | six | three | (rest)
```

_Round 4 totals: 94 row measures + 6 pad measures = 100 · **278 punches**_

---

## Body Work  `body-work`

**100 BPM · 4 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/body-work>>
Body Work. Four rounds at one hundred. Downstairs tonight — body jabs, body crosses, dig to the ribs. Elbows in. On the bell.
```

### Round 1 — “Find the downstairs line”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/body-work/r1s1>>
"One, two-bee, one, two-bee — straight time, thirteen bars. One, two-bee, one, two-bee. Change level without reaching."

  [ 1 ][ 2b][ 1 ][ 2b]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | one | two-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COAST BAR (rest-heavy — recovery in rhythm)** — 18 measures

```text
<<SINGLE CLIP  lead-in/body-work/r1s2>>
"Coast bar — one-bee, two-bee, empty, empty, straight time, nine bars. One-bee, two-bee, then two empty slots. Come back tall and balanced."

  [ 1b][ 2b][ . ][ . ]  @1x   x 9   (2 punches/bar -> 18 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one-bee | two-bee | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/body-work/r1s3>>
"One, two-bee, three-bee, two — time-and-a-half, thirty bars. Head one, body two-bee, body three-bee, head two. Move between floors smoothly."

  [ 1 ][ 2b][ 3b][ 2 ]  @1.5x   x 28   (4 punches/bar -> 112 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | three-bee | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r1s4>>
"One, one-bee, two — double-time, twenty bars. One, one-bee, two. Quick level change, then reset."

  [ 1 ][ 1b][ 2 ][ . ]  @2x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one-bee | two | (rest)
```

_Round 1 totals: 92 row measures + 8 pad measures = 100 · **242 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/body-work/r1>>
Good body work starts with your balance, not with reaching down. Round two digs deeper: first set is two-bee, three-bee, two-bee with the fourth slot open. Keep the elbows close and take a drink only if you need it.
```

### Round 2 — “Dig and come back up”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 PUNCTUATED BAR (breath baked into slot 4)** — 28 measures

```text
<<SINGLE CLIP  lead-in/body-work/r2s1>>
"Two-bee, three-bee, two-bee — straight time, fourteen bars. Two-bee, three-bee, two-bee. Stay compact downstairs."

  [ 2b][ 3b][ 2b][ . ]  @1x   x 14   (3 punches/bar -> 42 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two-bee | three-bee | two-bee | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/body-work/r2s2>>
"One, two, three-bee — time-and-a-half, twenty-eight bars. One, two, three-bee. Head first, then dig."

  [ 1 ][ 2 ][ 3b][ . ]  @1.5x   x 26   (3 punches/bar -> 78 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three-bee | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/body-work/r2s3>>
"One-bee, two-bee, three-bee, two-bee — double-time, eighteen bars. One-bee, two-bee, three-bee, two-bee. Short body burst, no big swings."

  [ 1b][ 2b][ 3b][ 2b]  @2x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | two-bee | three-bee | two-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r2s4>>
"One, two-bee, three — straight time, ten bars. One, two-bee, three. Drop the level and come right back upstairs."

  [ 1 ][ 2b][ 3 ][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | (rest)
```

_Round 2 totals: 92 row measures + 8 pad measures = 100 · **222 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/body-work/r2>>
You have the basic body lines. Next round mixes floors and sides. First two pages are one, two-bee, three, two; then one-bee, four-bee, three, breathe. Keep your eyes up while the targets change.
```

### Round 3 — “Mix the floors”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 27 measures

```text
<<SINGLE CLIP  lead-in/body-work/r3s1>>
"Big phrase — two pages: one, two-bee, three, two, one-bee, four-bee, three, breathe. Straight time, nine times through. Page one goes head-body-head-head. Page two opens body one-bee, four-bee, three, then breathe."

  [ 1 ][ 2b][ 3 ][ 2 ][ 1b][ 4b][ 3 ][ . ]  @1x   x 9   (7 punches/bar -> 63 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | two | one-bee | four-bee | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 PUNCTUATED BAR (breath baked into slot 4)** — 28 measures

```text
<<SINGLE CLIP  lead-in/body-work/r3s2>>
"Two, three-bee, two — straight time, fourteen bars. Two, three-bee, two. Dig and get out."

  [ 2 ][ 3b][ 2 ][ . ]  @1x   x 14   (3 punches/bar -> 42 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three-bee | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 COMBO BAR** — 19 measures

```text
<<SINGLE CLIP  lead-in/body-work/r3s3>>
"One, two-bee, five-bee, two — time-and-a-half, nineteen bars. One, two-bee, five-bee, two. Straight, body, up the middle, finish."

  [ 1 ][ 2b][ 5b][ 2 ]  @1.5x   x 19   (4 punches/bar -> 76 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | five-bee | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/body-work/r3s4>>
"One-bee, two-bee, three-bee — double-time, twenty bars. One-bee, two-bee, three-bee. Three body shots, then breathe."

  [ 1b][ 2b][ 3b][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | two-bee | three-bee | (rest)
```

_Round 3 totals: 92 row measures + 8 pad measures = 100 · **235 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/body-work/r3>>
Last round. Let the ribs expand on a long inhale and keep the hands relaxed. First set is one, two-bee, three, four-bee in straight time. Then we coast briefly before the six-bee and five-bee finishes.
```

### Round 4 — “Body finish”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 COMBO BAR** — 34 measures

```text
<<SINGLE CLIP  lead-in/body-work/r4s1>>
"One, two-bee, three, four-bee — straight time, seventeen bars. One, two-bee, three, four-bee. Alternate floors without losing the stance."

  [ 1 ][ 2b][ 3 ][ 4b]  @1x   x 17   (4 punches/bar -> 68 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | four-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 COAST BAR (rest-heavy — recovery in rhythm)** — 18 measures

```text
<<SINGLE CLIP  lead-in/body-work/r4s2>>
"Coast bar — one-bee, two-bee, empty, empty, time-and-a-half, twenty bars. One-bee, two-bee, then empty beats. Recover while you stay in rhythm."

  [ 1b][ 2b][ . ][ . ]  @1.5x   x 18   (2 punches/bar -> 36 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one-bee | two-bee | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r4s3>>
"One, six-bee, three-bee — straight time, ten bars. One, six-bee, three-bee. Stay compact through all three numbers."

  [ 1 ][ 6b][ 3b][ . ]  @1x   x 10   (3 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | six-bee | three-bee | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.4 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/body-work/r4s4>>
"One, two-bee, five-bee, two — double-time, twenty bars. One, two-bee, five-bee, two. Finish the body round with clean lines."

  [ 1 ][ 2b][ 5b][ 2 ]  @2x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two-bee | five-bee | two
```

_Round 4 totals: 92 row measures + 8 pad measures = 100 · **214 punches**_

---

## Pace Pusher  `pace-pusher`

**120 BPM · 4 rounds × 4:00 work · 120 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/pace-pusher>>
Pace Pusher. Four rounds, one-twenty on the click. Same combination, three speeds — straight time, time-and-a-half, then double-time on the same beat. The ladder never lies. On the bell.
```

### Round 1 — “The one-two ladder”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COAST BAR (rest-heavy — recovery in rhythm)** — 38 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r1s1>>
"Coast bar — one, two, empty, empty, straight time, nineteen bars. One, two, then space. Learn the pair before you accelerate it."

  [ 1 ][ 2 ][ . ][ . ]  @1x   x 19   (2 punches/bar -> 38 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COAST BAR (rest-heavy — recovery in rhythm)** — 37 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r1s2>>
"Coast bar — one, two, empty, empty, time-and-a-half, thirty-nine bars. Same one-two, quicker slots, same empty finish."

  [ 1 ][ 2 ][ . ][ . ]  @1.5x   x 37   (2 punches/bar -> 74 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 COAST BAR (rest-heavy — recovery in rhythm)** — 39 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r1s3>>
"Coast bar — one, two, empty, empty, double-time, thirty-nine bars. Same pair at double-time. Two fast shots, two empty slots. Stay clean."

  [ 1 ][ 2 ][ . ][ . ]  @2x   x 39   (2 punches/bar -> 78 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_Round 1 totals: 114 row measures + 6 pad measures = 120 · **190 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/pace-pusher/r1>>
First ladder is done. The next one adds a second one before the two. First set is one, one, two with the fourth slot empty in straight time; then the exact same shape climbs the rates. Breathe and keep the shoulders loose.
```

### Round 2 — “Ladder the double one”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 PUNCTUATED BAR (breath baked into slot 4)** — 32 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r2s1>>
"One, one, two — straight time, sixteen bars. One, one, two. Establish the spacing."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 16   (3 punches/bar -> 48 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 29 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r2s2>>
"One, one, two — time-and-a-half, thirty-one bars. Same three shots, time-and-a-half. Do not compress the last two together."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 29   (3 punches/bar -> 87 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 31 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r2s3>>
"One, one, two — double-time, thirty-one bars. Same double one, two at double-time. Fast but readable."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 31   (3 punches/bar -> 93 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUMP BAR (single punch, four slots)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r2s4>>
"Pump: one-bees only, straight time — ten bars. Close the round with body ones. Change the target, keep the clock."

  [ 1b][ 1b][ 1b][ 1b]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one-bee | one-bee | one-bee | one-bee
```

_Round 2 totals: 112 row measures + 8 pad measures = 120 · **268 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/pace-pusher/r2>>
Good. Round three changes the ladder shape to one, two, three, then an empty slot. Same rule: straight, time-and-a-half, double. The hook should arrive on time, not early.
```

### Round 3 — “Ladder the hook”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 PUNCTUATED BAR (breath baked into slot 4)** — 38 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r3s1>>
"One, two, three — straight time, nineteen bars. One, two, three. Let the three finish the phrase."

  [ 1 ][ 2 ][ 3 ][ . ]  @1x   x 19   (3 punches/bar -> 57 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 PUNCTUATED BAR (breath baked into slot 4)** — 23 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r3s2>>
"One, two, three — time-and-a-half, twenty-five bars. Same one, two, three. Quicker grid, same shape."

  [ 1 ][ 2 ][ 3 ][ . ]  @1.5x   x 23   (3 punches/bar -> 69 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 PUNCTUATED BAR (breath baked into slot 4)** — 25 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r3s3>>
"One, two, three — double-time, twenty-five bars. Same three at double-time. Fast hands, empty fourth slot."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 25   (3 punches/bar -> 75 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r3s4>>
"One, two, three, two — straight time, thirteen bars. Add the final two and settle back into straight time."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_Round 3 totals: 112 row measures + 8 pad measures = 120 · **253 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/pace-pusher/r3>>
Final ladder mixes everything you have used. First is two pages: one, two, three, two; then one, two, five, two. After that the same four-shot ideas move through the faster grids. Hear the tempo and let it pull you, not rush you.
```

### Round 4 — “All rates at once”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 24 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s1>>
"Big phrase — two pages: one, two, three, two, one, two, five, two. Straight time, eight times through. Page one is one, two, three, two. Page two changes only the middle to five."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 8   (8 punches/bar -> 64 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s2>>
"One, two, three, two — time-and-a-half, twenty-two bars. One, two, three, two at time-and-a-half. Stay smooth."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 PUNCTUATED BAR (breath baked into slot 4)** — 22 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s3>>
"One, two, three — double-time, twenty-two bars. One, two, three at double-time, then an empty slot."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 22   (3 punches/bar -> 66 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.4 COMBO BAR** — 22 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s4>>
"One, two, five, two — time-and-a-half, twenty-two bars. One, two, five, two. Same rate, different finish."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1.5x   x 22   (4 punches/bar -> 88 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.5 PUNCTUATED BAR (breath baked into slot 4)** — 22 measures

```text
<<SINGLE CLIP  lead-in/pace-pusher/r4s5>>
"One, one, two — double-time, twenty-two bars. Double one, two at double-time. Finish the ladder clean."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 22   (3 punches/bar -> 66 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 4 totals: 110 row measures + 10 pad measures = 120 · **364 punches**_

---

## Pump & Coast  `pump-and-coast`

**100 BPM · 4 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/pump-and-coast>>
Pump and Coast. Four rounds at one hundred. Bursts and breathers — when we pump, you empty it; when we coast, you recover on your feet. On the bell.
```

### Round 1 — “Pump, then breathe”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUMP BAR (single punch, four slots)** — 18 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s1>>
"Pump: ones only, straight time — nine bars. Pump the ones. Stay long and keep them coming."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COAST BAR (rest-heavy — recovery in rhythm)** — 16 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s2>>
"Coast bar — one, empty, empty, empty, straight time, eight bars. One touch, three empty slots. Move, breathe, stay ready."

  [ 1 ][ . ][ . ][ . ]  @1x   x 8   (1 punches/bar -> 8 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUMP BAR (single punch, four slots)** — 10 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s3>>
"Pump: twos only, double-time — ten bars. Pump the twos in a short burst. Keep the shoulder behind them."

  [ 2 ][ 2 ][ 2 ][ 2 ]  @2x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | two | two | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 COAST BAR (rest-heavy — recovery in rhythm)** — 28 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s4>>
"Coast bar — one, empty, two, empty, straight time, fourteen bars. One, empty, two, empty. Let the coast stay active."

  [ 1 ][ . ][ 2 ][ . ]  @1x   x 14   (2 punches/bar -> 28 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.5 PUMP BAR (single punch, four slots)** — 18 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r1s5>>
"Long set: one-bees only, time-and-a-half — twenty bars. Pump the one-bees. Small level change, fast return."

  [ 1b][ 1b][ 1b][ 1b]  @1.5x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one-bee | one-bee | one-bee | one-bee
```

_Round 1 totals: 90 row measures + 10 pad measures = 100 · **184 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/pump-and-coast/r1>>
That is the rhythm: work, recover, stay alive. Round two changes the pump targets. First is threes only at double-time, then a long one-touch coast. Let the breathing come down without standing still.
```

### Round 2 — “Change the pump”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 PUMP BAR (single punch, four slots)** — 13 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s1>>
"Pump: threes only, double-time — thirteen bars. Pump the threes. Short turn, fast recovery."

  [ 3 ][ 3 ][ 3 ][ 3 ]  @2x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: three | three | three | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COAST BAR (rest-heavy — recovery in rhythm)** — 28 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s2>>
"Coast bar — one, empty, empty, empty, straight time, fourteen bars. One touch, three empty slots. Circle in place and breathe."

  [ 1 ][ . ][ . ][ . ]  @1x   x 14   (1 punches/bar -> 14 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUMP BAR (single punch, four slots)** — 18 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s3>>
"Pump: fives only, straight time — nine bars. Pump the fives. Keep them short and underneath you."

  [ 5 ][ 5 ][ 5 ][ 5 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: five | five | five | five
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 COAST BAR (rest-heavy — recovery in rhythm)** — 18 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s4>>
"Coast bar — one, two, empty, empty, straight time, nine bars. One, two, then two empty slots. Recover behind the pair."

  [ 1 ][ 2 ][ . ][ . ]  @1x   x 9   (2 punches/bar -> 18 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.5 PUNCTUATED BAR (breath baked into slot 4)** — 13 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r2s5>>
"One, one, two — time-and-a-half, fifteen bars. Double one, two, breathe. Bring the round back together."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 13   (3 punches/bar -> 39 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 2 totals: 90 row measures + 10 pad measures = 100 · **159 punches**_

### Rest 2 → 3  (1:00)

```text
<<SINGLE CLIP  rest/pump-and-coast/r2>>
Good. Round three turns the pump into a two-page sequence. First page is one, one, one, two; second page is three, two, three, two. Then we coast and come back to a fast body-one pump.
```

### Round 3 — “Two-page pump”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§3.1 TWO-PAGE SET (8 slots, paged as 2 bars)** — 27 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r3s1>>
"Big phrase — two pages: one, one, one, two, three, two, three, two. Straight time, nine times through. Page one builds behind the ones. Page two rolls three, two, three, two."

  [ 1 ][ 1 ][ 1 ][ 2 ][ 3 ][ 2 ][ 3 ][ 2 ]  @1x   x 9   (8 punches/bar -> 72 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | two | three | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.2 COAST BAR (rest-heavy — recovery in rhythm)** — 18 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r3s2>>
"Coast bar — one, empty, two, empty, straight time, nine bars. One, empty, two, empty. Let the heartbeat come down."

  [ 1 ][ . ][ 2 ][ . ]  @1x   x 9   (2 punches/bar -> 18 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.3 PUMP BAR (single punch, four slots)** — 27 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r3s3>>
"Long set: one-bees only, double-time — twenty-nine bars. Pump the one-bees. Fast touch downstairs, eyes up."

  [ 1b][ 1b][ 1b][ 1b]  @2x   x 27   (4 punches/bar -> 108 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | one-bee | one-bee | one-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§3.4 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r3s4>>
"Coast bar — one, two, empty, empty, time-and-a-half, twenty bars. One, two, then space. Stay loose in the coast."

  [ 1 ][ 2 ][ . ][ . ]  @1.5x   x 20   (2 punches/bar -> 40 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_Round 3 totals: 92 row measures + 8 pad measures = 100 · **238 punches**_

### Rest 3 → 4  (1:00)

```text
<<SINGLE CLIP  rest/pump-and-coast/r3>>
One last round. We start with steady ones, coast, then turn the final half into combinations. First set is ones only in straight time. Save enough to make the last one-two-three-two look clean.
```

### Round 4 — “Big pump home”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§4.1 PUMP BAR (single punch, four slots)** — 34 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r4s1>>
"Long set: ones only, straight time — seventeen bars. Long steady ones. Build pressure without squeezing the shoulders."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 17   (4 punches/bar -> 68 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.2 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r4s2>>
"Coast bar — one, empty, empty, empty, straight time, ten bars. One touch, three empty slots. Get your breath back on your feet."

  [ 1 ][ . ][ . ][ . ]  @1x   x 10   (1 punches/bar -> 10 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r4s3>>
"One, one, two — double-time, twenty bars. Double one, two, reset. Short fast burst."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§4.4 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/pump-and-coast/r4s4>>
"One, two, three, two — time-and-a-half, twenty bars. One, two, three, two. Finish the workout with a full combination."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_Round 4 totals: 92 row measures + 8 pad measures = 100 · **212 punches**_

---

## Jab School  `quick-jab-school`

**100 BPM · 2 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-jab-school>>
Jab School. Two rounds at one hundred. The lead hand is home — touch, return, double it. On the bell.
```

### Round 1 — “Touch and return”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUMP BAR (single punch, four slots)** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-jab-school/r1s1>>
"Pump: ones only, straight time — thirteen bars. Touch, recover, touch again. No reaching."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-jab-school/r1s2>>
"One, one, two — straight time, nine bars. Double the lead, then the rear hand. The fourth slot is quiet."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 9   (3 punches/bar -> 27 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-jab-school/r1s3>>
"One-bee, one, two — time-and-a-half, eighteen bars. Body one-bee, head one, then the rear hand. Reset on the empty slot."

  [ 1b][ 1 ][ 2 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one-bee | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-jab-school/r1s4>>
"One, one, two — double-time, thirty bars. Quick double one, two. Stay long, stay loose."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 30   (3 punches/bar -> 90 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_Round 1 totals: 92 row measures + 8 pad measures = 100 · **223 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-jab-school/r1>>
Good. The lead hand is home. Round two puts the rear hand behind it — first set is one, two, one, two in straight time, then body ones at double-time. Roll the shoulders once and meet the bell ready.
```

### Round 2 — “Double and go”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/quick-jab-school/r2s1>>
"One, two, one, two — straight time, fourteen bars. Let the rear hand arrive behind the lead."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUMP BAR (single punch, four slots)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-jab-school/r2s2>>
"Pump: one-bees only, double-time — eighteen bars. Small bend, fast return, eyes up."

  [ 1b][ 1b][ 1b][ 1b]  @2x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | one-bee | one-bee | one-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/quick-jab-school/r2s3>>
"One, one, two, three — time-and-a-half, sixteen bars. Double the lead to open the door; the rear hand and the hook close it."

  [ 1 ][ 1 ][ 2 ][ 3 ]  @1.5x   x 16   (4 punches/bar -> 64 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUMP BAR (single punch, four slots)** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-jab-school/r2s4>>
"Pump: ones only, time-and-a-half — thirty bars. Finish the round owning the lead hand. Crisp, not tense."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1.5x   x 30   (4 punches/bar -> 120 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_Round 2 totals: 92 row measures + 8 pad measures = 100 · **312 punches**_

---

## One-Two  `quick-one-two`

**120 BPM · 2 rounds × 4:00 work · 120 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-one-two>>
One-Two. Two rounds, one-twenty on the click. The straight pair at three speeds, then the double jab in front of it. On the bell.
```

### Round 1 — “The pair at three speeds”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COAST BAR (rest-heavy — recovery in rhythm)** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-one-two/r1s1>>
"Coast bar — one, two, empty, empty, straight time, fifteen bars. One, two, then two quiet slots. Set the range."

  [ 1 ][ 2 ][ . ][ . ]  @1x   x 15   (2 punches/bar -> 30 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/quick-one-two/r1s2>>
"One, two, one, two — straight time, fourteen bars. Four straight slots and back to guard."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 COAST BAR (rest-heavy — recovery in rhythm)** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-one-two/r1s3>>
"Coast bar — one, two, empty, empty, time-and-a-half, twenty-six bars. Same pair, a little quicker. The reset stays visible."

  [ 1 ][ 2 ][ . ][ . ]  @1.5x   x 26   (2 punches/bar -> 52 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 COAST BAR (rest-heavy — recovery in rhythm)** — 28 measures

```text
<<SINGLE CLIP  lead-in/quick-one-two/r1s4>>
"Coast bar — one, two, empty, empty, double-time, twenty-eight bars. Speed lives inside the pair, not in the reset."

  [ 1 ][ 2 ][ . ][ . ]  @2x   x 28   (2 punches/bar -> 56 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_Round 1 totals: 112 row measures + 8 pad measures = 120 · **194 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-one-two/r1>>
That is the pair at every speed. Round two puts the double jab in front of it — first set is one, one, two with the fourth slot open, straight time. Breathe out long and come back to guard.
```

### Round 2 — “Double the lead, keep the two”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 PUNCTUATED BAR (breath baked into slot 4)** — 32 measures

```text
<<SINGLE CLIP  lead-in/quick-one-two/r2s1>>
"One, one, two — straight time, sixteen bars. Double the lead, then the rear hand. Let the pause after it show."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 16   (3 punches/bar -> 48 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 24 measures

```text
<<SINGLE CLIP  lead-in/quick-one-two/r2s2>>
"One, one, two — time-and-a-half, twenty-four bars. Same shape, quicker hands, same stance."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 24   (3 punches/bar -> 72 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-one-two/r2s3>>
"One, one, two — double-time, thirty bars. Quick double one, two. Stop clean on the empty slot."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 30   (3 punches/bar -> 90 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-one-two/r2s4>>
"One, two, one, two — time-and-a-half, twenty-six bars. Finish with the pair twice through. Fast, never wild."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1.5x   x 26   (4 punches/bar -> 104 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_Round 2 totals: 112 row measures + 8 pad measures = 120 · **314 punches**_

---

## Hook Line  `quick-hook-line`

**100 BPM · 2 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-hook-line>>
Hook Line. Two rounds at one hundred. Hooks come off the straight line — then both hooks, back to back. On the bell.
```

### Round 1 — “Hooks off the line”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-hook-line/r1s1>>
"One, two, three — straight time, fifteen bars. Straight, straight, then turn the hook over. Pivot the lead foot."

  [ 1 ][ 2 ][ 3 ][ . ]  @1x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-hook-line/r1s2>>
"One, two, three, two — straight time, thirteen bars. The four-count. Let the final cross land behind the hook."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-hook-line/r1s3>>
"Three, two, three — time-and-a-half, eighteen bars. Hook, cross, hook. Keep the elbow up on both threes."

  [ 3 ][ 2 ][ 3 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: three | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-hook-line/r1s4>>
"One, two, three, four — straight time, nine bars. Both hooks close the bar. Turn the hips, not the shoulders."

  [ 1 ][ 2 ][ 3 ][ 4 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | four
```

_Round 1 totals: 92 row measures + 8 pad measures = 100 · **187 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-hook-line/r1>>
Hooks come off the line, never instead of it. Round two is both hooks — first set is one, two, three, four in straight time, then the hooks alone. Shake the arms out and stay tall.
```

### Round 2 — “Both hooks”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-hook-line/r2s1>>
"One, two, three, four — straight time, thirteen bars. Straight line, then both hooks. Short and turned over."

  [ 1 ][ 2 ][ 3 ][ 4 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | four
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-hook-line/r2s2>>
"Three, four, three, four — straight time, ten bars. Hooks only. Sit down on each hook and keep the guard."

  [ 3 ][ 4 ][ 3 ][ 4 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | four | three | four
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-hook-line/r2s3>>
"One, four, three, two — time-and-a-half, twenty bars. Jab, rear hook, lead hook, cross. Weight moves side to side."

  [ 1 ][ 4 ][ 3 ][ 2 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | four | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-hook-line/r2s4>>
"One, two, three — double-time, twenty-six bars. Fast one, two, then the hook. Finish with the elbow up."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 26   (3 punches/bar -> 78 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_Round 2 totals: 92 row measures + 8 pad measures = 100 · **250 punches**_

---

## The Square  `quick-square`

**100 BPM · 2 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-square>>
The Square. Two rounds at one hundred. Trace it — one, four, two, three — then close it with the four-count. On the bell.
```

### Round 1 — “Trace the square”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-square/r1s1>>
"One, four, two, three — straight time, nine bars. Trace the square: corner, corner, corner, corner."

  [ 1 ][ 4 ][ 2 ][ 3 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | four | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-square/r1s2>>
"One, two, three, four — straight time, nine bars. Same corners, walked in order. Feet under you."

  [ 1 ][ 2 ][ 3 ][ 4 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | four
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 COMBO BAR** — 14 measures

```text
<<SINGLE CLIP  lead-in/quick-square/r1s3>>
"One, four, two, three — time-and-a-half, fourteen bars. The square, quicker. Do not cut the corners."

  [ 1 ][ 4 ][ 2 ][ 3 ]  @1.5x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | four | two | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 TWO-PAGE SET (8 slots, paged as 2 bars)** — 42 measures

```text
<<SINGLE CLIP  lead-in/quick-square/r1s4>>
"Big phrase — two pages: one, two, three, two, one, four, three, two. Straight time, fourteen times through. Page one is the four-count. Page two crosses the square."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1 ][ 4 ][ 3 ][ 2 ]  @1x   x 14   (8 punches/bar -> 112 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one | four | three | two
```

_Round 1 totals: 92 row measures + 8 pad measures = 100 · **240 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-square/r1>>
You have the square from both corners. Round two closes it — first set is one, four, three, two in straight time, then the hooks alone. Long breath in, shoulders down.
```

### Round 2 — “Close the square”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-square/r2s1>>
"One, four, three, two — straight time, thirteen bars. Jab, rear hook, lead hook, cross. Close the square every bar."

  [ 1 ][ 4 ][ 3 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | four | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-square/r2s2>>
"Three, four, three, four — straight time, ten bars. Hooks only, both sides. Rotate through the floor."

  [ 3 ][ 4 ][ 3 ][ 4 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: three | four | three | four
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-square/r2s3>>
"One, two, three, four — time-and-a-half, twenty bars. The corners in order, quicker. Chin down through the hooks."

  [ 1 ][ 2 ][ 3 ][ 4 ]  @1.5x   x 20   (4 punches/bar -> 80 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | four
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-square/r2s4>>
"One, four, three, two — double-time, twenty-six bars. Fast square. Finish the round with the cross landing last."

  [ 1 ][ 4 ][ 3 ][ 2 ]  @2x   x 26   (4 punches/bar -> 104 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | four | three | two
```

_Round 2 totals: 92 row measures + 8 pad measures = 100 · **276 punches**_

---

## Uppercut Lane  `quick-uppercut-lane`

**85 BPM · 2 rounds × 4:00 work · 85 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-uppercut-lane>>
Uppercut Lane. Two rounds, eighty-five on the click. Short uppercuts up the middle, both hands. Bend the knees. On the bell.
```

### Round 1 — “Short line up the middle”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-uppercut-lane/r1s1>>
"One, two, five, two — straight time, thirteen bars. Straight, straight, up the middle, straight. Bend the knees on the way up."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/quick-uppercut-lane/r1s2>>
"Five, six, five — time-and-a-half, sixteen bars. Uppercuts only, lead, rear, lead. Rip them short."

  [ 5 ][ 6 ][ 5 ][ . ]  @1.5x   x 16   (3 punches/bar -> 48 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: five | six | five | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/quick-uppercut-lane/r1s3>>
"One, six, three, two — straight time, eight bars. Jab, rear uppercut, hook, cross. Level up, then over."

  [ 1 ][ 6 ][ 3 ][ 2 ]  @1x   x 8   (4 punches/bar -> 32 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | six | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 19 measures

```text
<<SINGLE CLIP  lead-in/quick-uppercut-lane/r1s4>>
"One, five, two — double-time, nineteen bars. Jab, lead uppercut, cross. Quick up the middle, then finish long."

  [ 1 ][ 5 ][ 2 ][ . ]  @2x   x 19   (3 punches/bar -> 57 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | five | two | (rest)
```

_Round 1 totals: 77 row measures + 8 pad measures = 85 · **189 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-uppercut-lane/r1>>
Uppercuts start in the legs, not the arms. Round two brings both hands up the middle — first set is one, two, five, six in straight time. Take one breath, keep the knees soft.
```

### Round 2 — “Both uppercuts, then finish”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 24 measures

```text
<<SINGLE CLIP  lead-in/quick-uppercut-lane/r2s1>>
"One, two, five, six — straight time, twelve bars. Straight line, then both uppercuts. Stay compact on the way up."

  [ 1 ][ 2 ][ 5 ][ 6 ]  @1x   x 12   (4 punches/bar -> 48 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | six
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COMBO BAR** — 16 measures

```text
<<SINGLE CLIP  lead-in/quick-uppercut-lane/r2s2>>
"Six, three, six, three — straight time, eight bars. Rear uppercut, hook, rear uppercut, hook. Up, then around."

  [ 6 ][ 3 ][ 6 ][ 3 ]  @1x   x 8   (4 punches/bar -> 32 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: six | three | six | three
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-uppercut-lane/r2s3>>
"Two, five, two — time-and-a-half, eighteen bars. Cross, lead uppercut, cross. Keep the rear hand busy."

  [ 2 ][ 5 ][ 2 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | five | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 19 measures

```text
<<SINGLE CLIP  lead-in/quick-uppercut-lane/r2s4>>
"Five, two, three — double-time, nineteen bars. Up the middle, then two, three. Finish the round in the legs."

  [ 5 ][ 2 ][ 3 ][ . ]  @2x   x 19   (3 punches/bar -> 57 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: five | two | three | (rest)
```

_Round 2 totals: 77 row measures + 8 pad measures = 85 · **191 punches**_

---

## Downstairs  `quick-downstairs`

**100 BPM · 2 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-downstairs>>
Downstairs. Two rounds at one hundred. Body jabs, the cross to the ribs, the hook under the elbow. Elbows in. On the bell.
```

### Round 1 — “Find the floor”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-downstairs/r1s1>>
"One, two-bee, one, two-bee — straight time, thirteen bars. Head, body, head, body. Change level without reaching."

  [ 1 ][ 2b][ 1 ][ 2b]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | one | two-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COAST BAR (rest-heavy — recovery in rhythm)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-downstairs/r1s2>>
"Coast bar — one-bee, two-bee, empty, empty, straight time, nine bars. Two body shots, then stand back up tall."

  [ 1b][ 2b][ . ][ . ]  @1x   x 9   (2 punches/bar -> 18 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one-bee | two-bee | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 22 measures

```text
<<SINGLE CLIP  lead-in/quick-downstairs/r1s3>>
"One, two-bee, three — time-and-a-half, twenty-two bars. Head one, body two-bee, then the hook comes back upstairs."

  [ 1 ][ 2b][ 3 ][ . ]  @1.5x   x 22   (3 punches/bar -> 66 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-downstairs/r1s4>>
"Two-bee, three-bee, two-bee — straight time, thirteen bars. All downstairs. Elbows in, eyes up."

  [ 2b][ 3b][ 2b][ . ]  @1x   x 13   (3 punches/bar -> 39 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two-bee | three-bee | two-bee | (rest)
```

_Round 1 totals: 92 row measures + 8 pad measures = 100 · **175 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-downstairs/r1>>
Good body work starts with balance, not with reaching down. Round two digs and comes back up — first set is one, two, three-bee, two in straight time. Let the ribs expand on a long breath.
```

### Round 2 — “Dig and come back up”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-downstairs/r2s1>>
"One, two, three-bee, two — straight time, thirteen bars. Straight line, dig under the elbow, finish high."

  [ 1 ][ 2 ][ 3b][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three-bee | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUMP BAR (single punch, four slots)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-downstairs/r2s2>>
"Pump: one-bees only, double-time — eighteen bars. Short body jabs. Small bend, quick return."

  [ 1b][ 1b][ 1b][ 1b]  @2x   x 18   (4 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | one-bee | one-bee | one-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-downstairs/r2s3>>
"One, two, three-bee — time-and-a-half, twenty-six bars. One, two, then dig. Come back to guard on the empty slot."

  [ 1 ][ 2 ][ 3b][ . ]  @1.5x   x 26   (3 punches/bar -> 78 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three-bee | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 COMBO BAR** — 22 measures

```text
<<SINGLE CLIP  lead-in/quick-downstairs/r2s4>>
"One, two, three-bee, two — time-and-a-half, twenty-two bars. Dig and finish upstairs. Clean lines to the bell."

  [ 1 ][ 2 ][ 3b][ 2 ]  @1.5x   x 22   (4 punches/bar -> 88 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three-bee | two
```

_Round 2 totals: 92 row measures + 8 pad measures = 100 · **290 punches**_

---

## Level Change  `quick-level-change`

**100 BPM · 2 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-level-change>>
Level Change. Two rounds at one hundred. Head, body, head — every bar changes floors, the stance never does. On the bell.
```

### Round 1 — “High, low, high”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUNCTUATED BAR (breath baked into slot 4)** — 28 measures

```text
<<SINGLE CLIP  lead-in/quick-level-change/r1s1>>
"One-bee, one, two — straight time, fourteen bars. Body one-bee, head one, then the rear hand. Both floors, every bar."

  [ 1b][ 1 ][ 2 ][ . ]  @1x   x 14   (3 punches/bar -> 42 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one-bee | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-level-change/r1s2>>
"One, two, one-bee, two — straight time, ten bars. High, high, low, high. The stance never changes."

  [ 1 ][ 2 ][ 1b][ 2 ]  @1x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one-bee | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-level-change/r1s3>>
"One, one-bee, two — double-time, twenty bars. Head one, body one, two. Quick level change, clean exit."

  [ 1 ][ 1b][ 2 ][ . ]  @2x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one-bee | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 COMBO BAR** — 24 measures

```text
<<SINGLE CLIP  lead-in/quick-level-change/r1s4>>
"One-bee, two, one, two — time-and-a-half, twenty-four bars. Start low, finish high. Bend the knees, not the back."

  [ 1b][ 2 ][ 1 ][ 2 ]  @1.5x   x 24   (4 punches/bar -> 96 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one-bee | two | one | two
```

_Round 1 totals: 92 row measures + 8 pad measures = 100 · **238 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-level-change/r1>>
Every bar changed floors and the stance held. Round two changes floors inside the phrase — first set is one, two-bee, three, four-bee in straight time. Breathe, and keep the hands up while you rest.
```

### Round 2 — “Change floors in the phrase”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-level-change/r2s1>>
"One, two-bee, three, four-bee — straight time, thirteen bars. High, low, high, low. Alternate floors without losing the stance."

  [ 1 ][ 2b][ 3 ][ 4b]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | four-bee
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-level-change/r2s2>>
"One, two, three-bee, two — straight time, nine bars. Straight line, dig, finish high."

  [ 1 ][ 2 ][ 3b][ 2 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three-bee | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 22 measures

```text
<<SINGLE CLIP  lead-in/quick-level-change/r2s3>>
"One, two-bee, three — time-and-a-half, twenty-two bars. Head, body, then the hook upstairs. Smooth between floors."

  [ 1 ][ 2b][ 3 ][ . ]  @1.5x   x 22   (3 punches/bar -> 66 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-level-change/r2s4>>
"One-bee, one, two — double-time, twenty-six bars. Body one-bee, head one, rear hand. Finish fast and balanced."

  [ 1b][ 1 ][ 2 ][ . ]  @2x   x 26   (3 punches/bar -> 78 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one-bee | one | two | (rest)
```

_Round 2 totals: 92 row measures + 8 pad measures = 100 · **232 punches**_

---

## Southpaw Mirror  `quick-southpaw-mirror`

**85 BPM · 2 rounds × 4:00 work · 85 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-southpaw-mirror>>
Southpaw Mirror. Two rounds, eighty-five on the click — orthodox, then the same four sets southpaw. Same numbers, opposite world. On the bell.
```

### Round 1 — “Orthodox base”  ·  stance: **ORTHODOX**

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-southpaw-mirror/r1s1>>
"One, two, three, two — straight time, thirteen bars. The four-count in your home stance. Learn how it feels."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/quick-southpaw-mirror/r1s2>>
"One, one, two — straight time, eight bars. Double the lead, then the rear hand. Notice which foot is forward."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 8   (3 punches/bar -> 24 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 17 measures

```text
<<SINGLE CLIP  lead-in/quick-southpaw-mirror/r1s3>>
"One, two, three — double-time, seventeen bars. Quick one, two, hook. Same shape you will mirror next round."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 17   (3 punches/bar -> 51 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-southpaw-mirror/r1s4>>
"One, two-bee, three — time-and-a-half, eighteen bars. Head, body, hook. Remember this set — it comes back the other way."

  [ 1 ][ 2b][ 3 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | (rest)
```

_Round 1 totals: 77 row measures + 8 pad measures = 85 · **181 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-southpaw-mirror/r1>>
Now the mirror. Switch your feet — the other foot goes forward — and the same four sets come back exactly as you threw them. First set is one, two, three, two in straight time. Settle into the new stance before the bell.
```

### Round 2 — “Southpaw mirror”  ·  stance: **SOUTHPAW**

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-southpaw-mirror/r2s1>>
"One, two, three, two — straight time, thirteen bars. Same four-count, opposite world. The numbers do not change; your feet did."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 16 measures

```text
<<SINGLE CLIP  lead-in/quick-southpaw-mirror/r2s2>>
"One, one, two — straight time, eight bars. Double the lead, then the rear hand. The lead hand is the other hand now."

  [ 1 ][ 1 ][ 2 ][ . ]  @1x   x 8   (3 punches/bar -> 24 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 17 measures

```text
<<SINGLE CLIP  lead-in/quick-southpaw-mirror/r2s3>>
"One, two, three — double-time, seventeen bars. Quick one, two, hook. Trust the mirror."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 17   (3 punches/bar -> 51 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-southpaw-mirror/r2s4>>
"One, two-bee, three — time-and-a-half, eighteen bars. Head, body, hook, mirrored. Finish honest in both stances."

  [ 1 ][ 2b][ 3 ][ . ]  @1.5x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two-bee | three | (rest)
```

_Round 2 totals: 77 row measures + 8 pad measures = 85 · **181 punches**_

---

## Speed Burst  `quick-speed-burst`

**120 BPM · 2 rounds × 4:00 work · 120 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-speed-burst>>
Speed Burst. Two rounds, one-twenty on the click. Short straight flurries and quick exits — the sprint lives in the bursts. On the bell.
```

### Round 1 — “Fast hands, clean stops”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 28 measures

```text
<<SINGLE CLIP  lead-in/quick-speed-burst/r1s1>>
"One, two, one, two — straight time, fourteen bars. Fast does not mean wild. Four straight slots and back to guard."

  [ 1 ][ 2 ][ 1 ][ 2 ]  @1x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | one | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 PUNCTUATED BAR (breath baked into slot 4)** — 34 measures

```text
<<SINGLE CLIP  lead-in/quick-speed-burst/r1s2>>
"One, one, two — double-time, thirty-four bars. Quick double one, two. Stop on the empty slot every time."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 34   (3 punches/bar -> 102 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-speed-burst/r1s3>>
"Two, three, two — double-time, eighteen bars. Fast triple, then clear the page."

  [ 2 ][ 3 ][ 2 ][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 32 measures

```text
<<SINGLE CLIP  lead-in/quick-speed-burst/r1s4>>
"One, two, three — time-and-a-half, thirty-two bars. One, two, three, breathe. Keep the hook compact."

  [ 1 ][ 2 ][ 3 ][ . ]  @1.5x   x 32   (3 punches/bar -> 96 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_Round 1 totals: 112 row measures + 8 pad measures = 120 · **308 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-speed-burst/r1>>
Speed lives in the bursts, not in the grid. Round two reads longer pages at pace — first set is one, two, three with the fourth slot open, double-time. Drop the shoulders and breathe slow.
```

### Round 2 — “Pages at speed”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 PUNCTUATED BAR (breath baked into slot 4)** — 24 measures

```text
<<SINGLE CLIP  lead-in/quick-speed-burst/r2s1>>
"One, two, three — double-time, twenty-four bars. One, two, three, stop. Fast burst, clean recovery."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 24   (3 punches/bar -> 72 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-speed-burst/r2s2>>
"Big phrase — two pages: one, two, one, two, three, two, empty, empty. Double-time, twenty times through. Four straight slots, then three, two, then breathe."

  [ 1 ][ 2 ][ 1 ][ 2 ][ 3 ][ 2 ][ . ][ . ]  @2x   x 20   (6 punches/bar -> 120 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | one | two | three | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 PUNCTUATED BAR (breath baked into slot 4)** — 24 measures

```text
<<SINGLE CLIP  lead-in/quick-speed-burst/r2s3>>
"One, one, two — time-and-a-half, twenty-four bars. Double one, two. Keep the lead hand alive."

  [ 1 ][ 1 ][ 2 ][ . ]  @1.5x   x 24   (3 punches/bar -> 72 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 34 measures

```text
<<SINGLE CLIP  lead-in/quick-speed-burst/r2s4>>
"Two, three, two — double-time, thirty-four bars. Two, three, two, empty slot. Last push — stay accurate."

  [ 2 ][ 3 ][ 2 ][ . ]  @2x   x 34   (3 punches/bar -> 102 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_Round 2 totals: 112 row measures + 8 pad measures = 120 · **366 punches**_

---

## Heavy Two  `quick-heavy-two`

**120 BPM · 2 rounds × 4:00 work · 120 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-heavy-two>>
Heavy Two. Two rounds, one-twenty on the click. Hooks and crosses with weight behind them — sit down on every shot. On the bell.
```

### Round 1 — “Sit down on the straight line”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUNCTUATED BAR (breath baked into slot 4)** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-heavy-two/r1s1>>
"One, two, three — straight time, fifteen bars. Sit down on the cross, turn the hook over. Weight behind every shot."

  [ 1 ][ 2 ][ 3 ][ . ]  @1x   x 15   (3 punches/bar -> 45 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-heavy-two/r1s2>>
"One, two, three, two — straight time, fifteen bars. The four-count with the hips in it. Finish on the cross."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1x   x 15   (4 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-heavy-two/r1s3>>
"Two, three, two — time-and-a-half, twenty-six bars. Rear hand, hook, rear hand. Heavy, not slow."

  [ 2 ][ 3 ][ 2 ][ . ]  @1.5x   x 26   (3 punches/bar -> 78 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-heavy-two/r1s4>>
"One, two, three — double-time, twenty-six bars. Quick one, two, then the hook lands with weight."

  [ 1 ][ 2 ][ 3 ][ . ]  @2x   x 26   (3 punches/bar -> 78 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | two | three | (rest)
```

_Round 1 totals: 112 row measures + 8 pad measures = 120 · **261 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-heavy-two/r1>>
Heavy hands come from the floor, not the shoulders. Round two is the hooks with weight — first set is one, four, three, two in straight time. Breathe deep and keep the knees bent.
```

### Round 2 — “Hooks with weight”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-heavy-two/r2s1>>
"One, four, three, two — straight time, thirteen bars. Jab, rear hook, lead hook, cross. Turn the hips through both hooks."

  [ 1 ][ 4 ][ 3 ][ 2 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | four | three | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 PUNCTUATED BAR (breath baked into slot 4)** — 22 measures

```text
<<SINGLE CLIP  lead-in/quick-heavy-two/r2s2>>
"Three, two, three — double-time, twenty-two bars. Hook, cross, hook. Short arcs, full weight."

  [ 3 ][ 2 ][ 3 ][ . ]  @2x   x 22   (3 punches/bar -> 66 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: three | two | three | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 COMBO BAR** — 22 measures

```text
<<SINGLE CLIP  lead-in/quick-heavy-two/r2s3>>
"One, two, five, two — time-and-a-half, twenty-two bars. Straight, straight, up the middle, straight. Legs under every shot."

  [ 1 ][ 2 ][ 5 ][ 2 ]  @1.5x   x 22   (4 punches/bar -> 88 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 TWO-PAGE SET (8 slots, paged as 2 bars)** — 42 measures

```text
<<SINGLE CLIP  lead-in/quick-heavy-two/r2s4>>
"Big phrase — two pages: one, one, two, three, two, five, two, breathe. Straight time, fourteen times through. Build it, sit down on it, finish it."

  [ 1 ][ 1 ][ 2 ][ 3 ][ 2 ][ 5 ][ 2 ][ . ]  @1x   x 14   (7 punches/bar -> 98 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | two | three | two | five | two | (rest)
```

_Round 2 totals: 112 row measures + 8 pad measures = 120 · **304 punches**_

---

## Coast & Reset  `quick-coast-reset`

**100 BPM · 2 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-coast-reset>>
Coast and Reset. Two rounds at one hundred. Pump, then breathe on your feet — the empty slots are where you reset. On the bell.
```

### Round 1 — “Work, then reset on your feet”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 PUMP BAR (single punch, four slots)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r1s1>>
"Pump: ones only, straight time — nine bars. Empty it. Every shot comes home."

  [ 1 ][ 1 ][ 1 ][ 1 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | one | one | one
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COAST BAR (rest-heavy — recovery in rhythm)** — 16 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r1s2>>
"Coast bar — one, then three empty slots, straight time, eight bars. One shot, then recover on your feet. The empty slots are the work."

  [ 1 ][ . ][ . ][ . ]  @1x   x 8   (1 punches/bar -> 8 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 PUMP BAR (single punch, four slots)** — 10 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r1s3>>
"Pump: twos only, double-time — ten bars. Rear hand, fast and straight. Then we breathe."

  [ 2 ][ 2 ][ 2 ][ 2 ]  @2x   x 10   (4 punches/bar -> 40 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: two | two | two | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 COAST BAR (rest-heavy — recovery in rhythm)** — 28 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r1s4>>
"One, two — with a hold after each, straight time, fourteen bars. Punch, wait, punch, wait. Reset between every shot."

  [ 1 ][ . ][ 2 ][ . ]  @1x   x 14   (2 punches/bar -> 28 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.5 COAST BAR (rest-heavy — recovery in rhythm)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r1s5>>
"Coast bar — two, three, empty, empty, straight time, nine bars. Cross, hook, then stand tall and breathe."

  [ 2 ][ 3 ][ . ][ . ]  @1x   x 9   (2 punches/bar -> 18 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: two | three | (rest) | (rest)
```

_Round 1 totals: 90 row measures + 10 pad measures = 100 · **130 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-coast-reset/r1>>
The empty slots are where you reset — use them. Round two coasts into combinations: first set is one, two with two empty slots, straight time. Breathe on your feet, and stay in rhythm.
```

### Round 2 — “Coast into combinations”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COAST BAR (rest-heavy — recovery in rhythm)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r2s1>>
"Coast bar — one, two, empty, empty, straight time, nine bars. The pair, then two quiet slots. Recover in rhythm."

  [ 1 ][ 2 ][ . ][ . ]  @1x   x 9   (2 punches/bar -> 18 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r2s2>>
"Coast bar — two, three, empty, empty, time-and-a-half, twenty bars. Cross, hook, breathe. Stay balanced through the quiet."

  [ 2 ][ 3 ][ . ][ . ]  @1.5x   x 20   (2 punches/bar -> 40 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: two | three | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 COAST BAR (rest-heavy — recovery in rhythm)** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r2s3>>
"Coast bar — one, then three empty slots, straight time, ten bars. One clean shot a bar. Reset fully before the next."

  [ 1 ][ . ][ . ][ . ]  @1x   x 10   (1 punches/bar -> 10 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | (rest) | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 PUNCTUATED BAR (breath baked into slot 4)** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r2s4>>
"One, one, two — double-time, eighteen bars. Now pump it. Double one, two, and out."

  [ 1 ][ 1 ][ 2 ][ . ]  @2x   x 18   (3 punches/bar -> 54 punches)
  breath after every bar: 2 beats

[[COMPONENT HITS]] per bar: one | one | two | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.5 COMBO BAR** — 14 measures

```text
<<SINGLE CLIP  lead-in/quick-coast-reset/r2s5>>
"One, two, three, two — time-and-a-half, fourteen bars. Finish with the four-count. Loose to the bell."

  [ 1 ][ 2 ][ 3 ][ 2 ]  @1.5x   x 14   (4 punches/bar -> 56 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | two | three | two
```

_Round 2 totals: 90 row measures + 10 pad measures = 100 · **178 punches**_

---

## Six Count  `quick-six-count`

**100 BPM · 2 rounds × 4:00 work · 100 measures/round · click audible, coach-guided**

### Walkout — name + details, quickly, before the bell

```text
<<SINGLE CLIP  walkout/quick-six-count>>
Six Count. Two rounds at one hundred. The whole alphabet — one through six in a bar — then the long phrases. On the bell.
```

### Round 1 — “Count to six”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§1.1 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-six-count/r1s1>>
"One, two, three, four — straight time, nine bars. The first letters of the alphabet. Straight line, then both hooks."

  [ 1 ][ 2 ][ 3 ][ 4 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | four
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.2 COMBO BAR** — 24 measures

```text
<<SINGLE CLIP  lead-in/quick-six-count/r1s2>>
"One, two, five, six — straight time, twelve bars. Straight line, then both uppercuts. Bend for the fives and sixes."

  [ 1 ][ 2 ][ 5 ][ 6 ]  @1x   x 12   (4 punches/bar -> 48 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | six
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.3 TWO-PAGE SET (8 slots, paged as 2 bars)** — 30 measures

```text
<<SINGLE CLIP  lead-in/quick-six-count/r1s3>>
"Big phrase — two pages: one, two, three, four, five, six, empty, empty. Straight time, ten times through. The whole alphabet, then breathe."

  [ 1 ][ 2 ][ 3 ][ 4 ][ 5 ][ 6 ][ . ][ . ]  @1x   x 10   (6 punches/bar -> 60 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | four | five | six | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§1.4 PUNCTUATED BAR (breath baked into slot 4)** — 20 measures

```text
<<SINGLE CLIP  lead-in/quick-six-count/r1s4>>
"One, six, three — time-and-a-half, twenty bars. Jab, rear uppercut, hook. Up, then around."

  [ 1 ][ 6 ][ 3 ][ . ]  @1.5x   x 20   (3 punches/bar -> 60 punches)
  breath after every bar: 1 1/3 beats

[[COMPONENT HITS]] per bar: one | six | three | (rest)
```

_Round 1 totals: 92 row measures + 8 pad measures = 100 · **204 punches**_

### Rest 1 → 2  (1:00)

```text
<<SINGLE CLIP  rest/quick-six-count/r1>>
You have the whole alphabet. Round two reads the whole phrase — first set is one, two, three, four in straight time, then the long pages. Long breath, shoulders down, eyes up.
```

### Round 2 — “The whole phrase”

_⏸ opener pad — 2 measures on the click, no tokens (lead-in room)_

**§2.1 COMBO BAR** — 26 measures

```text
<<SINGLE CLIP  lead-in/quick-six-count/r2s1>>
"One, two, three, four — straight time, thirteen bars. First half of the alphabet, clean. Turn both hooks over."

  [ 1 ][ 2 ][ 3 ][ 4 ]  @1x   x 13   (4 punches/bar -> 52 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | four
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.2 TWO-PAGE SET (8 slots, paged as 2 bars)** — 24 measures

```text
<<SINGLE CLIP  lead-in/quick-six-count/r2s2>>
"Big phrase — two pages: one, two, three, two, one, two, five, two. Straight time, eight times through. The four-count, then the same line with the uppercut."

  [ 1 ][ 2 ][ 3 ][ 2 ][ 1 ][ 2 ][ 5 ][ 2 ]  @1x   x 8   (8 punches/bar -> 64 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | two | one | two | five | two
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.3 TWO-PAGE SET (8 slots, paged as 2 bars)** — 24 measures

```text
<<SINGLE CLIP  lead-in/quick-six-count/r2s3>>
"Big phrase — two pages: one, two, three, four, five, six, empty, empty. Straight time, eight times through. Say the alphabet with your hands."

  [ 1 ][ 2 ][ 3 ][ 4 ][ 5 ][ 6 ][ . ][ . ]  @1x   x 8   (6 punches/bar -> 48 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | three | four | five | six | (rest) | (rest)
```

_⏸ setup pause — 2 measures on the click, no tokens (lead-in room)_

**§2.4 COMBO BAR** — 18 measures

```text
<<SINGLE CLIP  lead-in/quick-six-count/r2s4>>
"One, two, five, six — straight time, nine bars. Straight line, both uppercuts. Finish the round in the legs."

  [ 1 ][ 2 ][ 5 ][ 6 ]  @1x   x 9   (4 punches/bar -> 36 punches)
  breath after every bar: 4 beats

[[COMPONENT HITS]] per bar: one | two | five | six
```

_Round 2 totals: 92 row measures + 8 pad measures = 100 · **200 punches**_

---

## Corpus-bank tally (what this document orders up)

| family | count | bracket |
|---|---|---|
| walkouts | 22 | `<<SINGLE CLIP>>` |
| section lead-ins | 262 | `<<SINGLE CLIP>>` |
| rest scripts | 41 | `<<SINGLE CLIP>>` |
| token components (1-6, fused 1b-6b) | 12 (+ silence) | `[[COMPONENT HITS]]` |

Fused-body rule rides along: every `-bee` component renders from hyphenated text (`"Two-bee"`), never spaced, per the settled A/B/C.
