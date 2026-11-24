import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, errorBody } from './support/auth-app';
import {
  destroyLabFixtures,
  orderTest,
  post,
  seedDoctor,
  seedPatient,
  specimenBody,
  toProcessing,
} from './support/lab-fixture';

/**
 * The patient profile aggregates the fact modules (RM M15.3 — API §4.5).
 *
 * > ✅ Verify: profile Labs/Prescriptions tabs show M13/M14 data.
 *
 * The two halves of that step were in very different states before this
 * milestone, and this file proves both against the same chart so they
 * cannot drift apart:
 *
 * · **Prescriptions.** Already live — M13.6 made signing materialise the
 *   `patient_medications` row, so `GET …/medications` has served the
 *   real M13 list since then. Asserted here anyway: the verify step is
 *   about the *profile*, and a tab that reads from the right table but
 *   is never exercised from the profile's own surface is not evidence.
 * · **Labs.** Had no source at all. `PatientLabStudiesTab` reads a
 *   frontend store, and the M14 orders behind it had no patient-scoped
 *   read anywhere on the API. `GET /patients/{id}/labs` is the new
 *   surface, and most of this file is about it.
 *
 * ## What "aggregate live data" has to mean to be true
 *
 * Not merely "returns rows". The tab has to move when the fact module
 * moves — an order collected in the laboratory has to read as collected
 * here, and a result reviewed there has to stop saying "awaiting
 * review" here. That is the property the frontend's own header claims
 * for this tab ("a result marked reviewed there stops saying 'Awaiting
 * review' here"), and the one asserted below by driving the M14
 * pipeline and re-reading the profile after each step.
 */
let harness: AuthHarness;

const PATIENTS = '/api/v1/patients';
const PRESCRIPTIONS = '/api/v1/prescriptions';

interface StudyView {
  labId: string;
  testName: string;
  testCode: string;
  category: string;
  status: string;
  date: string;
  resultCount: number;
  abnormalCount: number;
  hasCriticalResult: boolean;
  reviewed: boolean;
}

interface CategoryView {
  id: string;
  label: string;
  studies: StudyView[];
}

interface LabsTabView {
  patientId: string;
  categories: CategoryView[];
  totalStudies: number;
  truncated: boolean;
}

interface MedicationEntry {
  name: string;
  dosage: string;
  frequency: string;
  status: string;
  prescriptionId: string | null;
}

interface Page<T> {
  items: T[];
  totalItems: number;
}

const charts: string[] = [];
let doctorToken = '';
let strangerToken = '';
let patient: { id: string; name: string; mrn: string };
let amoxilId = '';

function labsTab(token: string, patientId: string): request.Test {
  return request(harness.server)
    .get(`${PATIENTS}/${patientId}/labs`)
    .set('Authorization', `Bearer ${token}`);
}

async function readLabsTab(patientId: string): Promise<LabsTabView> {
  return dataOf<LabsTabView>(await labsTab(doctorToken, patientId).expect(200));
}

/** Every study across every category, which is what most assertions want. */
function flatten(view: LabsTabView): StudyView[] {
  return view.categories.flatMap((category) => category.studies);
}

async function medications(patientId: string): Promise<MedicationEntry[]> {
  const response = await request(harness.server)
    .get(`${PATIENTS}/${patientId}/medications?pageSize=100`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .expect(200);

  return dataOf<Page<MedicationEntry>>(response).items;
}

/** Drives one order all the way to a released, gradeable potassium. */
async function releasedOrder(patientId: string, potassium: string): Promise<StudyView['labId']> {
  const order = await orderTest(harness, doctorToken, patientId);
  await toProcessing(harness, doctorToken, order.id, specimenBody());

  await post(harness, doctorToken, `/${order.id}/results`, {
    results: [
      { analyte: 'Potassium', value: potassium, unit: 'mmol/L' },
      { analyte: 'Sodium', value: '140', unit: 'mmol/L' },
    ],
  }).expect(200);

  await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(200);

  return order.id;
}

beforeAll(async () => {
  harness = await createAuthHarness('profile-agg', { clinicalDoctors: true });

  doctorToken = await seedDoctor(harness, 'agg-owner');
  strangerToken = await seedDoctor(harness, 'agg-stranger');
  patient = await seedPatient(harness, doctorToken);
  charts.push(patient.id);

  amoxilId = (
    await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Amoxil' },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (charts.length > 0) {
    const owned = { patient: { publicId: { in: charts } } };

    await harness.prisma.patientMedication.deleteMany({ where: owned });
    await harness.prisma.prescription.deleteMany({ where: owned });
    await destroyLabFixtures(harness, charts);
  }

  await harness.reset();
  await harness.close();
});

describe('RM M15.3 verify — the Labs tab shows M14 data', () => {
  it('lists an order the moment it is placed, before any result exists', async () => {
    // The state a clinician opens this tab to find: "did anyone send
    // it?". A tab that only listed completed orders would answer no.
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Nadia Fahmy' });
    charts.push(chart.id);

    const order = await orderTest(harness, doctorToken, chart.id);
    const view = await readLabsTab(chart.id);

    expect(view.patientId).toBe(chart.id);
    expect(flatten(view)).toHaveLength(1);
    expect(flatten(view)[0]).toMatchObject({
      labId: order.id,
      testName: 'Basic Metabolic Panel',
      testCode: '51990-0',
      status: 'ordered',
      resultCount: 0,
      abnormalCount: 0,
      hasCriticalResult: false,
      reviewed: false,
    });
  });

  it('carries the released counts and the M14.4 critical flag', async () => {
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Omar Saleh' });
    charts.push(chart.id);

    // 7.2 mmol/L grades `critical-high` against the seeded spec, and
    // the M5.10 trigger sets `has_critical_result` from it. The tab
    // reads the trigger's column rather than recomputing, so the two
    // surfaces cannot disagree.
    await releasedOrder(chart.id, '7.2');

    const study = flatten(await readLabsTab(chart.id))[0];

    expect(study?.resultCount).toBe(2);
    expect(study?.abnormalCount).toBe(1);
    expect(study?.hasCriticalResult).toBe(true);
    expect(study?.status).toBe('completed');
  });

  it('moves when the laboratory moves, at every step of the pipeline', async () => {
    // "Aggregate live data" has to mean the tab tracks the fact module,
    // not that it once returned a row. The profile is re-read after
    // each M14 transition rather than only at the end.
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Hana Darwish' });
    charts.push(chart.id);

    const order = await orderTest(harness, doctorToken, chart.id);
    expect(flatten(await readLabsTab(chart.id))[0]?.status).toBe('ordered');

    await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody(),
    }).expect(200);
    expect(flatten(await readLabsTab(chart.id))[0]?.status).toBe('collected');

    await post(harness, doctorToken, `/${order.id}/transition`, { to: 'processing' }).expect(200);
    expect(flatten(await readLabsTab(chart.id))[0]?.status).toBe('processing');
  });

  it('stops saying unreviewed once the result is reviewed', async () => {
    // The frontend's own claim for this tab, made true: "a result marked
    // reviewed there stops saying 'Awaiting review' here".
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Yusuf Kamal' });
    charts.push(chart.id);

    // All-normal, so the M14.5 review needs no critical acknowledgment.
    const reference = await releasedOrder(chart.id, '4.2');
    expect(flatten(await readLabsTab(chart.id))[0]?.reviewed).toBe(false);

    await post(harness, doctorToken, `/${reference}/review`, {}).expect(200);

    expect(flatten(await readLabsTab(chart.id))[0]?.reviewed).toBe(true);
  });

  it('reports the display date the frontend resolves, not the order date', async () => {
    // `completedDate ?? collectedDate ?? requestedDate`. Dating a
    // completed study by when it was ordered would misdate the result.
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Rana Aziz' });
    charts.push(chart.id);

    const order = await orderTest(harness, doctorToken, chart.id);
    const ordered = flatten(await readLabsTab(chart.id))[0]?.date;

    await toProcessing(harness, doctorToken, order.id, specimenBody());
    const collected = flatten(await readLabsTab(chart.id))[0]?.date;

    // The collected instant supersedes the requested one the moment it
    // exists, which is what the fallback chain means.
    expect(collected).not.toBe(ordered);
    expect(Date.parse(collected ?? '')).toBeGreaterThanOrEqual(Date.parse(ordered ?? ''));
  });
});

describe('the Labs tab groups by category, stably', () => {
  it('returns one group per category the patient actually has', async () => {
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Tarek Lotfy' });
    charts.push(chart.id);

    await orderTest(harness, doctorToken, chart.id);
    const view = await readLabsTab(chart.id);

    // The seeded Basic Metabolic Panel is Chemistry, and a patient with
    // one Chemistry order has exactly one group — empty categories are
    // dropped rather than sent as empty arrays for a client to filter.
    expect(view.categories).toHaveLength(1);
    expect(view.categories[0]?.id).toBe('Chemistry');
    expect(view.categories[0]?.label).toBe('Chemistry');
    expect(view.totalStudies).toBe(1);
    expect(view.truncated).toBe(false);
  });

  it('keeps the same group order as studies accumulate', async () => {
    // A chart whose sections reshuffle between two visits is one a
    // reader has to re-scan every time. The order comes from the
    // catalogue vocabulary, not from the patient's own history.
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Mona Adel' });
    charts.push(chart.id);

    await orderTest(harness, doctorToken, chart.id);
    const first = (await readLabsTab(chart.id)).categories.map((group) => group.id);

    await orderTest(harness, doctorToken, chart.id);
    const second = (await readLabsTab(chart.id)).categories.map((group) => group.id);

    expect(second).toEqual(first);
    expect((await readLabsTab(chart.id)).totalStudies).toBe(2);
  });

  it('is empty, not absent, for a patient who has never been tested', async () => {
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Selim Rashad' });
    charts.push(chart.id);

    const view = await readLabsTab(chart.id);

    expect(view.categories).toEqual([]);
    expect(view.totalStudies).toBe(0);
  });
});

describe('the Labs tab is care-scoped like every other chart read', () => {
  it('answers a colleague with no care relationship as not found', async () => {
    // 404 and not 403: a 403 confirms the patient exists, and walking
    // `PT-1000`, `PT-1001`, … against a 403/404 split would disclose the
    // roster without opening a chart (ADR-022).
    const response = await labsTab(strangerToken, patient.id);

    expect(response.status).toBe(404);
  });

  it('answers a patient who does not exist identically', async () => {
    const missing = await labsTab(doctorToken, 'PT-000000');
    const foreign = await labsTab(strangerToken, patient.id);

    expect(missing.status).toBe(foreign.status);
    // Byte-identical, not merely the same code: the message must not
    // distinguish "not yours" from "does not exist" either.
    expect(errorBody(missing).message).toBe(errorBody(foreign).message);
    expect(errorBody(missing).message).toBe('Patient not found');
  });
});

describe('RM M15.3 verify — the Prescriptions tab shows M13 data', () => {
  it('shows the signed prescription on the profile’s medication list', async () => {
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Karim Fouad' });
    charts.push(chart.id);

    const draft = dataOf<{ id: string }>(
      await request(harness.server)
        .post(PRESCRIPTIONS)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          patientId: chart.id,
          medicationId: amoxilId,
          strength: '500 mg',
          dosage: '1 capsule',
          frequency: 'Three times daily',
          durationDays: 7,
          quantity: 21,
          refillsAllowed: 0,
          instructions: 'Take with food.',
        })
        .expect(201),
    );

    // A draft has prescribed nothing (ADR-002 §1), so the profile shows
    // nothing yet — the tab tracks therapy, not paperwork.
    expect(await medications(chart.id)).toEqual([]);

    await request(harness.server)
      .post(`${PRESCRIPTIONS}/${draft.id}/sign`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({})
      .expect(200);

    const list = await medications(chart.id);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: 'Amoxil',
      dosage: '1 capsule',
      frequency: 'Three times daily',
      status: 'active',
      prescriptionId: draft.id,
    });
  });

  it('shows both tabs live on one chart at the same time', async () => {
    // The verify step names them together, so they are proven together:
    // one patient, one doctor, both fact modules feeding the profile.
    const chart = await seedPatient(harness, doctorToken, { fullName: 'Dalia Sabry' });
    charts.push(chart.id);

    await releasedOrder(chart.id, '4.4');

    const draft = dataOf<{ id: string }>(
      await request(harness.server)
        .post(PRESCRIPTIONS)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          patientId: chart.id,
          medicationId: amoxilId,
          strength: '500 mg',
          dosage: '1 capsule',
          frequency: 'Twice daily',
          durationDays: 5,
          quantity: 10,
          refillsAllowed: 0,
          instructions: 'Complete the course.',
        })
        .expect(201),
    );

    await request(harness.server)
      .post(`${PRESCRIPTIONS}/${draft.id}/sign`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({})
      .expect(200);

    expect(flatten(await readLabsTab(chart.id))).toHaveLength(1);
    expect(await medications(chart.id)).toHaveLength(1);
  });
});
