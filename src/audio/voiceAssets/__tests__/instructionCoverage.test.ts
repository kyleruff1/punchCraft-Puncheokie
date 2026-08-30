/**
 * Coverage guard between the shipped sample workouts and the
 * instruction script (`tools/voice/instructions.json`).
 *
 * A block with `instruction: 'X'` whose text has no entry in the
 * instructions script is not a runtime failure — the runtime just goes
 * silent for that block — but it IS a build-quality regression: the
 * whole point of A11 + WS4 is that authored coaching lines get spoken.
 * A silent block is a signal the render batch and the sample text drifted
 * apart. This test surfaces the drift the moment a sample gains a new
 * instruction that the JSON doesn't yet list.
 *
 * Passing this test is NOT the same as saying every instruction has a
 * rendered clip — that requires actually running the render batch. See
 * `instructionManifest.test.ts` for the runtime lookup contract.
 */
import { readFileSync } from 'node:fs'
import { cwd } from 'node:process'
import { join } from 'node:path'

import { listSampleWorkouts } from '@domain/workout/samples'

interface InstructionEntry {
  id: string
  text: string
}

function loadInstructionsJson(): InstructionEntry[] {
  const raw = readFileSync(join(cwd(), 'tools', 'voice', 'instructions.json'), 'utf8')
  const parsed = JSON.parse(raw) as { instructions: InstructionEntry[] }
  return parsed.instructions
}

/** Every instruction string authored on any block, across all samples. */
function authoredInstructionTexts(): Set<string> {
  const texts = new Set<string>()
  for (const sample of listSampleWorkouts()) {
    for (const round of sample.workout.schedule) {
      for (const block of round.blocks) {
        if (block.instruction) texts.add(block.instruction)
      }
    }
  }
  return texts
}

/**
 * Instructions that reach a block from somewhere other than a static
 * sample — the pacing engine synthesizes these mid-workout, so scanning
 * the sample tree cannot see them. Keeping this whitelist tiny and
 * commented is safer than having the test parse planMutation.ts.
 */
const SYNTHESIZED_INSTRUCTION_TEXTS: readonly string[] = [
  // planMutation.ts:~189 — the coach's line on the free-work
  // recovery block the engine drops in when a round overruns.
  'Work at your own rate.',
]

describe('instruction coverage — every authored line has a script entry', () => {
  const scripted = loadInstructionsJson()

  it('the scripted list has unique ids and unique texts', () => {
    const ids = scripted.map((e) => e.id)
    const texts = scripted.map((e) => e.text)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('every WorkoutBlock.instruction across the sample workouts is in instructions.json', () => {
    const authored = authoredInstructionTexts()
    const scriptedTexts = new Set(scripted.map((e) => e.text))
    const missing = [...authored].filter((t) => !scriptedTexts.has(t))
    expect(missing).toEqual([])
  })

  it('every scripted line is still used somewhere (no dead entries)', () => {
    // Dead entries are cheap to remove — this test names them so the
    // render batch does not waste time producing a wav for a line no
    // block will ever emit. A line authored on a static sample OR
    // synthesized by the pacing engine (see SYNTHESIZED_INSTRUCTION_TEXTS
    // above) counts as used; anything else here has drifted away from a
    // live source.
    const authored = authoredInstructionTexts()
    for (const text of SYNTHESIZED_INSTRUCTION_TEXTS) authored.add(text)
    const dead = scripted.filter((e) => !authored.has(e.text)).map((e) => e.id)
    expect(dead).toEqual([])
  })
})
