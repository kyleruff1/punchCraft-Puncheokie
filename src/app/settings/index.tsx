import { Link } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { getBuildInfo } from '@diagnostics/buildInfo'
import { colors } from '@/theme/colors'

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
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
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
      <Link href="/settings/voice" asChild>
        <Pressable style={styles.linkButton} testID="voice-settings-link">
          <Text style={styles.linkButtonText}>Voice Coach</Text>
        </Pressable>
      </Link>
      <Link href="/settings/backdrop" asChild>
        <Pressable style={styles.linkButton} testID="backdrop-settings-link">
          <Text style={styles.linkButtonText}>Workout backdrop</Text>
        </Pressable>
      </Link>
      <Link href="/(tabs)/velocity-lab" asChild>
        <Pressable style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Back to Velocity Lab</Text>
        </Pressable>
      </Link>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  rowLabel: { fontSize: 14, fontWeight: '600', flexShrink: 0, color: colors.textPrimary },
  rowValue: { fontSize: 14, flexShrink: 1, textAlign: 'right', color: colors.textSecondary },
  linkButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  linkButtonText: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
})
