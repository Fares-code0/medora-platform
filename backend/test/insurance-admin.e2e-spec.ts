/**
 * Insurance configuration over HTTP with real tokens (ADM-03): the platform
 * provider lookup and a hospital's coverage rows.
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

let harness: AuthHarness;
const hospitals: string[] = [];
const providers: string[] = [];

interface Page<T> {
  items: T[];
  totalItems: number;
}
interface Provider {
  id: string;
  name: string;
  active: boolean;
}
interface Coverage {
  id: string;
  hospitalId: string;
  providerId: string;
  planCode: string;
  planName: string;
  active: boolean;
  startsOn: string | null;
  endsOn: string | null;
}

const tag = () => Math.random().toString(36).slice(2, 8);

async function hospital(name: string): Promise<string> {
  const id = await makeHospital(harness, name);
  hospitals.push(id);
  return id;
}

async function provider(token: string, active = true): Promise<Provider> {
  const response = await request(harness.server)
    .post(`${API}/insurance-providers`)
    .set(as(token))
    .send({ name: `Provider ${tag()}`, code: `P${tag()}`.toUpperCase(), active });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const row = dataOf<Provider>(response);
  providers.push(row.id);
  return row;
}

beforeAll(async () => {
  harness = await createAuthHarness('insurance-admin');
}, 90_000);

beforeEach(async () => {
  await cleanupAdmins(harness);
  await harness.reset();
});

afterAll(async () => {
  await cleanupAdmins(harness);
  await harness.reset();
  await harness.prisma.hospitalInsuranceCoverage.deleteMany({ where: { hospitalId: { in: hospitals } } });
  await harness.prisma.auditEvent.deleteMany({ where: { hospitalId: { in: hospitals } } }).catch(() => undefined);
  await harness.prisma.hospital.deleteMany({ where: { id: { in: hospitals } } }).catch(() => undefined);
  await harness.prisma.insuranceProvider.deleteMany({ where: { id: { in: providers } } }).catch(() => undefined);
  await harness.close();
});

describe('insurance providers (platform lookup)', () => {
  it('lets a Platform Admin create, read, list, update and deactivate a provider, with audit', async () => {
    const admin = await seedAdminToken(harness, 'platform1', { platform: true });
    const created = await provider(admin.token);

    const got = await request(harness.server).get(`${API}/insurance-providers/${created.id}`).set(as(admin.token));
    expect(got.status).toBe(200);
    expect(dataOf<Provider>(got).name).toBe(created.name);

    const listed = await request(harness.server)
      .get(`${API}/insurance-providers?q=${encodeURIComponent(created.name)}`)
      .set(as(admin.token));
    expect(dataOf<Page<Provider>>(listed).items.map((item) => item.id)).toEqual([created.id]);

    const updated = await request(harness.server)
      .patch(`${API}/insurance-providers/${created.id}`)
      .set(as(admin.token))
      .send({ phone: '+20 2 5555 0199', website: 'https://insurer.example.com', active: false });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(dataOf<Provider>(updated).active).toBe(false);
    const inactive = await request(harness.server)
      .get(`${API}/insurance-providers?active=false&q=${encodeURIComponent(created.name)}`)
      .set(as(admin.token));
    expect(dataOf<Page<Provider>>(inactive).totalItems).toBe(1);

    const events = await harness.prisma.auditEvent.findMany({
      where: { target: `insurance_provider:${created.id}`, eventType: { startsWith: 'hospital.insurance_provider_' } },
      select: { eventType: true },
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([
      'hospital.insurance_provider_created',
      'hospital.insurance_provider_updated',
    ]);
  });

  it('answers 409 for a duplicate name or code and 422 for invalid input', async () => {
    const admin = await seedAdminToken(harness, 'platform2', { platform: true });
    const first = await provider(admin.token);
    const dup = await request(harness.server)
      .post(`${API}/insurance-providers`)
      .set(as(admin.token))
      .send({ name: first.name });
    expect(dup.status).toBe(409);
    for (const body of [{}, { name: 'x' }, { name: 'Valid name', website: 'not a url' }]) {
      expect(
        (await request(harness.server).post(`${API}/insurance-providers`).set(as(admin.token)).send(body)).status,
      ).toBe(422);
    }
    expect(
      (await request(harness.server).patch(`${API}/insurance-providers/${first.id}`).set(as(admin.token)).send({}))
        .status,
    ).toBe(422);
    expect(
      (
        await request(harness.server)
          .get(`${API}/insurance-providers/00000000-0000-4000-8000-000000000000`)
          .set(as(admin.token))
      ).status,
    ).toBe(404);
  });

  it('lets a Hospital Admin read providers but not write them; refuses doctor, patient and unscoped admin', async () => {
    const a = await hospital('Providers A');
    const platform = await seedAdminToken(harness, 'platform3', { platform: true });
    const created = await provider(platform.token);
    const hospitalAdmin = await seedAdminToken(harness, 'hospitaladmin1', { hospitalId: a });
    const none = await seedAdminToken(harness, 'noscope1', 'none');
    const doctor = await seedDoctorToken(harness, 'doctor1');
    const patient = await seedPatientToken(harness, 'patient1');

    expect(
      (await request(harness.server).get(`${API}/insurance-providers/${created.id}`).set(as(hospitalAdmin.token)))
        .status,
    ).toBe(200);
    expect((await request(harness.server).get(`${API}/insurance-providers`).set(as(hospitalAdmin.token))).status).toBe(200);
    expect(
      (
        await request(harness.server)
          .post(`${API}/insurance-providers`)
          .set(as(hospitalAdmin.token))
          .send({ name: `Rogue ${tag()}` })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(harness.server)
          .patch(`${API}/insurance-providers/${created.id}`)
          .set(as(hospitalAdmin.token))
          .send({ active: false })
      ).status,
    ).toBe(403);

    for (const token of [none.token, doctor, patient]) {
      expect((await request(harness.server).get(`${API}/insurance-providers`).set(as(token))).status).toBe(403);
      expect(
        (await request(harness.server).post(`${API}/insurance-providers`).set(as(token)).send({ name: 'Nope Inc' }))
          .status,
      ).toBe(403);
    }
  });
});

describe('hospital insurance coverage', () => {
  it('lets a Hospital Admin add, list, update and remove its own coverage, with audit', async () => {
    const a = await hospital('Coverage A');
    const platform = await seedAdminToken(harness, 'platform4', { platform: true });
    const insurer = await provider(platform.token);
    const admin = await seedAdminToken(harness, 'hospitaladmin2', { hospitalId: a });
    const base = `${API}/hospitals/${a}/insurance-coverage`;

    const added = await request(harness.server)
      .post(base)
      .set(as(admin.token))
      .send({ providerId: insurer.id, planCode: 'GOLD', planName: 'Gold plan', startsOn: '2026-01-01', endsOn: '2026-12-31' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const row = dataOf<Coverage>(added);
    expect(row).toMatchObject({ hospitalId: a, providerId: insurer.id, planCode: 'GOLD', active: true, startsOn: '2026-01-01', endsOn: '2026-12-31' });

    expect((await request(harness.server).post(base).set(as(admin.token)).send({ providerId: insurer.id, planCode: 'GOLD', planName: 'Again' })).status).toBe(409);

    const listed = await request(harness.server).get(`${base}?providerId=${insurer.id}`).set(as(admin.token));
    expect(dataOf<Page<Coverage>>(listed).items.map((item) => item.id)).toEqual([row.id]);
    expect((await request(harness.server).get(`${base}/${row.id}`).set(as(admin.token))).status).toBe(200);

    const updated = await request(harness.server)
      .patch(`${base}/${row.id}`)
      .set(as(admin.token))
      .send({ planName: 'Gold plus', active: false, endsOn: null });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(dataOf<Coverage>(updated)).toMatchObject({ planName: 'Gold plus', active: false, endsOn: null, startsOn: '2026-01-01' });
    expect(dataOf<Page<Coverage>>(await request(harness.server).get(`${base}?active=true`).set(as(admin.token))).totalItems).toBe(0);

    // A one-sided change is checked against the stored side.
    const backwards = await request(harness.server).patch(`${base}/${row.id}`).set(as(admin.token)).send({ endsOn: '2025-12-31' });
    expect(backwards.status).toBe(422);

    expect((await request(harness.server).delete(`${base}/${row.id}`).set(as(admin.token))).status).toBe(204);
    expect((await request(harness.server).get(`${base}/${row.id}`).set(as(admin.token))).status).toBe(404);
    expect((await request(harness.server).delete(`${base}/${row.id}`).set(as(admin.token))).status).toBe(404);

    const events = await harness.prisma.auditEvent.findMany({
      where: { hospitalId: a, eventType: { startsWith: 'hospital.insurance_coverage_' } },
      select: { eventType: true, actorId: true },
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([
      'hospital.insurance_coverage_added',
      'hospital.insurance_coverage_removed',
      'hospital.insurance_coverage_updated',
    ]);
    expect(events.every((event) => event.actorId === admin.userId)).toBe(true);
  });

  it('confines a Hospital Admin to its hospital: 403 for another, 404 for another’s row under its own path', async () => {
    const a = await hospital('Coverage Iso A');
    const b = await hospital('Coverage Iso B');
    const platform = await seedAdminToken(harness, 'platform5', { platform: true });
    const insurer = await provider(platform.token);
    const adminA = await seedAdminToken(harness, 'hospitaladmin3', { hospitalId: a });
    const body = { providerId: insurer.id, planCode: 'SILVER', planName: 'Silver' };

    const foreign = dataOf<Coverage>(
      await request(harness.server).post(`${API}/hospitals/${b}/insurance-coverage`).set(as(platform.token)).send(body),
    );
    // The same plan is free at another hospital (unique per hospital).
    expect((await request(harness.server).post(`${API}/hospitals/${a}/insurance-coverage`).set(as(adminA.token)).send(body)).status).toBe(201);

    const onB = `${API}/hospitals/${b}/insurance-coverage`;
    expect((await request(harness.server).get(onB).set(as(adminA.token))).status).toBe(403);
    expect((await request(harness.server).post(onB).set(as(adminA.token)).send({ ...body, planCode: 'X' })).status).toBe(403);
    expect((await request(harness.server).patch(`${onB}/${foreign.id}`).set(as(adminA.token)).send({ active: false })).status).toBe(403);
    expect((await request(harness.server).delete(`${onB}/${foreign.id}`).set(as(adminA.token))).status).toBe(403);

    const onA = `${API}/hospitals/${a}/insurance-coverage`;
    expect((await request(harness.server).get(`${onA}/${foreign.id}`).set(as(adminA.token))).status).toBe(404);
    expect((await request(harness.server).patch(`${onA}/${foreign.id}`).set(as(adminA.token)).send({ active: false })).status).toBe(404);
    expect((await request(harness.server).delete(`${onA}/${foreign.id}`).set(as(adminA.token))).status).toBe(404);
    // B's row survived.
    expect((await request(harness.server).get(`${onB}/${foreign.id}`).set(as(platform.token))).status).toBe(200);

    // A Platform Admin manages either hospital.
    expect((await request(harness.server).patch(`${onA}/${foreign.id}`).set(as(platform.token)).send({ active: false })).status).toBe(404);
    expect((await request(harness.server).patch(`${onB}/${foreign.id}`).set(as(platform.token)).send({ active: false })).status).toBe(200);
  });

  it('validates providers and plans: unknown or inactive provider, bad dates, missing fields (422)', async () => {
    const a = await hospital('Coverage Validation');
    const platform = await seedAdminToken(harness, 'platform6', { platform: true });
    const inactive = await provider(platform.token, false);
    const active = await provider(platform.token);
    const base = `${API}/hospitals/${a}/insurance-coverage`;
    const post = (body: object) => request(harness.server).post(base).set(as(platform.token)).send(body);

    const unknown = await post({ providerId: '00000000-0000-4000-8000-000000000000', planCode: 'A', planName: 'A' });
    expect(unknown.status).toBe(422);
    expect(errorBody(unknown).fieldErrors).toHaveProperty('providerId');
    expect((await post({ providerId: inactive.id, planCode: 'A', planName: 'A' })).status).toBe(422);
    expect((await post({ providerId: active.id, planCode: 'A' })).status).toBe(422);
    expect((await post({ providerId: active.id, planCode: 'A', planName: 'A', startsOn: '2026-02-30' })).status).toBe(422);
    expect((await post({ providerId: active.id, planCode: 'A', planName: 'A', startsOn: '2026-05-01', endsOn: '2026-04-01' })).status).toBe(422);
    expect((await request(harness.server).get(`${base}?pageSize=0`).set(as(platform.token))).status).toBe(422);
  });

  it('refuses doctor, patient and unscoped administrator, and 404s an unknown hospital', async () => {
    const a = await hospital('Coverage Refused');
    const platform = await seedAdminToken(harness, 'platform7', { platform: true });
    const none = await seedAdminToken(harness, 'noscope2', 'none');
    const doctor = await seedDoctorToken(harness, 'doctor2');
    const patient = await seedPatientToken(harness, 'patient2');
    for (const token of [none.token, doctor, patient]) {
      expect((await request(harness.server).get(`${API}/hospitals/${a}/insurance-coverage`).set(as(token))).status).toBe(403);
      expect(
        (await request(harness.server).post(`${API}/hospitals/${a}/insurance-coverage`).set(as(token)).send({ providerId: 'x' })).status,
      ).toBe(403);
    }
    expect(
      (
        await request(harness.server)
          .get(`${API}/hospitals/00000000-0000-4000-8000-000000000000/insurance-coverage`)
          .set(as(platform.token))
      ).status,
    ).toBe(404);
  });
});
