/**
 * Compile-time flags injected by `vite.config.ts` through `define`.
 *
 * `MEDORA_THEME_PLAYGROUND` is `true` only on the local dev server with
 * `VITE_APP_ENV=development` (scripts/theme-playground-boundary.ts). It is
 * `false` in every `vite build`, and `undefined` under any config that does
 * not define it (vitest, vite.artifact.config.ts) — both of which mean "off".
 */
interface ImportMetaEnv {
  readonly MEDORA_THEME_PLAYGROUND?: boolean;
  /**
   * `true` in a `mode === 'production'` build, which compiles the mock
   * backend out (RM M40.4, scripts/mock-boundary.ts). Undefined under the dev
   * server, `build:demo` and vitest — all of which keep the mock seam.
   */
  readonly MEDORA_MOCKS_STRIPPED?: boolean;
}
