# FightCamp v1 protocol discovery

The tracker protocol is proprietary. Everything in this folder exists to make discovery evidence-based, replayable, and safe. Read §12 of the design spec before touching anything here.

## Rules (§12.1)

- **Observe before writing.** Never send a write to a characteristic whose meaning has not been observed in official-app traffic. Guarded writes live behind developer mode and a known command template.
- **Preserve the official-app baseline** while the vendor app still connects — every HCI snoop capture from it becomes leverage later.
- **Never guess packet meaning from a single sample.** Repeat every scenario ≥ 3 times.
- **Change one physical variable at a time** (which tracker, which hand, which punch type, how many, how fast, how long between).
- **Raw captures are immutable.** The app writes them under `captures/` on the tablet and exports them as JSON; committed fixtures under `src/protocol/**/fixtures/` are also frozen — new fixtures get new files.
- **Record every hypothesis with confidence and evidence.** Update `hypotheses.md` in this folder for every non-trivial claim.
- **Do not make product UI depend on a decoded field until the decoder has repeatable tests** (§21.2).

## Workflow (§12.2)

For each controlled scenario:

1. Fully charge both trackers.
2. Confirm placement and left/right identity (blue = left, red = right).
3. On the tablet, enable Developer Options → Enable Bluetooth HCI snoop log, then reboot Bluetooth.
4. Screen-record the official app and a visible clock (or shout timestamps into the mic if you'd rather).
5. Run the scenario with clean, well-separated actions.
6. Pull the bugreport: `adb bugreport captures/bugreport-YYYY-MM-DD-<scenario>.zip` — the snoop log is inside.
7. Open the snoop log in Wireshark, filter to `btatt` (ATT/GATT), and export just the tracker's conversation.
8. Correlate GATT writes and notifications with the observed physical action.
9. Repeat the scenario ≥ 3 times.
10. Convert repeatable sequences into replay fixtures under `src/protocol/<adapter>/fixtures/` with the fixture template.

Controlled scenarios to run in this order (§12.2):

- connect only, no punches
- start and stop an empty session
- one left punch
- one right punch
- exactly five left punches with two-second gaps
- exactly five alternating punches
- slow / normal / fast punches of the same type
- disconnect → throw known punches → reconnect
- sleep and wake
- tracker A only vs tracker B only

Each scenario gets a row in `capture-index.md` and, once repeatable, a fixture file.

## Files

- [`hypotheses.md`](hypotheses.md) — running log of claims about the protocol with confidence and supporting captures.
- [`capture-index.md`](capture-index.md) — one row per official-app capture, tracker, and replay fixture; scenario, tracker(s), tester, notes.

## Adapter contract (§12.3)

Discovery findings converge on a single implementation:

```
src/protocol/
  TrackerProtocolAdapter.ts        interface: scoreAdvertisement, inspectGatt, buildInitializationPlan, decodeFrame, buildStart/StopSession, buildOfflineSync, buildSleepCommand
  ProtocolRegistry.ts              picks an adapter by scoring evidence
  fightcamp-v1/
    FightCampV1Adapter.ts
    FightCampV1Decoder.ts
    FightCampV1Commands.ts         only commands that were observed
    FightCampV1State.ts
    fixtures/                      committed replay fixtures
```

The ReplayRunner runs on Windows without a Bluetooth stack (§12.7) so every unrelated UI or dependency change re-verifies the decoder.
