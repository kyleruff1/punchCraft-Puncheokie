import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { TrackerBadgesRow } from '../../../components/TrackerBadgesRow'
import { colors } from '@/theme/colors'

export default function PunchCraftLanding() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'punchCraft',
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
      <Text style={styles.title}>punchCraft</Text>
      <Text style={styles.paragraph}>
        punchCraft is the studio surface for building freeform combos, drills, and structured
        workouts on top of the tracker stream. Sessions here layer combos, timing, and history
        on top of raw tracker frames while the capture sink continues to persist everything.
      </Text>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Coming after Sprint 1.</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  paragraph: { fontSize: 15, lineHeight: 22, color: colors.textPrimary },
  placeholder: {
    marginTop: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  placeholderText: { fontSize: 14, fontStyle: 'italic', color: colors.textSecondary },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { fontSize: 15, fontWeight: '600', color: colors.accent },
})
