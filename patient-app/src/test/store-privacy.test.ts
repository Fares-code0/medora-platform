import fs from 'node:fs';
import path from 'node:path';

/**
 * The store privacy declaration stays true — checklist W-02.
 *
 * `docs/STORE_PRIVACY.md` answers Apple's App Privacy and Google's Data
 * Safety questionnaires from the code. **An inaccurate declaration is a
 * compliance failure, not a form error**, and the way a declaration
 * becomes inaccurate is never by someone editing it — it is by someone
 * adding a dependency, a permission or a second host and not thinking
 * about a markdown file in another directory.
 *
 * So these tests do not check the document. They check the facts the
 * document asserts, and they fail on the pull request that changes one.
 * Each failure message names the section that has to be updated with it.
 */

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as Record<string, unknown>;
}

const packageJson = readJson('package.json');
const dependencies = {
  ...(packageJson['dependencies'] as Record<string, string> | undefined),
  ...(packageJson['devDependencies'] as Record<string, string> | undefined),
};

describe('§5 — there are no third parties', () => {
  /**
   * Substrings rather than exact names: a package called
   * `@company/analytics-react-native` is analytics whatever it is
   * scoped as, and the point is to catch the addition, not to maintain
   * an exhaustive registry of vendors.
   */
  const TRACKING_MARKERS = [
    'analytics',
    'amplitude',
    'mixpanel',
    'segment',
    'firebase',
    'sentry',
    'bugsnag',
    'crashlytics',
    'datadog',
    'appsflyer',
    'adjust',
    'branch-sdk',
    'facebook',
    'google-signin',
    'admob',
    'posthog',
    'logrocket',
    'smartlook',
    'clarity',
  ];

  it('carries no analytics, crash-reporting or advertising dependency', () => {
    const offenders = Object.keys(dependencies).filter((name) =>
      TRACKING_MARKERS.some((marker) => name.toLowerCase().includes(marker)),
    );

    // If this fails because a reporter was added ON PURPOSE (W-04, W-05),
    // that is correct and expected — update docs/STORE_PRIVACY.md §2, §3
    // and §5 in the same pull request, then add the package here.
    expect(offenders).toEqual([]);
  });

  it('declares no advertising identifier', () => {
    const app = readJson('app.json');
    const serialized = JSON.stringify(app).toLowerCase();

    for (const marker of ['idfa', 'advertisingid', 'gps_adid', 'att ']) {
      expect(serialized).not.toContain(marker);
    }
  });
});

describe('§1 — the app raises one runtime permission prompt, and §1.1 names it', () => {
  const PERMISSION_LIBRARIES = [
    'expo-location',
    'expo-notifications',
    'expo-camera',
    'expo-image-picker',
    'expo-contacts',
    'expo-calendar',
    'expo-media-library',
    'expo-tracking-transparency',
    'react-native-permissions',
  ];

  it('installs no library that could raise one beyond the biometric prompt', () => {
    // This is the assertion that carries §1: a permission dialog needs a
    // library to request it. `docs/ARCHITECTURE.md` lists expo-location
    // and expo-notifications under "deliberately absent" — nothing in v1
    // needs coordinates, and a notifications library would let the app
    // request a permission it cannot use while BE-12 has no provider.
    //
    // `expo-local-authentication` came OFF this list when D-15 landed,
    // and §1 changed with it in the same pull request — which is the
    // sequence this test exists to force. It is the only one, and it is
    // the narrowest of them: iOS shows a Face ID consent alert on first
    // use and Android's USE_BIOMETRIC raises no dialog at all. Nothing
    // it can reach is data — it returns a yes or a no.
    const installed = PERMISSION_LIBRARIES.filter((name) => name in dependencies);

    expect(installed).toEqual([]);
    expect('expo-local-authentication' in dependencies).toBe(true);
  });

  it('declares in app.json exactly the four things §1.1 accounts for', () => {
    // "No runtime prompt" is not "no manifest entry", and a store
    // reviewer reads the manifest. The document's §1.1 explains each of
    // these; this test is what stops a FIFTH appearing without the
    // document noticing.
    const app = readJson('app.json') as {
      expo: {
        ios?: { infoPlist?: Record<string, unknown> };
        android?: { permissions?: string[] };
      };
    };

    expect(app.expo.android?.permissions ?? []).toEqual([
      'android.permission.CALL_PHONE',
      'android.permission.USE_BIOMETRIC',
    ]);
    expect(Object.keys(app.expo.ios?.infoPlist ?? {}).sort()).toEqual([
      'LSApplicationQueriesSchemes',
      'NSFaceIDUsageDescription',
    ]);
  });

  it('declares none of the categories that would change the answer entirely', () => {
    const serialized = JSON.stringify(readJson('app.json'));

    for (const marker of [
      'NSLocationWhenInUseUsageDescription',
      'NSLocationAlwaysUsageDescription',
      'NSCameraUsageDescription',
      'NSContactsUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSUserTrackingUsageDescription',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'android.permission.CAMERA',
      'READ_CONTACTS',
      'POST_NOTIFICATIONS',
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it('dials with tel:, which is why CALL_PHONE is unused', () => {
    const dial = fs.readFileSync(
      path.join(ROOT, 'src', 'features', 'emergency', 'dial.ts'),
      'utf8',
    );

    // `tel:` is ACTION_DIAL — it opens the dialler with the number
    // entered and the patient presses call. `ACTION_CALL` would place it,
    // and THAT is what CALL_PHONE is for. If this ever changes, §1.1's
    // "declared but never used" stops being true.
    expect(dial).toContain('`tel:${');
    expect(dial).not.toContain('ACTION_CALL');
    expect(dial).not.toContain('IntentLauncher');
  });
});

describe('§3 — one host, encrypted in transit', () => {
  it('has exactly one configured network destination', () => {
    const env = fs.readFileSync(path.join(ROOT, 'src', 'configs', 'env.ts'), 'utf8');

    // A second base URL would be a second party to declare. There is one,
    // and `EXPO_PUBLIC_API_BASE_URL` is it.
    const urlVars = [...env.matchAll(/EXPO_PUBLIC_\w*(?:URL|HOST|ENDPOINT)\w*/g)].map(
      (match) => match[0],
    );
    const distinct = [...new Set(urlVars)];

    // The other three are links the OS opens, not hosts this app talks
    // to, so none of them is a third party the declaration has to name:
    //
    // - `EXPO_PUBLIC_APP_STORE_URL` — the store listing a withdrawn
    //   build sends the patient to (W-06);
    // - `EXPO_PUBLIC_TERMS_URL` and `EXPO_PUBLIC_PRIVACY_URL` — the two
    //   documents a patient agrees to (E-05), published on the open web
    //   by the clinic and opened in the patient's browser. `https:`
    //   only, so neither can be a deep link into another app.
    //
    // They are the only URL-shaped variables that may exist. A fourth is
    // a conversation about §3, which is what this assertion is for.
    expect(distinct.sort()).toEqual([
      'EXPO_PUBLIC_API_BASE_URL',
      'EXPO_PUBLIC_APP_STORE_URL',
      'EXPO_PUBLIC_PRIVACY_URL',
      'EXPO_PUBLIC_TERMS_URL',
    ]);
  });
});

describe('the document itself', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'STORE_PRIVACY.md'), 'utf8');

  it('accounts for every manifest declaration', () => {
    expect(doc).toContain('CALL_PHONE');
    expect(doc).toContain('USE_BIOMETRIC');
    expect(doc).toContain('NSFaceIDUsageDescription');
    expect(doc).toContain('LSApplicationQueriesSchemes');
  });

  it('exists and is the W-02 deliverable', () => {
    expect(doc).toContain('W-02');
    expect(doc).toContain('App Privacy');
    expect(doc).toContain('Data safety');
  });

  it('still says it is a draft awaiting sign-off', () => {
    // The four questions in §6 are policy, not code. If someone answers
    // them, this assertion is the prompt to change the status line
    // deliberately rather than let a DRAFT go to a store console.
    expect(doc).toContain('awaiting owner sign-off');
  });

  it('does not claim the app collects nothing', () => {
    // The failure mode this row warns about: answering "Data Not
    // Collected" because the phone forgets it, when the app transmits
    // credentials and receives a chart.
    expect(doc).not.toMatch(/^\s*Data Not Collected\s*$/m);
    expect(doc).toContain('Health & fitness');
  });
});
