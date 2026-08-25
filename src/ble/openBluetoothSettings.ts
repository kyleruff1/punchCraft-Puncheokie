/**
 * Open the OS Bluetooth settings screen.
 *
 * Android exposes a first-class intent — `android.settings.BLUETOOTH_SETTINGS` —
 * that lands the user directly on the Bluetooth panel. iOS has no equivalent
 * per-panel URL for user-facing settings (Apple removed `prefs:` for third-
 * party apps), so this is Android-only for now; the caller falls back to a
 * plain instruction when the platform cannot be driven there.
 *
 * Isolated in one file with one export so the callers do not carry
 * expo-linking directly, and so the intent name is not repeated.
 */

import { Platform } from 'react-native'
import * as Linking from 'expo-linking'

const ANDROID_BLUETOOTH_SETTINGS = 'android.settings.BLUETOOTH_SETTINGS'

export async function openBluetoothSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    await Linking.sendIntent(ANDROID_BLUETOOTH_SETTINGS)
    return
  }
  throw new Error(`no Bluetooth settings intent for platform: ${Platform.OS}`)
}
