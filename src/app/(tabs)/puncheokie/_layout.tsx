import { Stack } from 'expo-router'

import { colors } from '@/theme/colors'

const screenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.background },
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { color: colors.textPrimary },
} as const

/**
 * Stack layout inside the Puncheokie tab, mirroring Velocity Lab's. The
 * recipe screen — and later `presets`, `live` and `summary` — push onto
 * this stack rather than appearing as their own bottom-tab entries.
 */
export default function PuncheokieLayout() {
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="recipe" options={{ headerShown: true, title: 'Workout recipe' }} />
    </Stack>
  )
}
