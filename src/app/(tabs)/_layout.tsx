import { Tabs } from 'expo-router'

import { colors } from '@/theme/colors'

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
      <Tabs.Screen name="velocity-lab" options={{ title: 'Velocity Lab', tabBarLabel: 'Velocity Lab' }} />
      <Tabs.Screen name="punchcraft" options={{ title: 'punchCraft', tabBarLabel: 'punchCraft' }} />
      <Tabs.Screen name="puncheokie" options={{ title: 'Puncheokie', tabBarLabel: 'Puncheokie' }} />
    </Tabs>
  )
}
