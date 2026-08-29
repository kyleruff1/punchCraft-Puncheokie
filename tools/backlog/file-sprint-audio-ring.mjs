#!/usr/bin/env node
/**
 * file-sprint-audio-ring.mjs — idempotent filer for the Audio & Ring
 * Integrity Sprint's issue tree.
 *
 * Creates ONE parent tracking issue plus the opening set of sub-issues
 * (A0..A15), links each sub-issue to the parent via the `addSubIssue`
 * GraphQL mutation, and adds every issue to Project #5 with the correct
 * field values (Phase 5, Area Puncheokie, Priority, Size, Sprint 1).
 *
 * IDEMPOTENT by exact title: a re-run finds each existing issue and only
 * fills whatever step (labels, milestone, sub-issue link, project item,
 * field values) still needs it. Safe to run any number of times, and
 * each test pass that appends a new observed defect gets its own entry
 * added here + a second run of the script.
 *
 * Repo:      kyleruff1/punchCraft-Puncheokie
 * Milestone: 34 (M34: Voice Coach)  — verified live
 * Project:   #5  (PVT_kwHOAvpEDc4BhJtG)
 * Labels:    task, phase:5, area:puncheokie, P0|P1|P2, sprint-1 (all verified live)
 *
 * Usage:
 *   node tools/backlog/file-sprint-audio-ring.mjs           # runs it
 *   node tools/backlog/file-sprint-audio-ring.mjs --dry-run # prints the plan
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCb)
const DRY = process.argv.includes('--dry-run')
const REPO = 'kyleruff1/punchCraft-Puncheokie'
const MILESTONE_NUM = 34
const MILESTONE_TITLE = 'M34: Voice Coach'
const OWNER = '@me'
const PROJECT_NUM = 5

const here = dirname(fileURLToPath(import.meta.url))
const projectSchema = JSON.parse(readFileSync(resolve(here, 'project.json'), 'utf8'))
const PROJECT_ID = projectSchema.project.id
const FIELD = {
  Phase: projectSchema.fields.Phase.id,
  Area: projectSchema.fields.Area.id,
  Priority: projectSchema.fields.Priority.id,
  Size: projectSchema.fields.Size.id,
  Sprint: projectSchema.fields.Sprint.id,
}
const OPT = {
  Phase5: projectSchema.fields.Phase.options['Phase 5'].id,
  AreaPuncheokie: projectSchema.fields.Area.options.Puncheokie.id,
  P0: projectSchema.fields.Priority.options.P0.id,
  P1: projectSchema.fields.Priority.options.P1.id,
  P2: projectSchema.fields.Priority.options.P2.id,
  SizeXS: projectSchema.fields.Size.options.XS.id,
  SizeS: projectSchema.fields.Size.options.S.id,
  SizeM: projectSchema.fields.Size.options.M.id,
  SizeL: projectSchema.fields.Size.options.L.id,
}
const SPRINT1_ITER = projectSchema.fields.Sprint.iterations['Sprint 1'].id

/** Common labels every sub-issue carries. */
const BASE_LABELS = ['task', 'phase:5', 'area:puncheokie', 'sprint-1']

/** Parent tracking issue. */
const PARENT = {
  title: 'M34-A Audio & ring integrity — the double-sided engine',
  labels: ['story', 'phase:5', 'area:puncheokie', 'P0', 'sprint-1'],
  priority: 'P0',
  size: 'L',
  body:
    'Sprint tracking issue for the Audio & Ring Integrity sprint. See the ' +
    "plan at C:\\Users\\kyler\\.claude\\plans\\it-s-time-to-build-linked-deer.md " +
    'for the RhythmSpine design.\n\n' +
    'Sub-issues below cover measured defects A0–A15 from the 2026-08-29 ' +
    'monitored pace-pusher pass. Additional defects observed during the ' +
    '11-round test protocol get filed as new sub-issues under this parent.',
}

/** Sub-issues in filing order. */
const SUBS = [
  {
    key: 'A4',
    title: 'A4 · Mic analyzer stale 1.2 s max-clip constant misreads every measurement',
    priority: 'P0',
    size: 'XS',
    body:
      'tools/audition/speech_gaps.py assumes the longest coach clip is ~1.2 s and ' +
      'flags every longer utterance as an overlap. Measured against the ' +
      "manifest: **607 of 776 clips exceed 1.2 s**; average `techniques` clip " +
      "2197 ms, longest 8720 ms. Every utterance measured from the 2026-08-29 " +
      'tape (1940–3600 ms) matches a real single clip within ~40 ms.\n\n' +
      '**Fix:** replace the constant with per-utterance comparison against ' +
      "the actual expected clip length from `phraseManifest`/`calloutManifest`. " +
      'Blocks all further tape triage — file first, fix first.',
  },
  {
    key: 'A0',
    title: 'A0 · Encouragement is unreachable in shipped `standard` voice mode',
    priority: 'P0',
    size: 'S',
    body:
      "`VoiceCoachPolicy.ts:178` vetoes `coaching-reminder` when " +
      "`mode === 'standard'`; `WorkoutRecipe.ts:168` ships `standard`. Every " +
      '`kind:\'encouragement\'` event dies at `CueAnnouncer.ts:376` — all 6 ' +
      'rotation fillers **and** both power-strike calls per round ' +
      '(`RhythmMap.ts:519-551, 591-616`) are compiled and thrown away.\n\n' +
      '**Fix (from plan):** add a `gap-filler` category `shouldSpeak()` permits in ' +
      "`standard` mode; use it for the encouragement dispatch. Preserves the " +
      '"never interrupt a combination" rule (`VoiceCoachPolicy.ts:166`) and the ' +
      "athlete's Minimal mode.",
  },
  {
    key: 'A1',
    title: 'A1 · Chime-in duck is fixed 2750 ms against ceremony clips up to 8373 ms',
    priority: 'P0',
    size: 'S',
    body:
      '`emit()` mutes the call track for `durations.get(key) ?? 2500` + 250 ' +
      '(`VoiceOutputExpo.ts:699, 735-751`), but `durations` is **never ' +
      'populated for any `co-` asset**. **41 of 67 ceremony clips exceed ' +
      '2750 ms** (worst: `co-pressure-03` = 8373 ms).\n\n' +
      'After the duck expires `muteRestore` returns the phrase to full ' +
      'volume while the ceremony is still speaking → **two coach voices, ' +
      '1.5 s for a mid-range clip, 5.6 s for the worst**. ' +
      '`ROUND_OPEN_QUIET_MS = 1500` puts the first ceremony at ~1.5 s, so ' +
      'the collision lands within 15 s of a round start (exactly as reported).\n\n' +
      '**Fix:** read `CALLOUT_CLIPS[id].durationMs` in `muteCallsFor()` so ' +
      'the duck covers the whole clip.',
  },
  {
    key: 'A15',
    title: 'A15 · No global audio serialization (`AudioBus.busyUntilMs`)',
    priority: 'P0',
    size: 'M',
    body:
      'There is no global serialization anywhere in the audio path: no busy ' +
      'flag, no audible-until timestamp, no cross-track arbitration. 24 pooled ' +
      'players + 1 phrase player + a TTS engine can all sound at once; ' +
      '`cancel()` stops only *queued* items and has no path to `phrasePlayer` ' +
      'at any priority.\n\n' +
      '**Fix (structural, prerequisite for the spine):** new ' +
      '`src/audio/AudioBus.ts` with `busyUntilMs` that every emit path ' +
      'consults. Two coach layouts cannot sound at once by construction; ' +
      'this closes the class A1/A6–A10 all live in.',
  },
  {
    key: 'A2',
    title: 'A2 · Count-scored windows light no rings for 20–30 s',
    priority: 'P0',
    size: 'M',
    body:
      '`CueEngine.ts:359, 371` suppress `fireDueTokens` for ' +
      "`cue.scoring === 'count'`; `expectedPunches: []` at " +
      '`CueTimeline.ts:450` makes `useWorkoutRunner.ts:511-512` render every ' +
      "circle `'upcoming'` (dim). Measured: 20–30 s of dark ring row per burst " +
      'window on pace-pusher.\n\n' +
      '**Fix (spine):** `SpineSchedule.pulses` covers count-scored windows ' +
      "with the block's motif on the beat grid (`tokenOffsetsMs` is already " +
      'stamped at `CueTimeline.ts:449` — the data exists and is discarded). ' +
      "D4 holds: `expectedPunches` stays `[]`, nothing can be 'missed'.",
  },
  {
    key: 'A3',
    title: 'A3 · Free-work tail: 124–139 s per round of zero rings and zero audio',
    priority: 'P0',
    size: 'M',
    body:
      "`pace-pusher`'s hand-authored blocks cover only **101–116 s of each " +
      '240 s round (42–48 %)**; the rest is the free-work tail. ' +
      '`CueStage.tsx:244-248` renders **no token row at all**, and nothing is ' +
      'spoken. Measured: 120 s with zero voice launches, screen reading ' +
      '"Free work — keep your hands moving".\n\n' +
      '**Fix (spine):** round extender feeds the spine more motifs from the ' +
      "recipe through `roundFill.ts`'s existing repair pass; the schedule " +
      'keeps producing beats to the bell. Assertion #5 (round total silence ' +
      '≤ `maxSilentMs`) enforces this in Jest for every sample workout.',
  },
  {
    key: 'A5',
    title: 'A5 · Burst refires die silently when the clip is missing',
    priority: 'P0',
    size: 'S',
    body:
      'The refire loop is nested inside the `lengthMs !== undefined` branch ' +
      '(`RhythmMap.ts:283` vs `:375-397`), so a combination with no rendered ' +
      "clip gets **zero** refires — and `\"1\"` (active-recovery's only token) " +
      'has no `pressure` clip in either vocabulary. ' +
      '`silenceRepro.test.ts` covers only the `roundMap === null` fallback, ' +
      '**not** the shipped map path.\n\n' +
      '**Fix:** move the refire scheduling out of the nested branch; extend ' +
      '`silenceRepro.test.ts` to the map-driven path.',
  },
  {
    key: 'A6',
    title: 'A6 · playSequence leaks its timer → double-rate emission',
    priority: 'P1',
    size: 'XS',
    body:
      '`VoiceOutputExpo.ts:580-584` never clears an in-flight `sequenceHandle` ' +
      'before `:602` overwrites it. Two timers drive one shared step array → ' +
      'double-rate emission and an uncancellable handle. Triggered on the ' +
      'per-word fallback path.\n\n' +
      '**Fix:** add `this.clearSequence()` to the head of `playSequence`.',
  },
  {
    key: 'A7',
    title: 'A7 · flushMetric releases into the next call',
    priority: 'P1',
    size: 'S',
    body:
      '`cue-window-closed` → `inCombo = false` → `flushMetric()` ' +
      '(`CueAnnouncer.ts:447, 463`) → `output.speak(text, metric)` ' +
      '(`:600`). `CueTimeline.ts:322` clamps `windowEndMs` to the next ' +
      "cue's `scheduledStartMs`, and with the rail the next call has already " +
      'started ~400 ms earlier. The held metric is released into the exact ' +
      'instant it was held to avoid.\n\n' +
      "**Fix:** defer `flushMetric` past the next clip's audible end, " +
      "surfaced by AudioBus (A15). Same pattern at `rest-entered` (:505/:507).",
  },
  {
    key: 'A8',
    title: 'A8 · power#N skips the audited-silence pass',
    priority: 'P1',
    size: 'S',
    body:
      '`power-strikes` is pushed at `RhythmMap.ts:538-547` at ' +
      '`firstStart + firstGap * 0.4` **without gap audit against anything**. ' +
      'The audited-silence pass (`:562-615`) that keeps rotation ' +
      'encouragements out of ceremonies and closers runs *after* the power ' +
      'event is pushed and never re-checks it. So `power#N` can land inside ' +
      'the 30-s closer or a set ceremony → two full-volume lines.\n\n' +
      '**Fix:** route `power#N` through the same audited-silence pass as the ' +
      'rotation lines.',
  },
  {
    key: 'A9',
    title: 'A9 · in-time excludes call but not refire',
    priority: 'P1',
    size: 'XS',
    body:
      "`CueAnnouncer.ts:346`: `if (this.delivery === 'in-time' && event.kind === 'call') return`. " +
      "`'call'` only. A `refire` (count-scored bursts, every 6000 ms, " +
      '`RhythmMap.ts:381-394`) still plays the **whole phrase** on ' +
      "`phrasePlayer` while `onTokenDue` is simultaneously firing " +
      'individual pooled word clips. Two coach voices, different tracks, no ' +
      'duck (word clips are not chime-ins). Scoped to technical-cadence ' +
      "bursts by `deliveryForCadence` but unambiguous when triggered.\n\n" +
      "**Fix:** `event.kind === 'call' || event.kind === 'refire'`.",
  },
  {
    key: 'A10',
    title: 'A10 · cancel() cannot stop a sounding phrase (coach talks over pause)',
    priority: 'P1',
    size: 'S',
    body:
      '`onSessionPhase(\'paused\')` calls `output.cancel(AUDIO_PRIORITY.safety)` ' +
      '(`CueAnnouncer.ts:478`). `VoiceOutputExpo.ts:613-641` never touches ' +
      '`phrasePlayer` at any priority. Up to 8.7 s of coach continues over a ' +
      'paused workout.\n\n' +
      '**Fix:** give `cancel()` a path to `phrasePlayer` when the ' +
      'category is `safety`.',
  },
  {
    key: 'A11',
    title: 'A11 · Authored instruction/spokenPhrase never delivered',
    priority: 'P1',
    size: 'S',
    body:
      '`block.instruction` written at `samples/authoring.ts:116` is **read ' +
      'nowhere**. `block.spokenPhrase` reaches `CueInstance` ' +
      '(`CueTimeline.ts:401, 460`) but no audio path reads it — ' +
      '`RhythmMap`/`CueAnnouncer` both use `formatCombo(cue.tokens)` instead. ' +
      'Authored coaching copy is dead data.\n\n' +
      '**Fix (spine):** read them into a new `SetupCallout` layout on the ' +
      'block.',
  },
  {
    key: 'A12',
    title: 'A12 · active-recovery reserves 10.5–12 s but emits one cue',
    priority: 'P1',
    size: 'S',
    body:
      '`repeats = Math.max(1, block.repeat ?? 1)` (`CueTimeline.ts:342`) ' +
      'ignores `durationBeats`. One token lights, then dead rings and silence ' +
      "for the remainder — and its combination `\"1\"` has no `pressure` " +
      'phrase clip, so it takes the per-word fallback with no refires.\n\n' +
      '**Fix (spine):** pulses cover the reserved window.',
  },
  {
    key: 'A13',
    title: 'A13 · advance() swallows same-tick phrase launches',
    priority: 'P2',
    size: 'S',
    body:
      '`VoiceOutputExpo.ts:551-569` runs all due scheduled phrases in one ' +
      "synchronous loop; each `start()` removes the previous. Two calls due " +
      'on the same 50 ms tick both run `start()` back to back — the second ' +
      'removes the first, so the first is inaudible.\n\n' +
      '**Fix:** stagger same-tick phrases through AudioBus (A15).',
  },
  {
    key: 'A16',
    title: 'A16 · One JSON metadata object per phrase — the manifest that makes the spine actually enforce',
    priority: 'P0',
    size: 'M',
    body:
      "Kyle's follow-on (2026-08-29, during the A15 fold): the RhythmSpine's " +
      "promise (\"numbers vs techniques is a rendering choice, not a re-mapping\") " +
      'only holds if there is ONE source of truth for every surface offset per ' +
      'phrase. Today the timings live in three separate places (`phraseManifest.ts`, ' +
      '`calloutManifest.ts`, `PunchAvatarCard.tsx`), and reaching across those is ' +
      'exactly how the visual and audio tracks drift apart.\n\n' +
      '**Fix:** one JSON per phrase (single OR combo) with per-token ' +
      'numbers.onset/end, techniques.onset/end, measured vocab offset, avatar ' +
      'frame windows, ring atMs, and wordMarks source. Builder in ' +
      '`tools/voice/build_phrase_timing.py`; consumed by `RhythmSpine.beatsFor` ' +
      'and `PunchAvatarCard`. Jest enforces manifest coverage for every phrase ' +
      'the samples reference and pins the vocab offset to ≤ 25 ms tolerance.',
  },
  {
    key: 'A14',
    title: 'A14 · pace-pusher authors 60-beat bursts over the 40-beat ceiling',
    priority: 'P2',
    size: 'XS',
    body:
      "`roundFill.ts:61` caps generated bursts at 40 beats. `pace-pusher` " +
      'authors 60-beat bursts at `pacePusher.ts:34, 45` — 30.0 s windows, ' +
      'the two longest measured silence gaps.\n\n' +
      "**Fix:** shorten the offending blocks to ≤ 40 beats or lift the " +
      'ceiling with a written justification.',
  },
]

const runGh = async (args, opts = {}) => {
  if (DRY) {
    console.log('[dry]', 'gh', args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '))
    return { stdout: '', stderr: '' }
  }
  return execFile('gh', args, { maxBuffer: 32 * 1024 * 1024, ...opts })
}

async function findIssueByTitle(title) {
  if (DRY) return null
  const { stdout } = await execFile('gh', [
    'issue', 'list',
    '--repo', REPO,
    '--search', `"${title}" in:title`,
    '--state', 'all',
    '--limit', '25',
    '--json', 'number,title,url,id',
  ], { maxBuffer: 16 * 1024 * 1024 })
  const list = JSON.parse(stdout || '[]')
  const hit = list.find((i) => i.title === title)
  return hit ?? null
}

async function ensureIssue({ title, body, labels, priority, size }) {
  const existing = await findIssueByTitle(title)
  if (existing) {
    console.log(`  found #${existing.number} : ${title}`)
    return existing
  }
  const args = ['issue', 'create', '--repo', REPO, '--title', title, '--body', body,
    '--milestone', MILESTONE_TITLE]
  // `labels` may already include the priority (parent case); dedupe.
  const merged = Array.from(new Set([...labels, priority]))
  for (const l of merged) args.push('--label', l)
  const { stdout } = await runGh(args)
  const url = (stdout || '').trim().split('\n').pop() || ''
  const num = Number(url.split('/').pop())
  const { stdout: node } = DRY
    ? { stdout: 'DRY_NODE' }
    : await execFile('gh', ['api', `repos/${REPO}/issues/${num}`, '--jq', '.node_id'])
  const item = { number: num, url, id: node.trim(), _created: true }
  console.log(`  created #${num} : ${title}`)
  return item
}

async function addSubIssue(parentId, childId) {
  if (DRY) {
    console.log(`[dry] addSubIssue parent=${parentId} child=${childId}`)
    return
  }
  const query =
    'mutation($parent:ID!, $child:ID!) { addSubIssue(input:{issueId:$parent, subIssueId:$child}) { issue { id } } }'
  try {
    await execFile('gh', ['api', 'graphql', '-f', `query=${query}`, '-f', `parent=${parentId}`, '-f', `child=${childId}`])
  } catch (e) {
    const msg = String(e.stderr || e.message)
    if (msg.includes('already a sub-issue') || msg.includes('duplicate')) return
    throw e
  }
}

async function addToProject(issueUrl) {
  if (DRY) {
    console.log(`[dry] project item-add ${issueUrl}`)
    return 'DRY_ITEM'
  }
  const { stdout } = await execFile('gh', [
    'project', 'item-add', String(PROJECT_NUM),
    '--owner', OWNER,
    '--url', issueUrl,
    '--format', 'json',
  ])
  return JSON.parse(stdout).id
}

async function setSingleSelect(itemId, fieldId, optId) {
  if (DRY) {
    console.log(`[dry] item-edit ${itemId} field=${fieldId} opt=${optId}`)
    return
  }
  await execFile('gh', [
    'project', 'item-edit',
    '--project-id', PROJECT_ID,
    '--id', itemId,
    '--field-id', fieldId,
    '--single-select-option-id', optId,
  ])
}

async function setIteration(itemId, fieldId, iterId) {
  if (DRY) {
    console.log(`[dry] item-edit ${itemId} field=${fieldId} iter=${iterId}`)
    return
  }
  await execFile('gh', [
    'project', 'item-edit',
    '--project-id', PROJECT_ID,
    '--id', itemId,
    '--field-id', fieldId,
    '--iteration-id', iterId,
  ])
}

async function applyBoardFields(issueUrl, priority, size) {
  const itemId = await addToProject(issueUrl)
  await setSingleSelect(itemId, FIELD.Phase, OPT.Phase5)
  await setSingleSelect(itemId, FIELD.Area, OPT.AreaPuncheokie)
  await setSingleSelect(itemId, FIELD.Priority, OPT[priority])
  const sizeOpt = { XS: OPT.SizeXS, S: OPT.SizeS, M: OPT.SizeM, L: OPT.SizeL }[size]
  if (sizeOpt) await setSingleSelect(itemId, FIELD.Size, sizeOpt)
  await setIteration(itemId, FIELD.Sprint, SPRINT1_ITER)
}

async function main() {
  console.log(`Repo: ${REPO}  milestone: #${MILESTONE_NUM}  project: #${PROJECT_NUM}`)
  if (DRY) console.log('(dry-run: no GitHub writes)\n')

  console.log('\nparent:')
  const parent = await ensureIssue(PARENT)
  await applyBoardFields(parent.url, PARENT.priority, PARENT.size)

  console.log('\nsub-issues:')
  for (const sub of SUBS) {
    const issue = await ensureIssue({
      title: sub.title,
      body: sub.body,
      labels: BASE_LABELS,
      priority: sub.priority,
      size: sub.size,
    })
    await addSubIssue(parent.id, issue.id)
    await applyBoardFields(issue.url, sub.priority, sub.size)
  }

  console.log(`\ndone: ${1 + SUBS.length} items (1 parent + ${SUBS.length} sub-issues)`)
}

main().catch((e) => {
  console.error('failed:', e.stderr || e.message)
  process.exit(1)
})
