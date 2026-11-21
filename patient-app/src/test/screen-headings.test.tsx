import type React from 'react';

import { act } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';
import { SCREENS, hostedScreen, mockNavigation } from '@/test/screens';

/**
 * **What a screen reader is actually given** — S-02, `docs/A11Y_AUDIT.md`
 * F-3 and F-7.
 *
 * Two of Phase S's claims are about whole directories rather than about
 * one component, and both were held by source scans that cannot see what
 * a patient hears: *every screen has a heading* and *every control has a
 * label*. This file asks both of a real render.
 *
 * ── What F-3 fixed, and what it left ─────────────────────────────────
 *
 * F-3 found `ThreadScreen` was the one screen of 27 without a heading,
 * so nothing named it to a screen reader but the navigator's generic
 * "Conversation". The guard written for it (`a11y-audit.test.ts`) is a
 * **source scan**: it fails a screen file that does not mention
 * `headingA11y` anywhere.
 *
 * That is a weaker claim than it reads as, and four screens were
 * exploiting the gap without anyone choosing to. `AppointmentDetail`,
 * `DoctorProfile`, `Thread` and `VisitDetail` each put their *only*
 * heading **inside** an `AsyncBoundary`, keyed off the loaded record —
 * the appointment's date, the doctor's name, the clinician's name, the
 * visit's title. So the source scan passed, and a screen reader landing
 * on any of those four while the query was still running, or after it
 * failed, or on an empty result, found no heading at all. The rotor had
 * nothing, which is exactly F-3's defect in the state a patient on a
 * slow connection is most likely to meet.
 *
 * ── Why the first render is the loading state ────────────────────────
 *
 * No stubbing is needed to reach it: every query is `isPending` on the
 * first commit, before any promise has settled. So this renders each
 * screen and asserts **without flushing** that something carries
 * `accessibilityRole="header"`. That is the loading state, tested as the
 * patient meets it.
 *
 * The error and empty states are not swept here — reaching them
 * generically would mean stubbing 26 services — but the fix the four
 * screens took closes all three at once: the heading is hoisted out of
 * the boundary and falls back to the screen's own name when there is no
 * record to name it.
 */

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('react') as typeof React).useEffect(effect, [effect]);
  },
}));

/** Does anything in this tree announce itself as a heading? */
function hasHeading(node: unknown): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => hasHeading(child));

  const element = node as { props?: Record<string, unknown>; children?: unknown };
  if (element.props?.['accessibilityRole'] === 'header') return true;
  const role = element.props?.['role'];
  if (role === 'heading' || role === 'header') return true;
  return hasHeading(element.children);
}

describe('a screen reader has somewhere to land while a screen is loading', () => {
  it.each(SCREENS)('%s', async (name, screen, params) => {
    const element = await hostedScreen([name, screen, params]);
    const view = renderWithProviders(element);

    // Deliberately NOT flushed: this is the first commit, where every
    // query is still pending. Asserting after `act` would test the
    // loaded screen, which F-3's scan already covers.
    expect(hasHeading(view.toJSON())).toBe(true);

    // Settle before the test ends so the worker is not left with a
    // pending state update.
    await act(async () => undefined);
  });
});

/**
 * **Every control announces itself** — S-02, the second half.
 *
 * `a11y-audit.test.ts` scans source for a `<Pressable>` with neither
 * `pressableA11y` nor an `accessibilityLabel`, which is the check that
 * matters at the point of writing one. It cannot see a control that
 * acquires its role from a *component* — a `Card` with `onPress`, a
 * `ListItem`, a `Button` whose label is computed — nor one whose label
 * arrives empty because the value behind it was.
 *
 * So this walks the rendered tree of all 26 screens for anything that
 * announces itself as a control, and fails on one a screen reader would
 * read out as nothing at all. It is deliberately scoped to nodes that
 * carry an explicit `accessibilityRole`: the untyped touchable is the
 * source scan's case, and a render check that guessed at what is
 * tappable would report the scrim behind every sheet.
 *
 * It found nothing on the day it was written, which is worth recording
 * rather than hiding — the value of this one is that it runs on the
 * screen somebody adds next month.
 */
const CONTROL_ROLES = new Set(['button', 'link', 'switch', 'checkbox', 'radio', 'tab']);

function textUnder(node: unknown, found: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    found.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) textUnder(child, found);
    return;
  }
  if (typeof node !== 'object') return;
  textUnder((node as { children?: unknown }).children, found);
}

function silentControls(node: unknown, found: string[]): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) silentControls(child, found);
    return;
  }

  const element = node as { props?: Record<string, unknown>; children?: unknown };
  const props = element.props ?? {};
  const role = props['accessibilityRole'];

  if (typeof role === 'string' && CONTROL_ROLES.has(role)) {
    const label =
      typeof props['accessibilityLabel'] === 'string' ? props['accessibilityLabel'] : '';
    const inner: string[] = [];
    textUnder(element.children, inner);
    // A control deliberately hidden from assistive technology — the
    // scrim behind a bottom sheet — is not a control a screen reader can
    // reach, so it is not one it can fail to name.
    const hidden =
      props['accessibilityElementsHidden'] === true ||
      props['importantForAccessibility'] === 'no-hide-descendants';

    if (label.trim() === '' && inner.join('').trim() === '' && !hidden) {
      found.push(`${role} (testID: ${String(props['testID'] ?? 'none')})`);
    }
  }

  silentControls(element.children, found);
}

describe('the silent-control detector itself', () => {
  /**
   * The sweep below found nothing on the day it was written, so nothing
   * about it was watched to fail. A detector that reports zero because
   * it is broken and one that reports zero because the app is clean look
   * identical from the outside, and the difference is the whole value of
   * the sweep — so the detector is exercised directly here, on trees
   * built to be wrong.
   */
  const control = (props: Record<string, unknown>, children?: unknown) => ({ props, children });

  it('reports a button with neither a label nor any text', () => {
    const found: string[] = [];
    silentControls(control({ accessibilityRole: 'button', testID: 'icon-only' }), found);

    expect(found).toEqual(['button (testID: icon-only)']);
  });

  it('accepts a button whose text is its name', () => {
    const found: string[] = [];
    silentControls(control({ accessibilityRole: 'button' }, ['Book an appointment']), found);

    expect(found).toEqual([]);
  });

  it('accepts a button named only by its label, as an icon button is', () => {
    const found: string[] = [];
    silentControls(control({ accessibilityRole: 'button', accessibilityLabel: 'Close' }), found);

    expect(found).toEqual([]);
  });

  it('treats whitespace as no name at all', () => {
    const found: string[] = [];
    silentControls(control({ accessibilityRole: 'button', accessibilityLabel: '   ' }, ['  ']), []);
    silentControls(
      control({ accessibilityRole: 'button', accessibilityLabel: '   ' }, ['  ']),
      found,
    );

    expect(found).toHaveLength(1);
  });

  it('leaves a deliberately hidden control alone, which is what a sheet scrim is', () => {
    const found: string[] = [];
    silentControls(
      control({ accessibilityRole: 'button', accessibilityElementsHidden: true }),
      found,
    );

    expect(found).toEqual([]);
  });

  it('finds one nested several levels down', () => {
    const found: string[] = [];
    silentControls(
      control({}, [control({}, [control({ accessibilityRole: 'link', testID: 'deep' })])]),
      found,
    );

    expect(found).toEqual(['link (testID: deep)']);
  });
});

describe('no control on a screen is announced as nothing', () => {
  it.each(SCREENS)('%s', async (name, screen, params) => {
    const view = renderWithProviders(await hostedScreen([name, screen, params]));

    // Settled, unlike the heading sweep above: a control that appears
    // with the data is the one most likely to be built from a value.
    await act(async () => undefined);
    await act(async () => undefined);

    const silent: string[] = [];
    silentControls(view.toJSON(), silent);

    expect({ screen: name, silent }).toEqual({ screen: name, silent: [] });
  });
});
