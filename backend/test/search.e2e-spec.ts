import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { assignOwned } from './support/hospital-fixture';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * Global search — API §16.1, RM M26.
 *
 * > ✅ Verify (M26.1): care-scoping holds (no other doctor's patients in
 * > results).
 * > ✅ Verify (M26.2): "backup" finds the Backup settings panel.
 *
 * The care-scoping test is written the way that catches a regression
 * rather than the way that passes: two doctors, one patient each, and
 * **both directions** asserted. A test that only checked "I find mine"
 * would pass against an implementation with no scoping at all.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const SEARCH = '/api/v1/search';
const PASSWORD = 'Medora123!';

let mineToken = '';
let theirsToken = '';
let adminToken = '';
let patientToken = '';

let minePatient = { id: '', publicId: '' };
let theirsPatient = { id: '', publicId: '' };
let myAppointmentId = '';
let myRecordId = '';

const TAG = 's26';
const UNIQUE = 'Zarqawi';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Group {
  readonly key: string;
  readonly label: string;
  readonly results: { id: string; label: string; hint: string; section: string; path: string }[];
}

interface Response {
  readonly query: string;
  readonly scope: string;
  readonly groups: Group[];
  readonly totalItems: number;
}

async function search(token: string, query: string): Promise<Response> {
  return dataOf<Response>(await request(harness.server).get(`${SEARCH}?${query}`).set(as(token)));
}

const groupOf = (response: Response, key: string): Group['results'] =>
  response.groups.find((group) => group.key === key)?.results ?? [];

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function signUpDoctor(local: string): Promise<{ token: string; doctorId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });

  return { token, doctorId: doctor.id };
}

async function signUpAdmin(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const secret = dataOf<{ secret: string }>(
    await request(harness.server)
      .post('/api/v1/me/2fa/setup')
      .set(as(bootstrap))
      .send({ password: PASSWORD }),
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
  harness = await createAuthHarness('search-m26', { clinicalDoctors: true });

  const mine = await signUpDoctor('search-mine');
  const theirs = await signUpDoctor('search-theirs');
  mineToken = mine.token;
  theirsToken = theirs.token;
  adminToken = await signUpAdmin('search-admin');

  const patientEmail = testEmail('search-patient');
  await request(harness.server)
    .post(REGISTER)
    .send(patientRegistrationBody({ email: patientEmail }));
  await markVerified(harness.prisma, patientEmail);
  patientToken = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email: patientEmail, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const [first, second] = await createPatientRecords(harness.prisma, TAG, 2);
  minePatient = { id: first?.id ?? '', publicId: first?.publicId ?? '' };
  theirsPatient = { id: second?.id ?? '', publicId: second?.publicId ?? '' };

  // Both patients carry the same distinctive surname, so a query for it
  // matches two rows in the database and must return exactly one to each
  // doctor. A test where only one patient matched would pass against no
  // scoping at all.
  await harness.prisma.patient.update({
    where: { id: minePatient.id },
    data: { fullName: `Mine ${UNIQUE}` },
  });
  await harness.prisma.patient.update({
    where: { id: theirsPatient.id },
    data: { fullName: `Theirs ${UNIQUE}` },
  });

  // Owned by each doctor's employment at the suite's hospital (S3/S4).
  const care = await assignOwned(harness.prisma, {
    patientId: minePatient.id,
    doctorId: mine.doctorId,
    role: 'primary',
  });
  await assignOwned(harness.prisma, {
    patientId: theirsPatient.id,
    doctorId: theirs.doctorId,
    role: 'primary',
  });

  const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });

  const appointment = await harness.prisma.appointment.create({
    data: {
      publicId: `APT-T${TAG}1`,
      patientId: minePatient.id,
      doctorId: mine.doctorId,
      visitTypeId: visitType.id,
      startsAt: new Date('2026-09-20T09:00:00Z'),
      reason: `${UNIQUE} follow-up`,
      ...care,
    },
    select: { publicId: true },
  });
  myAppointmentId = appointment.publicId;

  const record = await harness.prisma.medicalRecord.create({
    data: {
      publicId: `MR-T${TAG}1`,
      patientId: minePatient.id,
      doctorId: mine.doctorId,
      visitDate: new Date('2026-09-10T09:00:00Z'),
      visitType: 'Consultation',
      chiefComplaint: `${UNIQUE} shoulder pain`,
      historyOfPresentIllness: 'n/a',
      physicalExamination: 'n/a',
      ...care,
    },
    select: { publicId: true },
  });
  myRecordId = record.publicId;
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.medicalRecord.deleteMany({
    where: { publicId: { startsWith: `MR-T${TAG}` } },
  });
  await harness.prisma.appointment.deleteMany({
    where: { publicId: { startsWith: `APT-T${TAG}` } },
  });
  await harness.prisma.patientDoctorAssignment.deleteMany({
    where: { patientId: { in: [minePatient.id, theirsPatient.id] } },
  });
  await destroyPatientRecords(harness.prisma, TAG);

  await harness.reset();
  await harness.close();
});

describe('the endpoint itself', () => {
  it('requires authentication', async () => {
    await request(harness.server).get(`${SEARCH}?q=ward`).expect(401);
  });

  it('refuses a one-character query rather than scanning for it', async () => {
    const response = await request(harness.server).get(`${SEARCH}?q=a`).set(as(mineToken));

    // The same bound messaging's own search already enforces, so a
    // client does not have to learn two rules.
    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['q']).toBeDefined();
  });

  it('refuses a role with no index rather than answering "no matches"', async () => {
    const response = await request(harness.server).get(`${SEARCH}?q=ward`).set(as(patientToken));

    // An empty result would say the feature works and found nothing,
    // which is a different and untrue statement.
    expect(response.status).toBe(403);
  });
});

describe('M26.1 — the doctor scope is the doctor’s own panel', () => {
  it('finds a patient on the caller’s panel by name', async () => {
    const results = groupOf(await search(mineToken, `q=${UNIQUE}`), 'patients');

    expect(results).toHaveLength(1);
    expect(results[0]?.label).toBe(`Mine ${UNIQUE}`);
    expect(results[0]?.path).toBe(`/doctor/patients/${minePatient.publicId}`);
    expect(results[0]?.section).toBe('patients');
  });

  it('never returns another doctor’s patient — in either direction', async () => {
    // The same query, run by both doctors. Two rows match it in the
    // database; each caller must see exactly their own.
    const mine = groupOf(await search(mineToken, `q=${UNIQUE}`), 'patients');
    const theirs = groupOf(await search(theirsToken, `q=${UNIQUE}`), 'patients');

    expect(mine.map((row) => row.label)).toEqual([`Mine ${UNIQUE}`]);
    expect(theirs.map((row) => row.label)).toEqual([`Theirs ${UNIQUE}`]);
  });

  it('matches on MRN and on the PT- handle', async () => {
    const patient = await harness.prisma.patient.findUniqueOrThrow({
      where: { id: minePatient.id },
      select: { mrn: true },
    });

    // An MRN is what a clinician reads off a wristband or a requisition,
    // and it is not on screen to copy from.
    expect(groupOf(await search(mineToken, `q=${patient.mrn}`), 'patients')).toHaveLength(1);
    expect(groupOf(await search(mineToken, `q=${minePatient.publicId}`), 'patients')).toHaveLength(
      1,
    );
  });

  it('carries the clear MRN, which this doctor already sees on their roster', async () => {
    const patient = await harness.prisma.patient.findUniqueOrThrow({
      where: { id: minePatient.id },
      select: { mrn: true },
    });
    const results = groupOf(await search(mineToken, `q=${UNIQUE}`), 'patients');

    // Masking it here while `GET /patients` shows it one route away
    // would protect nothing and would make the hint useless for the
    // thing a hint is for.
    expect(results[0]?.hint).toBe(`Patient · MRN ${patient.mrn}`);
  });

  it('finds the caller’s own appointments and records', async () => {
    const response = await search(mineToken, `q=${UNIQUE}`);

    expect(groupOf(response, 'appointments').map((row) => row.path)).toEqual([
      `/doctor/appointments/${myAppointmentId}`,
    ]);
    expect(groupOf(response, 'records').map((row) => row.path)).toEqual([
      `/doctor/medical-records/${myRecordId}`,
    ]);
  });

  it('does not show another doctor’s encounters for a patient they share', async () => {
    const response = await search(theirsToken, `q=${UNIQUE}`);

    expect(groupOf(response, 'appointments')).toHaveLength(0);
    expect(groupOf(response, 'records')).toHaveLength(0);
  });

  it('returns every group even when one matched nothing', async () => {
    const response = await search(mineToken, 'q=zzzzznothing');

    // A client cannot tell "no patients matched" from "patients were not
    // searched" out of a missing key.
    expect(response.groups.map((group) => group.key)).toEqual([
      'patients',
      'appointments',
      'records',
      'destinations',
    ]);
    expect(response.totalItems).toBe(0);
  });

  it('offers the shell’s own destinations, so ⌘K is a command palette', async () => {
    const results = groupOf(await search(mineToken, 'q=pharmacy'), 'destinations');

    expect(results.map((row) => row.path)).toContain('/doctor/pharmacy');
  });

  it('ignores a scope the caller does not hold rather than honouring it', async () => {
    const response = await search(mineToken, `q=${UNIQUE}&scope=admin`);

    // A query parameter that widened authorization would be the whole of
    // the bug. The answer is the caller's own scope.
    expect(response.scope).toBe('doctor');
    expect(response.groups.map((group) => group.key)).toContain('patients');
  });
});

describe('M26.2 — the admin scope indexes the clinic and the shell', () => {
  it('finds the Backup settings panel by name', async () => {
    const results = groupOf(await search(adminToken, 'q=backup'), 'destinations');
    const panel = results.find((row) => row.id === 'set-backup');

    // The milestone's verify step, literally. A panel is a page rather
    // than a row, which is why destinations are indexed at all.
    expect(panel).toBeDefined();
    expect(panel?.label).toBe('Backup & Restore');
    expect(panel?.path).toBe('/admin/settings/backup');
  });

  it('finds administration entities', async () => {
    const department = await harness.prisma.department.findFirstOrThrow({
      select: { name: true },
    });
    const results = groupOf(await search(adminToken, `q=${department.name}`), 'departments');

    expect(results.map((row) => row.label)).toContain(department.name);
    expect(results[0]?.path).toBe('/admin/departments');
  });

  it('carries no patient anywhere in the admin scope', async () => {
    const response = await search(adminToken, `q=${UNIQUE}`);

    // An administrator holds no care relationship (ADR-022), and the
    // frontend's own admin index carries no patients either. This is
    // what keeps the endpoint out of the PHI surface: the only search
    // that returns a patient is a doctor's over their own panel.
    expect(response.groups.some((group) => group.key === 'patients')).toBe(false);
    // The echoed `query` carries the term by definition; what must not
    // carry it is anything the search *found*.
    expect(JSON.stringify(response.groups)).not.toContain(UNIQUE);
    expect(response.totalItems).toBe(0);
  });

  it('reports the admin scope for an administrator who asked for none', async () => {
    expect((await search(adminToken, 'q=backup')).scope).toBe('admin');
  });

  it('caps each group independently so one cannot crowd out the rest', async () => {
    // Per group, not overall: the client decides how to interleave, and
    // it cannot if the server truncated across groups first.
    const response = await search(adminToken, 'q=re&limit=2');

    expect(response.groups.every((group) => group.results.length <= 2)).toBe(true);
  });
});
