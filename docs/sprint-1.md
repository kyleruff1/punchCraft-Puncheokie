# Sprint 1 — Velocity Lab Bluetooth listener

**Dates:** 2026-08-24 → 2026-09-04 (2 weeks; the Sprint iteration field on Project #5 allows rollover since Phase 1 is hardware-gated and exploratory).

**Sprint goal:** an installable Velocity Lab development build that connects to one FightCamp v1 tracker, records **every** frame before parsing, exports captures for analysis on the Windows PC, and yields at least one repeatable frame associated with a known controlled punch; then both trackers connected concurrently.

The user's stated foundation is "sync to bluetooth trackers, then build out the rest after we are setup with one tracker." Sprint 1 keeps that foundation and stops at one repeatable punch frame + dual-tracker connectivity.

## Hardware prerequisites (M01 — user-owned, can run in parallel)

- Android tablet available and its USB cable located.
- Both trackers charged and physically labeled blue = left, red = right (§4.1).
- Official FightCamp app installed and paired if it can still connect, so HCI snoop captures can be recorded before the discontinued experience stops working.

Until the tablet is attached (`adb devices` lists it) and M01 hardware steps are complete, Story 4 (physical connect) and later cannot pass. Stories 1–3 can run on the Windows PC alone; Story 1 requires the tablet only for the "install over USB" acceptance criterion.

## Stories (in order)

| # | Milestone | Story | Depends on | Blocks |
|---|---|---|---|---|
| S1 | M02 | Create installable native development build (§23 Story 1) | M01 hardware for install | S2 |
| S2 | M03 | Request and explain BLE permissions (§23 Story 2) | S1 | S3 |
| S3 | M04 | Scan and capture advertisements (§23 Story 3) | S2 | S4 |
| S4 | M05 | Connect and inventory one tracker (§23 Story 4) | S3 | S5 |
| S5 | M06 | Subscribe and persist raw notifications (§23 Story 5) | S4 | S6 |
| S6 | M07 | Mark controlled observations (§23 Story 6) | S5 | S8 |
| — | M08 | Disconnect / reconnect resilience | S5 | S8 |
| S8 | M10 | Capture one known punch event (§23 Story 8) — go/no-go | S6, M08 | S7 |
| S7 | M09 | Repeat for two trackers (§23 Story 7) | S8 | — |

Sequencing note: the design spec (§23) lists Story 7 (two trackers) before Story 8 (single punch frame). This sprint deliberately does Story 8 before Story 7 because the user's stated goal is "set up with one tracker" before building out the rest. Both remain in the sprint.

## Sprint acceptance / exit criteria

All eight initial-success items from §3.3, applied to at least one tracker, are demonstrated:

- [ ] Scans for and discovers a tracker.
- [ ] Connects without the official FightCamp app running.
- [ ] Discovers and displays the tracker's GATT services and characteristics.
- [ ] Subscribes to all relevant notify/indicate characteristics.
- [ ] A known punch produces a repeatable captured frame or sequence.
- [ ] Same operation succeeds with both trackers concurrently (Story 7).
- [ ] Captures export as JSON and are analyzable on the Windows PC.
- [ ] Disconnect → reconnect resumes listening without restarting the process.

Plus the M10 go/no-go decision: is a third-party tracker client feasible given what we observed (encryption, session tokens, mandatory unavailable server, other risks per §24)?

## Explicit non-goals for Sprint 1

- No punchCraft timers, no metric polish, no session persistence beyond the raw-frame `ble_captures` / `ble_frames` tables and the GATT inventory (§17.1).
- No Puncheokie program authoring or cue engine.
- No Spotify authorization.
- **No writes to unknown GATT characteristics** (§7.2C, §12.1). Guarded writes stay disabled outside developer mode.
- No protocol decoding beyond identifying the punch-frame boundaries (Phase 2 territory).

## BLE library × Expo SDK spike (part of M02 Story 1)

The spec (§11.2) requires a scan/connect spike on the target tablet before locking versions. The spike walks these stacks in order (scan → connect → discover → subscribe to one notify characteristic) and locks the first that passes on the tablet:

| # | Stack | Notes |
|---|---|---|
| 1 (primary) | Expo **SDK 57** + `@sfourdrinier/react-native-ble-plx` **3.9.3** | Built for RN 0.86 New-Architecture + Expo SDK 57+, compileSdk 36. Same API surface as upstream so §11.4 boundaries hold. Fork risk mitigated by keeping BleManagerFacade thin. |
| 2 | Expo SDK 57 + `react-native-ble-manager` **12.5.1** | Actively maintained; New Arch on RN 0.76+; event-emitter style — facade absorbs the difference. |
| 3 (fallback) | Expo **SDK 54** + upstream `react-native-ble-plx` **3.5.1** with `"newArchEnabled": false` | SDK 54 is the last Expo SDK that can disable the New Architecture. Locks the project to an older SDK line; acceptable for a personal prototype. |
| 4 (only if 1–3 fail) | Expo SDK 57 + upstream 3.5.1 | Unverified on the New Architecture (issue #1277 open) — connect crashes are reported. |

Outputs: pass/fail row per stack; locked versions committed to `README.md` + `package.json`; known-good APK archived under `artifacts/`; Android SDK components requested by the chosen stack (expected platform 36 + build-tools 36.x for SDK 57 — currently only platform 35 / build-tools 34 are installed) installed via `sdkmanager`, licenses accepted, documented in `docs/dev-setup.md`.

## Project one-click settings (API-only fields the seed can't set)

The seed script creates the four views (name + layout + visible fields). GitHub's Projects API cannot set filter/group-by/sort — do this once in the browser:

- **Sprint board** — layout BOARD; filter `sprint:@current`; column field = Status.
- **Roadmap by milestone** — layout TABLE; group by Milestone.
- **Epics** — layout TABLE; filter `label:epic`; add the "Sub-issues progress" column.
- **Timeline** — layout ROADMAP; date field = Sprint.

Also (one-click, in project ⋯ menu → Workflows): enable **Auto-add to project** for `is:issue is:open repo:kyleruff1/punchCraft-Puncheokie` so new issues drop onto the board without re-running the seed.

## Sprint 2 preview (not yet assigned)

M11 → M13: HCI-writes vs GATT inventory diff, observed-only initialization writes, FightCampV1Adapter skeleton with device-status decoding, and the first pass at punch-event decoding using the Sprint 1 fixture.
