import { useEffect } from 'react';

import { APP_NAME } from '@/constants';

/**
 * Document title — WCAG 2.1 §2.4.2 "Page Titled".
 * The shells drive this from the active route so every screen is
 * distinguishable in browser history, in the tab strip, and to a screen
 * reader announcing the page on navigation.
 */

/**
 * `"Patients · Medora"`, or the bare product name when the page is unnamed.
 *
 * A title that already names the product is left alone. Most page names do
 * not — "Patients", "Labs", "Page not found" — but the auth branch's do, and
 * they are translated strings this code does not get to rewrite: `login.title`
 * reads "Sign in to Medora" in English and its own equivalent in four other
 * languages. Appending the suffix anyway produced "Sign in to Medora ·
 * Medora". The check is on the whole word, so a page called "Medorable" would
 * still get its suffix.
 */
export function formatDocumentTitle(title: string | null | undefined): string {
  const trimmed = title?.trim();
  if (!trimmed || trimmed === APP_NAME) return APP_NAME;
  if (new RegExp(String.raw`\b${APP_NAME}\b`, 'i').test(trimmed)) return trimmed;
  return `${trimmed} · ${APP_NAME}`;
}

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const previous = document.title;
    document.title = formatDocumentTitle(title);
    return () => {
      document.title = previous;
    };
  }, [title]);
}
