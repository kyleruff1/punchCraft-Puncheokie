/**
 * PunchBridge entry point. Opens a MIDI backend, starts a WebSocket server,
 * and gives each connection a BridgeSession. One tablet at a time is the
 * expected shape, but extra sockets are accepted and get their own session
 * (each with its own latch), so a stale connection cannot wedge a new one.
 *
 * Run: npm run bridge -- [--port 8787] [--midi "loopMIDI"] [--midi-in "PunchCraft Ctl"]
 *                        [--watchdog 4000] [--profile studio-one-stock]
 * Output port choice prefers, in order: an explicit --midi substring, then
 * common loopback names, then Studio One, then the Windows GS synth (always
 * audible), then the first port.
 * Input (DAW → bridge) is opt-in: --midi-in names a port substring and there
 * is no fallback. It must be a DIFFERENT loopMIDI port from the output one —
 * loopMIDI ports are loopbacks, and the bridge refuses to listen to its own
 * output. See README.md.
 */
import { WebSocketServer, type WebSocket } from 'ws'

import { openBestBackend } from './midiBackend'
import { LoopbackRefusedError, openInputBackend } from './midiInput'
import { MidiInMonitor } from './midiInMonitor'
import { BridgeSession } from './server'

interface Args {
  port: number
  midiPreferred: string[]
  midiInPreferred: string[]
  watchdogMs: number
  profile: string | null
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    port: 8787,
    midiPreferred: [],
    midiInPreferred: [],
    watchdogMs: 4000,
    profile: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--port' && value) {
      args.port = Number.parseInt(value, 10)
      i += 1
    } else if (flag === '--midi' && value) {
      args.midiPreferred = [value]
      i += 1
    } else if (flag === '--midi-in' && value) {
      args.midiInPreferred = [value]
      i += 1
    } else if (flag === '--watchdog' && value) {
      args.watchdogMs = Number.parseInt(value, 10)
      i += 1
    } else if (flag === '--profile' && value) {
      args.profile = value
      i += 1
    }
  }
  return args
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  // Preference order: caller's --midi, then loopback/Studio One names, then
  // the always-present Windows synth so a note is audible with no install.
  const preferred = [
    ...args.midiPreferred,
    'loopmidi',
    'punchbridge',
    'studio one',
    'wavetable',
  ]
  const midi = openBestBackend(preferred)
  if (!midi.isReal) {
    console.log('punchbridge: WARNING — no MIDI port; notes will only be logged')
  } else if (/wavetable/i.test(midi.portName)) {
    console.log(
      'punchbridge: sounding through the Windows GS synth. Install loopMIDI (or Windows',
    )
    console.log('  MIDI Services) and pass --midi "<port>" to route into Studio One.')
  }

  // Profile: explicit flag wins; otherwise the GM fallback when we ended
  // up on the Windows synth, else the Studio One conventions.
  const profile = args.profile ?? (/wavetable/i.test(midi.portName) ? 'gs-fallback' : 'studio-one-stock')
  console.log(`punchbridge: instrument profile "${profile}"`)

  const clock = { now: () => performance.now() }

  // DAW → bridge (opt-in). Listening only for now: the monitor logs what
  // arrives and exposes `subscribe` as the seam a consumer attaches to
  // later (host-clock authority, #351). Nothing in the session or the
  // harmonic engine reads it yet. The one hard failure is asking to
  // listen to our own output port — a loopMIDI loopback — which is a
  // port-layout mistake to fix, not something to run half-wired.
  let midiInMonitor: MidiInMonitor
  try {
    const midiIn = openInputBackend(args.midiInPreferred, { excludePortName: midi.portName })
    midiInMonitor = new MidiInMonitor(midiIn, clock)
  } catch (err) {
    if (err instanceof LoopbackRefusedError) {
      console.log(`punchbridge: ${err.message}`)
      midi.close()
      process.exit(2)
    }
    throw err
  }

  const wss = new WebSocketServer({ port: args.port })
  console.log(`punchbridge: listening on ws://0.0.0.0:${args.port}`)

  wss.on('connection', (socket: WebSocket, req) => {
    const who = req.socket.remoteAddress ?? 'unknown'
    console.log(`punchbridge: tablet connected from ${who}`)
    const session = new BridgeSession(
      {
        send: (data) => socket.send(data),
        close: () => socket.close(),
      },
      { midi, clock, watchdogMs: args.watchdogMs, profile, log: (m) => console.log(m) },
    )
    const watchdog = setInterval(() => session.checkWatchdog(), 1000)
    // Basic latency telemetry (M40-17 am. 14): a periodic summary while
    // the commit grid is live; per-message spans already ride the acks.
    let lastCommitCount = 0
    const telemetryLog = setInterval(() => {
      const t = session.telemetry()
      if (t && t.commits !== lastCommitCount) {
        lastCommitCount = t.commits
        console.log(
          `punchbridge: telemetry — commits ${t.commits}, commit lag ${String(t.lastCommitLagTicks)} ticks, skipped steps ${t.skippedArpSteps}, max lateness ${t.maxLatenessMs.toFixed(1)} ms`,
        )
      }
    }, 30000)
    socket.on('message', (data) => session.onText(data.toString()))
    socket.on('close', () => {
      clearInterval(watchdog)
      clearInterval(telemetryLog)
      session.onClose()
      console.log(`punchbridge: tablet ${who} disconnected`)
    })
    socket.on('error', (err) => console.log(`punchbridge: socket error — ${String(err)}`))
  })

  const shutdown = (): void => {
    console.log('punchbridge: shutting down — all notes off')
    midiInMonitor.close()
    midi.close()
    wss.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
