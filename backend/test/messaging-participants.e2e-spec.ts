import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  fixtureHospital,
  grantPlatformAdmin,
  makeClinicalDoctor,
  makeClinicalStaff,
  markVerified,
  patientRegistrationBody,
  recordPatientAt,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * MSG-01 — who a thread may name (checklist F1, multi-hospital AF-16).
 *
 * Every participant must be an active account with standing **in the
 * caller's hospital**: a doctor employed there, a staff member affiliated
 * there, or that hospital's administrator. A patient account, a Platform
 * Admin, an ended employment and any other hospital's staff are refused
 * with the same count-only 422 an unknown id gets, so the answer reveals
 * neither which ids exist nor where they work. A patient-tagged thread
 * belongs to the hospital of the patient's record, and its members must
 * stand there too.
 */
let harness: AuthHarness;

const API = '/api/v1';
const CONV = `${API}/conversations`;
const PASSWORD = 'Medora123!';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

interface Session {
  readonly token: string;
  readonly userId: string;
}

let hospitalA = '';
let hospitalB = '';

let caller: Session; // doctor at A
let colleague: string; // doctor at A
let foreignDoctor: string; // doctor at B
let terminated: string; // doctor whose employment at A ended
let patientAccount: string; // patient user
let platformAdmin: string; // admin with a platform grant
let hospitalAdminA: string; // admin assigned to A
let hospitalAdminB: string; // admin assigned to B
let receptionA: Session; // staff at A
let pharmacyB: string; // staff at B
let patientId = ''; // patients.id of a test record held at A

const as = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

async function idOf(email: string): Promise<string> {
  return (
    await harness.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
  ).id;
}

async function signIn(email: string): Promise<Session> {
  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(`${API}/auth/login`)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  return { token, userId: await idOf(email) };
}

async function register(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(`${API}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return email;
}

async function doctorAt(local: string, hospitalId: string): Promise<string> {
  const email = await register(local);
  await makeClinicalDoctor(harness.prisma, email, hospitalId);
  return email;
}

async function withRole(email: string, code: string): Promise<void> {
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: role.id } });
}

async function staffAt(local: string, code: string, hospitalId: string): Promise<string> {
  const email = await register(local);
  await withRole(email, code);
  await makeClinicalStaff(harness.prisma, email, hospitalId);
  return email;
}

async function hospitalAdminAt(local: string, hospitalId: string): Promise<string> {
  const email = await register(local);
  await withRole(email, 'admin');
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.hospitalRoleAssignment.create({
    data: { userId: await idOf(email), hospitalId, roleId: role.id },
  });
  return email;
}

function open(session: Session, body: Record<string, unknown>) {
  return request(harness.server).post(CONV).set(as(session)).send(body);
}

/** The refusal an unknown id gets — every refused participant must match it. */
async function expectNotFound(session: Session, body: Record<string, unknown>): Promise<void> {
  const refused = await open(session, body);
  const unknown = await open(session, { participantIds: [UNKNOWN] });

  expect(refused.status, JSON.stringify(refused.body)).toBe(422);
  expect(unknown.status).toBe(422);
  expect(refused.body).toEqual(unknown.body);
}

async function ownUserIds(): Promise<string[]> {
  const rows = await harness.prisma.user.findMany({
    where: { email: { startsWith: 'msgpart-', endsWith: `@${harness.domain}` } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function cleanUp(): Promise<void> {
  const ours = await ownUserIds();
  await harness.prisma.conversation.deleteMany({
    where: { participants: { some: { userId: { in: ours } } } },
  });
  await harness.prisma.hospitalRoleAssignment.deleteMany({ where: { userId: { in: ours } } });
  await destroyPatientRecords(harness.prisma, 'MSGP');
}

async function removeStaffRows(): Promise<void> {
  await harness.prisma.staffMember.deleteMany({
    where: { email: { endsWith: `@${harness.domain}` }, userId: null },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('messaging-participants');
  await removeStaffRows();
  hospitalA = await fixtureHospital(harness.prisma);
  hospitalB = await fixtureHospital(harness.prisma, 'b');

  caller = await signIn(await doctorAt('msgpart-caller', hospitalA));
  colleague = await idOf(await doctorAt('msgpart-colleague', hospitalA));
  foreignDoctor = await idOf(await doctorAt('msgpart-foreign', hospitalB));

  const terminatedEmail = await doctorAt('msgpart-terminated', hospitalA);
  terminated = await idOf(terminatedEmail);
  await harness.prisma.doctorEmployment.updateMany({
    where: { doctor: { userId: terminated }, endedAt: null },
    data: { endedAt: new Date() },
  });

  const patientEmail = testEmail('msgpart-patient');
  await request(harness.server)
    .post(`${API}/auth/register`)
    .send(patientRegistrationBody({ email: patientEmail }));
  await markVerified(harness.prisma, patientEmail);
  patientAccount = await idOf(patientEmail);
  const [record] = await createPatientRecords(harness.prisma, 'MSGP', 1);
  if (record === undefined) throw new Error('no patient record');
  patientId = record.id;
  await recordPatientAt(harness.prisma, patientId, hospitalA);

  const platformEmail = await register('msgpart-platform');
  await withRole(platformEmail, 'admin');
  await grantPlatformAdmin(harness.prisma, platformEmail);
  platformAdmin = await idOf(platformEmail);

  hospitalAdminA = await idOf(await hospitalAdminAt('msgpart-admin-a', hospitalA));
  hospitalAdminB = await idOf(await hospitalAdminAt('msgpart-admin-b', hospitalB));

  receptionA = await signIn(await staffAt('msgpart-reception', 'reception', hospitalA));
  pharmacyB = await idOf(await staffAt('msgpart-pharmacy', 'pharmacy', hospitalB));
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;
  await cleanUp();
  await harness.reset();
  await removeStaffRows();
  await harness.close();
});

describe('MSG-01 — participants must stand in the caller’s hospital', () => {
  it('admits a doctor employed at the caller’s hospital', async () => {
    const response = await open(caller, { participantIds: [colleague], topic: 'Same hospital' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  });

  it('admits that hospital’s staff and its administrator', async () => {
    const response = await open(caller, {
      participantIds: [colleague, receptionA.userId, hospitalAdminA],
      topic: 'Ward team',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  });

  it('refuses a doctor employed at another hospital', async () => {
    await expectNotFound(caller, { participantIds: [foreignDoctor] });
  });

  it('refuses the whole thread when one participant is foreign', async () => {
    await expectNotFound(caller, { participantIds: [colleague, foreignDoctor] });
  });

  it('refuses a patient account', async () => {
    await expectNotFound(caller, { participantIds: [patientAccount] });
  });

  it('refuses a doctor whose employment has ended', async () => {
    await expectNotFound(caller, { participantIds: [terminated] });
  });

  it('refuses a Platform Admin', async () => {
    await expectNotFound(caller, { participantIds: [platformAdmin] });
  });

  it('refuses another hospital’s administrator and staff', async () => {
    await expectNotFound(caller, { participantIds: [hospitalAdminB] });
    await expectNotFound(caller, { participantIds: [pharmacyB] });
  });

  it('applies the same rule to a staff caller', async () => {
    const admitted = await open(receptionA, { participantIds: [colleague], topic: 'Front desk' });
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);

    await expectNotFound(receptionA, { participantIds: [foreignDoctor] });
  });

  it('refuses every participant for a caller whose own standing has ended', async () => {
    const leaver = await signIn(await staffAt('msgpart-leaver', 'reception', hospitalA));
    await open(leaver, { participantIds: [colleague], topic: 'Before' }).expect(201);

    await harness.prisma.hospitalStaffAffiliation.updateMany({
      where: { staff: { userId: leaver.userId }, endedAt: null },
      data: { endedAt: new Date() },
    });

    // The guard refuses first (clinical standing is re-read per request);
    // the service would answer 422 behind it, never 201.
    const refused = await open(leaver, { participantIds: [colleague] });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
  });
});

describe('MSG-01 — a patient-tagged thread', () => {
  it('is created when every participant stands at the record’s hospital', async () => {
    const response = await open(caller, { participantIds: [colleague], patientId, topic: 'Case' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const row = await harness.prisma.conversation.findUniqueOrThrow({
      where: { id: dataOf<{ id: string }>(response).id },
      select: { hospitalId: true, patientId: true },
    });
    expect(row).toEqual({ hospitalId: hospitalA, patientId });
  });

  it('is refused when a participant stands at another hospital', async () => {
    await expectNotFound(caller, { participantIds: [colleague, foreignDoctor], patientId });
  });
});
