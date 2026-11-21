import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The single-file build used to publish Medora as a hosted Artifact.
 *
 * The normal `vite.config.ts` build is the one that ships: it code-splits per
 * route, keeps framer-motion outside the eager graph, and emits sourcemaps.
 * None of that survives a one-file page, so this config is deliberately its
 * opposite rather than an override of it:
 *
 *   - `inlineDynamicImports` collapses every lazy route into the one entry
 *     chunk, so `React.lazy` still works with nothing left to fetch. It is
 *     incompatible with `manualChunks`, which is why that is absent here.
 *   - `assetsInlineLimit: Infinity` turns the two font families into data URIs
 *     inside the CSS instead of sibling files.
 *   - Sourcemaps are off; they would more than double a page that is already
 *     megabytes of base64 font.
 *
 * `scripts/build-artifact.mjs` runs this and folds the emitted CSS and JS back
 * into the HTML. Do not point `npm run build` at it — the shipped bundle wants
 * the splitting this throws away.
 */

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-artifact',
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
