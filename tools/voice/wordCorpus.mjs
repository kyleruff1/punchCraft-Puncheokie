/**
 * The per-word clip corpus — every word the Voice Coach can speak alone,
 * the synthesised tones, and the per-form delivery speeds.
 *
 * Extracted from `make-voice-clips.mjs` so validation tooling can know what
 * each word clip should say (and how fast it was fitted) without importing
 * the generator, which executes at import. One source of truth: adding a
 * word here is what makes both the render and the validation cover it.
 */

/** Words that differ between vocabularies (D15). */
export const VOCABULARY_WORDS = {
  numbers: { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' },
  names: {
    1: 'Jab',
    2: 'Cross',
    3: 'Lead hook',
    4: 'Rear hook',
    5: 'Lead uppercut',
    6: 'Rear uppercut',
  },
}

/** Words that are the same in both vocabularies. */
export const SHARED_WORDS = {
  body: 'Body',
  slip: 'Slip',
  roll: 'Roll',
  duck: 'Duck',
  pull: 'Pull',
  'bob-weave': 'Bob and weave',
  pivot: 'Pivot',
  'step-off': 'Step off',
  circle: 'Circle',
  'cut-off-ring': 'Cut off the ring',
  reset: 'Reset',
  go: 'Go',
  stop: 'Stop',
  switch: 'Switch',
  // Coast announcements (D23). Whole sentences rather than words: "coast for
  // half a minute" is one instruction, and stitching it from parts at run time
  // is what D16 forbids. The lengths and their wording are mirrored in
  // `src/domain/workout/coast.ts`, which a test holds to this list.
  'coast-15': 'Coast for fifteen seconds',
  'coast-30': 'Coast for half a minute',
  'coast-45': 'Coast for forty-five seconds',
  'coast-60': 'Coast for a minute',
}

/**
 * Tones are sounds, not words, so they are synthesised rather than spoken —
 * and they are identical in both vocabularies.
 *
 * The bell is a longer, lower ring; the ready tone is short and high so it
 * reads as "now" rather than as a word.
 */
export const TONES = {
  bell: { freqHz: 660, durationMs: 400, fadeOutMs: 250 },
  'tone-ready': { freqHz: 1_320, durationMs: 80, fadeOutMs: 20 },
  'tone-repeat': { freqHz: 990, durationMs: 60, fadeOutMs: 15 },
  'tone-warning': { freqHz: 520, durationMs: 300, fadeOutMs: 120 },
}

/**
 * Synthesis speed per form.
 *
 * `combo` is faster because it is a word inside a run, not an announcement.
 * Both are a single-strike delivery through `compileAdlib`; only the tempo
 * differs, so the consonants stay crisp rather than being smeared at runtime.
 */
export const FORM_SPEED = { standalone: 1.18, combo: 1.5 }

/**
 * The longest a spoken command may plausibly run, before the tempo fit.
 *
 * A per-token call has to land on a beat, and the fastest cadence gives it
 * about 430ms — so a digit that renders at three seconds is not a stylistic
 * variation, it is unusable. Chatterbox is genuinely unstable on inputs this
 * short: measured, a bare "Five!" came back at 2.20s on one run and 0.80s on
 * the next from identical settings, and no `cfg_weight` removed the spread.
 * The renderer therefore takes a bound and keeps generating until a take fits.
 *
 * Scaled by word count so "cut off the ring" is not held to a digit's budget,
 * and by form because a combo word is clipped tighter than an announcement.
 *
 * Widened when the ASR gate landed. The old ceilings (620/780) were tuned
 * when duration was the only proxy for a correct take, so the window was
 * squeezed until wrong-length takes could not ship — and the gate's first
 * hotfix run showed most combo takes never fitting it at all (12/12 over,
 * ASR never consulted). With correctness checked directly by transcript,
 * the ceiling's only job is the beat budget: a combo word may run ~430ms
 * after the ~2.03x tempo fit, which admits ~860ms before it.
 */
export function maxWordMs(words, form) {
  const base = form === 'combo' ? 860 : 1040
  return base + Math.max(0, words - 1) * 300
}
