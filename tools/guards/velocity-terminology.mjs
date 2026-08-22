#!/usr/bin/env node
// Velocity-terminology guard (§4.3).
// Fails if we mislabel tracker-reported velocity as impact/force/power/energy.
// Scoped to velocity-adjacent context per the per-finding rule.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'src'),
  path.join(REPO_ROOT, 'docs'),
  path.join(REPO_ROOT, 'app.config.ts'),
]
const EXTS = new Set(['.ts', '.tsx', '.md'])
const CONTEXT_WINDOW = 5
const SKIP_DIRS = new Set([
  'node_modules',
  'android',
  'ios',
  'dist',
  '.expo',
  'coverage',
  'artifacts',
  'captures',
  'tools',
  '.git',
])
const FILE_ALLOWLIST = new Set(['docs/design-spec.md'])

const HARD_LITERALS = [
  { pattern: /impact speed/i, label: '"impact speed"' },
  { pattern: /punch strength/i, label: '"punch strength"' },
]

const CONTEXTUAL_TOKEN = /\b(force|power|energy)\b/gi
const VELOCITY_TOKEN = /velocity/i

// Allowlist: `'power'` as a punchType enum literal (§12.5).
// Match a string literal 'power' or "power" on a line that also references punchType.
const PUNCH_TYPE_ALLOWLIST = /(['"])power\1/
const PUNCH_TYPE_CONTEXT = /\b(?:punchType|PunchType)\b/

async function collectFiles(target) {
  const out = []
  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return out
  }
  if (stat.isFile()) {
    if (EXTS.has(path.extname(target))) out.push(target)
    return out
  }
  if (!stat.isDirectory()) return out
  let entries
  try {
    entries = await fs.readdir(target, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue
      out.push(...(await collectFiles(full)))
    } else if (entry.isFile() && EXTS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

function inPunchTypeContext(lines, idx) {
  const lo = Math.max(0, idx - CONTEXT_WINDOW)
  const hi = Math.min(lines.length - 1, idx + CONTEXT_WINDOW)
  let hasPunchType = false
  let hasQuotedPower = false
  for (let i = lo; i <= hi; i++) {
    const line = lines[i]
    if (PUNCH_TYPE_CONTEXT.test(line)) hasPunchType = true
    if (PUNCH_TYPE_ALLOWLIST.test(line)) hasQuotedPower = true
  }
  return hasPunchType && hasQuotedPower
}

function hasVelocityNearby(lines, idx) {
  const lo = Math.max(0, idx - CONTEXT_WINDOW)
  const hi = Math.min(lines.length - 1, idx + CONTEXT_WINDOW)
  for (let i = lo; i <= hi; i++) {
    if (VELOCITY_TOKEN.test(lines[i])) return true
  }
  return false
}

async function scanFile(file) {
  const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/')
  if (FILE_ALLOWLIST.has(rel)) return []
  const source = await fs.readFile(file, 'utf8')
  const lines = source.split(/\r?\n/)
  const violations = []

  lines.forEach((line, idx) => {
    for (const rule of HARD_LITERALS) {
      if (rule.pattern.test(line)) {
        violations.push({ file: rel, line: idx + 1, message: `banned literal ${rule.label}` })
      }
    }

    CONTEXTUAL_TOKEN.lastIndex = 0
    let match
    while ((match = CONTEXTUAL_TOKEN.exec(line)) !== null) {
      const token = match[1].toLowerCase()
      if (!hasVelocityNearby(lines, idx)) continue
      if (token === 'power' && inPunchTypeContext(lines, idx)) continue
      violations.push({
        file: rel,
        line: idx + 1,
        message: `token \`${token}\` used near a velocity reference (label velocity as "tracker-reported velocity" or "tracker units")`,
      })
    }
  })

  return violations
}

async function main() {
  const files = []
  for (const root of SCAN_ROOTS) {
    files.push(...(await collectFiles(root)))
  }
  const all = []
  for (const f of files) {
    all.push(...(await scanFile(f)))
  }
  if (all.length === 0) {
    console.log('no velocity-terminology violations found')
    process.exit(0)
  }
  console.error(`velocity-terminology guard: ${all.length} violation(s)`)
  for (const v of all) {
    console.error(`  ${v.file}:${v.line}  ${v.message}`)
  }
  process.exit(1)
}

main().catch((err) => {
  console.error('velocity-terminology guard crashed:', err)
  process.exit(2)
})
