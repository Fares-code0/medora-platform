import request from 'supertest';

import { ConfigService } from '../src/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '../src/generated/prisma/client';
import { TransactionalAuditWriter, type AuditEvent } from '../src/shared/audit';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  makeClinicalDoctor,
  markVerified,
  registrationBody,
  testEmail,
  grantPlatformAdmin,
} from './support/auth-app';


/**
 * Administrative oversight of messaging — API §9.11, RM M20.7, ADR-006.
 *
 * > ✅ Verify: content view without an active grant → 403; every granted
 * > view writes an audit row with a ref.
 *
 * Both halves are driven here, and the second is the one with teeth:
 * ADR-006 §5 requires the audit write and the content read to share a
 * transaction, "on **every** content read, not once per grant". So the
 * test reads twice and counts two audit rows.
 *
 * ## Why the grant TTL is set by this file and not by the schema
 *
 * ADR-006 §4 requires grants to expire; **RA-006.3** records that no
 * source gives a duration and that whether the 15-minute PHI-reveal
 * window suits message content "is a product question. Not decided." So
 * `COMMUNICATION_GRANT_TTL_MINUTES` has no default and the endpoint
 * fails closed without it — asserted below — while these tests supply a
 * value to exercise the mechanism.
 */
import { Secret, TOTP } from 'otpauth';

let harness: AuthHarness;

/** The same six digits the authenticator app would show. */
function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const ADMIN = '/api/v1/admin';
const PASSWORD = 'Medora123!';

interface Session {
  readonly token: string;
  readonly userId: string;
}

let adminOne: Session;
let adminTwo: Session;
let doctor: Session;
let conversationId = '';

async function signUpDoctor(local: string): Promise<Session> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at the fixture hospital (§2.6, DR-05).
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

/** ADR-035 §7's bootstrap: enrol a factor, take the role, step up. */
async function signUpAdmin(local: string, h: AuthHarness = harness): Promise<Session> {
  const email = testEmail(local);
  await request(h.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(h.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(h.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const secret = dataOf<{ secret: string }>(
    await request(h.server)
      .post('/api/v1/me/2fa/setup')
      .set('Authorization', `Bearer ${bootstrap}`)
      .send({ password: PASSWORD }),
  ).secret;

  await request(h.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await h.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await h.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });
  await grantPlatformAdmin(h.prisma, email);

  const otpToken = dataOf<{ otpToken: string }>(
    await request(h.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).otpToken;

  const token = dataOf<{ accessToken: string }>(
    await request(h.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;

  const row = await h.prisma.db.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: row.id };
}

const as = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

/**
 * `communication_access.view` rows this administrator filed since
 * `since`. By actor and time, because `audit_events` is shared by every
 * suite in the run and this file reads the same conversation repeatedly.
 *
 * Rows, not dispatcher calls: ADR-006 §5 requires the content view's
 * audit write to share the read's transaction, so it goes through
 * `TransactionalAuditWriter` and the ledger is the only place to look.
 */
function contentViewRows(session: Session, since: Date) {
  return harness.prisma.auditEvent.findMany({
    where: {
      actorId: session.userId,
      eventType: 'communication_access.view',
      occurredAt: { gte: since },
    },
  });
}

async function grantFor(session: Session, reason = 'Investigating a patient complaint about tone') {
  return request(harness.server)
    .post(`${ADMIN}/conversations/${conversationId}/access-request`)
    .set(as(session))
    .send({ justificationCategory: 'complaint', reason, password: PASSWORD });
}

beforeAll(async () => {
  harness = await createAuthHarness('msg-oversight');

  adminOne = await signUpAdmin('oversight-admin-1');
  adminTwo = await signUpAdmin('oversight-admin-2');
  doctor = await signUpDoctor('oversight-doctor');
  const other = await signUpDoctor('oversight-colleague');

  const created = await request(harness.server)
    .post('/api/v1/conversations')
    .set(as(doctor))
    .send({ participantIds: [other.userId], topic: 'Ward round' })
    .expect(201);
  conversationId = dataOf<{ id: string }>(created).id;

  await request(harness.server)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(as(doctor))
    .send({ body: 'The patient is stable this morning.' })
    .expect(201);
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.prisma.db.communicationAccessRequest.deleteMany({});
});

describe('the grant lifetime fails closed while RA-006.3 is open', () => {
  it('refuses to issue a grant when no lifetime is configured', async () => {
    // The harness boots with the schema's own defaults, and
    // `COMMUNICATION_GRANT_TTL_MINUTES` deliberately has none: ADR-006
    // requires an expiry and no source states a duration.
    const response = await grantFor(adminOne);

    expect(response.status).toBe(503);
    expect(errorBody(response).message).toContain('ADR-006');
  });

  it('still refuses the content view, so nothing is reachable meanwhile', async () => {
    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminOne))
      .expect(403);
  });
});

describe('metadata never exposes a body — API §9.11', () => {
  it('lists threads with counts and a masked MRN, and no message text', async () => {
    const response = await request(harness.server)
      .get(`${ADMIN}/conversations`)
      .set(as(adminOne))
      .expect(200);

    const serialised = JSON.stringify(dataOf(response));

    expect(serialised).not.toContain('The patient is stable this morning.');
    expect(serialised).toContain('"messageCount"');
  });

  /**
   * The three capabilities are genuinely separate, and the seeded matrix
   * proves it rather than the controller asserting it: `doctor` holds
   * `communications.viewMetadata` (`prisma/seed/permissions.ts`) and
   * neither `viewContent` nor `resolveFlags`. So a doctor reaches the
   * metadata list — which is what the contract marks §9.11's first route
   * — and is refused the other two. Guarding this controller with one
   * capability would have collapsed that separation, and this is the
   * test that would have caught it.
   */
  it('lets a doctor see metadata but never content or the flags queue', async () => {
    await request(harness.server).get(`${ADMIN}/conversations`).set(as(doctor)).expect(200);

    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(doctor))
      .expect(403);

    await request(harness.server).get(`${ADMIN}/message-flags`).set(as(doctor)).expect(403);
  });

  it('requires authentication', async () => {
    await request(harness.server).get(`${ADMIN}/conversations`).expect(401);
  });
});

describe('the content gate — M20.7 verify', () => {
  /**
   * A grant, made directly so the suite exercises the gate rather than
   * the unset-TTL refusal. This is the shape the endpoint writes when a
   * lifetime is configured.
   */
  async function issueGrant(
    session: Session,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const ref = `CAR-TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const now = new Date();

    await harness.prisma.db.communicationAccessRequest.create({
      data: {
        conversationId,
        requestedBy: session.userId,
        justificationCategory: 'patient_complaint',
        reason: 'Investigating a patient complaint about tone',
        status: 'approved',
        grantedAt: now,
        expiresAt: new Date(now.getTime() + 15 * 60_000),
        accessRef: ref,
        ...overrides,
      },
    });

    return ref;
  }

  it('answers 403 without an active grant', async () => {
    const response = await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminOne))
      .expect(403);

    expect(errorBody(response).code).toBe('grant_required');
  });

  it('returns the content with an active grant, watermarked and read-only', async () => {
    const ref = await issueGrant(adminOne);

    const response = await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminOne))
      .expect(200);

    const view = dataOf<{
      accessRef: string;
      readOnly: boolean;
      watermark: string;
      messages: { body: string }[];
    }>(response);

    expect(view.accessRef).toBe(ref);
    expect(view.readOnly).toBe(true);
    expect(view.watermark).toContain(ref);
    expect(view.messages[0]?.body).toBe('The patient is stable this morning.');
  });

  /** ADR-006 §5: on **every** read, not once per grant. */
  it('writes one audit row carrying the ref, on every read', async () => {
    const ref = await issueGrant(adminOne);
    const since = new Date();

    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminOne))
      .expect(200);
    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminOne))
      .expect(200);

    const rows = await contentViewRows(adminOne, since);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.payload).toMatchObject({ accessRef: ref });
    expect(rows[0]?.target).toBe(`conversation:${conversationId}`);
    expect(rows[0]?.category).toBe('SECURITY');
  });

  it('treats an expired grant as no grant', async () => {
    await issueGrant(adminOne, {
      grantedAt: new Date(Date.now() - 60 * 60_000),
      expiresAt: new Date(Date.now() - 30 * 60_000),
    });

    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminOne))
      .expect(403);
  });

  it('treats a denied or terminated grant as no grant', async () => {
    await issueGrant(adminOne, { status: 'denied' });

    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminOne))
      .expect(403);
  });

  it('does not lend one administrator’s grant to another', async () => {
    await issueGrant(adminOne);

    // The grant is per administrator: ADR-006's control is that *this*
    // person justified *this* access.
    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminTwo))
      .expect(403);
  });

  it('refuses a doctor holding no content capability, grant or not', async () => {
    await issueGrant(adminOne);

    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(doctor))
      .expect(403);
  });

  it('writes no audit row when the gate refuses', async () => {
    const since = new Date();

    await request(harness.server)
      .get(`${ADMIN}/conversations/${conversationId}/content`)
      .set(as(adminOne))
      .expect(403);

    expect(await contentViewRows(adminOne, since)).toHaveLength(0);
  });

  /**
   * ADR-006 §5's consequence, driven: "if the audit write fails, no
   * content is returned". An earlier revision wrote the row through the
   * dispatcher inside the transaction callback, which neither joined the
   * transaction nor surfaced a failure — so this case answered 200 with
   * the bodies.
   *
   * The real writer on the real transaction, handed an event Postgres
   * rejects (`session_id` is a uuid column), so the insert, its failure,
   * the rollback and the response are all the production path.
   */
  it('returns no content, and a 503, when the ledger refuses the row', async () => {
    class RefusedByPostgres extends TransactionalAuditWriter {
      override recordWithin(tx: Prisma.TransactionClient, event: AuditEvent): Promise<void> {
        return super.recordWithin(tx, {
          ...event,
          actor: { ...event.actor, sessionId: 'not-a-uuid' },
        });
      }
    }

    const failing = await createAuthHarness('msg-oversight-fail', {
      overrides: [{ token: TransactionalAuditWriter, value: new RefusedByPostgres() }],
    });

    let admin: Session | undefined;

    try {
      admin = await signUpAdmin('oversight-fail-admin', failing);
      await issueGrant(admin);
      const since = new Date();

      const response = await request(failing.server)
        .get(`${ADMIN}/conversations/${conversationId}/content`)
        .set(as(admin));

      expect(response.status, JSON.stringify(response.body)).toBe(503);
      expect(errorBody(response).code).toBe('audit_unavailable');
      expect(JSON.stringify(response.body)).not.toContain('The patient is stable');
      expect(await contentViewRows(admin, since)).toHaveLength(0);
    } finally {
      // The grant references the account `reset()` is about to delete.
      if (admin !== undefined) {
        await harness.prisma.db.communicationAccessRequest.deleteMany({
          where: { requestedBy: admin.userId },
        });
      }
      await failing.reset();
      await failing.close();
    }
  });
});

describe('approval is never self-approval', () => {
  it('refuses the requester approving their own request', async () => {
    const created = await harness.prisma.db.communicationAccessRequest.create({
      data: {
        conversationId,
        requestedBy: adminOne.userId,
        justificationCategory: 'safety_flag',
        reason: 'Reviewing a safety flag raised on this thread',
        status: 'pending',
        accessRef: `CAR-SELF-${Date.now().toString(36)}`,
      },
      select: { id: true },
    });

    // A self-approved grant is not a second pair of eyes, and ADR-006
    // enforces this "regardless of which default is chosen".
    await request(harness.server)
      .post(`${ADMIN}/conversations/access-requests/${created.id}/approve`)
      .set(as(adminOne))
      .expect(403);
  });

  it('answers 404 for an unknown request', async () => {
    await request(harness.server)
      .post(`${ADMIN}/conversations/access-requests/00000000-0000-4000-8000-000000000000/approve`)
      .set(as(adminTwo))
      .expect(404);
  });
});

describe('F-12 — content access under the Exceptional Access model', () => {
  let configured: AuthHarness;
  let requester: Session;
  let approver: Session;

  beforeAll(async () => {
    // A lifetime configured, and the self-serve mode ADR-006 allowed turned
    // on: F-12 holds approval mandatory regardless. The environment is
    // parsed once per process, so the settings ride on a ConfigService
    // whose `env` carries them.
    const base = harness.app.get(ConfigService);
    const env = { ...base.env, COMMUNICATION_GRANT_TTL_MINUTES: 15, COMMUNICATION_REQUIRE_SECOND_ADMIN_APPROVAL: false };
    const patched = Object.create(base, { env: { value: env } }) as ConfigService;
    configured = await createAuthHarness('msg-oversight-f12', {
      overrides: [{ token: ConfigService, value: patched }],
    });
    requester = await signUpAdmin('oversight-f12-requester', configured);
    approver = await signUpAdmin('oversight-f12-approver', configured);
  }, 120_000);

  afterAll(async () => {
    if (configured === undefined) return;
    await configured.prisma.db.communicationAccessRequest.deleteMany({
      where: { requestedBy: { in: [requester?.userId ?? '', approver?.userId ?? ''] } },
    });
    await configured.reset();
    await configured.close();
  });

  const ask = (session: Session, password: string) =>
    request(configured.server)
      .post(`${ADMIN}/conversations/${conversationId}/access-request`)
      .set(as(session))
      .send({ justificationCategory: 'safety', reason: 'Reviewing a reported safety concern', password });
  const content = (session: Session) =>
    request(configured.server).get(`${ADMIN}/conversations/${conversationId}/content`).set(as(session));

  it('re-authenticates the requester: a wrong password creates nothing', async () => {
    const before = await configured.prisma.db.communicationAccessRequest.count({
      where: { requestedBy: requester.userId },
    });
    expect((await ask(requester, 'not-the-password')).status).toBe(401);
    await expect(
      configured.prisma.db.communicationAccessRequest.count({ where: { requestedBy: requester.userId } }),
    ).resolves.toBe(before);
  });

  it('always waits for an independent approval, then ends at once when revoked', async () => {
    const created = await ask(requester, PASSWORD);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const grant = dataOf<{ id: string; status: string }>(created);
    expect(grant.status).toBe('pending');
    expect((await content(requester)).status).toBe(403);

    // Never the requester; another administrator approves.
    await request(configured.server)
      .post(`${ADMIN}/conversations/access-requests/${grant.id}/approve`)
      .set(as(requester))
      .expect(403);
    await request(configured.server)
      .post(`${ADMIN}/conversations/access-requests/${grant.id}/approve`)
      .set(as(approver))
      .expect(201);
    expect((await content(requester)).status).toBe(200);

    // Revocation ends it, and is audited.
    const revoked = await request(configured.server)
      .post(`${ADMIN}/conversations/access-requests/${grant.id}/revoke`)
      .set(as(approver));
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(201);
    expect((await content(requester)).status).toBe(403);
    await request(configured.server)
      .post(`${ADMIN}/conversations/access-requests/${grant.id}/revoke`)
      .set(as(approver))
      .expect(409);
    await expect(
      configured.prisma.auditEvent.count({
        where: { eventType: 'communication_access.revoke', actorId: approver.userId },
      }),
    ).resolves.toBe(1);
  });
});

describe('request validation', () => {
  it('rejects a justification outside the contract vocabulary', async () => {
    await request(harness.server)
      .post(`${ADMIN}/conversations/${conversationId}/access-request`)
      .set(as(adminOne))
      .send({ justificationCategory: 'curiosity', reason: 'I would just like to look at it' })
      .expect(422);
  });

  it('rejects an empty or token reason', async () => {
    await request(harness.server)
      .post(`${ADMIN}/conversations/${conversationId}/access-request`)
      .set(as(adminOne))
      .send({ justificationCategory: 'legal', reason: 'x' })
      .expect(422);
  });

  it('answers 404 for a conversation that does not exist', async () => {
    await request(harness.server)
      .post(`${ADMIN}/conversations/00000000-0000-4000-8000-000000000000/access-request`)
      .set(as(adminOne))
      .send({ justificationCategory: 'audit', reason: 'Quarterly quality audit of this thread', password: PASSWORD })
      .expect(404);
  });
});

describe('the safety-flags queue', () => {
  async function seedFlag(status = 'open'): Promise<string> {
    const message = await harness.prisma.db.message.findFirstOrThrow({
      where: { conversationId },
      select: { id: true },
    });

    const flag = await harness.prisma.db.messageFlag.create({
      data: {
        messageId: message.id,
        category: 'emergency_language',
        source: 'auto',
        excerpt: 'chest pain right now',
        status,
        // `message_flags_resolution_complete` is an equivalence: a
        // resolved flag names its outcome and when, an unresolved one
        // names neither. A half-resolved row would sit in both queues.
        ...(status === 'resolved'
          ? { resolution: 'dismissed', resolvedAt: new Date(), resolvedBy: adminOne.userId }
          : {}),
      },
      select: { id: true },
    });

    return flag.id;
  }

  beforeEach(async () => {
    await harness.prisma.db.messageFlag.deleteMany({});
  });

  it('lists flags and filters by status', async () => {
    await seedFlag('open');
    await seedFlag('resolved');

    const open = await request(harness.server)
      .get(`${ADMIN}/message-flags?status=open`)
      .set(as(adminOne))
      .expect(200);

    expect(dataOf<{ totalItems: number }>(open).totalItems).toBe(1);
  });

  it('resolves a flag and records who and why', async () => {
    const flagId = await seedFlag();

    await request(harness.server)
      .post(`${ADMIN}/message-flags/${flagId}/resolve`)
      .set(as(adminOne))
      .send({ resolution: 'dismissed', note: 'Clinically appropriate phrasing in context.' })
      .expect(201);

    const row = await harness.prisma.db.messageFlag.findUniqueOrThrow({ where: { id: flagId } });

    expect(row.status).toBe('resolved');
    expect(row.resolution).toBe('dismissed');
    expect(row.resolvedBy).toBe(adminOne.userId);
    expect(row.resolvedAt).not.toBeNull();
  });

  it('refuses a second resolution with 409 rather than overwriting the note', async () => {
    const flagId = await seedFlag();

    await request(harness.server)
      .post(`${ADMIN}/message-flags/${flagId}/resolve`)
      .set(as(adminOne))
      .send({ resolution: 'warned', note: 'Spoke with the author.' })
      .expect(201);

    await request(harness.server)
      .post(`${ADMIN}/message-flags/${flagId}/resolve`)
      .set(as(adminTwo))
      .send({ resolution: 'dismissed', note: 'Disagree with the first call.' })
      .expect(409);

    const row = await harness.prisma.db.messageFlag.findUniqueOrThrow({ where: { id: flagId } });
    expect(row.resolutionNote).toBe('Spoke with the author.');
  });

  it('requires a note — P4', async () => {
    const flagId = await seedFlag();

    await request(harness.server)
      .post(`${ADMIN}/message-flags/${flagId}/resolve`)
      .set(as(adminOne))
      .send({ resolution: 'dismissed' })
      .expect(422);
  });

  it('refuses a doctor without the capability', async () => {
    await request(harness.server).get(`${ADMIN}/message-flags`).set(as(doctor)).expect(403);
  });
});
