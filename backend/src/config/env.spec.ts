import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'dotenv';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigService } from './config.service';
import { EnvValidationError, loadEnv, resetEnvForTesting } from './env';
import { envSchema } from './env.schema';

/**
 * The M3.1 verification: "boot with a missing var exits with a readable
 * error naming the var."
 *
 * These specs assert the *message*, not just that something threw. The
 * whole value of fail-fast is the operator reading one line and knowing
 * what to fix; an accurate exception with an unreadable message would
 * pass a weaker test and help nobody at 3am.
 */

const COMPLETE_ENV: Readonly<Record<string, string>> = {
  APP_ENV: 'development',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://medora:medora@localhost:5432/medora?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'medora-files',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  JWT_SECRET: 'a-signing-key-that-is-long-enough-000000',
  COOKIE_DOMAIN: 'localhost',
  APP_PUBLIC_URL: 'http://localhost:5173',
  // base64 for exactly 32 bytes, which is what the schema requires.
  DATA_ENCRYPTION_KEY: 'ZW52ZWxvcGUta2V5LWZvci11bml0LXRlc3RzISEhISE=',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'Medora <no-reply@medora.health>',
};

let original: NodeJS.ProcessEnv;

/** Replaces the process environment wholesale so leakage is impossible. */
function setEnv(overrides: Readonly<Record<string, string | undefined>>): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries({ ...COMPLETE_ENV, ...overrides })) {
    if (value !== undefined) process.env[key] = value;
  }
  resetEnvForTesting();
}

beforeEach(() => {
  original = { ...process.env };
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original);
  resetEnvForTesting();
});

describe('loadEnv (RM M3.1)', () => {
  it('accepts a complete environment and applies the documented defaults', () => {
    setEnv({});
    const env = loadEnv();

    expect(env.APP_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    // API §1.2 — 30 days and 12 hours.
    expect(env.REFRESH_TTL_REMEMBER).toBe(2_592_000);
    expect(env.REFRESH_TTL_DEFAULT).toBe(43_200);
    expect(env.JWT_ACCESS_TTL).toBe(900);
    // The frontend's seeded SecurityPolicySettings.
    expect(env.SECURITY_LOGIN_ATTEMPT_LIMIT).toBe(5);
    expect(env.SECURITY_PASSWORD_EXPIRY_DAYS).toBe(180);
    expect(env.SECURITY_SESSION_TIMEOUT_MINUTES).toBe(30);
    expect(env.SECURITY_TWO_FACTOR_REQUIRED).toBe(false);
    expect(env.SECURITY_SINGLE_SESSION_PER_USER).toBe(false);
    // M6.2 — a backend default, not a transcription (ADR-025).
    expect(env.SECURITY_LOCKOUT_MINUTES).toBe(15);
  });

  it('names the missing variable in the error message', () => {
    setEnv({ DATABASE_URL: undefined });

    let thrown: unknown;
    try {
      loadEnv();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EnvValidationError);
    const message = (thrown as EnvValidationError).message;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('Invalid environment configuration');
    // The operator needs the next step, not just the diagnosis.
    expect(message).toContain('backend/.env.example');
  });

  it('reports every problem at once rather than one per restart', () => {
    setEnv({ DATABASE_URL: undefined, REDIS_URL: undefined, JWT_SECRET: undefined });

    const error = captureError();
    expect(error.issues.map((issue) => issue.variable).sort()).toEqual([
      'DATABASE_URL',
      'JWT_SECRET',
      'REDIS_URL',
    ]);
  });

  it('rejects a malformed value, not just a missing one', () => {
    setEnv({ DATABASE_URL: 'not-a-url' });
    expect(captureError().message).toContain('DATABASE_URL');
  });

  it('rejects an access token TTL above the 15-minute ceiling (MG §11.1-1)', () => {
    setEnv({ JWT_ACCESS_TTL: '86400' });
    // A 24-hour access token would make the refresh design pointless and
    // nothing else in the system would notice.
    expect(captureError().message).toContain('JWT_ACCESS_TTL');
  });

  it('rejects a signing key short enough to brute force', () => {
    setEnv({ JWT_SECRET: 'short' });
    expect(captureError().message).toContain('JWT_SECRET');
  });

  it('refuses an SMTP host carrying a port or a scheme', () => {
    // nodemailer resolves these as hostnames and fails with ENOTFOUND,
    // which the mailer swallows — so without this the symptom is a 201
    // from registration and an empty mailhog inbox.
    for (const bad of ['localhost:1025', 'mailhog:1025', 'smtp://localhost']) {
      setEnv({ SMTP_HOST: bad });
      expect(captureError().message).toContain('SMTP_HOST');
    }
  });

  it('accepts a bare SMTP host, including the compose service name and IPv6', () => {
    for (const good of ['localhost', 'mailhog', '127.0.0.1', '::1', 'smtp.example.com']) {
      setEnv({ SMTP_HOST: good });
      expect(loadEnv().SMTP_HOST).toBe(good);
    }
  });

  it('reads `false` as false', () => {
    // `z.coerce.boolean()` would read the string 'false' as true, which
    // is the opposite of what anyone writing it means.
    setEnv({ SECURITY_TWO_FACTOR_REQUIRED: 'false' });
    expect(loadEnv().SECURITY_TWO_FACTOR_REQUIRED).toBe(false);

    setEnv({ SECURITY_TWO_FACTOR_REQUIRED: 'true' });
    expect(loadEnv().SECURITY_TWO_FACTOR_REQUIRED).toBe(true);
  });

  it('does not read the .env file', () => {
    // `loadDotenvFile()` is a bootstrap step `main.ts` performs once.
    // If validation re-read the file, anything that re-validated would
    // find the file's values reappearing underneath a deliberately
    // constructed environment — which is exactly what these specs do.
    setEnv({ DATABASE_URL: undefined });

    expect(captureError().issues.map((issue) => issue.variable)).toEqual(['DATABASE_URL']);
  });

  it('memoises, so every caller sees the same environment', () => {
    setEnv({});
    expect(loadEnv()).toBe(loadEnv());
  });
});

describe('the auth envelope key (RM M6.4)', () => {
  it('rejects a key that is not base64 for exactly 32 bytes', () => {
    // AES-256 needs 256 bits. A 44-character passphrase decodes to *some*
    // buffer — `Buffer.from` skips what it does not recognise — so the
    // check re-encodes and compares rather than measuring the result.
    for (const bad of [
      Buffer.alloc(16).toString('base64'),
      Buffer.alloc(48).toString('base64'),
      'a-passphrase-that-is-not-base64-at-all!!!!!!!',
    ]) {
      setEnv({ DATA_ENCRYPTION_KEY: bad });
      expect(captureError().message).toContain('DATA_ENCRYPTION_KEY');
    }
  });

  it('accepts base64 for exactly 32 bytes', () => {
    setEnv({ DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') });
    expect(() => loadEnv()).not.toThrow();
  });
});

describe('the envelope write format (review finding F2)', () => {
  it('defaults to legacy — the layout every earlier build reads', () => {
    setEnv({});
    expect(loadEnv().DATA_ENCRYPTION_WRITE_FORMAT).toBe('legacy');
  });

  it('accepts keyed only when it is set explicitly', () => {
    setEnv({ DATA_ENCRYPTION_WRITE_FORMAT: 'keyed' });
    expect(loadEnv().DATA_ENCRYPTION_WRITE_FORMAT).toBe('keyed');
  });

  it('refuses any other value, naming the variable', () => {
    setEnv({ DATA_ENCRYPTION_WRITE_FORMAT: 'v2' });
    expect(captureError().message).toContain('DATA_ENCRYPTION_WRITE_FORMAT');
  });
});

describe('previous envelope keys (M37, key rotation)', () => {
  const previousA = Buffer.alloc(32, 4).toString('base64');
  const previousB = Buffer.alloc(32, 5).toString('base64');

  it('defaults to no previous key', () => {
    setEnv({});
    expect(loadEnv().DATA_ENCRYPTION_KEY_PREVIOUS).toEqual([]);
  });

  it('treats an empty value as unset, which is what `DATA_ENCRYPTION_KEY_PREVIOUS=` means', () => {
    setEnv({ DATA_ENCRYPTION_KEY_PREVIOUS: '' });
    expect(loadEnv().DATA_ENCRYPTION_KEY_PREVIOUS).toEqual([]);
  });

  it('parses a comma-separated list, in order, tolerating spaces', () => {
    setEnv({ DATA_ENCRYPTION_KEY_PREVIOUS: ` ${previousA} , ${previousB}` });
    expect(loadEnv().DATA_ENCRYPTION_KEY_PREVIOUS).toEqual([previousA, previousB]);
  });

  it('rejects an entry that is not base64 for exactly 32 bytes, naming its position', () => {
    setEnv({
      DATA_ENCRYPTION_KEY_PREVIOUS: `${previousA},${Buffer.alloc(16).toString('base64')}`,
    });
    const message = captureError().message;
    expect(message).toContain('DATA_ENCRYPTION_KEY_PREVIOUS');
    expect(message).toContain('entry 2');
  });

  it('rejects a repeated entry', () => {
    setEnv({ DATA_ENCRYPTION_KEY_PREVIOUS: `${previousA},${previousA}` });
    expect(captureError().message).toContain('repeats an earlier entry');
  });

  it('rejects the current key listed as a previous one — a rotation that never happened', () => {
    setEnv({
      DATA_ENCRYPTION_KEY_PREVIOUS: `${previousA},${COMPLETE_ENV['DATA_ENCRYPTION_KEY'] ?? ''}`,
    });
    const message = captureError().message;
    expect(message).toContain('DATA_ENCRYPTION_KEY_PREVIOUS');
    expect(message).toContain('is the current DATA_ENCRYPTION_KEY');
  });
});

describe('production hardening (RM M3.1)', () => {
  const PRODUCTION = {
    APP_ENV: 'production',
    COOKIE_DOMAIN: 'medora.health',
    CORS_ORIGINS: 'https://app.medora.health',
    SMTP_USER: 'mailer',
    JWT_SECRET: 'a-signing-key-that-is-long-enough-000000',
    APP_PUBLIC_URL: 'https://app.medora.health',
    CLAMAV_HOST: 'clamav',
    DATABASE_TENANT_CONTEXT: 'true',
  } as const;

  it('refuses to start with the example JWT secret', () => {
    setEnv({ ...PRODUCTION, JWT_SECRET: 'replace-me-with-a-generated-secret-padded' });
    const message = captureError().message;
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('openssl rand');
  });

  it('refuses a refresh cookie scoped to localhost', () => {
    // Scoped to localhost the cookie is never sent to the real origin,
    // so silent refresh fails for every user (ADR-011).
    setEnv({ ...PRODUCTION, COOKIE_DOMAIN: 'localhost' });
    expect(captureError().message).toContain('COOKIE_DOMAIN');
  });

  it('refuses a localhost CORS origin', () => {
    setEnv({ ...PRODUCTION, CORS_ORIGINS: 'https://app.medora.health,http://localhost:5173' });
    expect(captureError().message).toContain('CORS_ORIGINS');
  });

  it('refuses production without the RLS tenant context (§2.15)', () => {
    setEnv({ ...PRODUCTION, DATABASE_TENANT_CONTEXT: undefined });
    expect(captureError().message).toContain('DATABASE_TENANT_CONTEXT');
  });

  it('refuses to run without a malware scan engine (M25.3)', () => {
    setEnv({ ...PRODUCTION, CLAMAV_HOST: undefined });
    expect(captureError().message).toContain('CLAMAV_HOST');
  });

  it('refuses a clamd address carrying a port or a scheme', () => {
    for (const bad of ['clamav:3310', 'tcp://clamav']) {
      setEnv({ CLAMAV_HOST: bad });
      expect(captureError().message).toContain('CLAMAV_HOST');
    }
  });

  it('treats an empty CLAMAV_HOST as unset outside production', () => {
    setEnv({ CLAMAV_HOST: '' });
    expect(loadEnv().CLAMAV_HOST).toBeUndefined();
  });

  it('refuses an unauthenticated SMTP relay', () => {
    setEnv({ ...PRODUCTION, SMTP_USER: undefined });
    expect(captureError().message).toContain('SMTP_USER');
  });

  it('refuses the example data-encryption key', () => {
    // The example value is base64, so the placeholder text is inside the
    // encoding — the rule decodes before it looks (M6.4).
    setEnv({
      ...PRODUCTION,
      DATA_ENCRYPTION_KEY: Buffer.from('replace-me-with-openssl-rand-b64').toString('base64'),
    });
    const message = captureError().message;
    expect(message).toContain('DATA_ENCRYPTION_KEY');
    expect(message).toContain('openssl rand');
  });

  it('refuses an app URL pointing at localhost', () => {
    // Auth emails link to it. A localhost value in production is a
    // verification link nobody outside the server can open (M6.1).
    setEnv({ ...PRODUCTION, APP_PUBLIC_URL: 'http://localhost:5173' });
    expect(captureError().message).toContain('APP_PUBLIC_URL');
  });

  it('accepts a properly configured production environment', () => {
    setEnv({ ...PRODUCTION, S3_SECRET_ACCESS_KEY: 'a-real-production-key' });
    expect(loadEnv().APP_ENV).toBe('production');
  });

  it('applies none of these rules outside production', () => {
    // Development ships working defaults on purpose; the cost of that
    // convenience is that they must be impossible to deploy.
    setEnv({ APP_ENV: 'development', JWT_SECRET: 'replace-me-with-a-generated-secret-padded' });
    expect(() => loadEnv()).not.toThrow();
  });
});

describe('the hospital scope shadow switch (Phase 22, opt-in after the resource-safety audit)', () => {
  it('is off when the variable is unset', () => {
    setEnv({});
    expect(loadEnv().HOSPITAL_SCOPE_SHADOW_COMPARISON).toBe(false);
    expect(new ConfigService(loadEnv()).hospitalScopeShadowComparison).toBe(false);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ] as const)('reads an explicit %s as %s', (value, expected) => {
    setEnv({ HOSPITAL_SCOPE_SHADOW_COMPARISON: value });
    expect(loadEnv().HOSPITAL_SCOPE_SHADOW_COMPARISON).toBe(expected);
    expect(new ConfigService(loadEnv()).hospitalScopeShadowComparison).toBe(expected);
  });

  it.each(['yes', 'TRUE', 'on', '', '2'])('refuses %j at startup, naming the variable', (value) => {
    setEnv({ HOSPITAL_SCOPE_SHADOW_COMPARISON: value });
    expect(captureError().message).toContain('HOSPITAL_SCOPE_SHADOW_COMPARISON');
  });

  it('stays off in production when unset — production rules do not enable it', () => {
    // Same production fixture as 'production hardening (RM M3.1)'.
    setEnv({
      APP_ENV: 'production',
      COOKIE_DOMAIN: 'medora.health',
      CORS_ORIGINS: 'https://app.medora.health',
      SMTP_USER: 'mailer',
      JWT_SECRET: 'a-signing-key-that-is-long-enough-000000',
      APP_PUBLIC_URL: 'https://app.medora.health',
      CLAMAV_HOST: 'clamav',
      DATABASE_TENANT_CONTEXT: 'true',
    });
    expect(loadEnv().HOSPITAL_SCOPE_SHADOW_COMPARISON).toBe(false);
  });
});

describe('the hospital scope shadow bounds (C1, #26)', () => {
  it('defaults to 4 in flight and a 250 ms statement timeout', () => {
    setEnv({});
    expect(new ConfigService(loadEnv()).hospitalScopeShadowLimits).toEqual({
      maxInFlight: 4,
      statementTimeoutMs: 250,
    });
  });

  it('reads explicit values', () => {
    setEnv({
      HOSPITAL_SCOPE_SHADOW_MAX_IN_FLIGHT: '2',
      HOSPITAL_SCOPE_SHADOW_STATEMENT_TIMEOUT_MS: '500',
    });
    expect(new ConfigService(loadEnv()).hospitalScopeShadowLimits).toEqual({
      maxInFlight: 2,
      statementTimeoutMs: 500,
    });
  });

  it.each(['0', '-1', '9', '1.5', 'many'])(
    'refuses an in-flight cap of %j (below the pool size, at least one)',
    (value) => {
      setEnv({ HOSPITAL_SCOPE_SHADOW_MAX_IN_FLIGHT: value });
      expect(captureError().message).toContain('HOSPITAL_SCOPE_SHADOW_MAX_IN_FLIGHT');
    },
  );

  it.each(['0', '9', '5001', 'soon'])('refuses a statement timeout of %j', (value) => {
    setEnv({ HOSPITAL_SCOPE_SHADOW_STATEMENT_TIMEOUT_MS: value });
    expect(captureError().message).toContain('HOSPITAL_SCOPE_SHADOW_STATEMENT_TIMEOUT_MS');
  });
});

describe('.env.example (RM M3.2)', () => {
  it('is itself a valid environment', () => {
    // The classic rot: the schema gains a required variable and the
    // example file does not, so the documented one-step setup stops
    // working. Parsing the real file here makes that impossible.
    const parsed = parse(readFileSync(resolve(process.cwd(), '.env.example')));
    setEnv({ ...COMPLETE_ENV, ...parsed });

    expect(() => loadEnv()).not.toThrow();
  });

  it('documents every variable the schema declares', () => {
    const parsed = parse(readFileSync(resolve(process.cwd(), '.env.example')));
    const documented = new Set(Object.keys(parsed));
    const declared = Object.keys(envSchema.shape);

    // A variable that exists in the schema but not the example is one a
    // developer can only discover by reading source.
    expect(declared.filter((key) => !documented.has(key))).toEqual([]);
  });

  it('carries no real secret', () => {
    const raw = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');

    // Whatever is committed here must be inert. The two credential-shaped
    // values are placeholders the production rules actively reject.
    expect(raw).toContain('JWT_SECRET=replace-me');
    expect(raw).toContain('S3_SECRET_ACCESS_KEY=medora-dev-secret');
    expect(raw).toMatch(/^SMS_API_KEY=\s*$/m);
    expect(raw).toMatch(/^AI_API_KEY=\s*$/m);
  });
});

function captureError(): EnvValidationError {
  try {
    loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('Expected loadEnv() to throw an EnvValidationError');
}
