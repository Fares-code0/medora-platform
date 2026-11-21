import { getPreference } from '@/services/preferences';

import { DEFAULT_LOCALE, isLocale, type Locale } from './locales';

/** The language this browser last chose, or the default. */
export function storedLocale(): Locale {
  const stored = getPreference('locale');
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}
