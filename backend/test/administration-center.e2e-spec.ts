import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * The Administration Center — API §18, RM M23.
 *
 * > ✅ Verify (M23.2): derived fields are computed, never stored;
 * > capacity ≤ 0 → 422; deleting a department with staff → 409.
 * > ✅ Verify (M23.3): `start >= end` → 422; the seven weekday rows can
 * > be updated but not created or deleted.
 * > ✅ Verify (M23.4): illegal transition (in-room → called) → 409;
 * > waiting minutes derived from timestamps, not stored.
 * > ✅ Verify (M23.5): editing a policy increments its version and
 * > stamps `updatedAt` server-side; an expired announcement drops out of
 * > the active list.
 *
 * The derived-field tests are written the way that actually catches a
 * regression: the stored column is set to a **wrong** value directly,
 * and the response is asserted to disagree with it. A test that only
 * checked the happy path would pass against an implementation that
 * simply read the column.
 *
 * ## Departments are shared seed data, so this suite leaves none behind
 *
 * `schema-reference.e2e-spec.ts` asserts the exact set of twelve seeded
 * department names, and it reads the **base** client — soft-deleted rows
 * are still visible to it. A department created here and merely
 * soft-deleted would therefore break that assertion permanently, so the
 * one test that creates a department **hard-deletes** it, and `afterAll`
 * sweeps any that a failure left behind.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const ADMIN = '/api/v1/administration';
const PASSWORD = 'Medora123!';

let adminToken = '';
let doctorToken = '';
let departmentId = '';

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function signUpDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

/** ADR-035 §7's bootstrap: enrol a factor, take the role, step up. */
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
      .set('Authorization', `Bearer ${bootstrap}`)
      .send({ password: PASSWORD }),
  ).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
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

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (path: string, token = adminToken) =>
  request(harness.server).get(`${ADMIN}${path}`).set(as(token));
const post = (path: string, body: object, token = adminToken) =>
  request(harness.server).post(`${ADMIN}${path}`).set(as(token)).send(body);
const patch = (path: string, body: object, token = adminToken) =>
  request(harness.server).patch(`${ADMIN}${path}`).set(as(token)).send(body);
const del = (path: string, token = adminToken) =>
  request(harness.server).delete(`${ADMIN}${path}`).set(as(token));

const staffBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Nadia Halim',
  role: 'nurse',
  title: 'Senior Nurse',
  departmentId,
  status: 'on-duty',
  phone: '+20 100 000 0000',
  email: `nurse.${Math.random().toString(36).slice(2, 8)}@medora.test`,
  workingHours: '08:00–16:00',
  permissions: ['patients.view'],
  ...overrides,
});

beforeAll(async () => {
  harness = await createAuthHarness('admin-m23');
  adminToken = await signUpAdmin('admin-center');
  doctorToken = await signUpDoctor('admin-doctor');

  const department = await harness.prisma.db.department.findFirstOrThrow({ select: { id: true } });
  departmentId = department.id;
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;

  // Any department a failed test left behind, removed for real — see the
  // header. `Empty ` is this suite's own prefix.
  await harness.prisma.department.deleteMany({ where: { name: { startsWith: 'Empty ' } } });
  await harness.reset();
  await harness.close();
});

describe('the whole surface is admin-only', () => {
  it('refuses a doctor on every group', async () => {
    for (const path of [
      '/overview',
      '/staff',
      '/departments',
      '/rooms',
      '/resources',
      '/working-days',
      '/holidays',
      '/shifts',
      '/queue',
      '/waiting-room',
      '/announcements',
      '/policies',
      '/document-templates',
      '/audit-events',
    ]) {
      expect((await get(path, doctorToken)).status).toBe(403);
    }
  });

  it('refuses an unauthenticated request', async () => {
    await request(harness.server).get(`${ADMIN}/staff`).expect(401);
  });
});

describe('M23.1 — the clinic overview', () => {
  it('answers every documented figure, with a 24-bucket histogram', async () => {
    const overview = dataOf<Record<string, unknown>>(await get('/overview').expect(200));

    for (const key of [
      'todaysPatients',
      'todaysAppointments',
      'waiting',
      'completed',
      'cancelled',
      'doctorUtilization',
      'averageWaitingMinutes',
      'clinicOccupancy',
      'hourlyActivity',
    ]) {
      expect(overview[key]).toBeDefined();
    }

    // Every hour present, including the quiet ones — a histogram that
    // skipped them would draw a clinic that closes at random.
    expect(overview.hourlyActivity).toHaveLength(24);
  });

  it('answers 0 rather than NaN when a denominator is zero', async () => {
    const overview = dataOf<{ clinicOccupancy: number; doctorUtilization: number }>(
      await get('/overview').expect(200),
    );

    expect(Number.isFinite(overview.clinicOccupancy)).toBe(true);
    expect(Number.isFinite(overview.doctorUtilization)).toBe(true);
  });
});

describe('M23.2 verify — derived fields, capacity and the department guard', () => {
  beforeEach(async () => {
    await harness.prisma.db.resource.deleteMany({});
    await harness.prisma.db.hospitalRoleAssignment.deleteMany({});
    await harness.prisma.db.hospitalStaffAffiliation.deleteMany({});
    await harness.prisma.db.staffMember.deleteMany({});
  });

  it('derives a resource’s status from quantity against the reorder level', async () => {
    const cases = [
      { quantity: 0, reorderLevel: 5, expected: 'out' },
      { quantity: 5, reorderLevel: 5, expected: 'low' },
      { quantity: 6, reorderLevel: 5, expected: 'in-stock' },
    ];

    for (const scenario of cases) {
      const created = dataOf<{ status: string }>(
        await post('/resources', {
          name: 'Gloves',
          category: 'Consumables',
          location: 'Store A',
          quantity: scenario.quantity,
          reorderLevel: scenario.reorderLevel,
        }).expect(201),
      );

      expect(created.status).toBe(scenario.expected);
    }
  });

  /**
   * The test that actually catches a regression: the stored column is
   * set to a lie, and the response must disagree with it.
   */
  it('computes the status rather than reading the column', async () => {
    const id = dataOf<{ id: string }>(
      await post('/resources', {
        name: 'Syringes',
        category: 'Consumables',
        location: 'Store B',
        quantity: 0,
        reorderLevel: 5,
      }).expect(201),
    ).id;

    await harness.prisma.db.resource.update({ where: { id }, data: { status: 'IN_STOCK' } });

    const listed = dataOf<{ id: string; status: string }[]>(await get('/resources').expect(200));

    expect(listed.find((row) => row.id === id)?.status).toBe('out');
  });

  it('ignores a status a client tries to send', async () => {
    const created = dataOf<{ status: string }>(
      await post('/resources', {
        name: 'Masks',
        category: 'Consumables',
        location: 'Store C',
        quantity: 0,
        reorderLevel: 5,
        status: 'in-stock',
      }).expect(201),
    );

    expect(created.status).toBe('out');
  });

  it('counts department staff on the relation, not from a column', async () => {
    await post('/staff', staffBody()).expect(201);
    await post('/staff', staffBody()).expect(201);

    const departments = dataOf<{ id: string; staffCount: number }[]>(
      await get('/departments').expect(200),
    );

    expect(departments.find((row) => row.id === departmentId)?.staffCount).toBe(2);
  });

  it('refuses a count the integer column cannot hold, with 422 rather than 500', async () => {
    // Zod's integers run to 2^53; `resources.quantity` and
    // `reorder_level` are PostgreSQL `integer`. One past its limit was a
    // driver error, answered 500.
    const body = { name: 'Gauze', category: 'Consumables', location: 'Store D', reorderLevel: 1 };

    await post('/resources', { ...body, quantity: 2_147_483_647 }).expect(201);

    for (const field of ['quantity', 'reorderLevel'] as const) {
      const response = await post('/resources', { ...body, quantity: 1, [field]: 2_147_483_648 });

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors).toHaveProperty([field]);
    }
  });

  it('refuses a room with capacity ≤ 0', async () => {
    const body = { name: `Room ${Date.now()}`, kind: 'consultation', capacity: 0, departmentId };

    await post('/rooms', body).expect(422);
    await post('/rooms', { ...body, capacity: -3 }).expect(422);
    await post('/rooms', { ...body, capacity: 2 }).expect(201);
  });

  it('refuses to delete a department that still has staff, with 409', async () => {
    await post('/staff', staffBody()).expect(201);

    const response = await del(`/departments/${departmentId}`);

    expect(response.status).toBe(409);
    // `AppException.conflict(detail, …)` puts the explanation in `detail`;
    // `message` is the generic status line the client may show as a title.
    expect(errorBody(response).detail).toContain('1 staff member');
  });

  it('deletes an empty department', async () => {
    const name = `Empty ${Date.now()}`;
    const id = dataOf<{ id: string }>(await post('/departments', { name }).expect(201)).id;

    await del(`/departments/${id}`).expect(204);
    expect(
      dataOf<{ id: string }[]>(await get('/departments').expect(200)).some((r) => r.id === id),
    ).toBe(false);

    // Hard-deleted, not left soft-deleted: `schema-reference` asserts the
    // twelve seeded names off the base client, which still sees a row
    // whose `deleted_at` is set.
    await harness.prisma.department.delete({ where: { id } });
  });

  it('refuses a staff member in a department that does not exist', async () => {
    await post(
      '/staff',
      staffBody({ departmentId: '00000000-0000-4000-8000-000000000000' }),
    ).expect(422);
  });

  it('changes only the fields a PATCH sends — a rename keeps status and permissions', async () => {
    const created = dataOf<{ id: string }>(
      await post('/staff', staffBody({ status: 'on-duty', permissions: ['patients.view'] })).expect(
        201,
      ),
    );

    const renamed = dataOf<{ name: string; status: string; permissions: string[] }>(
      await patch(`/staff/${created.id}`, { name: 'Nadia H. Halim' }).expect(200),
    );

    // Zod 4 applies a create schema's defaults through `.partial()`, which
    // reset these two to `off-duty` and `[]` on every rename (patchOf).
    expect(renamed).toMatchObject({
      name: 'Nadia H. Halim',
      status: 'on-duty',
      permissions: ['patients.view'],
    });
  });

  it('answers 404 for an unknown id on update and delete', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    await patch(`/staff/${missing}`, { title: 'x' }).expect(404);
    await del(`/rooms/${missing}`).expect(404);
    await del(`/resources/${missing}`).expect(404);
  });
});

describe('M23.3 verify — the working week, holidays and shifts', () => {
  const week = (overrides: Record<string, unknown> = {}) =>
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({
      day,
      open: day !== 'Sun',
      startTime: '08:00',
      endTime: '17:00',
      breakLabel: '13:00–14:00',
      ...overrides,
    }));

  it('updates all seven rows', async () => {
    const saved = dataOf<{ day: string; startTime: string }[]>(
      await request(harness.server)
        .put(`${ADMIN}/working-days`)
        .set(as(adminToken))
        .send(week())
        .expect(200),
    );

    expect(saved).toHaveLength(7);
    expect(saved.every((row) => row.startTime === '08:00')).toBe(true);
  });

  it('refuses a day that starts at or after it ends', async () => {
    await request(harness.server)
      .put(`${ADMIN}/working-days`)
      .set(as(adminToken))
      .send(week({ startTime: '17:00', endTime: '08:00' }))
      .expect(422);

    await request(harness.server)
      .put(`${ADMIN}/working-days`)
      .set(as(adminToken))
      .send(week({ startTime: '09:00', endTime: '09:00' }))
      .expect(422);
  });

  it('refuses a week that is not exactly seven distinct days', async () => {
    await request(harness.server)
      .put(`${ADMIN}/working-days`)
      .set(as(adminToken))
      .send(week().slice(0, 6))
      .expect(422);

    const duplicated = week();
    duplicated[6] = { ...duplicated[0]! };
    await request(harness.server)
      .put(`${ADMIN}/working-days`)
      .set(as(adminToken))
      .send(duplicated)
      .expect(422);
  });

  /** The seven rows cannot be created or deleted — there is no route. */
  it('offers no create or delete for a weekday', async () => {
    expect((await post('/working-days', week()[0]!)).status).toBe(404);
    expect((await del('/working-days/Mon')).status).toBe(404);
  });

  it('creates and deletes a holiday', async () => {
    // `holidays_name_date_key` is unique on (name, date) and a
    // soft-deleted row still occupies it, so the name is unique per run.
    const holidayName = `Revolution Day ${Math.random().toString(36).slice(2, 8)}`;
    const id = dataOf<{ id: string; date: string }>(
      await post('/holidays', {
        name: holidayName,
        date: '2026-07-23',
        kind: 'public',
        recurring: true,
      }).expect(201),
    ).id;

    expect(
      dataOf<{ id: string; date: string }[]>(await get('/holidays').expect(200)).find(
        (row) => row.id === id,
      )?.date,
    ).toBe('2026-07-23');

    await del(`/holidays/${id}`).expect(204);
  });

  it('refuses a malformed holiday date', async () => {
    await post('/holidays', { name: 'Bad', date: '23-07-2026', kind: 'public' }).expect(422);
  });

  /**
   * The unique index is the only thing that can tell the truth here —
   * a pre-check cannot see an uncommitted row — so the violation is
   * caught and answered as 409 rather than escaping as a 500.
   */
  it('answers 409 for a holiday that already exists on that date', async () => {
    const name = `National Day ${Math.random().toString(36).slice(2, 8)}`;

    await post('/holidays', { name, date: '2026-10-06', kind: 'public' }).expect(201);
    const response = await post('/holidays', { name, date: '2026-10-06', kind: 'clinic' });

    expect(response.status).toBe(409);
  });

  it('creates a shift with seven day flags and refuses another length', async () => {
    const staffId = dataOf<{ id: string }>(await post('/staff', staffBody()).expect(201)).id;

    const created = dataOf<{ id: string; days: boolean[] }>(
      await post('/shifts', {
        staffId,
        kind: 'morning',
        days: [true, true, true, true, true, false, false],
      }).expect(201),
    );

    expect(created.days).toHaveLength(7);

    await post('/shifts', { staffId, kind: 'morning', days: [true, false] }).expect(422);
    await del(`/shifts/${created.id}`).expect(204);
  });

  it('refuses a shift for a staff member that does not exist', async () => {
    await post('/shifts', {
      staffId: '00000000-0000-4000-8000-000000000000',
      kind: 'evening',
      days: [false, false, false, false, false, true, true],
    }).expect(422);
  });
});

describe('M23.4 verify — the waiting-room machine and derived minutes', () => {
  async function seedWaiting(status = 'WAITING', checkedInAt = new Date()) {
    const row = await harness.prisma.db.waitingRoomEntry.create({
      data: { patientName: 'Layla Morsi', area: 'Main', status: status as never, checkedInAt },
      select: { id: true },
    });

    return row.id;
  }

  beforeEach(async () => {
    await harness.prisma.db.waitingRoomEntry.deleteMany({});
    await harness.prisma.db.queueEntry.deleteMany({});
  });

  it('moves waiting → called → in-room', async () => {
    const id = await seedWaiting();

    expect(
      dataOf<{ status: string }>(await post(`/waiting-room/${id}/call`, {}).expect(200)).status,
    ).toBe('called');
    expect(
      dataOf<{ status: string }>(await post(`/waiting-room/${id}/seat`, {}).expect(200)).status,
    ).toBe('in-room');
  });

  /** The illegal transition the verify step names. */
  it('refuses in-room → called with 409', async () => {
    const id = await seedWaiting('IN_ROOM');

    const response = await post(`/waiting-room/${id}/call`, {});

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('invalid_status_transition');
  });

  it('refuses skipping straight to in-room', async () => {
    const id = await seedWaiting();

    expect((await post(`/waiting-room/${id}/seat`, {})).status).toBe(409);
  });

  it('refuses calling someone who is already called', async () => {
    const id = await seedWaiting('CALLED');

    expect((await post(`/waiting-room/${id}/call`, {})).status).toBe(409);
  });

  it('lets exactly one of two concurrent calls win', async () => {
    const id = await seedWaiting();

    const [first, second] = await Promise.all([
      post(`/waiting-room/${id}/call`, {}),
      post(`/waiting-room/${id}/call`, {}),
    ]);

    // Compare-and-set: one transition, one conflict — never a silent
    // overwrite of the other operator's move.
    expect([first.status, second.status].sort()).toEqual([200, 409]);
  });

  it('derives waiting minutes from the check-in time', async () => {
    await seedWaiting('WAITING', new Date(Date.now() - 42 * 60_000));

    const rows = dataOf<{ waitingMinutes: number }[]>(await get('/waiting-room').expect(200));

    expect(rows[0]?.waitingMinutes).toBeGreaterThanOrEqual(42);
    expect(rows[0]?.waitingMinutes).toBeLessThan(45);
  });

  it('masks the patient MRN but keeps the name an operator calls', async () => {
    const patient = await harness.prisma.db.patient.findFirstOrThrow({
      select: { id: true, publicId: true },
    });
    await harness.prisma.db.waitingRoomEntry.create({
      data: { patientName: 'Layla Morsi', area: 'Main', patientId: patient.id },
    });

    const rows = dataOf<{ patientMrn: string | null; patientName: string }[]>(
      await get('/waiting-room').expect(200),
    );
    const withPatient = rows.find((row) => row.patientMrn !== null);

    expect(withPatient?.patientMrn).not.toBe(patient.publicId);
    expect(withPatient?.patientName).toBe('Layla Morsi');
  });

  it('derives the queue’s waiting minutes and delayed flag', async () => {
    await harness.prisma.db.queueEntry.create({
      data: {
        ticket: 'A-001',
        patientName: 'Omar Said',
        reason: 'Follow-up',
        estimatedMinutes: 10,
        enqueuedAt: new Date(Date.now() - 30 * 60_000),
        // The stored flag says otherwise; the response must not.
        delayed: false,
      },
    });

    const rows = dataOf<{ waitingMinutes: number; delayed: boolean }[]>(
      await get('/queue').expect(200),
    );

    expect(rows[0]?.waitingMinutes).toBeGreaterThanOrEqual(30);
    expect(rows[0]?.delayed).toBe(true);
  });

  it('answers 404 for an unknown waiting-room entry', async () => {
    expect((await post('/waiting-room/00000000-0000-4000-8000-000000000000/call', {})).status).toBe(
      404,
    );
  });
});

describe('M23.5 verify — announcements, policies and templates', () => {
  beforeEach(async () => {
    await harness.prisma.db.announcement.deleteMany({});
    await harness.prisma.db.policy.deleteMany({});
    await harness.prisma.db.documentTemplate.deleteMany({});
  });

  it('drops an expired announcement out of the active list', async () => {
    const live = dataOf<{ id: string }>(
      await post('/announcements', { title: 'Live', body: 'Still current' }).expect(201),
    ).id;
    // `announcements_expires_after_creation` CHECKs
    // `expires_at > created_at` — DB §K10: "an announcement that expires
    // before it is posted is never seen". So a genuinely expired row is
    // seeded with both timestamps in the past rather than created
    // through the route, which correctly refuses it (asserted below).
    const expired = (
      await harness.prisma.db.announcement.create({
        data: {
          title: 'Old',
          body: 'Gone',
          createdAt: new Date(Date.now() - 2 * 86_400_000),
          expiresAt: new Date(Date.now() - 86_400_000),
        },
        select: { id: true },
      })
    ).id;

    const active = dataOf<{ id: string }[]>(await get('/announcements').expect(200)).map(
      (r) => r.id,
    );

    expect(active).toContain(live);
    expect(active).not.toContain(expired);

    // Still retrievable when asked for — expiry is a filter, not a delete.
    const all = dataOf<{ id: string }[]>(
      await get('/announcements?includeExpired=true').expect(200),
    ).map((r) => r.id);
    expect(all).toContain(expired);
  });

  it('refuses an announcement that would expire in the past', async () => {
    const response = await post('/announcements', {
      title: 'Doomed',
      body: 'x',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // 422 naming the field, rather than a 500 from the CHECK.
    expect(response.status).toBe(422);
  });

  it('sorts pinned announcements first', async () => {
    await post('/announcements', { title: 'Ordinary', body: 'x' }).expect(201);
    const pinned = dataOf<{ id: string }>(
      await post('/announcements', { title: 'Pinned', body: 'y', pinned: true }).expect(201),
    ).id;

    const rows = dataOf<{ id: string }[]>(await get('/announcements').expect(200));
    expect(rows[0]?.id).toBe(pinned);
  });

  /** The verify step: version increments and `updatedAt` is the server's. */
  it('increments a policy’s version on every edit', async () => {
    const created = dataOf<{ id: string; version: string; updatedAt: string }>(
      await post('/policies', {
        title: 'Infection control',
        category: 'Clinical',
        summary: 'Hand hygiene and PPE.',
      }).expect(201),
    );

    expect(created.version).toBe('1');

    const once = dataOf<{ version: string; updatedAt: string }>(
      await patch(`/policies/${created.id}`, { summary: 'Revised.' }).expect(200),
    );
    const twice = dataOf<{ version: string }>(
      await patch(`/policies/${created.id}`, { summary: 'Revised again.' }).expect(200),
    );

    expect(once.version).toBe('2');
    expect(twice.version).toBe('3');
    expect(Date.parse(once.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it('ignores a version a client tries to set', async () => {
    const id = dataOf<{ id: string }>(
      await post('/policies', {
        title: 'Safety',
        category: 'Clinical',
        summary: 'x',
        version: '99',
      }).expect(201),
    ).id;

    const listed = dataOf<{ id: string; version: string }[]>(await get('/policies').expect(200));
    expect(listed.find((row) => row.id === id)?.version).toBe('1');
  });

  it('creates a template with a server-owned usage count', async () => {
    const created = dataOf<{ id: string; usageCount: number }>(
      await post('/document-templates', {
        name: 'Sick note',
        kind: 'certificate',
        description: 'Standard certificate.',
      }).expect(201),
    );

    expect(created.usageCount).toBe(0);

    // A client cannot claim uses it did not have.
    await patch(`/document-templates/${created.id}`, { usageCount: 500 }).expect(200);
    const listed = dataOf<{ id: string; usageCount: number }[]>(
      await get('/document-templates').expect(200),
    );
    expect(listed.find((row) => row.id === created.id)?.usageCount).toBe(0);
  });

  it('refuses a template kind outside the six', async () => {
    await post('/document-templates', { name: 'Odd', kind: 'invoice' }).expect(422);
  });
});

describe('M23.6 and M23.7', () => {
  /** Its verify step demands real probe data; the probes are M38.1's. */
  it('answers 501 for platform status rather than plausible constants', async () => {
    const response = await get('/platform-status');

    expect(response.status).toBe(501);
    expect(errorBody(response).code).toBe('not_implemented');
  });

  it('returns a bounded recent audit feed', async () => {
    const rows = dataOf<unknown[]>(await get('/audit-events?limit=5').expect(200));

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  it('clamps an absurd limit rather than scanning the table', async () => {
    const rows = dataOf<unknown[]>(await get('/audit-events?limit=100000').expect(200));

    expect(rows.length).toBeLessThanOrEqual(100);
  });
});
