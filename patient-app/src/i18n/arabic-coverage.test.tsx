import type React from 'react';

import fs from 'node:fs';
import path from 'node:path';

import { act } from '@testing-library/react-native';
import { I18nManager } from 'react-native';

import { resolveGlyph, mirrorsInRtl } from '@/components/Icon';
import { ListItem } from '@/components/layout/ListItem';
import { ForgotPasswordScreen } from '@/features/auth/screens/ForgotPasswordScreen';
import { LoginScreen } from '@/features/auth/screens/LoginScreen';
import { RegisterScreen } from '@/features/auth/screens/RegisterScreen';
import { ResetPasswordScreen } from '@/features/auth/screens/ResetPasswordScreen';
import { VerifyEmailScreen } from '@/features/auth/screens/VerifyEmailScreen';
import { WelcomeScreen } from '@/features/auth/screens/WelcomeScreen';
import { catalogues } from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { SCREENS, hostedScreen, mockNavigation, type HostedScreen } from '@/test/screens';

/**
 * **No English application copy on an Arabic screen** — C-09, W-10.
 *
 * On 2026-11-23 the W-10 owner approved localizing ALL application-
 * controlled copy, emergency and clinical copy included. This is the
 * test that holds the result: it renders the main screens — sign-in and
 * registration, Home, Emergency, appointments, messages, health records,
 * profile and settings, and the assistant — in Arabic, walks every text
 * node and every accessibility string, and fails on Latin-script words
 * that are not one of three things:
 *
 * 1. **Latin by policy**: the product name "Medora", which policy keeps
 *    in Latin where it stands alone as a name (`navigation/AppTabs.tsx`,
 *    the Welcome heading); Apple's product name "Face ID"; the platform
 *    identifier (`ios`/`android`) in the Support screen's version line;
 *    an avatar's one-to-three capital initials, which are a data name's;
 *    and the `__DEV__`-only sign-in controls, which a release build does
 *    not contain (`no-inline-copy.test.ts` allows the same strings).
 * 2. **Data**: words that occur in the fixtures standing in for the
 *    server — a doctor's name, a department, an allergen, a clinic
 *    address. Data is never translated, by rule. The vocabulary is read
 *    from the fixture sources rather than written here, so it cannot be
 *    used to hide app copy.
 * 3. Non-words: digits, units, punctuation — anything that is not two
 *    Latin letters in a row.
 *
 * And because (2) is a word list, a second, stricter check runs beside
 * it: no rendered string may contain any multi-word ENGLISH catalogue
 * value. Data cannot excuse a whole English sentence of this app's own.
 *
 * It complements `raw-key-leak.test.tsx` (no key, brace or wire literal
 * reaches the screen) and `no-inline-copy.test.ts` (no English in the
 * source): those find the mechanism, this finds the symptom.
 */

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('react') as typeof React).useEffect(effect, [effect]);
  },
}));

const SRC = path.resolve(__dirname, '..');

/** Fixture and service sources: the stand-ins for server data. */
function dataSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        (full.includes(`${path.sep}fixtures${path.sep}`) ||
          full.includes(`${path.sep}dev${path.sep}`) ||
          entry.name === 'service.ts')
      ) {
        files.push(full);
      }
    }
  };
  walk(path.join(SRC, 'features'));
  files.push(path.join(SRC, 'test', 'screens.tsx'));
  return files;
}

/** Every string literal in a data source, and every Latin word inside one. */
const DATA_STRINGS = new Set<string>();
const DATA_WORDS: ReadonlySet<string> = (() => {
  const words = new Set<string>();
  for (const file of dataSources()) {
    const source = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const literal of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
      const text = literal[1] ?? literal[2] ?? literal[3] ?? '';
      DATA_STRINGS.add(text);
      for (const word of text.match(/[A-Za-z]{2,}/g) ?? []) words.add(word);
    }
  }
  return words;
})();

/** Latin by policy, not by omission. */
const LATIN_BY_POLICY = new Set(['Medora', 'Face', 'ID', 'ios', 'android']);

/** Avatar initials: derived from a data name, never copy. */
const INITIALS = /^[A-Z]{1,3}$/;

/**
 * The `__DEV__`-gated sign-in block (`LoginScreen`), exactly the strings
 * `no-inline-copy.test.ts` allows. Jest runs with `__DEV__` true; a
 * release build compiles the block away.
 */
const DEV_ONLY = new Set([
  'Continue as Demo Patient',
  'Development build — fixture data',
  'Development',
  'Local development session for ',
  '. Not available in a release build.',
  ' · OTP',
]);

/** The English sentences of this app, which must never appear in Arabic. */
const ENGLISH_SENTENCES: readonly string[] = Object.values(catalogues.en)
  .filter((value) => !value.includes('{'))
  .filter((value) => value.trim().split(/\s+/).length >= 2)
  // Identical in both catalogues would be a brand or a token, not copy.
  .filter((value) => !Object.values(catalogues.ar).includes(value));

const TEXTUAL_PROPS = [
  'accessibilityLabel',
  'accessibilityHint',
  'label',
  'title',
  'subtitle',
  'placeholder',
] as const;

function collect(node: unknown, found: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    found.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, found);
    return;
  }
  if (typeof node !== 'object') return;
  const element = node as { props?: Record<string, unknown>; children?: unknown };
  const props = element.props ?? {};
  // `testID`, `nativeID` and style names are not read by anyone.
  for (const name of TEXTUAL_PROPS) {
    const value = props[name];
    if (typeof value === 'string') found.push(value);
  }
  collect(element.children, found);
}

function englishIn(tree: unknown): string[] {
  const strings: string[] = [];
  collect(tree, strings);

  const leaks = new Set<string>();
  for (const value of strings) {
    if (DEV_ONLY.has(value) || INITIALS.test(value.trim())) continue;
    for (const word of value.match(/[A-Za-z]{2,}/g) ?? []) {
      if (LATIN_BY_POLICY.has(word) || DATA_WORDS.has(word)) continue;
      leaks.add(`${word}  ←  "${value}"`);
    }
    // Server-supplied text that happens to match a catalogue sentence — a
    // notification titled "Appointment confirmed", alone or inside an
    // accessibility label — is data, not this app's copy.
    for (const sentence of ENGLISH_SENTENCES) {
      if (!value.includes(sentence)) continue;
      const isData = [...DATA_STRINGS].some(
        (data) => data.includes(sentence) && value.includes(data),
      );
      if (!isData) leaks.add(`catalogue English "${sentence}"  ←  "${value}"`);
    }
  }
  return [...leaks].sort();
}

/** The entry stack, which `SCREENS` (a signed-in sweep) does not hold. */
const AUTH_SCREENS: readonly HostedScreen[] = [
  ['Welcome', WelcomeScreen, {}],
  ['Login', LoginScreen, {}],
  ['Register', RegisterScreen, {}],
  ['ForgotPassword', ForgotPasswordScreen, {}],
  ['ResetPassword', ResetPasswordScreen, {}],
  ['VerifyEmail', VerifyEmailScreen, { email: 'amina@example.com' }],
];

/* The assistant screens (K-01) are in `SCREENS`, so they are swept like every other. */
const ALL: readonly HostedScreen[] = [...AUTH_SCREENS, ...SCREENS];

describe('the data vocabulary is real, so it cannot hide app copy by accident', () => {
  it('was read from the fixtures', () => {
    expect(DATA_WORDS.size).toBeGreaterThan(50);
  });

  it('checks a meaningful number of English sentences', () => {
    expect(ENGLISH_SENTENCES.length).toBeGreaterThan(300);
  });
});

describe('no English application copy reaches an Arabic screen', () => {
  it.each(ALL)('%s', async (name, screen, params) => {
    const view = renderWithProviders(await hostedScreen([name, screen, params]), {
      locale: 'ar',
    });

    await act(async () => undefined);
    await act(async () => undefined);

    expect(englishIn(view.toJSON())).toEqual([]);
  });
});

describe('the mirrored icons follow the layout direction (S-08)', () => {
  it('points Back right and Forward left, and flips Send, in a right-to-left layout', () => {
    expect(resolveGlyph('back', true)).toBe('chevron-right');
    expect(resolveGlyph('forward', true)).toBe('chevron-left');
    expect(mirrorsInRtl('send', true)).toBe(true);
  });

  it('leaves all three alone in a left-to-right layout', () => {
    expect(resolveGlyph('back', false)).toBe('chevron-left');
    expect(resolveGlyph('forward', false)).toBe('chevron-right');
    expect(mirrorsInRtl('send', false)).toBe(false);
  });

  it('is decided by the native layout, not by the chosen language', () => {
    // `Icon` reads `I18nManager.isRTL`; the language switch takes effect
    // on restart (`LocaleProvider`). Asserted here so a change to read the
    // locale instead — which points icons wrong until the restart — fails.
    expect(typeof I18nManager.isRTL).toBe('boolean');
  });
});

describe('a read-only row is announced with the locale’s comma (review L-5)', () => {
  it('uses "," in English and "،" in Arabic', () => {
    const english = renderWithProviders(
      <ListItem title="Blood type" value="O+" readOnly testID="row" />,
    );
    expect(english.getByTestId('row').props.accessibilityLabel).toBe('Blood type, O+, read only');
    english.unmount();

    const arabic = renderWithProviders(
      <ListItem title="فصيلة الدم" value="O+" readOnly testID="row" />,
      { locale: 'ar' },
    );
    expect(arabic.getByTestId('row').props.accessibilityLabel).toBe('فصيلة الدم، O+، للقراءة فقط');
  });
});
