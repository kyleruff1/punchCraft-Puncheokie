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
 * Stack layout inside the Velocity Lab tab. `spike` and future
 * velocity-lab sub-screens push onto this stack instead of showing
 * up as their own bottom-tab entries.
 */
export default function VelocityLabLayout() {
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="spike" options={{ headerShown: true, title: 'BLE spike' }} />
      <Stack.Screen name="probe" options={{ headerShown: true, title: 'Protocol probe' }} />
      <Stack.Screen name="live" options={{ headerShown: true, title: 'Live decoded events' }} />
    </Stack>
  )
}
