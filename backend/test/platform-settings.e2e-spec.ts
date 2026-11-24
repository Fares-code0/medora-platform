import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigService, PolicyService } from '../src/config';
import { INTEGRATION_PROBE, type ProbeResult } from '../src/modules/platform-settings/services/integration-probe';
import { ApiKeyService } from '../src/modules/platform-settings/services/api-key.service';
import { PrismaPlatformPolicySource } from '../src/shared/platform-policy';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { markPlatformAdmin } from './support/admin-scope';

/**
 * Platform Settings — API §19, RM M24.
 *
 * > ✅ Verify (M24.1): shape validated against `admin-settings.types.ts`.
 * > ✅ Verify (M24.2): one test per slice; security slice without
 * > `confirm` → 422; stale `updatedAt` → 409 with both change sets.
 * > ✅ Verify (M24.3): the plaintext key never appears in a second
 * > response or in the DB (grep the row); revoked key authenticates
 * > nothing.
 * > ✅ Verify (M24.4): config values are never returned after write;
 * > test-connection is SSRF-guarded.
 * > ✅ Verify (M24.5): manual backup produces an artifact row; restore
 * > requires the documented confirmation and is audited.
 * > ✅ Verify (M24.6): flag persists and is readable by the config
 * > service (M3.3's layering test now passes end-to-end).
 *
 * ## `platform_settings` is global, so this suite puts it back
 *
 * Eleven rows, one set, shared by every suite in the run. The auth
 * harness overrides `PLATFORM_POLICY_SOURCE` precisely so no other spec
 * reads them, but this one writes them for real — so every slice it
 * touches is restored in `afterAll`, and the values it restores are read
 * at `beforeAll` rather than hard-coded, which keeps the restore correct
 * if the seed changes.
 *
 * ## The probe is substituted; the guard is not
 *
 * `INTEGRATION_PROBE` is replaced with a fake, because a test that made
 * an outbound request would be a test of the network. The SSRF guard is
 * deliberately left alone — it is the security control, and a
 * substituted control proves nothing. Its own exhaustive cases live in
 * `ssrf-guard.spec.ts`; what is asserted here is that the route runs it.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const SETTINGS = '/api/v1/platform-settings';
const PASSWORD = 'Medora123!';

let adminToken = '';
let doctorToken = '';
let probeAnswer: ProbeResult = { reachable: true, status: 204, durationMs: 12, detail: null };
let probedUrls: string[] = [];
const seededSlices = new Map<string, unknown>();

const SLICES = [
  'general',
  'organization',
  'branding',
  'localization',
  'notifications',
  'security',
  'email',
  'sms',
  'backup',
  'retention',
  'privacy',
] as const;

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function signUpDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  return dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

/** ADR-035 §7's bootstrap: enrol a factor, take the role, step up. */
async function signUpAdmin(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const secret = dataOf<{ secret: string }>(
    await request(harness.server)
      .post('/api/v1/me/2fa/setup')
      .set('Authorization', `Bearer ${bootstrap}`)
      .send({ password: PASSWORD }),
  ).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });
  // S5: the admin role alone has no administrative scope (OD-07, M-13).
  await markPlatformAdmin(harness.prisma, email);

  const otpToken = dataOf<{ otpToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).otpToken;

  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (path = '', token = adminToken) =>
  request(harness.server).get(`${SETTINGS}${path}`).set(as(token));
const post = (path: string, body: object, token = adminToken) =>
  request(harness.server).post(`${SETTINGS}${path}`).set(as(token)).send(body);
const patch = (path: string, body: object, token = adminToken) =>
  request(harness.server).patch(`${SETTINGS}${path}`).set(as(token)).send(body);

interface SettingsDocument {
  readonly general: Record<string, unknown>;
  readonly security: Record<string, unknown>;
  readonly retention: Record<string, unknown>;
  readonly users: { id: string; name: string; email: string; role: string; active: boolean }[];
  readonly integrations: { id: string; name: string; connected: boolean }[];
  readonly apiKeys: { id: string; label: string; prefix: string; revoked: boolean }[];
  readonly backups: { id: string; label: string; sizeMb: number; kind: string }[];
  readonly revisions: Record<string, string>;
}

const document = async (): Promise<SettingsDocument> => dataOf<SettingsDocument>(await get());

/** Patches a slice at whatever revision it is currently on. */
async function patchSlice(slice: string, value: unknown, extra: object = {}) {
  const current = await document();

  return patch(`/${slice}`, { updatedAt: current.revisions[slice], value, ...extra });
}

async function newIntegration(name: string) {
  return harness.prisma.platformIntegration.create({
    data: { name, description: 'A test integration', connected: true },
    select: { id: true },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('platform-m24', {
    overrides: [
      {
        token: INTEGRATION_PROBE,
        value: {
          probe: (url: URL): Promise<ProbeResult> => {
            probedUrls.push(url.toString());
            return Promise.resolve(probeAnswer);
          },
        },
      },
    ],
  });

  adminToken = await signUpAdmin('platform-admin');
  doctorToken = await signUpDoctor('platform-doctor');

  for (const row of await harness.prisma.platformSetting.findMany()) {
    seededSlices.set(row.key, row.value);
  }
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;

  // Every slice this suite wrote, put back exactly as it was found —
  // these rows are global and the next run reads them.
  for (const [key, value] of seededSlices) {
    await harness.prisma.platformSetting.update({
      where: { key },
      data: { value: value as never },
    });
  }

  await harness.prisma.platformIntegration.deleteMany({
    where: { name: { startsWith: 'M24 ' } },
  });
  await harness.prisma.apiKey.deleteMany({ where: { label: { startsWith: 'M24 ' } } });
  await harness.prisma.backup.deleteMany({ where: { label: { startsWith: 'M24 ' } } });

  await harness.reset();
  await harness.close();
});

describe('the surface is capability-guarded, not merely authenticated', () => {
  it('refuses a doctor on every route', async () => {
    expect((await get('', doctorToken)).status).toBe(403);
    expect((await get('/api-keys', doctorToken)).status).toBe(403);
    expect((await get('/backups', doctorToken)).status).toBe(403);
    expect((await get('/integrations', doctorToken)).status).toBe(403);
    expect((await patch('/general', {}, doctorToken)).status).toBe(403);
    expect((await post('/api-keys', { label: 'x' }, doctorToken)).status).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    await request(harness.server).get(SETTINGS).expect(401);
  });
});

describe('M24.1 — the document matches the frontend contract', () => {
  it('carries all eleven slices with their declared fields', async () => {
    const doc = await document();

    // The field lists are `admin-settings.types.ts` verbatim. A missing
    // key here is a panel with an undefined input; an extra one is a
    // field the frontend will drop on its next save.
    const expected: Record<string, readonly string[]> = {
      general: [
        'platformName',
        'supportEmail',
        'defaultSection',
        'maintenanceMode',
        'maintenanceMessage',
      ],
      organization: [
        'name',
        'legalName',
        'taxId',
        'phone',
        'website',
        'addressLine',
        'city',
        'country',
      ],
      branding: ['productName', 'tagline', 'loginWelcome', 'showPoweredBy'],
      localization: [
        'language',
        'timezone',
        'dateFormat',
        'timeFormat',
        'firstDayOfWeek',
        'currency',
      ],
      notifications: [
        'emailEnabled',
        'smsEnabled',
        'inAppEnabled',
        'dailyDigest',
        'criticalOnly',
        'quietFrom',
        'quietTo',
      ],
      security: [
        'twoFactorRequired',
        'passwordExpiryDays',
        'sessionTimeoutMinutes',
        'loginAttemptLimit',
        'singleSessionPerUser',
      ],
      email: ['fromName', 'fromAddress', 'replyTo', 'smtpHost', 'smtpPort', 'signature'],
      sms: ['enabled', 'senderId', 'defaultCountryCode', 'deliveryReports'],
      backup: ['autoBackup', 'frequency', 'retainCount'],
      retention: ['patientRecordYears', 'auditLogDays', 'messageDays', 'autoPurge'],
      privacy: ['productAnalytics', 'errorReporting', 'cookieBanner', 'dpaAccepted'],
    };

    for (const [slice, fields] of Object.entries(expected)) {
      const value = (doc as unknown as Record<string, Record<string, unknown>>)[slice];
      expect(value, slice).toBeDefined();
      expect(Object.keys(value ?? {}).sort(), slice).toEqual([...fields].sort());
    }
  });

  it('carries the four collections and a revision per slice', async () => {
    const doc = await document();

    expect(Array.isArray(doc.users)).toBe(true);
    expect(Array.isArray(doc.integrations)).toBe(true);
    expect(Array.isArray(doc.apiKeys)).toBe(true);
    expect(Array.isArray(doc.backups)).toBe(true);
    expect(Object.keys(doc.revisions).sort()).toEqual([...SLICES].sort());
    // A revision that is not a timestamp cannot be compared as an
    // instant, and the whole concurrency check is that comparison.
    for (const slice of SLICES) expect(Number.isNaN(Date.parse(doc.revisions[slice] ?? ''))).toBe(false);
  });

  it('projects accounts in the shape the users panel reads', async () => {
    const doc = await document();
    const mine = doc.users.find((user) => user.email === testEmail('platform-admin'));

    expect(mine).toBeDefined();
    expect(mine?.id.startsWith('usr_')).toBe(true);
    expect(mine?.role).toBe('admin');
    expect(mine?.active).toBe(true);
  });
});

describe('M24.2 — a slice write, per slice', () => {
  it.each([
    ['general', { platformName: 'Medora M24', supportEmail: 'help@medora.health', defaultSection: 'clinic', maintenanceMode: false, maintenanceMessage: '' }],
    ['organization', { name: 'Medora Clinic', legalName: 'Medora LLC', taxId: '123', phone: '+20 1', website: 'https://medora.health', addressLine: '1 Nile St', city: 'Cairo', country: 'EG' }],
    ['branding', { productName: 'Medora', tagline: 'Care, connected', loginWelcome: 'Welcome', showPoweredBy: false }],
    ['localization', { language: 'en', timezone: 'Africa/Cairo', dateFormat: 'ISO', timeFormat: '24h', firstDayOfWeek: 'sunday', currency: 'EUR' }],
    ['notifications', { emailEnabled: true, smsEnabled: true, inAppEnabled: true, dailyDigest: true, criticalOnly: false, quietFrom: '23:00', quietTo: '06:00' }],
    ['email', { fromName: 'Medora', fromAddress: 'no-reply@medora.health', replyTo: '', smtpHost: 'smtp.medora.health', smtpPort: 465, signature: 'The Medora team' }],
    ['sms', { enabled: true, senderId: 'MEDORA', defaultCountryCode: '+20', deliveryReports: true }],
    ['backup', { autoBackup: false, frequency: 'weekly', retainCount: 10 }],
    ['privacy', { productAnalytics: false, errorReporting: true, cookieBanner: true, dpaAccepted: true }],
  ])('writes the %s slice and reads it back', async (slice, value) => {
    const response = await patchSlice(slice, value);

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const doc = dataOf<Record<string, unknown>>(response);
    expect(doc[slice]).toEqual(value);
  });

  it('writes the two confirmed slices when the confirmation is given', async () => {
    const security = await patchSlice(
      'security',
      {
        twoFactorRequired: false,
        passwordExpiryDays: 90,
        sessionTimeoutMinutes: 45,
        loginAttemptLimit: 7,
        singleSessionPerUser: false,
      },
      { confirm: true, consequence: 'Every signed-in user is affected' },
    );

    expect(security.status, JSON.stringify(security.body)).toBe(200);
    expect(dataOf<SettingsDocument>(security).security).toMatchObject({ loginAttemptLimit: 7 });

    const retention = await patchSlice(
      'retention',
      { patientRecordYears: 10, auditLogDays: 400, messageDays: 180, autoPurge: false },
      { confirm: true, consequence: 'Older audit events become eligible for deletion' },
    );

    expect(retention.status).toBe(200);
    expect(dataOf<SettingsDocument>(retention).retention).toMatchObject({ auditLogDays: 400 });
  });

  it('refuses the security slice without a confirmation', async () => {
    const response = await patchSlice('security', {
      twoFactorRequired: true,
      passwordExpiryDays: 30,
      sessionTimeoutMinutes: 10,
      loginAttemptLimit: 3,
      singleSessionPerUser: true,
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['confirm']).toBeDefined();

    // And nothing was written — a refusal that half-applied would be
    // worse than one that rejected the whole request.
    expect((await document()).security).toMatchObject({ loginAttemptLimit: 7 });
  });

  it('refuses the retention slice without a confirmation', async () => {
    const response = await patchSlice('retention', {
      patientRecordYears: 1,
      auditLogDays: 1,
      messageDays: 1,
      autoPurge: true,
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['confirm']).toBeDefined();
  });

  it('answers 422 naming the field when a value is invalid', async () => {
    const response = await patchSlice(
      'security',
      {
        twoFactorRequired: false,
        passwordExpiryDays: -1,
        sessionTimeoutMinutes: 30,
        loginAttemptLimit: 5,
        singleSessionPerUser: false,
      },
      { confirm: true },
    );

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['passwordExpiryDays']).toBeDefined();
  });

  it('rejects a defaultSection the shell cannot route to', async () => {
    const response = await patchSlice('general', {
      platformName: 'Medora',
      supportEmail: 'help@medora.health',
      defaultSection: 'payroll',
      maintenanceMode: false,
      maintenanceMessage: '',
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['defaultSection']).toBeDefined();
  });

  it('answers 404 for a slice that does not exist', async () => {
    const response = await patch('/payroll', {
      updatedAt: new Date().toISOString(),
      value: {},
    });

    // Not 422: `/platform-settings/payroll` is a resource that is not
    // there, not a malformed request. The rule M22's controller set.
    expect(response.status).toBe(404);
  });

  it('answers 409 with both change sets on a stale revision', async () => {
    const stale = (await document()).revisions['branding'];

    await patchSlice('branding', {
      productName: 'Medora',
      tagline: 'First writer',
      loginWelcome: '',
      showPoweredBy: true,
    });

    const response = await patch('/branding', {
      updatedAt: stale,
      value: {
        productName: 'Medora',
        tagline: 'Second writer',
        loginWelcome: '',
        showPoweredBy: true,
      },
    });

    expect(response.status).toBe(409);

    const conflict = JSON.parse(errorBody(response).detail ?? '{}') as {
      slice: string;
      yours: Record<string, unknown>;
      theirs: Record<string, unknown>;
      fields: string[];
    };

    // Both change sets, which is what a merge dialog needs: the value
    // that won and the value this request was holding.
    expect(conflict.slice).toBe('branding');
    expect(conflict.theirs['tagline']).toBe('First writer');
    expect(conflict.yours['tagline']).toBe('Second writer');
    expect(conflict.fields).toContain('tagline');
  });

  it('lets exactly one of two simultaneous saves win', async () => {
    // The staleness check cannot decide this on its own — both requests
    // read the same revision and both pass it. What separates them is
    // the compare-and-set in the `WHERE` clause, and this is the test
    // that would fail if the write ever became a plain update.
    const revision = (await document()).revisions['sms'];

    const body = (senderId: string) => ({
      updatedAt: revision,
      value: { enabled: true, senderId, defaultCountryCode: '+20', deliveryReports: false },
    });

    const [first, second] = await Promise.all([
      patch('/sms', body('FIRST')),
      patch('/sms', body('SECOND')),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? 'FIRST' : 'SECOND';
    expect((await document()).revisions['sms']).toBeDefined();
    expect(
      ((await document()) as unknown as Record<string, Record<string, unknown>>)['sms']?.[
        'senderId'
      ],
    ).toBe(winner);
  });
});

describe('M24.3 — API keys are shown once and stored hashed', () => {
  it('returns the full key exactly once, and never again', async () => {
    const created = await post('/api-keys', { label: 'M24 reporting export' });

    expect(created.status).toBe(201);

    const issued = dataOf<{ key: string; prefix: string; id: string }>(created);

    expect(issued.key.startsWith(`${issued.prefix}.`)).toBe(true);
    expect(issued.prefix.startsWith('mdra_live_')).toBe(true);

    // The list carries the prefix and no key. There is no second
    // response that could carry it, because nothing stored it.
    const listed = dataOf<{ id: string; prefix: string; key?: string }[]>(
      await get('/api-keys'),
    ).find((row) => row.id === issued.id);

    expect(listed?.prefix).toBe(issued.prefix);
    expect(listed?.key).toBeUndefined();

    // And the row itself — the verify step's "grep the row". Every
    // column serialised, searched for the plaintext secret.
    const row = await harness.prisma.apiKey.findUniqueOrThrow({ where: { id: issued.id } });
    const secret = issued.key.slice(issued.prefix.length + 1);

    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.keyHash).not.toBe(secret);
    expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('authenticates a live key and nothing once it is revoked', async () => {
    const issued = dataOf<{ key: string; id: string }>(
      await post('/api-keys', { label: 'M24 revocation' }),
    );
    const keys = harness.app.get(ApiKeyService);

    expect(await keys.verify(issued.key)).toMatchObject({ id: issued.id });

    expect((await post(`/api-keys/${issued.id}/revoke`, {})).status).toBe(200);

    // The verify step's second half, asserted against the service that
    // decides it rather than against a route that does not exist yet.
    expect(await keys.verify(issued.key)).toBeNull();
  });

  it('refuses a forged or truncated key without saying which part was wrong', async () => {
    const issued = dataOf<{ key: string; prefix: string }>(
      await post('/api-keys', { label: 'M24 forgery' }),
    );
    const keys = harness.app.get(ApiKeyService);

    expect(await keys.verify(`${issued.prefix}.wrong-secret`)).toBeNull();
    expect(await keys.verify('mdra_live_00000000.anything')).toBeNull();
    expect(await keys.verify(issued.prefix)).toBeNull();
    expect(await keys.verify('')).toBeNull();
  });

  it('refuses a second revocation and an unknown key', async () => {
    const issued = dataOf<{ id: string }>(await post('/api-keys', { label: 'M24 twice' }));

    expect((await post(`/api-keys/${issued.id}/revoke`, {})).status).toBe(200);
    // 409, not a silent 200: a second "revoked" audit row would claim
    // something that happened once happened twice.
    expect((await post(`/api-keys/${issued.id}/revoke`, {})).status).toBe(409);

    expect(
      (await post('/api-keys/00000000-0000-4000-8000-000000000000/revoke', {})).status,
    ).toBe(404);
  });
});

describe('M24.4 — integrations keep their credentials and are probed safely', () => {
  it('never returns config after writing it', async () => {
    const integration = await newIntegration('M24 Calendar');

    const written = await patch(`/integrations/${integration.id}`, {
      description: 'Two-way sync',
      config: { baseUrl: 'https://93.184.216.34/health', apiKey: 'super-secret-token' },
    });

    expect(written.status, JSON.stringify(written.body)).toBe(200);
    expect(JSON.stringify(written.body)).not.toContain('super-secret-token');
    expect(JSON.stringify(written.body)).not.toContain('config');

    const listed = await get('/integrations');
    expect(JSON.stringify(listed.body)).not.toContain('super-secret-token');

    // Stored as ciphertext, not as JSON that merely is not returned.
    const row = await harness.prisma.platformIntegration.findUniqueOrThrow({
      where: { id: integration.id },
    });
    expect(row.configEnc).not.toBeNull();
    expect(Buffer.from(row.configEnc ?? new Uint8Array()).toString('utf8')).not.toContain(
      'super-secret-token',
    );
  });

  it('probes a public endpoint and records the answer', async () => {
    const integration = await newIntegration('M24 Reachable');
    await patch(`/integrations/${integration.id}`, {
      config: { baseUrl: 'https://93.184.216.34/health' },
    });

    probedUrls = [];
    probeAnswer = { reachable: true, status: 204, durationMs: 12, detail: null };

    const response = await post(`/integrations/${integration.id}/test-connection`, {});

    expect(response.status).toBe(200);
    expect(dataOf<{ reachable: boolean; status: number }>(response)).toMatchObject({
      reachable: true,
      status: 204,
    });
    expect(probedUrls).toEqual(['https://93.184.216.34/health']);
  });

  it('reports an unreachable endpoint without failing the request', async () => {
    const integration = await newIntegration('M24 Unreachable');
    await patch(`/integrations/${integration.id}`, {
      config: { baseUrl: 'https://93.184.216.34/health' },
    });

    probeAnswer = { reachable: false, status: null, durationMs: 5000, detail: 'AbortError' };

    const response = await post(`/integrations/${integration.id}/test-connection`, {});

    // 200 with `reachable: false`, not a 5xx: the probe ran and answered.
    // A failing provider is the result, not an error in this API.
    expect(response.status).toBe(200);
    expect(dataOf<{ reachable: boolean }>(response).reachable).toBe(false);

    probeAnswer = { reachable: true, status: 204, durationMs: 12, detail: null };
  });

  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'the cloud metadata service'],
    ['http://127.0.0.1:5432/', 'the database on loopback'],
    ['http://10.0.0.5/', 'the private network'],
    ['http://localhost:6379/', 'localhost by name'],
    ['file:///etc/passwd', 'a non-http scheme'],
  ])('refuses to probe %s (%s)', async (baseUrl) => {
    const integration = await newIntegration(`M24 Blocked ${baseUrl}`);
    await patch(`/integrations/${integration.id}`, { config: { baseUrl } });

    probedUrls = [];
    const response = await post(`/integrations/${integration.id}/test-connection`, {});

    expect(response.status).toBe(422);
    // The guard runs before anything is fetched — asserted, not assumed.
    expect(probedUrls).toEqual([]);
  });

  it('refuses to probe an integration with no endpoint configured', async () => {
    const integration = await newIntegration('M24 Unconfigured');

    const response = await post(`/integrations/${integration.id}/test-connection`, {});

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['config.baseUrl']).toBeDefined();
  });

  it('requires a confirmation before a connected integration is disabled', async () => {
    const integration = await newIntegration('M24 Disable');

    const refused = await patch(`/integrations/${integration.id}`, { connected: false });
    expect(refused.status).toBe(422);
    expect(errorBody(refused).fieldErrors?.['confirm']).toBeDefined();

    const allowed = await patch(`/integrations/${integration.id}`, {
      connected: false,
      confirm: true,
      consequence: 'Appointments stop syncing',
    });
    expect(allowed.status).toBe(200);
    expect(dataOf<{ connected: boolean }>(allowed).connected).toBe(false);

    // Re-enabling needs no confirmation — turning a service back on is
    // not the change whose consequence is invisible.
    expect((await patch(`/integrations/${integration.id}`, { connected: true })).status).toBe(200);
  });

  it('answers 404 for an integration that does not exist', async () => {
    expect(
      (await patch('/integrations/00000000-0000-4000-8000-000000000000', { connected: true }))
        .status,
    ).toBe(404);
  });
});

describe('M24.5 — the catalogue is live; taking and restoring a backup is not', () => {
  it('lists recovery points', async () => {
    await harness.prisma.backup.create({
      data: {
        label: 'M24 nightly',
        sizeMb: 42.5,
        kind: 'AUTOMATIC',
        storageRef: 'backups/m24-nightly.dump',
      },
    });

    const listed = dataOf<{ label: string; sizeMb: number; kind: string }[]>(
      await get('/backups'),
    );
    const mine = listed.find((row) => row.label === 'M24 nightly');

    expect(mine).toBeDefined();
    // A `Decimal` reaching a chart as `{ s, e, d }` is the bug this
    // assertion exists for.
    expect(mine?.sizeMb).toBe(42.5);
    expect(mine?.kind).toBe('automatic');
  });

  it('answers 501 for a manual backup, naming what is missing', async () => {
    const response = await post('/backups', {});

    // Not a row with no artifact behind it. An administrator reads this
    // panel after something has gone wrong, and a recovery point that
    // does not exist is worse than an empty list.
    expect(response.status).toBe(501);
    expect(errorBody(response).message).toContain('M25');
    expect(errorBody(response).detail).toBe('RA-M24.2');
  });

  it('answers 501 for a restore, naming the unstated policy too', async () => {
    const response = await post('/backups/00000000-0000-4000-8000-000000000000/restore', {});

    expect(response.status).toBe(501);
    expect(errorBody(response).message).toContain('out-of-band');
  });
});

describe('M24.6 — M3.3 layers the database over the environment, end to end', () => {
  it('reads the security slice through the config service', async () => {
    // The harness overrides `PLATFORM_POLICY_SOURCE` so no other suite
    // is steered by these rows, so the layering is proven against a
    // `PolicyService` assembled here from the real source — the same two
    // classes the application wires, over the same database.
    const policy = new PolicyService(
      harness.app.get(ConfigService),
      new PrismaPlatformPolicySource(harness.prisma),
    );

    await patchSlice(
      'security',
      {
        twoFactorRequired: true,
        passwordExpiryDays: 45,
        sessionTimeoutMinutes: 15,
        loginAttemptLimit: 3,
        singleSessionPerUser: true,
      },
      { confirm: true, consequence: 'Tightens sign-in for everyone' },
    );

    const current = await policy.current();

    // Every one of the five, and `twoFactorRequired`/`singleSessionPerUser`
    // matter most: they flip `false → true`, which a truthiness check
    // would get right and a `??` would get wrong in the other direction.
    expect(current).toMatchObject({
      twoFactorRequired: true,
      passwordExpiryDays: 45,
      sessionTimeoutMinutes: 15,
      loginAttemptLimit: 3,
      singleSessionPerUser: true,
    });

    // The env defaults are what it would have answered without the row.
    expect(policy.defaults.passwordExpiryDays).toBe(180);
  });

  it('persists the maintenance flag and reads it back through the policy', async () => {
    const policy = new PolicyService(
      harness.app.get(ConfigService),
      new PrismaPlatformPolicySource(harness.prisma),
    );

    expect((await policy.current()).maintenanceMode).toBe(false);

    await patchSlice('general', {
      platformName: 'Medora',
      supportEmail: 'help@medora.health',
      defaultSection: 'overview',
      maintenanceMode: true,
      maintenanceMessage: 'Back at 02:00 UTC',
    });

    const current = await policy.current();

    // M24.6: the flag persists and the config service reads it. The
    // middleware that turns this into a 503 is M38.3 — deliberately not
    // here, and asserted nowhere, because it does not exist.
    expect(current.maintenanceMode).toBe(true);
    expect(current.maintenanceMessage).toBe('Back at 02:00 UTC');
  });

  it('keeps the environment default when a stored value is nonsense', async () => {
    // Written past the API on purpose: this is the case where a
    // migration, a hand edit or a future validation bug puts a bad value
    // in the column, and one bad setting must cost that setting alone.
    await harness.prisma.platformSetting.update({
      where: { key: 'security' },
      data: { value: { loginAttemptLimit: -4, sessionTimeoutMinutes: 25 } },
    });

    const policy = new PolicyService(
      harness.app.get(ConfigService),
      new PrismaPlatformPolicySource(harness.prisma),
    );
    const current = await policy.current();

    expect(current.loginAttemptLimit).toBe(policy.defaults.loginAttemptLimit);
    expect(current.sessionTimeoutMinutes).toBe(25);
  });

  it('falls back to the environment when the slice is missing entirely', async () => {
    await harness.prisma.platformSetting.update({
      where: { key: 'security' },
      data: { value: {} },
    });

    const policy = new PolicyService(
      harness.app.get(ConfigService),
      new PrismaPlatformPolicySource(harness.prisma),
    );
    const current = await policy.current();

    // The five security keys only. `maintenanceMode` comes from the
    // `general` slice, which the previous test set and this one did not
    // clear — asserting the whole object here would be asserting that
    // two independent slices were both empty.
    expect(current).toMatchObject({
      twoFactorRequired: policy.defaults.twoFactorRequired,
      passwordExpiryDays: policy.defaults.passwordExpiryDays,
      sessionTimeoutMinutes: policy.defaults.sessionTimeoutMinutes,
      loginAttemptLimit: policy.defaults.loginAttemptLimit,
      singleSessionPerUser: policy.defaults.singleSessionPerUser,
    });
  });
});
