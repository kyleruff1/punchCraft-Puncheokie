#!/usr/bin/env node
/**
 * seed.mjs — idempotent seeder for labels, milestones, epics, task/story/spike issues,
 * sub-issue relationships, project items, and project field values.
 *
 * Uses only the authenticated `gh` CLI. No npm dependencies.
 *
 * Inputs:
 *   tools/backlog/backlog-static.json   — labels, milestones, project fields
 *   tools/backlog/backlog-issues.json   — { fragments: [...] } from the punchlab-backlog workflow
 *                                          (one fragment per phase; see workflow schema)
 *   tools/backlog/project.json          — written by setup-project.mjs
 *
 * Order (each step is safe to re-run; existing objects are matched by exact title):
 *   1) Labels                       — gh label create --force
 *   2) Milestones                   — POST /repos/:owner/:repo/milestones (skip if title exists)
 *   3) Epics (issues, label epic)   — gh issue create
 *   4) Task/story/spike issues      — gh issue create
 *   5) Sub-issue links              — GraphQL addSubIssue (idempotent when parent already linked)
 *   6) Project items                — gh project item-add (idempotent)
 *   7) Project field values         — gh project item-edit for each field
 *
 * Flags:
 *   --repo <owner/repo>
 *   --dry-run
 *   --skip-project   (only creates labels + milestones + issues + sub-issues; no project ops)
 *   --sleep <ms>     (default 350ms between mutations)
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKLOG_DIR = __dirname

const args = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--dry-run' || a === '--skip-project') args.set(a.slice(2), true)
  else if (a.startsWith('--')) args.set(a.slice(2), process.argv[++i])
}
const DRY_RUN = !!args.get('dry-run')
const SKIP_PROJECT = !!args.get('skip-project')
const SLEEP_MS = Number(args.get('sleep') || 350)

const STATIC = JSON.parse(readFileSync(join(BACKLOG_DIR, 'backlog-static.json'), 'utf8'))
const ISSUES_FILE = join(BACKLOG_DIR, 'backlog-issues.json')
if (!existsSync(ISSUES_FILE)) {
  console.error(`[seed] ${ISSUES_FILE} not found. Run the punchlab-backlog workflow first and write the merged result there.`)
  process.exit(2)
}
const ISSUES_DOC = JSON.parse(readFileSync(ISSUES_FILE, 'utf8'))
const FRAGMENTS = (ISSUES_DOC.fragments || []).filter(Boolean)
if (FRAGMENTS.length !== 8) {
  console.error(`[seed] Expected 8 phase fragments, got ${FRAGMENTS.length}. Aborting.`)
  process.exit(2)
}
let PROJECT = null
const PROJECT_FILE = join(BACKLOG_DIR, 'project.json')
if (!SKIP_PROJECT) {
  if (!existsSync(PROJECT_FILE)) {
    console.error(`[seed] ${PROJECT_FILE} not found. Run setup-project.mjs first, or pass --skip-project.`)
    process.exit(2)
  }
  PROJECT = JSON.parse(readFileSync(PROJECT_FILE, 'utf8'))
}

let REPO = args.get('repo')
if (!REPO) {
  const url = sh(['git', 'remote', 'get-url', 'origin'], { allowFail: true }).stdout.trim()
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/)
  REPO = m ? `${m[1]}/${m[2]}` : 'kyleruff1/PunchLab-Puncheokie'
}
const [REPO_OWNER, REPO_NAME] = REPO.split('/')
const OWNER = PROJECT?.project?.owner || '@me'

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n$ ${cmd.join(' ')}\nEXIT ${r.status}\n${r.stderr || r.stdout}`)
    process.exit(r.status || 1)
  }
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status }
}

function gh(argv, opts = {}) { return sh(['gh', ...argv], opts) }
function ghJson(argv, opts = {}) {
  const r = gh(argv, opts)
  if (r.status !== 0) return null
  if (!r.stdout.trim()) return null
  try { return JSON.parse(r.stdout) } catch { return null }
}

async function ghRetry(argv, opts = {}) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = gh(argv, { ...opts, allowFail: true })
    if (r.status === 0) return r
    const msg = (r.stderr || r.stdout).toLowerCase()
    const isRate = /(rate limit|secondary rate|abuse|429|403)/.test(msg)
    if (!isRate || attempt === 5) {
      if (!opts.allowFail) {
        console.error(`\n$ gh ${argv.join(' ')}\nEXIT ${r.status}\n${r.stderr || r.stdout}`)
        process.exit(r.status || 1)
      }
      return r
    }
    const wait = Math.min(60_000, 2000 * 2 ** (attempt - 1))
    console.log(`[seed] rate-limit backoff ${wait}ms (attempt ${attempt})`)
    await delay(wait)
  }
}

function graphql(query, variables = {}) {
  const argv = ['api', 'graphql', '-f', `query=${query}`]
  for (const [k, v] of Object.entries(variables)) {
    if (typeof v === 'string') argv.push('-f', `${k}=${v}`)
    else if (typeof v === 'number' && Number.isInteger(v)) argv.push('-F', `${k}=${v}`)
    else argv.push('-f', `${k}=${JSON.stringify(v)}`)
  }
  return ghJson(argv, { allowFail: true })
}

function log(...a) { console.log('[seed]', ...a) }

const summary = { labels: {c:0,s:0}, milestones: {c:0,s:0}, epics: {c:0,s:0}, issues: {c:0,s:0}, subIssues: {c:0,s:0}, projectItems: {c:0,s:0}, fieldSets: {c:0,s:0} }

// ---------- 1) LABELS ----------
async function seedLabels() {
  for (const l of STATIC.labels) {
    if (DRY_RUN) { log(`DRY-RUN label ${l.name}`); continue }
    const r = await ghRetry(['label', 'create', l.name, '--repo', REPO, '--color', l.color, '--description', l.description, '--force'], { allowFail: true })
    if (r.status === 0) { summary.labels.c++; log(`Label ${l.name}`) }
    else if (/already exists/i.test(r.stderr)) { summary.labels.s++ }
    else console.error(`Label ${l.name} failed: ${r.stderr}`)
    await delay(SLEEP_MS)
  }
}

// ---------- 2) MILESTONES ----------
async function seedMilestones() {
  const existing = ghJson(['api', `repos/${REPO}/milestones?state=all&per_page=100`]) || []
  const byTitle = new Map(existing.map(m => [m.title, m]))
  const byKey = new Map()
  for (const m of STATIC.milestones) {
    let ms = byTitle.get(m.title)
    if (ms) { summary.milestones.s++; byKey.set(m.key, ms); continue }
    if (DRY_RUN) { log(`DRY-RUN milestone ${m.title}`); continue }
    const argv = ['api', '-X', 'POST', `repos/${REPO}/milestones`, '-f', `title=${m.title}`, '-f', `description=${m.description || ''}`]
    if (m.due_on) argv.push('-f', `due_on=${m.due_on}`)
    const created = ghJson(argv, { allowFail: true })
    if (!created) { console.error(`Milestone ${m.title} creation failed`); continue }
    summary.milestones.c++
    byKey.set(m.key, created)
    log(`Milestone ${m.title} (#${created.number})`)
    await delay(SLEEP_MS)
  }
  return byKey
}

// ---------- helpers for issues ----------
function derivedLabels(issue, phaseIndex, isEpic = false) {
  const labels = new Set()
  labels.add(isEpic ? 'epic' : issue.type)
  labels.add(`phase:${phaseIndex}`)
  if (!isEpic) {
    labels.add(`area:${issue.areaSlug}`)
    labels.add(issue.priority)
    if (issue.sprint === 'sprint-1') labels.add('sprint-1')
    if (issue.hardwareRequired) labels.add('hardware-required')
    if (issue.goNoGo) labels.add('go-no-go')
    if (issue.policyReview) labels.add('policy-review')
  }
  return [...labels]
}

async function findOrCreateIssue({ title, body, labels, milestoneTitle }, allExisting) {
  const existing = allExisting.find(i => i.title === title)
  if (existing) return { number: existing.number, url: existing.url, nodeId: existing.node_id || null, created: false }
  if (DRY_RUN) { log(`DRY-RUN issue ${title}`); return { number: null, url: null, nodeId: null, created: false } }
  const argv = ['issue', 'create', '--repo', REPO, '--title', title, '--body', body]
  for (const l of labels) argv.push('--label', l)
  if (milestoneTitle) argv.push('--milestone', milestoneTitle)
  const r = await ghRetry(argv, { allowFail: true })
  if (r.status !== 0) { console.error(`Issue ${title} failed: ${r.stderr}`); return null }
  const url = r.stdout.trim().split('\n').pop()
  const num = Number(url.split('/').pop())
  return { number: num, url, nodeId: null, created: true }
}

async function fetchIssueNodeId(number) {
  const r = ghJson(['api', `repos/${REPO}/issues/${number}`, '--jq', '{node_id, number, title}'], { allowFail: true })
  return r?.node_id || null
}

async function listAllIssues() {
  const r = ghJson(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '500', '--json', 'number,title,url,labels'])
  return r || []
}

// ---------- 3) EPICS ----------
async function seedEpics(msByKey, allExisting) {
  const result = new Map() // phaseIndex -> {number,url,nodeId}
  for (const frag of FRAGMENTS) {
    const phase = frag.phase
    const title = frag.epic.title
    // Milestone: pick this phase's first milestone as the epic's milestone anchor (optional; leave null to skip)
    const info = await findOrCreateIssue({
      title,
      body: frag.epic.body,
      labels: derivedLabels(null, phase, true),
      milestoneTitle: null,
    }, allExisting)
    if (!info) continue
    if (info.created) { summary.epics.c++; log(`Epic ${title}`) } else { summary.epics.s++ }
    info.nodeId ||= await fetchIssueNodeId(info.number)
    result.set(phase, info)
    if (info.created) await delay(SLEEP_MS)
  }
  return result
}

// ---------- 4) ISSUES ----------
async function seedIssues(msByKey, epicByPhase, allExisting) {
  const created = [] // {frag, issue, ghInfo}
  for (const frag of FRAGMENTS) {
    for (const issue of frag.issues) {
      const title = `${issue.key} ${issue.title}`
      const ms = msByKey.get(issue.milestoneKey)
      const labels = derivedLabels(issue, frag.phase, false)
      const bodyWithHeader = `> Milestone: **${issue.milestoneKey}** · Phase ${frag.phase} · Epic: ${frag.epic.title} · Area: ${STATIC.areaSlugToName[issue.areaSlug] || issue.areaSlug}\n\n${issue.body}`
      const info = await findOrCreateIssue({ title, body: bodyWithHeader, labels, milestoneTitle: ms?.title }, allExisting)
      if (!info) continue
      if (info.created) { summary.issues.c++; log(`Issue ${issue.key} ${issue.title.slice(0, 60)}`) } else { summary.issues.s++ }
      info.nodeId ||= await fetchIssueNodeId(info.number)
      created.push({ frag, issue, ghInfo: info })
      if (info.created) await delay(SLEEP_MS)
    }
  }
  return created
}

// ---------- 5) SUB-ISSUE LINKS ----------
async function linkSubIssues(created, epicByPhase) {
  const M = `mutation($parent:ID!, $child:ID!){ addSubIssue(input:{issueId:$parent, subIssueId:$child}){ issue { id } } }`
  for (const { frag, issue, ghInfo } of created) {
    const epic = epicByPhase.get(frag.phase)
    if (!epic?.nodeId || !ghInfo?.nodeId) continue
    if (DRY_RUN) { log(`DRY-RUN link ${issue.key} → PHASE${frag.phase}`); continue }
    const res = graphql(M, { parent: epic.nodeId, child: ghInfo.nodeId })
    if (res?.data?.addSubIssue) { summary.subIssues.c++; }
    else {
      const msg = JSON.stringify(res || {})
      if (/already a sub-?issue|already linked|parent/i.test(msg)) summary.subIssues.s++
      else console.error(`Sub-issue link failed for ${issue.key}: ${msg}`)
    }
    await delay(SLEEP_MS)
  }
}

// ---------- 6+7) PROJECT ITEMS + FIELD VALUES ----------
async function assignToProject(created) {
  if (SKIP_PROJECT || DRY_RUN) return
  const projectNumber = PROJECT.project.number
  const projectId = PROJECT.project.id
  const fields = PROJECT.fields || {}

  // Preload existing items so we can idempotently locate them
  const existingItems = ghJson(['project', 'item-list', String(projectNumber), '--owner', OWNER, '--limit', '500', '--format', 'json'])
  const itemByContentUrl = new Map()
  for (const it of existingItems?.items || []) {
    const url = it.content?.url || it['content.url'] || null
    if (url) itemByContentUrl.set(url, it)
  }

  for (const { frag, issue, ghInfo } of created) {
    if (!ghInfo?.url) continue
    let item = itemByContentUrl.get(ghInfo.url)
    if (!item) {
      const added = ghJson(['project', 'item-add', String(projectNumber), '--owner', OWNER, '--url', ghInfo.url, '--format', 'json'])
      if (!added) { console.error(`Project add failed for ${ghInfo.url}`); continue }
      item = added
      summary.projectItems.c++
    } else {
      summary.projectItems.s++
    }
    const itemId = item.id
    // Field values
    await setSingleSelect(itemId, projectId, fields, 'Phase', `Phase ${frag.phase}`)
    await setSingleSelect(itemId, projectId, fields, 'Area', STATIC.areaSlugToName[issue.areaSlug] || issue.areaSlug)
    await setSingleSelect(itemId, projectId, fields, 'Priority', issue.priority)
    await setSingleSelect(itemId, projectId, fields, 'Size', issue.size)
    if (issue.sprint === 'sprint-1') {
      const sprintField = fields.Sprint
      const iter = sprintField?.iterations?.['Sprint 1']
      if (sprintField?.id && iter?.id) {
        const r = gh(['project', 'item-edit', '--project-id', projectId, '--id', itemId, '--field-id', sprintField.id, '--iteration-id', iter.id], { allowFail: true })
        if (r.status === 0) summary.fieldSets.c++
      }
    }
    await delay(120)
  }
}

async function assignEpicsToProject(epicByPhase) {
  if (SKIP_PROJECT || DRY_RUN) return
  const projectNumber = PROJECT.project.number
  const projectId = PROJECT.project.id
  const fields = PROJECT.fields || {}
  const existingItems = ghJson(['project', 'item-list', String(projectNumber), '--owner', OWNER, '--limit', '500', '--format', 'json'])
  const itemByContentUrl = new Map()
  for (const it of existingItems?.items || []) {
    const url = it.content?.url || it['content.url'] || null
    if (url) itemByContentUrl.set(url, it)
  }
  for (const [phase, epic] of epicByPhase) {
    if (!epic?.url) continue
    let item = itemByContentUrl.get(epic.url)
    if (!item) {
      const added = ghJson(['project', 'item-add', String(projectNumber), '--owner', OWNER, '--url', epic.url, '--format', 'json'])
      if (!added) continue
      item = added
    }
    await setSingleSelect(item.id, projectId, fields, 'Phase', `Phase ${phase}`)
    await setSingleSelect(item.id, projectId, fields, 'Priority', 'P0')
    await setSingleSelect(item.id, projectId, fields, 'Size', 'L')
    await delay(120)
  }
}

async function setSingleSelect(itemId, projectId, fields, fieldName, optionName) {
  const f = fields[fieldName]
  if (!f?.id) return
  const opt = f.options?.[optionName]
  if (!opt?.id) { console.error(`Unknown ${fieldName} option: ${optionName}`); return }
  const r = gh(['project', 'item-edit', '--project-id', projectId, '--id', itemId, '--field-id', f.id, '--single-select-option-id', opt.id], { allowFail: true })
  if (r.status === 0) summary.fieldSets.c++
}

async function main() {
  log(`Repo: ${REPO}   Owner: ${OWNER}   Dry-run: ${DRY_RUN}   Skip-project: ${SKIP_PROJECT}`)
  await seedLabels()
  const msByKey = await seedMilestones()
  const allExistingBefore = await listAllIssues()
  const epicByPhase = await seedEpics(msByKey, allExistingBefore)
  const allExistingAfterEpics = await listAllIssues()
  const created = await seedIssues(msByKey, epicByPhase, allExistingAfterEpics)
  await linkSubIssues(created, epicByPhase)
  if (!SKIP_PROJECT) {
    await assignToProject(created)
    await assignEpicsToProject(epicByPhase)
  }
  console.log('\n[seed] Summary')
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(14)}: created ${v.c}, skipped/existing ${v.s}`)
}

main().catch(err => { console.error(err); process.exit(1) })
