#!/usr/bin/env bash
# The POST-FLOOR half of the breath-floor A/B. Run from F:/punchCraft in Git Bash.
#
# Every step here exists because a pre-flight audit found a way for the two
# runs to differ silently and produce a comparison that looks valid and is not.
# The gates abort rather than warn: a wrong run costs ~6 hours of tablet time
# and, worse, can be mistaken for evidence.
#
# The baseline it pairs with — three directories, because the tablet dropped
# off wireless adb after drive 21 and the remainder was driven separately:
#   suites/baseline-pre-floor            (21 numbers drives, sha b662310b)
#   suites/baseline-pre-floor-uppercut   (1 numbers drive,   sha b662310b)
#   suites/baseline-pre-floor-techniques (2 techniques drives, sha b662310b)
# 24 drives total. The comparator dedups across directories, so the split
# costs nothing analytically — but it does mean no single summary.json
# carries an exitCode on that side, which is why the comparison is gated on
# --expect-drives rather than on how each run happened to exit.
set -euo pipefail

REPO=/f/punchCraft
BRANCH=feat/timing-observer          # the post-floor tree
OUT_N=tools/analysis/suites/post-floor
OUT_T=tools/analysis/suites/post-floor-techniques

cd "$REPO"

say() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nABORT: %s\n' "$*" >&2; exit 1; }

# --- 1. the tree ------------------------------------------------------------
# The baseline run may have left regenerated manifests behind (a STALE retry
# writes into the tracked manifests/ dir), which would block the checkout.
say "tree"
if [ -n "$(git status --porcelain tools/analysis/manifests)" ]; then
  echo "manifests dirty from the baseline run — restoring"
  git checkout -- tools/analysis/manifests
fi
[ -z "$(git status --porcelain)" ] || die "working tree dirty; commit or stash first"
git checkout "$BRANCH"
HOST_SHA=$(git rev-parse --short HEAD)
echo "at $HOST_SHA"

grep -q 'DELIVERED_BREATH_SHORTFALL_MS' src/domain/coach/callPlacement.ts \
  || die "this tree has no DELIVERED_BREATH_SHORTFALL_MS — it is not the post-floor tree"

# --- 2. the constants cache -------------------------------------------------
# tools/analysis/* is GITIGNORED, so reports/timing-constants.json does NOT
# follow a checkout, and loadTimingConstants() PREFERS it over the source
# tree. Left stale, the post-floor run would be scored with pre-floor
# constants and every report would carry the wrong provenance.
say "constants"
rm -f tools/analysis/reports/timing-constants.json
node tools/analysis/timing-constants.mjs >/dev/null
read -r MIN SHORT <<<"$(node -e "const c=require('./tools/analysis/reports/timing-constants.json');console.log(c.breath.MIN_BREATH_MS, c.breath.DELIVERED_BREATH_SHORTFALL_MS)")"
echo "MIN_BREATH_MS=$MIN DELIVERED_BREATH_SHORTFALL_MS=$SHORT"
[ "$SHORT" = "95" ] || die "expected DELIVERED_BREATH_SHORTFALL_MS=95 on the post-floor tree, got '$SHORT'"

# --- 3. the manifests must match the tree -----------------------------------
# first-round-manifest.ts calls callDispatchAtMs, but STALE is detected from
# timelineHash, which placement constants do not touch. A stale manifest
# therefore reports LEAD-IN MISMATCHES, not STALE — a much harder thing to read.
say "manifests"
node --import ./tools/analysis/wav-stub.mjs --import tsx tools/analysis/first-round-manifest.ts --all >/dev/null
node --import ./tools/analysis/wav-stub.mjs --import tsx tools/analysis/first-round-manifest.ts --all --vocab=techniques >/dev/null
[ -z "$(git status --porcelain tools/analysis/manifests)" ] \
  || die "manifests regenerated to something different from the committed ones — commit them before running"

# --- 4. the build -----------------------------------------------------------
# app.config.ts bakes `git rev-parse --short HEAD` into the bundle, so the APK
# self-reports which tree it came from. adb install -r (never uninstall) so the
# app's persisted QA flag and settings carry across unchanged — they are
# unversioned state the two runs must share.
say "build"
( cd android && PATH=/usr/bin:$PATH ./gradlew assembleRelease --console=plain ) | tail -3
adb install -r android/app/build/outputs/apk/release/app-release.apk | tail -2

# --- 5. canary --------------------------------------------------------------
# A wrong-APK run is only a WARN inside verify-suite and never reaches
# summary.md. Twelve minutes here beats discovering it after five hours.
say "canary"
rm -rf tools/analysis/suites/canary-post-floor
node tools/analysis/verify-suite.mjs --only=quick-one-two --expect-release \
  --timing-gate=warn --out=tools/analysis/suites/canary-post-floor || true
CANARY_SHA=$(node -e "const s=require('./tools/analysis/suites/canary-post-floor/summary.json');console.log(s.rows[0].build.gitSha)")
[ "$CANARY_SHA" = "$HOST_SHA" ] || die "canary ran sha $CANARY_SHA, host is $HOST_SHA — the installed bundle is not this checkout"
! grep -q "WARN: build gitSha" tools/analysis/suites/canary-post-floor/suite.log || die "canary reported a build sha mismatch"
echo "canary clean at $CANARY_SHA"

# --- 6. device --------------------------------------------------------------
# Thermal/battery state lands directly in the metric being compared: delivered
# breath is measured from the real observed onset, and CPU scaling inflates it.
say "device"
adb shell settings put global low_power 0
adb shell "dumpsys battery | grep -E 'level|AC powered|temperature'"
echo "(the baseline started at: AC true, level 59, temperature 246)"

# --- 7. the runs, in the SAME ORDER as the baseline -------------------------
# Order is matched so position-in-run — and therefore thermal state — is
# comparable drive for drive. Never resume into an existing --out: verify-suite
# does not clear it, and a crashed verifier would then read the PREVIOUS run's
# derived JSON and render it as this run's numbers.
say "numbers (22 drives)"
rm -rf "$OUT_N"
node tools/analysis/verify-suite.mjs --all --expect-release --timing-gate=warn --out="$OUT_N" || true

say "techniques (2 drives)"
rm -rf "$OUT_T"
node tools/analysis/verify-suite.mjs --only=pump-and-coast,quick-coast-reset --vocab=techniques \
  --expect-release --timing-gate=warn --out="$OUT_T" || true

# --- 8. the verdict ---------------------------------------------------------
say "compare"
adb shell "dumpsys battery | grep -E 'level|temperature'"
node tools/analysis/compare-suites.mjs \
  --before tools/analysis/suites/baseline-pre-floor \
  --before tools/analysis/suites/baseline-pre-floor-uppercut \
  --before tools/analysis/suites/baseline-pre-floor-techniques \
  --after  "$OUT_N" \
  --after  "$OUT_T" \
  --expect-drives=24
