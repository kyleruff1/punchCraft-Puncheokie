/** List the MIDI ports visible to the bridge, both directions. Run: npm run ports */
import { JulusianMidiBackend } from './midiBackend'
import { JulusianMidiInputBackend } from './midiInput'

const outputs = JulusianMidiBackend.portNames()
if (outputs.length === 0) {
  console.log('punchbridge: no MIDI output ports')
} else {
  console.log('punchbridge: MIDI output ports (bridge → DAW, --midi) —')
  outputs.forEach((n, i) => console.log(`  [${i}] ${n}`))
}

const inputs = JulusianMidiInputBackend.inputPortNames()
if (inputs.length === 0) {
  console.log('punchbridge: no MIDI input ports')
} else {
  console.log('punchbridge: MIDI input ports (DAW → bridge, --midi-in) —')
  inputs.forEach((n, i) => console.log(`  [${i}] ${n}`))
}
