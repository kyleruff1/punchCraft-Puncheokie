/**
 * Dev route: `punchcraft://dev/transport-tick`
 *
 * Smoke test for the frame-clock plumbing shipped in W0-b (Kyle
 * amended plan 2026-08-30, principles #3 + #4). Wires the pipe
 * end-to-end on device WITHOUT touching the live workout screen:
 *
 *   MetronomeTransport
 *          │  subscribe (W0-b-ii)
 *          ▼
 *   useSharedTransportAnchor  →  SharedValue<SharedTransportAnchor>
 *          │
 *          │  (Reanimated cross-runtime, atomic whole-struct)
 *          ▼
 *   useFrameCallback (UI-thread worklet)
 *          │  sharedAnchorCurrentTick(anchor, frame.timestamp)
 *          ▼
 *   Animated text — updates every frame via animatedProps
 *
 * If this screen shows the tick counting up smoothly at the
 * expected rate (960 ticks/s at 60 BPM), the whole W0-b pipe is
 * healthy: the audio-side subscribe fires; the publisher writes
 * atomic anchors in the frame-timestamp domain; the worklet's
 * arithmetic is right; the UI thread is producing frames.
 *
 * Buttons drive a STANDALONE transport instance — no audio, no
 * runner, no VoiceOutputExpo. The full-stack integration lands
 * in W0-b-iii's next commit (wiring the shared anchor into the
 * ring + avatar consumers on the live screen). This route stays
 * as the isolation dial-tone for the anchor pipeline.
 *
 * Not registered in any menu — navigate directly via the deep
 * link or the router path.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Stack } from 'expo-router'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated'

import { MetronomeTransport } from '@audio/MetronomeTransport'
import { useSharedTransportAnchor } from '@audio/useSharedTransportAnchor'
import type { MetronomeTransportSnapshot } from '@domain/coach/VoiceOutputPort'
import { sharedAnchorCurrentTick } from '@domain/timing/SharedTransportAnchor'
import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

/**
 * Displays the transport's currentTick per frame. Bypasses React
 * state entirely — the worklet reads the shared anchor, computes
 * the tick, and pushes it into animatedProps on the UI thread.
 * No re-render per frame; no `runOnJS`; no throttle.
 */
function FrameTickReadout({
  anchor,
}: {
  anchor: ReturnType<typeof useSharedTransportAnchor>
}): React.JSX.Element {
  const frameTickTenths = useSharedValue(0)
  useFrameCallback(({ timestamp }) => {
    'worklet'
    const tick = sharedAnchorCurrentTick(anchor.value, timestamp)
    // Store integer tenths of a tick so animatedProps' text
    // update stays JSON-safe and the display doesn't dance on
    // sub-decimal noise. The frame callback runs every ~16 ms;
    // the display is updated per frame regardless of how coarse
    // the number reads.
    frameTickTenths.value = Math.round(tick * 10)
  })
  const animatedProps = useAnimatedProps(() => {
    const whole = Math.floor(frameTickTenths.value / 10)
    const tenth = Math.abs(frameTickTenths.value % 10)
    const text = `${whole}.${tenth} ticks`
    return { text, defaultValue: text }
  })
  return (
    <AnimatedTextInput
      editable={false}
      animatedProps={animatedProps}
      style={styles.tickReadout}
    />
  )
}

export default function TransportTickDev(): React.JSX.Element {
  // One transport per screen mount. useRef so the same instance
  // survives every re-render; buttons and hooks all address the
  // same object.
  const transportRef = useRef<MetronomeTransport | null>(null)
  if (transportRef.current === null) {
    transportRef.current = new MetronomeTransport()
  }
  const transport = transportRef.current

  const anchor = useSharedTransportAnchor(transport)

  // Snapshot for the JS-thread readouts (state name, generation,
  // ticks/sec). Subscribes to the same events the publisher hook
  // subscribes to — two subscribers, both notified.
  const [snapshot, setSnapshot] = useState<MetronomeTransportSnapshot>(() =>
    transport.snapshot(),
  )
  useEffect(() => {
    const unsubscribe = transport.subscribe(setSnapshot)
    return unsubscribe
  }, [transport])

  const buttons = useMemo(
    () => [
      { label: 'Start 60 BPM', onPress: () => transport.start(60) },
      { label: 'Start 120 BPM', onPress: () => transport.start(120) },
      { label: 'Start 240 BPM', onPress: () => transport.start(240) },
      { label: 'Pause', onPress: () => transport.pause() },
      { label: 'Resume', onPress: () => transport.resume() },
      { label: 'Stop', onPress: () => transport.stop() },
    ],
    [transport],
  )

  return (
    <>
      <Stack.Screen options={{ title: 'Transport tick (W0-b)' }} />
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.label}>Frame-callback tick</Text>
          <FrameTickReadout anchor={anchor} />
          <Text style={styles.hint}>
            Should count up at 960 ticks/s at 60 BPM (~1.04 ms/tick).
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Snapshot (JS thread)</Text>
          <Text style={styles.value}>state: {snapshot.state}</Text>
          <Text style={styles.value}>generation: {snapshot.generation}</Text>
          <Text style={styles.value}>baseBpm: {snapshot.baseBpm}</Text>
          <Text style={styles.value}>ticks/s: {snapshot.ticksPerSecond}</Text>
        </View>

        <View style={styles.buttons}>
          {buttons.map((b) => (
            <Pressable
              key={b.label}
              onPress={b.onPress}
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            >
              <Text style={styles.buttonText}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  label: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: sizes.micro,
    textTransform: 'uppercase',
  },
  value: {
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: sizes.body,
  },
  tickReadout: {
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: sizes.hero,
    padding: 0,
    margin: 0,
  },
  hint: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: sizes.micro,
    marginTop: 4,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.textPrimary,
    fontFamily: fonts.mono,
    fontSize: sizes.body,
  },
})
