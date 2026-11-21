import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PatientSelfScopeService } from '../src/shared/authz';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
  TEST_PATIENT_PREFIX,
} from './support/patient-fixture';
import { body as mailBody } from './support/smtp-sink';

/**
 * Patient identity and authentication (ADR-030).
 *
 * ADR-030 amends ADR-018 §3 — "patients are records, not authenticated
 * users" — by owner decision of 2026-09-02. This file is the proof that
 * the amendment landed as specified and, more importantly, that it landed
 * *only* where specified.
 *
 * The four properties worth stating up front, because they are the ones a
 * plausible implementation gets wrong:
 *
 *  1. **A patient authenticates through the existing lifecycle**, not a
 *     parallel one. Same register/verify/login/refresh/logout routes,
 *     same hashing, same lockout. If any of this needed new machinery,
 *     Option B was chosen by accident.
 *  2. **A patient holds zero capabilities**, and that is what closes
 *     every `@Can(...)` route in the platform to them without a line of
 *     code (ADR-030 §6).
 *  3. **Registration creates an account and nothing else** — no clinical
 *     record, no link to one. Account creation and record claiming are
 *     separate problems (ADR-030 §4); claiming is undecided (RA-030.1).
 *  4. **`patients.user_id` is nullable and unique**, and the existing
 *     seeded records are untouched by the migration.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const VERIFY = '/api/v1/auth/verify-email';

/**
 * This file's own clinical records — see `support/patient-fixture.ts`.
 *
 * Property 4 above is about the seeded records, and it is asserted
 * below against the seeded records specifically. Everything else here
 * needs *a* record to link, not a seeded one, and taking a seeded one
 * raced the two sibling patient specs doing the same.
 */
let records: PatientRecord[];
const PATIENT_TAG = 'ident';

beforeAll(async () => {
  harness = await createAuthHarness('patient-identity');
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 2);
});

afterAll(async () => {
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

/** Registers, verifies and logs in a patient. Returns the login payload. */
async function signUpPatient(local = 'sara'): Promise<{
  email: string;
  accessToken: string;
  refreshToken: string;
  /** `users.id` — the uuid a `Principal` carries and every FK refers to. */
  userId: string;
  user: { id: string; role: string; permissions: string[]; name: string };
}> {
  const email = testEmail(local);

  await request(harness.server)
    .post(REGISTER)
    .send(registrationBody({ firstName: 'Sara', lastName: 'Al-Amin', email, role: 'patient' }))
    .expect(201);

  const mail = harness.sink.lastTo(email);
  await request(harness.server)
    .post(VERIFY)
    .send({ token: tokenFromLink(mailBody(mail!)) })
    .expect(204);

  const login = await request(harness.server)
    .post(LOGIN)
    .set('X-Client-Type', 'mobile')
    .send({ email, password: 'Medora123!' })
    .expect(200);

  const payload = dataOf<{
    user: { id: string; role: string; permissions: string[]; name: string };
    accessToken: string;
    // ADR-034: under `X-Client-Type: mobile` the refresh token is
    // delivered in the body and no cookie is set. This spec's login
    // above sends that header, so this field is present.
    refreshToken: string;
  }>(login);

  // `payload.user.id` is `users.public_id` (`usr_…`) — what responses and
  // audit rows quote. A `Principal` carries `users.id`, the uuid, and the
  // two are deliberately different (`AuthenticatedUser`, "two ids").
  const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return {
    email,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    userId: row.id,
    user: payload.user,
  };
}

/**
 * Two distinct clinical records belonging to this file.
 *
 * The cross-patient cases need a "mine" and a "theirs" that are genuinely
 * different rows; a helper that throws makes the precondition explicit
 * rather than letting an empty fixture turn into a confusing assertion
 * failure three lines later.
 *
 * These are this suite's own rows, not the seeded ones — two suites
 * cannot both link the same record, because `patients.user_id` is
 * UNIQUE.
 */
function twoPatients(): [PatientRecord, PatientRecord] {
  const [first, second] = records;

  if (first === undefined || second === undefined) {
    throw new Error('fixture needs two records');
  }

  return [first, second];
}

describe('a patient can register through the existing lifecycle (ADR-030 §5)', () => {
  it('accepts role=patient, which ADR-018 §3 refused', async () => {
    const response = await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email: testEmail('sara'), role: 'patient' }));

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      data: { nextStep: 'verify-email', email: testEmail('sara') },
    });
  });

  it('still refuses a role that is not seeded', async () => {
    // The enum widened by exactly one value. Deny-by-default on the
    // vocabulary is what stops it widening again by accident.
    const response = await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email: testEmail('nobody'), role: 'nurse' }));

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.role).toBeDefined();
  });

  it('does not prefix a patient with a professional honorific', async () => {
    // `Dr.` is a professional title, not a courtesy. Prefixing a patient
    // with one would be wrong rather than merely odd.
    await request(harness.server)
      .post(REGISTER)
      .send(
        registrationBody({
          firstName: 'Sara',
          lastName: 'Al-Amin',
          email: testEmail('sara'),
          role: 'patient',
        }),
      )
      .expect(201);

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('sara') },
    });

    expect(user.displayName).toBe('Sara Al-Amin');
  });

  it('creates an account and NO clinical record (ADR-030 §4)', async () => {
    // The load-bearing case. Registration is a self-service form; claiming
    // a record asserts "I am the person in PT-1042", and a wrong assertion
    // discloses one person's medical history to another. The two are kept
    // apart deliberately, and the claim flow is undecided (RA-030.1).
    await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email: testEmail('sara'), role: 'patient' }))
      .expect(201);

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('sara') },
      include: { patient: true },
    });

    expect(user.patient).toBeNull();
  });

  it('never links an account to a record by matching email', async () => {
    // The single most dangerous shortcut available here. `patients.email`
    // is a nullable, non-unique, clinician-typed contact field; matching
    // on it would hand a stranger's chart to anyone who registered with a
    // shared family address. Explicitly ruled out by ADR-030 §4.
    // The seeded records carry no contact email, so one is set here — the
    // point is the collision, and it has to exist to be ignored.
    const record = records[0]!;
    const shared = testEmail('shared-address');

    await harness.prisma.db.patient.update({
      where: { id: record.id },
      data: { email: shared },
    });

    await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email: shared, role: 'patient' }))
      .expect(201);

    const after = await harness.prisma.db.patient.findUniqueOrThrow({
      where: { id: record.id },
    });

    expect(after.userId).toBeNull();

    await harness.prisma.db.patient.update({
      where: { id: record.id },
      data: { email: null },
    });
  });
});

describe('a patient authenticates on the M6 stack, unchanged', () => {
  it('logs in, refreshes on the mobile path, and logs out', async () => {
    const session = await signUpPatient();

    expect(session.accessToken).toBeTruthy();
    expect(session.user.role).toBe('patient');

    // ADR-014's token-in-body variant — the path the mobile client uses,
    // and the reason ADR-018 §4 kept mobile readiness out of the
    // deferral. Since ADR-034 the token came from the login *body*, and
    // no cookie was set at all; `auth-mobile-client.e2e-spec.ts` covers
    // that delivery rule in full.
    const refreshed = await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    const next = dataOf<{ accessToken: string; refreshToken?: string }>(refreshed);
    expect(next.accessToken).toBeTruthy();

    await request(harness.server)
      .post(LOGOUT)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(204);
  });

  it('is blocked before email verification, like every other role', async () => {
    const email = testEmail('unverified');
    await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email, role: 'patient' }))
      .expect(201);

    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: 'Medora123!' });

    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('email_unverified');
  });

  it('gets the same anti-enumeration answer on a wrong password', async () => {
    const session = await signUpPatient();

    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email: session.email, password: 'WrongPassword1!' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('invalid_credentials');
  });
});

describe('a patient holds zero capabilities (ADR-030 §6)', () => {
  it('issues a session carrying an empty permission set', async () => {
    // Not an oversight — this is the mechanism. Every `@Can(...)` route in
    // the platform denies a principal holding nothing, so patients are
    // closed out of the entire clinician surface with no code written and
    // nothing for a future author to forget.
    const session = await signUpPatient();

    expect(session.user.permissions).toEqual([]);
  });

  it('is denied a capability-gated route', async () => {
    // `/me/2fa/setup` is `@Authenticated()` and reachable; a capability
    // route is not. The authorization kernel denies by default, so the
    // proof that matters is that a patient's token does not open one.
    const session = await signUpPatient();

    const response = await request(harness.server)
      .get('/api/v1/patients')
      .set('Authorization', `Bearer ${session.accessToken}`);

    // 403 (the guard refused) or 404 (no such route yet) — never 200.
    expect(response.status).not.toBe(200);
    expect([403, 404]).toContain(response.status);
  });

  it('reaches an @Authenticated() self-service route like any other user', async () => {
    // The complement of the case above: zero capabilities must not mean
    // "cannot use the account". A patient changing their own password is
    // authorized by the token's subject, not by a capability.
    const session = await signUpPatient();

    const response = await request(harness.server)
      .post('/api/v1/me/password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: 'Medora123!', newPassword: 'Medora456!' });

    expect(response.status).toBe(204);
  });

  it('refuses an unauthenticated request to a self-service route', async () => {
    const response = await request(harness.server)
      .post('/api/v1/me/password')
      .send({ currentPassword: 'Medora123!', newPassword: 'Medora456!' });

    expect(response.status).toBe(401);
  });
});

describe('the users ↔ patients link (ADR-030 §§1–3)', () => {
  it('leaves every seeded clinical record unlinked', async () => {
    // The migration is additive and has no backfill. A record that was
    // valid before ADR-030 is valid after it, unchanged.
    //
    // Scoped to the seeded records, which is what this test claims and
    // what the migration is about. Unscoped it read every row in the
    // table, including the fixtures the sibling patient specs create and
    // link — so it asserted a property of *other suites' test data* and
    // failed whenever one of them happened to hold a link at this
    // instant. `PT-T` marks a row as a test's own; the seed's are
    // `PT-1001`–`PT-1005`.
    const patients = await harness.prisma.db.patient.findMany({
      where: { publicId: { not: { startsWith: TEST_PATIENT_PREFIX } } },
      select: { userId: true },
    });

    expect(patients.length).toBeGreaterThan(0);
    expect(patients.every((patient) => patient.userId === null)).toBe(true);
  });

  it('allows at most one clinical record per account', async () => {
    const session = await signUpPatient();
    const [first, second] = twoPatients();

    await harness.prisma.db.patient.update({
      where: { id: first.id },
      data: { userId: session.userId },
    });

    // The unique constraint is the whole of the one-to-at-most-one rule.
    await expect(
      harness.prisma.db.patient.update({
        where: { id: second.id },
        data: { userId: session.userId },
      }),
    ).rejects.toThrow();

    await harness.prisma.db.patient.update({
      where: { id: first.id },
      data: { userId: null },
    });
  });

  it('keeps the clinical record when the account is deleted (SET NULL, never CASCADE)', async () => {
    // DB §7: PHI is never hard-deleted. Losing an app account must not
    // delete a person's medical history — the worst outcome the FK could
    // have produced.
    const session = await signUpPatient();
    const patient = records[0]!;

    await harness.prisma.db.patient.update({
      where: { id: patient.id },
      data: { userId: session.userId },
    });

    await harness.prisma.user.delete({ where: { id: session.userId } });

    const survivor = await harness.prisma.db.patient.findUnique({ where: { id: patient.id } });

    expect(survivor).not.toBeNull();
    expect(survivor?.userId).toBeNull();
  });
});

describe('ownership resolution refuses to leak (ADR-030 §6)', () => {
  it('resolves a linked patient account to its own record, and only that one', async () => {
    const session = await signUpPatient();
    const scope = harness.app.get(PatientSelfScopeService);
    const [mine, theirs] = twoPatients();

    await harness.prisma.db.patient.update({
      where: { id: mine.id },
      data: { userId: session.userId },
    });

    const principal = { userId: session.userId, roleCode: 'patient' };

    expect(await scope.patientIdFor(principal)).toBe(mine.publicId);
    expect(await scope.owns(principal, mine.publicId)).toBe(true);
    expect(await scope.owns(principal, theirs.publicId)).toBe(false);

    await harness.prisma.db.patient.update({ where: { id: mine.id }, data: { userId: null } });
  });

  it('answers 404, never 403, for another patient (no enumeration)', async () => {
    // A 403 confirms the row exists. Walking `PT-1000, PT-1001, …`
    // against a 403/404 split would disclose the clinic's roster without
    // reading a single chart — the enumeration is the disclosure.
    const session = await signUpPatient();
    const scope = harness.app.get(PatientSelfScopeService);
    const theirs = records[1]!;

    const principal = { userId: session.userId, roleCode: 'patient' };

    await expect(scope.assertOwns(principal, theirs.publicId)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('treats an unlinked account as owning nothing, without erroring', async () => {
    // The normal state straight after registration. A route must render
    // it as an empty collection or a null profile — a success — not as a
    // failure, so the resolver returns null rather than throwing.
    const session = await signUpPatient();
    const scope = harness.app.get(PatientSelfScopeService);

    expect(await scope.patientIdFor({ userId: session.userId, roleCode: 'patient' })).toBeNull();
  });

  it('resolves a doctor or admin principal to no patient record', async () => {
    // Collapsed with the unlinked case on purpose: both mean "this caller
    // has no patient data here", and a route cannot leak which it was.
    const scope = harness.app.get(PatientSelfScopeService);
    const doctor = await harness.prisma.user.findFirstOrThrow({
      where: { role: { code: 'doctor' } },
    });

    expect(await scope.patientIdFor({ userId: doctor.id, roleCode: 'doctor' })).toBeNull();
  });
});
