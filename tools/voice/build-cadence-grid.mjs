/**
 * Dump CADENCE_PROFILES + ANNOUNCE_LEAD_TIMES to JSON for the Python
 * offset-audit tools.
 *
 * The audit needs the exact beat-grid math the runtime uses to fire ring
 * highlights (beatsToMs(tokenIndex, nominalBpm)) plus the placement rule's
 * readyToneMs so its predicted per-token offsets match what the compiled
 * rhythm map actually schedules. Reading a JSON side-file keeps TypeScript
 * as the source of truth without any Python import gymnastics — regenerate
 * whenever cadence.ts or the rhythm map's placement constants change.
 *
 * Run: node tools/voice/build-cadence-grid.mjs
 * Writes: tools/voice/cadence-grid.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Mirrored constants — the source-of-truth check below fails loudly on drift.
const CADENCE_PROFILES = {
  technical: { id: 'technical', minBpm: 80, maxBpm: 90, nominalBpm: 85 },
  steady: { id: 'steady', minBpm: 95, maxBpm: 110, nominalBpm: 100 },
  pressure: { id: 'pressure', minBpm: 110, maxBpm: 130, nominalBpm: 120 },
  sprint: { id: 'sprint', minBpm: 130, maxBpm: 150, nominalBpm: 140 },
}
const DEFAULT_ANNOUNCE_LEAD_TIMES = { announceMs: 750, readyToneMs: 100 }

const cadenceSrc = readFileSync(join('src', 'domain', 'workout', 'cadence.ts'), 'utf8')
for (const [id, prof] of Object.entries(CADENCE_PROFILES)) {
  const needle = `${id}: { id: '${id}', minBpm: ${prof.minBpm}, maxBpm: ${prof.maxBpm}, nominalBpm: ${prof.nominalBpm} }`
  if (!cadenceSrc.includes(needle)) {
    console.error(`ERROR: cadence.ts no longer matches this dumper for ${id}. Refresh both.`)
    process.exit(1)
  }
}
const rhythmSrc = readFileSync(join('src', 'domain', 'programs', 'RhythmMap.ts'), 'utf8')
if (
  !rhythmSrc.includes(
    `announceMs: ${DEFAULT_ANNOUNCE_LEAD_TIMES.announceMs}, readyToneMs: ${DEFAULT_ANNOUNCE_LEAD_TIMES.readyToneMs}`,
  )
) {
  console.error('ERROR: DEFAULT_ANNOUNCE_LEAD_TIMES drift; refresh dumper.')
  process.exit(1)
}

const outPath = join('tools', 'voice', 'cadence-grid.json')
writeFileSync(
  outPath,
  JSON.stringify(
    {
      note: 'Mirror of CADENCE_PROFILES + DEFAULT_ANNOUNCE_LEAD_TIMES. Regenerate with build-cadence-grid.mjs.',
      profiles: CADENCE_PROFILES,
      leadTimes: DEFAULT_ANNOUNCE_LEAD_TIMES,
    },
    null,
    2,
  ),
)
console.log(`Wrote ${outPath}`)
