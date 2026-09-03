/**
 * Dev route. The backdrop test bench: punchcraft://dev/effects-lab
 *
 * Mounts the real BackdropRenderer against a local bus and fires
 * synthetic impulses from buttons, so the reactive layer can be tuned
 * without trackers, a workout, or the live screen. Quality is local
 * state — the renderer takes it as a prop precisely so this bench needs
 * no stores.
 *
 * Standard tier is now the PummelDarkness overlay (Skia membrane
 * retired). Raw bytes for each button are fixed (soft 6 / medium 9 /
 * hard 14 — the observed hardware range), so what you see is
 * repeatable.
 */
import React, { useMemo, useState } from 'react'
import { Stack } from 'expo-router'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import { BackdropRenderer } from '@components/workout/backdrop/BackdropRenderer'
import { createBackdropBus } from '@components/workout/backdrop/backdropBus'
import type { BackdropQuality } from '@domain/effects/backdropSettings'
import type { PunchHand } from '@domain/punch/PunchEvent'

const QUALITIES: BackdropQuality[] = ['off', 'reduced', 'standard']

/* eslint-disable @typescript-eslint/no-require-imports */
const BACKDROP = require('../../../assets/branding/backdrop-landscape.png') as number
/* eslint-enable @typescript-eslint/no-require-imports */

export default function EffectsLabScreen(): React.JSX.Element {
  const bus = useMemo(() => {
    const created = createBackdropBus()
    created.setActive(true)
    return created
  }, [])
  const [quality, setQuality] = useState<BackdropQuality>('standard')

  const hit = (hand: PunchHand, velocityRaw: number): void => {
    bus.impulse({ hand, velocityRaw })
  }
  const sequence = (steps: Array<{ hand: PunchHand; raw: number }>, gapMs: number): void => {
    steps.forEach((step, i) => {
      setTimeout(() => hit(step.hand, step.raw), i * gapMs)
    })
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Effects lab' }} />
      {/* Backdrop art behind the reactive layer so the darkening has
          something to darken. Matches the live screen's layer stack. */}
      <Image
        source={BACKDROP}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        accessibilityLabel=""
      />
      <BackdropRenderer bus={bus} quality={quality} />

      <View style={styles.controls} pointerEvents="box-none">
        <View style={styles.row}>
          {QUALITIES.map((q) => (
            <Pressable
              key={q}
              onPress={() => setQuality(q)}
              style={[styles.chip, quality === q && styles.chipActive]}
            >
              <Text style={styles.chipText}>{q}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <Pressable onPress={() => hit('left', 6)} style={[styles.pad, styles.leftPad]}>
            <Text style={styles.padText}>L soft</Text>
          </Pressable>
          <Pressable onPress={() => hit('left', 14)} style={[styles.pad, styles.leftPad]}>
            <Text style={styles.padText}>L hard</Text>
          </Pressable>
          <Pressable onPress={() => hit('right', 6)} style={[styles.pad, styles.rightPad]}>
            <Text style={styles.padText}>R soft</Text>
          </Pressable>
          <Pressable onPress={() => hit('right', 14)} style={[styles.pad, styles.rightPad]}>
            <Text style={styles.padText}>R hard</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              sequence(
                [
                  { hand: 'left', raw: 10 },
                  { hand: 'right', raw: 12 },
                ],
                250,
              )
            }
            style={styles.pad}
          >
            <Text style={styles.padText}>L-R meet</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              sequence(
                Array.from({ length: 12 }, (_, i) => ({
                  hand: (i % 2 === 0 ? 'left' : 'right') as PunchHand,
                  raw: 10 + (i % 3) * 3,
                })),
                120,
              )
            }
            style={styles.pad}
          >
            <Text style={styles.padText}>Flurry</Text>
          </Pressable>
          <Pressable onPress={() => hit('unknown', 9)} style={styles.pad}>
            <Text style={styles.padText}>Unknown</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  controls: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    padding: 16,
    // Clear of the tablet's floating OS taskbar, which overlays the
    // window's bottom edge (same clipping the live control strip hit).
    paddingBottom: 100,
    gap: 10,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  chipText: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textPrimary },
  pad: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceElevated,
  },
  leftPad: { borderColor: colors.trackerLeft },
  rightPad: { borderColor: colors.trackerRight },
  padText: { fontSize: sizes.body, fontFamily: fonts.heading, color: colors.textPrimary },
})
