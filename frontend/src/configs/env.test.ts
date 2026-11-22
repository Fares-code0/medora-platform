import { describe, expect, it } from 'vitest';

import { parseEnv, resolveApiBaseUrl, resolveEnableMocks } from './env';

/**
 * The production mock guard.
 *
 * `env` itself is parsed once at import time against a frozen
 * `import.meta.env`, so the cases below drive `resolveEnableMocks` directly
 * — the same reason `api/seam.ts` exposes `selectImplementation` next to
 * `selectService`. The rule under test is a security boundary, not a
 * preference: the mock auth service accepts seeded credentials and never
 * reaches the API, so a production build reaching it means anyone can sign
 * in as `doctor@medora.health`.
 */
describe('resolveEnableMocks — production', () => {
  it('disables mocks when VITE_ENABLE_MOCKS is unset', () => {
    // The original defect. `.default('true')` made a missing variable and a
    // deliberate opt-in indistinguishable, so a deploy that simply forgot to
    // set the flag served mock auth and looked healthy doing it.
    expect(resolveEnableMocks('production', undefined)).toBe(false);
  });

  it('disables mocks when VITE_ENABLE_MOCKS=false', () => {
    expect(resolveEnableMocks('production', 'false')).toBe(false);
  });

  it('rejects the configuration outright when VITE_ENABLE_MOCKS=true', () => {
    // Not "ignore the flag and carry on": that leaves the deployment
    // asserting one thing and doing another. The build must fail to boot.
    expect(() => resolveEnableMocks('production', 'true')).toThrow(
      /VITE_ENABLE_MOCKS=true is not allowed with VITE_APP_ENV=production/,
    );
  });

  it('never returns true for production, whatever the input', () => {
    for (const raw of ['true', 'false', undefined] as const) {
      let enabled: boolean;
      try {
        enabled = resolveEnableMocks('production', raw);
      } catch {
        continue; // Throwing is the other acceptable outcome.
      }
      expect(enabled).toBe(false);
    }
  });
});

describe('resolveEnableMocks — development and staging', () => {
  it('enables mocks in development when explicitly opted in', () => {
    expect(resolveEnableMocks('development', 'true')).toBe(true);
  });

  it('enables mocks in staging when explicitly opted in', () => {
    // Staging is not production, so the guard does not fire — but the
    // opt-in is still explicit, never inherited from an unset variable.
    expect(resolveEnableMocks('staging', 'true')).toBe(true);
  });

  it('leaves mocks off when the variable is unset, rather than defaulting on', () => {
    expect(resolveEnableMocks('development', undefined)).toBe(false);
    expect(resolveEnableMocks('staging', undefined)).toBe(false);
  });

  it('leaves mocks off when explicitly disabled', () => {
    expect(resolveEnableMocks('development', 'false')).toBe(false);
  });
});

/**
 * S2 — the API base URL in a production build. The schema only proves the
 * value is a URL; a production deploy pointed at `http://` would carry the
 * bearer token, the refresh cookie and patient data in clear text.
 */
describe('resolveApiBaseUrl — production', () => {
  it('accepts an https URL', () => {
    expect(resolveApiBaseUrl('production', 'https://api.medora.health/api/v1')).toBe(
      'https://api.medora.health/api/v1',
    );
  });

  it('rejects a plain-http URL to a remote host', () => {
    expect(() => resolveApiBaseUrl('production', 'http://api.medora.health/api/v1')).toThrow(
      /VITE_API_BASE_URL must use https:\/\/ with VITE_APP_ENV=production/,
    );
  });

  it('rejects plain http to a LAN address too — only loopback is exempt', () => {
    expect(() => resolveApiBaseUrl('production', 'http://10.0.0.5:3000/api/v1')).toThrow(
      /must use https/,
    );
    expect(() => resolveApiBaseUrl('production', 'http://localhost.evil.com/api/v1')).toThrow(
      /must use https/,
    );
  });

  it('allows plain http to localhost and 127.0.0.1, and the schema default', () => {
    expect(resolveApiBaseUrl('production', 'http://localhost:3000/api/v1')).toBe(
      'http://localhost:3000/api/v1',
    );
    expect(resolveApiBaseUrl('production', 'http://127.0.0.1:3000/api/v1')).toBe(
      'http://127.0.0.1:3000/api/v1',
    );
  });

  it('rejects a non-http scheme even on loopback', () => {
    expect(() => resolveApiBaseUrl('production', 'ftp://localhost/api/v1')).toThrow(
      /must use https/,
    );
  });
});

describe('resolveApiBaseUrl — development and staging', () => {
  it('accepts plain http outside production, as the demo build needs', () => {
    // `vercel.json` builds the demo with VITE_APP_ENV=staging and no base URL,
    // so it runs on the http://localhost default it never calls.
    expect(resolveApiBaseUrl('staging', 'http://api.staging.local/api/v1')).toBe(
      'http://api.staging.local/api/v1',
    );
    expect(resolveApiBaseUrl('development', 'http://192.168.1.4:3000/api/v1')).toBe(
      'http://192.168.1.4:3000/api/v1',
    );
  });
});

/**
 * `parseEnv` replaced a zod schema (so zod stays out of the entry chunk).
 * These pin the same three rules the schema stated.
 */
describe('parseEnv', () => {
  it('applies the defaults only when a variable is absent', () => {
    expect(parseEnv({})).toEqual({
      success: true,
      data: {
        VITE_API_BASE_URL: 'http://localhost:3000/api/v1',
        VITE_APP_ENV: 'development',
        VITE_ENABLE_MOCKS: undefined,
      },
    });
  });

  it('accepts a complete, valid configuration as given', () => {
    expect(
      parseEnv({
        VITE_API_BASE_URL: 'https://api.example.com/api/v1',
        VITE_APP_ENV: 'production',
        VITE_ENABLE_MOCKS: 'false',
      }),
    ).toEqual({
      success: true,
      data: {
        VITE_API_BASE_URL: 'https://api.example.com/api/v1',
        VITE_APP_ENV: 'production',
        VITE_ENABLE_MOCKS: 'false',
      },
    });
  });

  it('rejects a base URL that is not a URL, and an empty one rather than defaulting it', () => {
    for (const value of ['not a url', '/api/v1', '']) {
      const result = parseEnv({ VITE_API_BASE_URL: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(Object.keys(result.fieldErrors)).toEqual(['VITE_API_BASE_URL']);
    }
  });

  it('rejects an unknown or empty app environment', () => {
    for (const value of ['prod', 'Production', '']) {
      const result = parseEnv({ VITE_APP_ENV: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(Object.keys(result.fieldErrors)).toEqual(['VITE_APP_ENV']);
    }
  });

  it('rejects a mock flag that is not exactly true or false', () => {
    for (const value of ['1', 'TRUE', 'yes', '']) {
      const result = parseEnv({ VITE_ENABLE_MOCKS: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(Object.keys(result.fieldErrors)).toEqual(['VITE_ENABLE_MOCKS']);
    }
  });

  it('reports every failing field at once', () => {
    const result = parseEnv({ VITE_API_BASE_URL: 'x', VITE_APP_ENV: 'x', VITE_ENABLE_MOCKS: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual([
        'VITE_API_BASE_URL',
        'VITE_APP_ENV',
        'VITE_ENABLE_MOCKS',
      ]);
    }
  });
});
