import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from './LocaleProvider';
import { LOCALES, LOCALE_CODES, directionOf, isLocale, localeMeta } from './locales';
import { LocaleSwitcher } from './LocaleSwitcher';
import { loadAllCatalogues, type Messages } from './messages';
import { en } from './messages/en';
import { interpolate, useT } from './useT';

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
  const keys = Object.keys(en) as (keyof typeof en)[];
  // Loaded on demand in the app (NEW-21); every assertion reads all five.
  let catalogues: Record<(typeof LOCALE_CODES)[number], Messages>;
  beforeAll(async () => {
    catalogues = await loadAllCatalogues();
  });

  it('cover every key in every locale', () => {
    for (const code of LOCALE_CODES) {
      expect(Object.keys(catalogues[code]).sort()).toEqual(keys.slice().sort());
    }
  });

  it('leaves no message empty', () => {
    for (const code of LOCALE_CODES) {
      for (const key of keys) {
        expect(catalogues[code][key].trim(), `${code}:${key}`).not.toBe('');
      }
    }
  });

  it('is actually translated, not English copied into four files', () => {
    /*
     * The failure this catches is the one a type system cannot: a catalogue
     * that satisfies `Record<MessageKey, string>` by pasting the English in.
     * A handful of strings legitimately match across locales — a placeholder
     * email, a brand name, the demo code — so the assertion is on the
     * proportion, not on every key.
     */
    for (const code of LOCALE_CODES.filter((c) => c !== 'en')) {
      const identical = keys.filter((key) => catalogues[code][key] === en[key]);
      expect(identical.length / keys.length, `${code} shares too much with en`).toBeLessThan(0.1);
    }
  });

  it('keeps every interpolation placeholder that English declares', () => {
    /*
     * A dropped `{count}` is invisible until the number it was carrying
     * disappears from a live screen. The placeholder *set* has to survive
     * translation even though word order does not.
     */
    const slots = (text: string) => new Set(text.match(/\{\w+\}/g) ?? []);
    for (const code of LOCALE_CODES) {
      for (const key of keys) {
        expect([...slots(catalogues[code][key])].sort(), `${code}:${key}`).toEqual(
          [...slots(en[key])].sort(),
        );
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
    for (const key of keys) {
      expect(fa[key], `fa:${key} contains Arabic kaf/yeh`).not.toMatch(/[كي]/);
    }
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
