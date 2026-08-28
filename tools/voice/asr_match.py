"""Shared ASR text matching for the voice-clip QA loop.

This is the ONE implementation of "does this transcript say what the clip
should say" — imported by both the offline validators (validate_clips.py,
validate_capture.py, validate_session.py) and the render-time gate in
chatterbox_render.py. If the normalizer or the homophone table lived twice,
the gate and the validator would eventually disagree about the same audio,
and a clip could ship "passing" that validation then flags.

Design notes:
- The persona shouts stylized text ("One two bee!... Slip!"); Whisper may
  hear digits ("1 2 B"), homophones ("to", "won"), or split compounds
  ("upper cut"). Normalization folds those to canonical forms BEFORE
  scoring, so the score reflects missing/extra syllables rather than
  spelling choices.
- Inserted filler vowels (oh/ooh/ah...) are deliberately NOT folded away:
  an extra "ooh" the coach never scripted is exactly the artifact this
  loop exists to catch, so it must cost score and show up in `extra`.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

# Variant -> canonical. Everything not listed maps to itself.
_CANONICAL = {
    # The 'b' suffix is scripted as "bee" (prosody.mjs spells it to survive
    # interior lowercasing); Whisper renders it many ways.
    "b": "bee",
    "be": "bee",
    "bea": "bee",
    # Digits and number homophones.
    "1": "one",
    "won": "one",
    "2": "two",
    "to": "two",
    "too": "two",
    "3": "three",
    "tree": "three",
    "4": "four",
    "for": "four",
    "fore": "four",
    "5": "five",
    "6": "six",
    # Compounds Whisper splits or respells.
    "uppercut": "uppercut",
    "upper-cut": "uppercut",
    # Common contractions of scripted words.
    "n": "and",
    "'n": "and",
}

# Adjacent-token merges applied after canonicalization ("upper cut" -> "uppercut").
_MERGES = {
    ("upper", "cut"): "uppercut",
    ("step", "off"): "stepoff",
    ("step-off",): "stepoff",
}

# Filler vowels Chatterbox inserts that the script never contains. Kept as
# their own canonical class so validators can ask "was a filler inserted?"
FILLER_VOWELS = {"oh", "ooh", "oooh", "ooooh", "whoa", "woah", "ah", "aah", "ahh", "uh", "huh", "mm", "hmm", "hm"}

_WORD_RE = re.compile(r"[a-z0-9']+")


def normalize(text: str) -> list[str]:
    """Text -> canonical word tokens, ready for sequence comparison."""
    raw = _WORD_RE.findall(text.lower())
    tokens = [_CANONICAL.get(t, t) for t in raw]
    # Collapse elongated fillers (ooooooh -> ooh) so every stretch of the
    # artifact lands in the same class.
    tokens = ["ooh" if re.fullmatch(r"o+h*", t) and len(t) > 1 else t for t in tokens]
    tokens = ["ah" if re.fullmatch(r"a+h*", t) and len(t) > 1 else t for t in tokens]
    merged: list[str] = []
    for token in tokens:
        if merged and (merged[-1], token) in _MERGES:
            merged[-1] = _MERGES[(merged[-1], token)]
        else:
            merged.append(token)
    return merged


_FUSED_B = re.compile(r"^([1-6])b$")
_DIGIT_WORDS = {"1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six"}


def canonical_tokens(text: str) -> list[str]:
    """`normalize` plus the exactness folds the token audit compares with.

    - "2B" heard as one fused token expands to the spoken form ("two bee").
    - "uppercut" folds to "upper": compact cadences script "lead upper" and
      Whisper's language model autocompletes the technique name — same
      token either way, and the audit is about sequence, not wording.
    """
    out: list[str] = []
    for token in normalize(text):
        fused = _FUSED_B.fullmatch(token)
        if fused:
            out.extend([_DIGIT_WORDS[fused.group(1)], "bee"])
        elif token == "uppercut":
            out.append("upper")
        else:
            out.append(token)
    return out


def match_score(expected: str, transcript: str) -> dict:
    """Compare a transcript against the scripted text.

    Returns {score, expected, heard, missing, extra, filler}:
    - score: SequenceMatcher ratio over canonical token sequences, in [0, 1].
    - missing: scripted tokens the transcript never produced.
    - extra: transcript tokens the script never asked for.
    - filler: the subset of `extra` that is an inserted filler vowel — the
      "oooooh" artifact signature.
    """
    want = normalize(expected)
    got = normalize(transcript)
    matcher = SequenceMatcher(a=want, b=got, autojunk=False)
    score = matcher.ratio()

    missing: list[str] = []
    extra: list[str] = []
    for op, a0, a1, b0, b1 in matcher.get_opcodes():
        if op in ("delete", "replace"):
            missing.extend(want[a0:a1])
        if op in ("insert", "replace"):
            extra.extend(got[b0:b1])

    return {
        "score": round(score, 3),
        "expected": want,
        "heard": got,
        "missing": missing,
        "extra": extra,
        "filler": [t for t in extra if t in FILLER_VOWELS],
    }
