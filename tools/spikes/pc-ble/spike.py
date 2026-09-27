"""M45-08 spike harness: PC-direct FightCamp v1 glove central over bleak/WinRT.

Connects one or both gloves, pairs if needed, runs the full Hykso init
choreography, decodes punch records live, keeps the 20 s keepalive beat,
and prints a latency summary on exit.

Everything protocol-side is a port of the shipped TypeScript:
  - init plan     src/protocol/fightcamp-v1/FightCampV1Adapter.ts
  - record decode src/protocol/fightcamp-v1/FightCampV1Decoder.ts (v>=4, 9 B)
  - keepalive     src/protocol/trackerKeepalive.ts (mode-normal every 20 s)

Tablet lessons carried over:
  - Gloves are connected SEQUENTIALLY — a connect landing inside the other
    glove's security procedure fails (GATT 133 on Android; same hazard here).
  - find_device_by_address scans first, which teaches the stack the gloves'
    random-static address type before connecting.
  - An unbonded glove dies ~37 s after connect (SMP Security Request at ~4 s
    + 30 s timeout). The disconnect watcher diagnoses that signature loudly.

Run examples:
  python tools/spikes/pc-ble/spike.py --glove both --minutes 6
  python tools/spikes/pc-ble/spike.py --glove red --minutes 1   # first contact

Ctrl-C exits cleanly and still prints the summary.
"""

import argparse
import asyncio
import statistics
import sys
import time

from bleak import BleakClient, BleakScanner

SERVICE = "ca280069-5470-4e34-94dd-caf160200b29"
CHAR_DATA_STREAM = "ca281069-5470-4e34-94dd-caf160200b29"  # indicate
CHAR_DEVICE_INFO = "ca281070-5470-4e34-94dd-caf160200b29"  # read: pending-record count LE u16
CHAR_COMMAND1 = "ca281071-5470-4e34-94dd-caf160200b29"  # mode byte
CHAR_COMMAND2 = "ca281072-5470-4e34-94dd-caf160200b29"  # hand byte (1=right, 2=left)
CHAR_NOTIFY_STATUS = "ca281073-5470-4e34-94dd-caf160200b29"  # notify
CHAR_COMMAND_ACK = "ca281078-5470-4e34-94dd-caf160200b29"  # indicate
CHAR_CLOCK_SYNC = "ca281079-5470-4e34-94dd-caf160200b29"  # 5-byte epoch write
BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"

MODE_NORMAL = bytes([1])
MODE_COMMAND_17 = bytes([17])
KEEPALIVE_S = 20.0
BACKFILL_THRESHOLD_MS = 3_000
UNBONDED_DEATH_WINDOW_S = (30.0, 45.0)  # the ~37 s SMP-timeout signature

GLOVES = {
    "blue": {"mac": "D7:34:B4:27:D5:84", "hand": "left", "hand_byte": 2},
    "red": {"mac": "EA:69:2D:9C:FD:53", "hand": "right", "hand_byte": 1},
}


def clock_sync_bytes(now_ms: float) -> bytes:
    """Port of buildClockSyncBytes: LE u32 epoch seconds + subsecond byte."""
    seconds = int(now_ms // 1000)
    millis = now_ms - seconds * 1000
    sub = int(millis * 256 / 1000) & 0xFF
    return bytes([seconds & 0xFF, (seconds >> 8) & 0xFF, (seconds >> 16) & 0xFF, (seconds >> 24) & 0xFF, sub])


def decode_records(payload: bytes):
    """Port of decodeRecordV4Plus. Yields dicts, one per 9-byte record."""
    if len(payload) == 0 or len(payload) % 9 != 0:
        yield {"malformed": True, "hex": payload.hex()}
        return
    for i in range(0, len(payload), 9):
        b = payload[i : i + 9]
        epoch_seconds = b[3] + b[4] * 0x100 + b[5] * 0x10000 + b[6] * 0x1000000
        ts_ms = epoch_seconds * 1000 + (b[7] * 1000) // 256
        v_raw = b[8] / 2.0
        if v_raw <= 4:
            velocity = v_raw * 0.5
        elif v_raw <= 8:
            velocity = (v_raw - 4) * 3 + 2
        else:
            velocity = (v_raw - 8) * 6 + 14
        if b[0] in (1, 2):  # vendor arithmetic fidelity, not a semantic claim
            velocity *= 1.7
        yield {
            "malformed": False,
            "type_raw": b[0],
            "accel_raw": b[1] | (b[2] << 8),
            "ts_ms": ts_ms,
            "velocity_byte": b[8],
            "velocity": velocity,
        }


class GloveSession:
    def __init__(self, name: str):
        self.name = name
        self.cfg = GLOVES[name]
        self.client: BleakClient | None = None
        self.connected_at: float | None = None
        self.latencies_ms: list[float] = []
        self.punches = 0
        self.recovered = 0
        self.malformed = 0
        self.disconnects: list[str] = []

    def log(self, msg: str) -> None:
        print(f"[{time.strftime('%H:%M:%S')}] {self.name:4s} {msg}", flush=True)

    def on_disconnect(self, _client) -> None:
        held = time.monotonic() - self.connected_at if self.connected_at else 0.0
        note = f"DISCONNECTED after {held:.1f}s"
        lo, hi = UNBONDED_DEATH_WINDOW_S
        if lo <= held <= hi:
            note += "  << ~37s SMP-timeout signature: the glove is NOT BONDED to this PC"
        self.disconnects.append(note)
        self.log(note)

    def on_data(self, _char, payload: bytearray) -> None:
        arrival_ms = time.time() * 1000
        for rec in decode_records(bytes(payload)):
            if rec["malformed"]:
                self.malformed += 1
                self.log(f"MALFORMED frame: {rec['hex']}")
                continue
            latency = arrival_ms - rec["ts_ms"]
            recovered = latency > BACKFILL_THRESHOLD_MS
            if recovered:
                self.recovered += 1
            else:
                self.punches += 1
                self.latencies_ms.append(latency)
            self.log(
                f"punch #{self.punches:<3d} type={rec['type_raw']} accel={rec['accel_raw']:<4d} "
                f"velByte={rec['velocity_byte']:<3d} vel={rec['velocity']:5.1f} "
                f"latency={latency:7.1f}ms{'  [RECOVERED/backfill]' if recovered else ''}"
            )

    def on_status(self, _char, payload: bytearray) -> None:
        self.log(f"status(1073): {bytes(payload).hex()}")

    def on_ack(self, _char, payload: bytearray) -> None:
        self.log(f"ack(1078): {bytes(payload).hex()}")

    async def connect_and_init(self, do_pair: bool) -> None:
        self.log(f"scanning for {self.cfg['mac']} (tap the glove awake)…")
        device = await BleakScanner.find_device_by_address(self.cfg["mac"], timeout=25.0)
        if device is None:
            raise RuntimeError(
                f"{self.name}: not found in 25s. Tablet app closed? Glove tapped awake?"
            )
        self.log(f"found (rssi n/a at connect), connecting…")
        client = BleakClient(device, disconnected_callback=self.on_disconnect, timeout=30.0)
        await client.connect()
        self.client = client
        self.connected_at = time.monotonic()
        self.log("connected")

        if do_pair:
            try:
                paired = await client.pair()
                self.log(f"pair() -> {paired} (a Windows consent toast may need a click)")
            except Exception as err:  # already-paired lands here on some stacks
                self.log(f"pair() raised: {err!r} — continuing (may already be bonded)")

        # ---- init choreography, exact order of buildInitializationPlan ----
        await client.write_gatt_char(CHAR_CLOCK_SYNC, clock_sync_bytes(time.time() * 1000), response=True)
        self.log("init: clock-sync written (1079)")
        await client.start_notify(CHAR_DATA_STREAM, self.on_data)
        await client.start_notify(CHAR_NOTIFY_STATUS, self.on_status)
        await client.start_notify(CHAR_COMMAND_ACK, self.on_ack)
        self.log("init: subscribed 1069/1073/1078")
        info = await client.read_gatt_char(CHAR_DEVICE_INFO)
        pending = int.from_bytes(info[:2], "little") if len(info) >= 2 else None
        self.log(f"init: device-info(1070) = {bytes(info).hex()} (pending records: {pending})")
        await client.write_gatt_char(CHAR_COMMAND1, MODE_NORMAL, response=True)
        await client.write_gatt_char(CHAR_COMMAND2, bytes([self.cfg["hand_byte"]]), response=True)
        await client.write_gatt_char(CHAR_COMMAND1, MODE_COMMAND_17, response=True)
        self.log(f"init: mode-normal + hand={self.cfg['hand']} + command-17 written — THROW PUNCHES")

    async def keepalive_once(self) -> None:
        if not (self.client and self.client.is_connected):
            return
        try:
            await self.client.write_gatt_char(CHAR_COMMAND1, MODE_NORMAL, response=True)
            batt = await self.client.read_gatt_char(BATTERY_LEVEL)
            self.log(f"keepalive beat ok, battery {batt[0]}%")
        except Exception as err:
            self.log(f"keepalive failed: {err!r}")

    def summary(self) -> str:
        lines = [f"== {self.name} ({self.cfg['hand']}) =="]
        lines.append(f"  punches live={self.punches} recovered={self.recovered} malformed={self.malformed}")
        if self.latencies_ms:
            ordered = sorted(self.latencies_ms)
            p95 = ordered[max(0, int(len(ordered) * 0.95) - 1)]
            lines.append(
                f"  latency ms: median={statistics.median(ordered):.1f} p95={p95:.1f} "
                f"min={ordered[0]:.1f} max={ordered[-1]:.1f} (tracker quantisation 3.9 ms)"
            )
        held = (time.monotonic() - self.connected_at) if self.connected_at else 0
        alive = self.client.is_connected if self.client else False
        lines.append(f"  link: {'CONNECTED' if alive else 'down'}, session {held:.0f}s, disconnects: {len(self.disconnects)}")
        for d in self.disconnects:
            lines.append(f"    - {d}")
        return "\n".join(lines)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--glove", choices=["blue", "red", "both"], default="both")
    ap.add_argument("--minutes", type=float, default=6.0, help="hold duration incl. idle")
    ap.add_argument("--no-pair", action="store_true", help="skip the pair() attempt")
    args = ap.parse_args()

    names = ["blue", "red"] if args.glove == "both" else [args.glove]
    sessions = [GloveSession(n) for n in names]

    # SEQUENTIAL connect+init — never let one glove's connect land inside
    # the other's security procedure.
    for s in sessions:
        await s.connect_and_init(do_pair=not args.no_pair)

    deadline = time.monotonic() + args.minutes * 60
    try:
        while time.monotonic() < deadline:
            await asyncio.sleep(KEEPALIVE_S)
            for s in sessions:
                await s.keepalive_once()
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("\ninterrupted — summarising…")

    print("\n" + "=" * 60)
    for s in sessions:
        print(s.summary())
    print("=" * 60)

    for s in sessions:
        if s.client and s.client.is_connected:
            try:
                await s.client.disconnect()
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
