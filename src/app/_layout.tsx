import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import {
  Kanit_400Regular,
  Kanit_500Medium,
  Kanit_600SemiBold_Italic,
  Kanit_700Bold_Italic,
  useFonts,
} from '@expo-google-fonts/kanit'

// Side-effect import: registers the default BleManagerFacade implementation
// before any screen calls getBleManager(). See src/ble/index.ts.
import '@/ble'

import { useEffect } from 'react'

import { useAutoConnectOnLaunch } from '@ble/useAutoConnectOnLaunch'
import { onKeepaliveBattery, startTrackerKeepalive } from '@protocol/trackerKeepalive'
import { noteSlotBattery } from '@state/useTrackerStore'
import { useVoiceSettingsOnLaunch } from '@state/loadVoiceSettings'
import { useBackdropSettingsOnLaunch } from '@state/loadBackdropSettings'
import { colors } from '@/theme/colors'
import { fonts } from '@/theme/typography'

const stackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.background },
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { color: colors.textPrimary, fontFamily: fonts.heading },
} as const

export default function RootLayout() {
  // Load the Kanit weights before anything renders text — otherwise
  // the first frame flashes system font and swaps once the fonts land.
  // Returning null while loading keeps the native splash up seamlessly.
  const [fontsLoaded] = useFonts({
    Kanit_400Regular,
    Kanit_500Medium,
    Kanit_600SemiBold_Italic,
    Kanit_700Bold_Italic,
  })

  // The keepalive streams must exist BEFORE the first connect completes,
  // so a freshly-bound glove immediately hears the init plan — a
  // FightCamp tracker hangs up on a silent central (2026-08-29).
  useEffect(() => {
    startTrackerKeepalive()
    // Battery levels flow from the keepalive's heartbeat into the slot
    // store, where the header lamps read them.
    return onKeepaliveBattery(noteSlotBattery)
  }, [])
  // Bind the known trackers once per launch (blue -> left, red -> right).
  // Non-blocking and non-throwing; Velocity Lab offers a manual retry.
  useAutoConnectOnLaunch()
  // Voice preferences are read once here, so the live screen never renders
  // against defaults the athlete has already changed.
  useVoiceSettingsOnLaunch()
  useBackdropSettingsOnLaunch()

  if (!fontsLoaded) return null

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={stackScreenOptions}>
          {/* Splash comes first so the app opens on itself, not on the tabs
              layout's first render — and any deep link that resolves to `/`
              lands here rather than falling to `+not-found`. */}
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings/index" options={{ headerShown: true, title: 'Settings' }} />
          <Stack.Screen
            name="settings/voice"
            options={{ headerShown: true, title: 'Voice Coach' }}
          />
          <Stack.Screen
            name="settings/backdrop"
            options={{ headerShown: true, title: 'Workout backdrop' }}
          />
          <Stack.Screen name="+not-found" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
})
