import type React from 'react';

import { act } from '@testing-library/react-native';

import { LOCALE_CODES, catalogues } from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { SCREENS, hostedScreen, mockNavigation } from '@/test/screens';
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_STATUSES,
  DOCUMENT_CATEGORIES,
  HISTORY_EVENT_KINDS,
  LAB_RESULT_FLAGS,
  LAB_STATUSES,
  MESSAGE_STATUSES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  PRESCRIPTION_STATUSES,
  RELEASE_STATES,
} from '@/types/vocabularies';

/**
 * **A catalogue key must never reach the screen** — checklist C-09.
 *
 * ── The defect this was written for ──────────────────────────────────
 *
 * `no-inline-copy.test.ts` scans for the opposite mistake: an English
 * sentence written where a key belongs. There is a second way to get
 * C-09 wrong and nothing in the gate could see it — a key written where
 * a *sentence* belongs, because `t()` was forgotten at the call site.
 *
 * It had happened. `LabResultsScreen` maps the laboratory's workflow
 * status to a `MessageKey` and translated it on the expanded card
 * (`t(STATUS_LABEL[data.status])`) but not on the collapsed one, so the
 * badge beside every unopened lab order read
 * **`health.labs.status.completed`** and a screen reader announced
 * "Full blood count, health.labs.status.completed". Typing could not
 * catch it: `Badge`'s `label` is a `string` and a `MessageKey` is one.
 * The inline-copy scan could not either: the value is not a literal.
 *
 * ── Why a render sweep rather than a source scan ─────────────────────
 *
 * The defect is only visible *after* interpolation — a key handed to
 * `t()` as a parameter (`t('…a11y', { status: KEY })`) is a string
 * inside a sentence by the time it is wrong. So this walks what was
 * actually rendered: every text node and every accessibility string,
 * for every screen that mounts without a session, in **both**
 * languages. Arabic is not decoration here — a key is ASCII, so a
 * locale that silently fell back to keys would show up as a whole
 * screen leaking rather than as one badge.
 *
 * ── The navigator is mocked, and only the navigator ──────────────────
 *
 * Seven of these screens reach for `useNavigation` or `useFocusEffect`
 * rather than taking a prop, so they need something above them. The two
 * hooks are stubbed and nothing else is — a fake of the *platform*,
 * which is the rule `test/setup.ts` follows: this test asks what a
 * screen renders, not where it goes next, and every screen here has its
 * own test for the navigating. `test/screens.tsx` holds the list and
 * says why hosting a real navigator is not an option.
 */

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  // The real one re-runs on every focus change; there is exactly one
  // focus here and it never changes, so running the effect once is what
  // this screen would see.
  useFocusEffect: (effect: () => void | (() => void)) => {
    // The caller memoises with `useCallback`, exactly as the real hook
    // requires, so the identity is the dependency.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('react') as typeof React).useEffect(effect, [effect]);
  },
}));

/** Every key in the catalogue. The set is the same in both locales. */
const KEYS = new Set(Object.keys(catalogues.en));

/**
 * Key-shaped tokens: a lower-case head then at least one dotted
 * segment. Matching the shape first and the catalogue second is what
 * keeps this cheap — ordinary copy contains no such token, and a real
 * key is then one `Set` lookup away.
 */
const KEY_SHAPED = /[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9-]+)+/g;

/** The props that are shown or read aloud, beyond the text nodes. */
const TEXTUAL_PROPS = [
  'accessibilityLabel',
  'accessibilityHint',
  'accessibilityValue',
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
  for (const name of TEXTUAL_PROPS) {
    const value = props[name];
    if (typeof value === 'string') found.push(value);
    else if (value !== null && typeof value === 'object') {
      for (const nested of Object.values(value)) {
        if (typeof nested === 'string') found.push(nested);
      }
    }
  }
  collect(element.children, found);
}

/** Every catalogue key that appears verbatim in what was rendered. */
function leakedKeys(tree: unknown): string[] {
  const strings: string[] = [];
  collect(tree, strings);

  const leaks = new Set<string>();
  for (const value of strings) {
    for (const token of value.match(KEY_SHAPED) ?? []) {
      if (KEYS.has(token)) leaks.add(token);
    }
  }
  return [...leaks].sort();
}

describe.each(LOCALE_CODES)('no raw catalogue key reaches the screen in %s', (locale) => {
  it.each(SCREENS)('%s', async (name, screen, params) => {
    const view = renderWithProviders(await hostedScreen([name, screen, params]), { locale });

    // Let the screen's queries settle: the fixture adapters resolve on a
    // microtask, and a skeleton renders no copy at all.
    await act(async () => undefined);
    await act(async () => undefined);

    expect(leakedKeys(view.toJSON())).toEqual([]);
  });
});

/**
 * **A wire literal must never reach the screen either** — C-09, J-09.
 *
 * The same defect one layer down, and the one the sweep above cannot
 * see because a wire literal is not a catalogue key. `HealthRecordsScreen`
 * had it in September: the medical-history row rendered `event.kind`
 * raw, so a patient read `hospitalization · 14 September 2026`.
 * `clinical-word.ts` fixed that row and wrote the rule down —
 * *not translating a clinical word is a decision; rendering the database
 * value is not* — and `DocumentsScreen` was still doing it, with
 * `<Badge label={document.category} />` putting **`external-record`** on
 * a patient's screen, hyphen and all, in both languages.
 *
 * So: no text node and no accessibility string is *exactly* a literal
 * from `vocabularies.ts`. Exactly, because the clinical words that stay
 * English stay English through `clinicalWord()`, which capitalises —
 * "Severe" is the decision, "severe" is the leak, and the two are
 * distinguishable without the test having to know which vocabularies
 * W-10 has ruled on.
 */
const WIRE_LITERALS = new Set<string>([
  ...APPOINTMENT_STATUSES,
  ...APPOINTMENT_PRIORITIES,
  ...DOCUMENT_CATEGORIES,
  ...HISTORY_EVENT_KINDS,
  ...LAB_RESULT_FLAGS,
  ...LAB_STATUSES,
  ...MESSAGE_STATUSES,
  ...NOTIFICATION_CATEGORIES,
  ...NOTIFICATION_PRIORITIES,
  ...PRESCRIPTION_STATUSES,
  ...RELEASE_STATES,
]);

function leakedLiterals(tree: unknown): string[] {
  const strings: string[] = [];
  collect(tree, strings);

  const leaks = new Set<string>();
  for (const value of strings) {
    const trimmed = value.trim();
    if (WIRE_LITERALS.has(trimmed)) leaks.add(trimmed);
  }
  return [...leaks].sort();
}

/**
 * **No unreplaced placeholder reaches the screen either** — C-09.
 *
 * `interpolate` leaves `{name}` verbatim when the caller did not supply
 * it, which is the right behaviour — substituting "undefined" into a
 * sentence is worse — but it means a forgotten parameter is a brace on a
 * patient's screen and nothing in the type system asks for one:
 * `t(key, params)` takes an optional record, because most keys have no
 * placeholder at all.
 *
 * The two catalogues are checked against each other in `i18n.test.tsx`;
 * this is the other end of the same defect, at the call site, and it is
 * only visible in a render.
 */
const PLACEHOLDER = /\{[a-z]\w*\}/gi;

function leakedPlaceholders(tree: unknown): string[] {
  const strings: string[] = [];
  collect(tree, strings);

  const leaks = new Set<string>();
  for (const value of strings) {
    for (const token of value.match(PLACEHOLDER) ?? []) leaks.add(token);
  }
  return [...leaks].sort();
}

describe.each(LOCALE_CODES)('no unreplaced placeholder reaches the screen in %s', (locale) => {
  it.each(SCREENS)('%s', async (name, screen, params) => {
    const view = renderWithProviders(await hostedScreen([name, screen, params]), { locale });

    await act(async () => undefined);
    await act(async () => undefined);

    expect(leakedPlaceholders(view.toJSON())).toEqual([]);
  });
});

describe.each(LOCALE_CODES)('no raw wire literal reaches the screen in %s', (locale) => {
  it.each(SCREENS)('%s', async (name, screen, params) => {
    const view = renderWithProviders(await hostedScreen([name, screen, params]), { locale });

    await act(async () => undefined);
    await act(async () => undefined);

    expect(leakedLiterals(view.toJSON())).toEqual([]);
  });
});
