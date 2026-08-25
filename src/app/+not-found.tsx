import { Link, Stack } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { ForgedButton } from '@/components/branding/ForgedButton'
import { Wordmark } from '@/components/branding/Wordmark'
import { colors } from '@/theme/colors'
import { fonts, recipes, sizes, weights } from '@/theme/typography'

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
        <ForgedButton variant="primary" accessibilityLabel="Go to punchCraft">
          <View style={styles.goRow}>
            <Text style={styles.goText}>Go to </Text>
            <Wordmark app="punchCraft" size="sm" />
          </View>
        </ForgedButton>
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
  title: {
    fontSize: sizes.title,
    fontFamily: fonts.heading,
    fontWeight: weights.bold,
    color: colors.textPrimary,
  },
  goRow: { flexDirection: 'row', alignItems: 'center' },
  goText: { ...recipes.buttonPrimary, color: colors.textOnAccent },
})
