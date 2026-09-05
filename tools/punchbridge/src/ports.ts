/** List MIDI output ports visible to the bridge. Run: npm run ports */
import { JulusianMidiBackend } from './midiBackend'

const names = JulusianMidiBackend.portNames()
if (names.length === 0) {
  console.log('punchbridge: no MIDI output ports')
} else {
  console.log('punchbridge: MIDI output ports —')
  names.forEach((n, i) => console.log(`  [${i}] ${n}`))
}
