/**
 * Cornerman lobby jokes (M4, generated from tools/voice/jokes.json).
 *
 * One joke per workout, maximum, played in the pre-fight lobby only —
 * never inside a round, never on the rhythm map. Personality must never
 * offset the map (a property test holds compiled call times identical
 * with and without coach lines), and the lobby sits outside the work
 * window by construction.
 *
 * DO NOT EDIT — regenerate with `node tools/voice/make-joke-clips.mjs`
 * after changing jokes.json, then mirror the entries here.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export interface LobbyJoke {
  id: string
  /** Metro module id for the clip. */
  module: number
}

export const LOBBY_JOKES: readonly LobbyJoke[] = [
  { id: 'joke-01', module: require('../../../assets/voice/numbers/standalone/joke-01.wav') },
  { id: 'joke-02', module: require('../../../assets/voice/numbers/standalone/joke-02.wav') },
  { id: 'joke-03', module: require('../../../assets/voice/numbers/standalone/joke-03.wav') },
  { id: 'joke-04', module: require('../../../assets/voice/numbers/standalone/joke-04.wav') },
  { id: 'joke-05', module: require('../../../assets/voice/numbers/standalone/joke-05.wav') },
  { id: 'joke-06', module: require('../../../assets/voice/numbers/standalone/joke-06.wav') },
  { id: 'joke-07', module: require('../../../assets/voice/numbers/standalone/joke-07.wav') },
  { id: 'joke-08', module: require('../../../assets/voice/numbers/standalone/joke-08.wav') },
  { id: 'joke-09', module: require('../../../assets/voice/numbers/standalone/joke-09.wav') },
  { id: 'joke-10', module: require('../../../assets/voice/numbers/standalone/joke-10.wav') },
  { id: 'joke-11', module: require('../../../assets/voice/numbers/standalone/joke-11.wav') },
  { id: 'joke-12', module: require('../../../assets/voice/numbers/standalone/joke-12.wav') },
  { id: 'joke-13', module: require('../../../assets/voice/numbers/standalone/joke-13.wav') },
  { id: 'joke-14', module: require('../../../assets/voice/numbers/standalone/joke-14.wav') },
  { id: 'joke-15', module: require('../../../assets/voice/numbers/standalone/joke-15.wav') },
  { id: 'joke-16', module: require('../../../assets/voice/numbers/standalone/joke-16.wav') },
  { id: 'joke-17', module: require('../../../assets/voice/numbers/standalone/joke-17.wav') },
  { id: 'joke-18', module: require('../../../assets/voice/numbers/standalone/joke-18.wav') },
  { id: 'joke-19', module: require('../../../assets/voice/numbers/standalone/joke-19.wav') },
  { id: 'joke-20', module: require('../../../assets/voice/numbers/standalone/joke-20.wav') },
  { id: 'joke-21', module: require('../../../assets/voice/numbers/standalone/joke-21.wav') },
  { id: 'joke-22', module: require('../../../assets/voice/numbers/standalone/joke-22.wav') },
  { id: 'joke-23', module: require('../../../assets/voice/numbers/standalone/joke-23.wav') },
  { id: 'joke-24', module: require('../../../assets/voice/numbers/standalone/joke-24.wav') },
  { id: 'joke-25', module: require('../../../assets/voice/numbers/standalone/joke-25.wav') },
  { id: 'joke-26', module: require('../../../assets/voice/numbers/standalone/joke-26.wav') },
  { id: 'joke-27', module: require('../../../assets/voice/numbers/standalone/joke-27.wav') },
  { id: 'joke-28', module: require('../../../assets/voice/numbers/standalone/joke-28.wav') },
  { id: 'joke-29', module: require('../../../assets/voice/numbers/standalone/joke-29.wav') },
  { id: 'joke-30', module: require('../../../assets/voice/numbers/standalone/joke-30.wav') },
]

/* eslint-enable @typescript-eslint/no-require-imports */

/** One random joke — the workout's entire comedy budget. */
export function pickLobbyJoke(): LobbyJoke {
  return LOBBY_JOKES[Math.floor(Math.random() * LOBBY_JOKES.length)] as LobbyJoke
}
