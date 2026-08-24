/**
 * Whole-phrase vs concatenated A/B (voice architecture experiment 1). **Dev route.**
 *
 * Plays the same combination two ways, back to back, with a pause between so
 * they can be told apart:
 *
 * - **A — concatenated:** the current production path, per-word clips run
 *   together at the combination cadence.
 * - **B — whole phrase:** one utterance rendered in a single pass, with
 *   authored grouping and a stressed final punch.
 *
 * Both use the same SAPI voice on purpose. Holding the voice constant is what
 * makes this a test of *concatenation*, not of the synthesizer — swapping in a
 * neural renderer is a separate variable and a later phase.
 *
 * The measured word offsets are shown beside each phrase so the grouping can
 * be read as well as heard: within-group gaps should be visibly shorter than
 * the gap between groups.
 */
import React, { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'

import { colors } from '@/theme/colors'
import { VoiceOutputExpo } from '@audio/VoiceOutputExpo'
import { COMBO_TIGHTNESS } from '@domain/coach/CueAnnouncer'
import { phraseAssets, type PhraseAsset } from '@audio/voiceAssets/phraseManifest'
import type { VoiceAssetId } from '@domain/coach/VoiceOutputPort'

/** Gap between the two takes, long enough that they do not blur together. */
const BETWEEN_TAKES_MS = 900

const CADENCES = ['technical', 'standard', 'pressure'] as const
type Cadence = (typeof CADENCES)[number]

/** Combinations in the experiment set, in the order they were authored. */
const COMBINATIONS = [...new Set(phraseAssets.map((a) => a.combination))]

/** `1-2-roll-3-2` → the clip ids the concatenated path would play. */
function concatenatedIds(combination: string): VoiceAssetId[] {
  return combination.split('-').map((token) => token as VoiceAssetId)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** Gaps between consecutive word onsets, which is where grouping shows up. */
function gapsOf(asset: PhraseAsset): number[] {
  return asset.wordMarks
    .slice(1)
    .map((mark, i) => mark.offsetMs - (asset.wordMarks[i]?.offsetMs ?? mark.offsetMs))
}

export default function PhraseAbScreen(): React.JSX.Element {
  const [cadence, setCadence] = useState<Cadence>('standard')
  const [playing, setPlaying] = useState<string | null>(null)
  /** Surfaced rather than logged: a silent take must say why it was silent. */
  const [note, setNote] = useState<string | null>(null)
  const outputRef = useRef<VoiceOutputExpo | null>(null)
  const phrasePlayerRef = useRef<AudioPlayer | null>(null)

  const play = useCallback(
    async (combination: string, which: 'concat' | 'phrase' | 'both') => {
      setPlaying(`${combination}:${which}`)
      setNote(null)
      try {
        await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' })

        const asset = phraseAssets.find(
          (a) => a.combination === combination && a.cadence === cadence,
        )

        if (which !== 'phrase') {
          // The word pool is only built when take A is actually wanted.
          // Loading it just to play a phrase is what exhausted the device's
          // AudioTrack instances and made take B fail silently.
          const output = outputRef.current ?? new VoiceOutputExpo()
          outputRef.current = output
          await output.preload()
          output.playPhrase(concatenatedIds(combination), undefined, COMBO_TIGHTNESS)
          await sleep(Math.max(900, (asset?.durationMs ?? 900) + 200))
        }
        if (which === 'both') {
          // Release the word players before the phrase needs a track of its
          // own — the pool is capped, but the phrase player is outside it.
          outputRef.current?.release()
          await sleep(BETWEEN_TAKES_MS)
        }

        if (which !== 'concat' && asset) {
          phrasePlayerRef.current?.remove()
          const player = createAudioPlayer(asset.module)
          phrasePlayerRef.current = player

          // Wait for the clip to load. `play()` on a player that has not
          // finished loading does nothing, and reports nothing — the same
          // trap that made every clip fall back to an assumed duration.
          for (let i = 0; i < 60 && !player.isLoaded; i += 1) await sleep(25)
          if (!player.isLoaded) {
            setNote(`${combination}: phrase clip never loaded`)
            return
          }

          player.play()
          await sleep(asset.durationMs + 250)
          player.remove()
          phrasePlayerRef.current = null
        }
      } finally {
        setPlaying(null)
      }
    },
    [cadence],
  )

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Phrase A/B' }} />

      <Text style={styles.heading}>Whole phrase vs concatenated</Text>
      <Text style={styles.note}>
        Same SAPI voice in both, so this tests concatenation rather than the synthesizer. A is the
        current per-word path; B is one rendered utterance.
      </Text>
      {note ? <Text style={styles.warn}>{note}</Text> : null}

      <View style={styles.row}>
        {CADENCES.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => setCadence(option)}
            style={[styles.chip, option === cadence && styles.chipActive]}
          >
            <Text style={[styles.chipText, option === cadence && styles.chipTextActive]}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      {COMBINATIONS.map((combination) => {
        const asset = phraseAssets.find(
          (a) => a.combination === combination && a.cadence === cadence,
        )
        const busy = playing !== null
        return (
          <View key={combination} style={styles.card}>
            <Text style={styles.cardTitle}>{combination}</Text>
            {asset ? (
              <Text style={styles.detail}>
                {`${asset.durationMs} ms · onsets ${asset.wordMarks
                  .map((m) => m.offsetMs)
                  .join(', ')} · gaps ${gapsOf(asset).join(', ')}`}
              </Text>
            ) : (
              <Text style={styles.detail}>no phrase asset at this cadence</Text>
            )}
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void play(combination, 'concat')}
                style={[styles.button, busy && styles.buttonDisabled]}
              >
                <Text style={styles.buttonText}>A — concatenated</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy || !asset}
                onPress={() => void play(combination, 'phrase')}
                style={[styles.button, (busy || !asset) && styles.buttonDisabled]}
              >
                <Text style={styles.buttonText}>B — whole phrase</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy || !asset}
                onPress={() => void play(combination, 'both')}
                style={[styles.buttonAlt, (busy || !asset) && styles.buttonDisabled]}
              >
                <Text style={styles.buttonAltText}>A then B</Text>
              </Pressable>
            </View>
          </View>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 12, paddingBottom: 60 },
  heading: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  note: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
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
  card: {
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  detail: { fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  buttonAlt: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 13, fontWeight: '700', color: colors.textOnAccent },
  buttonAltText: { fontSize: 13, fontWeight: '700', color: colors.accent },
  warn: { fontSize: 12, color: colors.warning },
})
