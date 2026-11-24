import { randomUUID } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * The doctor employment lifecycle (OD-12, gap G3, stage S6 — GitHub #54),
 * over HTTP against PostgreSQL.
 *
 * The case worth reading is the termination: OD-12 (FINAL) says an
 * employment end revokes hospital access **immediately, with no grace
 * period**. It is asserted the way the doctor would experience it — the
 * access token they already hold is refused on the very next request, the
 * refresh cookie is refused, and a fresh sign-in carries no hospital —
 * rather than by reading `revoked_at` back out.
 *
 * Also pinned: the employment's own care assignments are revoked while a
 * legacy assignment with no employment (#17) is left exactly as it was;
 * hospital role assignments derived from the employment are revoked while
 * an independent grant and a grant at another hospital are not; the audit
 * rows are written, with `audit_events.hospital_id` set to the
 * employment's hospital (and still NULL on other events); only `doctors.manage` reaches the routes; and
 * every refusal (409 twice active, 409 double end, 422 foreign
 * department, 404 unknown ids) answers as documented.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const SESSION = '/api/v1/auth/session';
const DOCTORS = '/api/v1/doctors';
const PASSWORD = 'Medora123!';
/** Patient fixture tag: `PT-T` + tag + index must fit VarChar(20). */
const PATIENT_TAG = 'EMPLC';

interface SessionPayload {
  user: { id: string; role: string };
  accessToken: string;
}

interface SessionUser {
  role: string;
  activeHospital: { id: string; name: string } | null;
}

interface EmploymentView {
  id: string;
  doctorId: string;
  hospital: { id: string; name: string };
  hospitalDepartment: { id: string; name: string } | null;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
}

interface EndResult {
  employment: EmploymentView;
  revokedAssignments: number;
  revokedHospitalRoles: number;
  revokedSessions: number;
}

interface SignedIn {
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface SeededDoctor {
  readonly email: string;
  readonly doctorId: string;
  readonly userId: string;
}

interface TestHospital {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
}

const created = {
  doctors: [] as string[],
  hospitals: [] as string[],
};

let adminAccess = '';
let patients: { id: string; publicId: string }[] = [];

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

function refreshTokenOf(response: { headers: Record<string, unknown> }): string {
  const raw: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  const cookie = cookies.find(
    (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
  );
  return /medora_rt=([^;]*)/.exec(cookie ?? '')?.[1] ?? '';
}

async function seedDoctor(local: string): Promise<SeededDoctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email } },
    select: { id: true, userId: true },
  });
  created.doctors.push(doctor.id);

  return { email, doctorId: doctor.id, userId: doctor.userId };
}

async function signIn(email: string): Promise<SignedIn> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  expect(response.status).toBe(200);

  return {
    accessToken: dataOf<SessionPayload>(response).accessToken,
    refreshToken: refreshTokenOf(response),
  };
}

/** An administrator token, built the only way ADR-035 §7 allows one. */
async function signInAdmin(local: string): Promise<string> {
  const { email } = await seedDoctor(local);
  const bootstrap = (await signIn(email)).accessToken;

  const setup = await request(harness.server)
    .post('/api/v1/me/2fa/setup')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ password: PASSWORD });
  const secret = dataOf<{ secret: string }>(setup).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });

  return dataOf<SessionPayload>(verified).accessToken;
}

async function hospital(
  name: string,
  state: { status?: string; deleted?: boolean } = {},
): Promise<TestHospital> {
  const row = await harness.prisma.hospital.create({
    data: {
      publicId: 'hsp_' + randomUUID(),
      name,
      ...(state.status === undefined ? {} : { status: state.status }),
      ...(state.deleted === true ? { deletedAt: new Date() } : {}),
    },
    select: { id: true, publicId: true, name: true },
  });
  created.hospitals.push(row.id);
  return row;
}

async function department(hospitalId: string, name: string): Promise<string> {
  const row = await harness.prisma.hospitalDepartment.create({
    data: { hospitalId, name },
    select: { id: true },
  });
  return row.id;
}

function startEmployment(
  doctorId: string,
  body: Record<string, unknown>,
  token = adminAccess,
): request.Test {
  return request(harness.server)
    .post(`${DOCTORS}/${doctorId}/employments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function endEmployment(doctorId: string, employmentId: string, token = adminAccess): request.Test {
  return request(harness.server)
    .post(`${DOCTORS}/${doctorId}/employments/${employmentId}/end`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
}

beforeAll(async () => {
  harness = await createAuthHarness('employment-lifecycle');
  adminAccess = await signInAdmin('lifecycle-admin');
  expect(adminAccess).not.toBe('');
  patients = await createPatientRecords(harness.prisma, PATIENT_TAG, 3);
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  // Order matters: an assignment references its employment (RESTRICT),
  // an employment references its doctor and hospital (RESTRICT), and the
  // harness reset deletes this suite's users, cascading to their doctors.
  const db = harness.prisma;
  // A role assignment references its source employment (RESTRICT).
  await db.hospitalRoleAssignment.deleteMany({ where: { hospitalId: { in: created.hospitals } } });
  await db.patientDoctorAssignment.deleteMany({ where: { doctorId: { in: created.doctors } } });
  await db.doctorEmployment.deleteMany({
    where: {
      OR: [{ doctorId: { in: created.doctors } }, { hospitalId: { in: created.hospitals } }],
    },
  });
  await db.hospitalMedicalRecord.deleteMany({ where: { hospitalId: { in: created.hospitals } } });
  await db.hospitalDepartment.deleteMany({ where: { hospitalId: { in: created.hospitals } } });
  await db.hospital.deleteMany({ where: { id: { in: created.hospitals } } });
  await destroyPatientRecords(db, PATIENT_TAG);
  await harness.reset();
  await harness.close();
});

describe('termination is immediate (OD-12)', () => {
  it('ends the employment, revokes its assignments and every session, and audits it', async () => {
    const doctor = await seedDoctor('terminated');
    const employer = await hospital('Lifecycle Employer');
    const ward = await department(employer.id, 'Lifecycle Cardiology');

    const started = await startEmployment(doctor.doctorId, {
      hospitalId: employer.publicId,
      hospitalDepartmentId: ward,
    });
    expect(started.status).toBe(201);
    const employment = dataOf<EmploymentView>(started);
    expect(employment).toMatchObject({
      doctorId: doctor.doctorId,
      hospital: { id: employer.publicId, name: employer.name },
      hospitalDepartment: { id: ward, name: 'Lifecycle Cardiology' },
      endedAt: null,
      active: true,
    });

    // Two sessions: termination must end all of them, not only one.
    const first = await signIn(doctor.email);
    const second = await signIn(doctor.email);

    const before = await request(harness.server)
      .get(SESSION)
      .set('Authorization', `Bearer ${first.accessToken}`);
    expect(before.status).toBe(200);
    expect(dataOf<SessionUser>(before).activeHospital).toEqual({
      id: employer.id,
      name: employer.name,
    });

    const [ownedA, ownedB, legacyPatient] = patients;
    // A hospital-owned assignment carries the hospital's medical record
    // for that patient (`patient_doctor_assignments_hospital_scope_pair_check`).
    const owned = await Promise.all(
      [ownedA, ownedB].map(async (patient) => {
        const record = await harness.prisma.hospitalMedicalRecord.create({
          data: { patientId: patient?.id ?? '', hospitalId: employer.id },
          select: { id: true },
        });
        return harness.prisma.patientDoctorAssignment.create({
          data: {
            patientId: patient?.id ?? '',
            doctorId: doctor.doctorId,
            hospitalId: employer.id,
            hospitalMedicalRecordId: record.id,
            doctorEmploymentId: employment.id,
          },
          select: { id: true },
        });
      }),
    );
    // Legacy (#17): no hospital, no employment. Must survive untouched.
    const legacy = await harness.prisma.patientDoctorAssignment.create({
      data: { patientId: legacyPatient?.id ?? '', doctorId: doctor.doctorId },
      select: { id: true },
    });

    // Hospital roles: one derived from this employment (must end), one
    // independent grant at the same hospital and one at another hospital
    // (both must survive — OD-12 ends what depended on the employment).
    const elsewhere = await hospital('Lifecycle Elsewhere');
    const roleId = async (code: string): Promise<string> =>
      (await harness.prisma.role.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
    const derivedRole = await harness.prisma.hospitalRoleAssignment.create({
      data: {
        userId: doctor.userId,
        hospitalId: employer.id,
        roleId: await roleId('doctor'),
        sourceDoctorEmploymentId: employment.id,
      },
      select: { id: true },
    });
    const independentRole = await harness.prisma.hospitalRoleAssignment.create({
      data: { userId: doctor.userId, hospitalId: employer.id, roleId: await roleId('nurse') },
      select: { id: true },
    });
    const otherHospitalRole = await harness.prisma.hospitalRoleAssignment.create({
      data: { userId: doctor.userId, hospitalId: elsewhere.id, roleId: await roleId('doctor') },
      select: { id: true },
    });

    const ended = await endEmployment(doctor.doctorId, employment.id);

    expect(ended.status).toBe(200);
    const result = dataOf<EndResult>(ended);
    expect(result.employment.id).toBe(employment.id);
    expect(result.employment.active).toBe(false);
    expect(result.employment.endedAt).not.toBeNull();
    expect(result.revokedAssignments).toBe(2);
    expect(result.revokedHospitalRoles).toBe(1);
    expect(result.revokedSessions).toBe(2);

    const roleRows = await harness.prisma.hospitalRoleAssignment.findMany({
      where: { id: { in: [derivedRole.id, independentRole.id, otherHospitalRole.id] } },
      select: { id: true, revokedAt: true },
    });
    const revokedAtOf = (id: string): Date | null | undefined =>
      roleRows.find((row) => row.id === id)?.revokedAt;
    // Revoked in the end's own transaction, at the employment's end time.
    const endedRow = await harness.prisma.doctorEmployment.findUniqueOrThrow({
      where: { id: employment.id },
      select: { endedAt: true },
    });
    expect(revokedAtOf(derivedRole.id)).toEqual(endedRow.endedAt);
    expect(revokedAtOf(independentRole.id)).toBeNull();
    expect(revokedAtOf(otherHospitalRole.id)).toBeNull();

    // The access token the doctor already holds: refused on the next request.
    for (const session of [first, second]) {
      const next = await request(harness.server)
        .get(SESSION)
        .set('Authorization', `Bearer ${session.accessToken}`);
      expect(next.status).toBe(401);

      const refresh = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', `medora_rt=${session.refreshToken}`);
      expect(refresh.status).toBe(401);
    }

    // #18 (OWNER_DECISIONS 2026-11-23): employment terminated — login
    // denied. A fresh sign-in is refused like any inactive account.
    const again = await request(harness.server)
      .post(LOGIN)
      .send({ email: doctor.email, password: PASSWORD, rememberMe: false });
    expect(again.status).toBe(403);
    expect(errorBody(again).code).toBe('account_inactive');

    // Owned assignments revoked; the legacy one untouched.
    const ownedRows = await harness.prisma.patientDoctorAssignment.findMany({
      where: { id: { in: owned.map((row) => row.id) } },
      select: { revokedAt: true },
    });
    expect(ownedRows).toHaveLength(2);
    for (const row of ownedRows) expect(row.revokedAt).not.toBeNull();

    const legacyRow = await harness.prisma.patientDoctorAssignment.findUniqueOrThrow({
      where: { id: legacy.id },
      select: { revokedAt: true, hospitalId: true, doctorEmploymentId: true },
    });
    expect(legacyRow).toEqual({ revokedAt: null, hospitalId: null, doctorEmploymentId: null });

    // The audit row: ids and counts only.
    const audit = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'doctor.employment_ended', target: `doctor:${doctor.doctorId}` },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit.actorRole).toBe('admin');
    expect(audit.hospitalId).toBe(employer.id);
    expect(audit.payload).toMatchObject({
      employmentId: employment.id,
      hospitalId: employer.id,
      hospitalDepartmentId: ward,
      revokedAssignments: 2,
      revokedHospitalRoles: 1,
      revokedSessions: 2,
      legacyAssignmentsUntouched: 1,
    });

    const startAudit = await harness.prisma.auditEvent.findFirst({
      where: { eventType: 'doctor.employment_started', target: `doctor:${doctor.doctorId}` },
    });
    expect(startAudit).not.toBeNull();
    expect(startAudit?.hospitalId).toBe(employer.id);

    // Every other event keeps the column NULL — here, the doctor's sign-ins.
    const logins = await harness.prisma.auditEvent.findMany({
      where: { eventType: 'auth.login', actorId: doctor.userId },
      select: { hospitalId: true },
    });
    expect(logins.length).toBeGreaterThan(0);
    for (const row of logins) expect(row.hospitalId).toBeNull();
  });

  it('refuses to end an employment twice (409) and changes nothing the second time', async () => {
    const doctor = await seedDoctor('double-end');
    const employer = await hospital('Lifecycle Double End');
    const started = await startEmployment(doctor.doctorId, { hospitalId: employer.publicId });
    const employment = dataOf<EmploymentView>(started);

    expect((await endEmployment(doctor.doctorId, employment.id)).status).toBe(200);
    const endedAt = (
      await harness.prisma.doctorEmployment.findUniqueOrThrow({ where: { id: employment.id } })
    ).endedAt;

    const again = await endEmployment(doctor.doctorId, employment.id);
    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('invalid_status_transition');

    const row = await harness.prisma.doctorEmployment.findUniqueOrThrow({
      where: { id: employment.id },
    });
    expect(row.endedAt).toEqual(endedAt);
  });

  it('lists the employments newest first, the ended one marked inactive', async () => {
    const doctor = await seedDoctor('history');
    const first = await hospital('Lifecycle First');
    const second = await hospital('Lifecycle Second');

    const one = dataOf<EmploymentView>(
      await startEmployment(doctor.doctorId, { hospitalId: first.publicId }),
    );
    await endEmployment(doctor.doctorId, one.id);
    const two = dataOf<EmploymentView>(
      await startEmployment(doctor.doctorId, { hospitalId: second.publicId }),
    );

    const list = await request(harness.server)
      .get(`${DOCTORS}/${doctor.doctorId}/employments`)
      .set('Authorization', `Bearer ${adminAccess}`);

    expect(list.status).toBe(200);
    const items = dataOf<EmploymentView[]>(list);
    expect(items.map((item) => [item.id, item.active])).toEqual([
      [two.id, true],
      [one.id, false],
    ]);
  });
});

describe('starting an employment', () => {
  it('refuses a second active employment with 409 employment_active (DR-02)', async () => {
    const doctor = await seedDoctor('twice');
    const a = await hospital('Lifecycle Twice A');
    const b = await hospital('Lifecycle Twice B');

    expect((await startEmployment(doctor.doctorId, { hospitalId: a.publicId })).status).toBe(201);
    const second = await startEmployment(doctor.doctorId, { hospitalId: b.publicId });

    expect(second.status).toBe(409);
    expect(errorBody(second).code).toBe('employment_active');
    expect(
      await harness.prisma.doctorEmployment.count({
        where: { doctorId: doctor.doctorId, endedAt: null },
      }),
    ).toBe(1);
  });

  it('refuses a department of another hospital with 422', async () => {
    const doctor = await seedDoctor('foreign-dept');
    const employer = await hospital('Lifecycle Dept Employer');
    const other = await hospital('Lifecycle Dept Other');
    const foreign = await department(other.id, 'Lifecycle Foreign Ward');

    const response = await startEmployment(doctor.doctorId, {
      hospitalId: employer.publicId,
      hospitalDepartmentId: foreign,
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('validation_failed');
    expect(
      await harness.prisma.doctorEmployment.count({ where: { doctorId: doctor.doctorId } }),
    ).toBe(0);
  });

  it('refuses a hospital that is not ACTIVE with 409, and a soft-deleted one with 404', async () => {
    const doctor = await seedDoctor('inactive-hospital');
    const suspended = await hospital('Lifecycle Suspended', { status: 'SUSPENDED' });
    const deleted = await hospital('Lifecycle Deleted', { deleted: true });

    const inactive = await startEmployment(doctor.doctorId, { hospitalId: suspended.publicId });
    expect(inactive.status).toBe(409);
    expect(errorBody(inactive).code).toBe('hospital_inactive');

    const gone = await startEmployment(doctor.doctorId, { hospitalId: deleted.publicId });
    expect(gone.status).toBe(404);
  });

  it('refuses a soft-deleted doctor with 404', async () => {
    const doctor = await seedDoctor('deleted-doctor');
    const employer = await hospital('Lifecycle Deleted Doctor');
    await harness.prisma.doctor.update({
      where: { id: doctor.doctorId },
      data: { deletedAt: new Date() },
    });

    const response = await startEmployment(doctor.doctorId, { hospitalId: employer.publicId });
    expect(response.status).toBe(404);
  });
});

describe('unknown ids answer 404 (ADR-022)', () => {
  it('for an unknown or malformed doctor, hospital and employment', async () => {
    const doctor = await seedDoctor('unknown-ids');
    const employer = await hospital('Lifecycle Unknown');

    const unknownDoctor = await startEmployment(randomUUID(), { hospitalId: employer.publicId });
    expect(unknownDoctor.status).toBe(404);

    const malformedDoctor = await request(harness.server)
      .get(`${DOCTORS}/not-a-uuid/employments`)
      .set('Authorization', `Bearer ${adminAccess}`);
    expect(malformedDoctor.status).toBe(404);

    const unknownHospital = await startEmployment(doctor.doctorId, {
      hospitalId: 'hsp_' + randomUUID(),
    });
    expect(unknownHospital.status).toBe(404);

    expect((await endEmployment(doctor.doctorId, randomUUID())).status).toBe(404);
    expect((await endEmployment(doctor.doctorId, 'not-a-uuid')).status).toBe(404);

    // Another doctor's employment, named under this doctor: 404, untouched.
    const owner = await seedDoctor('unknown-ids-owner');
    const theirs = dataOf<EmploymentView>(
      await startEmployment(owner.doctorId, { hospitalId: employer.publicId }),
    );
    expect((await endEmployment(doctor.doctorId, theirs.id)).status).toBe(404);
    const row = await harness.prisma.doctorEmployment.findUniqueOrThrow({
      where: { id: theirs.id },
    });
    expect(row.endedAt).toBeNull();
  });
});

describe('only doctors.manage reaches the routes', () => {
  it('refuses a doctor every employment route, and leaves the employment active', async () => {
    const doctor = await seedDoctor('outsider');
    const token = (await signIn(doctor.email)).accessToken;
    const employer = await hospital('Lifecycle Outsider');
    const employment = dataOf<EmploymentView>(
      await startEmployment(doctor.doctorId, { hospitalId: employer.publicId }),
    );

    const list = await request(harness.server)
      .get(`${DOCTORS}/${doctor.doctorId}/employments`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(403);

    const start = await startEmployment(doctor.doctorId, { hospitalId: employer.publicId }, token);
    expect(start.status).toBe(403);

    const end = await endEmployment(doctor.doctorId, employment.id, token);
    expect(end.status).toBe(403);

    const unauthenticated = await request(harness.server)
      .post(`${DOCTORS}/${doctor.doctorId}/employments/${employment.id}/end`)
      .send({});
    expect(unauthenticated.status).toBe(401);

    const row = await harness.prisma.doctorEmployment.findUniqueOrThrow({
      where: { id: employment.id },
    });
    expect(row.endedAt).toBeNull();
  });
});
