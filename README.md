# PunchLab · Puncheokie

Android-first mobile app that restores useful life to a pair of unsupported **FightCamp first-generation Bluetooth punch trackers**. It connects to the left- and right-hand trackers over Bluetooth Low Energy, preserves every raw frame, decodes punch events, calculates session metrics, and powers three training workflows.

> **Status (2026-08-22):** planning complete; Sprint 1 starts 2026-08-24. There is no app code yet — the Expo scaffold is Sprint 1 Story 1. See [docs/sprint-1.md](docs/sprint-1.md).

## The three modes

| Mode | What it is |
|---|---|
| **Velocity Lab** | Device connection, protocol diagnostics, live Bluetooth listening, calibration, and data export. The engineering surface and the first milestone. |
| **PunchLab** | Configurable timed or free-form bag sessions with left/right punch counts, tracker-reported velocity, round metrics, and session history. |
| **Puncheokie** | Programmable punch-sequence workouts using numbered boxing combinations, regular or switch stance, and an optional user-connected Spotify playlist for background listening. |

## Principles

- Instrument first, training interface second: the BLE data path is observable, replayable, and calibratable.
- Raw frames are persisted **before** any protocol parsing; a parse failure never discards a payload.
- Velocity is labeled **tracker-reported velocity** until validated against an external reference — never "impact speed", "force", "power", or "energy".
- Local-first: SQLite on the tablet, Spotify tokens in encrypted device storage, no backend.
- Protocol adapter + capability model: nothing outside `src/protocol/` may depend on unverified packet assumptions.
- Never write to an unknown GATT characteristic. Observe before writing; reproduce only what the official app was seen to do.

## Roadmap and tracking

- **Project board:** https://github.com/users/kyleruff1/projects/5
- **Milestones (the 30-step roadmap):** https://github.com/kyleruff1/PunchLab-Puncheokie/milestones
- **Epics (one per phase, 8):** issues labeled `epic`; every task is a sub-issue of its phase epic.
- Definitions of done for every milestone: [docs/roadmap.md](docs/roadmap.md).

Labels: type `epic` / `story` / `task` / `spike`; `phase:0`–`phase:7`; `area:*`; priority `P0`–`P2`; flow `sprint-1`, `hardware-required`, `go-no-go`, `policy-review`, `blocked`.

## Documents

- [Design specification](docs/design-spec.md) — the full product and engineering spec (sections 1–30).
- [Roadmap](docs/roadmap.md) — phases, milestones, definitions of done.
- [Sprint 1](docs/sprint-1.md) — goal, stories, exit criteria, hardware prerequisites.
- [Development setup](docs/dev-setup.md) — Windows workstation and Android tablet toolchain.
- [Protocol discovery](docs/protocol/README.md) — capture workflow, hypothesis log, evidence rules.

## Hardware

- Two FightCamp v1 (Hykso) trackers: **blue = left**, **red = right**.
- A physical Android tablet is the BLE central. The emulator is acceptable for screens and mocked sessions only.
- Windows 11 workstation for builds (`npx expo run:android`), ADB, and capture analysis (Wireshark).

## Backlog as code

`tools/backlog/backlog.json` is the source of truth for labels, milestones, epics, and issues. Both scripts are idempotent and use only the authenticated `gh` CLI:

```bash
node tools/backlog/setup-project.mjs
```

```bash
node tools/backlog/seed.mjs
```

`setup-project.mjs` creates/links the GitHub Project, its fields and views, and writes `tools/backlog/project.json`. `seed.mjs` creates labels → milestones → epics → issues → sub-issue links → project items and field values, skipping anything that already exists (matched by exact title). Add `--dry-run` to preview.

## Safety

Tracker metrics are training estimates. Velocity is not equivalent to force or injury risk. The app does not assess concussion or any medical condition. Stop training when injured, dizzy, or unwell.
