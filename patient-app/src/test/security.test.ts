import { QueryClient } from '@tanstack/react-query';

import { clearPhiCache } from '@/api/query-client';
import { PHI_QUERY_DOMAINS } from '@/api/query-keys';
import { apiBaseUrlRejection, parseEnv } from '@/configs/env';
import { createTokenStorage } from '@/features/auth/storage';
import { createMemoryPreferenceStore } from '@/storage/preference-store';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { redact } from '@/utils/logger';

/**
 * The security posture, asserted.
 *
 * Every claim §25 of the brief makes is a test here, because a security
 * property nobody checks is a security property that decays on the next
 * refactor. These are the assertions behind checklist T-01 … T-08.
 */

describe('no secrets in configuration', () => {
  it('rejects a production build that still has fixtures enabled', () => {
    expect(() =>
      parseEnv({
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1',
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_ENABLE_MOCKS: 'true',
      }),
    ).toThrow(/must be false in production/);
  });

  it('accepts a production build with fixtures off', () => {
    const env = parseEnv({
      EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1',
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_ENABLE_MOCKS: 'false',
    });
    expect(env.enableMocks).toBe(false);
  });

  it('fails fast on a malformed base URL rather than at the first request', () => {
    expect(() => parseEnv({ EXPO_PUBLIC_API_BASE_URL: 'not-a-url' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});

/**
 * The API origin is https outside development — checklist T-14.
 *
 * Two layers are asserted, and both matter. `apiBaseUrlRejection` is the
 * rule itself, walked over a table: it is a pure function of two strings
 * and every case below is one line. `parseEnv` is the rule *reaching the
 * boot path*, because a guard that is written and not wired is the
 * defect this row started as.
 */
describe('the API origin is https outside development (T-14)', () => {
  const accepted: readonly [label: string, url: string, appEnv: string][] = [
    ['https in production', 'https://api.example.com/api/v1', 'production'],
    ['https in staging', 'https://staging.example.com/api/v1', 'staging'],
    ['https in development', 'https://api.example.com/api/v1', 'development'],
    ['localhost over http, in development', 'http://localhost:3000/api/v1', 'development'],
    ['127.0.0.1 over http', 'http://127.0.0.1:3000/api/v1', 'development'],
    ['the IPv6 loopback', 'http://[::1]:3000/api/v1', 'development'],
    // How the Android emulator reaches the host machine. A developer
    // whose emulator cannot talk to their own server is a developer who
    // switches the rule off, so it is inside the exception by name.
    ['the Android emulator host alias', 'http://10.0.2.2:3000/api/v1', 'development'],
    ['a LAN address, for a physical device', 'http://192.168.1.14:3000/api/v1', 'development'],
    ['a 172.16/12 address', 'http://172.20.0.5:3000/api/v1', 'development'],
  ];

  it.each(accepted)('accepts %s', (_label, url, appEnv) => {
    expect(apiBaseUrlRejection(url, appEnv)).toBeNull();
  });

  const rejected: readonly [label: string, url: string, appEnv: string, because: RegExp][] = [
    // The row itself: a store build talking cleartext to a real host.
    ['cleartext in production', 'http://api.example.com/api/v1', 'production', /must use https/],
    ['cleartext in staging', 'http://api.example.com/api/v1', 'staging', /must use https/],
    // Staging is not a laxer production, and a private address does not
    // rescue it — an operator who points staging at a VPN host over
    // http is still sending tokens in the clear across that VPN's edge.
    ['a LAN address in staging', 'http://192.168.1.14/api/v1', 'staging', /must use https/],
    // A development build is not a licence for cleartext to the open
    // internet: this is the shape of a `.env` copied to a shared server.
    [
      'cleartext to a public host, even in development',
      'http://api.medora.example/api/v1',
      'development',
      /own machine or network/,
    ],
    // A host that merely *contains* a private-looking string. A
    // substring match would have let this through.
    [
      'a public host whose name looks local',
      'http://127.0.0.1.evil.example/api/v1',
      'development',
      /own machine or network/,
    ],
    [
      'a public host ending in a local-looking label',
      'http://192.168.1.14.attacker.example/api/v1',
      'development',
      /own machine or network/,
    ],
    // `z.string().url()` accepted every one of these. The base URL is
    // concatenated into every request, so the scheme is an allow-list.
    ['a javascript: URL', 'javascript:fetch(1)', 'production', /must be an https: URL/],
    ['a file: URL', 'file:///etc/passwd', 'development', /must be an https: URL/],
    ['a data: URL', 'data:text/plain,hi', 'development', /must be an https: URL/],
    ['an ftp: URL', 'ftp://api.example.com/api/v1', 'development', /must be an https: URL/],
    // A deep link into another app is not an API origin either.
    ['an app scheme', 'medora://api/v1', 'production', /must be an https: URL/],
    ['a string that is not a URL', 'api.example.com/api/v1', 'production', /must be a full URL/],
    ['an empty string', '', 'development', /must be a full URL/],
  ];

  it.each(rejected)('rejects %s', (_label, url, appEnv, because) => {
    const rejection = apiBaseUrlRejection(url, appEnv);
    expect(rejection).not.toBeNull();
    expect(rejection).toMatch(because);
  });

  it('refuses to boot a production build pointed at a cleartext origin', () => {
    expect(() =>
      parseEnv({
        EXPO_PUBLIC_API_BASE_URL: 'http://api.example.com/api/v1',
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_ENABLE_MOCKS: 'false',
      }),
    ).toThrow(/must use https/);
  });

  it('refuses to boot a production build that inherited the localhost default', () => {
    // The shipped default is `http://localhost:3000/api/v1`, so an
    // operator who never set the variable at all used to get a silently
    // cleartext production build rather than a loud failure.
    expect(() =>
      parseEnv({ EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_ENABLE_MOCKS: 'false' }),
    ).toThrow(/must use https/);
  });

  it('still boots a development build against a local server', () => {
    const env = parseEnv({ EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3000/api/v1' });
    expect(env.apiBaseUrl).toBe('http://localhost:3000/api/v1');
  });

  it('names the offending variable, so the message says what to change', () => {
    expect(() =>
      parseEnv({
        EXPO_PUBLIC_API_BASE_URL: 'http://api.example.com/api/v1',
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_ENABLE_MOCKS: 'false',
      }),
    ).toThrow(/EXPO_PUBLIC_API_BASE_URL/);
  });
});

/**
 * The consent documents, and the settings surface.
 *
 * Split out of `no secrets in configuration` when T-14 landed between
 * them; the assertions are unchanged.
 */
describe('no secrets in configuration, continued', () => {
  /**
   * The consent documents (E-05, W-11).
   *
   * Terms and a privacy policy are legal text a patient is asked to
   * agree to, and `ConsentScreen` opens whatever these variables say.
   * Two rules travel with that and both live in `env.ts` rather than in
   * the screen, because a screen can be reached by more than one path
   * and a misconfigured build should fail at boot rather than at the
   * moment somebody taps.
   */
  it('refuses a consent document served over plain http', () => {
    // `https:` or nothing. A terms page a network can rewrite is a
    // consent to whatever the network says.
    expect(() =>
      parseEnv({
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1',
        EXPO_PUBLIC_TERMS_URL: 'http://example.com/terms',
      }),
    ).toThrow(/must be an https URL/);

    expect(() =>
      parseEnv({
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1',
        EXPO_PUBLIC_PRIVACY_URL: 'http://example.com/privacy',
      }),
    ).toThrow(/must be an https URL/);
  });

  it('refuses a consent document that is not a URL at all', () => {
    expect(() =>
      parseEnv({
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1',
        EXPO_PUBLIC_TERMS_URL: 'see the leaflet',
      }),
    ).toThrow(/must be an https URL/);
  });

  it('treats unset as unset, rather than as a broken link', () => {
    // `null` is an honest state the screen renders in words (W-11). A
    // default invented here would be a link to somebody else's terms.
    const env = parseEnv({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1' });

    expect(env.termsUrl).toBeNull();
    expect(env.privacyUrl).toBeNull();
  });

  it('carries an https document through unchanged', () => {
    const env = parseEnv({
      EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1',
      EXPO_PUBLIC_TERMS_URL: 'https://clinic.example/terms',
      EXPO_PUBLIC_PRIVACY_URL: 'https://clinic.example/privacy',
    });

    expect(env.termsUrl).toBe('https://clinic.example/terms');
    expect(env.privacyUrl).toBe('https://clinic.example/privacy');
  });

  it('exposes only public settings — nothing secret-shaped', () => {
    // Every one of these is either already public (the base URL, the
    // build flavour, the app's own store listing) or a policy an attacker
    // can time with a stopwatch (the background timeouts). A key that
    // could hold a credential does not belong in this list, and this
    // assertion is where a reviewer finds out one was added.
    //
    // `appStoreUrl` (W-06) joined the list deliberately: a store listing
    // is a public web page by construction — it is printed on the store
    // itself — and the forced-upgrade screen renders it as a link. It
    // carries no secret and gates nothing.
    //
    // `supportEmail` (W-11) joined for the same reason: it is the
    // address a clinic prints on its own door, it opens the patient's
    // mail app and nothing else, and it authorizes nothing.
    //
    // `termsUrl` and `privacyUrl` (E-05) are the addresses of two
    // documents published on the open web for anyone to read — being
    // public is the entire point of a privacy policy. The schema accepts
    // `https:` only, which is narrower than the store link, so neither
    // can carry a deep link into another app.
    const env = parseEnv({});
    expect(Object.keys(env).sort()).toEqual([
      'apiBaseUrl',
      'appEnv',
      'appStoreUrl',
      'enableMocks',
      'isDev',
      'phiSweepAfterMs',
      'privacyUrl',
      'reauthenticateAfterMs',
      'supportEmail',
      'termsUrl',
    ]);
  });
});

describe('token storage (T-02)', () => {
  it('stores the refresh token and the session guard, nothing else', async () => {
    const secure = createInMemorySecureStore();
    const storage = createTokenStorage(secure);

    await storage.writeRefreshToken('refresh-abc');
    expect(await storage.readRefreshToken()).toBe('refresh-abc');
    // There is no API on TokenStorage that could accept an access token.
    expect(Object.keys(storage).sort()).toEqual([
      'clear',
      'readRefreshToken',
      'readSessionGuard',
      'writeRefreshToken',
      'writeSessionGuard',
    ]);
  });

  it('leaves nothing behind after clear (T-08)', async () => {
    const secure = createInMemorySecureStore();
    const storage = createTokenStorage(secure);

    await storage.writeRefreshToken('refresh-abc');
    await storage.writeSessionGuard({ v: 1, s: 'fg', lock: true });
    await storage.clear();
    expect(await storage.readRefreshToken()).toBeNull();
    expect(await storage.readSessionGuard()).toEqual({ kind: 'missing' });
  });

  it('leaves a tombstone beside a token it could not remove, and still throws', async () => {
    const secure = createInMemorySecureStore();
    const storage = createTokenStorage({
      ...secure,
      removeItem: (key) =>
        key === 'medora.refresh-token'
          ? Promise.reject(new Error('keychain unavailable'))
          : secure.removeItem(key),
    });

    await storage.writeRefreshToken('refresh-abc');
    await expect(storage.clear()).rejects.toThrow('keychain unavailable');
    expect(await storage.readRefreshToken()).toBe('refresh-abc');
    expect(await storage.readSessionGuard()).toEqual({
      kind: 'record',
      record: { v: 1, s: 'ended' },
    });
  });
});

describe('the preference store holds no PHI (T-03)', () => {
  it('starts empty and only ever holds what was explicitly written', () => {
    const store = createMemoryPreferenceStore();
    expect(store.keys()).toEqual([]);

    store.set('medora.theme-mode', 'dark');
    expect(store.keys()).toEqual(['medora.theme-mode']);

    store.remove('medora.theme-mode');
    expect(store.keys()).toEqual([]);
  });
});

describe('PHI cache clearing (J-10, T-03, T-08)', () => {
  it('removes every PHI domain', () => {
    const client = new QueryClient();
    for (const domain of PHI_QUERY_DOMAINS) {
      client.setQueryData([domain, 'list', {}], { secret: 'phi' });
    }
    client.setQueryData(['doctors', 'list', {}], { public: true });

    clearPhiCache(client);

    for (const domain of PHI_QUERY_DOMAINS) {
      expect(client.getQueryData([domain, 'list', {}])).toBeUndefined();
    }
    // And the sweep is total, so a domain nobody listed is gone too.
    expect(client.getQueryData(['doctors', 'list', {}])).toBeUndefined();
  });

  it('lists every clinical domain the app queries', () => {
    // A new PHI feature that forgets to register here is the failure
    // this assertion exists to catch in review.
    expect(PHI_QUERY_DOMAINS).toEqual(
      expect.arrayContaining([
        'appointments',
        'health-records',
        'lab-results',
        'messages',
        'notifications',
        'profile',
      ]),
    );
  });
});

describe('log redaction (T-04)', () => {
  it('redacts every PHI-shaped field name', () => {
    const redacted = redact({
      patientName: 'Sara Ahmed',
      email: 'sara@example.com',
      phone: '+962 79 000 0000',
      dateOfBirth: '1991-04-12',
      diagnosis: 'Hypertension',
      allergen: 'Penicillin',
      resultValue: '13.8',
      messageBody: 'my results',
      accessToken: 'secret',
    }) as Record<string, unknown>;

    for (const value of Object.values(redacted)) {
      expect(value).toBe('[redacted]');
    }
  });

  it('keeps the non-identifying fields a bug report needs', () => {
    const redacted = redact({ appointmentId: 'APT-2001', status: 'confirmed', durationMin: 30 });
    expect(redacted).toEqual({ appointmentId: 'APT-2001', status: 'confirmed', durationMin: 30 });
  });

  it('redacts through nesting and arrays', () => {
    const redacted = redact({
      items: [{ id: 'A', patientName: 'Sara' }],
      nested: { deep: { email: 'x@y.z' } },
    }) as { items: { patientName: unknown }[]; nested: { deep: { email: unknown } } };

    expect(redacted.items[0]?.patientName).toBe('[redacted]');
    expect(redacted.nested.deep.email).toBe('[redacted]');
  });

  it('stops at a depth limit rather than walking a cyclic structure forever', () => {
    const deep = { a: { b: { c: { d: { e: 'too far' } } } } };
    expect(redact(deep)).toEqual({ a: { b: { c: { d: '[redacted]' } } } });
  });
});
