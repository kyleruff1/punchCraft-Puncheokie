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
          tabBarLabel: () => <Wordmark app="velocityLab" size="sm" />,
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
          tabBarLabel: () => <Wordmark app="punchCraft" size="sm" />,
          headerTitle: () => <Wordmark app="punchCraft" size="sm" />,
        }}
      />
      <Tabs.Screen
        name="puncheokie"
        options={{
          title: 'Puncheokie',
          tabBarLabel: () => <Wordmark app="puncheokie" size="sm" />,
          headerTitle: () => <Wordmark app="puncheokie" size="sm" />,
        }}
      />
    </Tabs>
  )
}
