import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  purgeHospitalRecords,
  testEmail,
} from './support/auth-app';
import { seedDoctor, seedPatient } from './support/lab-fixture';

/**
 * The revenue category with billing off (RM M17.2 — API §12.1).
 *
 * > ✅ Verify: `category=revenue` with flag off → **the alternate
 * > payload, not 404 and not 500**. (API §12.1 says "404/flag-off
 * > alternate"; the M0 ADR picks the alternate payload — the frontend
 * > renders alternates, it does not handle a 404 here.)
 *
 * The verify step is one assertion and it is the first case below. The
 * rest is what makes "the alternate" a real answer rather than a
 * placeholder: it names which alternate to render, it says billing is
 * off rather than leaving a client to infer it from missing figures, and
 * its content is the doctor's own practice mix rather than the clinic's.
 */
let harness: AuthHarness;

const ANALYTICS = '/api/v1/reports/analytics';

interface RevenueAlternate {
  category: string;
  billingEnabled: boolean;
  alternate: string;
  notice: string;
  topVisitTypes: { label: string; value: number }[];
  range: { from: string; to: string };
}

const charts: string[] = [];
let doctorToken = '';

function analytics(token: string, query: string): request.Test {
  return request(harness.server)
    .get(`${ANALYTICS}${query}`)
    .set('Authorization', `Bearer ${token}`);
}

/**
 * Books `count` appointments of one visit type for this doctor.
 *
 * Inserted rather than booked through §5.3, which would refuse the
 * overlapping slots this needs: what is under test is a *count* by visit
 * type, and the availability rules that make booking realistic are
 * M11's, already tested there.
 */
async function bookVisits(
  doctorLocal: string,
  patientPublicId: string,
  visitTypeName: string,
  count: number,
): Promise<void> {
  // Resolved by the account's address, which is what identifies a
  // suite's own doctor. Reaching for "the most recent doctor" instead
  // would attach these appointments to whichever suite registered last
  // — and Vitest runs files in parallel.
  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email: testEmail(doctorLocal) } },
    select: { id: true, departmentId: true },
  });
  const patient = await harness.prisma.patient.findUniqueOrThrow({
    where: { publicId: patientPublicId },
    select: { id: true },
  });
  const visitType = await harness.prisma.visitType.findFirstOrThrow({
    where: { name: visitTypeName },
    select: { id: true },
  });

  for (let index = 0; index < count; index += 1) {
    const sequence = await harness.prisma.$queryRaw<Array<{ value: bigint }>>`
      SELECT nextval('appointment_reference_seq') AS value
    `;

    await harness.prisma.appointment.create({
      data: {
        publicId: `APT-${String(sequence[0]?.value ?? 0n)}`,
        patientId: patient.id,
        doctorId: doctor.id,
        departmentId: doctor.departmentId,
        visitTypeId: visitType.id,
        // Inside every range the endpoint offers, including `today`.
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        durationMin: 30,
        status: 'COMPLETED',
        reason: 'Routine',
      },
    });
  }
}

beforeAll(async () => {
  harness = await createAuthHarness('reports-revenue');

  doctorToken = await seedDoctor(harness, 'revenue-doctor');
  const patient = await seedPatient(harness, doctorToken);
  charts.push(patient.id);

  await bookVisits('revenue-doctor', patient.id, 'Consultation', 3);
  await bookVisits('revenue-doctor', patient.id, 'Follow-up', 1);
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (charts.length > 0) {
    await harness.prisma.appointment.deleteMany({
      where: { patient: { publicId: { in: charts } } },
    });
    // The charts' Hospital Medical Records (and the care assignments that
    // cite them and the doctor's employment) restrict the delete (DR-05).
    const rows = await harness.prisma.patient.findMany({
      where: { publicId: { in: charts } },
      select: { id: true },
    });
    await purgeHospitalRecords(
      harness.prisma,
      rows.map((row) => row.id),
    );
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: charts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('RM M17.2 verify — the flag-off alternate, not 404 and not 500', () => {
  it('answers 200 with the alternate payload', async () => {
    const response = await analytics(doctorToken, '?category=revenue');

    // The whole verify step, in three lines.
    expect(response.status).toBe(200);
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(500);

    const body = dataOf<RevenueAlternate>(response);
    expect(body.category).toBe('revenue');
    expect(body.billingEnabled).toBe(false);
  });

  it('names which alternate to render, rather than leaving the client to guess', async () => {
    // UX §2.1: the revenue card is "visible only when the clinic enables
    // per-doctor billing; otherwise the slot shows 'Top visit types'
    // instead". The server names it so two clients cannot choose
    // differently.
    const body = dataOf<RevenueAlternate>(await analytics(doctorToken, '?category=revenue'));

    expect(body.alternate).toBe('top-visit-types');
    expect(body.notice).toContain('Billing is not enabled');
  });

  it('says billing is off rather than implying it by absence', async () => {
    // A client inferring "billing is off" from missing figures would
    // render an empty chart on a deployment whose billing is on but
    // whose month was quiet. The flag distinguishes the two.
    const body = dataOf<RevenueAlternate>(await analytics(doctorToken, '?category=revenue'));

    expect(body).toHaveProperty('billingEnabled', false);
  });
});

describe('the alternate carries the doctor’s own practice mix', () => {
  it('counts visit types, most frequent first', async () => {
    const body = dataOf<RevenueAlternate>(await analytics(doctorToken, '?category=revenue'));

    expect(body.topVisitTypes[0]).toEqual({ label: 'Consultation', value: 3 });
    expect(body.topVisitTypes).toContainEqual({ label: 'Follow-up', value: 1 });
  });

  it('is scoped to the caller, not the clinic', async () => {
    // API §12's own header: "Doctor scope = own data only". A colleague
    // with no appointments sees none, not this doctor's.
    const colleague = await seedDoctor(harness, 'revenue-colleague');
    const body = dataOf<RevenueAlternate>(await analytics(colleague, '?category=revenue'));

    expect(body.topVisitTypes).toEqual([]);
    // Still the alternate, still 200 — an empty practice is not an error.
    expect(body.alternate).toBe('top-visit-types');
  });

  it('echoes the window the counts cover', async () => {
    const body = dataOf<RevenueAlternate>(await analytics(doctorToken, '?category=revenue'));

    expect(Date.parse(body.range.from)).toBeLessThan(Date.parse(body.range.to));
  });

  it('narrows the window when a shorter range is asked for', async () => {
    const month = dataOf<RevenueAlternate>(
      await analytics(doctorToken, '?category=revenue&range=month'),
    );
    const today = dataOf<RevenueAlternate>(
      await analytics(doctorToken, '?category=revenue&range=today'),
    );

    expect(Date.parse(today.range.from)).toBeGreaterThan(Date.parse(month.range.from));
  });

  it('defaults to a month when no range is given', async () => {
    const implicit = dataOf<RevenueAlternate>(await analytics(doctorToken, '?category=revenue'));
    const explicit = dataOf<RevenueAlternate>(
      await analytics(doctorToken, '?category=revenue&range=month'),
    );

    // Within a second of each other — both windows end at "now".
    expect(
      Math.abs(Date.parse(implicit.range.from) - Date.parse(explicit.range.from)),
    ).toBeLessThan(1_000);
  });
});

describe('the rest of §12 arrived with M21.1', () => {
  /**
   * **This assertion was inverted by M21.1, deliberately.**
   *
   * M17.2 answered 501 here and this file asserted it, with the
   * reasoning recorded alongside: not 404 because the category is real,
   * not 422 because the client did not ask wrongly, and not an empty
   * snapshot because a doctor would read a dashboard of zeros as their
   * practice. That was the right answer while nothing computed the
   * category. M17's own exit-gate note said what would change it —
   * "M21 extends rather than replaces: it fills the eight 501s and
   * keeps this alternate for `revenue` while the flag is off" — and
   * M21.1 is that milestone. The 501 is now gone because the snapshot
   * exists, not because the assertion was relaxed.
   */
  it('answers a snapshot for a category M21.1 implemented', async () => {
    const response = await analytics(doctorToken, '?category=patients');

    expect(response.status).toBe(200);
    expect(dataOf<{ category: string; kpis: unknown[] }>(response).category).toBe('patients');
  });

  it('refuses a category outside the contract’s nine with 422', async () => {
    const response = await analytics(doctorToken, '?category=payroll');

    expect(response.status).toBe(422);
  });

  it('refuses an unauthenticated request', async () => {
    expect((await request(harness.server).get(`${ANALYTICS}?category=revenue`)).status).toBe(401);
  });
});
