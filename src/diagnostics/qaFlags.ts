/**
 * Hook-free QA flags (GH #291).
 *
 * The persisted QA mode lives in a zustand store (`@state/useQaStore`);
 * the audio layer must not import a store, so the store WRITES here and
 * `src/audio/*` READS here. One switch, two readers: the same flag that
 * lets `qa/run` autostart a workout also arms the timing observers.
 *
 * Default OFF. Never `__DEV__`: the unattended suite runs against a
 * release build.
 */

let timingObserverEnabled = false

/** True when the persisted QA flag is on. Read by the audio observers. */
export function isTimingObserverEnabled(): boolean {
  return timingObserverEnabled
}

/** Written by the QA store whenever the persisted flag changes or loads. */
export function setTimingObserverEnabled(on: boolean): void {
  timingObserverEnabled = on
}
