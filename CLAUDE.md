# CLAUDE.md — working conventions for PunchLab · Puncheokie

Read [docs/design-spec.md](docs/design-spec.md) before changing architecture, protocol, metrics, calibration, or Spotify behavior. Section numbers below (§) refer to it.

## Non-negotiable rules

1. **Raw before parsed.** Every incoming BLE frame is persisted (`RawBleFrame`, §12.4) with a monotonic timestamp *before* any decoder runs. A parse failure never discards the payload.
2. **Dependency direction points inward** (§15.1). `src/domain/**` must not import React, React Native, Expo, SQLite, or any BLE library. React components never call the BLE library directly — they call application services/commands (§11.4).
3. **Terminology.** The value from the tracker is **tracker-reported velocity** (§4.3). Never label it impact speed, force, power, energy, or a physical unit unless a saved external-validation record exists (§10.1 Layer 4).
4. **Never write to unknown GATT characteristics.** Only reproduce writes observed from the official app; guarded writes require developer mode and a known command template (§7.2C, §12.1).
5. **Version lock** (§11.2). Expo, React Native, and the BLE library versions are locked after the Story 1 spike. Do not upgrade the Expo SDK during protocol discovery except on a separate compatibility branch; keep a known-good APK.
6. **Monotonic time for ordering and timers; wall time only for display/export** (§3.2, §18.3).
7. **Decoders and calibration profiles are versioned**; stored sessions must be recalculable after a decoder change (§3.2, §8.6).
8. **Spotify** is optional, PKCE-only, tokens in SecureStore, minimal scopes, no client secret anywhere in the repo, no audio analysis or beat sync (§14).

## Repository layout

- `docs/` — spec, roadmap, sprint plans, dev setup, protocol notes. `docs/protocol/hypotheses.md` is the protocol hypothesis log (confidence + evidence per entry).
- `tools/backlog/` — backlog-as-code (`backlog.json`) and the idempotent GitHub seeding scripts.
- `src/` — created in Sprint 1 Story 1 following §16 (`app/`, `ble/`, `protocol/`, `capture/`, `domain/`, `spotify/`, `storage/`, `state/`, `components/`, `diagnostics/`).
- `captures/` and `artifacts/` are git-ignored local folders for raw captures and APKs. Curated replay fixtures live in `src/protocol/<adapter>/fixtures/`.

## GitHub conventions

- 30 Milestones = the roadmap (`M01`…`M30`). 8 Epics = phases (`[EPIC] Phase N — …`, label `epic`). Every task/story/spike issue has: a milestone, a `phase:N` label, an `area:*` label, a type label, and is a sub-issue of its phase epic.
- Project board: https://github.com/users/kyleruff1/projects/5 — fields Phase, Area, Priority, Size, Sprint (2-week iterations from 2026-08-24).
- New work items: add them to `tools/backlog/backlog.json` and run `node tools/backlog/seed.mjs` (idempotent), or create the issue in GitHub with the same labels/milestone/parent.
- Branch per issue (`feat/M05-02-tracker-connection`), PR title `<type>: <summary> (#issue)`, PR body `Closes #N`.
- Commit messages: conventional prefix (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), imperative mood.

## Testing expectations (§21)

- Pure domain functions get unit tests (decoding helpers, dedup, calibration transforms, percentiles, timer transitions, stance mapping, cue matching, metric aggregation).
- Every confirmed capture becomes a replay fixture; the replay harness must run on Windows without Bluetooth hardware.
- Physical BLE behavior is verified on the tablet, never on the emulator.

## Toolchain facts (2026-08-22)

Windows 11, Node 24, npm 11, JDK 17, Android SDK at `C:/Users/kyler/android-sdk` (platform 35, build-tools 34.0.0, NDK 27.2 — Story 1 installs what the locked Expo SDK requests), `gh` authenticated as `kyleruff1`. Details in [docs/dev-setup.md](docs/dev-setup.md).
