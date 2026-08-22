import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

export default function VelocityLabLanding() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'Velocity Lab',
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable style={styles.headerLink}>
                <Text style={styles.headerLinkText}>Settings</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <Text style={styles.title}>Velocity Lab</Text>
      <Text style={styles.paragraph}>
        Velocity Lab is the raw-tracker workbench. Connect a FightCamp v1 punch tracker over BLE,
        watch every notification frame stream in with its monotonic timestamp, and inspect
        tracker-reported velocity in tracker units alongside the raw bytes that produced it.
        No workout, no scoring, no interpretation — just the transport, the parser, and the
        capture sink that persists every frame before anything else touches it.
      </Text>

      <View style={styles.linkRow}>
        <Link href="/(tabs)/velocity-lab/spike" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Run BLE spike</Text>
          </Pressable>
        </Link>
        <Link href="/settings" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Diagnostics</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  paragraph: { fontSize: 15, lineHeight: 22 },
  linkRow: { gap: 12, marginTop: 8 },
  linkButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
  },
  linkButtonText: { fontSize: 16, fontWeight: '600' },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { fontSize: 15, fontWeight: '600' },
})
