/**
 * Dependency direction, enforced across the whole domain (spec §15.1, §18.3).
 *
 * `src/domain/**` is the layer everything else points at. It must not reach
 * back out — no React, no React Native, no Expo, no SQLite, no BLE, no
 * store, no components. The rule is easy to state and easy to break by
 * accident: a single convenient import inverts the direction, and the
 * failure is invisible until something tries to run this code outside a
 * React tree.
 *
 * There was already a purity block, but it named one file. Every new domain
 * module was ungated until someone remembered to copy it — so this walks
 * the directory instead. A file added tomorrow is covered by existing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DOMAIN_ROOT = 'src/domain'

function domainSources(dir = DOMAIN_ROOT): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      // Tests may use anything — they are not the shipped dependency graph.
      if (entry === '__tests__') continue
      found.push(...domainSources(path))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      found.push(path)
    }
  }
  return found
}

const SOURCES = domainSources()

/**
 * Strip comments before scanning.
 *
 * Without this the gate is worse than useless: several domain modules
 * document their own discipline with lines like "no `Date.now()` here", and
 * a scanner that reads prose flags the very files that got it right.
 *
 * `://` is spared so a URL in code survives.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Any `import ... from '<spec>'` / `require('<spec>')` target in the file. */
function importTargets(source: string): string[] {
  const targets: string[] = []
  const pattern = /(?:from|require\()\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) targets.push(match[1])
  }
  return targets
}

const FORBIDDEN: Array<{ label: string; test: (target: string) => boolean }> = [
  { label: 'react', test: (t) => t === 'react' || t.startsWith('react/') },
  { label: 'react-native', test: (t) => t === 'react-native' || t.startsWith('react-native') },
  { label: 'expo', test: (t) => t === 'expo' || t.startsWith('expo-') || t.startsWith('expo/') },
  { label: 'sqlite', test: (t) => /sqlite/i.test(t) },
  { label: 'ble', test: (t) => /(^|\/)ble\//i.test(t) || t.startsWith('@ble') },
  { label: 'storage', test: (t) => t.startsWith('@storage') || /\/storage\//.test(t) },
  { label: 'audio', test: (t) => t.startsWith('@audio') || /\/audio\//.test(t) },
  { label: 'components', test: (t) => t.startsWith('@components') || /\/components\//.test(t) },
  { label: 'state', test: (t) => t.startsWith('@state') || /\/state\//.test(t) },
]

// ---------------------------------------------------------------------------

describe('the domain layer imports nothing outward (spec §15.1)', () => {
  it('found the domain sources to check', () => {
    // A broken walk would make every assertion below vacuously pass.
    expect(SOURCES.length).toBeGreaterThan(20)
  })

  it.each(SOURCES)('%s imports no infrastructure', (file) => {
    const targets = importTargets(stripComments(readFileSync(file, 'utf8')))
    const violations = targets.filter((t) => FORBIDDEN.some((rule) => rule.test(t)))
    expect(violations).toEqual([])
  })
})

/**
 * The one sanctioned exception.
 *
 * `MonotonicClock` is the adapter every other domain module injects instead
 * of reading time itself — so it is the single place a real clock may be
 * touched. Named here rather than skipped silently: if a second file ever
 * needs an exemption, that is a design conversation, not a list edit.
 */
const CLOCK_ADAPTER = join('src', 'domain', 'time', 'MonotonicClock.ts')

describe('the domain layer reads no clock of its own (spec §3.2, §18.3)', () => {
  it('has exactly one exempt clock adapter, and it exists', () => {
    expect(SOURCES).toContain(CLOCK_ADAPTER)
  })

  // Monotonic time is injected as a `MonotonicClock`; wall time belongs to
  // display and export. A `Date.now()` here would reorder a session the
  // first time the system clock moved.
  it.each(SOURCES.filter((f) => f !== CLOCK_ADAPTER))(
    '%s calls no ambient time or randomness source',
    (file) => {
      const source = stripComments(readFileSync(file, 'utf8'))
      const found = [
        /\bDate\.now\(/.test(source) ? 'Date.now()' : null,
        /\bnew Date\(\s*\)/.test(source) ? 'new Date()' : null,
        /\bperformance\.now\(/.test(source) ? 'performance.now()' : null,
        /\bMath\.random\(/.test(source) ? 'Math.random()' : null,
      ].filter(Boolean)
      expect(found).toEqual([])
    },
  )
})
