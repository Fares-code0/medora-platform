import { act, render, screen } from '@testing-library/react-native';
import { I18nManager, Text } from 'react-native';

import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';

import {
  applyNativeDirection,
  interpolate,
  LocaleProvider,
  useLocale,
  useT,
} from './LocaleProvider';
import { DEFAULT_LOCALE, directionOf, isLocale, LOCALES, LOCALE_CODES } from './locales';
import { catalogues, en, type MessageKey } from './messages';

/**
 * i18n — checklist C-09.
 *
 * The catalogue-totality tests below look tautological in TypeScript and
 * are not: they are the assertion that survives someone reaching a
 * catalogue through an untyped boundary — a locale hand-written into
 * storage, a fixture, a JSON import.
 */

/** RNTL's `toHaveTextContent` is not set up in this tree; read the node. */
function textOf(testID: string): string {
  return String(screen.getByTestId(testID).props.children);
}

function Probe({ keyName }: { keyName: MessageKey }) {
  const t = useT();
  const { locale, direction, restartRequired } = useLocale();
  return (
    <>
      <Text testID="text">{t(keyName)}</Text>
      <Text testID="locale">{locale}</Text>
      <Text testID="direction">{direction}</Text>
      <Text testID="restart">{restartRequired ? 'restart' : 'applied'}</Text>
    </>
  );
}

describe('initialisation', () => {
  it('starts in English when nothing is stored', () => {
    preferenceStore.remove(PREFERENCE_KEYS.locale);

    render(
      <LocaleProvider>
        <Probe keyName="action.retry" />
      </LocaleProvider>,
    );

    expect(textOf('locale')).toBe('en');
    expect(textOf('text')).toBe('Try again');
  });

  it('restores a stored locale', () => {
    preferenceStore.set(PREFERENCE_KEYS.locale, 'ar');

    render(
      <LocaleProvider>
        <Probe keyName="action.retry" />
      </LocaleProvider>,
    );

    expect(textOf('locale')).toBe('ar');
    expect(textOf('text')).toBe('حاول مرة أخرى');
  });

  it('ignores a stored value that is not a locale', () => {
    // A hand-written preference, or one left by an older build. The union
    // is what turns this from a runtime fallback into a checked case.
    preferenceStore.set(PREFERENCE_KEYS.locale, 'klingon');

    render(
      <LocaleProvider>
        <Probe keyName="action.retry" />
      </LocaleProvider>,
    );

    expect(textOf('locale')).toBe(DEFAULT_LOCALE);
  });

  it('refuses to run outside a provider rather than translating silently', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Probe keyName="action.retry" />)).toThrow(/LocaleProvider/);

    spy.mockRestore();
  });
});

describe('choosing a language', () => {
  it('switches the strings', () => {
    preferenceStore.remove(PREFERENCE_KEYS.locale);

    function Switcher() {
      const { setLocale } = useLocale();
      return <Text testID="switch" onPress={() => setLocale('ar')} />;
    }

    render(
      <LocaleProvider>
        <Probe keyName="state.error.title" />
        <Switcher />
      </LocaleProvider>,
    );

    expect(textOf('text')).toBe('Something went wrong');

    act(() => {
      screen.getByTestId('switch').props.onPress();
    });

    expect(textOf('text')).toBe('حدث خطأ ما');
  });

  it('persists the choice', () => {
    preferenceStore.remove(PREFERENCE_KEYS.locale);

    function Switcher() {
      const { setLocale } = useLocale();
      return <Text testID="switch" onPress={() => setLocale('ar')} />;
    }

    render(
      <LocaleProvider>
        <Switcher />
      </LocaleProvider>,
    );

    act(() => {
      screen.getByTestId('switch').props.onPress();
    });

    expect(preferenceStore.get(PREFERENCE_KEYS.locale)).toBe('ar');
  });
});

describe('direction', () => {
  it('reports rtl for Arabic and ltr for English immediately', () => {
    preferenceStore.set(PREFERENCE_KEYS.locale, 'ar');

    render(
      <LocaleProvider>
        <Probe keyName="action.retry" />
      </LocaleProvider>,
    );

    // React state can flip at once even though the native layout cannot.
    expect(textOf('direction')).toBe('rtl');
  });

  it('tells the native layer, allowing before forcing', () => {
    const allow = jest.spyOn(I18nManager, 'allowRTL');
    const force = jest.spyOn(I18nManager, 'forceRTL');

    applyNativeDirection('rtl');

    // `forceRTL` is ignored unless `allowRTL` was set first, so the order
    // is load-bearing rather than stylistic.
    expect(allow).toHaveBeenCalledWith(true);
    expect(force).toHaveBeenCalledWith(true);
    expect(allow.mock.invocationCallOrder[0]).toBeLessThan(force.mock.invocationCallOrder[0] ?? 0);
  });

  it('tells the native layer at BOOT, not only when the language changes', () => {
    // The flag lives in native state that outlives a JS reload. A
    // patient who chose Arabic and then had it reset would otherwise get
    // an English layout with Arabic text and no way back except changing
    // the language twice.
    preferenceStore.set(PREFERENCE_KEYS.locale, 'ar');
    const force = jest.spyOn(I18nManager, 'forceRTL');

    render(
      <LocaleProvider>
        <Probe keyName="action.retry" />
      </LocaleProvider>,
    );

    expect(force).toHaveBeenCalledWith(true);
  });

  it('says a restart is needed while the native layout disagrees', () => {
    // `I18nManager.isRTL` is false in this environment, so choosing
    // Arabic is exactly the disagreement a patient would see: the
    // language changed, the layout did not, and the app has to say why.
    preferenceStore.set(PREFERENCE_KEYS.locale, 'ar');

    render(
      <LocaleProvider>
        <Probe keyName="action.retry" />
      </LocaleProvider>,
    );

    expect(textOf('restart')).toBe('restart');
  });

  it('does not claim a restart is needed when the layout already matches', () => {
    preferenceStore.remove(PREFERENCE_KEYS.locale);

    render(
      <LocaleProvider>
        <Probe keyName="action.retry" />
      </LocaleProvider>,
    );

    expect(textOf('restart')).toBe('applied');
  });
});

describe('the catalogues', () => {
  it('covers every locale in the union', () => {
    expect(Object.keys(catalogues).sort()).toEqual([...LOCALE_CODES].sort());
    expect(LOCALES.map((meta) => meta.code).sort()).toEqual([...LOCALE_CODES].sort());
  });

  it('translates every English key in every locale', () => {
    const keys = Object.keys(en);
    for (const code of LOCALE_CODES) {
      expect(Object.keys(catalogues[code]).sort()).toEqual([...keys].sort());
    }
  });

  it('leaves no string empty or accidentally still English', () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(catalogues.ar[key].trim().length).toBeGreaterThan(0);
      // Not a quality check — a "did anyone actually translate this" check.
      // The two catalogues may legitimately share a value one day; when
      // they do, this test names the key and someone decides.
      expect(catalogues.ar[key]).not.toBe(catalogues.en[key]);
    }
  });

  it('uses the same placeholders in every locale', () => {
    /**
     * A translated string with `{doctor}` misspelled, or dropped, or
     * gained, is a brace on a patient's screen: `interpolate` leaves an
     * unsupplied placeholder verbatim, which is the right behaviour —
     * substituting "undefined" into a sentence is worse — and it means
     * the failure is silent until somebody reads the screen in that
     * language. Nobody on this project reads Arabic natively, and
     * `messages/ar.ts` says so at the top, which is precisely why this
     * has to be a test rather than a review.
     *
     * `raw-key-leak.test.tsx` holds the other end of the same defect —
     * a call site that forgot a parameter — by rendering every screen
     * and failing on any brace that survived.
     */
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

    for (const key of Object.keys(en) as MessageKey[]) {
      for (const code of LOCALE_CODES) {
        expect({ key, code, placeholders: placeholders(catalogues[code][key]) }).toEqual({
          key,
          code,
          placeholders: placeholders(en[key]),
        });
      }
    }
  });

  /**
   * ── Clinical content in the catalogue ─────────────────────────────
   *
   * N-07 and W-10 make emergency guidance clinically reviewed material,
   * and an unreviewed Arabic rendering of first-aid text is exactly what
   * those rows exist to prevent. This test used to assert that no value
   * in the catalogue contained any of six clinical words at all.
   *
   * That was right about the danger and too blunt to survive Phase K's
   * interface landing, for two reasons the blanket ban could not tell
   * apart:
   *
   * - A **negation** is not clinical guidance. "It cannot diagnose you"
   *   is the disclaimer this file's own header puts on the near side of
   *   the line — it says what Medora is not, which is product copy.
   * - A **symptom intake form's option list** is a vocabulary a patient
   *   picks from to describe themselves, on a screen that draws no
   *   conclusion from it whatsoever (`features/ai/content/intake.ts`).
   *   Leaving it untranslated would hand an Arabic-speaking patient an
   *   English form about their own body.
   *
   * So the ban stands, and the exceptions are **named one key at a
   * time**, in the idiom `no-inline-copy.test.ts` established: every
   * entry is a decision somebody made, a new clinical word in an
   * unlisted key still fails, and a stale exemption fails too.
   *
   * ⚠ Every key below is inside **W-10's clinical sign-off**, which
   * covers this catalogue before any build ships. Listing them here is
   * what makes that reviewable — it is the list of strings a clinician
   * must read in both languages.
   */
  const CLINICAL_WORDS = ['symptom', 'diagnos', 'dose', 'first aid', 'ambulance', 'chest pain'];

  const CLINICAL_EXEMPT: Readonly<Record<string, string>> = {
    // Disclaimers — negations of clinical capability (see the header).
    'ai.disclaimer.body': 'disclaimer: says Medora cannot diagnose',
    'ai.safety.notADoctor.body': 'disclaimer: says Medora cannot diagnose',
    // The intake's own name, on the screen and in the navigator.
    'ai.capability.symptoms.title': 'the intake screen’s title',
    'ai.intake.title': 'the intake screen’s title',
    'nav.title.assistantSymptoms': 'the intake screen’s navigator title',
    'ai.home.scope.body': 'names the intake among the four K-01 contexts',
    // The intake vocabulary. A patient's own description of themselves,
    // read by nothing (`features/ai/content/intake.ts`).
    'ai.symptom.chestPain': 'intake vocabulary (K-01)',
  };

  it('carries no clinical content outside the keys named above', () => {
    const found: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      for (const clinical of CLINICAL_WORDS) {
        if (!value.toLowerCase().includes(clinical)) continue;
        if (key in CLINICAL_EXEMPT) continue;
        found.push(`${key} → "${clinical}"`);
      }
    }
    expect(found).toEqual([]);
  });

  it('carries no exemption for a key that no longer needs one', () => {
    // An allow-list nobody prunes stops describing the catalogue and
    // starts hiding it.
    for (const key of Object.keys(CLINICAL_EXEMPT)) {
      const value = (en as Record<string, string>)[key];
      const stillClinical =
        value !== undefined && CLINICAL_WORDS.some((w) => value.toLowerCase().includes(w));
      expect({ key, stillNeeded: stillClinical }).toEqual({ key, stillNeeded: true });
    }
  });

  it('still refuses emergency guidance outright, in any key', () => {
    // The half of the original rule that takes no exceptions: N-07's
    // first-aid material is not in this catalogue and never will be.
    const values = Object.values(en).join(' ').toLowerCase();
    for (const guidance of ['first aid', 'ambulance', 'cpr', 'recovery position']) {
      expect(values).not.toContain(guidance);
    }
  });

  it('recognises only real locale codes', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('EN')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });
});

describe('interpolation', () => {
  it('substitutes named placeholders', () => {
    expect(interpolate('Step {step} of {total}', { step: 2, total: 4 })).toBe('Step 2 of 4');
  });

  it('leaves an unmatched placeholder visible rather than blank', () => {
    // "Step {step} of 4" is visibly wrong and gets fixed; "Step  of 4"
    // reads as a spacing bug and does not.
    expect(interpolate('Step {step} of 4', { total: 4 })).toBe('Step {step} of 4');
  });

  it('is a no-op without parameters', () => {
    expect(interpolate('Try again')).toBe('Try again');
  });
});
