/**
 * S5 — Hospital Admin scoping and explicit Platform Admin (OD-07; approved
 * implementation decisions 2026-11-23).
 *
 * - A Hospital Admin of A reads and changes only A's rows; B's rows are 404
 *   (ADR-022) on every scoped surface: administration (staff, rooms,
 *   resources, shifts, queue, waiting room, departments' headcount, overview,
 *   audit feed), user administration, doctor administration and employment
 *   lifecycle, and the audit ledger.
 * - A Hospital Admin is refused (403) on platform-only operations.
 * - A Platform Admin works platform-wide, but gets no queue / waiting-room
 *   (patient-identifying) rows.
 * - An unmapped admin and an admin with two hospital assignments are refused.
 * - Every administrative route of the scoped controllers carries a scope rule.
 */

import { randomUUID } from 'node:crypto';

import { Reflector } from '@nestjs/core';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AdministrationController } from '../src/modules/administration/controllers/administration.controller';
import { JobsController } from '../src/modules/administration/controllers/jobs.controller';
import { AuditController } from '../src/modules/audit/controllers/audit.controller';
import { AdminDoctorController } from '../src/modules/doctors/controllers/admin-doctor.controller';
import { DoctorEmploymentController } from '../src/modules/doctors/controllers/doctor-employment.controller';
import {
  PlatformIntegrationController,
  PlatformSettingsController,
} from '../src/modules/platform-settings/controllers/platform-settings.controller';
import { PlatformUserController } from '../src/modules/users/controllers/platform-user.controller';
import { RolesController } from '../src/modules/users/controllers/roles.controller';
import { ADMIN_SCOPE_METADATA, type AdminScopeRule } from '../src/shared/authz';
import {
  createHospital,
  makeHospitalAdmin,
  markPlatformAdmin,
  removeHospitals,
  type FixtureHospital,
} from './support/admin-scope';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

let harness: AuthHarness;

const API = '/api/v1';
const PASSWORD = 'Medora123!';
const NO_SUCH = '00000000-0000-4000-8000-000000000000';

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

interface Account {
  readonly email: string;
  readonly userId: string;
  readonly publicId: string;
  readonly doctorId: string;
}

async function register(local: string): Promise<Account> {
  const email = testEmail(local);
  await request(harness.server).post(`${API}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, publicId: true, doctor: { select: { id: true } } },
  });
  return { email, userId: user.id, publicId: user.publicId, doctorId: user.doctor!.id };
}

/** ADR-035 §7: an administrator enrols a factor, takes the role, steps up. */
async function adminToken(local: string, scope: (email: string) => Promise<void>) {
  const account = await register(local);
  const bootstrap = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(`${API}/auth/login`)
      .send({ email: account.email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  const secret = dataOf<{ secret: string }>(
    await request(harness.server)
      .post(`${API}/me/2fa/setup`)
      .set('Authorization', `Bearer ${bootstrap}`)
      .send({ password: PASSWORD }),
  ).secret;
  await request(harness.server)
    .post(`${API}/me/2fa/enable`)
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({
    where: { email: account.email },
    data: { roleId: adminRole.id },
  });
  await scope(account.email);

  const otpToken = dataOf<{ otpToken: string }>(
    await request(harness.server)
      .post(`${API}/auth/login`)
      .send({ email: account.email, password: PASSWORD }),
  ).otpToken;
  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(`${API}/auth/otp/verify`)
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;
  return { ...account, token };
}

let hospitalA: FixtureHospital;
let hospitalB: FixtureHospital;
let platform = '';
let adminA = '';
let unmapped = '';
let ambiguous = '';
let departmentId = '';
let doctorA: Account;
let doctorB: Account;
let doctorFree: Account;
let employmentB = '';
const rows = {
  staffA: '',
  staffB: '',
  roomA: '',
  roomB: '',
  resourceB: '',
  shiftB: '',
  queueA: '',
  queueB: '',
  waitingB: '',
  auditA: '',
  auditB: '',
};
const staffIds: string[] = [];

const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, token: string) =>
  request(harness.server)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`);

async function staff(hospitalId: string, label: string): Promise<string> {
  const row = await harness.prisma.staffMember.create({
    data: {
      name: `S5 ${label}`,
      role: 'NURSE',
      title: 'Nurse',
      departmentId,
      phone: '+20 100 000 0000',
      email: `s5-${label}-${randomUUID().slice(0, 8)}@admin-scope.test`,
      workingHours: '08:00–16:00',
    },
    select: { id: true },
  });
  staffIds.push(row.id);
  await harness.prisma.hospitalStaffAffiliation.create({ data: { staffId: row.id, hospitalId } });
  return row.id;
}

async function auditRow(hospitalId: string, summary: string): Promise<string> {
  const row = await harness.prisma.auditEvent.create({
    data: { category: 'ADMIN_ACTIVITY', eventType: 's5.fixture', summary, hospitalId },
    select: { id: true },
  });
  return row.id;
}

beforeAll(async () => {
  harness = await createAuthHarness('admin-hospital-scope');
  hospitalA = await createHospital(harness.prisma, 'S5 A');
  hospitalB = await createHospital(harness.prisma, 'S5 B');
  departmentId = (await harness.prisma.department.findFirstOrThrow({ select: { id: true } })).id;

  platform = (await adminToken('s5-platform', (e) => markPlatformAdmin(harness.prisma, e))).token;
  adminA = (
    await adminToken('s5-admin-a', (e) => makeHospitalAdmin(harness.prisma, e, hospitalA.id))
  ).token;
  unmapped = (await adminToken('s5-unmapped', () => Promise.resolve())).token;
  ambiguous = (
    await adminToken('s5-ambiguous', async (e) => {
      await makeHospitalAdmin(harness.prisma, e, hospitalA.id);
      await makeHospitalAdmin(harness.prisma, e, hospitalB.id);
    })
  ).token;

  doctorA = await register('s5-doctor-a');
  doctorB = await register('s5-doctor-b');
  doctorFree = await register('s5-doctor-free');
  await harness.prisma.doctorEmployment.create({
    data: { doctorId: doctorA.doctorId, hospitalId: hospitalA.id },
  });
  employmentB = (
    await harness.prisma.doctorEmployment.create({
      data: { doctorId: doctorB.doctorId, hospitalId: hospitalB.id },
      select: { id: true },
    })
  ).id;

  rows.staffA = await staff(hospitalA.id, 'a');
  rows.staffB = await staff(hospitalB.id, 'b');
  const room = (hospitalId: string, name: string) =>
    harness.prisma.room.create({
      data: { name, kind: 'CONSULTATION', capacity: 1, departmentId, hospitalId },
      select: { id: true },
    });
  rows.roomA = (await room(hospitalA.id, `S5 Room A ${randomUUID().slice(0, 6)}`)).id;
  rows.roomB = (await room(hospitalB.id, `S5 Room B ${randomUUID().slice(0, 6)}`)).id;
  rows.resourceB = (
    await harness.prisma.resource.create({
      data: {
        name: 'S5 gloves',
        category: 'Consumables',
        location: 'B store',
        quantity: 10,
        reorderLevel: 2,
        hospitalId: hospitalB.id,
      },
      select: { id: true },
    })
  ).id;
  const affiliationB = await harness.prisma.hospitalStaffAffiliation.findFirstOrThrow({
    where: { staffId: rows.staffB },
    select: { id: true },
  });
  rows.shiftB = (
    await harness.prisma.staffShiftAssignment.create({
      data: {
        staffId: rows.staffB,
        kind: 'MORNING',
        days: [true, true, true, true, true, false, false],
        hospitalId: hospitalB.id,
        hospitalStaffAffiliationId: affiliationB.id,
      },
      select: { id: true },
    })
  ).id;
  const queue = (hospitalId: string, ticket: string) =>
    harness.prisma.queueEntry.create({
      data: { ticket, patientName: 'S5 Patient', reason: 'Visit', estimatedMinutes: 5, hospitalId },
      select: { id: true },
    });
  rows.queueA = (await queue(hospitalA.id, 'S5-A')).id;
  rows.queueB = (await queue(hospitalB.id, 'S5-B')).id;
  rows.waitingB = (
    await harness.prisma.waitingRoomEntry.create({
      data: { patientName: 'S5 Waiting', area: 'Main', hospitalId: hospitalB.id },
      select: { id: true },
    })
  ).id;
  rows.auditA = await auditRow(hospitalA.id, 'S5 event at A');
  rows.auditB = await auditRow(hospitalB.id, 'S5 event at B');
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await removeHospitals(harness.prisma, [hospitalA.id, hospitalB.id]);
  await harness.prisma.staffMember.deleteMany({ where: { id: { in: staffIds } } });
  await harness.prisma.staffMember.deleteMany({
    where: { email: { endsWith: '@admin-scope.test' } },
  });
  await harness.reset();
  await harness.close();
});

describe('administration (Hospital Admin of A)', () => {
  it('lists only A rows: staff, rooms, resources, shifts, queue', async () => {
    const staffList = dataOf<{ items: { id: string }[] }>(
      await call('get', '/administration/staff?pageSize=100', adminA).expect(200),
    ).items.map((s) => s.id);
    expect(staffList).toContain(rows.staffA);
    expect(staffList).not.toContain(rows.staffB);

    const rooms = dataOf<{ id: string }[]>(
      await call('get', '/administration/rooms', adminA).expect(200),
    ).map((r) => r.id);
    expect(rooms).toEqual([rows.roomA]);

    const resources = dataOf<{ id: string }[]>(
      await call('get', '/administration/resources', adminA).expect(200),
    );
    expect(resources).toEqual([]);

    const shifts = dataOf<{ id: string }[]>(
      await call('get', '/administration/shifts', adminA).expect(200),
    ).map((s) => s.id);
    expect(shifts).not.toContain(rows.shiftB);

    const queue = dataOf<{ id: string }[]>(
      await call('get', '/administration/queue', adminA).expect(200),
    ).map((q) => q.id);
    expect(queue).toEqual([rows.queueA]);

    const waiting = dataOf<{ id: string }[]>(
      await call('get', '/administration/waiting-room', adminA).expect(200),
    );
    expect(waiting).toEqual([]);
  });

  it('answers 404 for every B row it tries to change', async () => {
    expect(
      (await call('patch', `/administration/staff/${rows.staffB}`, adminA).send({ title: 'X' }))
        .status,
    ).toBe(404);
    expect((await call('delete', `/administration/staff/${rows.staffB}`, adminA)).status).toBe(404);
    expect(
      (await call('patch', `/administration/rooms/${rows.roomB}`, adminA).send({ capacity: 2 }))
        .status,
    ).toBe(404);
    expect((await call('delete', `/administration/rooms/${rows.roomB}`, adminA)).status).toBe(404);
    expect(
      (
        await call('patch', `/administration/resources/${rows.resourceB}`, adminA).send({
          quantity: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('delete', `/administration/resources/${rows.resourceB}`, adminA)).status,
    ).toBe(404);
    expect((await call('delete', `/administration/shifts/${rows.shiftB}`, adminA)).status).toBe(
      404,
    );
    expect(
      (await call('post', `/administration/queue/${rows.queueB}/advance`, adminA).send({})).status,
    ).toBe(404);
    expect(
      (await call('post', `/administration/queue/${rows.queueB}/remove`, adminA).send({})).status,
    ).toBe(404);
    expect(
      (
        await call('post', `/administration/queue/${rows.queueA}/assign-room`, adminA).send({
          roomId: rows.roomB,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('post', `/administration/waiting-room/${rows.waitingB}/call`, adminA).send({}))
        .status,
    ).toBe(404);

    // Nothing of B changed.
    expect(await harness.prisma.db.room.count({ where: { id: rows.roomB, capacity: 1 } })).toBe(1);
    expect(await harness.prisma.db.queueEntry.count({ where: { id: rows.queueB } })).toBe(1);
    expect(
      (await harness.prisma.waitingRoomEntry.findUniqueOrThrow({ where: { id: rows.waitingB } }))
        .status,
    ).toBe('WAITING');
  });

  it('refuses to roster another hospital’s staff member, and stamps its own creations', async () => {
    const refused = await call('post', '/administration/shifts', adminA).send({
      staffId: rows.staffB,
      kind: 'evening',
      days: [true, false, false, false, false, false, false],
    });
    expect(refused.status).toBe(422);

    const room = dataOf<{ id: string }>(
      await call('post', '/administration/rooms', adminA)
        .send({
          name: `S5 new ${randomUUID().slice(0, 6)}`,
          kind: 'consultation',
          status: 'available',
          capacity: 1,
          departmentId,
        })
        .expect(201),
    );
    expect(
      (await harness.prisma.room.findUniqueOrThrow({ where: { id: room.id } })).hospitalId,
    ).toBe(hospitalA.id);

    const created = dataOf<{ id: string }>(
      await call('post', '/administration/staff', adminA)
        .send({
          name: 'S5 Created',
          role: 'nurse',
          title: 'Nurse',
          departmentId,
          status: 'on-duty',
          phone: '+20 100 000 0000',
          email: `s5-created-${randomUUID().slice(0, 8)}@admin-scope.test`,
          workingHours: '08:00–16:00',
          permissions: [],
        })
        .expect(201),
    );
    staffIds.push(created.id);
    expect(
      await harness.prisma.hospitalStaffAffiliation.count({
        where: { staffId: created.id, hospitalId: hospitalA.id, endedAt: null },
      }),
    ).toBe(1);
  });

  it('reads only A in the audit feed', async () => {
    const feed = dataOf<{ id: string }[]>(
      await call('get', '/administration/audit-events?limit=100', adminA).expect(200),
    ).map((e) => e.id);
    expect(feed).toContain(rows.auditA);
    expect(feed).not.toContain(rows.auditB);
  });

  it('is refused (403) on every platform-only operation', async () => {
    for (const path of [
      '/administration/working-days',
      '/administration/holidays',
      '/administration/announcements',
      '/administration/policies',
      '/administration/document-templates',
      '/administration/jobs',
      '/platform-settings',
      '/platform-settings/integrations',
      '/roles',
      '/roles/matrix',
      '/permissions',
      `/users/${doctorA.publicId}/permissions`,
    ]) {
      expect([path, (await call('get', path, adminA)).status]).toEqual([path, 403]);
    }
    expect(
      (await call('post', '/administration/departments', adminA).send({ name: 'S5 Dept' })).status,
    ).toBe(403);
  });
});

describe('user administration (Hospital Admin of A)', () => {
  it('lists A’s staff only and 404s everyone else', async () => {
    const listed = dataOf<{ items: { id: string }[] }>(
      await call('get', '/admin/users?pageSize=100', adminA).expect(200),
    ).items.map((u) => u.id);
    expect(listed).toContain(doctorA.publicId);
    expect(listed).not.toContain(doctorB.publicId);
    expect(listed).not.toContain(doctorFree.publicId);

    await call('get', `/admin/users/${doctorA.publicId}`, adminA).expect(200);
    expect((await call('get', `/admin/users/${doctorB.publicId}`, adminA)).status).toBe(404);
    expect((await call('get', `/admin/users/${doctorB.publicId}/activity`, adminA)).status).toBe(
      404,
    );
    expect(
      (await call('patch', `/admin/users/${doctorB.publicId}`, adminA).send({ active: false }))
        .status,
    ).toBe(404);
    expect(
      (await harness.prisma.user.findUniqueOrThrow({ where: { id: doctorB.userId } })).status,
    ).toBe('ACTIVE');
  });
});

describe('doctor administration (Hospital Admin of A)', () => {
  it('lists and reads A’s doctors only; B’s doctor is 404 on read and on every decision', async () => {
    const roster = dataOf<{ items: { id: string }[] }>(
      await call('get', '/doctors?pageSize=100', adminA).expect(200),
    ).items.map((d) => d.id);
    expect(roster).toContain(doctorA.doctorId);
    expect(roster).not.toContain(doctorB.doctorId);

    await call('get', `/doctors/${doctorA.doctorId}`, adminA).expect(200);
    expect((await call('get', `/doctors/${doctorB.doctorId}`, adminA)).status).toBe(404);
    expect(
      (
        await call('post', `/doctors/${doctorB.doctorId}/suspend`, adminA).send({
          reason: 'S5 cross-hospital suspension attempt',
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('post', `/doctors/${doctorB.doctorId}/verify`, adminA).send({})).status,
    ).toBe(404);
    expect((await call('get', `/doctors/${doctorB.doctorId}/employments`, adminA)).status).toBe(
      404,
    );
    expect(
      (
        await call(
          'post',
          `/doctors/${doctorB.doctorId}/employments/${employmentB}/end`,
          adminA,
        ).send({})
      ).status,
    ).toBe(404);
    expect(
      (await harness.prisma.doctorEmployment.findUniqueOrThrow({ where: { id: employmentB } }))
        .endedAt,
    ).toBeNull();
    expect(
      (await harness.prisma.doctor.findUniqueOrThrow({ where: { id: doctorB.doctorId } }))
        .practiceStatus,
    ).not.toBe('SUSPENDED');
  });

  it('hires only into its own hospital, and never a doctor employed elsewhere', async () => {
    expect(
      (
        await call('post', `/doctors/${doctorFree.doctorId}/employments`, adminA).send({
          hospitalId: hospitalB.publicId,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('post', `/doctors/${doctorB.doctorId}/employments`, adminA).send({
          hospitalId: hospitalA.publicId,
        })
      ).status,
    ).toBe(404);
    await call('post', `/doctors/${doctorFree.doctorId}/employments`, adminA)
      .send({ hospitalId: hospitalA.publicId })
      .expect(201);
  });
});

describe('audit ledger (Hospital Admin of A)', () => {
  it('pages, details and exports A’s rows only', async () => {
    const page = dataOf<{ items: { id: string }[] }>(
      await call('get', '/audit-events?pageSize=100&q=S5%20event', adminA).expect(200),
    ).items.map((e) => e.id);
    expect(page).toEqual([rows.auditA]);

    await call('get', `/audit-events/${rows.auditA}`, adminA).expect(200);
    expect((await call('get', `/audit-events/${rows.auditB}`, adminA)).status).toBe(404);
  });
});

describe('Platform Admin', () => {
  it('works platform-wide on administration, users, doctors and the ledger', async () => {
    const rooms = dataOf<{ id: string }[]>(
      await call('get', '/administration/rooms', platform).expect(200),
    ).map((r) => r.id);
    expect(rooms).toEqual(expect.arrayContaining([rows.roomA, rows.roomB]));
    await call('get', `/admin/users/${doctorB.publicId}`, platform).expect(200);
    await call('get', `/doctors/${doctorB.doctorId}`, platform).expect(200);
    await call('get', `/audit-events/${rows.auditB}`, platform).expect(200);
    await call('get', '/roles', platform).expect(200);
    await call('get', '/administration/working-days', platform).expect(200);
  });

  it('gets no patient-identifying queue or waiting-room rows', async () => {
    expect((await call('get', '/administration/queue', platform)).status).toBe(403);
    expect((await call('get', '/administration/waiting-room', platform)).status).toBe(403);
    expect(
      (await call('post', `/administration/queue/${rows.queueB}/advance`, platform).send({}))
        .status,
    ).toBe(403);
  });

  it('reports adminScope platform in the session; the Hospital Admin reports its hospital', async () => {
    const own = dataOf<{ adminScope: unknown }>(
      await call('get', '/auth/session', platform).expect(200),
    );
    expect(own.adminScope).toEqual({ type: 'platform' });
    const a = dataOf<{ adminScope: unknown }>(
      await call('get', '/auth/session', adminA).expect(200),
    );
    expect(a.adminScope).toEqual({
      type: 'hospital',
      hospital: { id: hospitalA.id, name: hospitalA.name },
    });
  });
});

describe('administrators with no administrative scope', () => {
  it.each([
    ['unmapped (admin role only)', () => unmapped],
    ['with two hospital admin assignments', () => ambiguous],
  ])('refuses an admin %s on every surface (403), with a null session scope', async (_, token) => {
    for (const path of [
      '/administration/overview',
      '/administration/staff',
      '/administration/rooms',
      '/administration/working-days',
      '/administration/queue',
      '/admin/users',
      '/doctors',
      '/audit-events',
      '/roles',
      '/platform-settings',
    ]) {
      expect([path, (await call('get', path, token())).status]).toEqual([path, 403]);
    }
    const session = dataOf<{ adminScope: unknown }>(
      await call('get', '/auth/session', token()).expect(200),
    );
    expect(session.adminScope).toBeNull();
  });
});

describe('route coverage', () => {
  it('gives every handler of the administrative controllers an admin-scope rule', () => {
    const reflector = new Reflector();
    const missing: string[] = [];
    for (const controller of [
      AdministrationController,
      JobsController,
      AuditController,
      AdminDoctorController,
      DoctorEmploymentController,
      PlatformSettingsController,
      PlatformIntegrationController,
      PlatformUserController,
      RolesController,
    ]) {
      const prototype = controller.prototype as unknown as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata('path', handler) === undefined) continue;
        const rule = reflector.getAllAndOverride<AdminScopeRule | undefined>(ADMIN_SCOPE_METADATA, [
          handler as () => void,
          controller,
        ]);
        if (rule === undefined) missing.push(`${controller.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('answers 404 for an unknown doctor', async () => {
    expect((await call('get', `/doctors/${NO_SUCH}`, adminA)).status).toBe(404);
  });
});
