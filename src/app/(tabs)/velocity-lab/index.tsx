import { Link, Stack } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getTrackerCoordinator, type TrackerSlotHand } from '@/ble/TrackerCoordinator'
import type { AdvertisementSnapshot } from '@/ble/bleTypes'
import { TrackerBadgesRow } from '@/components/TrackerBadgesRow'
import { useLeftSlot, useRightSlot } from '@/state/useTrackerStore'

type PickerState =
  | { status: 'idle' }
  | { status: 'scanning'; hand: TrackerSlotHand }
  | { status: 'picking'; hand: TrackerSlotHand; results: AdvertisementSnapshot[] }
  | { status: 'connecting'; hand: TrackerSlotHand; deviceName: string }
  | { status: 'error'; hand: TrackerSlotHand; message: string }

function sortAdvertisements(list: AdvertisementSnapshot[]): AdvertisementSnapshot[] {
  return [...list].sort((a, b) => {
    const aNamed = a.name && a.name.length > 0 ? 0 : 1
    const bNamed = b.name && b.name.length > 0 ? 0 : 1
    if (aNamed !== bNamed) return aNamed - bNamed
    const aRssi = a.rssi ?? -999
    const bRssi = b.rssi ?? -999
    return bRssi - aRssi
  })
}

/** Recognizes a FightCamp v1 tracker by advertised name (truncated to
 * "FightCam") OR by the confirmed primary service UUID (H01). Both are
 * accepted so the filter still works if a firmware revision changes the
 * advertised name but keeps the service. */
const FIGHTCAM_SERVICE_UUID = 'ca280069-5470-4e34-94dd-caf160200b29'
function isFightCam(ad: AdvertisementSnapshot): boolean {
  if (ad.name && /fightcam/i.test(ad.name)) return true
  return ad.serviceUuids.some((u) => u.toLowerCase() === FIGHTCAM_SERVICE_UUID)
}

export default function VelocityLabLanding() {
  const leftSlot = useLeftSlot()
  const rightSlot = useRightSlot()
  const [picker, setPicker] = useState<PickerState>({ status: 'idle' })
  const [fightCamOnly, setFightCamOnly] = useState(true)

  async function startScan(hand: TrackerSlotHand) {
    setPicker({ status: 'scanning', hand })
    try {
      const coordinator = getTrackerCoordinator()
      const results = await coordinator.scan({ timeoutMs: 12000 })
      setPicker({ status: 'picking', hand, results: sortAdvertisements(results) })
    } catch (err) {
      setPicker({
        status: 'error',
        hand,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function pickDevice(hand: TrackerSlotHand, snap: AdvertisementSnapshot) {
    // Show the friendly slot name in the badge / buttons rather than the
    // raw advertised BLE name ("FightCam"). The underlying deviceId still
    // uniquely identifies the tracker for the storage layer.
    const friendlyName = hand === 'left' ? 'L Punch' : 'R Punch'
    setPicker({ status: 'connecting', hand, deviceName: friendlyName })
    try {
      const coordinator = getTrackerCoordinator()
      await coordinator.connectSlot(hand, snap.deviceId, friendlyName)
      setPicker({ status: 'idle' })
    } catch (err) {
      setPicker({
        status: 'error',
        hand,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function cancelPicker() {
    setPicker({ status: 'idle' })
  }

  const activeHand: TrackerSlotHand | null = picker.status === 'idle' ? null : picker.hand

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'Velocity Lab',
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable style={styles.headerLink}>
                <Text style={styles.headerLinkText}>Settings</Text>
              </Pressable>
            </Link>
          ),
        }}
      />

      <TrackerBadgesRow />

      <Text style={styles.title}>Velocity Lab</Text>
      <Text style={styles.paragraph}>
        Velocity Lab is the raw-tracker workbench. Connect a FightCamp v1 punch tracker over BLE,
        watch every notification frame stream in with its monotonic timestamp, and inspect
        tracker-reported velocity in tracker units alongside the raw bytes that produced it.
        No workout, no scoring, no interpretation — just the transport, the parser, and the
        capture sink that persists every frame before anything else touches it.
      </Text>

      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.connectButton, activeHand === 'left' && styles.connectButtonActive]}
          onPress={() => startScan('left')}
          disabled={picker.status !== 'idle'}
        >
          <Text style={styles.connectButtonText}>
            Connect Left{leftSlot?.name ? ` (${leftSlot.name})` : ''}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.connectButton, activeHand === 'right' && styles.connectButtonActive]}
          onPress={() => startScan('right')}
          disabled={picker.status !== 'idle'}
        >
          <Text style={styles.connectButtonText}>
            Connect Right{rightSlot?.name ? ` (${rightSlot.name})` : ''}
          </Text>
        </Pressable>
      </View>

      {picker.status !== 'idle' && (
        <View style={styles.pickerCard}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>
              {picker.hand === 'left' ? 'Connect Left' : 'Connect Right'}
            </Text>
            <Pressable onPress={cancelPicker} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>

          {picker.status === 'scanning' && (
            <View style={styles.pickerBody}>
              <ActivityIndicator />
              <Text style={styles.pickerBodyText}>Scanning for trackers…</Text>
            </View>
          )}

          {picker.status === 'connecting' && (
            <View style={styles.pickerBody}>
              <ActivityIndicator />
              <Text style={styles.pickerBodyText}>Connecting to {picker.deviceName}…</Text>
            </View>
          )}

          {picker.status === 'error' && (
            <View style={styles.pickerBody}>
              <Text style={styles.errorText}>Error: {picker.message}</Text>
              <Pressable onPress={() => startScan(picker.hand)} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Retry scan</Text>
              </Pressable>
            </View>
          )}

          {picker.status === 'picking' && (
            <View style={styles.pickerBody}>
              <Pressable
                onPress={() => setFightCamOnly((v) => !v)}
                style={styles.filterRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: fightCamOnly }}
              >
                <View style={[styles.checkboxBox, fightCamOnly && styles.checkboxBoxOn]}>
                  {fightCamOnly ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </View>
                <Text style={styles.filterLabel}>
                  Only FightCam trackers ({picker.results.filter(isFightCam).length}/{picker.results.length})
                </Text>
              </Pressable>
              {(() => {
                const visible = fightCamOnly ? picker.results.filter(isFightCam) : picker.results
                if (visible.length === 0) {
                  return (
                    <Text style={styles.pickerBodyText}>
                      {fightCamOnly ? 'No FightCam trackers in range. Uncheck the filter to see everything.' : 'No devices in range.'}
                    </Text>
                  )
                }
                return visible.map((snap) => (
                  <Pressable
                    key={snap.deviceId}
                    style={styles.deviceRow}
                    onPress={() => pickDevice(picker.hand, snap)}
                  >
                    <Text style={styles.deviceName}>{snap.name ?? 'Unnamed tracker'}</Text>
                    <Text style={styles.deviceMeta}>
                      RSSI {snap.rssi ?? '—'}
                      {snap.serviceUuids.length > 0 ? ` · ${snap.serviceUuids.length} svc` : ''}
                    </Text>
                  </Pressable>
                ))
              })()}
              <Pressable onPress={() => startScan(picker.hand)} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Rescan</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <View style={styles.linkRow}>
        <Link href="/(tabs)/velocity-lab/spike" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Run BLE spike</Text>
          </Pressable>
        </Link>
        <Link href="/(tabs)/velocity-lab/probe" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Protocol probe (dev)</Text>
          </Pressable>
        </Link>
        <Link href="/(tabs)/velocity-lab/live" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Live decoded events</Text>
          </Pressable>
        </Link>
        <Link href="/settings" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Diagnostics</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  paragraph: { fontSize: 15, lineHeight: 22 },
  buttonRow: { flexDirection: 'row', gap: 12 },
  connectButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    alignItems: 'center',
  },
  connectButtonActive: { borderColor: '#0a84ff', backgroundColor: '#eaf3ff' },
  connectButtonText: { fontSize: 15, fontWeight: '600' },
  pickerCard: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerTitle: { fontSize: 16, fontWeight: '700' },
  cancelButton: { paddingVertical: 6, paddingHorizontal: 10 },
  cancelButtonText: { fontSize: 14, fontWeight: '600' },
  pickerBody: { gap: 10 },
  pickerBodyText: { fontSize: 14 },
  errorText: { fontSize: 14, color: '#b00020' },
  deviceRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  deviceName: { fontSize: 15, fontWeight: '600' },
  deviceMeta: { fontSize: 13, color: '#555' },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
  },
  retryButtonText: { fontSize: 14, fontWeight: '600' },
  linkRow: { gap: 12, marginTop: 8 },
  linkButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
  },
  linkButtonText: { fontSize: 16, fontWeight: '600' },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { fontSize: 15, fontWeight: '600' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  checkboxBox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#333',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxBoxOn: { backgroundColor: '#0a84ff', borderColor: '#0a84ff' },
  checkboxTick: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  filterLabel: { fontSize: 14, fontWeight: '600' },
})
