import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADMIN_DESTINATIONS, adminSectionPath } from './search.dto';

/**
 * The admin destination index against the frontend (RM M26.2).
 *
 * > ✅ Verify: "backup" finds the Backup settings panel. The frontend
 * > already builds this index client-side
 * > (`features/admin/useAdminSearchIndex.ts`) — the server result shape
 * > must match it so the seam swaps cleanly.
 *
 * ## Read as text, not imported, and the reason is a dependency
 *
 * The other parity specs in this repository import the frontend module
 * at runtime. That does not work here: `admin-settings.types.ts` imports
 * `lucide-react` for the panel icons, which is a rendering dependency
 * the backend does not have and must not acquire to run a test. Reading
 * the source and extracting the declarations keeps the agreement checked
 * without the backend growing a frontend dependency to check it.
 *
 * Text matching is the weaker instrument and the failure mode is worth
 * naming: if the frontend restructures those declarations, this spec
 * fails rather than silently passing on zero matches — which the two
 * length assertions below are there to guarantee.
 */
const FRONTEND_SRC = resolve(__dirname, '../../../../../frontend/src');

/** `id: 'general',` … inside `SETTINGS_PANELS`. */
function frontendPanelIds(): string[] {
  const source = readFileSync(`${FRONTEND_SRC}/features/admin/admin-settings.types.ts`, 'utf8');
  const start = source.indexOf('export const SETTINGS_PANELS');
  const end = source.indexOf('export const SETTINGS_PANEL_GROUPS');

  expect(start, 'SETTINGS_PANELS not found — the frontend module moved').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return [...source.slice(start, end).matchAll(/^\s{4}id: '([a-z-]+)',$/gm)].map(
    (match) => match[1] ?? '',
  );
}

/** The members of the `AdminSectionSlug` union in `routes/index.ts`. */
function frontendSectionSlugs(): string[] {
  const source = readFileSync(`${FRONTEND_SRC}/routes/index.ts`, 'utf8');
  const start = source.indexOf('export type AdminSectionSlug');

  expect(start, 'AdminSectionSlug not found — the union moved').toBeGreaterThan(-1);

  const declaration = source.slice(start, source.indexOf(';', start));

  return [...declaration.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] ?? '');
}

describe('the admin destination index matches the shell', () => {
  it('carries every settings panel the frontend renders', () => {
    const panels = frontendPanelIds();

    // If the extraction ever silently matches nothing, every assertion
    // below would pass vacuously. This is the guard against that.
    expect(panels.length).toBeGreaterThan(10);

    for (const panel of panels) {
      const entry = ADMIN_DESTINATIONS.find((destination) => destination.id === `set-${panel}`);

      expect(entry, `settings panel "${panel}" is not indexed`).toBeDefined();
      // The path `routes.admin.settings(panel)` builds. A result whose
      // path does not resolve is a row that does nothing when clicked.
      expect(entry?.path).toBe(`/admin/settings/${panel}`);
    }
  });

  it('carries every administration section the router knows', () => {
    const slugs = frontendSectionSlugs();

    expect(slugs.length).toBeGreaterThan(15);

    for (const slug of slugs) {
      const entry = ADMIN_DESTINATIONS.find((destination) => destination.id === `nav-${slug}`);

      expect(entry, `section "${slug}" is not indexed`).toBeDefined();
      expect(entry?.path).toBe(adminSectionPath(slug));
    }
  });

  it('indexes no destination the frontend does not have', () => {
    // The other direction, and the one that catches a stale entry: a
    // path the router does not serve is a 404 a user reaches from search.
    const known = new Set([
      ...frontendPanelIds().map((panel) => `set-${panel}`),
      ...frontendSectionSlugs().map((slug) => `nav-${slug}`),
    ]);

    for (const destination of ADMIN_DESTINATIONS) {
      expect(known.has(destination.id), `${destination.id} is not in the frontend`).toBe(true);
    }
  });

  it('builds the overview section as the area index, not as a child', () => {
    // `routes.admin.section('overview')` is `/admin`. The one irregular
    // case, and the one a transcription gets wrong.
    expect(adminSectionPath('overview')).toBe('/admin');
    expect(adminSectionPath('rooms')).toBe('/admin/rooms');
  });
});
