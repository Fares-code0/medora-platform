import { routes } from '@/routes';

/**
 * The settings centers, each a single full page whose categories are
 * sub-routes: the doctor's Settings, the admin's "My Settings" and the
 * admin's Platform Settings.
 */
const SETTINGS_ROOTS: readonly string[] = [
  routes.doctor.settings().split('/').slice(0, 3).join('/'),
  routes.admin.section('preferences'),
  routes.admin.settings(),
];

/**
 * The key the shell's route transition is keyed on.
 *
 * Normally the pathname: every navigation fades the new page in. A settings
 * center is the exception. Picking a category is moving around *within* one
 * page, and keying on the full path re-mounted the whole page each time —
 * the header, the back link and the category column all faded and rose 8px
 * on every click, as if the user had left Settings and come back. Collapsing
 * a settings center's paths to its root keeps the page mounted, so only the
 * selected category's content changes.
 */
export function routeTransitionKey(pathname: string): string {
  const root = SETTINGS_ROOTS.find(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  return root ?? pathname;
}
