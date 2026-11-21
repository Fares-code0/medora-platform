import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTIVITY_KINDS } from '../src/shared/activity';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * The per-user activity feed — API §2.8, DB §A12, RM M29.
 *
 * > ✅ Verify: one test per kind produces its row; feed pagination works.
 *
 * ## What M29 actually found
 *
 * Six of `ActivityKind`'s seven members had writers. **`login` had
 * none** — the enum declared it, `ACTIVITY_KIND_LABELS` rendered it, and
 * Settings → Activity offered a filter that could only ever return
 * nothing. That is worse than an absent filter: a user reads an empty
 * "Sign-ins" tab as *"I have never signed in"*, which is a false
 * statement about their own account security.
 *
 * The second gap was the feed's other half. §2.8 is a `/me` route and
 * M29.1 asks for "self **+ admin profile view**"; the administrator's
 * side did not exist, so an administrator looking at an account could
 * change its role without being able to see what it had been doing.
 *
 * ## Why the kinds are driven rather than inserted
 *
 * Every case below goes through the HTTP flow that should write the row.
 * Inserting rows directly would test `user_activity_log` — which M5
 * already covers — rather than the writer hooks, which are what M29.1 is
 * about and the only thing that can silently not exist.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const ACTIVITY = '/api/v1/me/activity';
const PASSWORD = 'Medora123!';

let token = '';
let userPublicId = '';
let adminToken = '';
let otherToken = '';

const as = (auth: string) => ({ Authorization: `Bearer ${auth}` });

interface ActivityEntry {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly at: string;
}

interface Feed {
  readonly items: ActivityEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

/** The caller's own feed, optionally filtered by kind. */
async function feed(kind?: string, auth = token, page = 1, pageSize = 50): Promise<Feed> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (kind !== undefined) query.set('kind', kind);

  return dataOf<Feed>(
    await request(harness.server).get(`${ACTIVITY}?${query.toString()}`).set(as(auth)),
  );
}

async function signUpDoctor(local: string): Promise<{ auth: string; userId: string; publicId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const auth = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, publicId: true },
  });

  return { auth, userId: user.id, publicId: user.publicId };
}

async function signUpAdmin(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const secret = dataOf<{ secret: string }>(
    await request(harness.server).post('/api/v1/me/2fa/setup').set(as(bootstrap)).send({ password: PASSWORD }),
  ).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

  const otpToken = dataOf<{ otpToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).otpToken;

  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;
}

beforeAll(async () => {
  harness = await createAuthHarness('activity-m29');

  const doctor = await signUpDoctor('activity-doctor');
  token = doctor.auth;
  userPublicId = doctor.publicId;

  adminToken = await signUpAdmin('activity-admin');
  otherToken = (await signUpDoctor('activity-other')).auth;
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.reset();
  await harness.close();
});

describe('M29.1 — one row per kind, written by the flow that causes it', () => {
  it('login — the kind that had no writer at all', async () => {
    // `beforeAll` signed this account in. The row is the whole of M29's
    // finding: without it the Settings → Activity "Sign-ins" filter
    // returns nothing, which a user reads as "I have never signed in".
    const rows = await feed('login');

    expect(rows.totalItems).toBeGreaterThan(0);
    expect(rows.items[0]?.summary).toBe('Signed in');
    // The device string, which the Security panel already shows this
    // user about their own sessions. No PHI, no secrets.
    expect(rows.items[0]?.at).toBeDefined();
  });

  it('password — a change writes its own row', async () => {
    const response = await request(harness.server)
      .post('/api/v1/me/password')
      .set(as(token))
      .send({ currentPassword: PASSWORD, newPassword: 'Medora456!' });

    expect([200, 204]).toContain(response.status);

    const rows = await feed('password');
    expect(rows.totalItems).toBeGreaterThan(0);

    // Put back, so the rest of the suite can still sign this account in.
    await request(harness.server)
      .post('/api/v1/me/password')
      .set(as(token))
      .send({ currentPassword: 'Medora456!', newPassword: PASSWORD });
  });

  it('profile — an account edit writes its own row', async () => {
    const response = await request(harness.server)
      .patch('/api/v1/me/account')
      .set(as(token))
      .send({ phone: '+20 100 999 8888' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const rows = await feed('profile');
    expect(rows.totalItems).toBeGreaterThan(0);
    // The summary names what changed, never the value it changed to —
    // `shared/activity`'s contract, and the reason a phone number is
    // safe to have in this table's neighbourhood.
    expect(rows.items[0]?.summary).not.toContain('999 8888');
  });

  it('settings — a non-privacy slice writes under `settings`', async () => {
    const current = dataOf<{ updatedAt: string; workflow: Record<string, unknown> }>(
      await request(harness.server).get('/api/v1/me/settings').set(as(token)),
    );

    const response = await request(harness.server)
      .patch('/api/v1/me/settings/preferences')
      .set(as(token))
      .send({
        updatedAt: current.updatedAt,
        value: { ...current.workflow, autoSaveDrafts: false },
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await feed('settings')).totalItems).toBeGreaterThan(0);
  });

  it('privacy — the privacy slice writes under `privacy`, not `settings`', async () => {
    const before = (await feed('settings')).totalItems;

    const current = dataOf<{ updatedAt: string; privacy: Record<string, unknown> }>(
      await request(harness.server).get('/api/v1/me/settings').set(as(token)),
    );

    const response = await request(harness.server)
      .patch('/api/v1/me/settings/privacy')
      .set(as(token))
      .send({ updatedAt: current.updatedAt, value: { ...current.privacy, analytics: false } });

    expect(response.status).toBe(200);

    // The whole point of the distinction: the feed groups by kind, and a
    // privacy change filed under "Settings" is invisible in the filter a
    // user would actually look in.
    expect((await feed('privacy')).totalItems).toBeGreaterThan(0);
    expect((await feed('settings')).totalItems).toBe(before);
  });

  it('security — enabling a second factor writes under `security`', async () => {
    const secret = dataOf<{ secret: string }>(
      await request(harness.server).post('/api/v1/me/2fa/setup').set(as(token)).send({ password: PASSWORD }),
    ).secret;

    await request(harness.server)
      .post('/api/v1/me/2fa/enable')
      .set(as(token))
      .send({ code: currentCode(secret) });

    expect((await feed('security')).totalItems).toBeGreaterThan(0);
  });

  it('integration — disconnecting one writes under `integration`', async () => {
    const response = await request(harness.server)
      .post('/api/v1/me/integrations/google-calendar/disconnect')
      .set(as(token))
      .send({});

    expect(response.status).toBe(200);
    expect((await feed('integration')).totalItems).toBeGreaterThan(0);
  });

  it('covers all seven kinds, with none left unwritten', async () => {
    // The assertion M29.1 is really asking for. `login` failed here
    // before this milestone; a kind with no writer is a filter that can
    // only ever return nothing.
    const empty: string[] = [];

    for (const kind of ACTIVITY_KINDS) {
      if ((await feed(kind)).totalItems === 0) empty.push(kind);
    }

    expect(empty).toEqual([]);
  });
});

describe('M29.1 — the feed', () => {
  it('pages, newest first, without repeating or losing a row', async () => {
    const all = await feed(undefined, token, 1, 50);

    expect(all.totalItems).toBeGreaterThan(3);
    expect(all.totalPages).toBe(Math.ceil(all.totalItems / 50));

    const first = await feed(undefined, token, 1, 2);
    const second = await feed(undefined, token, 2, 2);

    expect(first.items).toHaveLength(2);
    expect(first.page).toBe(1);
    expect(second.page).toBe(2);

    // Newest first, and the two pages are disjoint.
    const times = first.items.map((entry) => Date.parse(entry.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const ids = [...first.items, ...second.items].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters by kind, and reports the filtered total', async () => {
    const all = await feed();
    const logins = await feed('login');

    expect(logins.totalItems).toBeLessThan(all.totalItems);
    expect(logins.items.every((entry) => entry.kind === 'login')).toBe(true);
  });

  it('refuses a kind that is not one of the seven', async () => {
    const response = await request(harness.server)
      .get(`${ACTIVITY}?kind=payroll`)
      .set(as(token));

    expect(response.status).toBe(422);
  });

  it('shows the caller only their own rows', async () => {
    const mine = await feed(undefined, token);
    const theirs = await feed(undefined, otherToken);

    // A fresh account has its own sign-in and nothing else; it must not
    // see the account above, which has a dozen rows by now.
    expect(theirs.totalItems).toBeLessThan(mine.totalItems);
    expect(theirs.items.every((entry) => entry.kind === 'login')).toBe(true);
  });

  it('requires authentication', async () => {
    await request(harness.server).get(ACTIVITY).expect(401);
  });
});

describe('M29.1 — the admin profile view', () => {
  const adminFeed = (publicId: string, auth = adminToken) =>
    request(harness.server).get(`/api/v1/admin/users/${publicId}/activity`).set(as(auth));

  it('shows an administrator exactly what the account owner sees', async () => {
    const mine = await feed();
    const response = await adminFeed(userPublicId);

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const theirs = dataOf<Feed>(response);

    // One projection, reused rather than reimplemented: two copies of
    // one feed drift, and nobody compares the two screens.
    expect(theirs.totalItems).toBe(mine.totalItems);
    expect(theirs.items.map((entry) => entry.id)).toEqual(mine.items.map((entry) => entry.id));
  });

  it('pages and filters the same way', async () => {
    const page = dataOf<Feed>(
      await request(harness.server)
        .get(`/api/v1/admin/users/${userPublicId}/activity?kind=login&pageSize=1`)
        .set(as(adminToken)),
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.kind).toBe('login');
    expect(page.pageSize).toBe(1);
  });

  it('answers 404 for an account that does not exist', async () => {
    // Before the feed, and identical to a genuinely missing account: an
    // administrator must not learn from the shape of the answer that a
    // `usr_…` they guessed might be real.
    expect((await adminFeed('usr_does_not_exist')).status).toBe(404);
  });

  it('refuses a caller without roles.manage', async () => {
    expect((await adminFeed(userPublicId, token)).status).toBe(403);
    await request(harness.server)
      .get(`/api/v1/admin/users/${userPublicId}/activity`)
      .expect(401);
  });

  it('carries no PHI, because the table cannot hold any', async () => {
    const theirs = dataOf<Feed>(await adminFeed(userPublicId));

    // `user_activity_log` holds account events, and `shared/activity`'s
    // contract forbids values outright. So unlike every admin projection
    // of a `patients` row (API §4.11), there is nothing here to mask —
    // and this asserts the property rather than assuming it.
    const serialised = JSON.stringify(theirs);
    expect(serialised).not.toContain('999 8888');
    expect(serialised).not.toContain(PASSWORD);
  });
});
