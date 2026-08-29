/**
 * Fix tracker connection — the last-resort reclaim.
 *
 * Tapping a badge already runs an auto-connect pass, which handles the
 * ordinary stale-slot case (D24). This button exists for the stuck-below-
 * the-app case: the OS holds a phantom GATT handle that survives every
 * app-side reset, and the only fix is a real adapter bounce. That is exactly
 * the incident the 2026-08-23 memory documents.
 *
 * Since Android 13 will not let us toggle the adapter from the app, the
 * button prompts the athlete: open Bluetooth settings, toggle it off then on,
 * we'll wait, and reconnect the trackers on the way back. The status line
 * says what to do next in every terminal state so nobody gets stuck
 * wondering what the button did.
 */

import React, { useCallback, useState } from 'react'
import { Alert, Platform, StyleSheet, Text, View } from 'react-native'

import { bounceBluetoothAndReconnect, type BounceStatus } from '@ble/bounceBluetooth'
import { openBluetoothSettings } from '@ble/openBluetoothSettings'
import { ActionButton } from '@/components/branding/ActionButton'
import { colors } from '@/theme/colors'

type Phase = 'idle' | 'waiting' | 'done'

interface Result {
  phase: Phase
  status?: BounceStatus
}

const HINT_FOR: Record<BounceStatus, string> = {
  ok: 'Bluetooth bounced and trackers reconnected.',
  'timed-out': 'Did not see Bluetooth turn off and back on in time. Try again.',
  'never-turned-off':
    'Bluetooth stayed on. Toggle it off in Settings and back on to clear the stuck connection.',
  'settings-unavailable':
    'Could not open Bluetooth settings automatically. Open Settings and toggle Bluetooth off and back on.',
  unauthorized: 'This app is not permitted to use Bluetooth. Grant the permission in Settings.',
}

const WAITING_LABEL = 'Waiting for Bluetooth bounce…'
const RETRY_LABEL = 'Try again'

export function FixTrackerButton(): React.ReactElement | null {
  // iOS has no per-panel Bluetooth settings intent and the ble-plx state
  // subscription behaves differently, so the flow does not apply. Rendering
  // nothing is honest: the button that promises to bounce Bluetooth cannot
  // deliver that on iOS today.
  const [result, setResult] = useState<Result>({ phase: 'idle' })

  const onPress = useCallback(async () => {
    if (result.phase === 'waiting') return
    setResult({ phase: 'waiting' })
    const outcome = await bounceBluetoothAndReconnect({ openSettings: openBluetoothSettings })
    setResult({ phase: 'done', status: outcome.status })
    if (outcome.status !== 'ok') {
      // A quiet alert for the terminal states — the small message below the
      // button is easy to miss when the athlete is on the bag.
      Alert.alert('Fix tracker connection', HINT_FOR[outcome.status])
    }
  }, [result.phase])

  if (Platform.OS !== 'android') return null

  const statusLine =
    result.phase === 'waiting'
      ? WAITING_LABEL
      : result.phase === 'done' && result.status !== 'ok'
        ? RETRY_LABEL
        : null

  return (
    <View style={styles.wrap}>
      {/* The chrome "fix" art is the button; transient state rides in the
          words underneath — §19.4 wants the state named, not only shaded. */}
      <ActionButton
        action="fixTrackers"
        onPress={() => {
          void onPress()
        }}
        disabled={result.phase === 'waiting'}
        height={FIX_BUTTON_HEIGHT}
        fit="pill"
        accessibilityHint="Opens Bluetooth settings so you can toggle it off and on, then reconnects the trackers"
        testID="fix-tracker-connection"
      />
      {statusLine ? (
        <Text style={styles.hint} testID="fix-tracker-status">
          {statusLine}
        </Text>
      ) : null}
      {result.phase === 'done' && result.status ? (
        <Text style={styles.hint} testID="fix-tracker-hint">
          {HINT_FOR[result.status]}
        </Text>
      ) : null}
    </View>
  )
}

/** Matches ConnectTrackersButton's compact art height so the pair reads
 * as siblings in the badges row. */
const FIX_BUTTON_HEIGHT = 30

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  hint: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
})
