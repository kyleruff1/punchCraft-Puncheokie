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

import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import {
  AUTO_RETRY_BUDGET,
  armAutoRetry,
  getAutoRetryState,
  isAutoConnectInFlight,
  subscribeAutoRetry,
} from '@ble/autoConnectTrackers'
import { ActionButton } from '@/components/branding/ActionButton'
import { useTrackerStore } from '@/state/useTrackerStore'
import { colors } from '@/theme/colors'

const READY_STATES = new Set(['ready', 'streaming'])

const BUSY_LABEL = 'Scanning…'

export function ConnectTrackersButton(): React.ReactElement {
  const left = useTrackerStore((s) => s.slots.left)
  const right = useTrackerStore((s) => s.slots.right)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [retry, setRetry] = useState(getAutoRetryState())

  useEffect(() => subscribeAutoRetry(() => setRetry(getAutoRetryState())), [])

  const onPress = useCallback(async () => {
    if (busy || isAutoConnectInFlight()) return
    setBusy(true)
    setNote(null)
    // Arms the retry scheduler with a fresh 5-attempt budget: after this
    // pass, follow-up passes fire automatically until both hands connect
    // or the budget runs out.
    const result = await armAutoRetry({ timeoutMs: 12_000 })
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

  // The retry scheduler's status rides under the button. While retries are
  // pending the athlete sees the countdown of automatic attempts; once the
  // budget is spent they see that a manual press is what starts it again.
  const retryNote = bothLive
    ? null
    : retry.retrying
      ? `Retrying automatically — ${AUTO_RETRY_BUDGET - retry.attemptsLeft + 1} of ${AUTO_RETRY_BUDGET}`
      : retry.exhausted
        ? 'Auto-retry paused. Tap to try again.'
        : null

  return (
    <View style={styles.wrap}>
      {/* The authored chrome art IS the button; a busy pass dims it (the
          ActionButton's disabled treatment) and the note line carries the
          "Scanning…" state in words per §19.4. */}
      <ActionButton
        action="connectTrackers"
        onPress={() => {
          void onPress()
        }}
        disabled={busy}
        height={CONNECT_BUTTON_HEIGHT}
        style={bothLive && styles.buttonQuiet}
        testID="connect-trackers"
      />
      {busy ? (
        <Text style={styles.note} testID="connect-trackers-busy">
          {BUSY_LABEL}
        </Text>
      ) : null}
      {note ? (
        <Text style={styles.note} testID="connect-trackers-note">
          {note}
        </Text>
      ) : null}
      {retryNote ? (
        <Text style={styles.note} testID="connect-trackers-retry-note">
          {retryNote}
        </Text>
      ) : null}
    </View>
  )
}

/** Compact art height for the badges row — the pill reads at a glance
 * without competing with the page's hero button. */
const CONNECT_BUTTON_HEIGHT = 76

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  // Quiet when both trackers are already live — still tappable, since the
  // athlete may want to force a fresh bind, but not shouting for attention.
  buttonQuiet: {
    opacity: 0.55,
  },
  note: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
  },
})
