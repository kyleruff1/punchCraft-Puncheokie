/**
 * The one bubble sprite, drawn at runtime — no asset file.
 *
 * `useTexture` renders the element offscreen once per mount and hands
 * back a `SharedValue<SkImage | null>`, which is exactly what `<Atlas>`
 * wants. Tint is baked into the texture (one per hand) so the per-frame
 * atlas path never touches a colors array.
 */
import React from 'react'
import { Circle, Group, useTexture } from '@shopify/react-native-skia'
import type { SkImage } from '@shopify/react-native-skia'
import type { SharedValue } from 'react-native-reanimated'

export const BUBBLE_SPRITE_SIZE = 32

export function useBubbleTexture(tint: string): SharedValue<SkImage | null> {
  return useTexture(
    <Group>
      {/* A soft glassy bubble: translucent body, brighter rim, one
          highlight — reads at a glance even at particle scale. */}
      <Circle cx={16} cy={16} r={13} color={tint} opacity={0.3} />
      <Circle cx={16} cy={16} r={13} style="stroke" strokeWidth={2} color={tint} opacity={0.85} />
      <Circle cx={11} cy={11} r={3.5} color="#FBFDFD" opacity={0.8} />
    </Group>,
    { width: BUBBLE_SPRITE_SIZE, height: BUBBLE_SPRITE_SIZE },
  )
}
