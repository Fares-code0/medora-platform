import { resolve } from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest rather than Jest — the frontend already runs Vitest, and one
 * test runner across the monorepo keeps a single mental model. MG §3.2
 * names "Vitest/Jest", so either satisfies the spec.
 *
 * NestJS DI reads types emitted by `emitDecoratorMetadata`, which esbuild
 * (Vite's default transformer) does not support. `unplugin-swc` compiles
 * with SWC instead, which does.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // M3 makes a missing variable a boot failure, and the e2e specs boot
    // a real application. This supplies a complete environment so the
    // schema can stay strict instead of being relaxed for tests.
    setupFiles: ['test/setup-env.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/*.types.ts',
        // Lint fixtures, not application code (RM M2.2).
        'src/**/__boundary-fixtures__/**',
        'src/generated/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
