/**
 * Standalone audible check — opens the MIDI backend and plays two notes
 * (left D3, right D5) with releases, no WebSocket involved. Proves the MIDI
 * path end-to-end before the tablet is in the loop.
 *
 * Run: npm run test-note   (add --midi "<port>" to target a specific port)
 */
import { openBestBackend } from './midiBackend'
import { VoiceRenderer } from './gestureToMidi'

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const midiArg = arg('--midi')
  const midi = openBestBackend([...(midiArg ? [midiArg] : []), 'loopmidi', 'wavetable'])
  const renderer = new VoiceRenderer(midi)

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  console.log('punchbridge: left note (D3)…')
  renderer.testNote('left')
  await wait(700)
  console.log('punchbridge: right note (D5)…')
  renderer.testNote('right')
  await wait(700)
  console.log('punchbridge: retrigger left…')
  renderer.testNote('left')
  await wait(700)
  console.log('punchbridge: panic (all notes off)')
  renderer.panic()
  await wait(200)
  midi.close()
  console.log(`punchbridge: done via "${midi.portName}"`)
}

void main()
