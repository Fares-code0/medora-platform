import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, loadEnv } from 'vite';

import { demoAccessBoundaryPlugin, demoAccessStubPlugin } from './scripts/demo-access-boundary';
import {
  assertNoMocksRequested,
  mockBoundaryPlugin,
  mockSeamRewritePlugin,
  MOCKS_STRIPPED_FLAG,
} from './scripts/mock-boundary';
import {
  THEME_PLAYGROUND_FLAG,
  themePlaygroundBoundaryPlugin,
  themePlaygroundEnabled,
} from './scripts/theme-playground-boundary';

/**
 * Bundle analysis is opt-in via ANALYZE=1 so a normal build stays fast and
 * writes no stray artifacts:
 *   ANALYZE=1 npm run build   ->  dist/stats.html
 *
 * manualChunks exists so the DX-06 baseline can attribute weight rather than
 * report one opaque number, and so framer-motion's cost stays visible as
 * later tranches add motion (FRONTEND_CHECKLIST §10.1).
 *
 * The two demo-access plugins strip the development sign-in from a production
 * build and then prove it is gone. They key off `mode`, NOT `NODE_ENV`: Vite
 * derives `import.meta.env.DEV` from the ambient NODE_ENV, so a host that sets
 * NODE_ENV=development gets a "development" bundle out of `vite build`, and
 * relying on that flag alone once let the demo button reach a deployment.
 * `mode` is 'production' for `vite build` unless someone passes `--mode`.
 *
 * The Theme Playground is gated differently, and more strictly: it exists only
 * on the local dev server (`command === 'serve'`) with
 * `VITE_APP_ENV=development`, and the boundary plugin fails ANY build —
 * production or `build:demo` — that contains it. See
 * scripts/theme-playground-boundary.ts for why `import.meta.env.DEV` could not
 * be the gate.
 */
export default defineConfig(({ command, mode }) => {
  const isProductionBuild = mode === 'production';
  const viteEnv = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const appEnv = viteEnv['VITE_APP_ENV'];
  // RM M40.4 — a production build has no mock backend to honour this with.
  if (command === 'build') assertNoMocksRequested(isProductionBuild, viteEnv['VITE_ENABLE_MOCKS']);
  const themePlayground = themePlaygroundEnabled({ command, mode, appEnv });

  return {
    plugins: [
      react(),
      demoAccessStubPlugin({ stub: isProductionBuild }),
      demoAccessBoundaryPlugin({ enabled: isProductionBuild }),
      mockSeamRewritePlugin({ enabled: isProductionBuild && command === 'build' }),
      mockBoundaryPlugin({ enabled: isProductionBuild && command === 'build' }),
      themePlaygroundBoundaryPlugin(),
      ...(process.env['ANALYZE'] === '1'
        ? [visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true })]
        : []),
    ],
    define: {
      // A compile-time constant, so `false` lets Rollup drop the playground
      // route's dynamic import — and the whole feature with it.
      [THEME_PLAYGROUND_FLAG]: JSON.stringify(themePlayground),
      // RM M40.4: compiles the mock backend out of a production build
      // (scripts/mock-boundary.ts). Only defined there; undefined means "keep".
      ...(isProductionBuild && command === 'build' ? { [MOCKS_STRIPPED_FLAG]: 'true' } : {}),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
    },
    build: {
      sourcemap: true,
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
            // NO `motion: ['framer-motion']` entry — deliberately. Naming it here
            // makes it a chunk entry, which Vite then `modulepreload`s, pulling the
            // whole library into the eager initial graph. That defeats the
            // LazyMotion boundary in MotionProvider (§10.0(1)), whose entire job is
            // to load the feature bundle on demand. Measured when it was tried:
            // initial JS went 133.43 -> 164.42 kB gzip, a 23% regression.
          },
        },
      },
    },
  };
});
