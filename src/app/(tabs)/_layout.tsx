import { Tabs } from 'expo-router'

import { Wordmark } from '@/components/branding/Wordmark'
import { colors } from '@/theme/colors'

/**
 * Open on punchCraft, where the workouts are, rather than the Velocity Lab
 * bench. `initialRouteName` pins the launch tab independently of declaration
 * order, so the nav layout and every deep link are untouched.
 */
export const unstable_settings = { initialRouteName: 'punchcraft' }

const tabScreenOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { color: colors.textPrimary },
  sceneStyle: { backgroundColor: colors.background },
  tabBarStyle: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    // Sized to fit the `tab` Wordmark (40pt) with breathing room above
    // and below; without this the bar stays at the RN default and crops
    // the top of the wordmark.
    height: 72,
    paddingTop: 8,
    paddingBottom: 8,
  },
  tabBarLabelStyle: {
    // Center the wordmark in the label slot rather than bottom-anchoring
    // to where a text label would have sat.
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.textSecondary,
} as const

export default function TabsLayout() {
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen
        name="velocity-lab"
        options={{
          title: 'Velocity Lab',
          tabBarIcon: () => null,
          tabBarLabel: () => <Wordmark app="velocityLab" size="tab" />,
          headerTitle: () => <Wordmark app="velocityLab" size="sm" />,
        }}
      />
      <Tabs.Screen
        name="punchcraft"
        options={{
          // Each tab renders its own wordmark instead of prose type: the
          // app never writes its own mode names in text when a wordmark is
          // available. The label render still names the tab to the
          // accessibility layer via the Wordmark's fixed a11y label.
          title: 'punchCraft',
          tabBarIcon: () => null,
          tabBarLabel: () => <Wordmark app="punchCraft" size="tab" />,
          headerTitle: () => <Wordmark app="punchCraft" size="sm" />,
        }}
      />
      <Tabs.Screen
        name="puncheokie"
        options={{
          title: 'Puncheokie',
          tabBarIcon: () => null,
          tabBarLabel: () => <Wordmark app="puncheokie" size="tab" />,
          headerTitle: () => <Wordmark app="puncheokie" size="sm" />,
        }}
      />
    </Tabs>
  )
}
