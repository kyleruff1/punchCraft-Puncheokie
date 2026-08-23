/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // `.claude/worktrees/**` holds git worktrees for parallel agent branches.
  // Without this, jest discovers their suites too and reports a combined
  // count for code that is not on this branch.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/android/',
    '/ios/',
    '/dist/',
    '/.expo/',
    '/.claude/worktrees/',
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
  },
}
