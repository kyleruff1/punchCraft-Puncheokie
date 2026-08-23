/**
 * M32-05 spike — landscape lock, keep-awake, haptics (#182).
 *
 * THROWAWAY. This route exists to answer one question on the Lenovo
 * TB125FU and is deleted (or parked) when the spike closes. M32-08 lands
 * the permanent wiring based on what this finds.
 *
 * The question: with `orientation: 'default'` globally, can
 * `expo-screen-orientation` lock this one route to landscape on focus and
 * restore on blur, without expo-router navigation state or Zustand store
 * state being lost to the Android activity recreation that rotation
 * triggers?
 *
 * The two counters below are the instrument for that. `localCount` is
 * React state inside this component; `storeCount` is a module-level
 * Zustand-style counter held outside React. If Android recreates the
 * activity on rotation, the local counter resets and the store counter
 * does not — which tells us exactly which layer needs protecting.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as ScreenOrientation from 'expo-screen-orientation'
import { useKeepAwake } from 'expo-keep-awake'
import { create } from 'zustand'

import { colors } from '@/theme/colors'

/** Lives outside React, so rotation cannot reset it via a re-render. */
const useSpikeStore = create<{ count: number; bump: () => void }>((set) => ({
  count: 0,
  bump: () => set((s) => ({ count: s.count + 1 })),
}))

const ORIENTATION_NAMES: Record<number, string> = {
  [ScreenOrientation.Orientation.UNKNOWN]: 'UNKNOWN',
  [ScreenOrientation.Orientation.PORTRAIT_UP]: 'PORTRAIT_UP',
  [ScreenOrientation.Orientation.PORTRAIT_DOWN]: 'PORTRAIT_DOWN',
  [ScreenOrientation.Orientation.LANDSCAPE_LEFT]: 'LANDSCAPE_LEFT',
  [ScreenOrientation.Orientation.LANDSCAPE_RIGHT]: 'LANDSCAPE_RIGHT',
}

export default function OrientationSpike(): React.JSX.Element {
  // Held only while this route is focused; released on blur by the hook.
  useKeepAwake()

  const [localCount, setLocalCount] = useState(0)
  const storeCount = useSpikeStore((s) => s.count)
  const bump = useSpikeStore((s) => s.bump)

  const [orientation, setOrientation] = useState('(reading)')
  const [log, setLog] = useState<string[]>([])
  const append = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 12))
  }, [])

  // The mechanism under test: lock on focus, release on blur.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void (async () => {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
          if (!cancelled) append('locked LANDSCAPE on focus')
        } catch (err) {
          if (!cancelled) append(`lock failed: ${String(err)}`)
        }
      })()

      return () => {
        cancelled = true
        // Release rather than force portrait: the global setting is
        // 'default', so unlocking hands control back to the OS and every
        // other route keeps whatever presentation it already had.
        void ScreenOrientation.unlockAsync().catch(() => undefined)
      }
    }, [append]),
  )

  useEffect(() => {
    let alive = true
    void ScreenOrientation.getOrientationAsync().then((o) => {
      if (alive) setOrientation(ORIENTATION_NAMES[o] ?? String(o))
    })

    const sub = ScreenOrientation.addOrientationChangeListener((event) => {
      const name = ORIENTATION_NAMES[event.orientationInfo.orientation] ?? 'unnamed'
      setOrientation(name)
      append(`orientation → ${name}`)
    })

    return () => {
      alive = false
      ScreenOrientation.removeOrientationChangeListener(sub)
    }
  }, [append])

  const fire = useCallback(
    async (style: Haptics.ImpactFeedbackStyle, name: string) => {
      try {
        await Haptics.impactAsync(style)
        append(`haptic ${name} fired`)
      } catch (err) {
        append(`haptic ${name} FAILED: ${String(err)}`)
      }
    },
    [append],
  )

  /** Ten pulses at roughly cue cadence, to judge perceptibility in a run. */
  const fireCadence = useCallback(async () => {
    append('cadence run: 10 × Medium @ 600ms')
    for (let i = 0; i < 10; i++) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
    append('cadence run complete')
  }, [append])

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'M32-05 spike' }} />

      <Text style={styles.h1}>Orientation / keep-awake / haptics</Text>
      <Text style={styles.note}>
        Throwaway spike route (#182). Rotate the tablet, wait past the screen timeout, and fire the
        haptics. Every observation lands in the log below.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Current orientation</Text>
        <Text style={styles.value} testID="orientation-value">
          {orientation}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>State survival across rotation</Text>
        <Text style={styles.value}>
          local {localCount} · store {storeCount}
        </Text>
        <Text style={styles.note}>
          Bump both, rotate, then compare. If the local counter resets and the store counter does
          not, the activity is being recreated and only React state is at risk.
        </Text>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => setLocalCount((n) => n + 1)}>
            <Text style={styles.buttonText}>Bump local</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={bump}>
            <Text style={styles.buttonText}>Bump store</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Haptics</Text>
        <View style={styles.row}>
          <Pressable
            style={styles.button}
            onPress={() => void fire(Haptics.ImpactFeedbackStyle.Light, 'Light')}
          >
            <Text style={styles.buttonText}>Light</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => void fire(Haptics.ImpactFeedbackStyle.Medium, 'Medium')}
          >
            <Text style={styles.buttonText}>Medium</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() => void fire(Haptics.ImpactFeedbackStyle.Heavy, 'Heavy')}
          >
            <Text style={styles.buttonText}>Heavy</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => void fireCadence()}>
            <Text style={styles.buttonText}>Cadence ×10</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Keep-awake</Text>
        <Text style={styles.note}>
          Held while this route is focused. Leave the tablet untouched past its screen timeout; if
          the display stays on, keep-awake holds. Navigate back and it should sleep normally.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Log</Text>
        {log.map((line, i) => (
          <Text key={`${i}-${line}`} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 16, gap: 14 },
  h1: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  note: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  card: {
    gap: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  value: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  buttonText: { fontSize: 15, fontWeight: '700', color: colors.textOnAccent },
  logLine: { fontSize: 12, color: colors.textSecondary, fontFamily: 'monospace' },
})
