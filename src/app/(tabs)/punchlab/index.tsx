import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { TrackerBadgesRow } from '../../../components/TrackerBadgesRow'

export default function PunchLabLanding() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'PunchLab',
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
      <Text style={styles.title}>PunchLab</Text>
      <Text style={styles.paragraph}>
        PunchLab is the studio surface for building freeform combos, drills, and structured
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
  container: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  paragraph: { fontSize: 15, lineHeight: 22 },
  placeholder: {
    marginTop: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#888',
    borderStyle: 'dashed',
    borderRadius: 8,
  },
  placeholderText: { fontSize: 14, fontStyle: 'italic' },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { fontSize: 15, fontWeight: '600' },
})
