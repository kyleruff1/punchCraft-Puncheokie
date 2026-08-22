# Hardware baseline

Fill-in template for the development tablet and the two FightCamp v1 punch
trackers. Completing this file is Task 1 of §22 Phase 0 in `docs/design-spec.md`
and unblocks milestone M01. Related sections: §4.1 (device inventory), §12.1
(tracker identity), §22 Phase 0 (baseline preservation), §29 R1/R2 (reproducible
capture requirements). See also the open M01 issues in the tracker for anything
still outstanding.

Everything below is a TODO until a human with the physical hardware fills it in.
Keep the units and labels; do not invent values.

## Tablet identity

- Manufacturer: TODO
- Model number: TODO
- Marketing name: TODO
- Android release: TODO (e.g. Android 13)
- API level: TODO (e.g. 33)
- Build fingerprint: TODO (`adb shell getprop ro.build.fingerprint`)
- Serial: TODO (`adb shell getprop ro.serialno`)

## Bluetooth hardware

- Bluetooth chipset (if known): TODO
- Bluetooth stack version: TODO (`adb shell dumpsys bluetooth_manager | head`)
- Adapter MAC address: TODO
- Supported LE features: TODO (extended advertising, 2M PHY, etc.)

## Trackers

Blue tracker (left hand):

- Battery %: TODO
- Firmware version (if readable): TODO
- Serial / FCC markings on case: TODO
- Advertised BLE name / MAC: TODO
- Notes: TODO

Red tracker (right hand):

- Battery %: TODO
- Firmware version (if readable): TODO
- Serial / FCC markings on case: TODO
- Advertised BLE name / MAC: TODO
- Notes: TODO

## Photos

Store originals under `docs/hardware-baseline/` and link them here.

- Tablet front + settings screen: `docs/hardware-baseline/TODO-tablet.jpg`
- Blue tracker (top, bottom, label): `docs/hardware-baseline/TODO-blue-*.jpg`
- Red tracker (top, bottom, label): `docs/hardware-baseline/TODO-red-*.jpg`
- Charging cradle / charger: `docs/hardware-baseline/TODO-charger.jpg`

## Wireless ADB pairing

Paste the raw command output so future sessions can reproduce the pairing.

```
$ adb pair <host>:<port>
TODO paste output

$ adb connect <host>:<port>
TODO paste output

$ adb devices
TODO paste output
```

- Pairing PIN source: TODO (Developer options -> Wireless debugging)
- Persistent host/port after reboot: TODO

## Official-app health

- Official FightCamp app still works on this tablet? TODO (yes / no / partial)
- App version code: TODO
- App version name: TODO
- Last successful pair (date, tracker, notes): TODO
- Any observed regressions: TODO
