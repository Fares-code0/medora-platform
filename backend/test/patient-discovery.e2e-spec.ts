/**
 * Authenticated patient discovery (DSC-01, DSC-02, DSC-04, DSC-05;
 * DR-09, OD-10, OD-14), over HTTP with real tokens.
 *
 * Fixtures are this file's own hospitals, doctors, slots and insurance
 * rows, written straight through Prisma and removed in `afterAll`. Other
 * suites' doctors may also be employed at (their own) active hospitals, so
 * cross-hospital assertions select this file's doctors by id.
 */

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  patientRegistrationBody,
  recordPatientAt,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import { createTestDoctor, destroyTestDoctor } from './support/doctor-fixture';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';
import { body as mailBody } from './support/smtp-sink';

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const VERIFY = '/api/v1/auth/verify-email';
const SEARCH = '/api/v1/patient/discovery/search';

const RIYADH = '24.7136,46.6753';
const HOUR = 3_600_000;

let harness: AuthHarness;

interface Row {
  hospital: { id: string; name: string };
  location: { id: string; name: string } | null;
  doctor: { id: string };
  distanceKm: number | null;
  rating: unknown;
  nextAvailableSlot: { slotId: string; startsAt: string; timezone: string } | null;
  insurance: { covered: boolean } | null;
}
interface Page<T> {
  items: T[];
  totalItems: number;
}

const TAGS = ['dscA', 'dscB', 'dscC', 'dscS', 'dscT'] as const;
const doctors = {} as Record<(typeof TAGS)[number], { id: string; employmentId: string }>;
const hospitalIds = {} as Record<'A' | 'B' | 'C' | 'S', string>;
const slots = {} as Record<string, string>;
let providerId: string;
let patientRecords: Awaited<ReturnType<typeof createPatientRecords>>;

const HOSPITAL_PUBLIC_IDS = { A: 'hsp_dsc_a', B: 'hsp_dsc_b', C: 'hsp_dsc_c', S: 'hsp_dsc_s' } as const;
const PROVIDER_CODE = 'DSC-E2E';

async function cleanup(): Promise<void> {
  const prisma = harness.prisma;
  await destroyPatientRecords(prisma, 'dsc');
  const hospitals = await prisma.hospital.findMany({
    where: { publicId: { in: Object.values(HOSPITAL_PUBLIC_IDS) } },
    select: { id: true },
  });
  const ids = hospitals.map((hospital) => hospital.id);
  await prisma.appointment.deleteMany({ where: { hospitalId: { in: ids } } });
  await prisma.publishedSlot.deleteMany({ where: { hospitalId: { in: ids } } });
  for (const tag of TAGS) await destroyTestDoctor(prisma, tag);
  await prisma.hospitalInsuranceCoverage.deleteMany({ where: { hospitalId: { in: ids } } });
  await prisma.hospitalLocation.deleteMany({ where: { hospitalId: { in: ids } } });
  await prisma.clinic.deleteMany({ where: { hospitalId: { in: ids } } });
  await prisma.hospital.deleteMany({ where: { id: { in: ids } } });
  await prisma.insuranceProvider.deleteMany({ where: { code: PROVIDER_CODE } });
}

async function hospital(key: 'A' | 'B' | 'C' | 'S', name: string, status = 'ACTIVE'): Promise<string> {
  const row = await harness.prisma.hospital.create({
    data: { publicId: HOSPITAL_PUBLIC_IDS[key], name, status, timezone: 'Asia/Riyadh' },
    select: { id: true },
  });
  return row.id;
}

async function employ(
  tag: (typeof TAGS)[number],
  hospitalId: string,
  endedAt: Date | null = null,
): Promise<void> {
  const doctor = await createTestDoctor(harness.prisma, tag);
  await harness.prisma.doctor.update({
    where: { id: doctor.id },
    data: { verificationStatus: 'VERIFIED', practiceStatus: 'ACTIVE' },
  });
  const employment = await harness.prisma.doctorEmployment.create({
    data: {
      doctorId: doctor.id,
      hospitalId,
      endedAt,
      ...(endedAt === null ? {} : { startedAt: new Date(endedAt.getTime() - 24 * HOUR) }),
    },
    select: { id: true },
  });
  doctors[tag] = { id: doctor.id, employmentId: employment.id };
}

async function slot(
  tag: (typeof TAGS)[number],
  hospitalId: string,
  offsetMs: number,
  withdrawn = false,
): Promise<string> {
  const row = await harness.prisma.publishedSlot.create({
    data: {
      hospitalId,
      doctorEmploymentId: doctors[tag].employmentId,
      startsAt: new Date(Date.now() + offsetMs),
      durationMinutes: 30,
      withdrawnAt: withdrawn ? new Date() : null,
    },
    select: { id: true },
  });
  return row.id;
}

async function book(
  slotId: string,
  tag: (typeof TAGS)[number],
  hospitalId: string,
  status: 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED',
  index: number,
): Promise<void> {
  const published = await harness.prisma.publishedSlot.findUniqueOrThrow({ where: { id: slotId } });
  const visitType = await harness.prisma.visitType.findFirstOrThrow();
  const record = await recordPatientAt(harness.prisma, patientRecords[1]!.id, hospitalId);
  await harness.prisma.appointment.create({
    data: {
      publicId: `APT-TDSC${index}`,
      patientId: patientRecords[1]!.id,
      doctorId: doctors[tag].id,
      hospitalId,
      hospitalMedicalRecordId: record,
      doctorEmploymentId: doctors[tag].employmentId,
      publishedSlotId: slotId,
      visitTypeId: visitType.id,
      startsAt: published.startsAt,
      durationMin: 30,
      status,
      reason: 'Fixture booking',
      ...(status === 'CANCELLED' ? { cancelledReason: 'Fixture cancellation' } : {}),
    },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-discovery');
  await cleanup();

  patientRecords = await createPatientRecords(harness.prisma, 'dsc', 2);

  hospitalIds.A = await hospital('A', 'Discovery Hospital A');
  hospitalIds.B = await hospital('B', 'Discovery Hospital B');
  hospitalIds.C = await hospital('C', 'Discovery Hospital C');
  hospitalIds.S = await hospital('S', 'Discovery Hospital Suspended', 'SUSPENDED');

  const location = (hospitalId: string, name: string, latitude: number | null, longitude: number | null) =>
    harness.prisma.hospitalLocation.create({
      data: {
        hospitalId,
        name,
        addressLine1: '1 Test Street',
        city: 'Testville',
        countryCode: 'SA',
        latitude,
        longitude,
      },
    });
  await location(hospitalIds.A, 'A Main', 24.7136, 46.6753); // Riyadh
  await location(hospitalIds.B, 'B Main', 21.4858, 39.1925); // Jeddah, ~850 km away
  await location(hospitalIds.C, 'C Main', null, null); // no coordinates
  await location(hospitalIds.S, 'S Main', 24.7, 46.7);
  await harness.prisma.clinic.create({
    data: { publicId: 'cln_dsc_a', hospitalId: hospitalIds.A, name: 'A Heart Clinic' },
  });

  await employ('dscA', hospitalIds.A);
  await employ('dscB', hospitalIds.B);
  await employ('dscC', hospitalIds.C);
  await employ('dscS', hospitalIds.S);
  await employ('dscT', hospitalIds.A, new Date(Date.now() - HOUR)); // terminated

  // Hospital A's doctor: past, withdrawn, booked, released-by-cancellation, free.
  slots['past'] = await slot('dscA', hospitalIds.A, -HOUR);
  slots['withdrawn'] = await slot('dscA', hospitalIds.A, HOUR, true);
  slots['booked'] = await slot('dscA', hospitalIds.A, 2 * HOUR);
  // A rescheduled booking still holds its slot (`appointments_one_live_booking_per_slot`,
  // ADR-049), so this one is never "next available" either.
  slots['heldRescheduled'] = await slot('dscA', hospitalIds.A, 2.5 * HOUR);
  slots['released'] = await slot('dscA', hospitalIds.A, 3 * HOUR);
  slots['free'] = await slot('dscA', hospitalIds.A, 5 * HOUR);
  await book(slots['booked'], 'dscA', hospitalIds.A, 'CONFIRMED', 1);
  await book(slots['released'], 'dscA', hospitalIds.A, 'CANCELLED', 2);
  await book(slots['heldRescheduled'], 'dscA', hospitalIds.A, 'RESCHEDULED', 4);

  slots['b'] = await slot('dscB', hospitalIds.B, 4 * HOUR);
  slots['s'] = await slot('dscS', hospitalIds.S, 4 * HOUR);

  const provider = await harness.prisma.insuranceProvider.create({
    data: { code: PROVIDER_CODE, name: 'Discovery E2E Insurance' },
    select: { id: true },
  });
  providerId = provider.id;
  await harness.prisma.hospitalInsuranceCoverage.create({
    data: { hospitalId: hospitalIds.B, providerId, planCode: 'GOLD', planName: 'Gold' },
  });
});

afterAll(async () => {
  await cleanup();
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string): Promise<{ token: string; userId: string }> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: 'Medora123!' })
    .expect(200);
  const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
  return { token: dataOf<{ accessToken: string }>(response).accessToken, userId: row.id };
}

async function patientToken(local = 'sara') {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(patientRegistrationBody({ email })).expect(201);
  await request(harness.server)
    .post(VERIFY)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);
  return login(email);
}

async function doctorToken(local = 'caller') {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return login(email);
}

/** A patient linked to a record with an active policy at `providerId`. */
async function insuredPatientToken() {
  const session = await patientToken('insured');
  await harness.prisma.patient.update({
    where: { id: patientRecords[0]!.id },
    data: { userId: session.userId },
  });
  await harness.prisma.patientInsurance.deleteMany({ where: { patientId: patientRecords[0]!.id } });
  await harness.prisma.patientInsurance.create({
    data: { patientId: patientRecords[0]!.id, providerId, policyNumber: 'DSC-POLICY-1' },
  });
  return session;
}

const mine = (rows: Row[]) =>
  rows.filter((row) => Object.values(doctors).some((doctor) => doctor.id === row.doctor.id));

async function search(token: string, query = ''): Promise<Row[]> {
  const response = await request(harness.server)
    .get(`${SEARCH}?pageSize=100${query}`)
    .set(as(token))
    .expect(200);
  return mine(dataOf<Page<Row>>(response).items);
}

describe('authorization', () => {
  it('refuses unauthenticated callers with 401 on the discovery search', async () => {
    for (const path of [SEARCH]) {
      await request(harness.server).get(path).expect(401);
    }
  });

  it('refuses a doctor with 403', async () => {
    const { token } = await doctorToken();
    for (const path of [SEARCH]) {
      await request(harness.server).get(path).set(as(token)).expect(403);
    }
  });

  // The administrator case needs a second factor to sign in, so it is covered
  // against the service in `discovery.service.spec.ts` (same role check).
});

describe('GET /patient/discovery/search', () => {
  it('compares two hospitals for an uninsured patient, filtering nothing (OD-14)', async () => {
    const { token } = await patientToken();
    const rows = await search(token, `&near=${RIYADH}`);

    expect(rows.map((row) => row.doctor.id)).toEqual([
      doctors.dscA.id,
      doctors.dscB.id,
      doctors.dscC.id,
    ]);
    for (const row of rows) {
      expect(row.insurance).toBeNull();
      expect(row.rating).toBeNull();
    }
    expect(rows[0]!.hospital).toEqual({ id: hospitalIds.A, name: 'Discovery Hospital A' });
    expect(rows[0]!.location?.name).toBe('A Main');
  });

  it('orders by distance with null-coordinate rows last and never stores the position', async () => {
    const { token } = await patientToken();
    const rows = await search(token, `&near=${RIYADH}&sort=distance`);

    expect(rows[0]!.distanceKm).toBe(0);
    expect(rows[1]!.distanceKm).toBeGreaterThan(800);
    expect(rows[1]!.distanceKm).toBeLessThan(900);
    expect(rows[2]!.distanceKm).toBeNull();

    // Without `near` there is no distance at all.
    const without = await search(token);
    expect(without.every((row) => row.distanceKm === null)).toBe(true);
  });

  it('orders from the other side of the country when the position changes', async () => {
    const { token } = await patientToken();
    const rows = await search(token, '&near=21.5,39.2&sort=distance');
    expect(rows.map((row) => row.doctor.id)).toEqual([
      doctors.dscB.id,
      doctors.dscA.id,
      doctors.dscC.id,
    ]);
  });

  it('flags and prioritises covered hospitals for an insured patient without filtering', async () => {
    const { token } = await insuredPatientToken();
    const rows = await search(token, `&near=${RIYADH}&sort=distance`);

    // B is covered, so it leads although A is nearer; nothing is dropped.
    expect(rows.map((row) => row.doctor.id)).toEqual([
      doctors.dscB.id,
      doctors.dscA.id,
      doctors.dscC.id,
    ]);
    expect(rows.map((row) => row.insurance)).toEqual([
      { covered: true },
      { covered: false },
      { covered: false },
    ]);
  });

  it('ignores an expired policy (treated as uninsured)', async () => {
    const { token } = await insuredPatientToken();
    await harness.prisma.patientInsurance.updateMany({
      where: { patientId: patientRecords[0]!.id },
      data: { validUntil: new Date('2020-01-01') },
    });
    const rows = await search(token, `&near=${RIYADH}`);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.insurance === null)).toBe(true);
  });

  it('shows the earliest genuinely free slot: not past, withdrawn, booked or held by a reschedule', async () => {
    const { token } = await patientToken();
    const rows = await search(token, `&hospitalId=${hospitalIds.A}`);

    expect(rows).toHaveLength(1);
    // The cancelled booking released its slot; the booked one at +2h stays hidden.
    expect(rows[0]!.nextAvailableSlot?.slotId).toBe(slots['released']);
    expect(rows[0]!.nextAvailableSlot?.timezone).toBe('Asia/Riyadh');

    // Occupy the released slot as well: the next free one is +5h.
    await book(slots['released']!, 'dscA', hospitalIds.A, 'CONFIRMED', 3);
    const after = await search(token, `&hospitalId=${hospitalIds.A}`);
    expect(after[0]!.nextAvailableSlot?.slotId).toBe(slots['free']);

    // And never any booking detail.
    const body = JSON.stringify(after);
    expect(body).not.toContain(patientRecords[1]!.publicId);
    expect(body).not.toContain('APT-TDSC');

    await harness.prisma.appointment.deleteMany({ where: { publicId: 'APT-TDSC3' } });
  });

  it('omits suspended hospitals and terminated employments', async () => {
    const { token } = await patientToken();
    const ids = (await search(token)).map((row) => row.doctor.id);
    expect(ids).not.toContain(doctors.dscS.id);
    expect(ids).not.toContain(doctors.dscT.id);
  });

  it('filters by hospital, and a doctor with no free slot has none', async () => {
    const { token } = await patientToken();
    const rows = await search(token, `&hospitalId=${hospitalIds.C}`);
    expect(rows.map((row) => row.doctor.id)).toEqual([doctors.dscC.id]);
    expect(rows[0]!.nextAvailableSlot).toBeNull();
  });

  it.each([
    ['latitude out of range', 'near=91,10'],
    ['longitude out of range', 'near=10,181'],
    ['not numbers', 'near=abc'],
    ['one number', 'near=10'],
    ['distance sort without a position', 'sort=distance'],
    ['unknown sort', 'sort=rating'],
    ['bad hospital id', 'hospitalId=nope'],
  ])('answers 422 for %s', async (_name, query) => {
    const { token } = await patientToken();
    await request(harness.server).get(`${SEARCH}?${query}`).set(as(token)).expect(422);
  });
});

