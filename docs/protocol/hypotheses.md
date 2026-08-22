# Protocol hypothesis log

One entry per claim about the FightCamp v1 protocol. Confidence is not a promise; it is the current state of evidence. Contradicting evidence → update the entry (do not delete), and downgrade confidence.

## Template

```
### H<nn> — <short claim>

- **Status:** proposed | supported | contested | refuted | superseded
- **Confidence:** low | medium | high
- **Claim:** one sentence.
- **Evidence:** capture IDs from `capture-index.md`, byte offsets, packet counts, official-app screen states.
- **Counter-evidence:** none / list.
- **Consequence if true:** what code depends on this.
- **Consequence if false:** what breaks; what fallback applies (fallback per §4.2 capability ladder).
- **Next test:** the smallest scenario that would move confidence.
- **Owner / date:** who last touched the entry, when.
```

## Entries

_(none yet — first entries are logged after the M01 official-app captures.)_

### H01 — FightCamp v1 tracker advertises truncated name "FightCam" + custom service UUID

- **Status:** supported
- **Confidence:** high
- **Claim:** Both v1 trackers advertise BLE local name `FightCam` (truncated to 8 chars) and a single primary service UUID `ca280069-5470-4e34-94dd-caf160200b29`. No manufacturer-specific data is advertised.
- **Evidence:** Velocity Lab spike report `spike-mt4s3oja-8yoa` on 2026-08-22 saw two matching devices at MAC `D7:34:B4:27:D5:84` (rssi -53) and `EA:69:2D:9C:FD:53` (rssi -55); both entries carry the same name + serviceUuids and no `manufacturerDataHex`. Reproduced across three separate scans.
- **Counter-evidence:** none.
- **Consequence if true:** Scan-side filter can use either the name match `^FightCam$` or the service UUID; either uniquely identifies a v1 tracker. The custom service UUID is the primary target for `TrackerProtocolAdapter.scoreAdvertisement`.
- **Consequence if false:** Fall back to selection by the picker UI as we do today.
- **Next test:** Confirm the same across a wider set of scans and after tracker resets (advertising name occasionally changes after a firmware update / bond wipe). Record firmware revision when readable.
- **Owner / date:** Kyle + Claude, 2026-08-22.

### H02 — Blue tracker sleeps after ~10 s of no motion; red does not (as observed today)

- **Status:** proposed
- **Confidence:** low
- **Claim:** The blue tracker enters a low-power / advertising-only state after approximately 10 seconds without motion, requiring a physical tap to resume emitting notification frames over an established BLE connection. The red tracker stayed engaged through the same observation window without needing a tap.
- **Evidence:** Kyle observed on 2026-08-22 during Velocity Lab spike runs: "left keeps falling asleep, I have to tap it after 10 seconds; red seems engaged and turned on."
- **Counter-evidence:** Single session, only two trackers, no controlled variable isolation. Difference could be battery state, firmware revision, or bond state rather than an inherent left/right asymmetry.
- **Consequence if true:** PunchLab / Puncheokie live sessions must tolerate quiet-then-noisy notification streams. Latency to first frame after a punch may include a wake-up delay. UI should surface "Tracker awake — punch to keep it awake" hint.
- **Consequence if false:** No behavior change; the "sleep" was actually a lost connection or a coincidence.
- **Next test:** Repeat with (a) both trackers at similar battery level, (b) both trackers on the same wrist strap sequentially, (c) longer observation windows. Note whether idle-sleep triggers a BLE disconnect or is purely a notification-silence.
- **Owner / date:** Kyle + Claude, 2026-08-22.
