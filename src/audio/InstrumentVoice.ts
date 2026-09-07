/**
 * The instrument's audio-output seam (audio-engine-migration.md, step 2).
 *
 * Two engines will exist side by side for a while: the shipping expo-audio
 * pool, and the Oboe/AAudio replacement. This interface is what both answer
 * to, and the factory below is the single place that decides which one a
 * screen gets.
 *
 * The point of cutting the seam BEFORE writing the new engine is that every
 * later step becomes reversible **on the tablet, without another build**.
 * That matters more here than it normally would: Metro cannot watch this
 * repo's drive, so there is no fast refresh — every code edit costs a Metro
 * restart plus a cold app restart before it reaches the device. A persisted
 * flag turns "which engine am I hearing?" from a rebuild into a tap.
 *
 * Step 2 deliberately makes NO behavioural change: both branches return the
 * existing class. The suite proves it by staying green with zero edits.
 */
import type { CompiledPunchGesture } from '@domain/instrument/gestureSchema'
import type { InstrumentTextureId } from './voiceAssets/instrumentBankManifest'
import { InstrumentVoiceOutput } from './InstrumentVoiceOutput'
import { InstrumentVoiceOutputOboe } from './InstrumentVoiceOutputOboe'
import type { InstrumentVoiceMode } from './instrumentSelection'
import type { InstrumentEngine } from './instrumentEngine'

export { INSTRUMENT_ENGINES, type InstrumentEngine } from './instrumentEngine'


/**
 * Everything a screen needs from the instrument's voice.
 *
 * Taken verbatim from the shipped class rather than designed fresh: an
 * interface that the existing implementation does not already satisfy would
 * mean this step changed behaviour, which is exactly what it must not do.
 */
export interface InstrumentVoice {
  /** False means permanent no-instrument mode; every call is a no-op. */
  readonly available: boolean
  preload(textureId: InstrumentTextureId): Promise<void>
  setTexture(textureId: InstrumentTextureId): void
  setMode(mode: InstrumentVoiceMode): void
  handleGesture(gesture: CompiledPunchGesture): void
  /** Silence everything now, keeping the pools warm. */
  panic(): void
  /** Free every native handle. */
  release(): void
}

/**
 * Build the instrument voice for `engine`.
 *
 * Both engines are real as of step 3. The Oboe branch owns the one-shots and
 * carries bed/bass on an expo-audio delegate, so flipping the flag changes the
 * one-shot path and nothing else — which is what makes the A/B honest.
 */
export function createInstrumentVoice(engine: InstrumentEngine): InstrumentVoice {
  switch (engine) {
    case 'oboe':
      return new InstrumentVoiceOutputOboe()
    case 'expo':
    default:
      return new InstrumentVoiceOutput()
  }
}
