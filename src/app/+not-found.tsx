import { Link, Stack } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Wordmark } from '@/components/branding/Wordmark'
import { colors } from '@/theme/colors'

/**
 * Fallback for a URL that resolves to no route.
 *
 * Sends the athlete to punchCraft rather than Velocity Lab — that is where
 * the workout lives. Velocity Lab is a diagnostic bench, not the front door,
 * and landing an unrecognised deep link on the diagnostic bench was
 * confusing every time it happened. The splash at `/` is what the app
 * ordinarily opens on; this is only for a link that missed altogether.
 */
export default function NotFound() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Text style={styles.title}>Route not found</Text>
      <Link href="/(tabs)/punchcraft" asChild>
        <Pressable style={styles.linkButton} accessibilityLabel="Go to punchCraft">
          <Text style={styles.linkButtonText}>Go to </Text>
          <Wordmark app="punchCraft" size="sm" />
        </Pressable>
      </Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    gap: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  linkButtonText: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
})
