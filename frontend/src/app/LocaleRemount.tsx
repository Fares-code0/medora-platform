import { Fragment, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { LOCALE_SWITCHER_ATTRIBUTE, takeSwitcherFocusRequest, useLocale } from '@/i18n';

/**
 * Remounts its children when the language changes (DEC-009).
 *
 * Dates are formatted by plain functions — column definitions, selectors,
 * export builders — that hold no React state and subscribe to nothing, so a
 * language change would otherwise leave every one of them showing the old
 * language until something happened to re-render it. Keying the routed tree
 * on the locale re-renders all of it at once. It sits inside the providers,
 * so the session, the query cache and the theme survive; what is lost is
 * on-screen state such as a half-typed form, on a control people use rarely
 * and deliberately.
 *
 * Cached queries are invalidated too, because a few demo services build
 * display labels when they fetch (`admin/overview/api`), and a cached label
 * would otherwise outlive the language it was written in.
 *
 * Focus is handed back to the language picker the change came from.
 */
export function LocaleRemount({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const first = useRef(locale);

  useEffect(() => {
    if (locale === first.current) return;
    first.current = locale;
    void queryClient.invalidateQueries();
  }, [locale, queryClient]);

  useEffect(() => {
    if (!takeSwitcherFocusRequest()) return;
    document
      .querySelector<HTMLElement>(`[${LOCALE_SWITCHER_ATTRIBUTE}] [role="combobox"]`)
      ?.focus();
  }, [locale]);

  return <Fragment key={locale}>{children}</Fragment>;
}
