/**
 * Auth feature public surface.
 * The app router mounts `authRoutes` and `guards` reads `resolveDestination`.
 * Everything else stays feature-internal.
 *
 * `LocaleProvider`/`useLocale` used to be re-exported here too, from when i18n
 * was auth-local. F-19 moved it to the `@/i18n` platform layer and the
 * composition root has imported it from there ever since, so the re-export had
 * no callers — and a feature re-exporting a platform module invites one.
 */
export { authRoutes } from './routes';
export { resolveDestination } from './pages/resolveDestination';
