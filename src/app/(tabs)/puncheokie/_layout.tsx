/**
 * Puncheoke tab stack — the instrument product's own navigation. Cloned
 * from the punchcraft tab layout posture: headers off by default, the
 * jam screen owns its chrome.
 */
import type React from 'react'
import { Stack } from 'expo-router'

export default function PuncheokieLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="jam" />
    </Stack>
  )
}
