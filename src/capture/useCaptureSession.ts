/**
 * useCaptureSession — one capture per screen visit, in one line.
 *
 * Any screen that subscribes to BLE notifications should call this. Without an
 * open capture the transport's sink has nowhere to write and frames are
 * discarded (loudly — see BleCaptureService.capture), so this is what makes
 * persist-before-parse actually land for a given screen.
 *
 * Deliberately takes no dependencies: the capture is tied to the SCREEN, not
 * to whatever device or characteristic the screen happens to be watching.
 * Re-running it on every device change caused a real bug — the async stop()
 * from one cleanup landed after the next start(), tearing down the capture
 * that had just opened and silently dropping every later frame.
 *
 * Returns whether the capture is open, so callers can wait for it before
 * subscribing and avoid racing the open.
 */

import { useEffect, useState } from 'react'

import { startCapture, stopCapture } from '@capture/getCaptureService'

export interface CaptureSessionState {
  /** True once a capture is open and the transport sink is installed. */
  ready: boolean
  /** Set when opening the capture failed; frames will NOT be persisted. */
  error: string | null
}

export function useCaptureSession(label: string): CaptureSessionState {
  const [state, setState] = useState<CaptureSessionState>({ ready: false, error: null })

  useEffect(() => {
    try {
      startCapture(label)
      setState({ ready: true, error: null })
    } catch (err) {
      // A storage failure must not take the screen down with it — the screen
      // still works, it just is not recording.
      setState({ ready: false, error: (err as Error)?.message ?? String(err) })
    }
    return () => {
      setState({ ready: false, error: null })
      // Flushes whatever is still buffered, then closes.
      void stopCapture()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
