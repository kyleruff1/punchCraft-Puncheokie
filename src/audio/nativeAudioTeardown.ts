/**
 * Free a native audio object for real (GH #356/#357).
 *
 * expo-audio's `remove()` on a player and `destroy()` on a playlist are
 * REGISTRY UNLINKS, not disposal. On Android both are literally a map delete:
 *
 *   Function("remove")  { player: AudioPlayer -> players.remove(player.id) }
 *   Function("destroy") { playlist: AudioPlaylist -> playlists.remove(playlist.id) }
 *
 * — node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioModule.kt
 *   :544-546 and :855-857, against the plain `ConcurrentHashMap`s declared at :54.
 *
 * Neither touches the ExoPlayer. The native player, its MediaSession and its
 * AudioTrack survive until the JS SharedObject is finalised by garbage
 * collection, at some unpredictable later time.
 *
 * `release()` — inherited from expo-modules-core's `SharedObject`, which both
 * `AudioPlayer` and `AudioPlaylist` extend — is the call that actually reaches
 * `sharedObjectDidRelease()` (AudioPlayer.kt:274) and tears the player down.
 *
 * So a correct teardown does BOTH: unlink from the module's registry, then
 * release the shared object. Calling only the first is what left this app
 * holding ~20 AudioTracks after leaving a screen whose cleanup had visibly
 * run — the JS side reported a clean release while the native side kept every
 * track, and the count only ever fell when GC happened to run.
 *
 * Both helpers are total: they never throw, so a teardown loop cannot be
 * abandoned half-way by one already-dead handle.
 */

/** The shape we need from an expo-audio player; `release` is the SharedObject's. */
interface NativeAudioPlayerLike {
  remove?: () => void
  release?: () => void
}

/** The shape we need from an expo-audio playlist. */
interface NativeAudioPlaylistLike {
  pause?: () => void
  destroy?: () => void
  release?: () => void
}

function attempt(action: (() => void) | undefined): void {
  if (typeof action !== 'function') return
  try {
    action()
  } catch {
    // Already gone, or the platform does not implement it. Teardown must
    // continue regardless — a throw here would strand every later handle.
  }
}

/**
 * Unlink a player from the module registry AND release its native resources.
 * Safe to call twice, and safe on a player that never finished loading.
 */
export function releaseAudioPlayer(player: NativeAudioPlayerLike | null | undefined): void {
  if (!player) return
  attempt(player.remove?.bind(player))
  attempt(player.release?.bind(player))
}

/**
 * Stop a playlist, unlink it, and release its native resources.
 *
 * The `pause()` first is deliberate: destroying a sounding playlist leaves the
 * last buffer to finish on the mixer, which is audible as a click.
 */
export function releaseAudioPlaylist(playlist: NativeAudioPlaylistLike | null | undefined): void {
  if (!playlist) return
  attempt(playlist.pause?.bind(playlist))
  attempt(playlist.destroy?.bind(playlist))
  attempt(playlist.release?.bind(playlist))
}
