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
      /**
       * The compiled slot's id, carried so the correlator can JOIN a
       * `puncheokie.slotDispatcher.deferred` log line to the expectation it
       * suppressed. Without it a dropped combo-announce is indistinguishable
       * from one the app never tried to play (GH #305).
       */
      slotId: string
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
    slotId: slot.slotId,
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
  //     combo-announce clip via score.coachSlots, ONCE for the block
  //     (the runner enqueues only `repeatIndex === 0`); the block's
  //     remaining reps are worked in silence.
  //   - `per-punch` and default cues → announcer's `announce()` fires
  //     a per-word phrase (playPhrase) that emits one standalone clip
  //     per PUNCH token, and `onTokenDue` may add per-token calls
  //     under `follow-the-call` / `in-time` styles.
  //
  // For the expected manifest we anchor per-word events to what the
  // ENGINE emits: `cue.scheduledStartMs + cue.tokenOffsetsMs[tokenIdx]`
  // — the exact wall-clock ms the runtime uses for its `token-due`
  // event. Actual observed timing may drift from this (playPhrase
  // schedules earlier than the strike beat; onTokenDue fires AT the
  // strike beat) — the correlator's match window absorbs that; the
  // key correctness invariant is "the right asset for the right
  // strike position at roughly the right moment", not exact-tick
  // matching.
  const timeline = expandTimeline(workout, 'orthodox', bpm)
  const round0 = timeline[0]
  // TWO sets, because `announce-then-work` means different things to the
  // two branches below and one set cannot serve both (GH #305).
  //
  // `expandBlock` mints one CueInstance PER REPETITION (`sp1-b4#0` …
  // `#9`), and every rep carries the block's voicePolicy. So:
  //
  //   - Only the rep-0 cue is ANNOUNCED. The runner enqueues score slots
  //     under `voicePolicy === 'announce-then-work' && repeatIndex === 0`
  //     (_useWorkoutRunner.ts, commit 28db740) — speak the combination
  //     once at block start, not once per rep. Expecting a slot per rep
  //     produced 23 speed-combos expectations against 5 real dispatches,
  //     i.e. a guaranteed hard FAIL that had nothing to do with the app.
  //
  //   - But EVERY rep is silent on the per-word path. Interior reps are
  //     authored silence: `CueAnnouncer` early-returns for them. Letting
  //     rep>0 cues fall through to the per-word branch would mint ~50
  //     phantom per-word expectations per workout — which is why the
  //     one-line fix of just narrowing the single set is wrong.
  const atwAnnounceCueIds = new Set<string>()
  const atwCueIds = new Set<string>()
  if (round0) {
    for (const cue of round0.cues) {
      if (cue.voicePolicy !== 'announce-then-work') continue
      atwCueIds.add(cue.id)
      if (cue.repeatIndex === 0) atwAnnounceCueIds.add(cue.id)
    }
  }

  const roundOneAtwSlots = compiled.coachSlots
    .filter((s) => s.roundIndex === 0 && atwAnnounceCueIds.has(s.cueId))
    .slice()
    .sort((a, b) => a.reservationStartTick - b.reservationStartTick)
  const coachEvents: ExpectedCoachEvent[] = []
  for (const slot of roundOneAtwSlots) {
    const ev = toExpectedCoachEvent(slot)
    if (ev) coachEvents.push(ev)
  }
  // MVP v2 (GH #305): a click-track set caps the coach at 'minimal' —
  // punch calls belong to the visuals, so there are no per-word
  // expectations to correlate. Emitting them anyway would hard-FAIL every
  // click set on audio it is designed not to produce.
  const voiceMinimal = workout.recipe.voiceMode === 'minimal'
  if (round0 && !voiceMinimal) {
    for (const cue of round0.cues) {
      if (atwCueIds.has(cue.id)) continue
      for (let i = 0; i < cue.tokens.length; i += 1) {
        const token = cue.tokens[i]!
        if (token.kind !== 'punch') continue
        const assetId = token.body ? `${token.number}b` : `${token.number}`
        const expectedStartMs =
          cue.scheduledStartMs + (cue.tokenOffsetsMs[i] ?? 0)
        coachEvents.push({
          kind: 'per-word',
          cueId: cue.id,
          repId: 'rep-0',
          strikeIndex: i,
          assetId,
          expectedStartTick: Math.round(expectedStartMs / MS_PER_TICK),
          expectedStartMs,
          source: 'announcer.per-word',
        })
      }
    }
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
