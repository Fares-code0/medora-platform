import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdentityRepository } from '../src/modules/auth/repositories/identity.repository';

import {
  type AuthHarness,
  createAuthHarness,
  errorBody,
  patientRegistrationBody,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import { body as mailBody, header } from './support/smtp-sink';

/**
 * `POST /auth/register` (RM M6.1, API §1.1).
 *
 * The roadmap's verification, one `it` at a time: register → 201
 * `{ nextStep: "verify-email" }`; duplicate → 409; the mail server shows
 * the email. Everything beyond that is a property the contract states
 * and a plausible implementation could get wrong.
 */
let harness: AuthHarness;
const REGISTER = '/api/v1/auth/register';

beforeAll(async () => {
  harness = await createAuthHarness('register');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('registration', () => {
  it('creates the account and answers 201 with the next step', async () => {
    const response = await request(harness.server).post(REGISTER).send(registrationBody());

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      data: { nextStep: 'verify-email', email: testEmail('priya') },
    });
  });

  it('sends a verification email a relay actually received', async () => {
    await request(harness.server).post(REGISTER).send(registrationBody());

    const mail = harness.sink.lastTo(testEmail('priya'));
    expect(mail).toBeDefined();
    expect(header(mail!, 'Subject')).toBe('Verify your Medora account');
    // The link lands on the frontend route the page reads `token` from.
    expect(mailBody(mail!)).toContain('http://localhost:5173/verify-email?token=');
    expect(mailBody(mail!)).toContain('Dr. Priya Nair');
  });

  it('stores only the hash of the emailed token', async () => {
    await request(harness.server).post(REGISTER).send(registrationBody());
    const raw = tokenFromLink(mailBody(harness.sink.lastTo(testEmail('priya'))!));

    const stored = await harness.prisma.verificationToken.findFirst({
      where: { user: { email: testEmail('priya') } },
    });

    // A database disclosure must not be replayable into an account.
    expect(stored).not.toBeNull();
    expect(stored?.tokenHash).not.toBe(raw);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.kind).toBe('EMAIL_VERIFICATION');
    expect(stored?.usedAt).toBeNull();
  });

  it('gives the verification token a 24-hour life (API §1.1)', async () => {
    const before = Date.now();
    await request(harness.server).post(REGISTER).send(registrationBody());

    const stored = await harness.prisma.verificationToken.findFirstOrThrow({
      where: { user: { email: testEmail('priya') } },
    });

    const ttlMs = stored.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan(23.5 * 60 * 60 * 1_000);
    expect(ttlMs).toBeLessThanOrEqual(24 * 60 * 60 * 1_000 + 5_000);
  });

  it('leaves the account unverified, with both consents timestamped', async () => {
    await request(harness.server).post(REGISTER).send(registrationBody());

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('priya') },
    });

    expect(user.emailVerifiedAt).toBeNull();
    expect(user.termsAcceptedAt).toBeInstanceOf(Date);
    expect(user.privacyAcceptedAt).toBeInstanceOf(Date);
    expect(user.publicId.startsWith('usr_')).toBe(true);
  });

  it('stores an argon2id hash and never the password', async () => {
    await request(harness.server).post(REGISTER).send(registrationBody());

    const credential = await harness.prisma.userCredential.findFirstOrThrow({
      where: { user: { email: testEmail('priya') } },
    });

    expect(credential.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(credential.passwordHash).not.toContain('Medora123!');
    expect(credential.failedAttempts).toBe(0);
    expect(credential.lockedUntil).toBeNull();
  });

  it('carries the honorific for a doctor and not for a patient', async () => {
    await request(harness.server).post(REGISTER).send(registrationBody());
    await request(harness.server).post(REGISTER).send(patientRegistrationBody());

    const doctor = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('priya') },
    });
    const patient = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('sara') },
    });

    // The seeded mock users show the convention (`features/auth/mock/users.ts`).
    // The honorific is a professional title, not a courtesy — prefixing a
    // patient with one would be wrong rather than merely odd (ADR-030).
    expect(doctor.displayName).toBe('Dr. Priya Nair');
    expect(patient.displayName).toBe('Sara Ali');
  });

  it('creates the doctor profile, PENDING verification (ADR-035 §4)', async () => {
    await request(harness.server)
      .post(REGISTER)
      .send(
        registrationBody({
          professionalRegistrationNumber: 'SCFHS-2291',
          professionalCategory: 'physician',
          specialty: 'Cardiology',
          registrationExpiresOn: '2032-06-30',
        }),
      );

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('priya') },
      include: { doctor: true },
    });

    // Before ADR-035 this row did not exist: signup collected no
    // specialty, which is NOT NULL, so the professional profile could not
    // be created — and a doctor with no `doctors` row is invisible to the
    // verification queue. That was the bug.
    expect(user.doctor).not.toBeNull();
    expect(user.doctor?.licenseNumber).toBe('SCFHS-2291');
    expect(user.doctor?.professionalCategory).toBe('physician');
    expect(user.doctor?.specialty).toBe('Cardiology');
    expect(user.doctor?.licenseExpiresOn?.toISOString().slice(0, 10)).toBe('2032-06-30');

    // PENDING is a claim about Medora's state, not the practitioner's:
    // nothing has checked this number against any register, and nothing
    // in the codebase writes VERIFIED at registration.
    expect(user.doctor?.verificationStatus).toBe('PENDING');
    expect(user.doctor?.verifiedAt).toBeNull();
    expect(user.doctor?.verifiedBy).toBeNull();

    // The legacy mirror still carries it, so nothing that reads the old
    // column regresses.
    expect(user.licenseNumber).toBe('SCFHS-2291');
  });

  it('creates an account and no clinical record for a patient (ADR-030 §4)', async () => {
    const response = await request(harness.server).post(REGISTER).send(patientRegistrationBody());

    expect(response.status).toBe(201);

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('sara') },
      include: { doctor: true, patient: true, role: true },
    });

    expect(user.role.code).toBe('patient');
    // Claiming a clinical record asserts "I am the person in PT-1042",
    // and a wrong assertion discloses one person's history to another.
    expect(user.patient).toBeNull();
    expect(user.doctor).toBeNull();
    expect(user.licenseNumber).toBeNull();
  });

  it('rejects a second account on one professional number', async () => {
    await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ professionalRegistrationNumber: 'SCFHS-DUP' }));

    const response = await request(harness.server)
      .post(REGISTER)
      .send(
        registrationBody({
          email: testEmail('other'),
          professionalRegistrationNumber: 'SCFHS-DUP',
        }),
      );

    // A registration number identifies one practitioner.
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('professional_number_taken');
    expect(errorBody(response).detail).toBeTruthy();
    // And the losing account was not left half-created.
    expect(await harness.prisma.user.count({ where: { email: testEmail('other') } })).toBe(0);
  });

  describe('duplicate email', () => {
    it('answers 409 email_taken', async () => {
      await request(harness.server).post(REGISTER).send(registrationBody());
      const response = await request(harness.server).post(REGISTER).send(registrationBody());

      expect(response.status).toBe(409);
      expect(errorBody(response).code).toBe('email_taken');
      // API §0.3 requires `detail` on every 409.
      expect(errorBody(response).detail).toBeTruthy();
    });

    it('treats a differently-cased address as the same account', async () => {
      await request(harness.server).post(REGISTER).send(registrationBody());
      const response = await request(harness.server)
        .post(REGISTER)
        .send(registrationBody({ email: testEmail('PRIYA').toUpperCase() }));

      // citext (DB §A4) — `Doctor@…` and `doctor@…` cannot be two accounts.
      expect(response.status).toBe(409);
      expect(errorBody(response).code).toBe('email_taken');
    });

    it('lets exactly one of two simultaneous signups win', async () => {
      // The pre-check cannot see a row that is not committed yet; the
      // unique index is what makes this correct.
      const [first, second] = await Promise.all([
        request(harness.server).post(REGISTER).send(registrationBody()),
        request(harness.server).post(REGISTER).send(registrationBody()),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);
      expect(await harness.prisma.user.count({ where: { email: testEmail('priya') } })).toBe(1);
    });

    it('sends no second verification email', async () => {
      await request(harness.server).post(REGISTER).send(registrationBody());
      harness.sink.clear();
      await request(harness.server).post(REGISTER).send(registrationBody());

      expect(harness.sink.messages).toHaveLength(0);
    });
  });

  describe('validation (API §0.3 — 422 with fieldErrors)', () => {
    it.each([
      ['password', 'Medora1234', 'no symbol'],
      ['password', 'medora123!', 'no uppercase'],
      ['password', 'Med1!', 'too short'],
      ['phone', 'not-a-phone', 'fails the frontend pattern'],
      ['email', 'not-an-email', 'not an address'],
      ['firstName', '', 'empty'],
    ])('rejects %s = %j (%s)', async (field, value) => {
      const response = await request(harness.server)
        .post(REGISTER)
        .send(registrationBody({ [field]: value }));

      expect(response.status).toBe(422);
      expect(errorBody(response).code).toBe('validation_failed');
      expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain(field);
    });

    it('refuses a signup that does not accept both policies', async () => {
      // `users.terms_accepted_at` is NOT NULL by design: an account with
      // no recorded consent is a compliance gap, and `false` here is the
      // only way one could be created.
      for (const field of ['acceptTerms', 'acceptPrivacy']) {
        const response = await request(harness.server)
          .post(REGISTER)
          .send(registrationBody({ [field]: false }));

        expect(response.status).toBe(422);
        expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain(field);
      }

      expect(await harness.prisma.user.count({ where: { email: testEmail('priya') } })).toBe(0);
    });

    it('refuses a role outside the union', async () => {
      const response = await request(harness.server)
        .post(REGISTER)
        .send(registrationBody({ role: 'superuser' }));

      expect(response.status).toBe(422);
      expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain('role');
    });

    describe('public administrator registration (ADR-035 §5)', () => {
      it('refuses role: admin, and creates nothing', async () => {
        // The property this whole change exists to create. Before
        // ADR-035 this request answered 201 and produced an account
        // holding `roles.manage`, `settings.manageSystem`,
        // `patients.revealIdentity` and `logs.export`.
        const response = await request(harness.server)
          .post(REGISTER)
          .send(registrationBody({ email: testEmail('marcus'), role: 'admin' }));

        expect(response.status).toBe(422);
        expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain('role');
        expect(await harness.prisma.user.count({ where: { email: testEmail('marcus') } })).toBe(0);
      });

      it('refuses it the same way whatever else the body carries', async () => {
        // Not defeated by sending the professional block too, nor by
        // omitting it — `admin` is absent from the discriminated union,
        // so no branch matches and the shape of the rest is irrelevant.
        for (const body of [
          { email: testEmail('marcus2'), role: 'admin' },
          {
            email: testEmail('marcus3'),
            role: 'admin',
            professionalRegistrationNumber: undefined,
            professionalCategory: undefined,
            specialty: undefined,
          },
        ]) {
          const response = await request(harness.server)
            .post(REGISTER)
            .send(registrationBody(body));
          expect(response.status).toBe(422);
        }

        expect(
          await harness.prisma.user.count({
            where: { email: { in: [testEmail('marcus2'), testEmail('marcus3')] } },
          }),
        ).toBe(0);
      });

      it('refuses every other privileged role too', async () => {
        for (const role of ['reception', 'laboratory', 'pharmacy', 'nurse']) {
          const response = await request(harness.server)
            .post(REGISTER)
            .send(registrationBody({ email: testEmail(`staff-${role}`), role }));

          expect(response.status).toBe(422);
        }
      });
    });

    describe('the doctor professional block (ADR-035 §4)', () => {
      it('requires the number, the category and the specialty', async () => {
        for (const field of [
          'professionalRegistrationNumber',
          'professionalCategory',
          'specialty',
        ]) {
          const body = registrationBody();
          delete body[field];

          const response = await request(harness.server).post(REGISTER).send(body);

          expect(response.status).toBe(422);
          expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain(field);
        }

        expect(await harness.prisma.user.count({ where: { email: testEmail('priya') } })).toBe(0);
      });

      it('refuses a category outside the register vocabulary', async () => {
        const response = await request(harness.server)
          .post(REGISTER)
          .send(registrationBody({ professionalCategory: 'astronaut' }));

        expect(response.status).toBe(422);
        expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain(
          'professionalCategory',
        );
      });

      it('refuses an already-expired registration', async () => {
        // Accepting one would seed an expired credential at creation.
        const response = await request(harness.server)
          .post(REGISTER)
          .send(registrationBody({ registrationExpiresOn: '2020-01-01' }));

        expect(response.status).toBe(422);
        expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain(
          'registrationExpiresOn',
        );
      });

      it('strips the professional block from a patient registration', async () => {
        // The patient branch has no such fields, so Zod removes them
        // rather than erroring — a patient client cannot set a
        // registration number even by sending one.
        const response = await request(harness.server)
          .post(REGISTER)
          .send(
            patientRegistrationBody({
              professionalRegistrationNumber: 'SCFHS-SNEAK',
              specialty: 'Cardiology',
            }),
          );

        expect(response.status).toBe(201);

        const user = await harness.prisma.user.findUniqueOrThrow({
          where: { email: testEmail('sara') },
          include: { doctor: true },
        });
        expect(user.doctor).toBeNull();
        expect(user.licenseNumber).toBeNull();
      });
    });

    it('ignores confirmPassword rather than failing on it', async () => {
      // API §1.1 — the server has one password and nothing to compare it
      // against, so the cross-field rule stays on the client.
      const response = await request(harness.server)
        .post(REGISTER)
        .send(registrationBody({ confirmPassword: 'something-else' }));

      expect(response.status).toBe(201);
    });

    it('creates nothing when validation fails', async () => {
      await request(harness.server)
        .post(REGISTER)
        .send(registrationBody({ password: 'weak' }));

      expect(await harness.prisma.user.count({ where: { email: testEmail('priya') } })).toBe(0);
      expect(harness.sink.messages).toHaveLength(0);
    });
  });
});

/**
 * The races the pre-checks cannot win, made deterministic.
 *
 * `register` asks "is this address taken?" and "is this number taken?"
 * before it writes, and the unique indexes are what make the answer true
 * when two signups arrive together. The concurrent test above fires two
 * requests and hopes both pass the pre-check, which they usually do and
 * need not. Here the pre-check on the real repository is told to answer
 * "free" while the row really exists, so the request always reaches
 * PostgreSQL's unique violation through the real driver adapter. That is
 * the error whose shape changed under Prisma 7.10 and once turned this
 * 409 into a 500 (`prisma-errors.ts`).
 */
describe('the races a pre-check cannot win', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers 409 professional_number_taken when the number is claimed mid-request', async () => {
    await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ professionalRegistrationNumber: 'SCFHS-RACE' }));
    vi.spyOn(harness.app.get(IdentityRepository), 'professionalNumberTaken').mockResolvedValue(
      false,
    );

    const loser = testEmail('race-number');
    const response = await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email: loser, professionalRegistrationNumber: 'SCFHS-RACE' }));

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('professional_number_taken');
    // The account and its doctor profile are one statement, so the loser
    // leaves no `users` row behind to make the address unregisterable.
    expect(await harness.prisma.user.count({ where: { email: loser } })).toBe(0);
  });

  it('answers 409 email_taken when the address is claimed mid-request', async () => {
    await request(harness.server).post(REGISTER).send(registrationBody());
    vi.spyOn(harness.app.get(IdentityRepository), 'findByEmail').mockResolvedValue(null);

    const response = await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ professionalRegistrationNumber: 'SCFHS-RACE-2' }));

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('email_taken');
    expect(await harness.prisma.user.count({ where: { email: testEmail('priya') } })).toBe(1);
  });

  it('lets any other write failure surface as a 500, not as a 409', async () => {
    // Only a unique violation is "taken". Mapping every failure to 409
    // would tell a user their address is in use when the database was down.
    vi.spyOn(harness.app.get(IdentityRepository), 'createAccount').mockRejectedValue(
      new Error('Connection terminated unexpectedly'),
    );

    const response = await request(harness.server).post(REGISTER).send(registrationBody());

    expect(response.status).toBe(500);
    expect(errorBody(response).code).toBe('internal_error');
  });

  it('answers 503, not 400, when the roles were never seeded', async () => {
    // An operator problem: the caller's request was fine.
    vi.spyOn(harness.app.get(IdentityRepository), 'findRoleByCode').mockResolvedValue(null);

    const response = await request(harness.server).post(REGISTER).send(registrationBody());

    expect(response.status).toBe(503);
    expect(errorBody(response).code).toBe('service_unavailable');
    expect(await harness.prisma.user.count({ where: { email: testEmail('priya') } })).toBe(0);
  });
});
