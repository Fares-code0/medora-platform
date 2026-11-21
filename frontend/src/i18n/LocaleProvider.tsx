import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { setPreference } from '@/services/preferences';

import { setFormatLocale } from './format';
import { LocaleContext, type LocaleContextValue } from './locale-context';
import { DEFAULT_LOCALE, LOCALES, directionOf, type Locale } from './locales';
import { isCatalogueLoaded, loadCatalogue } from './messages';
import { storedLocale } from './stored-locale';

/**
 * The application's locale (F-19).
 *
 * **Direction is set once, at the root, on `<html>`** — never per component,
 * per page or per feature. That is the whole reason RTL is affordable here:
 * `dir` inherits, so every descendant flips together, and a component that
 * uses logical properties (`ms-`, `pe-`, `text-start`) mirrors without
 * knowing which direction it is in. The alternative — a `dir` prop threaded
 * through the tree, or RTL variants of components — is what makes RTL a
 * rewrite instead of an attribute.
 *
 * `dir` is also mirrored onto React context, because a handful of things
 * genuinely cannot be expressed with logical CSS: an icon that means "next"
 * has to become a left-pointing chevron in Arabic. Those read `useDirection()`.
 *
 * This provider mounts outermost — it has no dependency on auth, so the
 * login screen is translated too, and a locale chosen before signing in
 * survives into the session.
 *
 * **A language is selected only once its catalogue has loaded** (NEW-21:
 * the four non-English catalogues are their own chunks). `main.tsx` loads a
 * returning user's stored language before the first render, so it is
 * normally ready here; if it is not (a test, a failed preload), the page
 * starts in English and switches when it arrives. A switch keeps the current
 * language until the new one is in — the latest choice wins, and a load that
 * fails leaves the language as it was.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = storedLocale();
    return isCatalogueLoaded(stored) ? stored : DEFAULT_LOCALE;
  });
  const latest = useRef<Locale>(storedLocale());

  const dir = directionOf(locale);

  // Before the children render, so every formatter they call already
  // speaks this language (DEC-009). Idempotent, so a repeated render is safe.
  setFormatLocale(locale);

  useEffect(() => {
    /*
     * Both attributes, every time. `lang` is what a screen reader switches
     * its voice on and what `:lang()` selectors and hyphenation read; `dir`
     * is what mirrors the layout. Setting one without the other gives you
     * Arabic read aloud in an English voice, or an Arabic document laid out
     * left-to-right — each of which looks like the feature works.
     */
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback(
    (next: Locale) => {
      latest.current = next;
      setPreference('locale', next);
      if (isCatalogueLoaded(next)) {
        setLocaleState(next);
        return;
      }
      loadCatalogue(next).then(
        () => {
          if (latest.current === next) setLocaleState(next);
        },
        () => {
          // Unreachable chunk (offline, a deploy replaced it): stay as we are,
          // and do not keep a preference the screen does not show.
          if (latest.current === next) {
            latest.current = locale;
            setPreference('locale', locale);
          }
        },
      );
    },
    [locale],
  );

  // The stored language, if its catalogue was not ready at mount.
  useEffect(() => {
    const stored = latest.current;
    if (stored !== locale && !isCatalogueLoaded(stored)) setLocale(stored);
    // Mount only: later changes go through setLocale itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir, setLocale, locales: LOCALES }),
    [locale, dir, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
