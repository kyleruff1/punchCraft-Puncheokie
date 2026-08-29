import type { ExpoConfig } from 'expo/config'

// Read the current git SHA at build time so the build-info screen can show it.
// Keep synchronous + require to avoid ESM issues under Metro/Expo config resolution.
function gitSha(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const config: ExpoConfig = {
  name: 'punchCraft',
  slug: 'punchcraft-puncheokie',
  version: '0.1.0',
  scheme: 'punchcraft',
  // D7: Puncheokie's live screen is landscape-first on the tablet, a
  // recorded inversion of spec §19.4's phone-first rule for that one route.
  // The global setting is 'default' so the OS follows the device, and the
  // live route locks landscape on focus and releases it on blur — every
  // other route keeps its existing presentation. Verified in the M32-05
  // spike on the Lenovo TB125FU.
  orientation: 'default',
  userInterfaceStyle: 'dark',
  // The kit Kyle sent: a rounded-square icon with the PC monogram on a
  // gloved fist. `expo.icon` is the base for iOS and legacy Android; the
  // adaptive icon below is what Android 8+ actually renders. Both point at
  // the same square asset — Android composes it against the accent
  // background so the cyan artwork reads on any launcher theme.
  icon: './assets/branding/icon.png',
  // New Architecture is always enabled from Expo SDK 55 onward (§11.2 note);
  // no config key exists to toggle it.
  extra: {
    gitSha: gitSha(),
    releaseChannel: 'dev',
  },
  android: {
    package: 'com.kyleruff.punchcraft',
    versionCode: 1,
    // Adaptive icon: Android composes `foregroundImage` (the artwork) over
    // `backgroundColor`, which is what makes the icon look right on any
    // launcher theme rather than showing a white square where the artwork's
    // padding should be.
    adaptiveIcon: {
      foregroundImage: './assets/branding/icon.png',
      // Matches the in-app `colors.background` (near-black chrome) so the
      // launcher tile reads as the same ground as the app itself.
      backgroundColor: '#0B0D0E',
    },
    // These are also declared by react-native-ble-plx's config plugin below,
    // but we list them here so the manifest is legible without running prebuild.
    permissions: [
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
    ],
  },
  ios: {
    // Not shipping to iOS in the MVP; keep a minimal declaration so `expo prebuild`
    // does not fail when someone accidentally runs it for iOS.
    bundleIdentifier: 'com.kyleruff.punchcraft',
    supportsTablet: true,
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-sqlite',
    'expo-secure-store',
    'expo-font',
    'expo-splash-screen',
    'expo-status-bar',
    'expo-screen-orientation',
    // M34-01 voice spike: cached-clip playback and TTS. `expo-audio` needs a
    // config plugin for the Android record permission; `expo-speech` does not.
    'expo-audio',
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 26,
          buildToolsVersion: '36.0.0',
          kotlinVersion: '2.1.20',
          ndkVersion: '27.2.12479018',
        },
      },
    ],
    [
      // Primary BLE stack per Story 1 spike (locked pending on-device confirmation).
      // Fallback matrix and rationale live in docs/sprint-1.md and
      // .claude/projects/.../memory/reference-ble-library-decision.md.
      '@sfourdrinier/react-native-ble-plx',
      {
        // neverForLocation stays FALSE until we confirm on-device it does not
        // filter out the FightCamp trackers (§11.3).
        neverForLocation: false,
        isBackgroundEnabled: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    tsconfigPaths: true,
  },
}

export default config
