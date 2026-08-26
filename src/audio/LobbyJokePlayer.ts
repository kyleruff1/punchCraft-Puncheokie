/**
 * The lobby joke (M4) — one per workout, told while the fight loads.
 *
 * Personality never touches the rhythm map: a joke plays only before the
 * first bell (the live screen stops it the moment the phase leaves idle),
 * so it cannot offset a single scheduled call. The player lives here, in
 * the audio layer, because screens speak through adapters — spec §13.5's
 * live-screen test holds the line that no screen imports expo-audio.
 */

import { createAudioPlayer, type AudioPlayer } from 'expo-audio'

import { pickLobbyJoke } from './voiceAssets/jokeManifest'

export class LobbyJokePlayer {
  private player: AudioPlayer | null = null
  private told = false

  /** Tell one joke — the workout's entire comedy budget. Idempotent. */
  tell(volume: number): void {
    if (this.told) return
    this.told = true
    try {
      const joke = pickLobbyJoke()
      const player = createAudioPlayer(joke.module)
      this.player = player
      player.volume = volume
      player.play()
    } catch {
      // The lobby survives a mute cornerman.
    }
  }

  /** The bell ends the comedy. Safe to call repeatedly. */
  stop(): void {
    try {
      this.player?.remove()
    } catch {
      // Already gone.
    }
    this.player = null
  }
}
