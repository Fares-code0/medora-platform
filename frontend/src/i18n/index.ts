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
 * The whole surface is five things:
 *
 * ```tsx
 * const t = useT();                       // t('nav.patients'), t('ui.results', { count })
 * const tx = useTx();                     // tx('key', { name: <strong>{name}</strong> })
 * const { locale, setLocale } = useLocale();
 * const rtl = useIsRtl();                 // only for what logical CSS can't do
 * <LocaleSwitcher />
 * ```
 *
 * Catalogue typing (owner decision, 2026-11-23): English is the source,
 * Arabic is complete (`Messages` — a missing Arabic string is a compile
 * error), and French, Persian and Turkish are partial (`PartialMessages`) and
 * fall back to English per key. Plurals follow CLDR through
 * `Intl.PluralRules`. How to add keys, plurals and rich messages, and how the
 * hard-coded-copy ratchet works: `src/i18n/README.md`.
 *
 * To add a language: add its code to `LOCALE_CODES`, its metadata to
 * `LOCALES`, and a catalogue under `messages/`.
 */

export { LocaleProvider } from './LocaleProvider';
export { useLocale, useDirection, useIsRtl, type LocaleContextValue } from './locale-context';
export {
  useT,
  useTx,
  interpolate,
  interpolateNodes,
  isMessageKey,
  resolveMessage,
  selectPluralForm,
  translate,
  translateIfKey,
  type TranslateFn,
  type RichTranslateFn,
  type MessageParams,
  type RichMessageParams,
} from './useT';
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
  messageFor,
  type MessageKey,
  type MessageValue,
  type Messages,
  type PartialMessages,
  type PluralCategory,
  type PluralForms,
  type PluralMessageKey,
} from './messages';
