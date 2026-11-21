/**
 * Theme Playground — development-only design-system editor.
 *
 * Public surface: the page, loaded lazily by `app/router/index.tsx` and only
 * on the local dev server with `VITE_APP_ENV=development` — the compile-time
 * flag `import.meta.env.MEDORA_THEME_PLAYGROUND`. Nothing imports this
 * feature statically, every `vite build` (production and the public demo)
 * excludes it, and `scripts/theme-playground-boundary.ts` fails any build
 * that does not (FRONTEND_ARCHITECTURE §3: deleting this folder breaks
 * nothing but that one route).
 */
export { ThemePlaygroundPage } from './pages/ThemePlaygroundPage';
export { THEME_PLAYGROUND_PATH } from './path';
