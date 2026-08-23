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
 * Stack layout inside the punchCraft tab, mirroring Velocity Lab's. The
 * recipe screen — and later `presets`, `live` and `summary` — push onto
 * this stack rather than appearing as their own bottom-tab entries.
 */
export default function PunchCraftLayout() {
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="recipe" options={{ headerShown: true, title: 'Workout recipe' }} />
      {/* The live screen draws its own chrome: a nav bar would eat the width
          the cue stage needs (doc §19). */}
      <Stack.Screen name="live" options={{ headerShown: false }} />
      {/* Throwaway M32-05 spike route (#182); removed when the spike closes. */}
      <Stack.Screen
        name="orientation-spike"
        options={{ headerShown: true, title: 'M32-05 spike' }}
      />
    </Stack>
  )
}
