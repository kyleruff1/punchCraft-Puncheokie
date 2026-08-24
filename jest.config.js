const expoPreset = require('jest-expo/jest-preset')

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // The preset only transforms `.[jt]sx?`, so `tools/voice/prosody.mjs` reaches
  // jest as raw ESM and fails on its first `export`. Spreading the preset's map
  // rather than replacing it keeps the asset transformers intact — a bare
  // `transform` key overrides the preset outright, which silently breaks every
  // image and audio import in the suite.
  transform: {
    ...expoPreset.transform,
    '^.+\\.mjs$': expoPreset.transform['\\.[jt]sx?$'],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'node'],
  // Two exclusions, for different reasons:
  //
  // - `.claude/worktrees/**` holds git worktrees for parallel agent
  //   branches. Without this, jest discovers their suites too and reports a
  //   combined count for code that is not on this branch.
  // - `__tests__/helpers/` holds shared fixtures and adapters, not suites —
  //   without this jest treats every helper module as an empty test file.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/android/',
    '/ios/',
    '/dist/',
    '/.expo/',
    '/.claude/worktrees/',
    '/__tests__/helpers/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@ble/(.*)$': '<rootDir>/src/ble/$1',
    '^@protocol/(.*)$': '<rootDir>/src/protocol/$1',
    '^@capture/(.*)$': '<rootDir>/src/capture/$1',
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@spotify/(.*)$': '<rootDir>/src/spotify/$1',
    '^@storage/(.*)$': '<rootDir>/src/storage/$1',
    '^@state/(.*)$': '<rootDir>/src/state/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@diagnostics/(.*)$': '<rootDir>/src/diagnostics/$1',
    '^@simulation/(.*)$': '<rootDir>/src/simulation/$1',
    '^@testing/(.*)$': '<rootDir>/src/testing/$1',
    '^@audio/(.*)$': '<rootDir>/src/audio/$1',
  },
}
