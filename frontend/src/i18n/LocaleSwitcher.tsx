import { useMemo } from 'react';

import { Select, type SelectOption } from '@/components/ui';

import { LOCALE_SWITCHER_ATTRIBUTE, requestSwitcherFocus } from './focus-after-remount';
import { useLocale } from './locale-context';
import { isLocale } from './locales';
import { useT } from './useT';

/**
 * The app-wide language switcher (F-19).
 *
 * One control, mounted wherever a language can be chosen — the login screen
 * and Settings → Appearance today. It is a `Select` rather than a flag row
 * on purpose: flags name countries, not languages, and Arabic, Persian and
 * French are each spoken across many of them.
 *
 * Options are labelled with the **endonym** — العربية, Türkçe — because that
 * is what a speaker scans a language list for. The accessible name adds the
 * English name, so a screen reader that has not yet switched voices still
 * announces something its current voice can pronounce.
 */
export interface LocaleSwitcherProps {
  readonly className?: string | undefined;
}

export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const { locale, setLocale, locales } = useLocale();
  const t = useT();

  const options = useMemo<SelectOption[]>(
    () => locales.map((meta) => ({ value: meta.code, label: meta.label })),
    [locales],
  );

  return (
    // `contents`: a marker for focus restoration, not a box in the layout.
    <span className="contents" {...{ [LOCALE_SWITCHER_ATTRIBUTE]: '' }}>
      <Select
        options={options}
        value={locale}
        onChange={(next) => {
          // `Select` speaks strings; the guard is what turns one back into a
          // `Locale` without a cast, so an option list that drifted from the
          // union cannot set an unsupported locale.
          if (isLocale(next) && next !== locale) {
            // The change remounts the page (LocaleRemount); keep focus here.
            requestSwitcherFocus();
            setLocale(next);
          }
        }}
        aria-label={t('locale.label')}
        className={className}
      />
    </span>
  );
}
