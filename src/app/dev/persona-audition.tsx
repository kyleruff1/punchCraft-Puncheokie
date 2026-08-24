/**
 * Persona audition — round two: expression. **Dev route.**
 *
 * Round one compared four blends and aged-melodic won across the board, so the
 * timbre question is settled and that axis is gone. What remained was that the
 * winning voice was still too flat — which no blend would have fixed, because
 * a different voice only gives a different monotone.
 *
 * So this compares **three depths of pitch movement** on the one voice, plus
 * the reworked movement handling: a real beat on either side of a defense
 * token, and the token itself landing hard instead of sitting in the list.
 *
 * Run it **with music playing**. Every one of these clips has to survive a
 * gym mix, and a voice that reads beautifully in silence can vanish under a
 * track.
 *
 * What to listen for: whether the accents land on the right punches, whether
 * the beat around the roll reads as a break or as a stumble, final-punch
 * authority, and — the one that only shows up on repeat — whether the
 * theatrical setting becomes tiring after twenty calls.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'

import { colors } from '@/theme/colors'
import { auditionAssets, type AuditionAsset } from '@audio/voiceAssets/auditionManifest'

/** Long enough that two takes do not blur into one impression. */
const BETWEEN_TAKES_MS = 700

const uniq = (values: readonly string[]): string[] => [...new Set(values)]

const PHRASES = uniq(auditionAssets.map((a) => a.combination))
const VOCABULARIES = uniq(auditionAssets.map((a) => a.vocabulary))
const PERFORMANCES = uniq(auditionAssets.map((a) => a.performance))
const EXPRESSIONS = uniq(auditionAssets.map((a) => a.expression))

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export default function PersonaAuditionScreen(): React.JSX.Element {
  const [vocabulary, setVocabulary] = useState(VOCABULARIES[0] ?? 'numbers')
  const [performance, setPerformance] = useState('work')
  const [nowPlaying, setNowPlaying] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)

  /**
   * One player at a time, released after each take.
   *
   * Holding a player per asset would exhaust the device's AudioTrack budget —
   * 48 of them was enough to make the app silent while every individual call
   * still looked successful.
   */
  const playOne = useCallback(async (asset: AuditionAsset): Promise<void> => {
    setNowPlaying(asset.cueId)
    try {
      playerRef.current?.remove()
    } catch {
      // Already gone.
    }
    const player = createAudioPlayer(asset.module)
    playerRef.current = player

    // `play()` on a player that has not finished loading does nothing and
    // reports nothing.
    for (let i = 0; i < 60 && !player.isLoaded; i += 1) await sleep(25)
    if (!player.isLoaded) {
      setNote(`${asset.cueId}: never loaded`)
      return
    }
    player.play()
    await sleep(asset.durationMs + 250)
    try {
      player.remove()
    } catch {
      // Already gone.
    }
    playerRef.current = null
  }, [])

  const selectionFor = useCallback(
    (combination: string, expression: string): AuditionAsset | undefined =>
      auditionAssets.find(
        (a) =>
          a.combination === combination &&
          a.expression === expression &&
          a.vocabulary === vocabulary &&
          a.performance === performance,
      ),
    [vocabulary, performance],
  )

  const compareExpressions = useCallback(
    async (combination: string): Promise<void> => {
      setNote(null)
      for (const expression of EXPRESSIONS) {
        const asset = selectionFor(combination, expression)
        if (!asset) continue
        await playOne(asset)
        await sleep(BETWEEN_TAKES_MS)
      }
      setNowPlaying(null)
    },
    [playOne, selectionFor],
  )

  const comparePerformances = useCallback(
    async (combination: string, expression: string): Promise<void> => {
      setNote(null)
      for (const state of PERFORMANCES) {
        const asset = auditionAssets.find(
          (a) =>
            a.combination === combination &&
            a.expression === expression &&
            a.vocabulary === vocabulary &&
            a.performance === state,
        )
        if (!asset) continue
        await playOne(asset)
        await sleep(BETWEEN_TAKES_MS)
      }
      setNowPlaying(null)
    },
    [playOne, vocabulary],
  )

  React.useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' })
  }, [])

  const sample = useMemo(
    () => selectionFor(PHRASES[0] ?? '', EXPRESSIONS[0] ?? ''),
    [selectionFor],
  )

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Persona audition' }} />

      <Text style={styles.heading}>Old-School Cornerman — expression</Text>
      <Text style={styles.note}>
        aged-melodic, at three depths of pitch movement. Play with music running; each row plays
        the same phrase across all three back to back, so the comparison is direct rather than
        from memory. Judge the phrases with a defense token hardest — the beat and the hard
        landing are what changed.
      </Text>
      {note ? <Text style={styles.warn}>{note}</Text> : null}

      <Text style={styles.sectionLabel}>Callouts</Text>
      <View style={styles.row}>
        {VOCABULARIES.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => setVocabulary(option)}
            style={[styles.chip, option === vocabulary && styles.chipActive]}
          >
            <Text style={[styles.chipText, option === vocabulary && styles.chipTextActive]}>
              {option === 'numbers' ? 'Punch numbers' : 'Technique names'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Performance</Text>
      <View style={styles.row}>
        {PERFORMANCES.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => setPerformance(option)}
            style={[styles.chip, option === performance && styles.chipActive]}
          >
            <Text style={[styles.chipText, option === performance && styles.chipTextActive]}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      {sample ? <Text style={styles.detail}>{`e.g. ${sample.spokenText}`}</Text> : null}

      {PHRASES.map((combination) => {
        const first = selectionFor(combination, EXPRESSIONS[0] ?? '')
        return (
          <View key={combination} style={styles.card}>
            <Text style={styles.cardTitle}>{combination}</Text>
            {first ? (
              <Text style={styles.detail}>{`${first.spokenText}  ·  ${first.durationMs} ms`}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={nowPlaying !== null}
              onPress={() => void compareExpressions(combination)}
              style={[styles.button, nowPlaying !== null && styles.buttonDisabled]}
            >
              <Text style={styles.buttonText}>Compare all three</Text>
            </Pressable>

            <View style={styles.row}>
              {EXPRESSIONS.map((expression) => {
                const asset = selectionFor(combination, expression)
                const playing = nowPlaying === asset?.cueId
                return (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!asset || nowPlaying !== null}
                    key={expression}
                    onLongPress={() => void comparePerformances(combination, expression)}
                    onPress={() => asset && void playOne(asset).then(() => setNowPlaying(null))}
                    style={[
                      styles.blendButton,
                      playing && styles.blendButtonActive,
                      (!asset || nowPlaying !== null) && styles.buttonDisabled,
                    ]}
                  >
                    <Text style={styles.blendText}>{expression}</Text>
                    <Text style={styles.blendHint}>
                      {asset ? `${asset.durationMs} ms` : 'missing'}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      })}

      <Text style={styles.note}>
        Long-press an expression to hear teach / work / push back to back at that depth. The
        contrast between states matters as much as the depth, and the beat around a defense token
        is deliberately widest in teach and tightest in push.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 10, paddingBottom: 60 },
  heading: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  note: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  warn: { fontSize: 12, color: colors.warning },
  sectionLabel: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextActive: { color: colors.accent, fontWeight: '700' },
  card: { gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  detail: { fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 13, fontWeight: '700', color: colors.textOnAccent },
  blendButton: {
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 150,
  },
  blendButtonActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  blendText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  blendHint: { fontSize: 10, color: colors.textMuted, fontFamily: 'monospace' },
})
