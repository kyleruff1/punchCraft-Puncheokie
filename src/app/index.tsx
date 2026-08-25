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
 * athlete in. The logo is the whole content — the wordmark is baked into it,
 * so there is no separate title to keep in sync.
 */

import React, { useEffect, useRef } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { colors } from '@/theme/colors'

const AUTO_ADVANCE_MS = 1_800
const DESTINATION = '/(tabs)/punchcraft' as const
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO = require('../../assets/branding/punchcraft-logo.png') as number

export default function SplashScreen(): React.JSX.Element {
  const router = useRouter()
  const advancedRef = useRef(false)

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
          source={LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="punchCraft"
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
    paddingHorizontal: 20,
  },
  center: {
    // Bounded so a landscape tablet keeps the logo the primary object rather
    // than stretching to fill and losing the wordmark's proportions.
    width: '100%',
    maxWidth: 720,
    aspectRatio: 5 / 3, // matches the 2000×1200 source
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  hint: {
    position: 'absolute',
    bottom: 40,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
})
