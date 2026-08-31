/**
 * Generate the expected first-round audio manifest for a workout.
 *
 * Loop Stage 1 of the 10-Workout Audio Verification Loop
 * (see .claude/plans/it-s-time-to-build-linked-deer.md).
 *
 * Runs `compileWorkoutScore` on each requested sample and writes
 * `tools/analysis/manifests/<workoutId>.json` — the ground truth the
 * verifier correlates against.
 *
 * Usage:
 *   npx tsx tools/analysis/first-round-manifest.ts --workout=<id>
 *   npx tsx tools/analysis/first-round-manifest.ts --all
 *
 * Deterministic — same input produces byte-equal output.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compileWorkoutScore } from '../../src/domain/programs/workoutScore'
import { runtimeCoachAssetResolver } from '../../src/audio/coachAssetResolvers'
import { bpmForRecipe } from '../../src/domain/workout/cadence'
import {
  getSampleWorkout,
  listSampleWorkouts,
  type SampleWorkoutKey,
} from '../../src/domain/workout/samples'
import { findComboAnnounceById } from '../../src/audio/voiceAssets/comboAnnounceManifest'
import { TRANSPORT_TICKS_PER_PULSE } from '../../src/domain/timing/TimingEngine'
import { expandTimeline } from '../../src/domain/programs/CueTimeline'
import type {
  CompiledCoachSlot,
  CompiledScoreStrike,
} from '../../src/domain/programs/workoutScore'

const MS_PER_TICK = 60_000 / (60 * TRANSPORT_TICKS_PER_PULSE)

const THIS_FILE = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(THIS_FILE), '..', '..')
const MANIFESTS_DIR = join(REPO_ROOT, 'tools', 'analysis', 'manifests')

interface ExpectedStrike {
  eventId: string
  cueId: string
  repId: string
  repIndex: number
  strikeIndex: number
  token: string
  startTick: number
  startMs: number
  targetStrikeTick: number
  targetStrikeMs: number
}

type ExpectedCoachEvent =
  | {
      kind: 'combo-announce'
      cueId: string
      repId: string | null
      assetId: string
      text?: string
      durationMs?: number
      expectedStartTick: number
      expectedStartMs: number
      expectedEndTick: number
      expectedEndMs: number
      source: 'score.coachSlot'
    }
  | {
      kind: 'per-word'
      cueId: string
      repId: string
      strikeIndex: number
      assetId: string
      expectedStartTick: number
      expectedStartMs: number
      source: 'announcer.per-word'
    }

interface FirstRoundManifest {
  workoutId: string
  workoutName: string
  roundIndex: 0
  workDurationMs: number
  bpm: number
  compiledAtEpochMs: 0
  identity: {
    workoutId: string
    revision: number
    timelineHash: string
  }
  strikes: readonly ExpectedStrike[]
  coachEvents: readonly ExpectedCoachEvent[]
  silentByDesign: readonly {
    reason: string
    cueId: string
    spanTick: readonly [number, number]
    spanMs: readonly [number, number]
  }[]
  notes: readonly string[]
}

function tickToMs(tick: number): number {
  return Math.round(tick * MS_PER_TICK)
}

function toExpectedStrike(strike: CompiledScoreStrike): ExpectedStrike {
  return {
    eventId: strike.eventId,
    cueId: strike.cueId,
    repId: strike.repId,
    repIndex: strike.repIndex,
    strikeIndex: strike.strikeIndex,
    token: strike.token,
    startTick: strike.startTick,
    startMs: tickToMs(strike.startTick),
    targetStrikeTick: strike.targetStrikeTick,
    targetStrikeMs: tickToMs(strike.targetStrikeTick),
  }
}

function toExpectedCoachEvent(slot: CompiledCoachSlot): ExpectedCoachEvent | null {
  const preferred = slot.variants.numeric ?? slot.variants.technique
  if (!preferred) return null
  if (slot.contentKind !== 'combo-announce') return null
  const clip = findComboAnnounceById(preferred.assetId)
  return {
    kind: 'combo-announce',
    cueId: slot.cueId,
    repId: slot.repId,
    assetId: preferred.assetId,
    ...(clip ? { text: clip.text, durationMs: clip.durationMs } : {}),
    expectedStartTick: preferred.audibleStartTick,
    expectedStartMs: tickToMs(preferred.audibleStartTick),
    expectedEndTick: preferred.audibleEndTick,
    expectedEndMs: tickToMs(preferred.audibleEndTick),
    source: 'score.coachSlot',
  }
}

export function buildFirstRoundManifest(
  workoutId: SampleWorkoutKey,
): FirstRoundManifest {
  const sample = getSampleWorkout(workoutId)
  const workout = sample.workout
  const bpm = bpmForRecipe(workout.recipe)
  const compiled = compileWorkoutScore(workout, {
    stance: 'orthodox',
    bpm,
    revision: 1,
    compiledAtEpochMs: 0,
    coachAssets: runtimeCoachAssetResolver,
  })
  const roundOneStrikes = compiled.strikes
    .filter((s) => s.roundIndex === 0)
    .slice()
    .sort((a, b) => a.startTick - b.startTick)

  // Runtime plays combos two different ways depending on the cue's V1c
  // voicePolicy:
  //   - `announce-then-work` cues → SlotDispatcher fires a single
  //     combo-announce clip via score.coachSlots (per Slice 3-a-ii's
  //     hotfix filter, only ATW cues are enqueued).
  //   - `per-punch` and default cues → announcer's per-word path
  //     fires one standalone clip per token at the strike's beat.
  //
  // Both must appear in the expected manifest so the correlator can
  // match either dispatch path.
  const timeline = expandTimeline(workout, 'orthodox', bpm)
  const round0 = timeline[0]
  const atwCueIds = new Set<string>()
  const cuesById = new Map<string, (typeof round0.cues)[number]>()
  if (round0) {
    for (const cue of round0.cues) {
      cuesById.set(cue.id, cue)
      if (cue.voicePolicy === 'announce-then-work') atwCueIds.add(cue.id)
    }
  }

  const roundOneAtwSlots = compiled.coachSlots
    .filter((s) => s.roundIndex === 0 && atwCueIds.has(s.cueId))
    .slice()
    .sort((a, b) => a.reservationStartTick - b.reservationStartTick)
  const coachEvents: ExpectedCoachEvent[] = []
  for (const slot of roundOneAtwSlots) {
    const ev = toExpectedCoachEvent(slot)
    if (ev) coachEvents.push(ev)
  }
  for (const strike of roundOneStrikes) {
    if (atwCueIds.has(strike.cueId)) continue
    coachEvents.push({
      kind: 'per-word',
      cueId: strike.cueId,
      repId: strike.repId,
      strikeIndex: strike.strikeIndex,
      assetId: strike.token.toLowerCase(),
      expectedStartTick: strike.targetStrikeTick,
      expectedStartMs: tickToMs(strike.targetStrikeTick),
      source: 'announcer.per-word',
    })
  }
  coachEvents.sort((a, b) => a.expectedStartTick - b.expectedStartTick)
  const notes: string[] = []
  if (workoutId === 'pump-and-coast') {
    notes.push(
      'Pump & Coast pump / coast blocks are DELIBERATELY coach-silent — sustained + coast runtime consumers not yet wired. silentByDesign is TBD until the manifest generator learns to detect those block spans (Slice 6).',
    )
  }
  return {
    workoutId: sample.key,
    workoutName: sample.name,
    roundIndex: 0,
    workDurationMs: workout.schedule[0]?.workDurationMs ?? 0,
    bpm,
    compiledAtEpochMs: 0,
    identity: {
      workoutId: compiled.identity.workoutId,
      revision: compiled.identity.revision,
      timelineHash: compiled.identity.timelineHash,
    },
    strikes: roundOneStrikes.map(toExpectedStrike),
    coachEvents,
    silentByDesign: [],
    notes,
  }
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function writeManifest(manifest: FirstRoundManifest): string {
  ensureDir(MANIFESTS_DIR)
  const outPath = join(MANIFESTS_DIR, `${manifest.workoutId}.json`)
  ensureDir(dirname(outPath))
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return outPath
}

function summarize(m: FirstRoundManifest): string {
  return [
    `${m.workoutId} (${m.workoutName})`,
    `  round 1 · ${m.workDurationMs / 1000}s · ${m.bpm} bpm · hash=${m.identity.timelineHash}`,
    `  strikes=${m.strikes.length} · coachEvents=${m.coachEvents.length} · silentByDesign=${m.silentByDesign.length}`,
    ...(m.notes.length > 0 ? [`  notes:`, ...m.notes.map((n) => `    - ${n}`)] : []),
  ].join('\n')
}

function parseArgs(argv: string[]): { all: boolean; workouts: SampleWorkoutKey[] } {
  const all = argv.includes('--all')
  const workoutArg = argv.find((a) => a.startsWith('--workout='))
  const single = workoutArg?.slice('--workout='.length) as SampleWorkoutKey | undefined
  if (all && single) {
    throw new Error('Pass either --all or --workout=<id>, not both.')
  }
  if (!all && !single) {
    throw new Error(
      'Usage: npx tsx tools/analysis/first-round-manifest.ts (--all | --workout=<id>)',
    )
  }
  if (all) {
    return {
      all: true,
      workouts: listSampleWorkouts().map((s) => s.key),
    }
  }
  return { all: false, workouts: [single as SampleWorkoutKey] }
}

function main(): void {
  const argv = process.argv.slice(2)
  const { workouts } = parseArgs(argv)
  for (const key of workouts) {
    const manifest = buildFirstRoundManifest(key)
    const outPath = writeManifest(manifest)
    console.log(summarize(manifest))
    console.log(`  wrote ${outPath}`)
  }
}

// Only run when invoked directly (not on import).
const invokedDirectly = process.argv[1]?.endsWith('first-round-manifest.ts')
if (invokedDirectly) {
  main()
}
