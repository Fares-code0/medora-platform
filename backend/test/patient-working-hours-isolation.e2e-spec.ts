import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import { createTestDoctor, destroyTestDoctor, type DoctorRecord } from './support/doctor-fixture';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';
import { body as mailBody } from './support/smtp-sink';

/**
 * Working hours are never patient inventory (AST-C6; DR-10, AF-10, AF-22).
 *
 * > AST-C6 — "`DoctorAvailability` stays doctor-only internal data. No
 * > patient route returns availability-derived times. Verification: e2e
 * > over the patient route table."
 *
 * DR-10 makes doctor-published slots the only thing a patient may book
 * against, and supersedes "computed slots from working hours". The
 * weekday grid (`doctor_availability`) and time off (`doctor_time_off`)
 * are the doctor's own planning data. This suite gives a patient-visible
 * doctor a grid and a time-off window with times that appear nowhere
 * else, then calls **every GET route in the running application** as a
 * signed-in, linked patient and asserts none of those times — and none
 * of the grid's field names — comes back, whatever the status.
 *
 * The route table is read from the application itself rather than
 * listed here, so a patient-reachable GET route added later is swept
 * without anyone remembering to add it. That is the point of AST-C6's
 * "over the patient route table": the published-slot routes of Phase 24
 * will sit beside the grid, and the risk is a new route serialising the
 * wrong table.
 */
let harness: AuthHarness;
let doctor: DoctorRecord;
let records: PatientRecord[];
let patientToken = '';

const DOCTOR_TAG = 'whiso';
const PATIENT_TAG = 'whiso';
const PREFIX = '/api/v1';

/**
 * Times chosen to occur nowhere else. Each is matched only in the shapes
 * a serialised `Time(0)` or timestamp would take — `"06:17"`,
 * `"06:17:00"`, `T06:17:00.000Z` — so an unrelated timestamp whose
 * minutes and seconds happen to read `06:17` cannot trip it.
 */
const GRID = [
  { weekday: 'MON', start: '06:17', end: '21:43' },
  { weekday: 'THU', start: '05:29', end: '22:51' },
] as const;
const TIME_OFF = { startsAt: '2031-03-07T04:13:00.000Z', endsAt: '2031-03-09T19:47:00.000Z' };

/** Every grid time, as the patterns its serialisations would match. */
const LEAK_PATTERNS: readonly RegExp[] = [
  ...GRID.flatMap(({ start, end }) => [start, end]),
  '04:13',
  '19:47',
].map((time) => new RegExp(`(["T])${time}(:00(\\.000)?)?(["Z+])`));

/** Field names of the grid and time-off DTOs (API §3.8, §3.9). */
const GRID_KEYS = ['availability', 'workingHours', 'isBreak', 'timeOff', 'autoBehavior'];

function keysDeep(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, found);
    return found;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      keysDeep(nested, found);
    }
  }
  return found;
}

const timeOfDay = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);

/** Every `GET` route the application mounts, as Express sees it. */
function getRoutes(): string[] {
  const instance = harness.app.getHttpAdapter().getInstance() as {
    _router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  return instance._router.stack
    .map((layer) => layer.route)
    .filter((route): route is { path: string; methods: Record<string, boolean> } =>
      Boolean(route?.methods.get),
    )
    .map((route) => route.path)
    .filter((path) => path.startsWith(PREFIX));
}

/**
 * A concrete URL for a route pattern. `:doctorId` becomes the fixture
 * doctor — the one whose grid must not leak — and every other parameter
 * a well-formed id that names nothing, so the route answers rather than
 * failing on parsing.
 */
function concrete(path: string): string {
  return path
    .replace(':doctorId', doctor.id)
    .replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
}

beforeAll(async () => {
  harness = await createAuthHarness('working-hours');

  doctor = await createTestDoctor(harness.prisma, DOCTOR_TAG);
  // Patient-visible: verified and practising (`PATIENT_VISIBLE`), so the
  // discovery routes return this doctor rather than a 404.
  await harness.prisma.doctor.update({
    where: { id: doctor.id },
    data: { verificationStatus: 'VERIFIED', practiceStatus: 'ACTIVE' },
  });
  await harness.prisma.doctorAvailability.createMany({
    data: GRID.map(({ weekday, start, end }) => ({
      doctorId: doctor.id,
      weekday,
      startTime: timeOfDay(start),
      endTime: timeOfDay(end),
    })),
  });
  await harness.prisma.doctorTimeOff.create({
    data: {
      doctorId: doctor.id,
      startsAt: new Date(TIME_OFF.startsAt),
      endsAt: new Date(TIME_OFF.endsAt),
      kind: 'vacation',
      autoBehavior: 'block-new',
    },
  });

  // A signed-in patient **with** a clinical record — the most privileged
  // patient there is, so the sweep covers every patient branch.
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 1);
  const email = testEmail('wh-patient');
  await request(harness.server)
    .post('/api/v1/auth/register')
    .send(registrationBody({ firstName: 'Lina', lastName: 'Haddad', email, role: 'patient' }))
    .expect(201);
  await request(harness.server)
    .post('/api/v1/auth/verify-email')
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);
  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
  await harness.prisma.patient.update({ where: { id: records[0]!.id }, data: { userId: user.id } });
  patientToken = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Medora123!' })
      .expect(200),
  ).accessToken;
});

afterAll(async () => {
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await destroyTestDoctor(harness.prisma, DOCTOR_TAG);
  await harness.reset();
  await harness.close();
});

describe('the fixture is what the sweep assumes', () => {
  it('the doctor is patient-visible', async () => {
    await request(harness.server)
      .get(`${PREFIX}/patient/doctors/${doctor.id}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);
  });

  it('the grid is real, and the leak patterns match how it serialises', async () => {
    // Without this, a sweep that finds nothing proves nothing — the
    // patterns could simply never match how the grid serialises.
    const rows = await harness.prisma.doctorAvailability.findMany({ where: { doctorId: doctor.id } });
    expect(rows).toHaveLength(GRID.length);
    const serialised = JSON.stringify(rows.map((row) => row.startTime));
    expect(LEAK_PATTERNS.some((pattern) => pattern.test(serialised))).toBe(true);
  });
});

describe('no patient-reachable GET route returns availability-derived times (AST-C6)', () => {
  it('sweeps the whole route table', async () => {
    const routes = getRoutes();
    // The table really is the application's: the patient routes are in it.
    expect(routes).toEqual(
      expect.arrayContaining([
        `${PREFIX}/patient/doctors`,
        `${PREFIX}/patient/doctors/:doctorId`,
        `${PREFIX}/me/appointments`,
        `${PREFIX}/me/availability`,
      ]),
    );

    const leaks: string[] = [];
    let answered = 0;

    for (const route of routes) {
      const url = concrete(route);
      const response = await request(harness.server)
        .get(url)
        .set('Authorization', `Bearer ${patientToken}`);

      if (response.status === 200) answered += 1;

      const text = response.text ?? '';
      const matched = LEAK_PATTERNS.filter((pattern) => pattern.test(text));
      if (matched.length > 0) leaks.push(`${route} → ${String(response.status)} matched ${String(matched)}`);

      const keys = keysDeep(response.body);
      const leakedKeys = GRID_KEYS.filter((key) => keys.has(key));
      if (leakedKeys.length > 0) leaks.push(`${route} → ${String(response.status)} keys ${leakedKeys.join(',')}`);
    }

    expect(leaks).toEqual([]);
    // A sweep in which every route refused would also find no leak; the
    // patient surface must actually have answered.
    expect(answered).toBeGreaterThanOrEqual(5);
  });

  it('refuses the doctor-only grid and time-off routes to a patient with 404', async () => {
    // `@Authenticated()` by design — the practitioner is `doctors.user_id`,
    // not the role (availability.controller.ts) — so the refusal is the
    // repository's: a patient has no `doctors` row and the resource does
    // not exist for them.
    for (const path of ['/me/availability', '/me/time-off']) {
      await request(harness.server)
        .get(`${PREFIX}${path}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(404);
    }
  });

  it('keeps the grid out of the doctor detail a patient reads', async () => {
    const response = await request(harness.server)
      .get(`${PREFIX}/patient/doctors/${doctor.id}`)
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const keys = keysDeep(response.body);
    for (const key of GRID_KEYS) expect(keys.has(key)).toBe(false);
  });
});
