/**
 * Connect trackers — the primary "wake the trackers and bind them" button.
 *
 * Auto-connect fires once at process start and again on live-screen open, but
 * neither catches the ordinary case Kyle keeps hitting: the athlete tapped a
 * tracker after the launch pass ran, so the trackers are now advertising and
 * nothing is looking. Tapping this fires a fresh scan-and-connect right now.
 *
 * The tracker badges also react to a tap by running an auto-connect pass, but
 * that behaviour is discoverable only by experiment. This button is the same
 * action with a name on it, and it sits where the athlete looks when a
 * tracker will not connect.
 */

import React, { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { autoConnectKnownTrackers, isAutoConnectInFlight } from '@ble/autoConnectTrackers'
import { useTrackerStore } from '@/state/useTrackerStore'
import { colors } from '@/theme/colors'

const READY_STATES = new Set(['ready', 'streaming'])

const IDLE_LABEL = 'Connect trackers'
const BUSY_LABEL = 'Scanning…'

export function ConnectTrackersButton(): React.ReactElement {
  const left = useTrackerStore((s) => s.slots.left)
  const right = useTrackerStore((s) => s.slots.right)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const onPress = useCallback(async () => {
    if (busy || isAutoConnectInFlight()) return
    setBusy(true)
    setNote(null)
    const result = await autoConnectKnownTrackers({ timeoutMs: 12_000 })
    setBusy(false)

    if (result.scanError) {
      setNote(`Scan failed: ${result.scanError}`)
      return
    }
    const missing = result.outcomes.filter((o) => o.status === 'not-found')
    const failed = result.outcomes.filter((o) => o.status === 'failed')
    if (failed.length > 0) {
      setNote(`Could not connect ${failed.map((f) => f.hand).join(' + ')}.`)
      return
    }
    if (missing.length > 0) {
      // Almost always means the trackers are asleep. Firm tap on the button
      // wakes them; a second press then picks them up.
      setNote(`Not advertising: ${missing.map((m) => m.hand).join(' + ')}. Tap the tracker to wake it, then try again.`)
      return
    }
    if (result.connectedCount > 0) {
      setNote(null) // silent success; the badges tell the rest of the story
    }
  }, [busy])

  const bothLive = READY_STATES.has(left?.state ?? '') && READY_STATES.has(right?.state ?? '')

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        style={[
          styles.button,
          bothLive ? styles.buttonMuted : styles.buttonPrimary,
          busy && styles.buttonBusy,
        ]}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={busy ? BUSY_LABEL : IDLE_LABEL}
        testID="connect-trackers"
      >
        <Text style={[styles.buttonText, bothLive ? styles.buttonTextMuted : styles.buttonTextPrimary]}>
          {busy ? BUSY_LABEL : IDLE_LABEL}
        </Text>
      </Pressable>
      {note ? (
        <Text style={styles.note} testID="connect-trackers-note">
          {note}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Prominent when there is work to do.
  buttonPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  // Quiet when both trackers are already live — still tappable, since the
  // athlete may want to force a fresh bind, but not shouting for attention.
  buttonMuted: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.borderStrong,
  },
  buttonBusy: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  buttonTextPrimary: {
    color: colors.textOnAccent,
  },
  buttonTextMuted: {
    color: colors.textPrimary,
  },
  note: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
  },
})
