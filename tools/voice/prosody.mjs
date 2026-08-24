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

  let word
  if (vocabulary === 'techniques') {
    const entry = TECHNIQUE_WORDS[digit]
    word = COMPACT_CADENCES.has(cadence) ? entry.compact : entry.full
  } else {
    word = NUMBER_WORDS[digit]
  }
  return body ? `Body ${word.toLowerCase()}` : word
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
    contourScale: 0.7,
    pitchShiftSemitones: -0.5,
  },
  work: {
    speedScale: 1.0,
    ending: '!',
    groupSeparator: ', ',
    finalAccentDb: 2.2,
    contourScale: 1.0,
    pitchShiftSemitones: -0.85,
  },
  push: {
    speedScale: 1.12,
    ending: '!',
    // No breath left to take between groups.
    groupSeparator: ' ',
    finalAccentDb: 3.0,
    contourScale: 1.25,
    pitchShiftSemitones: -1.1,
  },
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
 * Normalized pitch contours: rise → settle → rise higher → hard finish.
 *
 * This is where the sing-song lives. It should read as a coach projecting,
 * never as singing, which is why the final fall is the largest move — a
 * combination ends by landing, not by trailing off.
 */
const CONTOURS = {
  2: [
    { at: 0.0, st: -0.4 },
    { at: 0.48, st: 0.7 },
    { at: 1.0, st: -1.3 },
  ],
  3: [
    { at: 0.0, st: -0.2 },
    { at: 0.45, st: 0.9 },
    { at: 1.0, st: -1.4 },
  ],
  4: [
    { at: 0.0, st: -0.3 },
    { at: 0.22, st: 0.8 },
    { at: 0.48, st: -0.2 },
    { at: 0.72, st: 1.0 },
    { at: 1.0, st: -1.5 },
  ],
}

/** A single command strikes: brief rise, strong fall, nothing else. */
const SINGLE_CONTOUR = [
  { at: 0.0, st: 0.3 },
  { at: 0.35, st: 0.6 },
  { at: 1.0, st: -1.8 },
]

function contourFor(strikeCount, scale) {
  const base =
    strikeCount <= 1 ? SINGLE_CONTOUR : (CONTOURS[Math.min(strikeCount, 4)] ?? CONTOURS[4])
  return base.map((point) => ({
    normalizedTime: point.at,
    offset: Math.round(point.st * scale * 100) / 100,
  }))
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
}) {
  const perf = PERFORMANCES[performance]
  const groups = groupTokens(tokens)
  const strikes = tokens.filter((t) => !isMovement(t)).length

  const spokenGroups = groups.map((group) => ({
    tokens: group,
    // The last token of a punch pair carries the accent; a lone movement
    // token does not, because it is punctuation rather than a landing.
    accentLast: group.length > 1 || !isMovement(group[0]),
    text: group.map((t) => spokenFor(t, { vocabulary, cadence })).join(' '),
  }))

  // Sentence case, not Title Case On Every Word. Capitalisation is for
  // readability here and nothing else — the acoustic stress comes from the
  // contour, the gain shaping and the voice, never from a capital letter.
  const body = spokenGroups
    .map((g, i) => (i === 0 ? g.text : g.text.charAt(0).toLowerCase() + g.text.slice(1)))
    .join(perf.groupSeparator)
  const renderedText = `${lowercaseInterior(body)}${perf.ending}`

  return {
    canonicalTokens: [...tokens],
    calloutMode: vocabulary,
    cadence,
    performance,
    groups: spokenGroups.map((g) => ({ tokens: g.tokens, accentLast: g.accentLast })),
    renderedText,
    pitchContourSemitones: contourFor(strikes, perf.contourScale),
    swing: SWING,
    finalAccentDb: perf.finalAccentDb,
    pitchShiftSemitones: perf.pitchShiftSemitones,
    speed: Math.round((CADENCE_SPEED[cadence] ?? 1.15) * perf.speedScale * 100) / 100,
    /** A single strike is a different performance, not a short combination. */
    profile: strikes <= 1 && groups.length === 1 ? 'single' : 'combination',
  }
}
