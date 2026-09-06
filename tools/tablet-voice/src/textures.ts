/**
 * Texture registry for the tablet instrument bank (M40-15 #319).
 *
 * A TextureDefinition is the COMPLETE sonic identity of one selectable
 * tablet voice: oscillator stack, filter, per-role ADSR (bed / bass / stab)
 * and level trims. Adding a texture later is ONE new registry entry plus a
 * re-render (`npx tsx tools/tablet-voice/src/render-brass-bank.ts`) — the
 * render tool iterates `Object.keys(TEXTURES)` sorted, and the generated
 * manifest's texture-id union follows the registry keys; nothing else
 * changes.
 *
 * The trims are the mix-tuning knobs: Kyle's ear may revise them, and a
 * revision is a texture edit + re-render — NEVER a runtime gain (all level
 * balance is baked into the wavs; the engine plays loops at volume 1).
 */

export interface OscSpec {
  wave: 'saw'
  detuneCents: number
  level: number
}

export interface AdsrSpec {
  attackMs: number
  decayMs: number
  sustain: number
  releaseMs: number
}

export interface RoleSpec {
  oscillators: readonly OscSpec[]
  filter: { cutoffHz: number; q: number }
  adsr: AdsrSpec
  trim: number
}

export interface TextureDefinition {
  id: string
  bed: RoleSpec
  /** 'sustain-loop' renders steady-state periodic tone (adsr IGNORED, integer-period fit);
   *  'restruck-decay' renders one enveloped strike at sample 0 in a fixed 96000-sample loop. */
  bass: RoleSpec & { mode: 'sustain-loop' | 'restruck-decay' }
  stab: RoleSpec
}

export const TEXTURES: Readonly<Record<string, TextureDefinition>> = {
  /**
   * 'brass' — the Dorian Brass Cube identity: detuned saws (+6 cents), warm
   * low-pass, the ruling-pinned bed ADSR A14/D280/S0.64/R190.
   */
  brass: {
    id: 'brass',
    bed: {
      oscillators: [
        { wave: 'saw', detuneCents: 0, level: 0.5 },
        { wave: 'saw', detuneCents: 6, level: 0.5 },
      ],
      filter: { cutoffHz: 2200, q: 0.9 },
      adsr: { attackMs: 14, decayMs: 280, sustain: 0.64, releaseMs: 190 },
      trim: 0.25,
    },
    bass: {
      mode: 'sustain-loop',
      // No detune on the sustained bass: a detuned pair inside a ~2 s
      // integer-period loop would need BOTH partial sets periodic in the
      // same window — but the loop's frequency quantization is ~0.5 Hz at
      // this register, coarser than any musical detune, so the fit would
      // collapse the pair to unison anyway. One saw, warm and seamless.
      oscillators: [{ wave: 'saw', detuneCents: 0, level: 1.0 }],
      filter: { cutoffHz: 700, q: 0.707 },
      // Ignored: sustain-loop renders the periodic steady state, no envelope.
      adsr: { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 0 },
      trim: 0.32,
    },
    stab: {
      oscillators: [
        { wave: 'saw', detuneCents: 0, level: 0.5 },
        { wave: 'saw', detuneCents: 6, level: 0.5 },
      ],
      filter: { cutoffHz: 3200, q: 0.9 },
      adsr: { attackMs: 5, decayMs: 60, sustain: 0.8, releaseMs: 160 },
      trim: 0.45,
    },
  },
  /**
   * 'pluck' — short percussive decay, no sustain, brighter attack: the
   * marimba/koto arp feel. sustain 0 + release 0 engages the dsp sustain-0
   * rule, so every bed step decays to silence INSIDE its gate; the bass is
   * a slow re-struck decay loop instead of a sustained tone.
   */
  pluck: {
    id: 'pluck',
    bed: {
      oscillators: [
        { wave: 'saw', detuneCents: 0, level: 0.6 },
        { wave: 'saw', detuneCents: 4, level: 0.4 },
      ],
      filter: { cutoffHz: 4800, q: 0.707 },
      adsr: { attackMs: 2, decayMs: 350, sustain: 0, releaseMs: 0 },
      trim: 0.28,
    },
    bass: {
      mode: 'restruck-decay',
      oscillators: [{ wave: 'saw', detuneCents: 0, level: 1.0 }],
      filter: { cutoffHz: 1000, q: 0.707 },
      adsr: { attackMs: 3, decayMs: 1500, sustain: 0, releaseMs: 0 },
      trim: 0.34,
    },
    stab: {
      oscillators: [
        { wave: 'saw', detuneCents: 0, level: 0.6 },
        { wave: 'saw', detuneCents: 4, level: 0.4 },
      ],
      filter: { cutoffHz: 5500, q: 0.707 },
      adsr: { attackMs: 2, decayMs: 200, sustain: 0, releaseMs: 0 },
      trim: 0.45,
    },
  },
}
