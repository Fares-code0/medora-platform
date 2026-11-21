import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Test runner config — kept separate from vite.config.ts so the app build
 * never carries test-only settings. Mirrors the app's `@/` alias so tests
 * import exactly the way source does.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    /*
     * The suite runs on the mock backend, so it says so. `VITE_ENABLE_MOCKS`
     * has no default in `configs/env.ts` — absent means off, which is what
     * keeps a production build off mock auth — so the mock-path suites
     * (`AuthProvider.test.tsx` and friends) have to opt in like any other
     * non-production environment does. One declaration here rather than an
     * `import.meta.env` stub in each of them.
     */
    env: {
      VITE_ENABLE_MOCKS: 'true',
    },
    setupFiles: ['./src/test/setup.ts'],
    // `scripts/` is in the net because the build guards live there, and they
    // are the kind of code whose correct behaviour is *failing*:
    // `demo-access-boundary.ts` finds nothing in a real bundle, so the only
    // place a violation exists to be checked against is its test file.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/mock/**', 'src/**/*.d.ts'],
    },
  },
});
