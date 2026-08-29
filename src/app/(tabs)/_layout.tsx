import React from 'react'
import { Tabs } from 'expo-router'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { GestureResponderEvent } from 'react-native'

import { Wordmark, type WordmarkApp } from '@/components/branding/Wordmark'
import { ConnectionBadge } from '@components/ConnectionBadge'
import { ConnectTrackersButton } from '@components/ConnectTrackersButton'
import { FixTrackerButton } from '@components/FixTrackerButton'
import { formatCountdown } from '@components/workout/RoundTopBar'
import { colors } from '@/theme/colors'
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
  // Sized to fit the `tab` Wordmark (40pt) with breathing room; without an
  // explicit height the bar collapses to its content, and the wordmark
  // buttons render at zero height on lazily-mounted tabs.
  height: 72,
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
  return (
    <View style={styles.headerClockBlock}>
      <Text style={styles.headerRound} testID="round-counter">
        {`Round ${live.roundIndex + 1}/${live.roundCount}`}
      </Text>
      <Text style={styles.headerCountdown} testID="round-countdown">
        {formatCountdown(live.roundRemainingMs)}
      </Text>
    </View>
  )
}

/**
 * The tracker cluster — L/R status badges plus the connect and fix
 * buttons — lives in the header's 75% zone (Kyle 2026-08-28), replacing
 * the old banner that read as a second header under the real one.
 */
function HeaderTrackerCluster(): React.JSX.Element {
  const left = useTrackerStore((s) => s.slots.left)
  const right = useTrackerStore((s) => s.slots.right)
  return (
    <View style={styles.headerTrackers}>
      <ConnectionBadge hand="left" slot={left} />
      <ConnectionBadge hand="right" slot={right} />
      <ConnectTrackersButton />
      <FixTrackerButton />
    </View>
  )
}

/**
 * The header's right zone, centred on the 75% line: round + clock while
 * a session runs, the tracker cluster otherwise. Reads the stores
 * directly because the tabs header lives OUTSIDE the screens' trees.
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
      {running && live.roundCount > 0 ? <HeaderRoundClock /> : <HeaderTrackerCluster />}
    </View>
  )
}

function headerWordmark(app: WordmarkApp) {
  function HeaderWordmark(): React.JSX.Element {
    // The tabs header centres its title in an intrinsic-width container
    // and ignores headerTitleContainerStyle, which silently broke the
    // 25% placement — an explicit window-width bar restores real
    // percentage geometry.
    const { width } = useWindowDimensions()
    return (
      <View style={[styles.headerBar, { width }]}>
        <View style={styles.headerBrand}>
          <Wordmark app={app} size="hdr" />
        </View>
        <HeaderRightZone />
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
    paddingBottom: 18,
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
  headerBrand: {
    // Centre of the mark on the 25% line: walk to 25%, then back by half
    // the hdr wordmark's width (80 × 3:1 → 240 → -120).
    marginLeft: '25%',
    transform: [{ translateX: -120 }],
  },
  headerRightZone: {
    // Centre of the zone on the 75% line, mirroring the wordmark at 25%.
    position: 'absolute',
    left: '75%',
    transform: [{ translateX: -260 }],
    width: 520,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerClockBlock: {
    alignItems: 'center',
  },
  headerTrackers: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
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
})
