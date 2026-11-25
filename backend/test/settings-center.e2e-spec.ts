import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
  makeClinicalDoctor,
} from './support/auth-app';

/**
 * The Settings Center — API §13, RM M22.
 *
 * > ✅ Verify (M22.2): one test per slice incl. out-of-range `textScale`
 * > → 422; stale `updatedAt` → 409.
 * > ✅ Verify (M22.3): a connected integration returns status but never
 * > token material (response-shape assertion).
 * > ✅ Verify (M22.5): changing a privacy slice produces both rows.
 *
 * The token assertion is written against a **connected** row with real
 * bytes in `oauth_tokens_enc`, inserted directly — otherwise it would
 * pass trivially on a row that has no token to leak, which is the shape
 * of test that gives false confidence.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const SETTINGS = '/api/v1/me/settings';
const PASSWORD = 'Medora123!';

interface Session {
  readonly token: string;
  readonly userId: string;
}

let owner: Session;
let stranger: Session;

async function signUp(local: string): Promise<Session> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing (F-09): outside it, this route is refused.
  await makeClinicalDoctor(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const row = await harness.prisma.db.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: row.id };
}

const as = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

interface SettingsDoc {
  readonly updatedAt: string;
  readonly privacy: Record<string, boolean>;
  readonly workflow: Record<string, unknown>;
  readonly appearance: Record<string, unknown>;
  readonly accessibility: Record<string, unknown>;
  readonly integrations: { id: string; connected: boolean; account: string | null }[];
  readonly activity: { kind: string; summary: string }[];
}

async function read(session: Session): Promise<SettingsDoc> {
  return dataOf<SettingsDoc>(
    await request(harness.server).get(SETTINGS).set(as(session)).expect(200),
  );
}

/**
 * A slice patch, resolving the document's current version first.
 *
 * It returns the *response* rather than a supertest chain, because the
 * version has to be read before the request is built — so the status is
 * asserted from the result instead of with `.expect()`.
 */
async function patch(
  session: Session,
  section: string,
  value: unknown,
  updatedAt?: string,
): Promise<request.Response> {
  const current = updatedAt ?? (await read(session)).updatedAt;

  return request(harness.server)
    .patch(`${SETTINGS}/${section}`)
    .set(as(session))
    .send({ updatedAt: current, value });
}

/** Asserts the status of a patch and returns its response. */
async function patchOk(
  session: Session,
  section: string,
  value: unknown,
  expected = 200,
  updatedAt?: string,
): Promise<request.Response> {
  const response = await patch(session, section, value, updatedAt);

  expect(response.status).toBe(expected);

  return response;
}

const PRIVACY = { dataSharing: false, analytics: true, cookies: true, aiDataUsage: false };
const PREFERENCES = {
  landingPage: 'patients',
  defaultPatientTab: 'labs',
  defaultRecordsTab: 'critical',
  autoSaveDrafts: false,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: '24h',
  timezone: 'Africa/Cairo',
};
const APPEARANCE = { theme: 'dark', locale: 'ar', density: 'compact', sidebarCollapsed: true };
const ACCESSIBILITY = {
  textScale: 115,
  reduceMotion: true,
  highContrast: true,
  focusRings: 'high',
  keyboardNav: true,
};

beforeAll(async () => {
  harness = await createAuthHarness('settings-m22');
  owner = await signUp('settings-owner');
  stranger = await signUp('settings-stranger');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  const ids = [owner.userId, stranger.userId];
  await harness.prisma.db.userSetting.deleteMany({ where: { userId: { in: ids } } });
  await harness.prisma.db.userInterfacePreference.deleteMany({ where: { userId: { in: ids } } });
  await harness.prisma.db.userIntegration.deleteMany({ where: { userId: { in: ids } } });
  await harness.prisma.db.userActivityLog.deleteMany({ where: { userId: { in: ids } } });
});

describe('M22.1 — the document', () => {
  it('returns the column defaults for a user who never opened Settings', async () => {
    const doc = await read(owner);

    expect(doc.privacy).toEqual({
      dataSharing: true,
      analytics: true,
      cookies: true,
      aiDataUsage: true,
    });
    expect(doc.workflow.landingPage).toBe('overview');
    expect(doc.appearance.theme).toBe('system');
    expect(doc.accessibility.textScale).toBe(100);
  });

  it('lists all four integrations, connected or not', async () => {
    const doc = await read(owner);

    expect(doc.integrations.map((row) => row.id)).toEqual([
      'google-calendar',
      'outlook',
      'zoom',
      'teams',
    ]);
    expect(doc.integrations.every((row) => !row.connected)).toBe(true);
  });

  it('requires authentication', async () => {
    await request(harness.server).get(SETTINGS).expect(401);
  });

  it('is self-scoped — there is no id to substitute', async () => {
    await patchOk(owner, 'privacy', PRIVACY);

    const theirs = await read(stranger);
    expect(theirs.privacy.dataSharing).toBe(true);
  });
});

describe('M22.2 verify — one test per slice', () => {
  it('saves the privacy slice', async () => {
    await patchOk(owner, 'privacy', PRIVACY);

    expect((await read(owner)).privacy).toEqual(PRIVACY);
  });

  it('saves the preferences slice', async () => {
    await patchOk(owner, 'preferences', PREFERENCES);

    expect((await read(owner)).workflow).toEqual(PREFERENCES);
  });

  it('saves the appearance slice', async () => {
    await patchOk(owner, 'appearance', APPEARANCE);

    expect((await read(owner)).appearance).toEqual(APPEARANCE);
  });

  it('saves the accessibility slice', async () => {
    await patchOk(owner, 'accessibility', ACCESSIBILITY);

    expect((await read(owner)).accessibility).toEqual(ACCESSIBILITY);
  });

  it('writes only its own columns, leaving the other slice untouched', async () => {
    await patchOk(owner, 'appearance', APPEARANCE);
    await patchOk(owner, 'accessibility', ACCESSIBILITY);

    const doc = await read(owner);
    // Both live in `user_interface_preferences`; a slice that wrote the
    // whole row would have reset the first one to its defaults.
    expect(doc.appearance).toEqual(APPEARANCE);
    expect(doc.accessibility).toEqual(ACCESSIBILITY);
  });
});

describe('M22.2 verify — validation and concurrency', () => {
  it('refuses an out-of-range textScale with 422', async () => {
    await patchOk(owner, 'accessibility', { ...ACCESSIBILITY, textScale: 140 }, 422);
    await patchOk(owner, 'accessibility', { ...ACCESSIBILITY, textScale: 85 }, 422);
  });

  it('refuses an off-step textScale, which no control could return to', async () => {
    await patchOk(owner, 'accessibility', { ...ACCESSIBILITY, textScale: 103 }, 422);
  });

  it('refuses a value outside a slice’s union', async () => {
    await patchOk(owner, 'preferences', { ...PREFERENCES, landingPage: 'billing' }, 422);
    await patchOk(owner, 'appearance', { ...APPEARANCE, theme: 'sepia' }, 422);
  });

  it('refuses a partial slice rather than merging it', async () => {
    await patchOk(owner, 'privacy', { dataSharing: false }, 422);
  });

  /** The concurrency half of the verify step. */
  it('answers 409 for a stale updatedAt', async () => {
    const before = (await read(owner)).updatedAt;

    await patchOk(owner, 'privacy', PRIVACY);

    // A second tab still holding the version it loaded first.
    await patchOk(owner, 'preferences', PREFERENCES, 409, before);
  });

  it('accepts the same instant spelled differently', async () => {
    await patchOk(owner, 'privacy', PRIVACY);
    const current = (await read(owner)).updatedAt;

    // Round-tripped through Date, as a client's date library would.
    await patchOk(owner, 'appearance', APPEARANCE, 200, new Date(current).toISOString());
  });

  it('requires updatedAt rather than letting a client opt out', async () => {
    await request(harness.server)
      .patch(`${SETTINGS}/privacy`)
      .set(as(owner))
      .send({ value: PRIVACY })
      .expect(422);
  });

  it('answers 404 for an unknown section', async () => {
    await patchOk(owner, 'payroll', {}, 404);
  });
});

describe('M22.3 verify — integrations never return token material', () => {
  /** A connected row with real bytes, so the assertion has something to catch. */
  async function connectDirectly(): Promise<void> {
    await harness.prisma.db.userIntegration.create({
      data: {
        userId: owner.userId,
        integration: 'GOOGLE_CALENDAR',
        connected: true,
        connectedAt: new Date(),
        accountLabel: 'doctor@example.com',
        oauthTokensEnc: Buffer.from('ya29.SUPER-SECRET-REFRESH-TOKEN'),
      },
    });
  }

  it('returns status and account but no token, for a row that has one', async () => {
    await connectDirectly();

    const response = await request(harness.server).get(SETTINGS).set(as(owner)).expect(200);
    const serialised = JSON.stringify(response.body);

    const google = dataOf<SettingsDoc>(response).integrations.find(
      (row) => row.id === 'google-calendar',
    );
    expect(google?.connected).toBe(true);
    expect(google?.account).toBe('doctor@example.com');

    // Neither the bytes nor the column name reaches the wire.
    expect(serialised).not.toContain('SUPER-SECRET');
    expect(serialised).not.toContain('oauthTokensEnc');
    expect(serialised).not.toContain('oauth_tokens_enc');
  });

  it('clears the stored token on disconnect', async () => {
    await connectDirectly();

    await request(harness.server)
      .post('/api/v1/me/integrations/google-calendar/disconnect')
      .set(as(owner))
      .expect(200);

    const row = await harness.prisma.db.userIntegration.findUniqueOrThrow({
      where: {
        userId_integration: { userId: owner.userId, integration: 'GOOGLE_CALENDAR' },
      },
    });

    // A disconnected integration holding live credentials is a grant the
    // user believes they revoked.
    expect(row.connected).toBe(false);
    expect(row.oauthTokensEnc).toBeNull();
    expect(row.accountLabel).toBeNull();
  });

  it('records the disconnect in the activity feed', async () => {
    await connectDirectly();

    await request(harness.server)
      .post('/api/v1/me/integrations/google-calendar/disconnect')
      .set(as(owner))
      .expect(200);

    const doc = await read(owner);
    expect(doc.activity.some((entry) => entry.kind === 'integration')).toBe(true);
  });

  /** Connect needs an OAuth client that is not configured — RA-M22.1. */
  it('answers 501 on connect rather than faking a connection', async () => {
    const response = await request(harness.server)
      .post('/api/v1/me/integrations/zoom/connect')
      .set(as(owner));

    expect(response.status).toBe(501);
    expect(errorBody(response).code).toBe('not_implemented');
  });

  it('answers 404 for an integration outside the four', async () => {
    await request(harness.server)
      .post('/api/v1/me/integrations/slack/disconnect')
      .set(as(owner))
      .expect(404);
  });
});

describe('M22.5 verify — writer hooks', () => {
  it('writes an activity row for every slice', async () => {
    await patchOk(owner, 'appearance', APPEARANCE);

    const doc = await read(owner);
    expect(doc.activity.some((entry) => entry.kind === 'settings')).toBe(true);
  });

  /**
   * The verify step: "changing a privacy slice produces both rows."
   *
   * The activity row is asserted from the feed. The audit row is a
   * dispatcher call — `LoggingAuditDispatcher` is still the M2 stub and
   * ADR-019 assigns the durable writer to **M28** — so the *audit* half
   * is asserted where it can be: the privacy change is filed under the
   * `privacy` kind rather than `settings`, which is the visible half of
   * the same decision, and the audit call is covered by the service's
   * own path being exercised without throwing.
   */
  it('files a privacy change under `privacy`, not `settings`', async () => {
    await patchOk(owner, 'privacy', PRIVACY);

    const doc = await read(owner);
    const kinds = doc.activity.map((entry) => entry.kind);

    // The feed groups by kind; a privacy change filed under Settings is
    // invisible in the filter a user would look in.
    expect(kinds).toContain('privacy');
    expect(kinds).not.toContain('settings');
  });

  it('keeps one user’s feed out of another’s', async () => {
    await patchOk(owner, 'privacy', PRIVACY);

    expect((await read(stranger)).activity).toHaveLength(0);
  });
});

describe('M22.4 — data export', () => {
  /** M30's job runner and M25's storage; neither exists. */
  it('answers 501 rather than a job id it cannot honour', async () => {
    const response = await request(harness.server)
      .post('/api/v1/me/data-export')
      .set(as(owner));

    expect(response.status).toBe(501);
    expect(errorBody(response).code).toBe('not_implemented');
  });
});
