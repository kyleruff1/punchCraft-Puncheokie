import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { Wordmark } from '@/components/branding/Wordmark'
import { TrackerBadgesRow } from '../../../components/TrackerBadgesRow'
import { colors } from '@/theme/colors'
import { fonts, recipes, sizes } from '@/theme/typography'

/**
 * Puncheokie — not shipped yet.
 *
 * Building and running workouts lives in punchCraft. Puncheokie is a
 * separate punch-along mode that will reuse the same cue engine; until it
 * ships this tab is a placeholder and owns no routes of its own.
 */
export default function PuncheokieLanding() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'Puncheokie',
          headerTitle: () => <Wordmark app="puncheokie" size="hdr" />,
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable style={styles.headerLink}>
                <Text style={styles.headerLinkText}>Settings</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <TrackerBadgesRow />
      <Text style={styles.paragraph}>Punch-along mode — follow the called combinations.</Text>
      <View style={styles.placeholder} testID="coming-soon">
        <Text style={styles.placeholderText}>Coming soon.</Text>
      </View>
      <Text style={styles.paragraph}>To build or run a workout today, use the punchCraft tab.</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16 },
  paragraph: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  placeholder: {
    marginTop: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  placeholderText: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    fontStyle: 'italic',
    color: colors.textSecondary,
  },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { ...recipes.buttonSubtle, color: colors.accent },
})
