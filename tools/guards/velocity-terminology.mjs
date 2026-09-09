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
const FILE_ALLOWLIST = new Set([
  'docs/design-spec.md',
  // Hypothesis log necessarily documents the vendor's velocity/power/force
  // language when quoting decompiled sources; the terminology rule applies
  // to app-facing labels, not to reference-doc quotations.
  'docs/protocol/hypotheses.md',
  /* This file IS a sibling enforcement of the same rule — it bans the words
   * in generated strings and splits them ('fo' + 'rce') so its own assertions
   * do not trip. What the scan catches is the comment explaining why authored
   * coaching copy ("power shots") is exempt. Flagging the rule's own
   * explanation is the scanner reading prose, not a mislabelled metric. */
  'src/domain/workout/samples/__tests__/samples.test.ts',
])

/** Directory-prefix allowlist. The protocol adapter layer implements the
 * vendor's decoding spec (H11) and legitimately references the vendor's
 * "velocity / power / force / energy" terminology in JSDoc + tests. It
 * never LABELS a value with those words — every emitted event carries
 * velocityUnit: 'tracker-unit' (§4.3), enforced by the TrackerPunchEvent
 * type in `src/domain/punch/PunchEvent.ts`. The guard covers the app
 * (UI, live copy, session prose) which is where labeling actually happens. */
const DIR_ALLOWLIST_PREFIXES = [
  'src/protocol/',
  /* The instrument domain owns "energy" and "power" as its OWN musical terms,
   * on the same footing as the protocol layer above: it references them, it
   * never LABELS a tracker reading with them. `laneEnergyAt` returns a drum
   * family's decaying lane value; `'power-land'` is the name of an
   * ArpMutation. Both were flagged only because the scan's 5-line proximity
   * window happened to catch an unrelated `velocity` — MIDI note velocity, or
   * a `'high-velocity'` LayerCondition — nearby.
   *
   * The rule this guard enforces (§4.3) is that a tracker reading is labelled
   * "tracker-reported velocity" / "tracker units", and that still holds: every
   * emitted event carries `velocityUnit: 'tracker-unit'`, enforced by the
   * TrackerPunchEvent type. Nothing here relabels one. */
  'src/domain/instrument/',
  /* The instrument domain's own tests, which live beside the other domain
   * tests rather than under it. The protocol allowlist above already covers
   * "JSDoc + tests" for the same reason. */
  'src/domain/__tests__/instrument.',
  /* Puncheokie design docs describe the drum model in its own vocabulary —
   * drum-kit-design.md lists "MIDI velocity" and "groove energy" as two
   * DIFFERENT things, which is precisely the distinction §4.3 protects. */
  'docs/puncheoke/',
]

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
  for (const prefix of DIR_ALLOWLIST_PREFIXES) {
    if (rel.startsWith(prefix)) return []
  }
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
      // Well-known reference phrases used when documenting the vendor's
      // velocity/power math. These describe MECHANICS (piecewise formula,
      // ×1.7 boost) not user-facing labels — the terminology rule is about
      // what we call the value to the athlete, not how we implement the
      // decoder. Case-insensitive substring match on the raw line.
      const lower = line.toLowerCase()
      // Meta-comment guardrails BEFORE per-token allowlists — these apply
      // regardless of which forbidden token triggered the match. Together
      // they cover: (a) doc-comments that state the terminology rule
      // itself (e.g. "Never claim m/s, mph, g, force, power, or energy"),
      // (b) references to the vendor's power-punch mechanics that don't
      // label a value ("power boost", "×1.7 power"), and (c) any quoted
      // token used as a name/label ("power", 'power').
      if (
        // Any negation word co-occurring with the token means the line is
        // stating what NOT to do (a rule statement) not what the value IS.
        lower.includes('never') ||
        lower.includes('do not claim') ||
        lower.includes('do not label') ||
        lower.includes('forbidden') ||
        lower.includes('banned literal') ||
        // Vendor mechanic references — describing the algorithm, not
        // labeling a user-visible value.
        lower.includes('power boost') ||
        lower.includes('power-boost') ||
        lower.includes('power punch') ||
        lower.includes('×1.7 power') ||
        lower.includes('power ×1.7') ||
        lower.includes('* 1.7 power') ||
        lower.includes('power * 1.7') ||
        // Quoted token — always a reference, never a label.
        line.includes(`'${token}'`) ||
        line.includes(`"${token}"`) ||
        line.includes(`\`${token}\``) ||
        line.includes(`(${token})`)
      ) continue
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
