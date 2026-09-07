/**
 * Evidence for the 2026-09-07 acceleration retune.
 *
 *   npx tsx tools/analysis/scaler-check.ts
 *
 * Replays the 24 accelerationRaw values logged off the gloves on 2026-09-06
 * through the old and new scaler constants, then through drum-kit-design §9's
 * velocity curve, and prints how many punches pin at MIDI 127.
 *
 * Kept because the conclusion is easy to get wrong in both directions: the
 * scaler was the whole cause (6 of 24 pinned, down to 2), and the §9 gamma —
 * the obvious second suspect — turned out not to matter at all. Re-run it
 * before touching either.
 */
import {
  createRollingScaler,
  HIGH_SENSITIVITY_ACCELERATION_DEFAULTS as NOW,
} from '../../src/domain/instrument/rollingScale'

const CAPTURED = [237, 92, 197, 41, 721, 110, 104, 116, 120, 175, 76, 796, 484,
  217, 215, 564, 602, 548, 230, 643, 466, 470, 360, 380]
const OLD = { ...NOW, warmHigh: 350, highPercentile: 0.85 }

const run = (o: typeof NOW) => {
  const s = createRollingScaler(o)
  return CAPTURED.map((r) => s.scale('right', r))
}
const fmt = (v: number[]) => v.map((x) => x.toFixed(2)).join(' ')
const pinned = (v: number[]) => v.filter((x) => x >= 0.999).length
// downstream: uppercut lane 75..127 with gamma 0.72
const midi = (a: number) => Math.round(75 + 52 * Math.pow(a, 0.72))

const before = run(OLD), after = run(NOW)
console.log('BEFORE pinned:', pinned(before), '/', CAPTURED.length)
console.log('AFTER  pinned:', pinned(after), '/', CAPTURED.length)
console.log('')
console.log('hardest four (raw 602,643,721,796) as MIDI velocity:')
const idx = [16, 19, 4, 11]
console.log('  before:', idx.map((i) => midi(before[i]!)).join(', '))
console.log('  after :', idx.map((i) => midi(after[i]!)).join(', '))
console.log('')
console.log('distinct MIDI velocities across the session:')
console.log('  before:', new Set(before.map(midi)).size)
console.log('  after :', new Set(after.map(midi)).size)

// The scaler is only half the chain. drum-kit-design §9 maps accel01 through
// `min + (max-min) * accel01^gamma` with gamma 0.72, which bows the curve
// UPWARD — more resolution at the bottom, less at the top, by design. Ask how
// much of the remaining flattening is the curve rather than the scaler.
console.log('')
console.log('the SAME (fixed) accel01 values through different gammas:')
for (const g of [0.72, 0.85, 1.0]) {
  const m = (a: number) => Math.round(75 + 52 * Math.pow(a, g))
  console.log(
    `  gamma ${g.toFixed(2)}  hardest four: ${idx.map((i) => m(after[i]!)).join(', ')}` +
      `   distinct across session: ${new Set(after.map(m)).size}`,
  )
}
