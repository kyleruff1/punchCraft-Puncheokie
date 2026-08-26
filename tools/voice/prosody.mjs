/**
 * The prosody compiler — how a combination is *performed*.
 *
 * ## Why this is build-time
 *
 * Grouping, contour and swing are baked into the rendered audio. A runtime
 * copy of these rules would be a second source of truth, able to disagree
 * with the clip the athlete actually hears. The app only ever looks an asset
 * up; it never re-derives how that asset was made.
 *
 * ## The persona
 *
 * Old-School Cornerman: aged, weathered baritone, experienced rather than
 * frail, caring but uncompromising, with a rolling sing-song cadence that
 * approaches an auctioneer's continuity without becoming unintelligible.
 * Setup punches rise and flow; the finish lands with a hard downward accent.
 *
 * ## The rule that keeps it from becoming a new monotone
 *
 * Accents are **light–HEAVY per pair**, not every word forte:
 *
 *     1-2-3-2   →   one-TWO | three-TWO
 *
 * Making everything forceful is simply a louder monotone. The same applies
 * across performance states — if every cue is theatrical, theatrical is the
 * new flat.
 */

/* --------------------------------------------------------------- vocabulary */

const NUMBER_WORDS = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' }

/**
 * Technique names, in full and compact forms.
 *
 * **Lead and rear, never left and right.** A lead hook is a left hook in
 * orthodox and a right hook in southpaw, so a call naming a side is wrong
 * every time the athlete switches stance.
 *
 * The compact form exists because "Lead uppercut to the body" cannot be said
 * inside a sprint-cadence combination without either rushing it into mush or
 * overrunning the punch it is describing.
 */
const TECHNIQUE_WORDS = {
  1: { full: 'Jab', compact: 'Jab' },
  2: { full: 'Cross', compact: 'Cross' },
  3: { full: 'Lead hook', compact: 'Hook' },
  4: { full: 'Rear hook', compact: 'Rear hook' },
  5: { full: 'Lead uppercut', compact: 'Lead upper' },
  6: { full: 'Rear uppercut', compact: 'Rear upper' },
}

/** Defense and footwork. A movement token is a transition, not a punch. */
const MOVEMENT_WORDS = {
  slip: 'Slip',
  roll: 'Roll',
  duck: 'Duck',
  pull: 'Pull',
  'bob-weave': 'Bob and weave',
  pivot: 'Pivot',
  'step off': 'Step off',
  'step-off': 'Step off',
  circle: 'Circle',
  'cut-off-ring': 'Cut off the ring',
  reset: 'Reset',
}

export const isMovement = (token) => MOVEMENT_WORDS[String(token).toLowerCase()] !== undefined

/** Cadences where a full technique name will not fit inside the phrase. */
const COMPACT_CADENCES = new Set(['pressure', 'sprint'])

/**
 * Spoken form of one token.
 *
 * A body shot reaches the synthesizer as words a person would say — "Body
 * two", never "two bee". The visual notation is untouched (D10); this is only
 * what the voice says.
 */
export function spokenFor(token, { vocabulary = 'numbers', cadence = 'steady' } = {}) {
  const key = String(token).toLowerCase()
  if (MOVEMENT_WORDS[key]) return MOVEMENT_WORDS[key]

  const body = /^([1-6])b$/.exec(key)
  const digit = Number(body ? body[1] : key)
  if (!Number.isFinite(digit) || digit < 1 || digit > 6) return String(token)

  if (vocabulary === 'techniques') {
    const entry = TECHNIQUE_WORDS[digit]
    const word = COMPACT_CADENCES.has(cadence) ? entry.compact : entry.full
    // The technique vocabulary names the target: "Body cross".
    return body ? `Body ${word.toLowerCase()}` : word
  }

  const word = NUMBER_WORDS[digit]
  // Punch-number callouts read the notation itself: 2b is "two bee", the
  // shorthand a numbers coach actually says — not "body two", which is the
  // technique phrasing. Spelled "bee" rather than "B" so it survives the
  // interior-lowercasing in renderBody as /biː/; a lone lowercase "b" risks
  // being read "buh".
  return body ? `${word} bee` : word
}

/* ------------------------------------------------------------------ grouping */

/**
 * Group a combination the way a coach calls it.
 *
 * Punches pair into entry and finish; a movement token stands alone because
 * it *is* the transition between them. That is what turns 1-2-3-2 into
 * "One-two, three-TWO" rather than four evenly stressed numbers, and what
 * makes 1-2-ROLL-3-2 break the melodic run and then resume it.
 */
export function groupTokens(tokens) {
  const groups = []
  let current = []
  for (const token of tokens) {
    if (isMovement(token)) {
      if (current.length > 0) {
        groups.push(current)
        current = []
      }
      groups.push([token])
      continue
    }
    current.push(token)
    if (current.length === 2) {
      groups.push(current)
      current = []
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/* -------------------------------------------------------- performance states */

/**
 * The same voice at three emotional levels.
 *
 * Contrast is the whole point. `push` only reads as urgent because `work` is
 * not, and `teach` is what makes the coach sound like they care rather than
 * merely shout.
 */
export const PERFORMANCES = {
  teach: {
    speedScale: 0.88,
    // Warm and deliberate: the athlete is being shown, not driven.
    ending: '.',
    groupSeparator: '... ',
    finalAccentDb: 1.2,
    contourScale: 0.9,
    beatMs: 280,
    pitchShiftSemitones: -0.5,
  },
  work: {
    speedScale: 1.0,
    ending: '!',
    groupSeparator: ', ',
    finalAccentDb: 2.2,
    contourScale: 1.0,
    beatMs: 210,
    pitchShiftSemitones: -0.85,
  },
  push: {
    speedScale: 1.12,
    ending: '!',
    // A comma still, even here. Running the groups together was flatter, not
    // more urgent: without the break there is nothing for the accent to land
    // against.
    groupSeparator: ', ',
    finalAccentDb: 3.0,
    contourScale: 1.2,
    beatMs: 150,
    pitchShiftSemitones: -1.1,
  },
}

/**
 * How far the pitch actually moves.
 *
 * The first pass was audibly too flat — the contour was there but shallow
 * enough to read as an even delivery. Expression multiplies the whole curve,
 * so the sing-song can be dialled without re-authoring every control point.
 */
export const EXPRESSION = {
  measured: 1.0,
  expressive: 1.9,
  /** Chosen by ear over music, across every phrase in the round-two audition. */
  theatrical: 2.6,
}

/** Base synthesis speed per cadence, before the performance scales it. */
export const CADENCE_SPEED = {
  technical: 1.0,
  steady: 1.15,
  pressure: 1.32,
  sprint: 1.5,
}

/* ------------------------------------------------------------------- contour */

/**
 * How the last punch is hit — the ending inflection.
 *
 * Aggression lives here more than anywhere else. But the downward finish is a
 * dead lever under the theatrical setting: the final fall is already clamped
 * to the pitch floor (see `MAX_ABS_SEMITONES`), so asking for a bigger drop
 * changes nothing. The inflection that survives is the **up-kick before the
 * punch** and whether the phrase ends *up* — a shout — instead of settling.
 * That is also the truer read of an old cornerman on the power punch: the
 * voice rises into it, it does not sink.
 *
 * `peakSt` is the lift just before the last strike; `endSt` is where the very
 * last moment lands (positive = a rising shout); `accentDb` adds to the
 * loudness punch the texture applies to the finish.
 */
/**
 * `peakSt` is the lift into the last strike; `endSt` is where the final moment
 * lands (positive = a rising shout); `accentDb` adds to the loudness punch.
 *
 * These are applied to the **measured last voiced region** of the clip, not to
 * a normalized position, because the power-punch vowel does not sit at a fixed
 * fraction of a phrase — on a longer combination a normalized "finish" point
 * drifts off the actual word. The region is found from the pitch track in
 * `pitch_contour.py`; the rest of the contour stays finish-neutral so the
 * ending is shaped once, on the right syllable.
 */
export const FINISHES = {
  /** The settled baseline: rise, then land hard. */
  land: { peakSt: 1.5, endSt: -2.1, accentDb: 0 },
  /** Louder and later, but still landing down — aggression by weight. */
  slam: { peakSt: 1.6, endSt: -2.4, accentDb: 3.0 },
  /** Rises into the punch and stays up: the corner shouting the finish. */
  shout: { peakSt: 2.2, endSt: 2.6, accentDb: 3.0 },
  /** Widest swing — hard up-kick, ends up, loudest. */
  snap: { peakSt: 2.8, endSt: 1.4, accentDb: 3.5 },
}

/**
 * A single command strikes: brief rise, then a neutral settle.
 *
 * The ending is owned by the finish region (below), same as a combination, so
 * this stays neutral rather than baking in a fall the finish would fight.
 */
const SINGLE_CONTOUR = [
  { at: 0.0, st: 0.3 },
  { at: 0.45, st: 0.9 },
  { at: 1.0, st: 0.0 },
]

/**
 * Build the contour from the **actual groups**, not from a strike count.
 *
 * The first pass interpolated a fixed curve across the whole phrase, so its
 * peaks landed wherever they happened to fall rather than on the words that
 * carry the accent. Anchoring each control point to a group boundary is what
 * makes the rise arrive *on* the second punch of a pair and the fall land *on*
 * the finish.
 *
 * A movement token gets the opposite shape from a punch pair: it comes in
 * above the line and drops hard below it. That drop is the interruption — it
 * is why the melodic run breaks at the roll instead of absorbing it as one
 * more item in a list.
 */
export function groupSpans(groups) {
  // A movement is short in words but long in time, because of the beats on
  // either side of it. Weighting it above one token keeps the following group
  // from starting early.
  const weights = groups.map((g) => (isMovement(g[0]) ? 1.4 : g.length))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const spans = []
  let cursor = 0
  groups.forEach((group, index) => {
    const span = weights[index] / total
    spans.push({ start: cursor, end: cursor + span, span, movement: isMovement(group[0]), index })
    cursor += span
  })
  return spans
}

function contourForGroups(groups, depth) {
  if (groups.length === 1 && groups[0].length === 1 && !isMovement(groups[0][0])) {
    return SINGLE_CONTOUR.map((p) => ({ at: p.at, st: p.st }))
  }

  const points = []
  groups.forEach((group, index) => {
    const { start, end, span } = groupSpans(groups)[index]
    const isLast = index === groups.length - 1

    if (isMovement(group[0])) {
      points.push({ at: start + span * 0.15, st: 1.3 })
      points.push({ at: end - span * 0.1, st: -1.2 })
      return
    }

    // Light on the entry, heavy on the strike that ends the group. The very
    // last group stays neutral at its tail — the finish region owns the
    // ending, applied to the measured word rather than an estimated position.
    points.push({ at: start + span * 0.08, st: index === 0 ? -0.5 : -0.25 })
    if (group.length > 1) points.push({ at: start + span * 0.42, st: -0.7 })
    points.push({ at: end - span * 0.14, st: 1.15 })
  })

  return points
}

/**
 * What Praat can resynthesize before it starts to sound processed.
 *
 * `pitch_contour.py` clamps to this too, and that is the point: without the
 * same limit here the plan written into the sidecar would claim a move the
 * audio never made. The theatrical setting on a four-strike phrase asks for
 * about -6 st on the final fall and gets -4.5, so the sidecar has to say -4.5.
 */
const MAX_ABS_SEMITONES = 4.5

function scaleContour(points, depth, shift) {
  const clamp = (value) =>
    Math.max(-MAX_ABS_SEMITONES - shift, Math.min(MAX_ABS_SEMITONES - shift, value))
  return points
    .map((p) => ({
      normalizedTime: Math.round(Math.max(0, Math.min(1, p.at)) * 1000) / 1000,
      offset: Math.round(clamp(p.st * depth) * 100) / 100,
    }))
    // Praat interpolates between points in order; an out-of-order pair would
    // silently produce a flat segment rather than an error.
    .sort((a, b) => a.normalizedTime - b.normalizedTime)
}

/* ------------------------------------------------------------------ compiler */

/**
 * Rhythmic swing, as a proportion of each pair given to the first syllable.
 *
 * 0.50 is perfectly even; 0.57 is the old-coach roll. It is expressed through
 * punctuation and target duration, never by chopping rendered words — the
 * coach should sound like they are leaning into each pair, not like a
 * sequencer moving clips.
 */
export const SWING = 0.57

/**
 * Lowercase every word except the first.
 *
 * "One two, three two" reads as one utterance; "One Two, Three Two" invites
 * the synthesizer to treat each word as its own emphatic unit, which is the
 * evenly-stressed delivery this whole system exists to avoid.
 */
function lowercaseInterior(text) {
  let seenFirst = false
  return text.replace(/[A-Za-z][A-Za-z']*/g, (word) => {
    if (!seenFirst) {
      seenFirst = true
      return word
    }
    return word.toLowerCase()
  })
}

/**
 * Real air on both sides of a movement token.
 *
 * A comma gave the roll exactly the weight of any other word in the list,
 * which is why it read as `one two roll three two` rather than as a break.
 * The beat before it stops the run; the beat after it restarts one.
 */
const MOVEMENT_BEAT = '... '

/**
 * Assemble the spoken line, group by group.
 *
 * Two things happen here that a plain `join` cannot do: the separator depends
 * on **which** boundary it sits at, and a movement takes its own terminal
 * punctuation. That `!` is what makes the synthesizer land the word hard
 * instead of trailing it into the next group, and it restores sentence case
 * for the group that follows.
 */
function renderBody(spokenGroups, perf, phased = false) {
  let out = ''
  let capitalize = true

  spokenGroups.forEach((group, index) => {
    if (index > 0) {
      const atMovement =
        isMovement(group.tokens[0]) || isMovement(spokenGroups[index - 1].tokens[0])
      // An authored phase boundary earns the movement-strength pause: the
      // groups are separate remembered motifs, not a running list.
      out += atMovement || phased ? MOVEMENT_BEAT : perf.groupSeparator
    }

    // Sentence case, not Title Case On Every Word. Capitalising each word
    // invites the synthesizer to treat every one as its own emphatic unit,
    // which is the evenly-stressed delivery this system exists to avoid.
    const inner = lowercaseInterior(group.text)
    out += capitalize
      ? inner.charAt(0).toUpperCase() + inner.slice(1)
      : inner.charAt(0).toLowerCase() + inner.slice(1)

    const interruption = isMovement(group.tokens[0]) && index < spokenGroups.length - 1
    if (interruption) out += '!'
    // The group after a beat starts a new sentence, and so does the movement
    // itself — a lowercase word after an ellipsis is read as a continuation,
    // which is the one thing the interruption must not be. A phased group
    // boundary is the same kind of break.
    capitalize =
      interruption ||
      phased ||
      (index + 1 < spokenGroups.length && isMovement(spokenGroups[index + 1].tokens[0]))
  })

  return out
}

/**
 * Where the phrase must stop, and for how long.
 *
 * The synthesizer will not give both beats on its own: an ellipsis buys a
 * real pause *before* a word, but nothing after it — measured across six
 * spellings, the trailing gap stayed at 40 ms whether the word was followed
 * by `!`, `.`, `--` or a doubled ellipsis. So the entry beat is asked for in
 * the text and the exit beat is set here, in the rendered audio.
 *
 * These positions are approximate on purpose. The inserter searches for the
 * quietest point nearby rather than cutting at the arithmetic estimate, so a
 * drifting estimate lengthens a silence instead of clipping a consonant.
 */
function beatsFor(groups, beatMs, phased = false) {
  const beats = []
  for (const span of groupSpans(groups)) {
    if (span.movement) {
      if (span.index > 0) beats.push({ at: span.start, targetMs: beatMs })
      if (span.index < groups.length - 1) beats.push({ at: span.end, targetMs: beatMs })
      continue
    }
    // Authored phase boundaries get a real audio beat at each group start —
    // the ellipsis buys the entry pause in text, this guarantees it in the
    // rendered take (see the note above on synthesizer trailing gaps).
    if (phased && span.index > 0) beats.push({ at: span.start, targetMs: beatMs })
  }
  return beats
}

/**
 * Compile a canonical token sequence into a performance plan.
 *
 * The plan is written into the sidecar alongside the audio, so every clip
 * records how it was made — which is what makes a regeneration reproducible
 * and a bad take diagnosable.
 */
export function compilePhrase({
  tokens,
  vocabulary = 'numbers',
  cadence = 'steady',
  performance = 'work',
  expression = 'theatrical',
  finish = 'land',
  grouping,
}) {
  const perf = PERFORMANCES[performance]
  const fin = FINISHES[finish] ?? FINISHES.land
  const depth = (EXPRESSION[expression] ?? EXPRESSION.expressive) * perf.contourScale
  // An authored spoken grouping (corpus v1) overrides the automatic pairing:
  // "1-4-2-3-6-5" is called "One-FOUR... two-THREE... six-FIVE!", three
  // remembered motifs, never six flat digits. The grouping must be a
  // partition of the tokens — a corpus error surfaces here, not on the bag.
  let groups
  if (grouping && grouping.length > 0) {
    const flat = grouping.flat()
    if (flat.length !== tokens.length || flat.some((t, i) => t !== tokens[i])) {
      throw new Error(
        `grouping ${JSON.stringify(grouping)} is not a partition of tokens ${tokens.join('-')}`,
      )
    }
    groups = grouping.map((g) => [...g])
  } else {
    groups = groupTokens(tokens)
  }
  const phased = Boolean(grouping && grouping.length > 1)
  const strikes = tokens.filter((t) => !isMovement(t)).length

  const spokenGroups = groups.map((group) => ({
    tokens: group,
    // The last token of a punch pair carries the accent; a lone movement
    // token does not, because it is a landing of a different kind.
    accentLast: group.length > 1 || !isMovement(group[0]),
    text: group.map((t) => spokenFor(t, { vocabulary, cadence })).join(' '),
  }))

  return {
    canonicalTokens: [...tokens],
    calloutMode: vocabulary,
    cadence,
    performance,
    expression,
    finish,
    groups: spokenGroups.map((g) => ({ tokens: g.tokens, accentLast: g.accentLast })),
    renderedText: `${renderBody(spokenGroups, perf, phased)}${perf.ending}`,
    pitchContourSemitones: scaleContour(
      contourForGroups(groups, depth),
      depth,
      perf.pitchShiftSemitones,
    ),
    // Depth-scaled finish targets, applied to the measured last voiced region
    // by pitch_contour.py. Kept out of the normalized contour so the ending is
    // shaped on the actual power-punch syllable, not an estimated position.
    finishShape: {
      peakSemitones: Math.round(fin.peakSt * depth * 100) / 100,
      endSemitones: Math.round(fin.endSt * depth * 100) / 100,
    },
    beats: beatsFor(groups, perf.beatMs, phased),
    swing: SWING,
    finalAccentDb: perf.finalAccentDb + fin.accentDb,
    pitchShiftSemitones: perf.pitchShiftSemitones,
    speed: Math.round((CADENCE_SPEED[cadence] ?? 1.15) * perf.speedScale * 100) / 100,
    /** A single strike is a different performance, not a short combination. */
    profile: strikes <= 1 && groups.length === 1 ? 'single' : 'combination',
  }
}

/**
 * Ad-libs — the personality layer between the calls.
 *
 * "Ha!", "There it is!", "Let's go!", a breath. Not a combination: there is no
 * notation, no grouping and no digit to place, just a fixed exclamation
 * delivered with the same voice and finish as everything else. It is compiled
 * rather than hand-tuned so an ad-lib picks up the settled contour, drift and
 * finish for free and cannot drift away from the rest of the persona.
 *
 * Delivered as a `single` profile — short, punchy, dry — and the finish region
 * carries the ending, same as a one-word call.
 */
export function compileAdlib(text, { performance = 'push', expression = 'theatrical', finish = 'shout' } = {}) {
  const perf = PERFORMANCES[performance]
  const fin = FINISHES[finish] ?? FINISHES.land
  const depth = (EXPRESSION[expression] ?? EXPRESSION.expressive) * perf.contourScale
  return {
    canonicalTokens: [],
    calloutMode: 'adlib',
    cadence: 'steady',
    performance,
    expression,
    finish,
    adlib: true,
    renderedText: text,
    pitchContourSemitones: scaleContour(
      SINGLE_CONTOUR.map((p) => ({ at: p.at, st: p.st })),
      depth,
      perf.pitchShiftSemitones,
    ),
    finishShape: {
      peakSemitones: Math.round(fin.peakSt * depth * 100) / 100,
      endSemitones: Math.round(fin.endSt * depth * 100) / 100,
    },
    beats: [],
    swing: SWING,
    finalAccentDb: perf.finalAccentDb + fin.accentDb,
    pitchShiftSemitones: perf.pitchShiftSemitones,
    // A touch quicker than a call — an ad-lib is thrown off, not announced.
    speed: Math.round((CADENCE_SPEED.steady * perf.speedScale * 1.1) * 100) / 100,
    profile: 'single',
  }
}
