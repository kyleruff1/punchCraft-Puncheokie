import { Stack } from 'expo-router'

/**
 * Stack layout inside the Velocity Lab tab. `spike` and future
 * velocity-lab sub-screens push onto this stack instead of showing
 * up as their own bottom-tab entries.
 */
export default function VelocityLabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="spike" options={{ headerShown: true, title: 'BLE spike' }} />
    </Stack>
  )
}
