/**
 * Block-level cornerman instruction clips (generated).
 *
 * DO NOT EDIT — produced by `node tools/voice/make-instruction-clips.mjs`.
 *
 * Each entry pairs a rendered wav with the exact text a workout
 * block authored on `WorkoutBlock.instruction`. Runtime lookup is by
 * exact text match — if a block's instruction has no entry here, it
 * simply stays silent (the block still runs; nothing crashes).
 *
 * This file ships EMPTY until the render batch runs — the type shape
 * exists so callers can import it, and `instructionClipFor` always
 * returns `undefined` until clips land. The generator adds the
 * `@typescript-eslint/no-require-imports` disable when it inlines the
 * `require(...)` module references; the empty stub doesn't need it.
 */

export interface InstructionClip {
  id: string
  /** The exact `WorkoutBlock.instruction` text this clip renders. */
  text: string
  /** Metro module id for the wav. */
  module: number
  /** Measured duration of the rendered clip, in milliseconds. */
  durationMs: number
}

export const INSTRUCTION_CLIPS: readonly InstructionClip[] = []

/**
 * The clip for a block instruction, or undefined when none was rendered.
 * Matches on the exact authored text — no fuzzy normalization, so the
 * block author and the render script cannot silently disagree.
 */
export function instructionClipFor(text: string): InstructionClip | undefined {
  return INSTRUCTION_CLIPS.find((c) => c.text === text)
}
