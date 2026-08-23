# Roadmap

The roadmap is 30 GitHub Milestones (`M01`…`M30`) grouped under 8 Phase Epics (`[EPIC] Phase 0` … `[EPIC] Phase 7`). Every task/story/spike issue is a sub-issue of its phase epic and lives on Project #5 with Phase, Area, Priority, Size, and (when scheduled) Sprint set.

- Board: https://github.com/users/kyleruff1/projects/5
- Milestones: https://github.com/kyleruff1/punchCraft-Puncheokie/milestones
- Backlog source: [`tools/backlog/backlog.json`](../tools/backlog/backlog.json) → seeded by [`tools/backlog/seed.mjs`](../tools/backlog/seed.mjs)

## Phase 0 — Preserve the baseline and establish the repository

- **M01** — Baseline preserved & official-app captures archived. Tablet + tracker inventory recorded (model, Android release, API level, Bluetooth chipset); trackers labeled blue=left/red=right; official-app HCI snoop logs + screen recordings archived on the Windows PC before the discontinued vendor experience stops working; Wireshark ATT/GATT isolation completed and first hypothesis-log entry recorded. (Spec §12.2, §22 Phase 0.)
- **M02** — Installable Expo development build. TS-strict Expo project, dev-client build installs over USB, build-info screen shows app/OS/dep versions + git SHA, known-good APK archived, exact Expo/RN/BLE-library versions locked after Story 1 spike, `npx expo run:android` runbook documented. (Spec §11.2, §22 Phase 0, §23 Story 1.)

## Phase 1 — Velocity Lab Bluetooth listener

The first functional product milestone; everything below runs in Sprint 1.

- **M03** — BLE permissions & Bluetooth-state onboarding. First-launch explainer, denied/permanently-denied → settings, Bluetooth-off distinguished from permission denial, `neverForLocation` decision based on on-device test. (§11.3, §23 Story 2, §7.2.)
- **M04** — Bounded scan & advertisement capture. TrackerScanner runs bounded 10–15 s, stop-on-found, keeps unfiltered advertisement metadata during discovery, dedup summary preserves latest RSSI/manufacturer bytes, JSON export. (§11.6, §23 Story 3.)
- **M05** — Single-tracker connect & GATT inventory. BleManagerFacade + TrackerConnection state machine (§11.5) with generation counter, GattOperationQueue serialized (§11.8), service discovery persisted to `gatt_inventory`, GATT inspector screen, device fingerprint + manual L/R assignment, clean-disconnect resource release, bonding-behavior spike closed. (§11.4, §11.7, §11.10, §23 Story 4.)
- **M06** — Notification subscription & raw-frame persistence. NotificationRouter subscribes to all safe notify/indicate characteristics, every callback stamped monotonic-first, RawBleFrame persisted **before** parsing (§12.4), listener workspace ring buffer (§7.2B) throttled 5–10 Hz, DB write-backlog indicator, developer-mode-only write guards. (§11.9, §23 Story 5, §7.2C.)
- **M07** — Observation markers & JSON capture export. Marker model on the same monotonic base as frames, `mark` UI with label picker, CaptureExporter JSON includes frames + markers + GATT + identity + versions, Windows-side correlation script under `tools/analysis/`. (§23 Story 6.)
- **M08** — Disconnect / reconnect resilience. Immediate disconnect detection, `recovering` state with bounded backoff and re-subscription, generation counter increments, reconnect button; foreground-only policy: keep-awake + background warning. (§11.5, §11.11, §19.3.)
- **M09** — Dual-tracker concurrent connections. TrackerCoordinator with independent L/R state machines, aggregate state (`noneReady`/`leftOnly`/`rightOnly`/`bothReady`/`degradedDuringSession`), frames tagged with device/hand, disconnecting one leaves the other untouched. (§11.5, §23 Story 7.)
- **M10** — First repeatable punch frame captured (go/no-go). ≥3 identical single-punch tests per hand vs no-motion baseline, repeatable frame/sequence identified, saved as a replay fixture, hypothesis logged without unverified physical units, third-party-feasibility go/no-go recorded (encryption or server-token risk from §24). (§23 Story 8.)

## Phase 2 — Protocol initialization, decoding, and synchronization

- **M11** — Initialization plan from observed traffic. Only writes seen in official-app captures are implemented; ProtocolAdapter + ProtocolRegistry contracts in place with capability scoring. (§12.3, §22 Phase 2 tasks 1–2.)
- **M12** — FightCampV1Adapter skeleton & device status decoding. Versioned adapter with unknown/malformed handling, ProtocolState, device-status decoding driving capability detection; endianness/fixed-point/length unit tests. (§12.3, §21.1, §22 Phase 2 tasks 3–4.)
- **M13** — Punch-event decoding: boundaries, hand, sequence, timestamp. Deterministic `TrackerPunchEvent` (§12.5) for controlled L/R punches; sequence wraparound vs reset; PunchEventRepository. (§12.5, §22 Phase 2 tasks 5–7.)
- **M14** — Velocity & punch-type field analysis, capability detection. Slow/normal/fast set analysis for velocity candidates, punch-type field analysis, `tracker_capabilities` populated with confidence and evidence, "tracker units" labeling shown consistently. (§4.2, §4.3, §22 Phase 2 tasks 8–9, 13.)
- **M15** — Session start/stop, offline sync, dedup & gap handling. Observed session-command implementations, offline-sync path with `recovered` flag and last-synced sequence, sequence-based dedup with heuristic fallback that never deletes raw frames. (§12.6, §22 Phase 2 tasks 10–11.)
- **M16** — Replay harness & fixture test suite. ReplayRunner runs on Windows without BLE hardware; every confirmed capture becomes a fixture with expected messages; malformed/truncated/unknown-field fixtures included; CI green. (§12.7, §21.2, §22 Phase 2 task 12.)

## Phase 3 — Velocity Lab calibration

- **M17** — Calibration session & guided punch sets. State machine and guided flow (10 s idle → 10 low → 10 normal → 10 fast per hand), sample accept/reject, distribution + L/R comparison views. (§10.1 Layer 3, §22 Phase 3 tasks 1–3.)
- **M18** — Versioned calibration profiles & stale detection. CalibrationProfile model + repository, robust percentile computation, zone thresholds, activation/revert, staleness rules (§10.4), raw values untouched. (§10.2, §10.3, §22 Phase 3 tasks 4–7.)
- **M19** — Live validation round & calibration report. 30-s validation with active profile; calibration report export. (§22 Phase 3 tasks 8–9.)

## Phase 4 — punchCraft sessions

- **M20** — Session/timer engine. §18.1 state machine with monotonic clock, pause semantics (`duringPause` flag), timer/acceptance/pause/clock-change tests. (§18, §22 Phase 4 tasks 1–2, 7.)
- **M21** — Readiness gate & live metric tiles. Pre-session readiness (§8.2) with explicit degraded warnings; large glanceable tiles (§8.3) and pop-out tile customization. (§8.2, §8.3, §22 Phase 4 tasks 3–4, 12.)
- **M22** — Session persistence & deterministic metrics. `sessions`, `rounds`, `punch_events`, `session_metrics`; MetricsEngine confirmed + velocity-dependent metrics (§9.1, §9.2) with `calculation_version`; in-session reconnect updates completeness and `recovered` counts. (§9, §17, §22 Phase 4 tasks 8–9.)
- **M23** — Summary, history, recalculation & export. Session summary discloses velocity representation (§8.5), history with filter/detail/compare/delete, recalculation using newer decoder/profile without touching raw, CSV + JSON export. (§8.5, §8.6, §22 Phase 4 tasks 10–11.)

## Phase 5 — Puncheokie program engine without Spotify

- **M24** — Program model & editor. PunchProgram/Round/Cue tables + repositories; program editor; seeded "Three-Round Fundamentals" example. (§13.4, §17.1, §22 Phase 5 tasks 1–2.)
- **M25** — Stance mapping & cue runner. StanceMapper for orthodox/southpaw × switch with tests; ProgramEngine cue timer with visual + haptic presentation and next-cue preview. (§13.2, §13.5, §22 Phase 5 tasks 3–4.)
- **M26** — Cue matching & capability-aware scoring. CueMatcher (windows, one-event-one-slot, hand vs type mismatch, extras) with tests; `cue_results`; summary explicitly labeled "hand-sequence match" when technique is unknown. (§13.3, §13.6, §22 Phase 5 tasks 5–9.)

## Phase 6 — Spotify playlist connection

- **M27** — Spotify PKCE authorization & secure tokens. Dev app registered, redirect URI + Android package configured, SpotifyAuthService PKCE via expo-auth-session, SpotifyTokenStore in SecureStore, minimum scopes, allowlist / Dev-Mode-aware error handling for 401 / 403 / 429. (§14.2, §14.3, §14.8, §22 Phase 6 tasks 1–6.)
- **M28** — Playlist selection, caching & deep link. Paginated fetch tolerating unavailable playlist items, playlist picker + local metadata cache, Android content deep link into the Spotify app, disconnect / erase, log redaction. (§14.4, §14.7, §22 Phase 6 tasks 7–11.)

## Phase 7 — Hardening and release preparation

- **M29** — Endurance, reliability & storage retention. 1-hour endurance runs, retention controls with pin-capture + storage-usage display, crash-reporting decision, log field classification (safe / device-sensitive / secret), anonymized export. (§17.2, §19, §20.4, §22 Phase 7 tasks 1–4.)
- **M30** — Release readiness. Release signing + backup APK, dependency lock + SBOM, accessibility + landscape pass, in-app safety/privacy disclosures, protocol-compatibility report, user documentation, Spotify policy/legal decision, MVP release gate met (§21.6). (§19.4, §19.5, §20, §21.6, §22 Phase 7 tasks 5–11.)

## Phase-to-milestone summary

| Phase | Milestones | Sprint 1? |
|---|---|---|
| 0 | M01, M02 | yes |
| 1 | M03–M10 | yes |
| 2 | M11–M16 | no (Sprint 2+) |
| 3 | M17–M19 | no |
| 4 | M20–M23 | no |
| 5 | M24–M26 | no |
| 6 | M27–M28 | no |
| 7 | M29–M30 | no |
