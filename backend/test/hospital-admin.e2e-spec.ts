/**
 * Hospital, clinic, location and department administration over HTTP with
 * real tokens (ADM-01): platform-tier writes, hospital-tier confinement,
 * 404 for foreign children, validation, conflicts and audit.
 */

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, errorBody } from './support/auth-app';
import {
  as,
  cleanupAdmins,
  makeHospital,
  seedAdminToken,
  seedDoctorToken,
  seedPatientToken,
} from './support/hospital-admin-fixture';

const API = '/api/v1';
const REASON = 'Suspended pending a licensing review (e2e)';

let harness: AuthHarness;
const hospitals: string[] = [];
const createdHospitalIds: string[] = [];

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
interface Row {
  id: string;
  hospitalId?: string;
  status?: string;
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
}

async function hospital(name: string): Promise<string> {
  const id = await makeHospital(harness, name);
  hospitals.push(id);
  return id;
}

const tag = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  harness = await createAuthHarness('hospital-admin');
}, 90_000);

beforeEach(async () => {
  await cleanupAdmins(harness);
  await harness.reset();
});

afterAll(async () => {
  await cleanupAdmins(harness);
  await harness.reset();
  const ids = [...hospitals, ...createdHospitalIds];
  await harness.prisma.auditEvent.deleteMany({ where: { hospitalId: { in: ids } } }).catch(() => undefined);
  await harness.prisma.clinic.deleteMany({ where: { hospitalId: { in: ids } } });
  await harness.prisma.hospitalLocation.deleteMany({ where: { hospitalId: { in: ids } } });
  await harness.prisma.hospitalDepartment.deleteMany({ where: { hospitalId: { in: ids } } });
  await harness.prisma.hospital.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
  await harness.close();
});

describe('hospitals (platform tier)', () => {
  it('lets a Platform Admin create, read, list, update and suspend a hospital, with audit', async () => {
    const admin = await seedAdminToken(harness, 'platform1', { platform: true });
    const name = `Created ${tag()}`;
    const created = await request(harness.server)
      .post(`${API}/hospitals`)
      .set(as(admin.token))
      .send({ name, timezone: 'Africa/Cairo', email: `${tag()}@hospital.test` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const row = dataOf<Row & { publicId: string; status: string; timezone: string }>(created);
    createdHospitalIds.push(row.id);
    expect(row.status).toBe('ACTIVE');
    expect(row.timezone).toBe('Africa/Cairo');
    expect(row.publicId).toMatch(/^hsp_/);

    const got = await request(harness.server).get(`${API}/hospitals/${row.id}`).set(as(admin.token));
    expect(got.status).toBe(200);
    expect(dataOf<Row>(got).name).toBe(name);

    const listed = await request(harness.server)
      .get(`${API}/hospitals?q=${encodeURIComponent(name)}&pageSize=5`)
      .set(as(admin.token));
    expect(listed.status).toBe(200);
    const page = dataOf<Page<Row>>(listed);
    expect(page.items.map((item) => item.id)).toEqual([row.id]);
    expect(page).toMatchObject({ page: 1, pageSize: 5, totalItems: 1, totalPages: 1 });

    const renamed = await request(harness.server)
      .patch(`${API}/hospitals/${row.id}`)
      .set(as(admin.token))
      .send({ name: `${name} II`, phone: '+20 2 5555 0100' });
    expect(renamed.status).toBe(200);
    expect(dataOf<Row>(renamed).name).toBe(`${name} II`);

    const suspended = await request(harness.server)
      .post(`${API}/hospitals/${row.id}/status`)
      .set(as(admin.token))
      .send({ status: 'SUSPENDED', reason: REASON });
    expect(suspended.status).toBe(200);
    expect(dataOf<Row>(suspended).status).toBe('SUSPENDED');
    const suspendedList = await request(harness.server)
      .get(`${API}/hospitals?status=SUSPENDED&q=${encodeURIComponent(name)}`)
      .set(as(admin.token));
    expect(dataOf<Page<Row>>(suspendedList).totalItems).toBe(1);

    const again = await request(harness.server)
      .post(`${API}/hospitals/${row.id}/status`)
      .set(as(admin.token))
      .send({ status: 'SUSPENDED', reason: REASON });
    expect(again.status).toBe(409);

    const events = await harness.prisma.auditEvent.findMany({
      where: { hospitalId: row.id, eventType: { startsWith: 'hospital.' } },
      select: { eventType: true, actorId: true },
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([
      'hospital.created',
      'hospital.status_changed',
      'hospital.updated',
    ]);
    expect(events.every((event) => event.actorId === admin.userId)).toBe(true);
  });

  it('answers 409 for a duplicate hospital email and 422 for invalid input', async () => {
    const admin = await seedAdminToken(harness, 'platform2', { platform: true });
    const email = `${tag()}@dup.test`;
    const first = await request(harness.server)
      .post(`${API}/hospitals`)
      .set(as(admin.token))
      .send({ name: `Dup ${tag()}`, email });
    expect(first.status).toBe(201);
    createdHospitalIds.push(dataOf<Row>(first).id);
    const second = await request(harness.server)
      .post(`${API}/hospitals`)
      .set(as(admin.token))
      .send({ name: `Dup ${tag()}`, email });
    expect(second.status).toBe(409);

    for (const body of [{}, { name: 'x' }, { name: 'Valid name', timezone: 'Mars/Base' }, { name: 'Valid name', email: 'nope' }]) {
      const response = await request(harness.server).post(`${API}/hospitals`).set(as(admin.token)).send(body);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    const empty = await request(harness.server)
      .patch(`${API}/hospitals/${createdHospitalIds[0]}`)
      .set(as(admin.token))
      .send({});
    expect(empty.status).toBe(422);
    const badStatus = await request(harness.server)
      .post(`${API}/hospitals/${createdHospitalIds[0]}/status`)
      .set(as(admin.token))
      .send({ status: 'DELETED', reason: REASON });
    expect(badStatus.status).toBe(422);
    const shortReason = await request(harness.server)
      .post(`${API}/hospitals/${createdHospitalIds[0]}/status`)
      .set(as(admin.token))
      .send({ status: 'INACTIVE', reason: 'short' });
    expect(shortReason.status).toBe(422);
  });

  it('answers 404 for an unknown or malformed hospital id', async () => {
    const admin = await seedAdminToken(harness, 'platform3', { platform: true });
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await request(harness.server).get(`${API}/hospitals/${missing}`).set(as(admin.token))).status).toBe(404);
    expect((await request(harness.server).get(`${API}/hospitals/nope`).set(as(admin.token))).status).toBe(404);
    expect(
      (await request(harness.server).get(`${API}/hospitals/${missing}/clinics`).set(as(admin.token))).status,
    ).toBe(404);
  });

  it('refuses a Hospital Admin the platform-tier writes and confines its reads to its own hospital', async () => {
    const a = await hospital('Hospital A');
    const b = await hospital('Hospital B');
    const admin = await seedAdminToken(harness, 'hospitaladmin1', { hospitalId: a });

    for (const response of [
      await request(harness.server).post(`${API}/hospitals`).set(as(admin.token)).send({ name: 'Nope Hospital' }),
      await request(harness.server).patch(`${API}/hospitals/${a}`).set(as(admin.token)).send({ name: 'Renamed' }),
      await request(harness.server)
        .post(`${API}/hospitals/${a}/status`)
        .set(as(admin.token))
        .send({ status: 'INACTIVE', reason: REASON }),
      await request(harness.server).get(`${API}/hospitals/${b}`).set(as(admin.token)),
    ]) {
      expect(response.status).toBe(403);
    }

    const own = await request(harness.server).get(`${API}/hospitals/${a}`).set(as(admin.token));
    expect(own.status).toBe(200);
    const listed = await request(harness.server).get(`${API}/hospitals?pageSize=100`).set(as(admin.token));
    expect(dataOf<Page<Row>>(listed).items.map((item) => item.id)).toEqual([a]);
  });

  it('refuses an administrator without scope, a doctor and a patient', async () => {
    const a = await hospital('Hospital Roles');
    const none = await seedAdminToken(harness, 'noscope1', 'none');
    const doctor = await seedDoctorToken(harness, 'doctor1');
    const patient = await seedPatientToken(harness, 'patient1');
    for (const token of [none.token, doctor, patient]) {
      expect((await request(harness.server).get(`${API}/hospitals`).set(as(token))).status).toBe(403);
      expect((await request(harness.server).get(`${API}/hospitals/${a}/clinics`).set(as(token))).status).toBe(403);
      expect(
        (await request(harness.server).post(`${API}/hospitals/${a}/clinics`).set(as(token)).send({ name: 'Clinic X' }))
          .status,
      ).toBe(403);
      expect((await request(harness.server).post(`${API}/hospitals`).set(as(token)).send({ name: 'Nope' })).status).toBe(
        403,
      );
    }
    expect((await request(harness.server).get(`${API}/hospitals`)).status).toBe(401);
  });
});

describe('clinics, locations and departments', () => {
  const kinds = [
    {
      path: 'clinics',
      create: () => ({ name: `Clinic ${tag()}` }),
      patch: { status: 'INACTIVE' },
      invalid: { name: 'x' },
      audit: ['hospital.clinic_created', 'hospital.clinic_updated'],
    },
    {
      path: 'locations',
      create: () => ({
        name: `Site ${tag()}`,
        addressLine1: '1 Corniche Road',
        city: 'Alexandria',
        countryCode: 'eg',
        latitude: 31.2001,
        longitude: 29.9187,
      }),
      patch: { city: 'Cairo', latitude: 30.0444, longitude: 31.2357 },
      invalid: { name: 'Site', addressLine1: 'x', city: 'x', countryCode: 'EGY' },
      audit: ['hospital.location_created', 'hospital.location_updated'],
    },
    {
      path: 'departments',
      create: () => ({ name: `Dept ${tag()}`, description: 'Cardiology services' }),
      patch: { status: 'INACTIVE', description: 'Closed for refit' },
      invalid: { name: 'x' },
      audit: ['hospital.department_created', 'hospital.department_updated'],
    },
  ] as const;

  it.each(kinds)('manages $path of its own hospital as a Hospital Admin, and cannot reach another’s', async (kind) => {
    const a = await hospital(`A ${kind.path}`);
    const b = await hospital(`B ${kind.path}`);
    const adminA = await seedAdminToken(harness, `admina${kind.path}`, { hospitalId: a });
    const base = (id: string) => `${API}/hospitals/${id}/${kind.path}`;

    const body = kind.create();
    const created = await request(harness.server).post(base(a)).set(as(adminA.token)).send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const row = dataOf<Row>(created);
    expect(row.hospitalId).toBe(a);
    expect(row.status).toBe('ACTIVE');

    // The same name is a conflict at this hospital, free at another.
    expect((await request(harness.server).post(base(a)).set(as(adminA.token)).send(body)).status).toBe(409);
    const platform = await seedAdminToken(harness, `platform${kind.path}`, { platform: true });
    const elsewhere = await request(harness.server).post(base(b)).set(as(platform.token)).send(body);
    expect(elsewhere.status, JSON.stringify(elsewhere.body)).toBe(201);
    const foreign = dataOf<Row>(elsewhere);

    const listed = await request(harness.server).get(base(a)).set(as(adminA.token));
    expect(dataOf<Page<Row>>(listed).items.map((item) => item.id)).toEqual([row.id]);
    expect((await request(harness.server).get(`${base(a)}/${row.id}`).set(as(adminA.token))).status).toBe(200);

    const patched = await request(harness.server).patch(`${base(a)}/${row.id}`).set(as(adminA.token)).send(kind.patch);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(dataOf<Row>(patched)).toMatchObject(kind.patch);
    const inactive = await request(harness.server).get(`${base(a)}?status=INACTIVE`).set(as(adminA.token));
    expect(dataOf<Page<Row>>(inactive).items.length).toBe(kind.path === 'locations' ? 0 : 1);

    // Another hospital: 403 for the Hospital Admin; the child of B under A's path is 404.
    expect((await request(harness.server).get(base(b)).set(as(adminA.token))).status).toBe(403);
    expect((await request(harness.server).post(base(b)).set(as(adminA.token)).send(kind.create())).status).toBe(403);
    expect((await request(harness.server).patch(`${base(b)}/${foreign.id}`).set(as(adminA.token)).send(kind.patch)).status).toBe(403);
    expect((await request(harness.server).get(`${base(a)}/${foreign.id}`).set(as(adminA.token))).status).toBe(404);
    expect((await request(harness.server).patch(`${base(a)}/${foreign.id}`).set(as(adminA.token)).send(kind.patch)).status).toBe(404);
    expect((await request(harness.server).get(`${base(a)}/${foreign.id}`).set(as(platform.token))).status).toBe(404);
    // ...and B's row is untouched.
    expect((await request(harness.server).get(`${base(b)}/${foreign.id}`).set(as(platform.token))).status).toBe(200);

    // Platform Admin reaches any hospital.
    expect((await request(harness.server).patch(`${base(b)}/${foreign.id}`).set(as(platform.token)).send(kind.patch)).status).toBe(200);

    // Validation.
    expect((await request(harness.server).post(base(a)).set(as(adminA.token)).send(kind.invalid)).status).toBe(422);
    expect((await request(harness.server).patch(`${base(a)}/${row.id}`).set(as(adminA.token)).send({})).status).toBe(422);
    expect((await request(harness.server).get(`${base(a)}?pageSize=101`).set(as(adminA.token))).status).toBe(422);

    // Audit, stamped with the hospital.
    const events = await harness.prisma.auditEvent.findMany({
      where: { hospitalId: a, eventType: { in: [...kind.audit] } },
      select: { eventType: true, actorId: true },
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([...kind.audit].sort());
    expect(events.every((event) => event.actorId === adminA.userId)).toBe(true);
  });

  it('stores location coordinates and normalises the country code; rejects an unpaired or out-of-range coordinate', async () => {
    const a = await hospital('Coordinates');
    const admin = await seedAdminToken(harness, 'coordadmin', { hospitalId: a });
    const base = `${API}/hospitals/${a}/locations`;
    const payload = { name: 'Main campus', addressLine1: '2 Nile Street', city: 'Giza', countryCode: 'eg' };

    const created = await request(harness.server)
      .post(base)
      .set(as(admin.token))
      .send({ ...payload, latitude: 30.013056, longitude: 31.208853, region: 'Giza', postalCode: '12511' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(dataOf<Row & { countryCode: string }>(created)).toMatchObject({
      countryCode: 'EG',
      latitude: 30.013056,
      longitude: 31.208853,
    });

    for (const bad of [
      { ...payload, name: 'Lat only', latitude: 10 },
      { ...payload, name: 'Out of range', latitude: 91, longitude: 0 },
      { ...payload, name: 'Out of range lng', latitude: 0, longitude: 181 },
    ]) {
      expect((await request(harness.server).post(base).set(as(admin.token)).send(bad)).status).toBe(422);
    }

    const id = dataOf<Row>(created).id;
    const cleared = await request(harness.server)
      .patch(`${base}/${id}`)
      .set(as(admin.token))
      .send({ latitude: null, longitude: null });
    expect(dataOf<Row>(cleared)).toMatchObject({ latitude: null, longitude: null });
  });

  it('refuses a department naming an unknown catalogue department (422)', async () => {
    const a = await hospital('Catalogue');
    const admin = await seedAdminToken(harness, 'catadmin', { hospitalId: a });
    const response = await request(harness.server)
      .post(`${API}/hospitals/${a}/departments`)
      .set(as(admin.token))
      .send({ name: `Dept ${tag()}`, catalogueDepartmentId: '00000000-0000-4000-8000-000000000000' });
    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors).toHaveProperty('catalogueDepartmentId');
  });

  it('refuses a doctor and a patient the organisation routes', async () => {
    const a = await hospital('Refused');
    const doctor = await seedDoctorToken(harness, 'doctor2');
    const patient = await seedPatientToken(harness, 'patient2');
    for (const token of [doctor, patient]) {
      for (const path of ['clinics', 'locations', 'departments']) {
        expect((await request(harness.server).get(`${API}/hospitals/${a}/${path}`).set(as(token))).status).toBe(403);
      }
    }
  });
});
