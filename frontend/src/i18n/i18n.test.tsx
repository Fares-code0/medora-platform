import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from './LocaleProvider';
import { LOCALES, LOCALE_CODES, directionOf, isLocale, localeMeta } from './locales';
import { LocaleSwitcher } from './LocaleSwitcher';
import {
  loadAllCatalogues,
  loadCatalogue,
  type MessageKey,
  type MessageValue,
  type PartialMessages,
  type PluralForms,
} from './messages';
import { en } from './messages/en';
import {
  interpolate,
  interpolateNodes,
  selectPluralForm,
  translate,
  useT,
  useTx,
} from './useT';

/** How many keys fa, fr and tr each carried when their typing went partial. */
const PARTIAL_FLOOR = 249;

/**
 * Keys whose Arabic is, correctly, the same text as the English: a sample
 * address, a demo code, a brand or language name written in its own script.
 */
const AR_IDENTICAL_ALLOWED: readonly MessageKey[] = [
  // A sample address: an email is Latin in every language.
  'common.emailPlaceholder',
  // The product name, kept in Latin script in the Arabic shell as well.
  'nav.assistant',
];

/**
 * F-19's contract.
 *
 * Most of the guarantees here are enforced by the typechecker — a catalogue
 * missing a key does not compile — so these tests cover the two things types
 * cannot see: that the *values* are real translations rather than copied
 * English, and that direction actually reaches the document.
 */

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('the locale set', () => {
  it('carries metadata for every code in the union', () => {
    for (const code of LOCALE_CODES) {
      expect(localeMeta(code).code).toBe(code);
    }
    expect(LOCALES).toHaveLength(LOCALE_CODES.length);
  });

  it('marks Arabic and Persian right-to-left and the rest left-to-right', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('fa')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('fr')).toBe('ltr');
    expect(directionOf('tr')).toBe('ltr');
  });

  it('rejects a code that is not a supported locale', () => {
    // The old type was `Locale = string`, so `'klingon'` was a valid locale
    // that silently fell back. The guard is what replaced that.
    expect(isLocale('en')).toBe(true);
    expect(isLocale('klingon')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('EN')).toBe(false);
  });
});

describe('the catalogues', () => {
  /*
   * Owner decision, 2026-11-23: English is the source, Arabic is complete,
   * and French, Persian and Turkish are partial — a key they lack renders in
   * English. So the coverage test is total for Arabic only; the quality tests
   * (non-empty, translated, placeholders, Persian letters) run over whatever
   * each catalogue *does* carry.
   */
  const keys = Object.keys(en) as MessageKey[];
  const PARTIAL = ['fa', 'fr', 'tr'] as const;
  // Loaded on demand in the app (NEW-21); every assertion reads all five.
  let catalogues: Record<(typeof LOCALE_CODES)[number], PartialMessages>;
  beforeAll(async () => {
    catalogues = await loadAllCatalogues();
  });

  /** Every form of a message: the string itself, or each plural form. */
  const forms = (value: MessageValue | undefined): string[] =>
    value === undefined ? [] : typeof value === 'string' ? [value] : Object.values(value);

  /** The keys a catalogue actually carries. */
  const carried = (code: (typeof LOCALE_CODES)[number]) =>
    keys.filter((key) => catalogues[code][key] !== undefined);

  it('covers every key in Arabic, and nothing English does not have', () => {
    expect(Object.keys(catalogues.ar).sort()).toEqual(keys.slice().sort());
  });

  it('lets French, Persian and Turkish omit keys, but never invent or drop one', () => {
    for (const code of PARTIAL) {
      const own = Object.keys(catalogues[code]);
      expect(own.filter((key) => !(key in en)), `${code} has keys English lacks`).toEqual([]);
      // Every key they carried when the typing went partial is still carried:
      // the fallback is for keys not translated yet, not a licence to delete.
      expect(own.length, `${code} lost translations`).toBeGreaterThanOrEqual(PARTIAL_FLOOR);
    }
  });

  it('leaves no message empty', () => {
    for (const code of LOCALE_CODES) {
      for (const key of carried(code)) {
        for (const form of forms(catalogues[code][key])) {
          expect(form.trim(), `${code}:${key}`).not.toBe('');
        }
      }
    }
  });

  it('translates Arabic in full: identical to English only where allowed', () => {
    /*
     * The failure a type system cannot catch: a catalogue that satisfies
     * `Messages` by pasting the English in. Arabic must differ on every key
     * except the few where the same text is correct — a placeholder email,
     * a demo code, a language's own name. Each is listed by name, so a new
     * one is a reviewed decision rather than a slipped string.
     */
    const identical = keys.filter(
      (key) => JSON.stringify(catalogues.ar[key]) === JSON.stringify(en[key]),
    );
    expect(identical.sort()).toEqual([...AR_IDENTICAL_ALLOWED].sort());
  });

  it('is actually translated in the partial catalogues, not English copied in', () => {
    for (const code of PARTIAL) {
      const own = carried(code);
      const identical = own.filter(
        (key) => JSON.stringify(catalogues[code][key]) === JSON.stringify(en[key]),
      );
      expect(identical.length / own.length, `${code} shares too much with en`).toBeLessThan(0.1);
    }
  });

  it('keeps every interpolation placeholder that English declares', () => {
    /*
     * A dropped `{count}` is invisible until the number it was carrying
     * disappears from a live screen. The placeholder *set* has to survive
     * translation even though word order does not.
     *
     * For a plural message the set is taken over all its forms: Arabic's
     * `one` and `two` forms («موعد واحد», «موعدان») legitimately say the
     * number in the word, so no single form has to carry `{count}` — but
     * between them the forms must use exactly English's placeholders.
     */
    const slots = (texts: string[]) =>
      [...new Set(texts.flatMap((text) => text.match(/\{\w+\}/g) ?? []))].sort();
    for (const code of LOCALE_CODES) {
      for (const key of carried(code)) {
        expect(slots(forms(catalogues[code][key])), `${code}:${key}`).toEqual(
          slots(forms(en[key])),
        );
      }
    }
  });

  it('keeps a plural message plural, with every category the language uses', () => {
    for (const key of keys) {
      if (typeof en[key] === 'string') continue;
      for (const code of LOCALE_CODES) {
        const value = catalogues[code][key];
        if (value === undefined) continue;
        expect(typeof value, `${code}:${key} is not plural`).toBe('object');
        const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
        // Arabic is held to all six; a partial catalogue to what it carries.
        if (code === 'ar' || code === 'en') {
          expect(Object.keys(value).sort(), `${code}:${key}`).toEqual([...categories].sort());
        } else {
          for (const category of Object.keys(value)) {
            expect(categories, `${code}:${key}:${category}`).toContain(category);
          }
        }
      }
    }
  });

  it('uses Persian ک and ی rather than their Arabic lookalikes', () => {
    /*
     * U+0643 and U+064A render *almost* identically to U+06A9 and U+06CC,
     * which is exactly why this is worth a test: an Arabic keyboard produces
     * text that looks right to a non-reader and wrong to every Persian
     * speaker, and no reviewer catches it by eye.
     */
    const fa = catalogues.fa;
    for (const key of carried('fa')) {
      for (const form of forms(fa[key])) {
        expect(form, `fa:${key} contains Arabic kaf/yeh`).not.toMatch(/[كي]/);
      }
    }
  });
});

describe('fallback for a partial catalogue', () => {
  beforeAll(async () => {
    await loadAllCatalogues();
  });

  it('renders English for a key French has not translated yet', async () => {
    const fr = await loadCatalogue('fr');
    const missing = (Object.keys(en) as MessageKey[]).find(
      (key) => fr[key] === undefined && typeof en[key] === 'string',
    );
    expect(missing, 'expected at least one key French does not carry').toBeDefined();
    expect(translate('fr', missing!)).toBe(en[missing!]);
  });

  it('chooses the plural form of the English fallback by English rules', async () => {
    const fr = await loadCatalogue('fr');
    const plural = (Object.keys(en) as MessageKey[]).find(
      (key) => typeof en[key] !== 'string' && fr[key] === undefined,
    );
    expect(plural, 'expected a plural key French does not carry').toBeDefined();
    // French rules put 0 in `one`; English puts it in `other`.
    expect(translate('fr', plural!, { count: 0 })).toBe(translate('en', plural!, { count: 0 }));
  });

  it('keeps an existing French translation', () => {
    expect(translate('fr', 'login.submit')).not.toBe(en['login.submit']);
  });

  it.each(['fr', 'fa', 'tr'] as const)(
    'keeps the unread counts translated in %s (they were, before the plural keys)',
    async (code) => {
      /*
       * The bell, its badge, the panel pill and the tab badge used to compose
       * `t('shell.notifications')` and `t('shell.unread')`, both translated in
       * every language. The plural keys that replaced the concatenation must
       * not turn those back into English for French, Persian or Turkish.
       */
      const catalogue = await loadCatalogue(code);
      for (const key of [
        'shell.unreadCount',
        'shell.notificationsUnread',
        'shell.unreadNotificationsBadge',
      ] as const) {
        expect(catalogue[key], `${code}:${key}`).toBeDefined();
        for (const count of [1, 3]) {
          expect(translate(code, key, { count }), `${code}:${key}:${String(count)}`).not.toBe(
            translate('en', key, { count }),
          );
        }
      }
    },
  );
});

describe('plurals', () => {
  const english: PluralForms = { one: '{count} appointment', other: '{count} appointments' };
  const arabic: PluralForms = {
    zero: 'لا مواعيد',
    one: 'موعد واحد',
    two: 'موعدان',
    few: '{count} مواعيد',
    many: '{count} موعدًا',
    other: '{count} موعد',
  };

  it('selects English one/other', () => {
    expect(selectPluralForm('en', english, 1)).toBe('{count} appointment');
    expect(selectPluralForm('en', english, 0)).toBe('{count} appointments');
    expect(selectPluralForm('en', english, 2)).toBe('{count} appointments');
  });

  it('selects all six Arabic forms', () => {
    expect(selectPluralForm('ar', arabic, 0)).toBe('لا مواعيد');
    expect(selectPluralForm('ar', arabic, 1)).toBe('موعد واحد');
    expect(selectPluralForm('ar', arabic, 2)).toBe('موعدان');
    expect(selectPluralForm('ar', arabic, 3)).toBe('{count} مواعيد');
    expect(selectPluralForm('ar', arabic, 10)).toBe('{count} مواعيد');
    expect(selectPluralForm('ar', arabic, 11)).toBe('{count} موعدًا');
    expect(selectPluralForm('ar', arabic, 99)).toBe('{count} موعدًا');
    expect(selectPluralForm('ar', arabic, 100)).toBe('{count} موعد');
    expect(selectPluralForm('ar', arabic, 102)).toBe('{count} موعد');
  });

  it('falls back to other for a missing category or a missing count', () => {
    expect(selectPluralForm('ar', { other: 'x' }, 2)).toBe('x');
    expect(selectPluralForm('en', english, undefined)).toBe('{count} appointments');
    expect(selectPluralForm('en', english, Number.NaN)).toBe('{count} appointments');
  });

  it('runs through t() for a catalogue plural key in English and Arabic', async () => {
    await loadAllCatalogues();
    expect(translate('en', 'ui.resultCount', { count: 1 })).toBe('1 result');
    expect(translate('en', 'ui.resultCount', { count: 5 })).toBe('5 results');
    const arabicForms = [0, 1, 2, 3, 11, 100].map((count) =>
      translate('ar', 'ui.resultCount', { count }),
    );
    // Six counts, six categories, six different sentences.
    expect(new Set(arabicForms).size).toBe(6);
    expect(arabicForms.every((text) => !text.includes('{'))).toBe(true);
  });
});

describe('interpolateNodes', () => {
  it('returns a plain string when every value is a primitive', () => {
    expect(interpolateNodes('Step {step} of {total}', { step: 2, total: 4 })).toBe('Step 2 of 4');
  });

  it('slots elements into the translated order', () => {
    const node = interpolateNodes('سيتم إيقاف {name} وإلغاء {count} مواعيد', {
      name: <strong>Dr. Lina</strong>,
      count: 3,
    });
    render(<p data-testid="rich">{node}</p>);
    const rich = screen.getByTestId('rich');
    expect(rich).toHaveTextContent('سيتم إيقاف Dr. Lina وإلغاء 3 مواعيد');
    expect(rich.querySelector('strong')).toHaveTextContent('Dr. Lina');
  });

  it('leaves a missing slot visible', () => {
    render(<p data-testid="rich">{interpolateNodes('Hello {name} {who}', { who: <b>x</b> })}</p>);
    expect(screen.getByTestId('rich')).toHaveTextContent('Hello {name} x');
  });

  it('is what useTx renders, in the active language', () => {
    function RichProbe() {
      const tx = useTx();
      return <p data-testid="rich">{tx('flow.stepOf', { step: <b>2</b>, total: 4 })}</p>;
    }
    render(<RichProbe />);
    expect(screen.getByTestId('rich')).toHaveTextContent('Step 2 of 4');
    expect(screen.getByTestId('rich').querySelector('b')).toHaveTextContent('2');
  });
});

describe('interpolate', () => {
  it('substitutes named parameters', () => {
    expect(interpolate('Step {step} of {total}', { step: 2, total: 4 })).toBe('Step 2 of 4');
  });

  it('leaves an unmatched placeholder visible rather than blanking it', () => {
    // "Step {step} of 4" is a bug someone fixes; "Step  of 4" is a bug
    // someone reads past.
    expect(interpolate('Step {step} of {total}', { total: 4 })).toBe('Step {step} of 4');
  });

  it('does not touch a message with no placeholders', () => {
    expect(interpolate('Sign in')).toBe('Sign in');
  });
});

function Probe() {
  const t = useT();
  return (
    <>
      <p data-testid="msg">{t('login.submit')}</p>
      <p data-testid="interp">{t('flow.stepOf', { step: 2, total: 4 })}</p>
      <LocaleSwitcher />
    </>
  );
}

function renderProbe() {
  return render(
    <LocaleProvider>
      <Probe />
    </LocaleProvider>,
  );
}

/**
 * `Select` is the DS combobox (a button plus a listbox), not a native
 * `<select>`, so options exist only while it is open.
 */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name }));
}

describe('LocaleProvider', () => {
  it('starts in English and sets both lang and dir', () => {
    renderProbe();
    expect(screen.getByTestId('msg')).toHaveTextContent('Sign in');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches the document to RTL when Arabic is chosen', async () => {
    const user = userEvent.setup();
    renderProbe();

    await choose(user, 'العربية');

    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByTestId('msg')).toHaveTextContent('تسجيل الدخول');
  });

  it('sets dir back to ltr when leaving an RTL locale', async () => {
    /*
     * The bug this catches: setting `dir` on the way in and never on the way
     * out leaves a French UI laid out right-to-left. Positive-then-negative,
     * so the assertion cannot pass on a document that was never RTL.
     */
    const user = userEvent.setup();
    renderProbe();

    await choose(user, 'فارسی');
    expect(document.documentElement.dir).toBe('rtl');

    await choose(user, 'Français');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('translates an interpolated message in every locale', async () => {
    const user = userEvent.setup();
    renderProbe();

    for (const meta of LOCALES) {
      await choose(user, meta.label);
      const rendered = screen.getByTestId('interp').textContent ?? '';
      expect(rendered, meta.code).toContain('2');
      expect(rendered, meta.code).toContain('4');
      expect(rendered, meta.code).not.toContain('{');
    }
  });

  it('persists the choice and restores it on the next mount', async () => {
    const user = userEvent.setup();
    const { unmount } = renderProbe();

    await choose(user, 'Türkçe');
    unmount();
    renderProbe();

    expect(screen.getByTestId('msg')).toHaveTextContent('Giriş yap');
    expect(document.documentElement.lang).toBe('tr');
  });

  it('falls back to English for a stored value that is not a locale', () => {
    // Storage is user-writable and survives a release that drops a language.
    window.localStorage.setItem('medora.locale', JSON.stringify('klingon'));
    renderProbe();
    expect(screen.getByTestId('msg')).toHaveTextContent('Sign in');
  });
});

describe('LocaleSwitcher', () => {
  it('labels each option with its endonym', async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole('combobox'));

    for (const meta of LOCALES) {
      expect(await screen.findByRole('option', { name: meta.label })).toBeInTheDocument();
    }
  });

  it('offers exactly the supported locales and nothing else', async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole('combobox'));

    expect(screen.getAllByRole('option')).toHaveLength(LOCALE_CODES.length);
  });
});
