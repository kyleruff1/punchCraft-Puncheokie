# punchbridge

The desktop half of the Puncheoke instrument: tablet punch gestures arrive
over WebSocket and leave as MIDI into Studio One. It also listens to MIDI
coming *from* the DAW (opt-in) so a Studio One track can send notes, CCs
and clock at the bridge.

```
npm run bridge -- [--port 8787] [--midi "PunchBridge"] [--midi-in "PunchCraft Ctl"]
                  [--watchdog 4000] [--profile studio-one-stock]
```

| Flag | Meaning | Default |
|---|---|---|
| `--port` | WebSocket port the tablet connects to | `8787` |
| `--midi` | Substring of the MIDI **output** port (bridge → DAW) | first of: loopMIDI · PunchBridge · Studio One · GS Wavetable · port 0 |
| `--midi-in` | Substring of the MIDI **input** port (DAW → bridge). Opt-in, no fallback. | none |
| `--watchdog` | ms of tablet silence before the session panics (all notes off) | `4000` |
| `--profile` | Instrument profile (`studio-one-stock` / `gs-fallback`) | by port name |

Other scripts: `npm run ports` (list both directions), `npm run test-note`
(two audible notes on the output port), `npm run bench` (45 s rehearsal),
`npm test`, `npm run typecheck`.

## Ports on Windows

A user-mode process cannot create a MIDI port on Windows (RtMidi's virtual
ports are macOS/Linux only), so the ports come from
[loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html). It keeps
its port list in the registry and recreates them at start:

```
HKCU\Software\Tobias Erichsen\loopMIDI\Ports
  PunchBridge     REG_DWORD 0      bridge → Studio One
  PunchCraft Ctl  REG_DWORD 0      Studio One → bridge
```

Add a port by adding a DWORD value there (or in the loopMIDI window) and
restarting loopMIDI. **Start loopMIDI before Studio One** — Studio One
enumerates MIDI devices at launch.

### The loopback rule

A loopMIDI port is a loopback: whatever is written to its output side
appears on its input side. That is exactly how the bridge feeds Studio One
(`PunchBridge` output ← bridge, `PunchBridge` input → Studio One), and it is
why the bridge **refuses to open its own output port for input** — it would
hear every note it sends. Each direction gets its own port. Passing the
output port to `--midi-in` exits with a message saying so (exit code 2).

## Studio One → bridge

1. Create the loopMIDI port (above), e.g. `PunchCraft Ctl`, then start Studio One.
2. `Options → External Devices → Add… → New Instrument`
   - Send To: `PunchCraft Ctl` · Receive From: none
   - Tick **Send MIDI Clock** and **Use MIDI Clock Start** if you want the bridge to see tempo and transport.
3. `Track → Add Instrument Track`, output = that external instrument.
   Notes and CC lanes on the track now leave the PC on `PunchCraft Ctl`.
4. Run the bridge with `--midi-in "PunchCraft Ctl"` and press play.

What you see in the bridge log:

```
punchbridge: MIDI input port opened ← "PunchCraft Ctl"
punchbridge: midi-in ← transport start
punchbridge: midi-in ← tempo 120.0 bpm
punchbridge: midi-in ← noteOn ch1 note 60 vel 100
punchbridge: midi-in ← cc ch1 #1 = 64
punchbridge: midi-in ← noteOff ch1 note 60
punchbridge: midi-in ← transport stop
```

Channel messages are capped at 40 log lines per second (a dense CC ramp
says how many it dropped). Clock ticks are never logged individually, only
the tempo they imply: the first reading lands one beat after play starts,
and a tempo change prints one line once the new tempo has held for a beat
(no trail of in-between readings, no chatter from clock jitter).

**Nothing consumes these events yet.** `MidiInMonitor.subscribe` is the
seam; following the DAW's clock is #351 (M45-06) and the bridge's clock
authority stays `punchbridge` until that lands.

### Self-test without Studio One

The loopback works for us too: send *to* the input port from another
process and the bridge receives it.

```
npm run bridge -- --midi PunchBridge --midi-in "PunchCraft Ctl"
# second shell
npm run test-note -- --midi "PunchCraft Ctl"
```

The bridge should log the test-note's note on / note off pairs on
channels 2 and 3.
