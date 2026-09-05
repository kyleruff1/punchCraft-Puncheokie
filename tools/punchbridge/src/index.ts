/**
 * PunchBridge entry point. Opens a MIDI backend, starts a WebSocket server,
 * and gives each connection a BridgeSession. One tablet at a time is the
 * expected shape, but extra sockets are accepted and get their own session
 * (each with its own latch), so a stale connection cannot wedge a new one.
 *
 * Run: npm run bridge -- [--port 8787] [--midi "loopMIDI"] [--watchdog 4000]
 * Port choice prefers, in order: an explicit --midi substring, then common
 * loopback names, then Studio One, then the Windows GS synth (always
 * audible), then the first port.
 */
import { WebSocketServer, type WebSocket } from 'ws'

import { openBestBackend } from './midiBackend'
import { BridgeSession } from './server'

interface Args {
  port: number
  midiPreferred: string[]
  watchdogMs: number
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    port: 8787,
    midiPreferred: [],
    watchdogMs: 4000,
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
    } else if (flag === '--watchdog' && value) {
      args.watchdogMs = Number.parseInt(value, 10)
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

  const clock = { now: () => performance.now() }
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
      { midi, clock, watchdogMs: args.watchdogMs, log: (m) => console.log(m) },
    )
    const watchdog = setInterval(() => session.checkWatchdog(), 1000)
    socket.on('message', (data) => session.onText(data.toString()))
    socket.on('close', () => {
      clearInterval(watchdog)
      session.onClose()
      console.log(`punchbridge: tablet ${who} disconnected`)
    })
    socket.on('error', (err) => console.log(`punchbridge: socket error — ${String(err)}`))
  })

  const shutdown = (): void => {
    console.log('punchbridge: shutting down — all notes off')
    midi.close()
    wss.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
