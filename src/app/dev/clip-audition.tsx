/**
 * Clip audition. **Dev route.** The Tier-1 instrument of the voice QA loop.
 *
 * Plays the ENTIRE shipped clip library — every word, tone and phrase — in a
 * deterministic sequence through the device speaker, with a separator chirp
 * before each clip, while logging a machine-readable line per play. A PC-side
 * recorder (tools/audition/record-audition.mjs) captures the room through the
 * condenser mic, tails these logs, slices the recording per clip, and gives
 * each one an as-heard verdict — which is how a clip earns (or dodges) a
 * re-render. The screen itself judges nothing; it is a playback jig.
 *
 * Log protocol (single-string on purpose — multi-arg console serialization
 * through logcat is unreliable):
 *   AUDITION {"event":"start","count":N,"atMs":...}   after the double chirp
 *   AUDITION {"event":"play","key":...,"index":i,"atMs":...}  at player.play()
 *   AUDITION {"event":"done","count":N,"atMs":...}
 * `atMs` is performance.now() — deltas from "start" place every clip on the
 * recording once the double chirp anchors t0.
 *
 * Keys match tools/analysis/expectations.json: `vocab/form/id` for words and
 * tones, the manifest cueId for phrases.
 *
 * Drive it headless:
 *   adb shell am start -a android.intent.action.VIEW \
 *     -d "punchcraft://dev/clip-audition?auto=1"
 * Optional `keys=a,b,c` narrows to a subset (targeted re-audit of fixes).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

import { colors } from '@/theme/colors'
import { phraseAssets } from '@audio/voiceAssets/phraseManifest'
import { voiceAssetManifest, PHRASE_FORMS } from '@audio/voiceAssets/manifest'

/* eslint-disable @typescript-eslint/no-require-imports */
const CHIRP = require('../../../assets/spike-voice/tone-short.wav') as number
/* eslint-enable @typescript-eslint/no-require-imports */

const CHIRP_MS = 120
const AFTER_CHIRP_MS = 200
const AFTER_CLIP_MS = 500
const AUDITION_KEEP_AWAKE_TAG = 'clip-audition'

interface PlaylistItem {
  key: string
  module: number
  /** Known length for phrases; words wait on the loaded player instead. */
  durationMs?: number
}

function buildPlaylist(): PlaylistItem[] {
  const items: PlaylistItem[] = []
  for (const vocabulary of ['numbers', 'names'] as const) {
    for (const form of PHRASE_FORMS) {
      const clips = voiceAssetManifest.assets[vocabulary][form]
      for (const id of Object.keys(clips).sort()) {
        items.push({ key: `${vocabulary}/${form}/${id}`, module: clips[id as keyof typeof clips] })
      }
    }
  }
  for (const asset of phraseAssets) {
    items.push({ key: asset.cueId, module: asset.module, durationMs: asset.durationMs })
  }
  return items
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const log = (payload: Record<string, unknown>): void => {
  console.info(`AUDITION ${JSON.stringify({ ...payload, atMs: Math.round(performance.now()) })}`)
}

export default function ClipAuditionScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ keys?: string; auto?: string }>()
  const [progress, setProgress] = useState<{ index: number; total: number; key: string } | null>(
    null,
  )
  const [finished, setFinished] = useState(false)
  const runningRef = useRef(false)

  const playlist = React.useMemo(() => {
    const all = buildPlaylist()
    const keysParam = typeof params.keys === 'string' ? params.keys : undefined
    if (!keysParam) return all
    const wanted = new Set(
      keysParam
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    )
    return all.filter((item) => wanted.has(item.key))
  }, [params.keys])

  /** One player at a time — the AudioTrack budget note in persona-audition. */
  const playModule = useCallback(async (module: number, fallbackMs: number): Promise<void> => {
    const player = createAudioPlayer(module)
    try {
      for (let i = 0; i < 60 && !player.isLoaded; i += 1) await sleep(25)
      const durationMs = player.isLoaded && player.duration > 0 ? player.duration * 1000 : fallbackMs
      player.play()
      await sleep(durationMs + 120)
    } finally {
      try {
        player.remove()
      } catch {
        // Already gone.
      }
    }
  }, [])

  const run = useCallback(async (): Promise<void> => {
    if (runningRef.current) return
    runningRef.current = true
    setFinished(false)
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' })
    await activateKeepAwakeAsync(AUDITION_KEEP_AWAKE_TAG)
    try {
      // Double chirp: the recorder's t0 anchor.
      await playModule(CHIRP, CHIRP_MS)
      await sleep(250)
      await playModule(CHIRP, CHIRP_MS)
      log({ event: 'start', count: playlist.length })
      await sleep(800)

      for (let index = 0; index < playlist.length; index += 1) {
        const item = playlist[index]
        if (!item) continue
        setProgress({ index: index + 1, total: playlist.length, key: item.key })
        await playModule(CHIRP, CHIRP_MS)
        await sleep(AFTER_CHIRP_MS)
        log({ event: 'play', key: item.key, index })
        await playModule(item.module, item.durationMs ?? 1500)
        await sleep(AFTER_CLIP_MS)
      }

      log({ event: 'done', count: playlist.length })
      setProgress(null)
      setFinished(true)
    } finally {
      runningRef.current = false
      deactivateKeepAwake(AUDITION_KEEP_AWAKE_TAG)
    }
  }, [playModule, playlist])

  useEffect(() => {
    if (params.auto === '1') void run()
    // Auto-run once on mount when adb asked for it; params never change after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Clip audition' }} />
      <Text style={styles.heading}>Full-library clip audition</Text>
      <Text style={styles.note}>
        {`Plays all ${playlist.length} clips through the speaker with a chirp before each, ` +
          'logging every play for the PC-side recorder. Set the room up (mic live, volume at ' +
          'workout level), then start — and let it run to the end.'}
      </Text>

      {progress ? (
        <View style={styles.card}>
          <Text style={styles.progressText}>{`${progress.index} / ${progress.total}`}</Text>
          <Text style={styles.detail}>{progress.key}</Text>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => void run()} style={styles.button}>
          <Text style={styles.buttonText}>{finished ? 'Run again' : 'Start audition'}</Text>
        </Pressable>
      )}
      {finished ? <Text style={styles.doneText}>Done — recorder has the full pass.</Text> : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 14, paddingBottom: 60 },
  heading: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  note: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  card: { gap: 6, paddingVertical: 16 },
  progressText: { fontSize: 34, fontWeight: '800', color: colors.accent },
  detail: { fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  buttonText: { fontSize: 14, fontWeight: '700', color: colors.textOnAccent },
  doneText: { fontSize: 13, color: colors.success },
})
