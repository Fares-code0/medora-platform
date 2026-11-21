/**
 * Jest — `jest-expo` supplies the React Native transform, the module
 * mappings and the platform haste config. `setup.ts` mocks the native
 * modules this tree talks to — the keychain, network state, the
 * biometric prompt and the font loader — so a unit test never needs a
 * device. It named "reanimated-free gesture handler" until 2026-09-12,
 * which was wrong twice over: nothing mocked it, and
 * `react-native-gesture-handler` was not imported anywhere in the tree.
 * It has since been removed from `package.json` (`docs/DEPENDENCIES.md`).
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  // Mock call history never survives a test. Without this a spy on a
  // shared React Native module (Linking is a singleton) carries calls
  // from one test into the next, and an assertion that "nothing dialled"
  // fails because something dialled two tests ago.
  clearMocks: true,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/test/**'],
  /**
   * Coverage reporting — checklist U-10.
   *
   * `text-summary` is what CI prints, so the number is in the job log
   * where a reviewer already is. `json-summary` is what
   * `docs/COVERAGE.md` was written from and what a future per-area
   * breakdown would read. `lcov` is for a local browser.
   *
   * There is deliberately **no `coverageThreshold`**. The row says the
   * threshold is the owner's call, and a number invented here would be
   * a gate nobody agreed to — one that fails an honest pull request the
   * first time someone deletes a well-covered file.
   * `coverage-config.test.ts` asserts that absence, so adding one has to
   * be deliberate.
   */
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  /**
   * Above every `waitFor` ceiling in the suite — checklist U-06.
   *
   * Four files wait up to 10 s for a screen's queries to settle, and each
   * explains why: the ceiling is on pathology, not a pause, and the wait
   * returns in milliseconds on an idle machine. **None of those ceilings
   * was reachable.** Jest's own per-test timeout defaults to 5 s, so the
   * test died at five while its `waitFor` was still counting to ten, and
   * the failure read as "exceeded timeout of 5000 ms" — a message about
   * Jest's limit, not about the thing being waited for.
   *
   * It passed anyway on an idle machine, which is what made it a flake
   * rather than a bug: CI runs `test:coverage`, instrumentation roughly
   * doubles render time, and four concurrent React Query screens on a
   * contended runner is exactly the case the 10 s was chosen for.
   *
   * 20 s is deliberately double the largest ceiling, so a test that
   * legitimately needs its full wait reports what it was waiting for
   * rather than being cut off by the harness. It is not a licence for
   * slow tests: the suite runs in about 30 s, and a test that actually
   * takes 20 s is a defect this number will not hide.
   */
  modulePathIgnorePatterns: [
    '<rootDir>/node_modules\\.old-sdk52/',
  ],
  testTimeout: 20_000,
  testPathIgnorePatterns: [
    '/node_modules/',
    '/node_modules\\.old-sdk52/',
    '/dist/',
    '/\\.expo/',
  ],
};
