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

### H03 — Tracker LED encodes connection state

- **Status:** proposed
- **Confidence:** low
- **Claim:** The physical LED on each v1 tracker indicates connection state. Observed on 2026-08-22:
  - Blue (case): steady non-blinking blue → likely **connected/paired** with a central (the tablet).
  - Red (case): slow blinking red → likely **advertising, no central connected**.
- **Evidence:** Kyle observed during a Velocity Lab session immediately after a connect to one tracker: "right now R is slow blinking red, L is not blinking it's regularly blue".
- **Counter-evidence:** LED color may just match the case color rather than signal state; slow-blink could equally mean low battery. Single-session observation.
- **Consequence if true:** Physical LED provides an out-of-band ground truth for connection state and can be used to validate the app's TrackerStore vs. reality.
- **Consequence if false:** Ignore the LED as a signal; use the BLE-visible state exclusively.
- **Next test:** Force a disconnect on the currently-connected tracker and observe its LED transition; connect the other tracker and see whether its LED transitions to steady.
- **Owner / date:** Kyle + Claude, 2026-08-22.

### H04 — Multiple redundant connect / subscribe attempts wedge the tablet's BLE stack

- **Status:** proposed
- **Confidence:** medium
- **Claim:** Successive spike runs and/or overlapping coordinator + spike connect attempts against the same v1 tracker cause the tablet's Bluetooth stack to reach a state where BOTH trackers become unresponsive to further connects — recovery requires toggling Bluetooth on the tablet AND power-cycling both trackers via the charging harness.
- **Evidence:** Kyle 2026-08-22: "they both dropped multiple times, i even had to turn bluetooth off on the tablet and put both back on the harness". Logcat around 13:55:29 shows a `GATT_CONN_TERMINATE_LOCAL_HOST` disconnect on `D7:34:B4:27:D5:84` followed by six simultaneous `att_id` teardowns (att_id:3..8), consistent with multiple live subscriptions being torn down at once.
- **Contributing factors identified in the spike screen:**
  - `runSpike()` did not tear down handles from a prior run before starting a new one → every Run→Reset→Run cycle piled additional CCCD writes on the same characteristics.
  - `facade.connect()` was issued unconditionally in the spike, even when the coordinator had already established a connection to the same tracker.
  - The subscribe stage attempts CCCD writes on **every** notify/indicate characteristic (6+ per tracker) with no throttling.
- **Consequence if true:** Any live-session or reconnection flow (M06 / M08 / M09) must serialize connects, deduplicate subscriptions per (device, service, characteristic), and avoid re-connecting to devices already `ready` / `streaming`.
- **Consequence if false:** The observed lockup was coincidental (low battery, radio interference, tablet BT firmware bug) and does not need application-side mitigation.
- **Mitigations applied 2026-08-22:**
  - `runSpike()` unsubscribes prior handles and disconnects prior deviceId before starting.
  - Spike now short-circuits the connect stage when the coordinator's TrackerStore reports the device already in `ready` / `streaming`.
- **Next test:** After stability fixes, run Run→Reset→Run a few times without a tablet BT restart and confirm the tablet still sees the trackers advertising.
- **Owner / date:** Kyle + Claude, 2026-08-22.

### H05 — Full GATT map of FightCamp v1 tracker

- **Status:** confirmed
- **Confidence:** high
- **Claim:** The v1 tracker exposes six BLE services with 25 characteristics total. Non-standard services and their characteristic roles are inferred from properties; standard BT SIG services (Generic Access, Generic Attribute, Device Information, Battery) contribute the rest.
- **Evidence:** Velocity Lab spike report `spike-mt4wm1d8-fx6x` on 2026-08-22 against `EA:69:2D:9C:FD:53`; `discover.ok = true`, `discover.services` enumerates the tree below verbatim. Reproducible from the reuse-coordinator shortcut.
- **Service inventory:**
  - `00001800` Generic Access — device name, appearance, preferred conn params.
  - `00001801` Generic Attribute — service-changed (indicate).
  - `00001530-1212-efde-1523-785feabcd123` Nordic Legacy DFU — see H06.
  - `0000180a` Device Information — six standard chars (manufacturer, model, serial, hardware/firmware/software rev, system ID). Reading these gives us firmware version for H02 correlation.
  - `0000180f` Battery — Battery Level (0x2A19), read + notify. Emits current battery percentage as a single byte on change. Live frames observed at 0x61 (97%) and 0x60 (96%).
  - `ca280069-5470-4e34-94dd-caf160200b29` FightCamp custom service — 11 characteristics. See H07.
- **Consequence if true:** ProtocolRegistry.scoreAdvertisement can score high on the custom service UUID. The Device Information service gives us free access to firmware/hardware revisions for §17.1 tracker_devices columns. The command / stream pattern in H07 gives Phase 2 an initialization-plan target for §12.3 buildInitializationPlan.
- **Next test:** Read all six Device Information characteristics and populate the hardware baseline. Read the config characteristics 0x1071-0x1076 to snapshot the tracker default configuration before we send any writes.
- **Owner / date:** Kyle + Claude, 2026-08-22.

### H06 — Nordic Legacy DFU exposed in normal operation

- **Status:** confirmed (presence); proposed (usable-for-flash)
- **Confidence:** high (presence); medium (usability)
- **Claim:** The tracker advertises the Nordic Legacy DFU service (`00001530-1212-efde-1523-785feabcd123`, well-known UUID) in its normal application firmware, with the standard characteristic layout — 0x1531 (control point, write + notify), 0x1532 (packet, write-without-response), 0x1534 (DFU version, read).
- **Evidence:** H05 GATT inventory shows the service on characteristic path exactly matching the Nordic Legacy DFU spec.
- **Why this matters for issue #162:** Legacy DFU (pre-2017 Nordic SDK) does NOT require signed firmware images — this is the older bootloader protocol that was superseded by Secure DFU precisely because it accepts unsigned uploads. If the tracker is running Legacy DFU (not a hybrid with signed constraints), custom firmware over BLE is feasible WITHOUT possessing a vendor signing key. Would still require reverse-engineering / writing the firmware itself, but the transport is unlocked.
- **Counter-evidence:** The service might be a decoy or the bootloader might refuse unsigned images despite being on the Legacy DFU service UUID (some vendors patch this). The tracker may also refuse to enter DFU mode without a magic "reset into bootloader" write on the custom service (0x1079 write channel per H07 is the obvious candidate).
- **Consequence if true:** Firmware research spike (#162) upgrades from P2 defer to a real Phase 2/3-parallel option. Custom firmware written against nRF5 SDK could theoretically be flashed via the standard `nrfutil dfu ble` tool if we can pair the tablet as a central and drive the DFU sequence.
- **Consequence if false:** No change to the primary path; the vendor firmware is still fully usable via H07 command channel.
- **Next test:** Read 0x1534 (DFU version) to determine whether it is Legacy DFU v1 (0x0100) or later. Attempt `nrfutil dfu` against the tracker from the Windows workstation as a non-destructive dry run. Do NOT initiate an actual firmware transfer without a validated build to flash.
- **Owner / date:** Kyle + Claude, 2026-08-22.

### H07 — FightCamp custom service is a write-command / notify-stream pattern

- **Status:** proposed
- **Confidence:** medium (structural), low (channel-specific roles)
- **Claim:** The custom service `ca280069-…-caf160200b29` follows the standard Nordic UART-style command / stream pattern: a write-only characteristic accepts commands from the central; notify-only characteristics stream events (punch data + status) back. Config characteristics are read/write. Punch frames likely require a "start" write before notifications flow on the punch channel.
- **Evidence:** H05 inventory, cross-referenced with the observation that subscribing to every notify/indicate characteristic yielded ONLY battery-level notifications from the standard Battery Service — no frames on any custom-service notify characteristic during a 20 s wait after subscribe. That matches a device requiring an initialization write.
- **Working assignments (candidate, not confirmed):**
  - `ca281079` (write-only) — command channel; write a "start punch session" byte here to enable notifications on 0x1077.
  - `ca281077` (notify-only) — primary punch data stream — candidate #1 (only notify-only char in the service).
  - `ca281073` (read + notify) — status / connection heartbeat or aggregated counters.
  - `ca281069` (indicate-only) — device state changes (sleeping / awake / low battery, etc.).
  - `ca281078` (indicate-only) — command acknowledgements.
  - `ca281070` (read-only) — fixed device info blob (protocol version? tracker serial?).
  - `ca281071 / 1072 / 1074 / 1075 / 1076` (read/write) — configurable device settings (sample rate, sensitivity threshold, hand assignment, LED behavior, sleep timer?).
- **Consequence if true:** Phase 2 `FightCampV1Adapter.buildInitializationPlan` sends a write to `ca281079` in initialize(), then relies on notifications from `ca281077` for the punch stream. Config chars can be read on first connect to snapshot defaults; any writes there stay guarded behind developer mode until we understand each field.
- **Consequence if false:** We may need to reverse-engineer the command bytes from official-app HCI captures (M01-04). Alternative: probe reads on 0x1070 / 0x1073 during the awaiting-frame window to see if the tracker auto-emits without a command.
- **Next test:**
  1. Punch harder / more times during a spike run to verify that no custom-service notifications fire without an init write. Rules out "auto-emit on wake".
  2. Read 0x1070, 0x1071, 0x1073, 0x1074 in a diagnostic pass and log the raw bytes.
  3. Once M01-04 official-app HCI captures land, correlate the first writes the vendor app sends to 0x1079 with what appears on 0x1077 in response.
- **Owner / date:** Kyle + Claude, 2026-08-22.

### H08 — Lenovo TB125FU (Tab M10 Plus 3rd Gen) blocks HCI snoop logging

- **Status:** confirmed
- **Confidence:** high
- **Claim:** On this Lenovo build (Android 13 / API 33 / MediaTek), the Bluetooth HCI snoop-log toggle in Developer options does not persist to `persist.bluetooth.btsnoopenable` and Lenovo's BluetoothManagerService does not honor the AOSP-standard `settings put secure bluetooth_hci_log 1` fallback. Without root or a system-UID app, HCI snoop capture is not achievable on this tablet.
- **Evidence:** 2026-08-22. After confirming Developer options enabled (`development_settings_enabled = 1`) and cycling Bluetooth off/on, `getprop persist.bluetooth.btsnoopenable` returns empty; `dumpsys bluetooth_manager` shows `mSnoopLogSettingAtEnable = empty`; writing both `secure.bluetooth_hci_log = 1` and `global.bluetooth_hci_log = 1` via `settings put` succeeds but does not affect the persist prop; the `/data/misc/bluetooth/logs/` directory is not readable without root.
- **Consequence:** HCI snoop capture for §12.2 controlled scenarios must either (a) use a different Android tablet whose Dev options toggle works, (b) use a rooted device, or (c) skip HCI capture entirely and reverse-engineer via active probing (writing byte sequences to the tracker's command channel and observing notification responses on our own BLE stack).
- **Owner / date:** Kyle + Claude, 2026-08-22.

### H09 — FightCamp v1 = Hykso hardware; Hykso app works; hardware is TI-SensorTag-class

- **Status:** supported (multi-source community reports)
- **Confidence:** high
- **Claim:** The FightCamp v1 trackers are structurally identical to the (pre-rebrand) Hykso punch trackers — FightCamp and Hykso were the same company. The physical hardware is a small BLE peripheral in the TI SensorTag lineage: MCU + BLE radio + 3-axis accelerometer + gyroscope. The free Hykso Android app natively pairs the FightCamp v1 trackers and streams live punch metrics ("Freestyle Mode") without any subscription.
- **Evidence:** User-reported 2026-08-22 sourced from r/androiddev discussions + FightCamp Facebook community + Reddit "V1 tracker" threads. Cross-references our own H01 finding that the custom service UUID `ca280069-…-caf160200b29` starts with the "ca28" prefix (Hykso-style vendor ID), and H05 that the tracker exposes standard Nordic Legacy DFU (Hykso used nRF-family SoCs).
- **Consequence — big:**
  1. The **Hykso app's Android APK is a working reference implementation** of the punch-tracker protocol. We can decompile it (`jadx`) and read the exact init sequence written to `ca281079`, the packet format on `ca281077`, and any config bytes on the read/write chars 0x1071–0x1076. Replaces trial-and-error probing with source-of-truth extraction.
  2. If the tracker really is a **TI-SensorTag-class device**, the underlying data model is very likely raw IMU (accel + gyro) samples plus event flags — either the tracker streams IMU + we compute punch metrics on-device (spec §9.4-style algorithm), or the tracker's firmware detects punch events and emits them as pre-processed frames. The Hykso app decoder will confirm which.
  3. **A "Freestyle Mode" client already exists** and can be recommended as a fallback for users if our own app slips. Not our shipping product but reassuring re Sprint 1 go/no-go on M10.
- **Counter-evidence:** Community reports may over-generalize — different hardware SKUs may exist in the FightCamp lifecycle. Verify by pairing a tracker with the Hykso app and confirming full functionality.
- **Next tests:**
  1. Install Hykso Android app on the tablet; pair one of the FightCam trackers; confirm live punch count + velocity data.
  2. `adb pull /data/app/.../com.hykso/base.apk` and decompile with jadx-gui. Grep the Java for `ca281079` / `ca281077` / `caf160200b29` to find the protocol constants.
  3. Compare the decompiled init sequence with what our probe UI reveals via active byte-write experimentation — if we can reproduce their init and then decode their notification format, Phase 2's FightCampV1Adapter is essentially half-written from the decompilation.
- **Owner / date:** Kyle + Claude, 2026-08-22.
