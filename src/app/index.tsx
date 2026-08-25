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
 * athlete in. Kept small — this is not a marketing page, it is a room
 * you walk through.
 */

import React, { useEffect, useRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

import { colors } from '@/theme/colors'

const AUTO_ADVANCE_MS = 1_500
const DESTINATION = '/(tabs)/punchcraft' as const

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
        <Text style={styles.title}>punchCraft</Text>
        <Text style={styles.tagline}>Build a workout · Own the round</Text>
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
    paddingHorizontal: 24,
  },
  center: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 44,
    fontWeight: '800',
    color: colors.accent,
    letterSpacing: 1.0,
  },
  tagline: {
    fontSize: 14,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  hint: {
    position: 'absolute',
    bottom: 40,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
})
