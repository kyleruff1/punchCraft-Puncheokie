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
  name: 'PunchLab',
  slug: 'punchlab-puncheokie',
  version: '0.1.0',
  scheme: 'punchlab',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  // New Architecture is always enabled from Expo SDK 55 onward (§11.2 note);
  // no config key exists to toggle it.
  extra: {
    gitSha: gitSha(),
    releaseChannel: 'dev',
  },
  android: {
    package: 'com.kyleruff.punchlab',
    versionCode: 1,
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
    bundleIdentifier: 'com.kyleruff.punchlab',
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
