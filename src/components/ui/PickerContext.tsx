/**
 * Picker coordination — one picker open at a time across the app.
 *
 * Kyle's setup rule: preference surfaces stay collapsed, and if two
 * collapsed rows both expanded at once the vertical budget would blow
 * out mid-interaction and the screen would need to scroll. This
 * context tracks which picker row is currently open by id, so opening
 * a second picker collapses the first.
 *
 * The picker components (`PickerRow`, `MultiPickerRow`) subscribe to
 * the context; the recipe screen and other picker-heavy surfaces wrap
 * the whole screen in a `<PickerProvider>` so all their pickers share
 * one "open row" state. Standalone use falls back to per-instance
 * local state (default provider), so a lone picker still works.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

interface PickerContextValue {
  /** id of the currently-open picker, or null if none. */
  openId: string | null
  /**
   * Ask the coordinator to open this picker. Any other picker currently
   * open is closed first (single-open guarantee).
   */
  open: (id: string) => void
  /** Close this picker if it is the currently-open one. */
  close: (id: string) => void
}

const DEFAULT_VALUE: PickerContextValue = {
  openId: null,
  // Standalone pickers use local state via `useLocalPickerState` below.
  // These no-ops keep the type consistent when no provider is present.
  open: () => undefined,
  close: () => undefined,
}

const PickerCtx = createContext<PickerContextValue>(DEFAULT_VALUE)

export function PickerProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const value = useMemo<PickerContextValue>(
    () => ({
      openId,
      open: (id: string) => setOpenId(id),
      close: (id: string) => setOpenId((current) => (current === id ? null : current)),
    }),
    [openId],
  )
  return <PickerCtx.Provider value={value}>{children}</PickerCtx.Provider>
}

/**
 * Picker hook — returns `{isOpen, toggle}` for a given picker id.
 * Uses the context if a `PickerProvider` is above; falls back to local
 * state otherwise so a standalone picker still works.
 */
export function usePicker(id: string): { isOpen: boolean; toggle: () => void; close: () => void } {
  const ctx = useContext(PickerCtx)
  const [localOpen, setLocalOpen] = useState(false)
  const hasProvider = ctx !== DEFAULT_VALUE
  const isOpen = hasProvider ? ctx.openId === id : localOpen
  const toggle = useCallback(() => {
    if (hasProvider) {
      if (ctx.openId === id) ctx.close(id)
      else ctx.open(id)
    } else {
      setLocalOpen((v) => !v)
    }
  }, [hasProvider, ctx, id])
  const close = useCallback(() => {
    if (hasProvider) ctx.close(id)
    else setLocalOpen(false)
  }, [hasProvider, ctx, id])
  return { isOpen, toggle, close }
}
