import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * BR-DEC-006 part 4 — staff messaging for the reception, laboratory and
 * pharmacy roles (DEC-006, accepted 2026-10-21).
 *
 * The requirement page recorded part 4 as **implementation present but
 * not verified**: `/conversations` is `@Can('messages.send')` and all three
 * seeded bundles hold it, but no test signed in as any of them. This file
 * is that test. Each role opens a thread with a doctor, writes, is read,
 * reads the reply, and finds the thread in its list — over HTTP, as the
 * role, with no doctor profile involved.
 *
 * Membership is asserted as well as reachability, because the capability
 * is only half of the rule: a staff account outside a thread gets the
 * same 404 as for a thread that does not exist (ADR-022).
 *
 * **Not decided here, and not tested as if it were:** the staff
 * participant rule (API-W09 — whom a reception account may open a thread
 * with) and hospital scoping (multi-hospital AF-16). Today any holder of
 * `messages.send` may address any active account; this suite asserts the
 * roles can use messaging, not that the participant set is right.
 */
let harness: AuthHarness;

const API = '/api/v1';
const CONV = `${API}/conversations`;
const PASSWORD = 'Medora123!';

const STAFF_ROLES = ['reception', 'laboratory', 'pharmacy'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

interface Session {
  readonly token: string;
  readonly userId: string;
}

let doctor: Session;
let outsider: Session;
const staff = new Map<StaffRole, Session>();

const as = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

async function signIn(email: string): Promise<Session> {
  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(`${API}/auth/login`)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  const row = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: row.id };
}

/**
 * A staff account. Registration offers doctor and patient only, and the
 * supported provisioning path for these roles is the administrator
 * invitation (ADR-035 §5); here the role is set on the row, which is what
 * that flow ends in, without driving a second suite's subject.
 */
async function signUp(local: string, role?: StaffRole): Promise<Session> {
  const email = testEmail(local);
  await request(harness.server).post(`${API}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  if (role !== undefined) {
    const roleRow = await harness.prisma.role.findUniqueOrThrow({ where: { code: role } });
    await harness.prisma.user.update({ where: { email }, data: { roleId: roleRow.id } });
  }

  return signIn(email);
}

function staffSession(role: StaffRole): Session {
  const session = staff.get(role);
  if (session === undefined) throw new Error(`no ${role} session`);
  return session;
}

/** Conversations any of this suite's accounts is in — never anyone else's. */
async function removeOwnThreads(): Promise<void> {
  const ours = [doctor, outsider, ...staff.values()]
    .filter((session) => session !== undefined)
    .map((session) => session.userId);

  await harness.prisma.conversation.deleteMany({
    where: { participants: { some: { userId: { in: ours } } } },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('messaging-staff-roles');

  doctor = await signUp('staffmsg-doctor');
  outsider = await signUp('staffmsg-outsider', 'reception');
  for (const role of STAFF_ROLES) staff.set(role, await signUp(`staffmsg-${role}`, role));
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  // Threads first: a message's author is a user, and the accounts go next.
  await removeOwnThreads();
  await harness.reset();
  await harness.close();
});

describe.each(STAFF_ROLES)('BR-DEC-006 part 4 — %s messages a doctor', (role) => {
  let conversationId = '';

  it('opens a thread with a doctor', async () => {
    const response = await request(harness.server)
      .post(CONV)
      .set(as(staffSession(role)))
      .send({ participantIds: [doctor.userId], topic: `From ${role}` });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    conversationId = dataOf<{ id: string }>(response).id;
  });

  it('writes in it, and the doctor reads it', async () => {
    const sent = await request(harness.server)
      .post(`${CONV}/${conversationId}/messages`)
      .set(as(staffSession(role)))
      .send({ body: `Question from ${role}` });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);

    const thread = await request(harness.server)
      .get(`${CONV}/${conversationId}/messages`)
      .set(as(doctor));
    expect(thread.status).toBe(200);
    expect(dataOf<{ items: { body: string }[] }>(thread).items.map((m) => m.body)).toContain(
      `Question from ${role}`,
    );
  });

  it('reads the doctor’s reply, and finds the thread in its own list', async () => {
    await request(harness.server)
      .post(`${CONV}/${conversationId}/messages`)
      .set(as(doctor))
      .send({ body: `Reply to ${role}` })
      .expect(201);

    const thread = await request(harness.server)
      .get(`${CONV}/${conversationId}/messages`)
      .set(as(staffSession(role)));
    expect(thread.status).toBe(200);
    expect(dataOf<{ items: { body: string }[] }>(thread).items.map((m) => m.body)).toContain(
      `Reply to ${role}`,
    );

    const list = await request(harness.server)
      .get(CONV)
      .set(as(staffSession(role)));
    expect(list.status).toBe(200);
    const ids = dataOf<{ items: { id: string }[] }>(list).items.map((item) => item.id);
    expect(ids).toContain(conversationId);
  });

  it('does not open the thread to a staff account outside it', async () => {
    const theirs = await request(harness.server)
      .get(`${CONV}/${conversationId}/messages`)
      .set(as(outsider));
    const missing = await request(harness.server)
      .get(`${CONV}/00000000-0000-4000-8000-000000000000/messages`)
      .set(as(outsider));

    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(missing.body);
  });
});

describe('BR-DEC-006 part 4 — the capability is what admits them', () => {
  it('refuses a patient account, which holds no messages.send', async () => {
    const email = testEmail('staffmsg-patient');
    await request(harness.server)
      .post(`${API}/auth/register`)
      .send(patientRegistrationBody({ email }));
    await markVerified(harness.prisma, email);
    const patient = await signIn(email);

    const response = await request(harness.server).get(CONV).set(as(patient));
    expect(response.status).toBe(403);
  });

  it('refuses a staff account whose messages.send was revoked', async () => {
    const email = testEmail('staffmsg-revoked');
    await request(harness.server).post(`${API}/auth/register`).send(registrationBody({ email }));
    await markVerified(harness.prisma, email);

    const [user, pharmacyRole, permission] = await Promise.all([
      harness.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } }),
      harness.prisma.role.findUniqueOrThrow({ where: { code: 'pharmacy' } }),
      harness.prisma.permission.findUniqueOrThrow({ where: { code: 'messages.send' } }),
    ]);
    await harness.prisma.user.update({ where: { id: user.id }, data: { roleId: pharmacyRole.id } });

    // The override row API §15.5 writes, written directly so this suite
    // needs no administrator with a second factor — and before the first
    // sign-in, so no cached permission set predates it.
    await harness.prisma.userPermission.create({
      data: { userId: user.id, permissionId: permission.id, allowed: false },
    });

    const response = await request(harness.server)
      .get(CONV)
      .set(as(await signIn(email)));
    expect(response.status).toBe(403);
  });
});
