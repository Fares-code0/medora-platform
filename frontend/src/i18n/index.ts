/**
 * i18n — PUBLIC API (F-19).
 *
 * A platform layer, not a feature: it imports nothing from `features/`, so
 * any feature may use it without crossing §1.2 or §3.4. It replaced
 * `features/auth/i18n/`, which was feature-local and therefore unusable by
 * the other twelve features — the reason F-19 was a rewrite rather than a
 * translation pass. That directory survived the move as three re-export
 * shims so auth's call sites need not change; they now import from here
 * directly and the shims are gone, so this is the only i18n module in `src/`.
 *
 * The whole surface is four things:
 *
 * ```tsx
 * const t = useT();                       // t('nav.patients')
 * const { locale, setLocale } = useLocale();
 * const rtl = useIsRtl();                 // only for what logical CSS can't do
 * <LocaleSwitcher />
 * ```
 *
 * To add a language: add its code to `LOCALE_CODES`, its metadata to
 * `LOCALES`, and a catalogue under `messages/`. The typechecker names every
 * string still missing — there is no runtime "untranslated" state to
 * discover in the browser.
 */

export { LocaleProvider } from './LocaleProvider';
export { useLocale, useDirection, useIsRtl, type LocaleContextValue } from './locale-context';
export { useT, interpolate, type TranslateFn, type MessageParams } from './useT';
export { LocaleSwitcher, type LocaleSwitcherProps } from './LocaleSwitcher';
export { isolateLtr, withoutIsolates } from './bidi';
export {
  LOCALE_SWITCHER_ATTRIBUTE,
  requestSwitcherFocus,
  takeSwitcherFocusRequest,
} from './focus-after-remount';
export {
  formatDate,
  formatDateTime,
  formatDateWith,
  formatLocale,
  formatNumber,
  formatTime,
  isUsableTimeZone,
  setFormatLocale,
  wallClockIn,
  type WallClock,
} from './format';
export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_CODES,
  directionOf,
  isLocale,
  localeMeta,
  type Direction,
  type Locale,
  type LocaleMeta,
} from './locales';
export { storedLocale } from './stored-locale';
export {
  isCatalogueLoaded,
  loadAllCatalogues,
  loadCatalogue,
  type MessageKey,
  type Messages,
} from './messages';
