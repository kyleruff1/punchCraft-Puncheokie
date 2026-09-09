import React from 'react'
import { Tabs } from 'expo-router'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Wordmark, type WordmarkApp } from '@/components/branding/Wordmark'
import { ConnectTrackersButton } from '@components/ConnectTrackersButton'
import { FixTrackerButton } from '@components/FixTrackerButton'
import { formatCountdown, TrackerLamp } from '@components/workout/RoundTopBar'
import { colors, punch } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import { useTrackerStore } from '@/state/useTrackerStore'
import { useLive } from '@state/useWorkoutStore'

/**
 * The slice of react-navigation's BottomTabBarButtonProps this button
 * uses. Typed locally: `@react-navigation/bottom-tabs` is an indirect
 * dependency (bundled through expo-router), so importing its types
 * directly is not resolvable from this package.
 */
interface TabButtonProps {
  onPress?: ((e: GestureResponderEvent) => void) | null
  onLongPress?: ((e: GestureResponderEvent) => void) | null
  accessibilityState?: { selected?: boolean }
  testID?: string
}

/**
 * Open on punchCraft, where the workouts are, rather than the Velocity Lab
 * bench. `initialRouteName` pins the launch tab independently of declaration
 * order, so the nav layout and every deep link are untouched.
 */
export const unstable_settings = { initialRouteName: 'punchcraft' }

/**
 * The tab bar's container style, exported so the live screen can restore
 * it verbatim after hiding the bar for a workout (see live.tsx). Restoring
 * `undefined` instead used to leave the bar unstyled, which is one half of
 * the collapsed-bar bug this file works around.
 */
export const TAB_BAR_STYLE = {
  backgroundColor: colors.surface,
  borderTopColor: colors.border,
  // Sized to fit the `tab` Wordmark with breathing room; without an
  // explicit height the bar collapses to its content, and the wordmark
  // buttons render at zero height on lazily-mounted tabs.
  // 80 (was 72, Kyle 2026-09-05): the wordmarks read as sunk into the
  // bottom rail — a taller bar plus more bottom pad lifts them clear.
  // 168 (Kyle 2026-09-06): the wordmark itself went 40 -> 100 (2.5x) to
  // make the tabs prominent; the bar has to grow with it or the art is
  // clipped. 100 art + 26 bottom pad + breathing room.
  height: 168,
} as const

/**
 * Wordmark tab button. Rendered through `tabBarButton` rather than the
 * label/icon slots: the label slot gave the wordmark images zero size
 * whenever focus moved to a tab that mounted lazily (velocity-lab,
 * puncheokie), collapsing the whole bar to a few pixels. A custom button
 * owns its own layout, so the bar keeps its height no matter which tab
 * is focused. The Wordmark's fixed accessibilityLabel still names the
 * tab to assistive tech; `accessibilityState` from the navigator carries
 * the selected flag.
 */
function wordmarkTabButton(app: WordmarkApp) {
  function WordmarkTabButton(props: TabButtonProps): React.JSX.Element {
    const { onPress, onLongPress, accessibilityState, testID } = props
    const selected = accessibilityState?.selected === true
    return (
      <Pressable
        onPress={onPress ?? undefined}
        onLongPress={onLongPress ?? undefined}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        testID={testID}
        style={[styles.tabButton, !selected && styles.tabButtonInactive]}
      >
        {/* The tab link is the isolated silver wordmark's ONE job —
            everywhere else punchCraft is the color wordmark. */}
        <Wordmark
          app={app}
          size="tab"
          variant={app === 'punchCraft' ? 'isolated' : 'brand'}
        />
      </Pressable>
    )
  }
  return WordmarkTabButton
}

/**
 * Header wordmark, its CENTRE sitting at 25% of the header's width
 * (Kyle: "if 50% is the middle", the mark lives at 25%). The wrapper
 * walks left by half the hdr wordmark's width (80pt tall × 3:1 aspect
 * → 240 wide → -120) from the 25% line.
 */
/**
 * Round + clock, centred on the 75% line — the header's counterweight
 * to the wordmark at 25% (Kyle 2026-08-28). Reads the live session
 * store directly because the tabs header lives OUTSIDE the live
 * screen's tree; renders nothing while no session is running, so the
 * other tabs and the idle landing keep a clean header.
 */
function HeaderRoundClock(): React.JSX.Element {
  const live = useLive()
  // Clock only — the round counter moved to its own badge on the right
  // (Kyle 2026-09-05, workout-page markup).
  return (
    <View style={styles.headerClockBlock}>
      <Text style={styles.headerCountdown} testID="round-countdown">
        {formatCountdown(live.roundRemainingMs)}
      </Text>
    </View>
  )
}

/** Is a session on screen (any phase that owns the live layout)? */
function useSessionRunning(): boolean {
  const live = useLive()
  return (
    live.phase === 'countdown' ||
    live.phase === 'work' ||
    live.phase === 'rest' ||
    live.phase === 'paused'
  )
}

/**
 * Workout identity, centred between the wordmark and the clock (Kyle
 * 2026-09-05, workout-page markup): the workout's name with its one-line
 * description underneath. Same motif as the rest of the chrome — no new
 * colours. Renders nothing while idle so the other tabs keep a clean
 * header.
 */
function HeaderWorkoutTitle(): React.JSX.Element | null {
  const live = useLive()
  const running = useSessionRunning()
  if (!running || !live.workoutName) return null
  return (
    <View style={styles.headerTitleBlock}>
      <Text style={styles.headerWorkoutName} numberOfLines={1} testID="header-workout-name">
        {live.workoutName}
      </Text>
      {live.workoutDescription ? (
        <Text
          style={styles.headerWorkoutDescription}
          numberOfLines={1}
          ellipsizeMode="tail"
          testID="header-workout-description"
        >
          {live.workoutDescription}
        </Text>
      ) : null}
    </View>
  )
}

/**
 * "Round N of N", right of the clock (Kyle 2026-09-05 markup) — its own
 * zone so the countdown stays the loud number and the round reads as the
 * label beside it.
 */
function HeaderRoundBadge(): React.JSX.Element | null {
  const live = useLive()
  const running = useSessionRunning()
  if (!running || live.roundCount <= 0) return null
  return (
    <View style={styles.headerRoundBadge}>
      <Text style={styles.headerRound} testID="round-counter">
        {`Round ${live.roundIndex + 1} of ${live.roundCount}`}
      </Text>
    </View>
  )
}

/** Header lamp: the shared TrackerLamp wired to a tracker slot. */
function TrackerLed(props: { hand: 'L' | 'R' }): React.JSX.Element {
  const { hand } = props
  const slot = useTrackerStore((s) => (hand === 'L' ? s.slots.left : s.slots.right))
  return (
    <TrackerLamp
      hand={hand}
      state={slot?.state ?? 'dormant'}
      {...(slot?.batteryPct === undefined ? {} : { batteryPct: slot.batteryPct })}
    />
  )
}

/**
 * The LED pair sits just off the left boundary, ahead of the wordmark —
 * always visible, including mid-workout, so tracker health stays one
 * glance away. While a running session is simulator-driven, a small SIM
 * tag sits under the pair (Kyle 2026-08-29) — the lamps themselves stay
 * honest about connection and never spell out states.
 */
function HeaderLedZone(): React.JSX.Element {
  const live = useLive()
  const running =
    live.phase === 'countdown' ||
    live.phase === 'work' ||
    live.phase === 'rest' ||
    live.phase === 'paused'
  const sim = running && live.sourceKind === 'simulated'
  return (
    <View style={styles.headerLedZone}>
      <View style={styles.headerLedRow}>
        <TrackerLed hand="L" />
        {/* The halo boxes carry invisible padding around each lamp, so the
            red lamp tucks under it to halve the VISIBLE lamp-to-lamp gap
            (36 → 18). Lit halos overlap a touch, which reads as adjacent
            glows, not a collision. */}
        <View style={styles.ledTuck}>
          <TrackerLed hand="R" />
        </View>
      </View>
      {sim ? (
        <Text style={styles.headerLedSim} testID="header-sim-tag">
          SIM
        </Text>
      ) : null}
    </View>
  )
}

/**
 * The header's right zone, centred on the 75% line: round + clock while
 * a session runs, the connect + fix buttons side by side otherwise.
 * Reads the store directly because the tabs header lives OUTSIDE the
 * screens' trees.
 */
function HeaderRightZone(): React.JSX.Element {
  const live = useLive()
  const running =
    live.phase === 'countdown' ||
    live.phase === 'work' ||
    live.phase === 'rest' ||
    live.phase === 'paused'
  return (
    <View style={styles.headerRightZone}>
      {running && live.roundCount > 0 ? (
        <HeaderRoundClock />
      ) : (
        <View style={styles.headerTrackers}>
          <ConnectTrackersButton />
          <FixTrackerButton />
        </View>
      )}
    </View>
  )
}

/**
 * The header's silver frame — rendered as the header background. Its top
 * edge starts BELOW the OS status strip (wifi / battery / clock), so the
 * frame clearly defines where the app begins (Kyle 2026-08-29); the strip
 * above it stays plain surface.
 */
function HeaderFrame(): React.JSX.Element {
  const insets = useSafeAreaInsets()
  return <View style={[styles.headerFrame, { marginTop: insets.top }]} />
}

function headerWordmark(app: WordmarkApp) {
  function HeaderWordmark(): React.JSX.Element {
    // The tabs header centres its title in an intrinsic-width container
    // and ignores headerTitleContainerStyle, which silently broke the
    // 25% placement — an explicit window-width bar restores real
    // percentage geometry.
    const { width, height } = useWindowDimensions()
    // Landscape anchors the mark by its LEFT EDGE on the 8% line — as far
    // left as it can sit without running over the lamp pair (a 10% CENTRE
    // put its left edge at ~4%, inside the lamps). Portrait centres on
    // 30% ("40 was a little too far").
    const landscape = width > height
    return (
      <View style={[styles.headerBar, { width }]}>
        <HeaderLedZone />
        <View style={landscape ? styles.headerBrandLandscape : styles.headerBrandPortrait}>
          <Wordmark app={app} size="hdr" />
        </View>
        <HeaderWorkoutTitle />
        <HeaderRightZone />
        <HeaderRoundBadge />
      </View>
    )
  }
  return HeaderWordmark
}

const tabScreenOptions = {
  headerShown: true,
  // Tall enough for the hdr (80pt) wordmark, the page's one brand mark,
  // now centred — the extra height keeps it clear of the status bar and
  // the Settings link on the right.
  headerStyle: { backgroundColor: colors.surface, height: 120 },
  // Chrome silver frame around the WHOLE header (Kyle 2026-08-29): the
  // background layer is the one surface spanning full header bounds —
  // its top edge runs under the OS clock/battery strip and everything in
  // the header (lamps, wordmark, buttons) paints over it.
  headerBackground: HeaderFrame,
  // The title component owns the full header width so the wordmark can
  // sit at 25% and the round/clock block at 75%.
  headerTitleContainerStyle: { left: 0, right: 0, marginHorizontal: 0 },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { color: colors.textPrimary },
  sceneStyle: { backgroundColor: colors.background },
  tabBarStyle: TAB_BAR_STYLE,
} as const

export default function TabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen
        name="velocity-lab"
        options={{
          title: 'Velocity Lab',
          tabBarButton: wordmarkTabButton('velocityLab'),
          headerTitle: headerWordmark('velocityLab'),
        }}
      />
      <Tabs.Screen
        name="punchcraft"
        options={{
          // Each tab renders its own wordmark instead of prose type: the
          // app never writes its own mode names in text when a wordmark is
          // available.
          title: 'punchCraft',
          tabBarButton: wordmarkTabButton('punchCraft'),
          // The page's ONE wordmark: big, top-left in the header. The
          // landings render no duplicate H1 (Kyle 2026-08-28).
          headerTitle: headerWordmark('punchCraft'),
        }}
      />
      <Tabs.Screen
        name="puncheokie"
        options={{
          title: 'Puncheokie',
          tabBarButton: wordmarkTabButton('puncheokie'),
          headerTitle: headerWordmark('puncheokie'),
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Ride the wordmark toward the top of the bar: the tablet's floating
    // OS taskbar overlays the bottom edge of the app window, and a
    // dead-centred wordmark gets its lower half clipped behind it.
    // 26 (was 18, Kyle 2026-09-05): still read as sunk — lift further.
    // Held at 26 with the 2.5x art: the taller bar does the lifting now.
    paddingBottom: 26,
  },
  // The inactive wordmarks dim rather than tint — the art is an image, so
  // opacity is the "inactive" signal where a text label would grey out.
  tabButtonInactive: { opacity: 0.45 },
  headerBar: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Top + bottom rails only (Kyle) — no side borders.
  headerFrame: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderColor: punch.silver,
  },
  // Left edge on the 13% line — clear of the lamps with real air.
  headerBrandLandscape: { marginLeft: '13%' },
  // Centre on the 30% line: walk to 30%, then back by half the hdr
  // wordmark's width (80 × 3:1 → 240 → -120).
  headerBrandPortrait: { marginLeft: '30%', transform: [{ translateX: -120 }] },
  headerRightZone: {
    // Centre of the zone on the 75% line, mirroring the wordmark at 25%.
    position: 'absolute',
    left: '75%',
    transform: [{ translateX: -270 }],
    width: 540,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerClockBlock: {
    alignItems: 'center',
  },
  headerLedZone: {
    // Near the left boundary: the VISIBLE turquoise lamp starts on the
    // 2.5% line (Kyle) — the -13 sheds the halo box's invisible padding
    // so the lamp face, not the box, lands there.
    position: 'absolute',
    left: '2.5%',
    marginLeft: -13,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  headerLedRow: { flexDirection: 'row', alignItems: 'center' },
  ledTuck: { marginLeft: -8 },
  headerLedSim: {
    fontSize: sizes.label,
    fontFamily: fonts.label,
    color: colors.textSecondary,
    letterSpacing: 2,
  },
  headerTrackers: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    // Side by side, nearly touching — same pill height, widths differ.
    gap: 8,
    flexWrap: 'nowrap',
  },
  headerRound: {
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    color: colors.textSecondary,
  },
  headerCountdown: {
    fontSize: 34,
    fontFamily: fonts.display,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  // Workout identity, centred on the 50% line between the wordmark and
  // the clock (Kyle 2026-09-05 markup).
  headerTitleBlock: {
    position: 'absolute',
    left: '50%',
    transform: [{ translateX: -230 }],
    width: 460,
    alignItems: 'center',
    gap: 2,
  },
  headerWorkoutName: {
    fontSize: 24,
    fontFamily: fonts.heading,
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  headerWorkoutDescription: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  // "Round N of N", centred on the 88% line — right of the clock, clear
  // of the settings gear.
  headerRoundBadge: {
    position: 'absolute',
    left: '88%',
    transform: [{ translateX: -110 }],
    width: 220,
    alignItems: 'center',
  },
})
