/**
 * BackdropRenderer — the §31 seam between the live screen and whatever
 * backdrop is active.
 *
 * Owns exactly one decision: which tier actually renders. `off` is
 * today's static screen, `reduced` is a still glow (also what reduced
 * motion forces, §31.4), `standard` is the PummelDarkness overlay
 * (frugal compositor-only replacement for the retired Skia membrane;
 * see PROVENANCE in PummelDarkness.tsx header). The live screen passes
 * the persisted quality and the motion preference; nothing else about
 * the backdrop leaks out of this directory.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'

import type { BackdropQuality } from '@domain/effects/backdropSettings'
import { PummelDarkness } from './PummelDarkness'
import { StaticGlow } from './StaticGlow'
import type { BackdropBus } from './backdropBus'

/**
 * Resolve the effective tier. `degrade` is the auto-degrade seam
 * (§31.4): always `'none'` today — when a frame-time sampler lands it
 * feeds this argument to step standard → reduced → off under pressure,
 * and nothing else has to change.
 */
export function resolveBackdropQuality(
  quality: BackdropQuality,
  reducedMotion: boolean,
  degrade: 'none' | 'reduced' | 'off' = 'none',
): BackdropQuality {
  if (quality === 'off' || degrade === 'off') return 'off'
  if (quality === 'reduced' || reducedMotion || degrade === 'reduced') return 'reduced'
  return 'standard'
}

export function BackdropRenderer({
  bus,
  quality,
  reducedMotion = false,
}: {
  bus: BackdropBus
  quality: BackdropQuality
  reducedMotion?: boolean
}): React.JSX.Element | null {
  const effective = resolveBackdropQuality(quality, reducedMotion)
  if (effective === 'off') return null
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="live-backdrop">
      {effective === 'reduced' ? (
        <StaticGlow />
      ) : (
        <PummelDarkness bus={bus} reducedMotion={reducedMotion} />
      )}
    </View>
  )
}
