import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'

// Side-effect import: registers the default BleManagerFacade implementation
// before any screen calls getBleManager(). See src/ble/index.ts.
import '@/ble'

import { useAutoConnectOnLaunch } from '@ble/useAutoConnectOnLaunch'
import { colors } from '@/theme/colors'

const stackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.background },
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { color: colors.textPrimary },
} as const

export default function RootLayout() {
  // Bind the known trackers once per launch (blue -> left, red -> right).
  // Non-blocking and non-throwing; Velocity Lab offers a manual retry.
  useAutoConnectOnLaunch()

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={stackScreenOptions}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings/index" options={{ headerShown: true, title: 'Settings' }} />
          <Stack.Screen name="+not-found" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
})
