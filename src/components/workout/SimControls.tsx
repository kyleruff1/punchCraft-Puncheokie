/**
 * Simulated-source controls (M32-08).
 *
 * `__DEV__` only — the caller gates rendering, and the component refuses to
 * render outside a dev build as a second line of defence. This is how the
 * live screen is exercised before the tracker stream exists (M33-01): tap a
 * glove, play a script, and shove latency and drops into the delivery path
 * to see the screen behave the way it will in a gym rather than on a desk.
 */
import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { SIM_SCRIPTS, type SimScriptId } from '@simulation/scripts'

export interface SimControlsProps {
  onTap: (hand: 'left' | 'right') => void
  onPlayScript: (id: SimScriptId) => void
  onSetLatency?: (ms: number) => void
  latencyMs?: number
}

const LATENCIES = [0, 80, 200]

export function SimControls(props: SimControlsProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!__DEV__) return null

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.handle}
        testID="sim-controls-handle"
      >
        <Text style={styles.handleText}>SIM</Text>
      </Pressable>
    )
  }

  return (
    <View style={styles.drawer} testID="sim-controls">
      <View style={styles.row}>
        <Text style={styles.label}>Simulated source</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={styles.close}
          testID="sim-controls-close"
        >
          <Text style={styles.closeText}>Hide</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => props.onTap('left')}
          style={[styles.pad, { borderColor: colors.trackerLeft }]}
          testID="sim-tap-left"
        >
          <Text style={[styles.padText, { color: colors.trackerLeft }]}>Tap L</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => props.onTap('right')}
          style={[styles.pad, { borderColor: colors.trackerRight }]}
          testID="sim-tap-right"
        >
          <Text style={[styles.padText, { color: colors.trackerRight }]}>Tap R</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        {(Object.keys(SIM_SCRIPTS) as SimScriptId[]).map((id) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            onPress={() => props.onPlayScript(id)}
            style={styles.chip}
            testID={`sim-script-${id}`}
          >
            <Text style={styles.chipText}>{id}</Text>
          </Pressable>
        ))}
      </View>

      {props.onSetLatency ? (
        <View style={styles.row}>
          <Text style={styles.label}>Latency</Text>
          {LATENCIES.map((ms) => (
            <Pressable
              key={ms}
              accessibilityRole="button"
              accessibilityState={{ selected: props.latencyMs === ms }}
              onPress={() => props.onSetLatency?.(ms)}
              style={[styles.chip, props.latencyMs === ms && styles.chipSelected]}
              testID={`sim-latency-${ms}`}
            >
              <Text style={styles.chipText}>{`${ms}ms`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  handle: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    opacity: 0.8,
  },
  handleText: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },
  drawer: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  close: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4 },
  closeText: { fontSize: 12, fontWeight: '600', color: colors.accent },
  pad: {
    minWidth: 70,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padText: { fontSize: 15, fontWeight: '800' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
})
