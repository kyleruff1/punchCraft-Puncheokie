# Puncheokie Pure-Punch Combination Corpus v1

This corpus is designed for a handwork-heavy boxing-bag application. It contains 60 unique exact combinations—20 beginner, 20 intermediate, and 20 advanced—plus 18 additive build-up sets and optional footwork wrappers.

> Long advanced strings are intentionally labeled as bag-memory and conditioning chains. They are not presented as a guarantee that an athlete should remain stationary and throw nine unanswered punches in live boxing.

## Notation

| Token | Meaning |
|---|---|
| `1` | Lead jab |
| `2` | Rear cross |
| `3` | Lead hook |
| `4` | Rear hook |
| `5` | Lead uppercut |
| `6` | Rear uppercut |
| `1B` | Lead jab to body |
| `2B` | Rear cross to body |
| `3B` | Lead hook to body |
| `4B` | Rear hook to body |
| `5B` | Lead uppercut to body |
| `6B` | Rear uppercut to body |

Odd numbers remain **lead-hand** punches and even numbers remain **rear-hand** punches. This makes every sequence valid for either orthodox or southpaw stance. Internally, use token arrays as the source of truth; compact strings such as `1423` are display aliases.

## Research-informed construction principles

The corpus follows a progression from jab and rear-straight fundamentals into basic combinations, body variations, multi-plane attacks, and then longer phase-based chains. The tiering is based on coordination demands, level changes, range changes, and same-hand reloads—not length alone.

The content is intentionally jab-heavy: 56 of 60 combinations begin with a lead jab, body jab, or double-jab structure. Four non-jab entries are retained to train pocket-range reactions and prevent the library from becoming mechanically predictable.

Short 2–3-punch work forms the beginner foundation. Intermediate work introduces 3–6-punch combinations, body shots, power finishes, and angle changes. Advanced combinations use spoken phase groups so long calls remain rhythmic and memorable.

The name **Square** for `1-4-2-3` is a Puncheokie mnemonic used to support recall; it is not asserted as a universal boxing-coaching term.

## Tier summary

| Tier | Combos | Length | Average | Jab-led | Primary purpose |
|---|---:|---:|---:|---:|---|
| Beginner | 20 | 2–4 | 2.7 | 95.0% | Two to four punches; mostly jab-led; simple alternation; one level change at most; fundamentals before speed. |
| Intermediate | 20 | 3–6 | 4.45 | 85.0% | Three to six punches; body/head transitions; uppercuts and rear hooks; one same-hand reload or rhythm change. |
| Advanced | 20 | 6–9 | 6.85 | 100.0% | Six to nine punches; multi-phase patterns, repeated motifs, same-hand level doubles, and conditioning chains. |

## Beginner combinations

| ID | Number sequence | Spoken grouping | Name | Training purpose | Range/use |
|---|---|---|---|---|---|
| `B01` | `1-2` | `1-2` | Classic one-two | Straight foundation | long-to-mid; fundamental |
| `B02` | `1-1` | `1-1` | Double jab | Range finding and lead-hand rhythm | long-to-mid; fundamental |
| `B03` | `1-1-2` | `1-1 · 2` | Double-jab cross | Close distance behind the jab | long-to-mid; fundamental |
| `B04` | `1-2-1` | `1-2 · 1` | Return jab | Recover behind the lead hand | long-to-mid; fundamental |
| `B05` | `1-2-1-2` | `1-2 · 1-2` | Straight repeat | Alternating straight-punch rhythm | long-to-mid; fundamental |
| `B06` | `1-3` | `1-3` | Jab to lead hook | Same-lead-hand angle change | closing-to-mid; fundamental |
| `B07` | `1-4` | `1-4` | Jab to rear hook | Close-range rear-hand angle | closing-to-mid; fundamental |
| `B08` | `1-5` | `1-5` | Jab to lead uppercut | Same-lead-hand vertical change | closing-to-mid-close; fundamental |
| `B09` | `1-6` | `1-6` | Jab to rear uppercut | Close-range rear-hand vertical change | closing-to-mid-close; fundamental |
| `B10` | `1-2-3` | `1-2 · 3` | Three-punch fundamental | Straight-to-hook finish | closing-to-mid; fundamental |
| `B11` | `1-2-3-2` | `1-2 · 3-2` | Four-punch fundamental | Hook-cross finish | closing-to-mid; fundamental |
| `B12` | `1-6-3` | `1-6 · 3` | Uppercut-hook bridge | Rear uppercut into lead hook | closing-to-mid-close; fundamental |
| `B13` | `3-2` | `3-2` | Hook-cross | Pocket-range power pair | closing-to-mid; fundamental |
| `B14` | `1-3-6` | `1-3 · 6` | Jab-hook-uppercut | Angle-to-vertical transition | closing-to-mid-close; fundamental |
| `B15` | `1-5-2` | `1-5 · 2` | Jab-uppercut-cross | Lift the guard and finish straight | closing-to-mid-close; fundamental |
| `B16` | `1B-2` | `1B-2` | Body-jab entry | Change level before the cross | long-to-mid; fundamental |
| `B17` | `1-2B` | `1-2B` | Jab to body cross | Straight level change | long-to-mid; fundamental |
| `B18` | `1B-1-2` | `1B-1 · 2` | Body-head double jab | Lead-hand level change | long-to-mid; fundamental |
| `B19` | `1-2-3B` | `1-2 · 3B` | Body-hook finish | Finish downstairs | closing-to-mid; fundamental |
| `B20` | `1-1-1-2B` | `1-1-1 · 2B` | Jab wall to body cross | Raise the guard, finish to the body | long-to-mid; fundamental |

## Intermediate combinations

| ID | Number sequence | Spoken grouping | Name | Training purpose | Range/use |
|---|---|---|---|---|---|
| `I01` | `1-1-2-3-2` | `1-1-2 · 3-2` | Double-jab power finish | Layer a hook-cross finish | closing-to-mid; tactical |
| `I02` | `1-2-3-2-3` | `1-2 · 3-2-3` | Alternating hook finish | Repeat the lead hook | closing-to-mid; tactical |
| `I03` | `1-3-2-3-2` | `1-3 · 2-3-2` | Lead-side entry chain | Same-side setup into pocket rhythm | closing-to-mid; tactical |
| `I04` | `2-3-2` | `2-3 · 2` | Pocket three | Cross-hook-cross without a jab | closing-to-mid; tactical |
| `I05` | `2-6-3` | `2-6 · 3` | Cross-uppercut-hook | Rear-hand reload into lead hook | closing-to-mid-close; tactical |
| `I06` | `2-3B-5` | `2-3B · 5` | Cross-body hook-uppercut | Body reaction into vertical finish | closing-to-mid-close; tactical |
| `I07` | `1-5-2-3-2` | `1-5 · 2-3-2` | Lead-uppercut disguise | Replace the second jab with a vertical shot | closing-to-mid-close; tactical |
| `I08` | `1-2-5-6-3-2` | `1-2 · 5-6 · 3-2` | Six-punch fundamentals chain | Straights, uppercuts, hooks | closing-to-mid-close; extended |
| `I09` | `1-2-3-6-3` | `1-2 · 3-6-3` | Hook-uppercut-hook | Rotational close-range sequence | closing-to-mid-close; tactical |
| `I10` | `1-2-4-3-2` | `1-2-4 · 3-2` | Rear-hook reload | Same-rear-hand angle change | closing-to-mid; tactical |
| `I11` | `1-4-2-3` | `1-4 · 2-3` | Square | Four-corner hand pattern | closing-to-mid; tactical |
| `I12` | `1-4-2-3-6` | `1-4 · 2-3 · 6` | Square plus rear uppercut | Extend the square downward | closing-to-mid-close; tactical |
| `I13` | `1B-2-3-2` | `1B-2 · 3-2` | Body-jab power line | Enter low, finish high | closing-to-mid; tactical |
| `I14` | `1-2B-3-2` | `1-2B · 3-2` | Body cross to hook-cross | Mid-combination level change | closing-to-mid; tactical |
| `I15` | `1-2-3B-3-2` | `1-2 · 3B-3 · 2` | Body-head lead hook | Double the lead hook across levels | closing-to-mid; tactical |
| `I16` | `1-1-2-3B-2` | `1-1-2 · 3B-2` | Double-jab body finish | High-volume entry and body hook | closing-to-mid; tactical |
| `I17` | `1B-2B-3-2` | `1B-2B · 3-2` | Body straights to head | Two-level attack | closing-to-mid; tactical |
| `I18` | `1-1-4B` | `1-1 · 4B` | Double-jab rear body hook | High guard setup to rear body hook | closing-to-mid; tactical |
| `I19` | `1-2-6B-3-2` | `1-2 · 6B · 3-2` | Rear body uppercut reload | Rear-hand body attack to head finish | closing-to-mid-close; tactical |
| `I20` | `1B-1-2-5-2` | `1B-1-2 · 5-2` | Body-head jab ladder | Multi-level entry into uppercut | closing-to-mid-close; tactical |

## Advanced combinations

| ID | Number sequence | Spoken grouping | Name | Training purpose | Range/use |
|---|---|---|---|---|---|
| `A01` | `1-4-2-3-6-5` | `1-4 · 2-3 · 6-5` | Square uppercut ladder | requested 142365 build | closing-to-mid-close; extended |
| `A02` | `1-4-2-3-6-5-2` | `1-4 · 2-3 · 6-5-2` | Square with cross finish | complete square ladder with rear straight | closing-to-mid-close; bag-chain |
| `A03` | `1-4-2-3-6-5-3-2` | `1-4 · 2-3 · 6-5 · 3-2` | Extended square | full angle-to-uppercut-to-hook chain | closing-to-mid-close; bag-chain |
| `A04` | `1-1-2-3B-3-2` | `1-1-2 · 3B-3 · 2` | Double-jab body-head hook | same-hand level double | closing-to-mid; extended |
| `A05` | `1-1-2-3B-3-2-5-2` | `1-1-2 · 3B-3-2 · 5-2` | Body-head pressure ladder | extend the lead-hook double | closing-to-mid-close; bag-chain |
| `A06` | `1B-1-2-3-6-3-2` | `1B-1-2 · 3-6-3-2` | Body-head entry to pocket chain | two-phase attack | closing-to-mid-close; bag-chain |
| `A07` | `1-2B-3B-2-3-2` | `1-2B-3B · 2-3-2` | Double-body to head pressure | two body shots then head finish | closing-to-mid; extended |
| `A08` | `1B-2B-3-6-3-2` | `1B-2B · 3-6-3-2` | Body staircase | rise from straight body shots to head | closing-to-mid-close; extended |
| `A09` | `1-2-5B-6B-3-2` | `1-2 · 5B-6B · 3-2` | Double body uppercut | vertical body attack to head finish | closing-to-mid-close; extended |
| `A10` | `1-5-2-3B-3-2` | `1-5-2 · 3B-3-2` | Lead disguise and body-head hook | two same-lead-hand concepts | closing-to-mid-close; extended |
| `A11` | `1-2-3-6-3-2-3-2` | `1-2 · 3-6-3-2 · 3-2` | Rolling pressure chain | repeat hook-cross finish | closing-to-mid-close; bag-chain |
| `A12` | `1-2-5-6-3-2-3-2` | `1-2 · 5-6 · 3-2 · 3-2` | Eight-punch alternating chain | high-volume bag sequence | closing-to-mid-close; bag-chain |
| `A13` | `1-6-3-2-5-2` | `1-6 · 3-2 · 5-2` | Uppercut bridge extension | two vertical-shot phases | closing-to-mid-close; extended |
| `A14` | `1-3-2-5-2-3-2` | `1-3 · 2-5-2 · 3-2` | Lead-side deception chain | layer hook and uppercut inserts | closing-to-mid-close; bag-chain |
| `A15` | `1-2-4-3-6-3-2` | `1-2-4 · 3-6-3-2` | Rear-hook to pocket chain | advanced same-rear-hand reload | closing-to-mid-close; bag-chain |
| `A16` | `1-1-2-4-3-2` | `1-1-2-4 · 3-2` | Double-jab rear-hook reload | rear-hand angle change | closing-to-mid; extended |
| `A17` | `1B-2-3-2B-3-2` | `1B-2-3 · 2B-3-2` | Alternating level waves | body-head-body-head pattern | closing-to-mid; extended |
| `A18` | `1-2B-3-2-5B-2` | `1-2B-3 · 2-5B-2` | Body cross and body uppercut | two separated body attacks | closing-to-mid-close; extended |
| `A19` | `1-2-3B-6-3-2-5-2` | `1-2-3B · 6-3-2 · 5-2` | Body hook into uppercut chain | three-phase pressure sequence | closing-to-mid-close; bag-chain |
| `A20` | `1-1-2-3-2-5-6-3-2` | `1-1-2 · 3-2 · 5-6 · 3-2` | Nine-punch conditioning chain | Extended memory, rhythm, and bag-volume sequence | closing-to-mid-close; bag-chain |

## Additive build-up sets

A build-up set introduces a stable prefix or motif and adds one layer at a time. The engine should repeat each stage enough for recognition before advancing. It may step back one stage after repeated misses.

### Beginner

| ID | Set | Stages | Goal |
|---|---|---|---|
| `BB01` | Straight Extension | `1` → `1-2` → `1-2-1` → `1-2-1-2` | Learn lead/rear alternation and return to stance. |
| `BB02` | Jab Volume Ladder | `1` → `1-1` → `1-1-2` → `1-1-1-2B` | Build jab volume and finish after drawing a high guard. |
| `BB03` | Hook Finish Ladder | `1-2` → `1-2-3` → `1-2-3-2` → `1-2-3-2-3` | Move from straight punches to a lateral finishing angle. |
| `BB04` | Lead-Side Disguise | `1` → `1-3` → `1-3-2` → `1-3-2-3` | Develop same-hand reloads without losing balance. |
| `BB05` | Body-Jab Rise | `1B` → `1B-2` → `1B-2-3` → `1B-2-3-2` | Introduce a simple body-to-head level change. |
| `BB06` | Body-Hook Finish | `1-2` → `1-2-3B` → `1-2-3B-2` → `1-2-3B-3-2` | Teach body-head transitions and a balanced rear-hand finish. |

### Intermediate

| ID | Set | Stages | Goal |
|---|---|---|---|
| `IB01` | Double-Jab Power Chain | `1-1` → `1-1-2` → `1-1-2-3` → `1-1-2-3-2` | Close range behind lead-hand volume. |
| `IB02` | Square Builder | `1-4` → `1-4-2` → `1-4-2-3` → `1-4-2-3-6` | Train same-rear-hand reloads and changing punch planes. |
| `IB03` | Uppercut Cascade | `1-2` → `1-2-5` → `1-2-5-6` → `1-2-5-6-3-2` | Move smoothly from long range into close-range work. |
| `IB04` | Body-Head Hook Double | `1-2` → `1-2-3B` → `1-2-3B-3` → `1-2-3B-3-2` | Use one hand twice across two levels. |
| `IB05` | Body Staircase | `1B-2B` → `1B-2B-3` → `1B-2B-3-2` → `1B-2B-3-6-3-2` | Create a low-to-high attack shape. |
| `IB06` | Rear-Uppercut Line | `1-6` → `1-6-3` → `1-6-3-2` → `1-6-3-2-5-2` | Use the rear uppercut as a bridge rather than a terminal punch. |

### Advanced

| ID | Set | Stages | Goal |
|---|---|---|---|
| `AB01` | Extended Square Ladder | `1-4-2-3` → `1-4-2-3-6` → `1-4-2-3-6-5` → `1-4-2-3-6-5-2` → `1-4-2-3-6-5-3-2` | Long-chain recall, hand-plane changes, and a decisive finish. |
| `AB02` | Body-Head Pressure Ladder | `1-1-2` → `1-1-2-3B` → `1-1-2-3B-3` → `1-1-2-3B-3-2` → `1-1-2-3B-3-2-5-2` | Maintain structure while adding same-hand level changes. |
| `AB03` | Alternating Uppercut Ladder | `1-2-5-6` → `1-2-5-6-3` → `1-2-5-6-3-2` → `1-2-5-6-3-2-3-2` | Extended alternating-hand rhythm at close range. |
| `AB04` | Rolling Pressure Chain | `1-2-3` → `1-2-3-6` → `1-2-3-6-3` → `1-2-3-6-3-2` → `1-2-3-6-3-2-3-2` | Create a repeating, memorable pressure motif. |
| `AB05` | Body-to-Head Staircase | `1B-2B` → `1B-2B-3` → `1B-2B-3-6` → `1B-2B-3-6-3-2` | Train level changes without randomizing the core pattern. |
| `AB06` | Split-Level Wave | `1-2B-3` → `1-2B-3-2` → `1-2B-3-2-5B` → `1-2B-3-2-5B-2` | Create two distinct body threats inside one long combination. |

## Generator constraints

- **Jab-heavy distribution:** At least 75% of generated exact combinations should begin with 1, 1B, or 1-1; this seed corpus is more jab-heavy than that floor.
- **Tiered length:** Beginner exact combinations use 2-4 punches, intermediate 3-6, and advanced 6-9. Longer output belongs in timed flurries rather than endlessly voiced strings.
- **Curated transitions:** Generate from approved templates and transformations; do not select punch numbers independently at random.
- **Same-hand cost:** Double jabs are broadly allowed. Consecutive same-hand hooks, uppercuts, or rear-hand reloads require intermediate or advanced tagging and a compatible range.
- **Level-change budget:** Beginner combinations use no more than one body-shot token; intermediate normally use no more than two; advanced may use more when the sequence remains balanced.
- **Power finish:** Prefer a rear cross, lead hook, rear hook, or uppercut as the final strike; jab endings are useful for reset drills but should be a minority.
- **Phase grouping:** Combinations longer than four punches should carry spokenGroups metadata so the coach voice can call memorable motifs instead of a flat digit stream.
- **Angle after work:** Intermediate and advanced workouts should optionally append a reset, pivot, or step-off after the punch string; footwork remains instructional unless separately tracked.
- **Long-chain labeling:** Seven-to-nine-punch strings are heavy-bag memory and conditioning chains, not claims about an uninterrupted exchange in live competition.
- **Stance-relative semantics:** Odd numbers always mean lead hand and even numbers rear hand. Never convert the corpus to fixed left/right semantics when the user switches stance.

## Optional footwork wrappers

Footwork should be stored outside the punch-token array so punch scoring remains deterministic.

| ID | Command | Placement | Minimum tier | Use |
|---|---|---|---|---|
| `FW01` | `STEP_IN` | before | beginner | Close distance before a jab-led combination. |
| `FW02` | `RESET` | after | beginner | Return to balanced stance after any exact combination. |
| `FW03` | `PIVOT_LEAD` | after | intermediate | Change angle after a rear-hand or lead-hook finish. |
| `FW04` | `STEP_OFF` | after | intermediate | Exit the centerline after a power finish. |
| `FW05` | `ANGLE` | between-spoken-groups | advanced | Split a long chain into attack, angle change, and second attack. |
| `FW06` | `CIRCLE` | between-repetitions | advanced | Add recovery movement without changing the scored punch sequence. |

## Suggested workout assembly

A three-minute round should normally revolve around three to six motifs rather than presenting twenty unrelated combinations. A practical structure is:

1. Introduce one or two short base combinations.
2. Repeat them at technical cadence.
3. Add one build-up stage.
4. Use a timed flurry for volume rather than speaking every punch.
5. Return to the base combination under fatigue.
6. Finish with an optional reset, pivot, or step-off cue.

## Source basis

The construction method was informed by Boxing Canada's beginner-coach progression; England Boxing's official shadow-boxing drills; FightCamp's numbered two- and three-punch instruction and body-shot drills; published activity-profile research on lead-hand punching and combinations; and peer-reviewed boxing biomechanics research. The individual 60-combination corpus is an original synthesis for Puncheokie rather than a copied list.

