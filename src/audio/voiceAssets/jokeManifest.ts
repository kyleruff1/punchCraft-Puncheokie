/**
 * Cornerman lobby jokes (generated from tools/voice/jokes.json).
 *
 * One joke per workout, maximum — delivered as an extension of the
 * walkout announcement, before the first bell, never on the rhythm
 * map. Durations are measured from the rendered files; the countdown
 * stretches to cover the chosen joke.
 *
 * DO NOT EDIT — regenerate with `node tools/voice/make-joke-clips.mjs`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

export interface LobbyJoke {
  id: string
  /** Metro module id for the clip. */
  module: number
  durationMs: number
}

export const LOBBY_JOKES: readonly LobbyJoke[] = [
  { id: 'joke-01', module: require('../../../assets/voice/numbers/standalone/joke-01.wav'), durationMs: 6220 },
  { id: 'joke-02', module: require('../../../assets/voice/numbers/standalone/joke-02.wav'), durationMs: 6857 },
  { id: 'joke-03', module: require('../../../assets/voice/numbers/standalone/joke-03.wav'), durationMs: 5226 },
  { id: 'joke-04', module: require('../../../assets/voice/numbers/standalone/joke-04.wav'), durationMs: 7089 },
  { id: 'joke-05', module: require('../../../assets/voice/numbers/standalone/joke-05.wav'), durationMs: 9497 },
  { id: 'joke-06', module: require('../../../assets/voice/numbers/standalone/joke-06.wav'), durationMs: 8186 },
  { id: 'joke-07', module: require('../../../assets/voice/numbers/standalone/joke-07.wav'), durationMs: 5253 },
  { id: 'joke-08', module: require('../../../assets/voice/numbers/standalone/joke-08.wav'), durationMs: 8493 },
  { id: 'joke-09', module: require('../../../assets/voice/numbers/standalone/joke-09.wav'), durationMs: 7200 },
  { id: 'joke-10', module: require('../../../assets/voice/numbers/standalone/joke-10.wav'), durationMs: 7609 },
  { id: 'joke-11', module: require('../../../assets/voice/numbers/standalone/joke-11.wav'), durationMs: 7081 },
  { id: 'joke-12', module: require('../../../assets/voice/numbers/standalone/joke-12.wav'), durationMs: 7253 },
  { id: 'joke-13', module: require('../../../assets/voice/numbers/standalone/joke-13.wav'), durationMs: 8784 },
  { id: 'joke-14', module: require('../../../assets/voice/numbers/standalone/joke-14.wav'), durationMs: 4305 },
  { id: 'joke-15', module: require('../../../assets/voice/numbers/standalone/joke-15.wav'), durationMs: 5893 },
  { id: 'joke-16', module: require('../../../assets/voice/numbers/standalone/joke-16.wav'), durationMs: 6382 },
  { id: 'joke-17', module: require('../../../assets/voice/numbers/standalone/joke-17.wav'), durationMs: 5613 },
  { id: 'joke-18', module: require('../../../assets/voice/numbers/standalone/joke-18.wav'), durationMs: 5208 },
  { id: 'joke-19', module: require('../../../assets/voice/numbers/standalone/joke-19.wav'), durationMs: 5204 },
  { id: 'joke-20', module: require('../../../assets/voice/numbers/standalone/joke-20.wav'), durationMs: 6797 },
  { id: 'joke-21', module: require('../../../assets/voice/numbers/standalone/joke-21.wav'), durationMs: 6121 },
  { id: 'joke-22', module: require('../../../assets/voice/numbers/standalone/joke-22.wav'), durationMs: 5225 },
  { id: 'joke-23', module: require('../../../assets/voice/numbers/standalone/joke-23.wav'), durationMs: 5592 },
  { id: 'joke-24', module: require('../../../assets/voice/numbers/standalone/joke-24.wav'), durationMs: 5217 },
  { id: 'joke-25', module: require('../../../assets/voice/numbers/standalone/joke-25.wav'), durationMs: 7613 },
  { id: 'joke-26', module: require('../../../assets/voice/numbers/standalone/joke-26.wav'), durationMs: 5090 },
  { id: 'joke-27', module: require('../../../assets/voice/numbers/standalone/joke-27.wav'), durationMs: 5075 },
  { id: 'joke-28', module: require('../../../assets/voice/numbers/standalone/joke-28.wav'), durationMs: 4132 },
  { id: 'joke-29', module: require('../../../assets/voice/numbers/standalone/joke-29.wav'), durationMs: 4724 },
  { id: 'joke-30', module: require('../../../assets/voice/numbers/standalone/joke-30.wav'), durationMs: 5652 },
]

/** The workout’s entire comedy budget: one random draw. */
export function pickLobbyJoke(): LobbyJoke {
  return LOBBY_JOKES[Math.floor(Math.random() * LOBBY_JOKES.length)] as LobbyJoke
}

/* eslint-enable @typescript-eslint/no-require-imports */
