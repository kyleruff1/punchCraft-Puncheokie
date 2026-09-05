/**
 * Metrics rail — the customization zone of the live layout (M32-07,
 * doc §19, D9).
 *
 * Five default metrics always show. Beyond those, the athlete picks
 * optional tiles from the doc §19 set of eight, and **at most four render**
 * (D9) — a rail that grew without a cap would turn the one glanceable
 * surface on the screen into something that has to be read.
 *
 * ## Velocity gating is structural, not cosmetic
 *
 * When the source cannot report velocity, every velocity-derived surface is
 * **absent from the tree**, not rendered empty or greyed. A greyed-out
 * "Avg velocity —" tells the athlete they are failing to produce a number;
 * the truth is the tracker cannot measure one (doc §3, M32-02). Absence is
 * the honest rendering.
 *
 * Terminology: velocity is always "tracker-reported velocity" in tracker
 * units — never a physical unit, and never force, output or exertion
 * (spec §4.3).
 *
 * Presentational only — no store, engine or clock imports.
 */
import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import { sequenceScoreLabel, type CapabilityTier } from '@domain/workout/capabilityTier'

export interface VelocityView {
  value: number
  unit: 'tracker-unit'
  label: 'tracker-reported velocity'
}

/** Exactly the doc §19 set of eight. */
export type TileId =
  | 'peak-velocity'
  | 'velocity-zone'
  | 'left-right-balance'
  | 'correct-hand-percent'
  | 'combo-completion'
  | 'punches-last-15s'
  | 'projected-final'
  | 'connection-completeness'

export const OPTIONAL_TILES: readonly TileId[] = [
  'peak-velocity',
  'velocity-zone',
  'left-right-balance',
  'correct-hand-percent',
  'combo-completion',
  'punches-last-15s',
  'projected-final',
  'connection-completeness',
]

/**
 * How many optional tiles render. Raised from D9's original four to the full
 * optional set — Kyle wants a metric-heavy screen, and the landscape tablet
 * rail scrolls, so the clutter concern D9 guarded against is a deliberate
 * trade here.
 */
export const MAX_OPTIONAL_TILES = 8

/** Tiles that cannot mean anything without tracker-reported velocity. */
const VELOCITY_TILES: ReadonlySet<TileId> = new Set<TileId>(['peak-velocity', 'velocity-zone'])

const TILE_TITLE: Record<TileId, string> = {
  'peak-velocity': 'Peak velocity',
  'velocity-zone': 'Velocity zone',
  'left-right-balance': 'Left / right',
  'correct-hand-percent': 'Correct hand',
  'combo-completion': 'Combo completion',
  'punches-last-15s': 'Last 15s',
  'projected-final': 'Projected final',
  'connection-completeness': 'Connection',
}

export interface MetricsRailProps {
  counts: { total: number; left: number; right: number }
  roundGoal?: number
  requiredPace?: number
  /** Punches per minute actually thrown so far — the rate achieved. */
  actualPace?: number
  avgVelocity?: VelocityView
  lastVelocity?: VelocityView
  velocityAvailable: boolean
  capabilityTier: CapabilityTier
  /** User-chosen; at most `MAX_OPTIONAL_TILES` render (D9). */
  tiles: TileId[]
  /**
   * Values for the optional tiles, keyed by id.
   *
   * Additive to the binding interface: most tiles have no source among the
   * other props, so without this they could only ever render an em dash.
   * M32-08 supplies what it has; anything missing shows an em dash rather
   * than a zero, because "not measured yet" and "zero" are different facts.
   */
  tileValues?: Partial<Record<TileId, string | number>>
}

const EM_DASH = '—'

function Metric(props: {
  label: string
  value: string
  caption?: string
  testID: string
  /** Type hierarchy (Kyle 2026-09-05): 'hero' matches the punch count's
   * figure size; 'large' is the second heading size; default is the body
   * figure. Accent colour stays the punch count's alone (`emphasis`). */
  scale?: 'hero' | 'large'
  emphasis?: boolean
}): React.JSX.Element {
  return (
    <View style={styles.metric} testID={props.testID}>
      <Text style={styles.metricLabel}>{props.label}</Text>
      <Text
        style={[
          styles.metricValue,
          props.scale === 'hero' && styles.metricValueHero,
          props.scale === 'large' && styles.metricValueLarge,
          props.emphasis && styles.metricValueAccent,
        ]}
      >
        {props.value}
      </Text>
      {props.caption ? <Text style={styles.metricCaption}>{props.caption}</Text> : null}
    </View>
  )
}

function MetricsRailInner(props: MetricsRailProps): React.JSX.Element {
  const {
    counts,
    roundGoal,
    requiredPace,
    actualPace,
    avgVelocity,
    lastVelocity,
    velocityAvailable,
    capabilityTier,
    tiles,
    tileValues,
  } = props

  // Drop velocity tiles before the cap, so a hidden tile does not consume
  // one of the athlete's four slots.
  const rendered = tiles
    .filter((id) => velocityAvailable || !VELOCITY_TILES.has(id))
    .slice(0, MAX_OPTIONAL_TILES)

  if (__DEV__ && tiles.length > MAX_OPTIONAL_TILES) {
    console.warn(
      `MetricsRail: ${tiles.length} tiles requested; rendering ${MAX_OPTIONAL_TILES} (D9).`,
    )
  }

  const valueFor = (id: TileId): string => {
    const supplied = tileValues?.[id]
    if (supplied !== undefined) return String(supplied)
    // Derivable from what the rail already has.
    if (id === 'left-right-balance') return `${counts.left} / ${counts.right}`
    return EM_DASH
  }

  const captionFor = (id: TileId): string | undefined =>
    // The tier decides what a hand-pattern score may be called; at every
    // tier this hardware reaches, that is "hand-sequence match" (D4).
    id === 'correct-hand-percent' ? sequenceScoreLabel(capabilityTier) : undefined

  return (
    // Scrolls: four optional tiles plus five defaults overflow a landscape
    // rail on a 1200px-tall tablet, and a clipped metric is worse than a
    // scrollable one.
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="metrics-rail"
    >
      <Metric
        testID="metric-punches"
        label="Punches"
        value={roundGoal === undefined ? String(counts.total) : `${counts.total} / ${roundGoal}`}
        scale="hero"
        emphasis
      />

      <Metric
        testID="metric-rate"
        label="Rate"
        value={actualPace === undefined ? EM_DASH : `${Math.round(actualPace)}/min`}
        caption="thrown so far"
      />

      <Metric
        testID="metric-required-pace"
        label="Required pace"
        value={requiredPace === undefined ? EM_DASH : `${Math.round(requiredPace)}/min`}
      />

      <Metric
        testID="metric-left-right"
        label="Left / right"
        value={`${counts.left} / ${counts.right}`}
        scale="large"
      />

      {velocityAvailable ? (
        <>
          <Metric
            testID="metric-avg-velocity"
            label="Avg velocity"
            value={avgVelocity === undefined ? EM_DASH : avgVelocity.value.toFixed(2)}
            caption="tracker-reported velocity"
          />
          <Metric
            testID="metric-last-velocity"
            label="Last velocity"
            value={lastVelocity === undefined ? EM_DASH : lastVelocity.value.toFixed(2)}
            caption="tracker-reported velocity"
            scale="hero"
          />
        </>
      ) : null}

      {rendered.length > 0 ? (
        <View style={styles.tiles} testID="optional-tiles">
          {rendered.map((id) => (
            <Metric
              key={id}
              testID={`tile-${id}`}
              label={TILE_TITLE[id]}
              value={valueFor(id)}
              // Peak velocity joins left/right on the second heading size
              // (Kyle 2026-09-05).
              {...(id === 'peak-velocity' ? { scale: 'large' as const } : {})}
              {...(captionFor(id) ? { caption: captionFor(id)! } : {})}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // Enlarged (Kyle 2026-09-05, markup: "enlarge this KPI box") — the rail
  // is the tablet's between-combinations read, so it grew a size class:
  // wider column, bigger figures, same motif.
  root: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    backgroundColor: colors.background,
    minWidth: 240,
    maxWidth: 290,
  },
  content: { gap: 14, padding: 16, paddingBottom: 28 },
  metric: { gap: 1 },
  metricLabel: {
    fontSize: sizes.label,
    fontFamily: fonts.label,
    letterSpacing: 1,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 28,
    fontFamily: fonts.heading,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  // Kyle's hierarchy (2026-09-05): hero = the punch count's figure size,
  // shared by last velocity; large = the second heading size for
  // left/right and peak velocity. Accent stays the punch count's alone.
  metricValueHero: { fontSize: 44, fontFamily: fonts.display },
  metricValueLarge: { fontSize: 36, fontFamily: fonts.display },
  metricValueAccent: { color: colors.accent },
  metricCaption: { fontSize: 12, fontFamily: fonts.body, color: colors.textMuted },
  tiles: { gap: 14, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
})

/**
 * Memoized: the live screen re-renders on every store push, and this
 * component's subtree is heavy — re-committing it at store cadence was
 * part of the JS churn that starved the responder system (dead buttons
 * during work). Props are plain values/stable objects, so a shallow
 * compare skips most commits.
 */
export const MetricsRail = React.memo(MetricsRailInner)
