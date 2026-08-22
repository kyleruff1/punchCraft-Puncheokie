#!/usr/bin/env node
/**
 * setup-project.mjs — idempotent setup for the PunchLab · Puncheokie GitHub Project (v2).
 *
 * Uses only the authenticated `gh` CLI. No npm dependencies.
 *
 * What it does (safe to re-run):
 *   1) Find or create the user project by title (tools/backlog/backlog-static.json → project.title).
 *   2) Link the project to the repository (owner + repo taken from --repo or git remote origin).
 *   3) Ensure the four single-select fields exist (Phase, Area, Priority, Size) with the option lists.
 *   4) Ensure the Sprint iteration field exists (via GraphQL) with the configured iterations.
 *   5) Ensure the four views exist (Sprint board / Roadmap / Epics / Timeline) with the right layouts.
 *   6) Write tools/backlog/project.json capturing project id/number/URL + field/option/iteration ids
 *      for later use by seed.mjs.
 *
 * Flags:
 *   --owner <login>   default "@me"
 *   --repo <owner/repo>  default: parsed from `git remote get-url origin` (falls back to
 *                        kyleruff1/PunchLab-Puncheokie)
 *   --dry-run         print planned actions; do not mutate
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKLOG_DIR = __dirname
const STATIC = JSON.parse(readFileSync(join(BACKLOG_DIR, 'backlog-static.json'), 'utf8'))
const OUT_PATH = join(BACKLOG_DIR, 'project.json')

const args = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--dry-run') args.set('dry-run', true)
  else if (a.startsWith('--')) args.set(a.slice(2), process.argv[++i])
}
const OWNER = args.get('owner') || '@me'
const DRY_RUN = !!args.get('dry-run')
let REPO = args.get('repo')
if (!REPO) {
  const url = sh(['git', 'remote', 'get-url', 'origin'], { allowFail: true }).stdout.trim()
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/)
  REPO = m ? `${m[1]}/${m[2]}` : 'kyleruff1/PunchLab-Puncheokie'
}
const [REPO_OWNER, REPO_NAME] = REPO.split('/')

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n$ ${cmd.join(' ')}\nEXIT ${r.status}\n${r.stderr || r.stdout}`)
    process.exit(r.status || 1)
  }
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status }
}

function gh(argv, opts = {}) {
  return sh(['gh', ...argv], opts)
}

function ghJson(argv, opts = {}) {
  const r = gh(argv, opts)
  if (!r.stdout.trim()) return null
  try { return JSON.parse(r.stdout) } catch { return null }
}

function graphql(query, variables = {}) {
  const argv = ['api', 'graphql', '-f', `query=${query}`]
  for (const [k, v] of Object.entries(variables)) {
    if (typeof v === 'string') argv.push('-f', `${k}=${v}`)
    else if (typeof v === 'number' && Number.isInteger(v)) argv.push('-F', `${k}=${v}`)
    else argv.push('-f', `${k}=${JSON.stringify(v)}`)
  }
  return ghJson(argv)
}

function log(...a) { console.log('[setup-project]', ...a) }

async function main() {
  log(`Owner: ${OWNER}   Repo: ${REPO}   Dry-run: ${DRY_RUN}`)

  const title = STATIC.project.title
  const projects = ghJson(['project', 'list', '--owner', OWNER, '--limit', '100', '--format', 'json'])
  const projectList = projects?.projects || []
  let project = projectList.find(p => p.title === title)

  if (!project) {
    if (DRY_RUN) { log(`DRY-RUN would create project ${title}`); return }
    log(`Creating project ${title}`)
    const created = ghJson(['project', 'create', '--owner', OWNER, '--title', title, '--format', 'json'])
    project = created
  } else {
    log(`Project ${title} already exists (number ${project.number})`)
  }

  // Link to repo (idempotent — gh reports success even if already linked)
  if (!DRY_RUN) {
    const link = gh(['project', 'link', String(project.number), '--owner', OWNER, '--repo', REPO_NAME], { allowFail: true })
    if (link.status === 0) log(`Linked project to repo ${REPO_NAME}`)
    else log(`Link warning (may already be linked): ${(link.stderr || link.stdout).trim()}`)
  }

  // List fields to know what's already there
  let fields = ghJson(['project', 'field-list', String(project.number), '--owner', OWNER, '--limit', '100', '--format', 'json'])
  const existingByName = new Map()
  for (const f of fields?.fields || []) existingByName.set(f.name, f)

  const fieldRecords = {}

  for (const spec of STATIC.project.singleSelectFields) {
    if (existingByName.has(spec.name)) {
      const f = existingByName.get(spec.name)
      log(`Field ${spec.name} exists (${f.id})`)
      fieldRecords[spec.name] = { id: f.id, options: byNameOptions(f.options) }
      continue
    }
    if (DRY_RUN) { log(`DRY-RUN would create single-select field ${spec.name}`); continue }
    log(`Creating single-select field ${spec.name}`)
    const optionsCsv = spec.options.map(o => o.name).join(',')
    const created = ghJson(['project', 'field-create', String(project.number), '--owner', OWNER, '--name', spec.name, '--data-type', 'SINGLE_SELECT', '--single-select-options', optionsCsv, '--format', 'json'])
    fieldRecords[spec.name] = { id: created.id, options: byNameOptions(created.options || []) }
  }

  // Sprint iteration field (via GraphQL — CLI can't create ITERATION fields)
  if (existingByName.has('Sprint')) {
    const f = existingByName.get('Sprint')
    log(`Field Sprint exists (${f.id})`)
    fieldRecords.Sprint = { id: f.id, iterations: byTitleIterations(f.configuration?.iterations || f.iterations || []) }
  } else if (!DRY_RUN) {
    log(`Creating iteration field Sprint`)
    const iters = STATIC.project.iteration.iterations.map(it => ({
      title: it.title,
      startDate: it.startDate,
      duration: STATIC.project.iteration.durationDays,
    }))
    const config = {
      startDate: STATIC.project.iteration.startDate,
      duration: STATIC.project.iteration.durationDays,
      iterations: iters,
    }
    const query = `mutation($projectId:ID!, $config:ProjectV2IterationFieldConfigurationInput!){
      createProjectV2Field(input:{projectId:$projectId, dataType:ITERATION, name:"Sprint", iterationConfiguration:$config}){
        projectV2Field { ... on ProjectV2IterationField { id name configuration { iterations { id title startDate duration } } } }
      }
    }`
    const result = graphql(query, { projectId: project.id, config })
    const fld = result?.data?.createProjectV2Field?.projectV2Field
    if (!fld) throw new Error('Iteration field creation returned no field: ' + JSON.stringify(result))
    fieldRecords.Sprint = { id: fld.id, iterations: byTitleIterations(fld.configuration?.iterations || []) }
  } else {
    log('DRY-RUN would create iteration field Sprint')
  }

  // Refresh field list so we see everything for view creation
  fields = ghJson(['project', 'field-list', String(project.number), '--owner', OWNER, '--limit', '100', '--format', 'json'])
  const idByName = new Map()
  for (const f of fields?.fields || []) idByName.set(f.name, f.id)

  // Views
  const viewsQ = `query($id:ID!){ node(id:$id){ ... on ProjectV2 { views(first:50){ nodes { id name } } } } }`
  const viewsResp = graphql(viewsQ, { id: project.id })
  const existingViews = new Map()
  for (const v of viewsResp?.data?.node?.views?.nodes || []) existingViews.set(v.name, v.id)

  for (const v of STATIC.project.views) {
    if (existingViews.has(v.name)) { log(`View ${v.name} exists`); continue }
    if (DRY_RUN) { log(`DRY-RUN would create view ${v.name} (${v.layout})`); continue }
    log(`Creating view ${v.name} (${v.layout})`)
    const query = `mutation($projectId:ID!, $name:String!, $layout:ProjectV2ViewLayout!){
      createProjectV2View(input:{projectId:$projectId, name:$name, layout:$layout}){
        projectV2View { id name }
      }
    }`
    const res = graphql(query, { projectId: project.id, name: v.name, layout: v.layout })
    if (!res?.data?.createProjectV2View) console.error('View creation warning:', JSON.stringify(res))
  }

  const url = project.url || `https://github.com/users/${projectOwnerLoginFrom(project)}/projects/${project.number}`
  const record = {
    project: {
      id: project.id,
      number: project.number,
      title: project.title,
      url,
      owner: OWNER,
      repo: REPO,
    },
    fields: fieldRecords,
  }
  if (!DRY_RUN) {
    writeFileSync(OUT_PATH, JSON.stringify(record, null, 2))
    log(`Wrote ${OUT_PATH}`)
  }
  log(`Project URL: ${url}`)
}

function byNameOptions(list) {
  const out = {}
  for (const o of list) out[o.name] = { id: o.id, color: o.color }
  return out
}

function byTitleIterations(list) {
  const out = {}
  for (const it of list) out[it.title] = { id: it.id, startDate: it.startDate, duration: it.duration }
  return out
}

function projectOwnerLoginFrom(project) {
  return project.owner?.login || project.owner || 'unknown'
}

main().catch(err => { console.error(err); process.exit(1) })
