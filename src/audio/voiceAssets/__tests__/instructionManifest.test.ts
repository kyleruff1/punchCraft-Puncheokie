/**
 * Instruction manifest contract.
 *
 * `INSTRUCTION_CLIPS` starts empty and is filled by the render batch
 * (`node tools/voice/make-instruction-clips.mjs`). What must hold no
 * matter how many clips exist:
 *
 * 1. `instructionClipFor` returns undefined for unknown text — never
 *    throws, never approximates. A block whose instruction has no clip
 *    stays silent; the block still runs.
 * 2. If clips exist, ids are unique and text is unique — the lookup is
 *    by exact text match, so two entries with the same text would be
 *    ambiguous.
 * 3. Every clip's text is a non-empty string and durationMs > 0.
 * 4. If the block-authored `instruction` strings across the shipped
 *    sample workouts have any coverage, the covered ones round-trip
 *    through `instructionClipFor` back to the same clip.
 */
import {
  INSTRUCTION_CLIPS,
  instructionClipFor,
} from '../instructionManifest'

describe('instructionManifest — the lookup contract', () => {
  it('returns undefined for unknown text', () => {
    expect(instructionClipFor('this text was never authored')).toBeUndefined()
    expect(instructionClipFor('')).toBeUndefined()
  })

  it('is idempotent under re-lookup', () => {
    // Even if the manifest is empty, calling twice returns the same result.
    expect(instructionClipFor('Breathe.')).toBe(instructionClipFor('Breathe.'))
  })

  it('keeps ids and texts unique — no ambiguous lookup', () => {
    const ids = INSTRUCTION_CLIPS.map((c) => c.id)
    const texts = INSTRUCTION_CLIPS.map((c) => c.text)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('every clip carries a positive duration and non-empty text', () => {
    for (const clip of INSTRUCTION_CLIPS) {
      expect(clip.text.length).toBeGreaterThan(0)
      expect(clip.durationMs).toBeGreaterThan(0)
      expect(clip.id).toMatch(/^in-/)
    }
  })

  it('every clip round-trips through instructionClipFor by its exact text', () => {
    for (const clip of INSTRUCTION_CLIPS) {
      const found = instructionClipFor(clip.text)
      expect(found?.id).toBe(clip.id)
    }
  })
})
