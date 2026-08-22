# Hardware baseline

Fill-in for the development tablet and the two FightCamp v1 punch trackers. Task 1 of §22 Phase 0 in `docs/design-spec.md`; unblocks milestone M01. Related sections: §4.1 (device inventory), §12.1 (tracker identity), §22 Phase 0 (baseline preservation), §29 R1/R2 (reproducible capture requirements). Open M01 issues on the tracker cover anything still outstanding.

## Tablet identity

- Manufacturer: **LENOVO**
- Model number: **Lenovo TB125FU** (Lenovo Tab M11 5G / Lenovo Tab P11 5G — 11.5" MediaTek variant, `TB125FU`)
- Marketing name: (not exposed via getprop)
- Android release: **13**
- API level: **33**
- Security patch: **2025-03-05**
- Build fingerprint: `Lenovo/TB125FU/TB125FU:13/TP1A.220624.014/S101018_250416_ROW:user/release-keys`
- CPU ABI: **arm64-v8a** (fallbacks: armeabi-v7a, armeabi)
- Board / SoC: `mt6768` board / `P98980AA1` HW / **MediaTek MT8786V** (Helio G88)
- Serial: not read (adb `getprop ro.serialno` returns `unknown` on this build; use the wireless-debugging device guid instead: `adb-HA1TLKJT-ESkgCw`)

## Bluetooth hardware

- Bluetooth chipset (if known): MediaTek integrated (part of MT8786V)
- Bluetooth stack version: TODO (`adb shell dumpsys bluetooth_manager | head`)
- Adapter MAC address: **`D8:63:0D:60:76:90`** (from `settings get secure bluetooth_address`)
- Supported LE features: TODO — collect from `dumpsys bluetooth_manager` after first paired connection

## Trackers

_(Fill in after physically inspecting the trackers.)_

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

Store originals under `docs/hardware-baseline/` (git-ignored — keep on the workstation) and link them here.

- Tablet front + settings screen: TODO
- Blue tracker (top, bottom, label): TODO
- Red tracker (top, bottom, label): TODO
- Charging cradle / charger: TODO

## Wireless ADB pairing

First successful pairing on 2026-08-22 via the tablet's own Wireless-debugging UI (Developer options → Wireless debugging → Pair device with pairing code). The pairing address is a Tailscale-provided (100.67.x.x) route to the tablet; a plain-LAN route (192.168.86.59) is what mDNS auto-discovery uses after pairing.

```
$ adb pair 100.67.110.15:37979 <6-digit code>
Successfully paired to 100.67.110.15:37979 [guid=adb-HA1TLKJT-ESkgCw]

$ adb mdns services
adb-HA1TLKJT-ESkgCw   _adb-tls-connect._tcp   192.168.86.59:33741

$ adb devices -l
adb-HA1TLKJT-ESkgCw._adb-tls-connect._tcp   device   product:TB125FU   model:Lenovo_TB125FU   device:TB125FU
```

Notes:
- Pair port is ephemeral and dies when the "Pair device with pairing code" dialog closes.
- Connect port (`33741` above) is stable across a Wireless-debugging session but changes on `Wireless debugging Off → On`.
- mDNS auto-connect works from Windows/adb 37.0.1 once the tablet has been paired at least once from that workstation.

## Official-app health

_(Capture BEFORE writing any BLE code that talks to the trackers, per §12.1.)_

- Official FightCamp app still works on this tablet? TODO (yes / no / partial)
- App version code: TODO
- App version name: TODO
- Last successful pair (date, tracker, notes): TODO
- Any observed regressions: TODO
