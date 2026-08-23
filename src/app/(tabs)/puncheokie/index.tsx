import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { TrackerBadgesRow } from '../../../components/TrackerBadgesRow'
import { colors } from '@/theme/colors'

export default function PuncheokieLanding() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'Puncheokie',
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
      <Text style={styles.title}>Puncheokie</Text>
      <Text style={styles.paragraph}>
        Puncheokie is punch-along-to-the-song mode: a Spotify-authenticated experience where
        combos are choreographed to a track and the tracker stream scores your timing against
        the beat. It sits on top of punchCraft combos and the same tracker frames Velocity Lab
        surfaces raw.
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
