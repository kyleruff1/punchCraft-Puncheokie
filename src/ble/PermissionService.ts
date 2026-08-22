/**
 * PermissionService — Android BLE runtime permission flow and adapter-state
 * helpers. Transport-agnostic: adapter checks delegate to BleManagerFacade
 * so this module never imports a BLE library directly (§15.1).
 *
 * Android permission matrix:
 *   API >= 31 (S): BLUETOOTH_SCAN + BLUETOOTH_CONNECT (neverForLocation)
 *   API <  31    : ACCESS_FINE_LOCATION (required for BLE scan results)
 *
 * iOS resolves granted:true — the OS handles the CoreBluetooth prompt on
 * first use and there is nothing to request here.
 */
import { Linking, PermissionsAndroid, Platform } from 'react-native'
import type { Permission } from 'react-native'
import type { BleManagerFacade, UnsubscribeFn } from './BleManagerFacade'
import { deviceSensitive, logger, safe } from '@/diagnostics/logger'

export interface PermissionOutcome {
  granted: boolean
  /** Permissions the user selected "Don't ask again" for — recover via openSettings(). */
  permanentlyDenied: string[]
  /** Permissions still missing (denied this round, but not permanently). */
  missing: string[]
}

function requiredAndroidPermissions(): Permission[] {
  // Platform.Version is a number on Android.
  const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10)
  if (api >= 31) {
    return [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]
  }
  return [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
}

function iosOk(): PermissionOutcome {
  return { granted: true, permanentlyDenied: [], missing: [] }
}

export async function request(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') {
    logger.info('perm.request.skip', 'Non-Android platform, skipping runtime permission request', {
      platform: safe(Platform.OS),
    })
    return iosOk()
  }

  const perms = requiredAndroidPermissions()
  const results = await PermissionsAndroid.requestMultiple(perms)

  const missing: string[] = []
  const permanentlyDenied: string[] = []
  for (const p of perms) {
    const r = results[p]
    if (r === PermissionsAndroid.RESULTS.GRANTED) continue
    if (r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) permanentlyDenied.push(p)
    else missing.push(p)
  }
  const outcome: PermissionOutcome = {
    granted: missing.length === 0 && permanentlyDenied.length === 0,
    permanentlyDenied,
    missing,
  }
  logger.info('perm.request.result', 'Android BLE permission request completed', {
    requested: safe(perms),
    granted: safe(outcome.granted),
    missing: deviceSensitive(outcome.missing),
    permanentlyDenied: deviceSensitive(outcome.permanentlyDenied),
    apiLevel: safe(Platform.Version),
  })
  return outcome
}

export async function current(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') return iosOk()
  const perms = requiredAndroidPermissions()
  const missing: string[] = []
  for (const p of perms) {
    const has = await PermissionsAndroid.check(p)
    if (!has) missing.push(p)
  }
  const outcome: PermissionOutcome = {
    granted: missing.length === 0,
    permanentlyDenied: [],
    missing,
  }
  logger.debug('perm.current', 'Checked current Android BLE permission state', {
    granted: safe(outcome.granted),
    missing: deviceSensitive(outcome.missing),
    apiLevel: safe(Platform.Version),
  })
  return outcome
}

export async function openSettings(): Promise<void> {
  logger.info('perm.openSettings', 'Opening OS settings for permission recovery', {
    platform: safe(Platform.OS),
  })
  await Linking.openSettings()
}

export async function isBluetoothOn(facade: BleManagerFacade): Promise<boolean> {
  const ready = await facade.isReady()
  logger.debug('perm.adapter.check', 'Bluetooth adapter readiness check', { ready: safe(ready) })
  return ready
}

export function onBluetoothStateChange(
  facade: BleManagerFacade,
  cb: (state: 'unknown' | 'off' | 'on' | 'unauthorized') => void,
): UnsubscribeFn {
  return facade.onAdapterStateChange((state) => {
    logger.info('perm.adapter.state', 'Bluetooth adapter state changed', { state: safe(state) })
    cb(state)
  })
}

export const PermissionService = {
  request,
  current,
  openSettings,
  isBluetoothOn,
  onBluetoothStateChange,
} as const
