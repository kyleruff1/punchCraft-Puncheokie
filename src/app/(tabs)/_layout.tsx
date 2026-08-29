import React from 'react'
import { Tabs } from 'expo-router'
import { Pressable, StyleSheet } from 'react-native'
import type { GestureResponderEvent } from 'react-native'

import { Wordmark, type WordmarkApp } from '@/components/branding/Wordmark'
import { colors } from '@/theme/colors'

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

const tabScreenOptions = {
  headerShown: true,
  // Tall enough for the hdr (80pt) wordmark, the page's one brand mark.
  headerStyle: { backgroundColor: colors.surface, height: 104 },
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
          headerTitle: () => <Wordmark app="velocityLab" size="hdr" />,
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
          headerTitle: () => <Wordmark app="punchCraft" size="hdr" />,
        }}
      />
      <Tabs.Screen
        name="puncheokie"
        options={{
          title: 'Puncheokie',
          tabBarButton: wordmarkTabButton('puncheokie'),
          headerTitle: () => <Wordmark app="puncheokie" size="hdr" />,
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
})
