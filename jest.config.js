/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // `__tests__/helpers/` holds shared fixtures/adapters, not suites — without
  // this jest would treat every helper module as an empty test file.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/android/',
    '/ios/',
    '/dist/',
    '/.expo/',
    '/__tests__/helpers/',
  ],
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
  },
}
