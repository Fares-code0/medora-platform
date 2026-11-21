import { useEffect, useState, type ReactNode } from 'react';

import { hydratePreferences } from '@/storage/preference-store';

/**
 * Holds the first paint until the stored preferences are in memory.
 *
 * ── Why a gate rather than an effect inside the providers ────────────
 *
 * `ThemeProvider` and `LocaleProvider` both read `preferenceStore` in a
 * `useState` **initialiser** — deliberately, because `ports.ts` requires
 * the theme to resolve before the first paint or the app flashes the
 * wrong palette on every cold start. An initialiser runs once, at mount.
 * So a hydration that completes after they mount does not reach them:
 * the app would render in the system palette and the default language,
 * and then correct itself a frame later. That flash is precisely the
 * defect the synchronous port exists to prevent, and moving the read
 * into an effect would just relocate it.
 *
 * So the read happens above them instead, and nothing renders until it
 * has. The cost is one `multiGet` of three keys — the platform splash is
 * still on screen for it, because Expo hides the splash after the first
 * render and this is before the first render.
 *
 * ── It renders nothing, not a spinner ────────────────────────────────
 *
 * A spinner here would have to be drawn without a theme — `ThemeProvider`
 * is below this — so it would be a hard-coded colour that is wrong in one
 * of the two palettes. `null` keeps the splash.
 *
 * ── It never blocks forever ──────────────────────────────────────────
 *
 * `hydrate()` swallows a failed read and resolves anyway (see
 * `durable-preference-store.ts`): an unreadable store is an empty one,
 * and the app starts on its defaults. There is no path where this gate
 * stays closed.
 */
export function PreferenceGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hydratePreferences().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
