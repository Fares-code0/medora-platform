import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { I18nManager } from 'react-native';

import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';

import { DEFAULT_LOCALE, directionOf, isLocale, type Direction, type Locale } from './locales';
import { catalogues, type MessageKey } from './messages';

/**
 * Locale — checklist C-09.
 *
 * ── Why there is no i18next here ─────────────────────────────────────
 *
 * `docs/ARCHITECTURE.md` lists `i18next` under *deliberately absent*,
 * with the reason and the replacement written down before this row was
 * started: *"the typed-catalogue pattern from `frontend/src/i18n/`
 * transfers when a second locale is approved."* This is that transfer.
 * The C-09 row named the library because the row was written first; the
 * architecture document is the later and more specific decision, and a
 * dependency the tree has already reasoned itself out of should not
 * arrive because a checklist cell says a word.
 *
 * What i18next would add over this — plural rules, a loader, a
 * fallback chain, a detector — is either unused (there is no runtime
 * fallback here, because the catalogues are total by type) or would need
 * its own decision. Two locales, one bundle, no async load.
 *
 * ── RTL, and the part that cannot be pretended away ──────────────────
 *
 * `I18nManager.forceRTL` **does not take effect until the app restarts.**
 * That is a React Native platform constraint, not a shortcoming of this
 * module: the native view hierarchy reads the flag at startup. So this
 * provider does two separate things and does not conflate them:
 *
 * 1. It sets `I18nManager` so the NEXT launch lays out correctly, and
 * 2. it exposes `direction` from React state so anything that can
 *    respond immediately — a text alignment, a chevron — does.
 *
 * `language.restartRequired` is the string a switcher shows so a patient
 * who picks Arabic and sees a left-to-right screen knows why, rather than
 * concluding the setting did not work.
 */

export interface LocaleContextValue {
  readonly locale: Locale;
  readonly direction: Direction;
  readonly isRtl: boolean;
  setLocale: (locale: Locale) => void;
  /**
   * True when the chosen locale's direction differs from the one the
   * native layer is currently laying out in — i.e. a restart is needed
   * before the layout matches the language.
   */
  readonly restartRequired: boolean;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): Locale {
  const stored = preferenceStore.get(PREFERENCE_KEYS.locale);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

/**
 * Tells the native layer which direction to lay out in on the next
 * launch. Separated from the provider so it is testable without a
 * render, and so the sequencing is visible: `allowRTL` must be true
 * before `forceRTL` can be, or the second call is ignored.
 */
export function applyNativeDirection(direction: Direction): void {
  const rtl = direction === 'rtl';
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  /** Test seam. Production reads the stored preference. */
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale());

  /**
   * Tell the native layer at boot, not only when the language changes.
   *
   * The flag lives in native state that outlives a JS reload, so a
   * patient who chose Arabic, restarted, and had the app reinstalled or
   * the flag reset would otherwise get an English layout with Arabic
   * text and no way to fix it except changing the language twice.
   * Idempotent, so re-running it costs nothing.
   */
  useEffect(() => {
    applyNativeDirection(directionOf(locale));
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    preferenceStore.set(PREFERENCE_KEYS.locale, next);
    applyNativeDirection(directionOf(next));
    setLocaleState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const direction = directionOf(locale);
    return {
      locale,
      direction,
      isRtl: direction === 'rtl',
      setLocale,
      // `I18nManager.isRTL` is what the native layer is ACTUALLY doing
      // right now; `direction` is what the chosen language asks for.
      // They disagree exactly between choosing a locale and restarting.
      restartRequired: I18nManager.isRTL !== (direction === 'rtl'),
    };
  }, [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) {
    throw new Error('useLocale must be used inside a LocaleProvider.');
  }
  return value;
}

/** Only for what a layout cannot express by itself — a chevron, an icon flip. */
export function useIsRtl(): boolean {
  return useLocale().isRtl;
}

/** Values substituted into `{placeholder}` slots. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Substitute `{name}` placeholders.
 *
 * Deliberately not a template literal or a format library: the
 * catalogues are typed, the placeholder set is small, and the one thing a
 * template approach would buy — arbitrary expressions inside a message —
 * is exactly what a translator must never be handed.
 *
 * A placeholder with no matching parameter is **left as written** rather
 * than replaced with an empty string. "Step {step} of 4" is visibly wrong
 * and gets fixed; "Step  of 4" reads as a spacing bug and does not.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export type TranslateFn = (key: MessageKey, params?: MessageParams) => string;

/**
 * The translation hook.
 *
 * Every catalogue is total, so there is no fallback chain to reason
 * about. The `?? key` below is unreachable in typed code and exists only
 * for a catalogue reached through an untyped boundary — a test fixture,
 * or a locale hand-written into storage.
 */
export function useT(): TranslateFn {
  const { locale } = useLocale();

  return useCallback(
    (key: MessageKey, params?: MessageParams) =>
      interpolate(catalogues[locale][key] ?? key, params),
    [locale],
  );
}

/**
 * The translation hook for the one screen that must render with **no**
 * provider guaranteed above it: `ErrorBoundary`'s crash fallback.
 *
 * `useT` throws without a `LocaleProvider`, deliberately (see above).
 * The crash screen cannot take that dependency — it is what renders when
 * the tree has just failed — so this reads the provider's locale when
 * there is one and the stored preference when there is not. Either way
 * it reads the same total catalogue; there is still no English fallback
 * for a missing key, because there is no missing key.
 */
export function useOptionalT(): TranslateFn {
  const context = useContext(LocaleContext);
  const locale = context?.locale ?? readStoredLocale();

  return useCallback(
    (key: MessageKey, params?: MessageParams) =>
      interpolate(catalogues[locale][key] ?? key, params),
    [locale],
  );
}
