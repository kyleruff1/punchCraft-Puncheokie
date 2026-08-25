import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import {
  ChakraPetch_400Regular,
  ChakraPetch_500Medium,
  ChakraPetch_600SemiBold,
  ChakraPetch_700Bold,
  useFonts,
} from '@expo-google-fonts/chakra-petch'

// Side-effect import: registers the default BleManagerFacade implementation
// before any screen calls getBleManager(). See src/ble/index.ts.
import '@/ble'

import { useAutoConnectOnLaunch } from '@ble/useAutoConnectOnLaunch'
import { useVoiceSettingsOnLaunch } from '@state/loadVoiceSettings'
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
  // Load the Chakra Petch weights before anything renders text — otherwise
  // the first frame flashes system font and swaps once the fonts land.
  // Returning null while loading keeps the native splash up seamlessly.
  const [fontsLoaded] = useFonts({
    ChakraPetch_400Regular,
    ChakraPetch_500Medium,
    ChakraPetch_600SemiBold,
    ChakraPetch_700Bold,
  })

  // Bind the known trackers once per launch (blue -> left, red -> right).
  // Non-blocking and non-throwing; Velocity Lab offers a manual retry.
  useAutoConnectOnLaunch()
  // Voice preferences are read once here, so the live screen never renders
  // against defaults the athlete has already changed.
  useVoiceSettingsOnLaunch()

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
          <Stack.Screen name="+not-found" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
})
