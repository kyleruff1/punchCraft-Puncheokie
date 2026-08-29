/**
 * Dev route. The backdrop test bench: punchcraft://dev/effects-lab
 *
 * Mounts the real BackdropRenderer against a local bus and fires
 * synthetic impulses from buttons, so HydroPulse can be tuned and the
 * Skia APIs proven on-device without trackers, a workout, or the live
 * screen. Quality and phase-calm are local state — the renderer takes
 * them as props precisely so this bench needs no stores.
 *
 * Plain Math.random-free: raw bytes are fixed per button (soft 6 /
 * medium 9 / hard 14 — the observed hardware range), so what you see is
 * repeatable.
 */
import React, { useMemo, useState } from 'react'
import { Stack } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import { BackdropRenderer } from '@components/workout/backdrop/BackdropRenderer'
import type { MembranePresetName } from '@components/workout/backdrop/HydroPulseScene'
import { createBackdropBus } from '@components/workout/backdrop/backdropBus'
import type { BackdropQuality } from '@domain/effects/backdropSettings'
import type { PummelSensitivity } from '@domain/effects/membraneMath'
import type { PunchHand } from '@domain/punch/PunchEvent'

const QUALITIES: BackdropQuality[] = ['off', 'reduced', 'standard']
const CALMS = [
  { label: 'Work', value: 1 },
  { label: 'Rest', value: 0.35 },
  { label: 'Idle', value: 0.15 },
]
const PRESETS: MembranePresetName[] = ['controlled', 'reactive', 'gelatin']
const GRAINS = [
  { label: 'grain off', opacity: 0 },
  { label: 'grain subtle', opacity: 0.7 },
  { label: 'grain strong', opacity: 1 },
]
const SENSITIVITIES: PummelSensitivity[] = ['low', 'standard', 'high']

export default function EffectsLabScreen(): React.JSX.Element {
  const bus = useMemo(() => {
    const created = createBackdropBus()
    created.setActive(true)
    return created
  }, [])
  const [quality, setQuality] = useState<BackdropQuality>('standard')
  const [calm, setCalm] = useState(1)
  const [preset, setPreset] = useState<MembranePresetName>('reactive')
  const [grainOpacity, setGrainOpacity] = useState(1)
  const [sensitivity, setSensitivity] = useState<PummelSensitivity>('standard')

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
      <BackdropRenderer
        bus={bus}
        quality={quality}
        calm={calm}
        preset={preset}
        sensitivity={sensitivity}
        tuning={{ grainOpacity }}
      />

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
          {CALMS.map((c) => (
            <Pressable
              key={c.label}
              onPress={() => setCalm(c.value)}
              style={[styles.chip, calm === c.value && styles.chipActive]}
            >
              <Text style={styles.chipText}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          {PRESETS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setPreset(p)}
              style={[styles.chip, preset === p && styles.chipActive]}
            >
              <Text style={styles.chipText}>{p}</Text>
            </Pressable>
          ))}
          {GRAINS.map((g) => (
            <Pressable
              key={g.label}
              onPress={() => setGrainOpacity(g.opacity)}
              style={[styles.chip, grainOpacity === g.opacity && styles.chipActive]}
            >
              <Text style={styles.chipText}>{g.label}</Text>
            </Pressable>
          ))}
          {SENSITIVITIES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setSensitivity(s)}
              style={[styles.chip, sensitivity === s && styles.chipActive]}
            >
              <Text style={styles.chipText}>{`pummel ${s}`}</Text>
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
                Array.from({ length: 8 }, (_, i) => ({
                  hand: (i % 2 === 0 ? 'left' : 'right') as PunchHand,
                  raw: 8 + (i % 3) * 3,
                })),
                150,
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
