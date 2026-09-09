import { Link } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import { LAUNCH_PATCHES } from '@domain/instrument/punchPatch'
import { useInstrumentSettingsStore } from '@state/useInstrumentSettingsStore'

/**
 * Puncheoke — the punch-driven instrument (Harmonic Cube / Note Cube).
 *
 * The landing lists the launch patches and opens the Jam screen. Design
 * authority: docs/puncheoke/instrument-design.md + note-cube-design.md.
 */
export default function PuncheokieLanding() {
  const patchId = useInstrumentSettingsStore((s) => s.patchId)
  const setPatchId = useInstrumentSettingsStore((s) => s.setPatchId)

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Puncheoke</Text>
      <Text style={styles.paragraph}>
        A two-handed sample-and-hold instrument. Every punch lands on a musical coordinate; the
        note holds until the next punch bends it somewhere new.
      </Text>
      <Link href="/(tabs)/puncheokie/jam" asChild>
        <Pressable style={styles.jamButton} testID="open-jam">
          <Text style={styles.jamButtonText}>Open the Jam</Text>
        </Pressable>
      </Link>
      <Text style={styles.sectionLabel}>Punch patch</Text>
      <View style={styles.patchList}>
        {LAUNCH_PATCHES.map((patch) => (
          <Pressable
            key={patch.id}
            onPress={() => setPatchId(patch.id)}
            style={[styles.patchRow, patchId === patch.id && styles.patchRowActive]}
            testID={`patch-${patch.id}`}
          >
            <Text style={styles.patchName}>{patch.name}</Text>
            <Text style={styles.patchMeta}>
              {`${patch.pitchSetId} · ${patch.topologyId} · ${patch.harmony.mode}`}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 14 },
  heading: { fontSize: sizes.title, fontFamily: fonts.heading, color: colors.textPrimary },
  paragraph: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  jamButton: {
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
    alignItems: 'center',
  },
  jamButtonText: { fontSize: sizes.body, fontFamily: fonts.heading, color: colors.textPrimary },
  sectionLabel: {
    marginTop: 6,
    fontSize: sizes.label,
    fontFamily: fonts.label,
    color: colors.textSecondary,
  },
  patchList: { gap: 8 },
  patchRow: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  patchRowActive: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  patchName: { fontSize: sizes.body, fontFamily: fonts.heading, color: colors.textPrimary },
  patchMeta: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
})
