import { create } from 'zustand'

import type { SpikeReport, SubscriptionResult } from '@ble/bleTypes'

/**
 * Zustand store for the Story-1 spike report.
 *
 * Rules:
 * - Holds only the aggregate SpikeReport. Raw frames never enter this store —
 *   they go through the capture sink (§11.9, §12.4).
 * - Components subscribe with selectors to avoid unnecessary re-renders.
 */

type ScanResult = SpikeReport['scan']
type ConnectResult = SpikeReport['connect']
type DiscoverResult = SpikeReport['discover']
type SubscribeResult = SpikeReport['subscribe']

export interface StartSpikeInput {
  runId: string
  stackLabel: string
  startedAtIso?: string
}

export type SpikeStageUpdate =
  | { stage: 'scan'; result: ScanResult }
  | { stage: 'connect'; result: ConnectResult }
  | { stage: 'discover'; result: DiscoverResult }
  | { stage: 'subscribe'; result: SubscribeResult }

export interface SpikeStoreState {
  report: SpikeReport | null
  start: (input: StartSpikeInput) => void
  updateStage: (update: SpikeStageUpdate) => void
  finish: (finishedAtIso?: string) => void
  reset: () => void
}

const emptyScan: ScanResult = { ok: false, devicesFound: 0, durationMs: 0 }
const emptyConnect: ConnectResult = { ok: false, durationMs: 0 }
const emptyDiscover: DiscoverResult = {
  ok: false,
  serviceCount: 0,
  characteristicCount: 0,
  durationMs: 0,
}
const emptySubscribe: SubscribeResult = {
  ok: false,
  subscribed: 0,
  subscriptions: [] as SubscriptionResult[],
}

export const useSpikeStore = create<SpikeStoreState>((set) => ({
  report: null,
  start: ({ runId, stackLabel, startedAtIso }) => {
    set({
      report: {
        runId,
        stackLabel,
        scan: { ...emptyScan },
        connect: { ...emptyConnect },
        discover: { ...emptyDiscover },
        subscribe: { ...emptySubscribe, subscriptions: [] },
        startedAtIso: startedAtIso ?? new Date().toISOString(),
      },
    })
  },
  updateStage: (update) => {
    set((state) => {
      if (!state.report) return state
      const next: SpikeReport = { ...state.report }
      switch (update.stage) {
        case 'scan':
          next.scan = update.result
          break
        case 'connect':
          next.connect = update.result
          break
        case 'discover':
          next.discover = update.result
          break
        case 'subscribe':
          next.subscribe = update.result
          break
      }
      return { report: next }
    })
  },
  finish: (finishedAtIso) => {
    set((state) => {
      if (!state.report) return state
      return {
        report: {
          ...state.report,
          finishedAtIso: finishedAtIso ?? new Date().toISOString(),
        },
      }
    })
  },
  reset: () => set({ report: null }),
}))

// Selectors for use with `useSpikeStore(selector)` in components.
export const selectSpikeReport = (s: SpikeStoreState): SpikeReport | null => s.report
export const selectScanStage = (s: SpikeStoreState): ScanResult | null => s.report?.scan ?? null
export const selectConnectStage = (s: SpikeStoreState): ConnectResult | null =>
  s.report?.connect ?? null
export const selectDiscoverStage = (s: SpikeStoreState): DiscoverResult | null =>
  s.report?.discover ?? null
export const selectSubscribeStage = (s: SpikeStoreState): SubscribeResult | null =>
  s.report?.subscribe ?? null
