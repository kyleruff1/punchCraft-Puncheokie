/**
 * Zustand store for the two tracker slots (left / right hand).
 *
 * Rules:
 * - In-memory ephemeral state only. Persistence (device history, assigned
 *   hand) lives in the storage layer (DeviceRepository); this store is
 *   not persisted.
 * - `Hand` here is narrowed to 'left' | 'right'; 'unknown' is not a slot.
 * - Selectors are exported so components subscribe minimally.
 * - Slot carries the full ConnectionState from §11.5 so the UI can
 *   distinguish connecting / bonding / recovering / etc. without inventing
 *   its own state machine.
 *
 * The exported module-level helpers (assignSlot / setSlotConnected /
 * setSlotConnecting / clearSlot / getTrackerSlots) exist so non-React
 * callers such as TrackerCoordinator can drive the store without invoking
 * the hook. React callers use useLeftSlot / useRightSlot / useTrackerSlots.
 */
import { create } from 'zustand'

import type { ConnectionState, Hand } from '@ble/bleTypes'

export type SlotHand = Exclude<Hand, 'unknown'>

export interface SlotState {
  deviceId: string
  name?: string
  /** Full §11.5 connection state so the badge / readiness gate can react
   * to bonding / discovering / recovering, not just a boolean. */
  state: ConnectionState
  errorMessage?: string
}

interface Slots {
  left: SlotState | null
  right: SlotState | null
}

export interface TrackerStoreState {
  slots: Slots
  assign: (hand: SlotHand, deviceId: string, name?: string) => void
  clear: (hand: SlotHand) => void
  setState: (hand: SlotHand, state: ConnectionState, errorMessage?: string) => void
}

export const useTrackerStore = create<TrackerStoreState>((set) => ({
  slots: { left: null, right: null },
  assign: (hand, deviceId, name) => {
    set((prev) => {
      const existing = prev.slots[hand]
      const next: SlotState = {
        deviceId,
        name: name ?? existing?.name,
        state: 'dormant',
      }
      return { slots: { ...prev.slots, [hand]: next } }
    })
  },
  clear: (hand) => {
    set((prev) => ({ slots: { ...prev.slots, [hand]: null } }))
  },
  setState: (hand, state, errorMessage) => {
    set((prev) => {
      const existing = prev.slots[hand]
      if (!existing) return prev
      const next: SlotState = {
        ...existing,
        state,
        errorMessage: state === 'error' ? errorMessage : errorMessage ?? existing.errorMessage,
      }
      return { slots: { ...prev.slots, [hand]: next } }
    })
  },
}))

// --- React hooks (subscribe minimally) --------------------------------------

export const useLeftSlot = (): SlotState | null =>
  useTrackerStore((s) => s.slots.left)

export const useRightSlot = (): SlotState | null =>
  useTrackerStore((s) => s.slots.right)

export const useBothReady = (): boolean =>
  useTrackerStore((s) => {
    const l = s.slots.left?.state
    const r = s.slots.right?.state
    return (l === 'ready' || l === 'streaming') && (r === 'ready' || r === 'streaming')
  })

// --- Module-level helpers (for non-React callers, e.g. TrackerCoordinator) --

export function getTrackerSlots(): Slots {
  return useTrackerStore.getState().slots
}

export function assignSlot(hand: SlotHand, deviceId: string, name?: string): void {
  useTrackerStore.getState().assign(hand, deviceId, name)
}

export function clearSlot(hand: SlotHand): void {
  useTrackerStore.getState().clear(hand)
}

export function setSlotState(hand: SlotHand, state: ConnectionState, errorMessage?: string): void {
  useTrackerStore.getState().setState(hand, state, errorMessage)
}

/**
 * Boolean convenience for callers that only care about connected/not.
 * Maps `true` → 'ready', `false` → 'dormant' (§11.5 name for the
 * post-disconnect terminal state; there is no distinct 'disconnected' state).
 */
export function setSlotConnected(hand: SlotHand, connected: boolean): void {
  setSlotState(hand, connected ? 'ready' : 'dormant')
}

/**
 * Convenience: transitioning INTO the "connecting" phase when true; when
 * false, either transition to 'error' with the given message, or leave
 * the state alone (facade will emit a real state via onConnectionChange).
 */
export function setSlotConnecting(hand: SlotHand, connecting: boolean, errorMessage?: string): void {
  if (connecting) {
    setSlotState(hand, 'connecting')
    return
  }
  if (errorMessage) {
    setSlotState(hand, 'error', errorMessage)
  }
  // else: no-op — a subsequent onConnectionChange will drive the definitive state.
}

// --- Plain selectors (usable outside React) ---------------------------------

export const selectLeftSlot = (s: TrackerStoreState): SlotState | null => s.slots.left
export const selectRightSlot = (s: TrackerStoreState): SlotState | null => s.slots.right
