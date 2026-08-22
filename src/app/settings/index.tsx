import { Link } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { getBuildInfo } from '@diagnostics/buildInfo'

export default function SettingsLanding() {
  const info = getBuildInfo()
  const rows: Array<[string, string]> = [
    ['App name', info.appName],
    ['App version', info.appVersion],
    ['Git SHA', info.gitSha],
    ['Release channel', info.releaseChannel],
    ['Runtime version', info.runtimeVersion],
    ['Expo SDK', info.expoSdk],
    ['React Native', info.reactNative],
    ['Platform', info.platform],
    ['Platform version', String(info.platformVersion)],
    ['Android API level', info.androidApiLevel !== undefined ? String(info.androidApiLevel) : '-'],
    ['Bundle id', info.bundleId ?? '-'],
    ['Installation id', info.installationId ?? '-'],
  ]

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Diagnostics</Text>
      <View style={styles.list}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue} selectable>
              {value}
            </Text>
          </View>
        ))}
      </View>
      <Link href="/(tabs)/velocity-lab" asChild>
        <Pressable style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Back to Velocity Lab</Text>
        </Pressable>
      </Link>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  list: { borderWidth: 1, borderColor: '#333', borderRadius: 8, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#666',
    gap: 12,
  },
  rowLabel: { fontSize: 14, fontWeight: '600', flexShrink: 0 },
  rowValue: { fontSize: 14, flexShrink: 1, textAlign: 'right' },
  linkButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    alignItems: 'center',
  },
  linkButtonText: { fontSize: 16, fontWeight: '600' },
})
