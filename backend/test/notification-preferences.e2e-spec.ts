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
} from './support/auth-app';

/**
 * Row actions, clear-read, summary and preferences — RM M19.3, M19.4.
 *
 * > ✅ Verify (M19.4): both rule tests.
 *
 * The two rules are `categories.security` staying true (422 otherwise)
 * and quiet hours never suppressing critical lab alerts. The first is
 * asserted here over HTTP **and** at the database, because DB §G7
 * deliberately holds it in both places. The second is a send-time rule
 * and is asserted where it runs — `channel-selection.spec.ts` for the
 * decision, `notification-fanout.e2e-spec.ts` for the delivery row.
 *
 * Around them, what these routes can get wrong: a flag write that is not
 * scoped to the owner, an action that is not idempotent under an
 * optimistic client, and a `PUT` that silently drops a field it did not
 * recognise.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const FEED = '/api/v1/notifications';
const PREFS = '/api/v1/me/notification-preferences';
const PASSWORD = 'Medora123!';

interface Session {
  readonly token: string;
  readonly userId: string;
}

async function signUp(local: string): Promise<Session> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const user = await harness.prisma.db.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: user.id };
}

async function seedNotification(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = await harness.prisma.db.notification.create({
    data: {
      recipientId: userId,
      title: 'Critical lab result released',
      body: 'Order LAB-1 · Analytes: Potassium',
      category: 'LABORATORY',
      priority: 'CRITICAL',
      kind: 'ALERT',
      sender: 'Medora',
      ...overrides,
    },
    select: { id: true },
  });

  return row.id;
}

const VALID_PREFS = {
  channels: { email: true, sms: false, push: true, desktop: false, inApp: true },
  quietHours: { enabled: true, from: '22:00', to: '07:00' },
  categories: {
    appointments: true,
    'medical-records': false,
    laboratory: true,
    pharmacy: true,
    patients: true,
    ai: false,
    system: true,
    security: true,
  },
};

let owner: Session;
let stranger: Session;

beforeAll(async () => {
  harness = await createAuthHarness('notify-prefs');
  owner = await signUp('prefs-owner');
  stranger = await signUp('prefs-stranger');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.prisma.db.notification.deleteMany({
    where: { recipientId: { in: [owner.userId, stranger.userId] } },
  });
  await harness.prisma.db.notificationPreference.deleteMany({
    where: { userId: { in: [owner.userId, stranger.userId] } },
  });
});

describe('row actions — API §10.2', () => {
  it('archives, and defaults `value` to true so the route reads as it looks', async () => {
    const id = await seedNotification(owner.userId);

    const response = await request(harness.server)
      .post(`${FEED}/${id}/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});

    expect(response.status).toBe(204);
    const row = await harness.prisma.db.notification.findUniqueOrThrow({ where: { id } });
    expect(row.archived).toBe(true);
  });

  it('un-archives with an explicit false, which a toggle could not express', async () => {
    const id = await seedNotification(owner.userId, { archived: true });

    await request(harness.server)
      .post(`${FEED}/${id}/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ value: false })
      .expect(204);

    const row = await harness.prisma.db.notification.findUniqueOrThrow({ where: { id } });
    expect(row.archived).toBe(false);
  });

  it('favorites and pins independently, so one control never writes another field', async () => {
    const id = await seedNotification(owner.userId, { pinned: true });

    await request(harness.server)
      .post(`${FEED}/${id}/favorite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({})
      .expect(204);

    const row = await harness.prisma.db.notification.findUniqueOrThrow({ where: { id } });
    expect(row.favorite).toBe(true);
    // "Mark favorite" must not silently unpin.
    expect(row.pinned).toBe(true);
  });

  it('is idempotent, because the client is optimistic', async () => {
    const id = await seedNotification(owner.userId);

    await request(harness.server)
      .post(`${FEED}/${id}/pin`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({})
      .expect(204);
    await request(harness.server)
      .post(`${FEED}/${id}/pin`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({})
      .expect(204);
  });

  it("answers 404 for someone else's notification, the same as for a missing one", async () => {
    const id = await seedNotification(stranger.userId);

    await request(harness.server)
      .post(`${FEED}/${id}/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({})
      .expect(404);

    await request(harness.server)
      .post(`${FEED}/00000000-0000-4000-8000-000000000000/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({})
      .expect(404);

    // The stranger's row is untouched — a 404 that still wrote would be
    // worse than one that leaked.
    const row = await harness.prisma.db.notification.findUniqueOrThrow({ where: { id } });
    expect(row.archived).toBe(false);
  });

  it('rejects a non-boolean value with 422 rather than coercing it', async () => {
    const id = await seedNotification(owner.userId);

    await request(harness.server)
      .post(`${FEED}/${id}/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ value: 'yes' })
      .expect(422);
  });

  it('requires authentication', async () => {
    const id = await seedNotification(owner.userId);

    await request(harness.server).post(`${FEED}/${id}/archive`).send({}).expect(401);
  });
});

describe('clear-read — API §10.3', () => {
  it('archives read rows, leaves unread ones, and reports how many it moved', async () => {
    await seedNotification(owner.userId, { readAt: new Date() });
    await seedNotification(owner.userId, { readAt: new Date() });
    const unread = await seedNotification(owner.userId);

    const response = await request(harness.server)
      .post(`${FEED}/clear-read`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(dataOf<{ archived: number }>(response)).toEqual({ archived: 2 });
    const stillThere = await harness.prisma.db.notification.findUniqueOrThrow({
      where: { id: unread },
    });
    expect(stillThere.archived).toBe(false);
  });

  it('moves nothing twice', async () => {
    await seedNotification(owner.userId, { readAt: new Date() });

    await request(harness.server)
      .post(`${FEED}/clear-read`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const second = await request(harness.server)
      .post(`${FEED}/clear-read`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(dataOf<{ archived: number }>(second)).toEqual({ archived: 0 });
  });

  it("never touches another caller's rows", async () => {
    const theirs = await seedNotification(stranger.userId, { readAt: new Date() });

    await request(harness.server)
      .post(`${FEED}/clear-read`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const row = await harness.prisma.db.notification.findUniqueOrThrow({ where: { id: theirs } });
    expect(row.archived).toBe(false);
  });
});

describe('the feed filter and the summary — API §10.1, §10.6', () => {
  it('matches `q` against the title and the body, case-insensitively', async () => {
    await seedNotification(owner.userId, { title: 'Appointment confirmed', body: 'nothing' });
    await seedNotification(owner.userId, { title: 'Other', body: 'Analytes: Potassium' });

    const byTitle = await request(harness.server)
      .get(`${FEED}?q=appointment`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const byBody = await request(harness.server)
      .get(`${FEED}?q=POTASSIUM`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(dataOf<{ totalItems: number }>(byTitle).totalItems).toBe(1);
    expect(dataOf<{ totalItems: number }>(byBody).totalItems).toBe(1);
  });

  it('rejects an over-long filter rather than running it', async () => {
    await request(harness.server)
      .get(`${FEED}?q=${'x'.repeat(121)}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(422);
  });

  it('counts unread, critical and every category — including the zeroes', async () => {
    await seedNotification(owner.userId);
    await seedNotification(owner.userId, { category: 'APPOINTMENTS', priority: 'NORMAL' });
    await seedNotification(owner.userId, { readAt: new Date() });

    const response = await request(harness.server)
      .get(`${FEED}/summary`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const summary = dataOf<{
      unread: number;
      critical: number;
      byCategory: Record<string, number>;
    }>(response);

    expect(summary.unread).toBe(2);
    expect(summary.critical).toBe(1);
    expect(summary.byCategory.laboratory).toBe(1);
    expect(summary.byCategory.appointments).toBe(1);
    // A card that vanished at zero would make the row jump as items are read.
    expect(summary.byCategory.pharmacy).toBe(0);
    expect(Object.keys(summary.byCategory)).toHaveLength(8);
  });

  it('is scoped to the caller', async () => {
    await seedNotification(stranger.userId);

    const response = await request(harness.server)
      .get(`${FEED}/summary`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(dataOf<{ unread: number }>(response).unread).toBe(0);
  });
});

describe('preferences — API §10.5', () => {
  it('returns the column defaults for a user who never saved any', async () => {
    const response = await request(harness.server)
      .get(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(dataOf(response)).toEqual({
      channels: { email: true, sms: false, push: true, desktop: false, inApp: true },
      quietHours: { enabled: false, from: '22:00', to: '07:00' },
      categories: {
        appointments: true,
        'medical-records': true,
        laboratory: true,
        pharmacy: true,
        patients: true,
        ai: true,
        system: true,
        security: true,
      },
    });
  });

  it('round-trips a saved document', async () => {
    const saved = await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(VALID_PREFS)
      .expect(200);

    expect(dataOf(saved)).toEqual(VALID_PREFS);

    const read = await request(harness.server)
      .get(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(dataOf(read)).toEqual(VALID_PREFS);
  });

  it('saves twice without a primary-key race between two tabs', async () => {
    await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(VALID_PREFS)
      .expect(200);

    await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...VALID_PREFS, channels: { ...VALID_PREFS.channels, sms: true } })
      .expect(200);

    const row = await harness.prisma.db.notificationPreference.findUniqueOrThrow({
      where: { userId: owner.userId },
    });
    expect(row.channelSms).toBe(true);
  });

  /** M19.4's first rule, over HTTP. */
  it('answers 422 when `categories.security` is false', async () => {
    const response = await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...VALID_PREFS, categories: { ...VALID_PREFS.categories, security: false } })
      .expect(422);

    expect(errorBody(response).code).toBeDefined();
  });

  /** And the backstop, because DB §G7 holds the rule in both places. */
  it('refuses at the database as well, for a client that bypassed the route', async () => {
    await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(VALID_PREFS)
      .expect(200);

    await expect(
      harness.prisma.db.notificationPreference.update({
        where: { userId: owner.userId },
        data: { catSecurity: false },
      }),
    ).rejects.toThrow();
  });

  it('rejects a malformed quiet-hours time', async () => {
    await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...VALID_PREFS, quietHours: { enabled: true, from: '25:00', to: '07:00' } })
      .expect(422);

    await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...VALID_PREFS, quietHours: { enabled: true, from: '22:00', to: '7:0' } })
      .expect(422);
  });

  it('rejects a partial document rather than guessing the missing fields', async () => {
    await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ channels: { email: false } })
      .expect(422);
  });

  it('keeps one document per caller', async () => {
    await request(harness.server)
      .put(PREFS)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(VALID_PREFS)
      .expect(200);

    const theirs = await request(harness.server)
      .get(PREFS)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(200);

    // The stranger still sees defaults — there is no `userId` parameter
    // on this route, so there is nothing to substitute.
    expect(dataOf<{ quietHours: { enabled: boolean } }>(theirs).quietHours.enabled).toBe(false);
  });

  it('requires authentication on both verbs', async () => {
    await request(harness.server).get(PREFS).expect(401);
    await request(harness.server).put(PREFS).send(VALID_PREFS).expect(401);
  });
});
