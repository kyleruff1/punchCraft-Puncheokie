/**
 * Migration 006 — `app_settings` (M34-05).
 *
 * A small key/value table for user preferences that must survive a restart:
 * the Voice Coach policy and the volume levels to begin with.
 *
 * ## Why a table rather than a settings file
 *
 * The app already opens exactly one durable store, and it is this database.
 * Adding a second persistence mechanism for a handful of values would mean a
 * second thing to migrate, back up, and reason about when they disagree.
 *
 * ## Why one JSON blob per key rather than a column per setting
 *
 * Preferences change shape often. A column per field means a migration every
 * time a toggle is added, and the alternative — reading an old row after the
 * type has gained a field — is exactly what `value_json` plus a defaulted
 * parse handles without ceremony. This is the same reasoning migration 004
 * applied to `params_json` (D14).
 *
 * Nothing secret goes here. Tokens and credentials belong in SecureStore
 * (spec §14.2); this is a preferences table and is readable like any other.
 */

import type { SQLiteDatabase } from 'expo-sqlite'

import type { Migration } from './index'

export const MIGRATION_006: Migration = {
  id: 6,
  name: 'app_settings',
  up(db: SQLiteDatabase): void {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        -- Wall time, for display and support only. Nothing orders by it
        -- (spec §3.2, §18.3).
        updated_at TEXT NOT NULL
      );
    `)
  },
}

/** Keys this table holds. Named so a typo is a compile error, not a silent miss. */
export const SETTINGS_KEYS = {
  voicePolicy: 'voice.policy',
  voiceVolumes: 'voice.volumes',
  backdrop: 'backdrop.settings',
  /**
   * The audible metronome "click" — a DEVELOPMENT instrument (an audible
   * marker grid for verifying event/call mapping), off by default and never
   * load-bearing. Stored as `{ enabled: boolean }`; gates only the audible
   * loop volume, never `recipe.metronome.enabled` or the visual grid.
   */
  click: 'click.enabled',
  /** Puncheoke instrument: `{ patchId }` — the selected PunchPatch. */
  instrumentPatch: 'instrument.patch',
  /** Puncheoke instrument: `{ url }` — the PunchBridge WebSocket address. */
  instrumentBridge: 'instrument.bridge',
  /**
   * Puncheoke brass-cube options: `{ patternId, retrigger, backend }` —
   * the jam-screen selections for a brass patch (brass-cube-design).
   */
  instrumentBrass: 'instrument.brass',
  /**
   * Puncheoke tablet instrument voice (M40-15): `{ output, texture }` —
   * where compiled gestures sound (bridge/tablet/both) and which sample-
   * bank texture the tablet engine plays.
   */
  instrumentTablet: 'instrument.tabletVoice',
  /**
   * Puncheoke harmonic-field settings (M40-18): versioned blob
   * `{ schemaVersion: 1, freedom, navigation, commitIntervalTicks }` —
   * the FREEDOM/NAVIGATION/WINDOW selections a field patch folds into
   * its section (harmonic-field-v2).
   */
  instrumentHarmonic: 'instrument.harmonic',
} as const

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS]
