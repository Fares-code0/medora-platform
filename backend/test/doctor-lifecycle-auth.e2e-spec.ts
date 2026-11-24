import { randomUUID } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * The doctor lifecycle at sign-in and on every request (#18,
 * `docs/multi-hospital/OWNER_DECISIONS.md`, "Approved implementation
 * decisions — 2026-11-23"):
 *
 * | State                 | Login            | Clinical access |
 * | Vacation              | Allowed          | Allowed         |
 * | Unverified            | Allowed          | Denied          |
 * | Suspended             | Own profile only | Denied          |
 * | Employment terminated | Denied           | Denied          |
 *
 * Clinical access is the authorization layer's; this suite pins the
 * authentication half and the patient-facing doctor listing. "Terminated"
 * is at least one `doctor_employments` row and none active; a doctor with
 * no employment rows is a legacy account and is not terminated.
 *
 * The employment changes are written straight to the table on purpose:
 * `POST …/employments/:id/end` already revokes the sessions, so only a
 * direct write shows that the per-request check refuses the token on its
 * own (defence in depth for an employment ended by any other path).
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';
const REGISTER = `${PREFIX}/auth/register`;
const LOGIN = `${PREFIX}/auth/login`;
const OTP_VERIFY = `${PREFIX}/auth/otp/verify`;
const REFRESH = `${PREFIX}/auth/refresh`;
const LOGOUT = `${PREFIX}/auth/logout`;
const SESSION = `${PREFIX}/auth/session`;
const PATIENT_DOCTORS = `${PREFIX}/patient/doctors`;
const PASSWORD = 'Medora123!';

const created = { doctors: [] as string[], hospitals: [] as string[] };

interface Doctor {
  readonly email: string;
  readonly doctorId: string;
}

interface SignedIn {
  readonly accessToken: string;
  readonly refreshToken: string;
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function refreshTokenOf(response: { headers: Record<string, unknown> }): string {
  const raw: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  const cookie = cookies.find(
    (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
  );
  return /medora_rt=([^;]*)/.exec(cookie ?? '')?.[1] ?? '';
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function seedDoctor(local: string): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email })).expect(201);
  await markVerified(harness.prisma, email);
  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email } },
    select: { id: true },
  });
  created.doctors.push(doctor.id);
  return { email, doctorId: doctor.id };
}

function login(email: string): request.Test {
  return request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });
}

async function signIn(email: string): Promise<SignedIn> {
  const response = await login(email);
  expect(response.status).toBe(200);
  return {
    accessToken: dataOf<{ accessToken: string }>(response).accessToken,
    refreshToken: refreshTokenOf(response),
  };
}

async function hospital(): Promise<string> {
  const row = await harness.prisma.hospital.create({
    data: { publicId: 'hsp_' + randomUUID(), name: 'Lifecycle Auth Hospital' },
    select: { id: true },
  });
  created.hospitals.push(row.id);
  return row.id;
}

/** An employment, ended or active, written straight to the table. */
async function employ(doctorId: string, ended: boolean): Promise<string> {
  const row = await harness.prisma.doctorEmployment.create({
    data: {
      doctorId,
      hospitalId: await hospital(),
      ...(ended ? { startedAt: new Date(Date.now() - 60_000), endedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  return row.id;
}

/** Ends every active employment of a doctor without revoking any session. */
async function terminateDirectly(doctorId: string): Promise<void> {
  await harness.prisma.doctorEmployment.updateMany({
    where: { doctorId, endedAt: null },
    data: { endedAt: new Date() },
  });
}

async function setStatus(
  doctorId: string,
  data: { practiceStatus?: 'ACTIVE' | 'SUSPENDED' | 'VACATION'; verificationStatus?: 'VERIFIED' },
): Promise<void> {
  await harness.prisma.doctor.update({ where: { id: doctorId }, data });
}

beforeAll(async () => {
  harness = await createAuthHarness('doctor-lifecycle-auth');
}, 120_000);

async function cleanUp(): Promise<void> {
  // An employment references its doctor and hospital (RESTRICT), and the
  // harness reset deletes this suite's users, cascading to their doctors.
  await harness.prisma.doctorEmployment.deleteMany({
    where: {
      OR: [{ doctorId: { in: created.doctors } }, { hospitalId: { in: created.hospitals } }],
    },
  });
  await harness.prisma.hospital.deleteMany({ where: { id: { in: created.hospitals } } });
  created.doctors.length = 0;
  created.hospitals.length = 0;
  await harness.reset();
}

beforeEach(async () => {
  await cleanUp();
});

afterEach(async () => {
  await cleanUp();
});

afterAll(async () => {
  if (harness === undefined) return;
  await harness.close();
});

describe('employment terminated — login denied', () => {
  it('refuses a password sign-in with the existing account_inactive refusal', async () => {
    const doctor = await seedDoctor('terminated');
    await employ(doctor.doctorId, true);

    const response = await login(doctor.email);

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('account_inactive');
    expect(refreshTokenOf(response)).toBe('');
    const sessions = await harness.prisma.session.count({
      where: { user: { email: doctor.email } },
    });
    expect(sessions).toBe(0);
  });

  it('answers a wrong password exactly as before — no lifecycle disclosed without it', async () => {
    const doctor = await seedDoctor('terminated-wrong');
    await employ(doctor.doctorId, true);

    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email: doctor.email, password: 'Wrong-Password1!', rememberMe: false });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('invalid_credentials');
  });

  it('refuses the access token and the refresh of an employment ended by another path', async () => {
    const doctor = await seedDoctor('terminated-live');
    await employ(doctor.doctorId, false);
    const session = await signIn(doctor.email);
    await request(harness.server).get(SESSION).set(auth(session.accessToken)).expect(200);

    // Sessions are deliberately left unrevoked.
    await terminateDirectly(doctor.doctorId);

    const next = await request(harness.server).get(SESSION).set(auth(session.accessToken));
    expect(next.status).toBe(401);
    expect(errorBody(next).code).toBe('unauthorized');

    const refresh = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${session.refreshToken}`);
    expect(refresh.status).toBe(401);

    // Logout still answers (it waives liveness only).
    await request(harness.server).post(LOGOUT).set(auth(session.accessToken)).expect(204);
  });

  it('mints nothing at the OTP completion when the employment ends after the password', async () => {
    const doctor = await seedDoctor('terminated-otp');
    await employ(doctor.doctorId, false);
    const bootstrap = (await signIn(doctor.email)).accessToken;
    const setup = await request(harness.server)
      .post(`${PREFIX}/me/2fa/setup`)
      .set(auth(bootstrap))
      .send({ password: PASSWORD });
    const secret = dataOf<{ secret: string }>(setup).secret;
    await request(harness.server)
      .post(`${PREFIX}/me/2fa/enable`)
      .set(auth(bootstrap))
      .send({ code: currentCode(secret) })
      .expect(204);

    const challenge = await login(doctor.email);
    expect(challenge.status).toBe(200);
    const otpToken = dataOf<{ otpToken: string }>(challenge).otpToken;

    await terminateDirectly(doctor.doctorId);

    const verified = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken, code: currentCode(secret) });
    expect(verified.status).toBe(403);
    expect(errorBody(verified).code).toBe('account_inactive');
    expect(refreshTokenOf(verified)).toBe('');
  });

  it('does not treat a legacy doctor with no employment rows as terminated', async () => {
    const doctor = await seedDoctor('legacy');
    const session = await signIn(doctor.email);
    await request(harness.server).get(SESSION).set(auth(session.accessToken)).expect(200);
  });

  it('does not treat a doctor who moved hospitals (one ended, one active) as terminated', async () => {
    const doctor = await seedDoctor('moved');
    await employ(doctor.doctorId, true);
    await employ(doctor.doctorId, false);
    const session = await signIn(doctor.email);
    await request(harness.server).get(SESSION).set(auth(session.accessToken)).expect(200);
  });
});

describe('suspended — own profile only', () => {
  const OWN = [
    SESSION,
    `${PREFIX}/me/profile`,
    `${PREFIX}/me/account`,
    `${PREFIX}/me/2fa`,
    `${PREFIX}/me/sessions`,
    `${PREFIX}/me/devices`,
    `${PREFIX}/me/login-history`,
  ];
  const OTHER = [
    `${PREFIX}/me/settings`,
    `${PREFIX}/me/activity`,
    `${PREFIX}/me/availability`,
    `${PREFIX}/me/appointments`,
    PATIENT_DOCTORS,
    `${PREFIX}/dashboard/doctor`,
  ];

  it('signs in, reaches only its own account, and is refused 403 practice_suspended elsewhere', async () => {
    const doctor = await seedDoctor('suspended');
    await employ(doctor.doctorId, false);
    await setStatus(doctor.doctorId, { practiceStatus: 'SUSPENDED' });

    const session = await signIn(doctor.email);

    for (const path of OWN) {
      const response = await request(harness.server).get(path).set(auth(session.accessToken));
      expect({ path, status: response.status }).toEqual({ path, status: 200 });
    }
    for (const path of OTHER) {
      const response = await request(harness.server).get(path).set(auth(session.accessToken));
      expect({ path, status: response.status, code: errorBody(response).code }).toEqual({
        path,
        status: 403,
        code: 'practice_suspended',
      });
    }

    // A refresh still works: login is allowed.
    const refresh = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${session.refreshToken}`);
    expect(refresh.status).toBe(200);
  });

  it('decides from the database on every request, not from the token', async () => {
    const doctor = await seedDoctor('suspended-live');
    const session = await signIn(doctor.email);
    const settings = `${PREFIX}/me/settings`;
    await request(harness.server).get(settings).set(auth(session.accessToken)).expect(200);

    await setStatus(doctor.doctorId, { practiceStatus: 'SUSPENDED' });
    const refused = await request(harness.server).get(settings).set(auth(session.accessToken));
    expect(refused.status).toBe(403);
    expect(errorBody(refused).code).toBe('practice_suspended');

    await setStatus(doctor.doctorId, { practiceStatus: 'ACTIVE' });
    await request(harness.server).get(settings).set(auth(session.accessToken)).expect(200);
  });
});

describe('unverified and on vacation — login unchanged', () => {
  it('lets an unverified doctor sign in and use non-clinical routes', async () => {
    const doctor = await seedDoctor('unverified');
    const row = await harness.prisma.doctor.findUniqueOrThrow({
      where: { id: doctor.doctorId },
      select: { verificationStatus: true },
    });
    expect(row.verificationStatus).toBe('PENDING');

    const session = await signIn(doctor.email);
    await request(harness.server).get(SESSION).set(auth(session.accessToken)).expect(200);
    await request(harness.server)
      .get(`${PREFIX}/me/settings`)
      .set(auth(session.accessToken))
      .expect(200);
  });

  it('lets a doctor on vacation sign in and use any route its role reaches', async () => {
    const doctor = await seedDoctor('vacation');
    await employ(doctor.doctorId, false);
    await setStatus(doctor.doctorId, {
      practiceStatus: 'VACATION',
      verificationStatus: 'VERIFIED',
    });

    const session = await signIn(doctor.email);
    for (const path of [SESSION, `${PREFIX}/me/settings`, `${PREFIX}/me/availability`]) {
      const response = await request(harness.server).get(path).set(auth(session.accessToken));
      expect({ path, status: response.status }).toEqual({ path, status: 200 });
    }
    const refresh = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${session.refreshToken}`);
    expect(refresh.status).toBe(200);
  });
});

describe('patient-facing doctor listing', () => {
  it('does not offer a verified, active doctor whose employment has ended', async () => {
    const viewer = await seedDoctor('listing-viewer');
    const token = (await signIn(viewer.email)).accessToken;

    const employed = await seedDoctor('listing-employed');
    await employ(employed.doctorId, false);
    const legacy = await seedDoctor('listing-legacy');
    const terminated = await seedDoctor('listing-terminated');
    await employ(terminated.doctorId, true);
    // A name no other suite uses, so the list query sees only these rows.
    const marker = `Lifecycle${randomUUID().slice(0, 8)}`;
    for (const doctor of [employed, legacy, terminated]) {
      await harness.prisma.doctor.update({
        where: { id: doctor.doctorId },
        data: { verificationStatus: 'VERIFIED', fullName: `Dr. ${marker}` },
      });
    }

    const status = async (doctorId: string): Promise<number> =>
      (await request(harness.server).get(`${PATIENT_DOCTORS}/${doctorId}`).set(auth(token))).status;

    expect(await status(employed.doctorId)).toBe(200);
    expect(await status(legacy.doctorId)).toBe(200);
    expect(await status(terminated.doctorId)).toBe(404);

    const list = await request(harness.server)
      .get(`${PATIENT_DOCTORS}?q=${marker}&pageSize=100`)
      .set(auth(token));
    expect(list.status).toBe(200);
    const page = dataOf<{ items: { id: string }[]; totalItems: number }>(list);
    expect(page.items.map((item) => item.id).sort()).toEqual(
      [employed.doctorId, legacy.doctorId].sort(),
    );
    expect(page.totalItems).toBe(2);
  });
});
