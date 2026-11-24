import { describe, expect, it } from 'vitest';

import { isMessageKey } from '@/i18n';
import { adminNavigation } from '@/layouts';
import { routes } from '@/routes';

import { SECTION_META } from './administration.meta';
import { adminRoutes } from './routes';

/**
 * The admin sidebar is configured in `layouts/navigation.ts` (navigation as
 * data, §4) while section titles live in the feature's SECTION_META, and the
 * routes are declared separately again. Nothing but these tests stops the
 * three drifting apart into a nav item that 404s or a route with no name.
 */

const navPaths = adminNavigation.sections.flatMap((s) => s.items.map((i) => i.path));

/** Every path the admin routes can actually serve, as absolute paths. */
const routePaths = new Set<string>(
  adminRoutes.flatMap((route) => {
    if (route.index === true) return [routes.admin.root];
    if (typeof route.path !== 'string') return [];
    return [`${routes.admin.root}/${route.path}`];
  }),
);

describe('admin navigation', () => {
  it('points every sidebar item at a route that exists', () => {
    for (const path of navPaths) {
      expect(routePaths.has(path), `no admin route serves "${path}"`).toBe(true);
    }
  });

  it('has SECTION_META for every slug the sidebar links to', () => {
    for (const path of navPaths) {
      const slug = path === routes.admin.root ? 'overview' : path.replace('/admin/', '');
      expect(
        SECTION_META[slug as keyof typeof SECTION_META],
        `missing meta for "${slug}"`,
      ).toBeDefined();
    }
  });

  it('names every route with a title key, so titles and breadcrumbs work', () => {
    // Redirects are exempt: they render a <Navigate> and are gone before a
    // breadcrumb could be read, so naming one would only invent a page.
    // `/admin/platform` is the only such route (ADM-01 retired the section
    // but kept the path). Non-rendering routes are identified by whitelist:
    // only routes declared through `lazy:` (route components loaded on demand)
    // or `children:` (nested subroutes) render pages. Every other route that
    // actually renders must have a breadcrumb name.
    for (const route of adminRoutes.filter((r) => r.lazy !== undefined || r.children !== undefined)) {
      const titleKey = (route.handle as { titleKey?: string } | undefined)?.titleKey;
      expect(typeof titleKey, `route "${String(route.path ?? 'index')}" has no titleKey`).toBe(
        'string',
      );
      expect(
        isMessageKey(titleKey ?? ''),
        `route "${String(route.path ?? 'index')}": unknown key`,
      ).toBe(true);
    }
  });

  it('keeps each inlined route title key identical to its SECTION_META label key', () => {
    // Title keys are literals in routes.tsx rather than SECTION_META
    // lookups, deliberately: importing the meta module there would drag it
    // (and its icon imports) into the entry chunk. This test is what stops
    // the two copies drifting.
    for (const route of adminRoutes) {
      const slug = route.index === true ? 'overview' : route.path;
      if (typeof slug !== 'string') continue;
      const meta = SECTION_META[slug as keyof typeof SECTION_META];
      if (!meta) continue;
      expect(
        (route.handle as { titleKey?: string }).titleKey,
        `title key drifted for "${slug}"`,
      ).toBe(meta.labelKey);
    }
  });

  it('uses only ids the bottom tab bar can resolve', () => {
    const ids = new Set(adminNavigation.sections.flatMap((s) => s.items.map((i) => i.id)));
    for (const id of adminNavigation.bottomTabIds) {
      expect(ids.has(id), `bottomTabIds references unknown item "${id}"`).toBe(true);
    }
  });

  it('keeps Platform Settings reachable even though it is not a sidebar item', () => {
    // Pinned in the shell footer rather than the nav list, so it must still
    // resolve as a route. ("My Settings" is composed in the app layer
    // instead — it reuses the doctor Settings Center across a feature
    // boundary — so it is deliberately absent from this array.)
    expect(adminRoutes.map((r) => r.path)).toContain('settings');
  });
});
