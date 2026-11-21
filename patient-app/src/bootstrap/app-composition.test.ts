import fs from 'node:fs';
import path from 'node:path';

/**
 * The provider stack's ORDER — not its rendering.
 *
 * `docs/COVERAGE.md` explains why `App.tsx` sits at 0%: it is a
 * composition, every provider in it is exercised through its own tests,
 * and rendering the whole tree to assert that React nests children would
 * be asserting React.
 *
 * The order is a different thing, and it is not React's. Six of these
 * nestings are load-bearing decisions with a consequence written down in
 * `App.tsx`'s own header, and every one of them is broken by a plausible
 * edit — moving a provider "up a level to make it available everywhere"
 * is the shape of the change that does it. None of the consequences is
 * visible in a unit test of the provider that moved:
 *
 *  - a hydration that lands after `ThemeProvider` mounts paints the
 *    wrong palette for a frame,
 *  - a crash fallback outside the theme is black on black in dark mode,
 *  - a withdrawn build that can still ask for a fingerprint,
 *  - a lock screen that overlays the records screen instead of replacing
 *    it, leaving it mounted for the OS to photograph.
 *
 * So this asserts the sequence in the source, in the order the header
 * documents. It is a cheap test for an expensive class of regression,
 * and it is the same shape as `docs-consistency.test.ts`: the claim is
 * about a file, so the assertion reads the file.
 */

const SOURCE = fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');

/** The JSX of `App` alone — `ThemedNavigation` above it has its own nesting. */
const APP_JSX = SOURCE.slice(SOURCE.indexOf('export function App()'));

/** Outermost first. */
const STACK = [
  'SafeAreaProvider',
  'PreferenceGate',
  'LocaleProvider',
  'ThemeProvider',
  'ErrorBoundary',
  'QueryClientProvider',
  'NetworkProvider',
  'SessionProvider',
  'UpgradeGate',
  'BiometricLockGate',
  'ToastProvider',
  'ThemedNavigation',
] as const;

function openingIndex(component: string): number {
  const at = APP_JSX.indexOf(`<${component}`);
  expect(at).toBeGreaterThan(-1);
  return at;
}

/** True when `outer` opens before `inner` — i.e. `inner` is nested inside. */
function wraps(outer: string, inner: string): boolean {
  return openingIndex(outer) < openingIndex(inner);
}

describe('the provider stack is in the documented order', () => {
  it('mounts every provider the header lists', () => {
    for (const component of STACK) {
      expect(APP_JSX).toContain(`<${component}`);
    }
  });

  it.each(STACK.slice(0, -1).map((outer, index) => [outer, STACK[index + 1]!] as const))(
    '%s wraps %s',
    (outer, inner) => {
      expect(wraps(outer, inner)).toBe(true);
    },
  );
});

describe('the six nestings that are decisions, not arrangement', () => {
  it('holds the first paint until the stored preferences are in memory', () => {
    // `ThemeProvider` and `LocaleProvider` both read the store in a
    // `useState` initialiser, which runs once at mount. A hydration
    // finishing after that paints the wrong palette and the wrong
    // language for a frame (E-02, P-07).
    expect(wraps('PreferenceGate', 'LocaleProvider')).toBe(true);
    expect(wraps('PreferenceGate', 'ThemeProvider')).toBe(true);
  });

  it('resolves direction before colour', () => {
    // Direction is a layout property, not a colour, so nothing below it
    // should render before it is known (C-09, S-08).
    expect(wraps('LocaleProvider', 'ThemeProvider')).toBe(true);
  });

  it('keeps the crash fallback inside the theme', () => {
    // A fallback rendered outside the theme cannot read a colour and
    // lands as black on black in dark mode — a crash screen you cannot
    // read (R-05).
    expect(wraps('ThemeProvider', 'ErrorBoundary')).toBe(true);
  });

  it('gives the session a query client to sweep', () => {
    // Logout, session loss and the background timeout all clear the PHI
    // cache, and `SessionProvider` needs the client to do it (T-08,
    // T-11).
    expect(wraps('QueryClientProvider', 'SessionProvider')).toBe(true);
  });

  it('puts the upgrade gate above the navigator and below the session', () => {
    // Above, so a withdrawn build cannot sign anyone in — the reason a
    // build gets withdrawn is usually how it handles a session or
    // clinical data. Below, so a gate tripping mid-session does not pull
    // the session context out from under the screens beneath it (W-06).
    expect(wraps('SessionProvider', 'UpgradeGate')).toBe(true);
    expect(wraps('UpgradeGate', 'ThemedNavigation')).toBe(true);
  });

  it('puts the biometric lock below the upgrade gate', () => {
    // A build the operator has withdrawn should not be asking anybody
    // for a fingerprint (D-15).
    expect(wraps('UpgradeGate', 'BiometricLockGate')).toBe(true);
  });

  it('lets the biometric lock replace the navigator rather than cover it', () => {
    // An overlay leaves the records screen mounted, and the OS
    // photographs what is mounted on the way to the task switcher — the
    // T-09 reasoning, applied again. Replacing requires the gate to be
    // an ancestor of the navigator, not a sibling.
    expect(wraps('BiometricLockGate', 'ThemedNavigation')).toBe(true);
  });
});

describe('the navigator wraps its own shield', () => {
  it('paints the privacy cover over the navigator, not beside it', () => {
    // `PhiPrivacyShield` has to cover whatever the navigator is showing
    // when the OS photographs the app (T-09), so it is an ancestor of
    // `NavigationContainer` inside `ThemedNavigation`.
    const themed = SOURCE.slice(
      SOURCE.indexOf('function ThemedNavigation()'),
      SOURCE.indexOf('export function App()'),
    );

    expect(themed.indexOf('<PhiPrivacyShield')).toBeGreaterThan(-1);
    expect(themed.indexOf('<PhiPrivacyShield')).toBeLessThan(
      themed.indexOf('<NavigationContainer'),
    );
  });

  it('reports screen views from the navigator, on ready and on change', () => {
    // One listener, rather than a `track` call in every screen — which
    // is the arrangement where one screen eventually passes its params
    // along with the name (W-05).
    const themed = SOURCE.slice(
      SOURCE.indexOf('function ThemedNavigation()'),
      SOURCE.indexOf('export function App()'),
    );

    expect(themed).toContain('onReady={reportScreen}');
    expect(themed).toContain('onStateChange={reportScreen}');
    expect(themed).toContain('trackScreenView(name)');
  });

  it('creates the query client once, not per render', () => {
    // Recreating it would drop the cache on every re-render of `App`,
    // which on a PHI client means refetching a chart because a theme
    // toggled.
    expect(APP_JSX).toContain('useMemo(() => createQueryClient(), [])');
  });
});
