import type { RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { appRoutes } from './index';

/**
 * The Theme Playground route is registered only when vite.config.ts compiles
 * `import.meta.env.MEDORA_THEME_PLAYGROUND` to `true` — on the local dev
 * server. Vitest does not define the flag, so this is the "flag absent"
 * case: the route must not exist, and nothing else may have moved.
 */

function paths(routes: readonly RouteObject[]): string[] {
  return routes.flatMap((r) => [...(r.path ? [r.path] : []), ...paths(r.children ?? [])]);
}

describe('development-only routes', () => {
  it('reads the flag as absent here', () => {
    expect(import.meta.env.MEDORA_THEME_PLAYGROUND).toBeUndefined();
  });

  it('do not register the Theme Playground when the flag is absent', () => {
    expect(paths(appRoutes)).not.toContain('/dev/theme-playground');
  });

  it('leave the public and workspace routes in place', () => {
    const all = paths(appRoutes);
    for (const expected of ['/', '/login', '/403', '/404', '/doctor', '/admin']) {
      expect(all).toContain(expected);
    }
  });
});
