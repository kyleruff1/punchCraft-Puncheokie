/**
 * Persona audition — the decisive listening test. **Dev route.**
 *
 * Four candidate voice blends × two callout vocabularies × three performance
 * states, over six phrases. The whole point is comparison, so the controls
 * pick a phrase and then play the **same phrase across all four blends back
 * to back** — judging a voice in isolation is how you end up choosing the
 * first one you heard.
 *
 * Run it **with music playing**. Every one of these clips has to survive a
 * gym mix, and a voice that reads beautifully in silence can vanish under a
 * track.
 *
 * What to listen for: perceived age, intelligibility, sing-song character,
 * forward momentum, final-punch authority, warmth between commands,
 * distinctness of one/two/three/five, defense-command clarity, and — the one
 * that only shows up on repeat — fatigue after hearing it many times.
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

const BLENDS = uniq(auditionAssets.map((a) => a.blend))
const PHRASES = uniq(auditionAssets.map((a) => a.combination))
const VOCABULARIES = uniq(auditionAssets.map((a) => a.vocabulary))
const PERFORMANCES = uniq(auditionAssets.map((a) => a.performance))

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
    (combination: string, blend: string): AuditionAsset | undefined =>
      auditionAssets.find(
        (a) =>
          a.combination === combination &&
          a.blend === blend &&
          a.vocabulary === vocabulary &&
          a.performance === performance,
      ),
    [vocabulary, performance],
  )

  const compareBlends = useCallback(
    async (combination: string): Promise<void> => {
      setNote(null)
      for (const blend of BLENDS) {
        const asset = selectionFor(combination, blend)
        if (!asset) continue
        await playOne(asset)
        await sleep(BETWEEN_TAKES_MS)
      }
      setNowPlaying(null)
    },
    [playOne, selectionFor],
  )

  const comparePerformances = useCallback(
    async (combination: string, blend: string): Promise<void> => {
      setNote(null)
      for (const state of PERFORMANCES) {
        const asset = auditionAssets.find(
          (a) =>
            a.combination === combination &&
            a.blend === blend &&
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

  const sample = useMemo(() => selectionFor(PHRASES[0] ?? '', BLENDS[0] ?? ''), [selectionFor])

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Persona audition' }} />

      <Text style={styles.heading}>Old-School Cornerman — blend audition</Text>
      <Text style={styles.note}>
        Play with music running. Each row plays the same phrase across all four blends back to
        back, so the comparison is direct rather than from memory.
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
        const first = selectionFor(combination, BLENDS[0] ?? '')
        return (
          <View key={combination} style={styles.card}>
            <Text style={styles.cardTitle}>{combination}</Text>
            {first ? (
              <Text style={styles.detail}>{`${first.spokenText}  ·  ${first.durationMs} ms`}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={nowPlaying !== null}
              onPress={() => void compareBlends(combination)}
              style={[styles.button, nowPlaying !== null && styles.buttonDisabled]}
            >
              <Text style={styles.buttonText}>Compare all 4 blends</Text>
            </Pressable>

            <View style={styles.row}>
              {BLENDS.map((blend) => {
                const asset = selectionFor(combination, blend)
                const playing = nowPlaying === asset?.cueId
                return (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!asset || nowPlaying !== null}
                    key={blend}
                    onLongPress={() => void comparePerformances(combination, blend)}
                    onPress={() => asset && void playOne(asset).then(() => setNowPlaying(null))}
                    style={[
                      styles.blendButton,
                      playing && styles.blendButtonActive,
                      (!asset || nowPlaying !== null) && styles.buttonDisabled,
                    ]}
                  >
                    <Text style={styles.blendText}>{blend.replace(/-/g, ' ')}</Text>
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
        Long-press a blend to hear teach / work / push back to back for that voice — the contrast
        between states matters as much as the voice itself.
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
