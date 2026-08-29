/**
 * App splash — the deterministic root the app opens on.
 *
 * Two jobs at once.
 *
 * First, it exists at all: without a root `index.tsx` the dev-client bootstrap
 * URL (`punchcraft://expo-development-client/?url=…`) got interpreted by
 * expo-router as an unknown route and dumped the athlete on `+not-found`.
 * A real index makes the app open on itself rather than on an error page.
 *
 * Second, it points the athlete at where the work happens. The bottom tabs
 * open on punchCraft anyway (`unstable_settings.initialRouteName`), but a
 * moment of app-owned chrome before the tab is the difference between
 * "the app loaded" and "the app opened".
 *
 * A tap continues immediately; otherwise a short auto-advance carries the
 * athlete in. Two hero variants — the portrait art was drawn as a portrait
 * and the landscape art was drawn as a landscape, so cropping either into
 * the other loses the composition. `useWindowDimensions` picks between them.
 */

import React, { useEffect, useRef } from 'react'
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'

const AUTO_ADVANCE_MS = 1_800
const DESTINATION = '/(tabs)/punchcraft' as const
/* eslint-disable @typescript-eslint/no-require-imports */
const HERO_PORTRAIT = require('../../assets/branding/splash-portrait.png') as number
const HERO_LANDSCAPE = require('../../assets/branding/splash-landscape-alt.png') as number
/* eslint-enable @typescript-eslint/no-require-imports */

export default function SplashScreen(): React.JSX.Element {
  const router = useRouter()
  const advancedRef = useRef(false)
  const { width, height } = useWindowDimensions()
  const isLandscape = width >= height

  const goToPunchCraft = React.useCallback((): void => {
    if (advancedRef.current) return
    advancedRef.current = true
    router.replace(DESTINATION)
  }, [router])

  useEffect(() => {
    const timer = setTimeout(goToPunchCraft, AUTO_ADVANCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [goToPunchCraft])

  return (
    <Pressable
      style={styles.root}
      onPress={goToPunchCraft}
      accessibilityRole="button"
      accessibilityLabel="Enter punchCraft"
      testID="splash-screen"
    >
      <View style={styles.center}>
        <Image
          source={isLandscape ? HERO_LANDSCAPE : HERO_PORTRAIT}
          style={styles.hero}
          resizeMode="contain"
          accessibilityLabel="punchCraft — Boxing skills app"
        />
      </View>
      <Text style={styles.hint}>Tap to continue</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    // Zero padding — the hero art carries its own edges and adding padding
    // would visibly frame it inside the black background rather than letting
    // it fill the screen.
    padding: 0,
  },
  center: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    width: '100%',
    height: '100%',
  },
  hint: {
    position: 'absolute',
    bottom: 40,
    fontSize: sizes.label,
    fontFamily: fonts.label,
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
})
