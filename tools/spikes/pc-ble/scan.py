"""M45-08 spike, step 1: can this PC's radio see the gloves at all?

Scans for FightCamp v1 trackers (name "FightCam" / service ca280069-...)
for --seconds (default 15) and prints every sighting with MAC + RSSI.

Physical prep, or the scan is guaranteed empty:
  1. punchCraft app on the tablet CLOSED (its keepalive holds both gloves;
     a held glove does not advertise).
  2. Tap each glove firmly to wake it (they sleep aggressively).

Run:  python tools/spikes/pc-ble/scan.py [--seconds 15]
"""

import argparse
import asyncio
import sys
import time

from bleak import BleakScanner

FIGHTCAMP_SERVICE = "ca280069-5470-4e34-94dd-caf160200b29"
KNOWN = {
    "D7:34:B4:27:D5:84": "blue / left",
    "EA:69:2D:9C:FD:53": "red / right",
}


async def main(seconds: float) -> int:
    sightings: dict[str, int] = {}
    t0 = time.monotonic()

    def on_adv(device, adv):
        name = adv.local_name or ""
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        is_glove = name.startswith("FightCam") or FIGHTCAMP_SERVICE in uuids
        if not is_glove:
            return
        addr = device.address.upper()
        sightings[addr] = sightings.get(addr, 0) + 1
        label = KNOWN.get(addr, "UNKNOWN UNIT")
        print(
            f"  +{time.monotonic() - t0:5.1f}s  {addr}  rssi {adv.rssi:>4}  "
            f"name={name!r}  [{label}]  (sighting #{sightings[addr]})"
        )

    print(f"scanning {seconds:.0f}s for FightCam advertisements…")
    scanner = BleakScanner(detection_callback=on_adv)
    await scanner.start()
    await asyncio.sleep(seconds)
    await scanner.stop()

    print()
    if not sightings:
        print("RESULT: no gloves seen. Check: tablet app closed? gloves tapped awake?")
        return 1
    for addr, label in KNOWN.items():
        n = sightings.get(addr, 0)
        print(f"RESULT: {label:12s} {addr}  {'SEEN x' + str(n) if n else 'NOT SEEN'}")
    extras = [a for a in sightings if a not in KNOWN]
    for a in extras:
        print(f"RESULT: unexpected FightCam unit {a} seen x{sightings[a]}")
    return 0 if all(a in sightings for a in KNOWN) else 2


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=15.0)
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args.seconds)))
