"""
Renders the punch-avatar stop-motion frames and their manifest.

Source art (masters, not shipped): assets/branding/Punch Step1s/ and
Punch Step2s/ — 1024x1536 RGBA line drawings, one pair per punch. Step 1
is the guard/wind-up, step 2 is the strike; the figure keeps the same
framing across a pair, which is what makes the two-frame flip read as
motion rather than a jump.

This script downscales and palette-quantizes them into
assets/avatar/punch/, named by the PUNCH NOTATION rather than the
artist's filename, so nothing at runtime has to know that "lbuppercut"
means 5b. It then emits src/components/workout/punchAvatarManifest.ts.

The source stems are derived from the same rules the app uses to render
a punch token — technique family by number, lead/rear by number, body by
the token's own flag — so there is exactly ONE mapping in the system and
a renamed asset fails loudly here instead of drifting at runtime.

Run:  F:/voice-tools/venv/Scripts/python.exe tools/avatar/make_punch_frames.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
STEP1_DIR = ROOT / "assets" / "branding" / "Punch Step1s"
STEP2_DIR = ROOT / "assets" / "branding" / "Punch Step2s"
OUT_DIR = ROOT / "assets" / "avatar" / "punch"
MANIFEST = ROOT / "src" / "components" / "workout" / "punchAvatarManifest.ts"

# Tall enough to stay crisp as a large watermark behind the token row;
# small enough that all 24 frames together stay under a megabyte.
FRAME_HEIGHT = 640
PALETTE_COLORS = 128


def source_stem(number: int, body: bool) -> str:
    """Artist's filename stem for a punch — the ONLY place that grammar lives."""
    if number in (1, 2):
        # Straights carry no lead/rear prefix; their hand is implied.
        base = "jab" if number == 1 else "cross"
        return ("b" if body else "") + base
    side = "l" if number in (3, 5) else "r"
    family = "hook" if number in (3, 4) else "uppercut"
    return side + ("b" if body else "") + family


def key_of(number: int, body: bool) -> str:
    return f"{number}b" if body else str(number)


def render(src: Path, dest: Path) -> int:
    im = Image.open(src).convert("RGBA")
    width = round(im.width * FRAME_HEIGHT / im.height)
    im = im.resize((width, FRAME_HEIGHT), Image.LANCZOS)
    # FASTOCTREE keeps alpha through the palette, which the line art needs:
    # everything outside the figure must stay fully transparent.
    im.quantize(colors=PALETTE_COLORS, method=Image.FASTOCTREE).save(
        dest, "PNG", optimize=True
    )
    return dest.stat().st_size


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    total = 0
    for number in (1, 2, 3, 4, 5, 6):
        for body in (False, True):
            stem = source_stem(number, body)
            key = key_of(number, body)
            pairs = (
                (STEP1_DIR / f"{stem}1.png", OUT_DIR / f"{key}-s1.png"),
                (STEP2_DIR / f"{stem}.png", OUT_DIR / f"{key}-s2.png"),
            )
            for src, dest in pairs:
                if not src.exists():
                    raise SystemExit(f"missing source art: {src}")
                total += render(src, dest)
            rows.append((key, number, body, stem))

    lines = [
        "/**",
        " * Punch-avatar stop-motion frames (generated).",
        " *",
        " * DO NOT EDIT — produced by",
        " * `F:/voice-tools/venv/Scripts/python.exe tools/avatar/make_punch_frames.py`.",
        " *",
        " * One entry per punch (1..6 x head/body). `step1` is the STRIKE",
        " * (the unique frame that gets first-half priority when windows are",
        " * tight, Kyle 2026-08-30), `step2` is the RETRACTED position (the",
        " * guard, which looks similar across punches so it works fine as the",
        " * second half). Lookup is by the token's own number + body flag,",
        " * so the punch nodes and the avatar card share one mapping.",
        " */",
        "import type { PunchNumber } from '@domain/workout/WorkoutTokens'",
        "",
        "export interface PunchAvatarFrames {",
        "  /** Punch notation — '1', '1b', ... '6b'. */",
        "  key: string",
        "  number: PunchNumber",
        "  body: boolean",
        "  /** Metro module id for the STRIKE frame (shown first, Kyle 2026-08-30). */",
        "  step1: number",
        "  /** Metro module id for the RETRACTED/guard frame (shown second). */",
        "  step2: number",
        "}",
        "",
        "/* eslint-disable @typescript-eslint/no-require-imports */",
        "export const punchAvatarFrames: readonly PunchAvatarFrames[] = [",
    ]
    for key, number, body, stem in rows:
        rel = "../../../assets/avatar/punch"
        lines += [
            "  {",
            f'    key: "{key}",',
            f"    number: {number},",
            f"    body: {str(body).lower()},",
            # A19 (2026-08-30): step1 is the STRIKE frame (from the -s2
            # source), step2 is the RETRACTED position (from the -s1
            # source). The scheduler shows step1 first, so the unique
            # strike lands in the first half of the split and the
            # generic retracted position holds the second half.
            f"    step1: require('{rel}/{key}-s2.png'),",
            f"    step2: require('{rel}/{key}-s1.png'),",
            "  },",
        ]
    lines += [
        "]",
        "/* eslint-enable @typescript-eslint/no-require-imports */",
        "",
        "/** Frames for a punch token. Undefined only if a render is missing. */",
        "export function findPunchAvatar(",
        "  number: PunchNumber,",
        "  body: boolean,",
        "): PunchAvatarFrames | undefined {",
        "  return punchAvatarFrames.find((f) => f.number === number && f.body === body)",
        "}",
        "",
    ]
    MANIFEST.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {len(rows) * 2} frames to {OUT_DIR} ({total / 1024 / 1024:.2f} MB)")
    print(f"wrote {MANIFEST}")


if __name__ == "__main__":
    main()
