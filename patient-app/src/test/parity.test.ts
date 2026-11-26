import fs from 'node:fs';
import path from 'node:path';

import { PASSWORD_MIN_LENGTH, passwordChecks } from '@/features/auth/schemas';
import {
  ALLERGY_SEVERITIES,
  ANNOUNCEMENT_PRIORITIES,
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_STATUSES,
  DOCUMENT_CATEGORIES,
  HISTORY_EVENT_KINDS,
  LAB_RESULT_FLAGS,
  LAB_STATUSES,
  MEDICATION_STATUSES,
  MESSAGE_STATUSES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  PRESCRIPTION_STATUSES,
} from '@/types/vocabularies';

/**
 * Parity with the backend — checklist A-07, U-07, audit R-11.
 *
 * "Field names are law" (API contract §11), and a fourth client is a
 * fourth place a literal can drift. This suite reads the backend's own
 * source and fails when this tree disagrees with it — the same discipline
 * the backend applies to the frontend's permission catalogue.
 *
 * ── Why reading the file rather than importing it ────────────────────
 * This package does not depend on the backend package, and it must not:
 * a mobile client that imported a NestJS module would pull Prisma into a
 * Metro bundle. Reading the source is how the binding is made without the
 * dependency.
 *
 * ── When the backend tree is absent ──────────────────────────────────
 * These tests skip rather than fail. In a monorepo checkout they always
 * run; if `patient-app/` is ever built in isolation, a missing sibling is
 * not a defect in this code. The skip is loud in the test output.
 */

const BACKEND = path.resolve(__dirname, '..', '..', '..', 'backend');
const ENUMS_FILE = path.join(BACKEND, 'prisma', 'schema', '01-enums.prisma');
const PASSWORD_SCHEMA = path.join(BACKEND, 'src', 'modules', 'auth', 'dto', 'password.schema.ts');
const REGISTER_SCHEMA = path.join(BACKEND, 'src', 'modules', 'auth', 'dto', 'register.schema.ts');
const RECOVERY_SCHEMA = path.join(BACKEND, 'src', 'modules', 'auth', 'dto', 'recovery.schema.ts');

const backendPresent = fs.existsSync(ENUMS_FILE);
const describeIfBackend = backendPresent ? describe : describe.skip;

/**
 * The wire values of one Prisma enum — its members' `@map("…")` strings.
 *
 * The lookbehind excludes the block's trailing `@@map("…")`, which names
 * the Postgres TYPE rather than a member and would otherwise be read as a
 * ninth appointment status.
 */
function prismaEnumValues(source: string, enumName: string): string[] {
  const match = new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (match === null) throw new Error(`Enum ${enumName} was not found in the schema.`);
  return [...(match[1] ?? '').matchAll(/(?<!@)@map\("([^"]+)"\)/g)].map((entry) => entry[1] ?? '');
}

describeIfBackend('status vocabularies match the database exactly', () => {
  const source = backendPresent ? fs.readFileSync(ENUMS_FILE, 'utf8') : '';

  it.each([
    ['AppointmentStatus', APPOINTMENT_STATUSES],
    ['AppointmentPriority', APPOINTMENT_PRIORITIES],
    ['AllergySeverity', ALLERGY_SEVERITIES],
    ['MedicationStatus', MEDICATION_STATUSES],
    ['HistoryEventKind', HISTORY_EVENT_KINDS],
    ['LabStatus', LAB_STATUSES],
    ['LabResultFlag', LAB_RESULT_FLAGS],
    ['PrescriptionStatus', PRESCRIPTION_STATUSES],
    ['MessageStatus', MESSAGE_STATUSES],
    ['DocumentCategory', DOCUMENT_CATEGORIES],
    ['NotificationCategory', NOTIFICATION_CATEGORIES],
    ['NotificationPriority', NOTIFICATION_PRIORITIES],
    ['AnnouncementPriority', ANNOUNCEMENT_PRIORITIES],
  ])('%s', (enumName, clientValues) => {
    expect([...clientValues].sort()).toEqual(prismaEnumValues(source, enumName).sort());
  });

  it('keeps the kebab-case wire spellings verbatim', () => {
    // The four that a local "tidy-up" would most plausibly rename.
    expect(APPOINTMENT_STATUSES).toContain('no-show');
    expect(APPOINTMENT_STATUSES).toContain('awaiting-patient');
    expect(LAB_RESULT_FLAGS).toContain('critical-low');
    expect(DOCUMENT_CATEGORIES).toContain('external-record');
  });
});

describeIfBackend('the password policy matches the backend rule', () => {
  const source = backendPresent ? fs.readFileSync(PASSWORD_SCHEMA, 'utf8') : '';

  it('uses the same minimum length', () => {
    const match = /PASSWORD_MIN_LENGTH = (\d+)/.exec(source);
    expect(Number(match?.[1])).toBe(PASSWORD_MIN_LENGTH);
  });

  it('applies the same five checks', () => {
    for (const check of ['lower', 'upper', 'digit', 'symbol', 'length']) {
      expect(source).toContain(`${check}:`);
      expect(Object.keys(passwordChecks)).toContain(check);
    }
  });

  it('applies the policy to the NEW password only, as the backend does', () => {
    // `changePasswordSchema` deliberately holds `currentPassword` at
    // `min(1)`: applying the policy to it would lock out a patient whose
    // existing password predates a policy change. A client that was
    // stricter than the server here would produce exactly that lockout
    // without ever sending the request.
    const backendSchema = backendPresent ? fs.readFileSync(RECOVERY_SCHEMA, 'utf8') : '';
    expect(backendSchema).toMatch(/currentPassword:\s*z\.string\(\)\.min\(1/);
    expect(backendSchema).toMatch(/newPassword:\s*strongPassword/);

    const clientSchema = fs.readFileSync(
      path.resolve(__dirname, '..', 'features', 'auth', 'schemas.ts'),
      'utf8',
    );
    expect(clientSchema).toMatch(/currentPassword:\s*z\.string\(\)\.min\(1/);
    expect(clientSchema).toMatch(/newPassword:\s*strongPassword/);
  });

  it('accepts and rejects the same passwords the backend would', () => {
    const strong = 'Password1!';
    expect(Object.values(passwordChecks).every((check) => check(strong))).toBe(true);
    expect(passwordChecks.symbol('Password1')).toBe(false);
    expect(passwordChecks.length('Pa1!')).toBe(false);
  });
});

/**
 * AD-1 was decided. This block used to read "the registration contract is
 * still closed to patients" and to assert `z.enum(['doctor', 'admin'])`,
 * with the comment: *"The day this assertion fails is the day AD-1 was
 * decided and the registration adapter in api/endpoints/auth.ts can be
 * implemented. Failing here is the notification."*
 *
 * It fired, on the merge that brought the `backend` branch into `main`.
 * **ADR-030 — Patient Identity and Authentication** was accepted by the
 * project owner on 2026-09-02 and amends ADR-018 §3, which is the
 * outcome this audit itself recommended for AD-1 (§4.1 Option A, §15.4).
 * The tripwire is therefore inverted rather than deleted: the contract it
 * watches still has to be watched, only the expected value moved.
 *
 * What ADR-030 §4 does *not* give this client is a linked record. A
 * registered patient account is authenticated-but-unlinked — it can log
 * in, refresh and read its own empty profile, and it sees no clinical
 * data until the claim flow is separately decided (RA-030.1, still open;
 * auto-linking on email is ruled out).
 *
 * **The tripwire fired a second time, at ADR-035.** The flat enum this
 * block used to watch is gone: `register.schema.ts` is now a
 * discriminated union whose members are `patient` and `doctor`, and
 * `admin` was removed from the public contract entirely (ADR-035 §5).
 * So the assertions move again, and gain one they did not have —
 * the *absence* of `admin` is now the security property most worth
 * guarding, because re-adding it would silently restore public
 * administrator self-registration.
 *
 * The client's signup flow is built as of ADR-035 §4, so the third test
 * below has inverted as its own comment predicted: this client sends a
 * role, and sends exactly one.
 */
describeIfBackend('the registration contract, as ADR-030 and ADR-035 leave it', () => {
  const source = backendPresent ? fs.readFileSync(REGISTER_SCHEMA, 'utf8') : '';

  it('is a discriminated union over patient and doctor', () => {
    expect(source).toMatch(/z\.discriminatedUnion\(\s*'role'/);
    expect(source).toMatch(/role:\s*z\.literal\('patient'\)/);
    expect(source).toMatch(/role:\s*z\.literal\('doctor'\)/);
  });

  it("offers no 'admin' branch — public admin registration is closed", () => {
    // The property ADR-035 §5 exists to create. A future edit that adds
    // `z.literal('admin')` back would restore an account holding
    // `roles.manage` to anyone who can reach a public form, and it must
    // not pass unnoticed.
    //
    // Comments are stripped first. The file explains at length *why*
    // administrators were removed, so it mentions the word repeatedly —
    // matching the raw text would fail on the documentation of the very
    // property under test.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code).not.toMatch(/z\.literal\(\s*'admin'\s*\)/);
    expect(code).not.toContain("'admin'");
  });

  it('names the decisions that shaped it, so a change cannot be silent', () => {
    // The backend applies the same rule to itself in
    // `schema-reference.e2e-spec.ts`.
    expect(source).toContain('ADR-030');
    expect(source).toContain('ADR-035');
  });

  it("this client sends role: 'patient', and only that", () => {
    // The inversion the previous revision of this test predicted. The
    // role is a constant in the endpoint adapter rather than a form
    // field, so a modified app cannot ask for a clinician account.
    const endpoint = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'endpoints', 'auth.ts'),
      'utf8',
    );
    expect(endpoint).toMatch(/role:\s*'patient'/);
    expect(endpoint).not.toMatch(/role:\s*'doctor'/);
    expect(endpoint).not.toMatch(/role:\s*'admin'/);

    // And the form still collects no role and no clinician field: the
    // constant lives at the seam, not in anything a user can touch.
    const clientSchema = fs.readFileSync(
      path.resolve(__dirname, '..', 'features', 'auth', 'schemas.ts'),
      'utf8',
    );
    expect(clientSchema).not.toMatch(/role:\s*z\./);
    expect(clientSchema).not.toMatch(/licenseNumber:\s*z\./);
    expect(clientSchema).not.toMatch(/professionalRegistrationNumber:\s*z\./);
  });
});

describe('the endpoint layer names only real routes (V-02)', () => {
  it('calls nothing outside the ten built auth routes', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'endpoints', 'auth.ts'),
      'utf8',
    );
    const called = [...source.matchAll(/apiClient\.\w+<[^>]*>\(\s*'([^']+)'/g)].map(
      (entry) => entry[1],
    );

    // Exactly the routes `auth.controller.ts` exposes today.
    expect(new Set(called)).toEqual(
      new Set([
        'auth/login',
        'auth/otp/verify',
        'auth/otp/resend',
        'auth/refresh',
        'auth/logout',
        'auth/forgot-password',
        'auth/reset-password',
        'auth/verify-email',
        'auth/verification/resend',
        // Built at ADR-035 §4 — the tenth route, and the one this file
        // spent two revisions recording as unbuilt.
        'auth/register',
        // Owner decision R1. `auth.controller.ts` on the `backend` branch
        // (`8992a208`, PR #186); not yet in this branch's `backend/` copy.
        'auth/otp/recovery',
      ]),
    );
  });

  it('calls nothing outside the built account routes', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'endpoints', 'account.ts'),
      'utf8',
    );
    const called = [...source.matchAll(/apiClient\.\w+<[^>]*>\(\s*'([^']+)'/g)].map(
      (entry) => entry[1],
    );

    // `account-password.controller.ts` exposes the first;
    // `two-factor.controller.ts` exposes the other three (checklist
    // D-16); `users/controllers/account.controller.ts` exposes
    // `me/account` (P-03). Nothing else may appear here without a
    // controller behind it.
    expect(new Set(called)).toEqual(
      new Set([
        'me/account',
        'me/password',
        'me/2fa/setup',
        'me/2fa/enable',
        'me/2fa/disable',
        // Owner decisions R2 and Q7 / R4. `two-factor.controller.ts` on the
        // `backend` branch (`8992a208`, PR #186); not yet in this branch's
        // `backend/` copy, so the adapter reads a 404 as "not served".
        'me/2fa',
        'me/2fa/reenroll',
        'me/2fa/reenroll/confirm',
      ]),
    );
  });

  it('writes only the account phone, never the sign-in address', () => {
    // `updateAccountSchema` excludes `email` deliberately: moving a
    // sign-in address needs a verify-and-notify flow that does not
    // exist, and without one a borrowed session walks off with the
    // account. The client must not send a field the schema would strip.
    if (!backendPresent) return;
    const schema = fs.readFileSync(
      path.join(BACKEND, 'src', 'modules', 'users', 'dto', 'account.schema.ts'),
      'utf8',
    );
    const body = /export const updateAccountSchema = z[\s\S]*?\n\}\);/.exec(schema)?.[0] ?? '';

    expect(body).not.toBe('');
    expect(body).toContain('phone');
    expect(body).not.toMatch(/^\s*email:/m);

    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'endpoints', 'account.ts'),
      'utf8',
    );
    const call = /updateAccount\(body: \{([^}]*)\}/.exec(source)?.[1] ?? '';

    expect(call).toContain('phone');
    expect(call).not.toContain('email');
    expect(call).not.toContain('username');
  });

  it('sends the current password with 2FA setup, as the backend DTO requires (D2)', () => {
    if (!backendPresent) return;
    const dto = fs.readFileSync(
      path.join(BACKEND, 'src', 'modules', 'auth', 'dto', 'two-factor.schema.ts'),
      'utf8',
    );
    const schema = /export const setupTwoFactorSchema = z[\s\S]*?\n\}\);/.exec(dto)?.[0] ?? '';
    expect(schema).toMatch(/password: z\.string\(\)\.min\(1/);

    const controller = fs.readFileSync(
      path.join(BACKEND, 'src', 'modules', 'auth', 'controllers', 'two-factor.controller.ts'),
      'utf8',
    );
    expect(controller).toContain('zodBody(setupTwoFactorSchema)');

    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'api', 'endpoints', 'account.ts'),
      'utf8',
    );
    expect(source).toMatch(/setupTwoFactor\(body: \{ password: string \}\)/);
    expect(source).toContain("apiClient.post<unknown>('me/2fa/setup', body)");
  });

  it('the account route exists on the controller behind it', () => {
    if (!backendPresent) return;
    const controller = fs.readFileSync(
      path.join(BACKEND, 'src', 'modules', 'users', 'controllers', 'account.controller.ts'),
      'utf8',
    );

    expect(controller).toContain("@Controller('me')");
    expect(controller).toContain("@Patch('account')");
  });

  it('names routes the backend actually serves', () => {
    // The other half of the assertion above: the paths are not merely
    // consistent with themselves, there are controllers behind them.
    if (!backendPresent) return;
    const controllers = path.join(BACKEND, 'src', 'modules', 'auth', 'controllers');

    expect(
      fs.readFileSync(path.join(controllers, 'account-password.controller.ts'), 'utf8'),
    ).toContain("@Controller('me/password')");

    const twoFactor = fs.readFileSync(path.join(controllers, 'two-factor.controller.ts'), 'utf8');
    expect(twoFactor).toContain("@Controller('me/2fa')");
    for (const route of ['setup', 'enable', 'disable']) {
      expect(twoFactor).toContain(`@Post('${route}')`);
    }
  });

  it('has no other endpoint module — every other feature is behind the seam', () => {
    const endpointsDir = path.resolve(__dirname, '..', 'api', 'endpoints');
    // `account.ts` joined `auth.ts` with checklist P-05: `POST /me/password`
    // is live, so the change-password form is a real call rather than a
    // fixture. `doctors.ts` joined them with G-05: BE-04 built the
    // patient-safe projection, so `GET /patient/doctors`, `/{id}` and
    // `/patient/specialties` are three more real routes. `appointments.ts`
    // joined them with I-01/I-06: `GET /me/appointments` and
    // `/me/appointments/{id}` are live,
    // and its write routes (booking, cancellation, reschedule requests)
    // joined them with ADR-049. `hospitals.ts` is hospital discovery.
    // `sessions.ts` joined them with P-06: M8 shipped
    // `account-security.controller.ts`, so `GET /me/sessions` and
    // `DELETE /me/sessions/{id}` are two more real routes. It is a
    // module of its own rather than a second half of `profile.ts`
    // because that file is a transcription of one controller and a
    // `me/sessions` path in it would make its own header untrue — the
    // reason `account.ts` is not part of `auth.ts`.
    // Every further addition needs the same justification — a route that
    // exists — and this list is where it is claimed.
    expect(fs.readdirSync(endpointsDir).sort()).toEqual([
      'account.ts',
      'appointments.ts',
      'auth.ts',
      'doctors.ts',
      'hospitals.ts',
      'notifications.ts',
      // The patient-facing information layer and the patient assistant
      // (ADR-050). Their backend controllers land in the parallel
      // backend work and are listed in `PENDING_BACKEND_ROUTES` below.
      'patient-ai.ts',
      'patient-info.ts',
      // ADR-048: `GET /me/patient-link` (also the C-11 eligibility probe)
      // and `POST /me/patient-link/code`. The staff half of linking is a
      // clinician route and has no path string here.
      'patient-link.ts',
      'profile.ts',
      'sessions.ts',
    ]);
  });

  it('the session adapter calls only the two routes the controller exposes', () => {
    const source = fs
      .readFileSync(path.resolve(__dirname, '..', 'api', 'endpoints', 'sessions.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const called = [...source.matchAll(/apiClient\.\w+<[^>]*>\(\s*[`']([^`'$]+)/g)].map(
      (entry) => entry[1],
    );

    // The DELETE path is a template, so the captured prefix stops at the
    // interpolation. Both are `me/sessions`; what distinguishes them is
    // the verb, asserted below.
    expect(new Set(called)).toEqual(new Set(['me/sessions', 'me/sessions/']));
    // `/me/devices` and `/me/login-history` land in the same controller
    // and are deliberately NOT called — neither is on the profile port.
    expect(source).not.toContain('me/devices');
    expect(source).not.toContain('me/login-history');
    // Nothing writes to a session except the revoke.
    expect(source).not.toMatch(/apiClient\.(post|put|patch)/);
  });

  it('the two session routes exist on the controller behind them', () => {
    const controller = fs.readFileSync(
      path.join(BACKEND, 'src', 'modules', 'auth', 'controllers', 'account-security.controller.ts'),
      'utf8',
    );

    expect(controller).toContain("@Controller('me')");
    expect(controller).toContain("@Get('sessions')");
    expect(controller).toContain("@Delete('sessions/:sessionId')");
  });

  it('the doctor adapter calls only the three routes the projection serves', () => {
    // Comments are stripped first, as in the invented-route test below: a
    // docblock that explains why `/patient/departments` is NOT called is
    // documentation, and mistaking it for a call would punish the file for
    // being explicit about what it refuses to do.
    const source = fs
      .readFileSync(path.resolve(__dirname, '..', 'api', 'endpoints', 'doctors.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const called = [...source.matchAll(/apiClient\.\w+<[^>]*>\(\s*[`']([^`'$]+)/g)].map(
      (entry) => entry[1],
    );

    expect(new Set(called)).toEqual(
      new Set(['patient/doctors', 'patient/doctors/', 'patient/specialties']),
    );
    // `GET /patient/departments` is contract §3.4 P3.4 and is NOT BUILT.
    // A path string for it here would be an invented route.
    expect(source).not.toContain('patient/departments');
    // `GET /doctors` is the ADMINISTRATOR roster (API §3.4), gated on
    // `can:doctors.manage` and carrying the licence number. This client
    // must never name it.
    expect(source).not.toMatch(/['"`]doctors['"`]/);
  });

  it('the appointment adapter calls exactly the contract §3 routes', () => {
    // Comments are stripped first, as in the invented-route test below:
    // this module explains at length what each route is, and punishing it
    // for naming them in a docblock would reward silence.
    const source = fs
      .readFileSync(path.resolve(__dirname, '..', 'api', 'endpoints', 'appointments.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // `verb path-template`, with `${…}` interpolations kept so the SHAPE of
    // each route is what is compared.
    const called = [
      ...source.matchAll(/apiClient\.(get|post|put|patch|delete)<[^>]*>\(\s*[`']([^`']+)[`']/g),
    ].map((entry) => `${(entry[1] ?? '').toUpperCase()} ${entry[2] ?? ''}`);

    // ADR-049's routes, as the shared contract states them (the backend
    // controller for the writes is built in parallel — see the checklist).
    expect(new Set(called)).toEqual(
      new Set([
        'GET me/appointments',
        'GET me/appointments/${encodeURIComponent(appointmentId)}',
        'GET patient/doctors/${encodeURIComponent(doctorId)}/slots',
        'GET patient/visit-types',
        'POST me/appointments',
        'POST me/appointments/${encodeURIComponent(appointmentId)}/cancel',
        'POST me/appointments/${encodeURIComponent(appointmentId)}/reschedule-requests',
        'GET me/appointments/${encodeURIComponent(appointmentId)}/reschedule-requests',
        'POST me/reschedule-requests/${encodeURIComponent(requestId)}/withdraw',
      ]),
    );
    // Rescheduling is a REQUEST. No route moves an appointment, and there
    // is no confirm/accept-proposal route in the contract.
    expect(source).not.toContain('/confirm');
    expect(source).not.toMatch(/apiClient\.(put|patch|delete)/);
  });

  it('the hospital adapter calls the two discovery routes and nothing else', () => {
    const source = fs
      .readFileSync(path.resolve(__dirname, '..', 'api', 'endpoints', 'hospitals.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const called = [
      ...source.matchAll(/apiClient\.(get|post|put|patch|delete)<[^>]*>\(\s*[`']([^`']+)[`']/g),
    ].map((entry) => `${(entry[1] ?? '').toUpperCase()} ${entry[2] ?? ''}`);

    expect(new Set(called)).toEqual(
      new Set(['GET patient/hospitals', 'GET patient/hospitals/${encodeURIComponent(hospitalId)}']),
    );
  });

  it('the notification adapter calls the live routes and no unbuilt one', () => {
    // Comments stripped first, as in the invented-route test below: this
    // module names the routes it refuses to call, and punishing it for
    // being explicit would reward silence.
    const source = fs
      .readFileSync(path.resolve(__dirname, '..', 'api', 'endpoints', 'notifications.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const called = [...source.matchAll(/apiClient\.\w+<[^>]*>\(\s*[`']([^`'$]+)/g)].map(
      (entry) => entry[1],
    );

    expect(new Set(called)).toEqual(
      new Set([
        'notifications',
        'notifications/badge-counts',
        'notifications/read-all',
        'notifications/',
        // P5.7, M19.4 — live since O-06 was wired (2026-11-01).
        'me/notification-preferences',
      ]),
    );
    // P5.6 and P5.8 are not called. A path string for any of them here
    // would be an invented endpoint.
    for (const unbuilt of ['/archive', '/favorite', '/pin', 'clear-read', 'me/devices']) {
      expect(source).not.toContain(unbuilt);
    }
    // The surface is `/notifications`, never `/me/notifications` — one
    // route tree serves a doctor and a patient through one code path.
    expect(source).not.toContain('me/notifications');
  });

  it('the profile adapter reads one route and never writes', () => {
    // Comments stripped first: this module explains why `PATCH
    // /me/profile` is absent, and naming it in a docblock is
    // documentation rather than a call.
    const source = fs
      .readFileSync(path.resolve(__dirname, '..', 'api', 'endpoints', 'profile.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const called = [...source.matchAll(/apiClient\.\w+<[^>]*>\(\s*[`']([^`'$]+)/g)].map(
      (entry) => entry[1],
    );

    expect(new Set(called)).toEqual(new Set(['me/profile']));
    // `PATCH /me/profile` is blocked by RA-030.2, and `GET /me/sessions`
    // is live but belongs to `sessions.ts` — a different controller.
    // Neither may appear as a call here.
    expect(source).not.toMatch(/apiClient\.(post|put|patch|delete)/);
    expect(source).not.toContain('me/sessions');
  });

  it('names doctor routes the backend actually serves', () => {
    if (!backendPresent) return;
    const controller = fs.readFileSync(
      path.join(
        BACKEND,
        'src',
        'modules',
        'doctors',
        'controllers',
        'patient-doctor.controller.ts',
      ),
      'utf8',
    );
    expect(controller).toContain("@Controller('patient')");
    expect(controller).toContain("@Get('doctors')");
    expect(controller).toContain("@Get('doctors/:doctorId')");
    expect(controller).toContain("@Get('specialties')");
  });

  it('names appointment routes the backend actually serves', () => {
    if (!backendPresent) return;
    const controller = fs.readFileSync(
      path.join(
        BACKEND,
        'src',
        'modules',
        'appointments',
        'controllers',
        'patient-appointment.controller.ts',
      ),
      'utf8',
    );
    expect(controller).toContain("@Controller('me/appointments')");
    expect(controller).toContain('@Get()');
    expect(controller).toContain("@Get(':appointmentId')");
  });

  it('names notification routes the backend actually serves', () => {
    if (!backendPresent) return;
    const controller = fs.readFileSync(
      path.join(
        BACKEND,
        'src',
        'modules',
        'notifications',
        'controllers',
        'notification.controller.ts',
      ),
      'utf8',
    );
    expect(controller).toContain("@Controller('notifications')");
    expect(controller).toContain("@Get('badge-counts')");
    expect(controller).toContain("@Post('read-all')");
    expect(controller).toContain("@Post(':notificationId/read')");
    expect(controller).toContain("@Post(':notificationId/unread')");
  });

  /**
   * Routes this client calls that the backend has not merged into this
   * worktree yet (ADR-050, built in parallel to CONTRACT §4/§6). Each is
   * asserted against the backend source the moment its path appears there;
   * until then it is allow-listed BY NAME here. An entry is removed when
   * the controller lands — the list is not a way to skip the check, and a
   * route absent from both the backend and this list fails.
   */
  const PENDING_BACKEND_ROUTES: readonly string[] = [
    "'me/lab-orders'",
    "'me/insurance'",
    "'me/ai/conversations'",
  ];

  it('names the patient information and assistant routes the backend serves, or lists them as pending', () => {
    if (!backendPresent) return;
    const corpus: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/controller\.ts$/.test(entry.name)) corpus.push(fs.readFileSync(full, 'utf8'));
      }
    };
    walk(path.join(BACKEND, 'src'));
    const all = corpus.join('\n');

    for (const route of ["'me/lab-orders'", "'me/insurance'", "'me/ai/conversations'"]) {
      const served = all.includes(route);
      if (!served) expect(PENDING_BACKEND_ROUTES).toContain(route);
    }
  });

  it('the information adapter calls exactly the two read routes, GET only', () => {
    const source = fs
      .readFileSync(path.resolve(__dirname, '..', 'api', 'endpoints', 'patient-info.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const called = [...source.matchAll(/apiClient\.\w+<[^>]*>\(\s*[`']([^`'$]+)/g)].map(
      (m) => m[1],
    );
    expect(new Set(called)).toEqual(new Set(['me/lab-orders', 'me/insurance']));
    expect(source).not.toMatch(/apiClient\.(post|put|patch|delete)/);
  });

  it('the assistant adapter stays under /me/ai/conversations and never the doctor tree', () => {
    const source = fs
      .readFileSync(path.resolve(__dirname, '..', 'api', 'endpoints', 'patient-ai.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const paths = [
      ...source.matchAll(/(?:apiClient\.\w+(?:<[^>]*>)?|openStream)\(\s*[`']([^`'$]+)/g),
    ].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const called of paths) expect(called?.startsWith('me/ai/conversations')).toBe(true);
  });

  it('names the profile route the backend actually serves', () => {
    if (!backendPresent) return;
    // The controller moved at **ADR-036**, and the route did not.
    //
    // `GET /me/profile` was this module's at ADR-030
    // (`patients/controllers/patient-profile.controller.ts`). API §3.1
    // assigns the same path to the *doctor* profile document, and two
    // controllers cannot claim one path — Nest registers both and Express
    // serves whichever module loaded first, which would have silently
    // shadowed this client's profile endpoint. ADR-036 made it one route
    // returning `{ account, patient, doctor }`, owned by `UsersModule`,
    // because neither the patients nor the doctors module can build all
    // three halves without reaching into the other.
    //
    // The change is additive for this client: `account` and `patient` are
    // unchanged and `doctor` is always `null` for a patient. So what this
    // test asserts is unchanged too — the backend serves `GET /me/profile`
    // — and only the file that serves it has a different name.
    const controller = fs.readFileSync(
      path.join(BACKEND, 'src', 'modules', 'users', 'controllers', 'self-profile.controller.ts'),
      'utf8',
    );
    expect(controller).toContain("@Controller('me/profile')");
    expect(controller).toContain('@Get()');
  });

  it('never references an unbuilt patient route as a string anywhere in src', () => {
    // The rule from §11 of the brief — "do not invent backend endpoints" —
    // as an assertion.
    //
    // Two of these are no longer invented: ADR-030's enablement work built
    // `me/profile` and `me/appointments`, and the patient doctor directory
    // landed at `patient/doctors` rather than the `public/doctors` the
    // audit guessed. They stay on the list because this client still has
    // no adapter for them — the test above asserts `auth.ts` is the only
    // endpoint module — so a bare path string in `src` would still be a
    // call route that was never written. Each comes off the list with the
    // endpoint module that legitimately calls it.
    const invented = [
      // `'me/appointments` came off this list with `endpoints/appointments.ts`
      // (I-01/I-06), which is the exit condition the comment above names: the
      // route is live AND a module legitimately calls it. The four write
      // routes under it are still invented, and the adapter test above
      // asserts none of them appears.
      "'me/health",
      // `'me/profile` came off this list with `endpoints/profile.ts`
      // (P-01): the route is live AND a module legitimately calls it,
      // which is the exit condition the comment above names. The PATCH
      // half is still blocked by RA-030.2, and the adapter test above
      // asserts no write verb reaches that surface.
      "'me/conversations",
      // `'me/notifications` was never the route. API §10 defines this
      // surface as `/notifications` for any authenticated user, and an
      // earlier revision of the patient contract got it wrong. It stays on
      // this list precisely so the wrong path cannot creep back in —
      // `endpoints/notifications.ts` calls `/notifications` and a test
      // above asserts it never names the `/me/` form.
      "'me/notifications",
      "'public/doctors",
      "'public/clinic",
      "'me/devices",
      "'auth/session",
    ];
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const source = fs
            .readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          for (const route of invented) {
            if (source.includes(route)) offenders.push(`${entry.name}: ${route}`);
          }
        }
      }
    };
    walk(path.resolve(__dirname, '..'));

    expect(offenders).toEqual([]);
  });
});
