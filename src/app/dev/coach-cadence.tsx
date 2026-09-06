/**
 * Coach cadence measurement (M36-03 tuning aid). **Dev route.**
 *
 * Plays a combination through the real `VoiceOutputExpo` while recording the
 * tablet's own speaker, then reads the amplitude envelope back to measure
 * what actually came out: how many words were audible, how far apart their
 * onsets were, and whether the last one decayed or was cut off.
 *
 * ## Why measure at all when a person can just listen
 *
 * Because the two questions are different. *Does this sound like a coach* is
 * a judgement only a person can make. *Were there three words, 190 ms apart,
 * and did the third one finish* is a measurement, and guessing at it from
 * memory is how a tuning session goes in circles.
 *
 * ## What it records
 *
 * The room, not just the speaker — there is no way to record one without the
 * other. Nothing is written to disk beyond the recorder's own temporary file,
 * nothing is uploaded, and only the amplitude envelope is read: levels over
 * time, never content.
 *
 * **Never run this with music playing.** Recording or analysing third-party
 * audio is forbidden (spec §14.6), and the measurement would be meaningless
 * anyway with another source in the room.
 */
import React, { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useFocusEffect } from 'expo-router'
import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio'

import { colors } from '@/theme/colors'
import { VoiceOutputExpo } from '@audio/VoiceOutputExpo'
import { COMBO_TIGHTNESS, MIN_TIGHTNESS } from '@domain/coach/CueAnnouncer'
import type { VoiceAssetId } from '@domain/coach/VoiceOutputPort'

/** How often the level is sampled. Words run 150–400 ms, so this is ample. */
const POLL_MS = 10
/** Silence captured before playback, to learn the room's noise floor. */
const BASELINE_MS = 400
/** How long to keep listening after the call is triggered. */
const LISTEN_MS = 4_000
/** A level this far above the floor counts as sound rather than room noise. */
const ONSET_MARGIN_DB = 10
/**
 * How far below the loudest moment still counts as part of a word.
 *
 * The absolute floor alone is not enough: the recorder reports -160 dB before
 * it has produced a real reading, and a threshold anchored to that sentinel
 * sits so low that the entire recording reads as one unbroken word — which is
 * exactly what the first run of this harness reported.
 */
const PEAK_RANGE_DB = 18
/** Level must hold below the threshold this long before a new word can start. */
const GAP_MS = 60

interface Sample {
  atMs: number
  db: number
}

interface Word {
  onsetMs: number
  endMs: number
  peakDb: number
}

interface Reading {
  label: string
  words: Word[]
  gapsMs: number[]
  floorDb: number
  peakDb: number
  thresholdDb: number
  /** True when the last word ended at the moment listening stopped. */
  lastWordClipped: boolean
}

/** Nearest-rank percentile, so every value returned is one that was measured. */
const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return -160
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.min(sorted.length - 1, rank)] ?? -160
}

/**
 * Words from a level trace.
 *
 * A word starts when the level crosses the threshold and ends when it has
 * been below it for `GAP_MS` — the hold is what stops a dip inside a syllable
 * from splitting one word into two.
 */
function findWords(samples: Sample[], floorDb: number, peakDb: number): Word[] {
  // Two anchors, and the stricter wins. The floor guards against a quiet room
  // being read as speech; the peak guards against the -160 sentinel dragging
  // the threshold below everything.
  const threshold = Math.max(floorDb + ONSET_MARGIN_DB, peakDb - PEAK_RANGE_DB)
  const words: Word[] = []
  let current: Word | null = null
  let belowSince: number | null = null

  for (const sample of samples) {
    if (sample.db >= threshold) {
      belowSince = null
      if (!current) current = { onsetMs: sample.atMs, endMs: sample.atMs, peakDb: sample.db }
      else {
        current.endMs = sample.atMs
        current.peakDb = Math.max(current.peakDb, sample.db)
      }
    } else if (current) {
      if (belowSince === null) belowSince = sample.atMs
      else if (sample.atMs - belowSince >= GAP_MS) {
        words.push(current)
        current = null
        belowSince = null
      }
    }
  }
  if (current) words.push(current)
  return words
}

export default function CoachCadenceScreen(): React.JSX.Element {
  const [readings, setReadings] = useState<Reading[]>([])
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const outputRef = useRef<VoiceOutputExpo | null>(null)

  /**
   * Free the measurement rig's players when this screen goes away (GH #356).
   *
   * This is a SECOND VoiceOutputExpo, on top of whatever the rest of the app
   * is holding, and `measure()` full-preloads it — 20 native players. Nothing
   * released it, so a single visit to this dev screen cost 20 players for the
   * remainder of the session, on a device where the audio stack goes silent
   * with no error once it can no longer create a track.
   *
   * Focus-scoped rather than unmount-scoped for the usual reason: a visited
   * route can stay mounted. The ref is nulled because `measure()` reuses it
   * via `??` and a released output must not be handed a second life here —
   * it re-preloads from scratch on the next run anyway.
   */
  useFocusEffect(
    useCallback(() => {
      return () => {
        outputRef.current?.release()
        outputRef.current = null
      }
    }, []),
  )

  const say = useCallback((line: string) => setLog((prev) => [...prev, line]), [])

  const measure = useCallback(
    async (label: string, ids: VoiceAssetId[], tightness: number) => {
      setBusy(true)
      try {
        const permission = await requestRecordingPermissionsAsync()
        if (!permission.granted) {
          say('microphone denied — nothing measured')
          return
        }

        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
          interruptionMode: 'mixWithOthers',
        })

        const output = outputRef.current ?? new VoiceOutputExpo()
        outputRef.current = output
        await output.preload()

        const recorder = new AudioModule.AudioRecorder({
          ...RecordingPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        })
        await recorder.prepareToRecordAsync()
        recorder.record()

        const samples: Sample[] = []
        const startedAt = performance.now()
        const poll = (): void => {
          const status = recorder.getStatus()
          const db = typeof status.metering === 'number' ? status.metering : -160
          samples.push({ atMs: performance.now() - startedAt, db })
        }

        // Learn the room before making any sound of our own.
        while (performance.now() - startedAt < BASELINE_MS) {
          poll()
          await new Promise<void>((r) => setTimeout(r, POLL_MS))
        }
        const playedAt = performance.now() - startedAt

        output.playPhrase(ids, undefined, tightness)

        while (performance.now() - startedAt < playedAt + LISTEN_MS) {
          poll()
          await new Promise<void>((r) => setTimeout(r, POLL_MS))
        }

        await recorder.stop()

        const after = samples.filter((s) => s.atMs >= playedAt)
        const levels = after.map((s) => s.db)
        // The floor comes from the trace itself rather than the pre-playback
        // window: the recorder needs a moment before it reports anything real,
        // so that window is mostly sentinel values.
        const floorDb = percentile(levels, 20)
        const peakDb = Math.max(...levels, -160)
        const words = findWords(after, floorDb, peakDb)
        const gapsMs = words
          .slice(1)
          .map((w, i) => Math.round(w.onsetMs - (words[i]?.onsetMs ?? w.onsetMs)))
        const last = words[words.length - 1]
        const listenedUntil = after[after.length - 1]?.atMs ?? 0
        const lastWordClipped = last !== undefined && listenedUntil - last.endMs < GAP_MS * 2

        setReadings((prev) => [
          ...prev,
          {
            label: `${label} @ ${tightness.toFixed(2)}`,
            words: words.map((w) => ({
              onsetMs: Math.round(w.onsetMs - playedAt),
              endMs: Math.round(w.endMs - playedAt),
              peakDb: Math.round(w.peakDb),
            })),
            gapsMs,
            floorDb: Math.round(floorDb),
            peakDb: Math.round(peakDb),
            thresholdDb: Math.round(Math.max(floorDb + ONSET_MARGIN_DB, peakDb - PEAK_RANGE_DB)),
            lastWordClipped,
          },
        ])
        say(
          `${label}: ${words.length} words, floor ${Math.round(floorDb)} peak ${Math.round(peakDb)} dB`,
        )
      } catch (err) {
        say(`FAILED: ${String(err)}`)
      } finally {
        setBusy(false)
      }
    },
    [say],
  )

  const COMBO: VoiceAssetId[] = ['1', '2', '3']

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Coach cadence' }} />
      <Text style={styles.heading}>Coach cadence measurement</Text>
      <Text style={styles.note}>
        Plays a combination and records the speaker to measure word onsets and gaps. Records the
        room — do not run with music playing.
      </Text>

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void measure('1-2-3', COMBO, COMBO_TIGHTNESS)}
          style={[styles.button, busy && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Combo (current)</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void measure('1-2-3', COMBO, MIN_TIGHTNESS)}
          style={[styles.button, busy && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Combo (tightest)</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void measure('single 1', ['1'], 1)}
          style={[styles.button, busy && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>Single</Text>
        </Pressable>
      </View>

      {readings.map((r, i) => (
        <View key={`${i}-${r.label}`} style={styles.result}>
          <Text style={styles.resultLabel}>{r.label}</Text>
          <Text style={styles.resultValue}>
            {`${r.words.length} words  gaps ${r.gapsMs.join(', ') || '-'} ms`}
          </Text>
          <Text style={styles.resultValue}>
            {`floor ${r.floorDb}  peak ${r.peakDb}  threshold ${r.thresholdDb} dB`}
          </Text>
          <Text style={styles.resultValue}>
            {r.words.map((w) => `[${w.onsetMs}-${w.endMs}ms ${w.peakDb}dB]`).join(' ')}
          </Text>
          {r.lastWordClipped ? (
            <Text style={styles.warn}>last word may be cut off — listening ended too soon</Text>
          ) : null}
        </View>
      ))}

      <Text style={styles.logHeading}>Log</Text>
      {log.map((line, i) => (
        <Text key={`${i}-${line}`} style={styles.log}>
          {line}
        </Text>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 12, paddingBottom: 60 },
  heading: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  note: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  row: { flexDirection: 'row', gap: 10, marginVertical: 8, flexWrap: 'wrap' },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 14, fontWeight: '700', color: colors.textOnAccent },
  result: { gap: 2, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  resultLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  resultValue: { fontSize: 12, color: colors.textSecondary, fontFamily: 'monospace' },
  warn: { fontSize: 12, color: colors.warning },
  logHeading: { marginTop: 16, fontSize: 12, fontWeight: '700', color: colors.textMuted },
  log: { fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' },
})
