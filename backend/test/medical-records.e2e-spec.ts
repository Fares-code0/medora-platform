import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RecordRepository } from '../src/modules/medical-records/repositories/record.repository';

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
 * The clinical document (RM M12 — API §6).
 *
 * The properties worth a round trip, as opposed to a unit test:
 *
 * · **Care scoping, and the list and the detail agree.** A record whose
 *   patient the caller is not on is absent from the list *and* answers a
 *   404 byte-identical to a missing one (ADR-022). The two are different
 *   queries over one rule, and a disagreement is a disclosure on one
 *   side or a lockout on the other.
 * · **Creation is transactional.** A record refused for an unknown ICD
 *   code leaves nothing behind — not the parent, not the children it
 *   would have had.
 * · **The version trail cannot be missing an entry.** Every accepted
 *   update writes exactly one row, numbered densely, carrying the
 *   before/after of what actually differed — and a no-op update is
 *   refused rather than recorded as a change.
 * · **Signing freezes, and only the author may do it.** A signature that
 *   a colleague can apply is a signature that means nothing.
 * · **The lifecycle is guarded in both directions.** No skipping, no
 *   going back, and a finalised record refuses edits with 409 rather
 *   than accepting them quietly.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const RECORDS = '/api/v1/medical-records';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface RecordView {
  id: string;
  patient: {
    id: string;
    name: string;
    mrn: string;
    age: number;
    gender: string;
    bloodType: string;
    phone: string;
  };
  visitDate: string;
  visitType: string;
  department: string | null;
  doctorId: string;
  doctor: string;
  status: string;
  priority: string;
  diagnoses: { code: string; label: string; isPrimary: boolean }[];
  chiefComplaint: string;
  followUpDate: string | null;
}

interface RecordDetailView extends RecordView {
  historyOfPresentIllness: string;
  physicalExamination: string;
  vitals: unknown;
  treatmentPlan: string[];
  medications: { id: string; name: string; status: string }[];
  allergies: { id: string; allergen: string; severity: string }[];
  notes: {
    id: string;
    author: string;
    title: string;
    body: string;
    signed: boolean;
    signedAt: string | null;
    aiAssisted: boolean;
  }[];
  attachments: unknown[];
  timeline: { id: string; kind: string; at: string; actor: string; detail: string }[];
}

interface VersionView {
  version: number;
  changedAt: string;
  actor: string;
  summary: string | null;
  changes: Record<string, unknown>;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface Doctor {
  readonly token: string;
  readonly email: string;
}

async function seedDoctor(local: string): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  return { token, email };
}

const createdCharts: string[] = [];

async function seedPatient(token: string, fullName = 'Layla Morsi'): Promise<string> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName,
      dateOfBirth: '1988-04-12',
      gender: 'female',
      bloodType: 'A+',
      phone: '+20 100 777 1234',
      allergies: [],
      chronicConditions: [],
    });

  expect(response.status).toBe(201);

  const id = dataOf<{ id: string }>(response).id;
  createdCharts.push(id);

  return id;
}

function recordBody(patientId: string, overrides: Record<string, unknown> = {}) {
  return {
    patientId,
    visitDate: '2026-09-10T09:00:00.000Z',
    visitType: 'Consultation',
    priority: 'normal',
    chiefComplaint: 'Persistent headache for two weeks',
    historyOfPresentIllness: 'Gradual onset, worse in the mornings, no aura.',
    physicalExamination: 'Alert and oriented. No focal neurological deficit.',
    ...overrides,
  };
}

async function createRecord(
  token: string,
  patientId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(harness.server)
    .post(RECORDS)
    .set('Authorization', `Bearer ${token}`)
    .send(recordBody(patientId, overrides));

  expect(response.status).toBe(201);

  return dataOf<RecordView>(response).id;
}

/**
 * An appointment in a doctor's book, written directly: the booking flow
 * is M11's to test, and this suite only needs a row to link to. The tag
 * is this file's own (see the M34 test-isolation note), so the cleanup
 * below cannot reach another suite's appointments.
 */
const APPOINTMENT_TAG = 'APT-Tmrec-';
let appointmentCount = 0;

async function seedAppointment(doctor: Doctor, patientReference: string): Promise<string> {
  const doctorRow = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email: doctor.email } },
    select: { id: true },
  });
  const patientRow = await harness.prisma.patient.findUniqueOrThrow({
    where: { publicId: patientReference },
    select: { id: true },
  });
  const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });

  appointmentCount += 1;
  const publicId = `${APPOINTMENT_TAG}${appointmentCount}`;
  await harness.prisma.appointment.create({
    data: {
      publicId,
      patientId: patientRow.id,
      doctorId: doctorRow.id,
      visitTypeId: visitType.id,
      startsAt: new Date('2026-09-10T09:00:00.000Z'),
      reason: 'Headache review',
      status: 'COMPLETED',
    },
  });

  return publicId;
}

function detail(token: string, reference: string) {
  return request(harness.server)
    .get(`${RECORDS}/${reference}`)
    .set('Authorization', `Bearer ${token}`);
}

function patch(token: string, reference: string, body: Record<string, unknown>) {
  return request(harness.server)
    .patch(`${RECORDS}/${reference}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

beforeAll(async () => {
  harness = await createAuthHarness('medical-records');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    await harness.prisma.medicalRecord.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await harness.prisma.appointment.deleteMany({
      where: { publicId: { startsWith: APPOINTMENT_TAG } },
    });
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('POST /medical-records (§6.3)', () => {
  it('creates a draft with its children in one transaction', async () => {
    const doctor = await seedDoctor('create');
    const patientId = await seedPatient(doctor.token);

    const response = await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send(
        recordBody(patientId, {
          diagnoses: [
            { code: 'I10', isPrimary: true },
            { code: 'E11.9', isPrimary: false },
          ],
          treatmentPlan: ['Reduce sodium intake', 'Review in four weeks'],
          medications: [
            { name: 'Amlodipine', dosage: '5 mg', frequency: 'Once daily', status: 'active' },
          ],
          allergies: [{ allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' }],
        }),
      );

    expect(response.status).toBe(201);

    const view = dataOf<RecordView>(response);
    expect(view.id).toMatch(/^MR-\d+$/);
    expect(view.status).toBe('draft');
    expect(view.patient.id).toBe(patientId);
    // Primary first, so the table header reads the right one.
    expect(view.diagnoses[0]).toMatchObject({ code: 'I10', isPrimary: true });

    const document = dataOf<RecordDetailView>(await detail(doctor.token, view.id));
    expect(document.treatmentPlan).toEqual(['Reduce sodium intake', 'Review in four weeks']);
    expect(document.medications).toHaveLength(1);
    expect(document.allergies[0]?.severity).toBe('severe');
    expect(document.timeline.some((event) => event.kind === 'created')).toBe(true);
  });

  it('refuses an unknown ICD-10 code and writes nothing', async () => {
    const doctor = await seedDoctor('icd');
    const patientId = await seedPatient(doctor.token);

    const response = await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send(recordBody(patientId, { diagnoses: [{ code: 'ZZ9.9', isPrimary: true }] }));

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['diagnoses']).toBeDefined();

    // A record that silently lost the diagnosis a clinician entered is
    // worse than one that refused to save — and a half-written record is
    // worse still.
    const page = dataOf<Page<RecordView>>(
      await request(harness.server)
        .get(`${RECORDS}?patientId=${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    expect(page.totalItems).toBe(0);
  });

  /**
   * RM M12.2's verify step: a child failure rolls the parent back.
   *
   * Two diagnoses with the same ICD code violate
   * `@@unique([record_id, icd_code_id])` — a constraint that fires
   * *inside* the transaction, after the parent row has been inserted.
   * That is the case worth testing: the unknown-code path above refuses
   * before any write, so it proves the guard rather than the rollback.
   */
  it('rolls the parent back when a child write fails mid-transaction', async () => {
    const doctor = await seedDoctor('rollback');
    const patientId = await seedPatient(doctor.token);

    const response = await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send(
        recordBody(patientId, {
          diagnoses: [
            { code: 'I10', isPrimary: true },
            { code: 'I10', isPrimary: false },
          ],
        }),
      );

    expect(response.status).toBeGreaterThanOrEqual(400);

    const page = dataOf<Page<RecordView>>(
      await request(harness.server)
        .get(`${RECORDS}?patientId=${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    // No orphaned parent: the record, its timeline event and its one
    // successful diagnosis all went back.
    expect(page.totalItems).toBe(0);
  });

  it('refuses two primary diagnoses with a field error', async () => {
    const doctor = await seedDoctor('two-primary');
    const patientId = await seedPatient(doctor.token);

    const response = await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send(
        recordBody(patientId, {
          diagnoses: [
            { code: 'I10', isPrimary: true },
            { code: 'E11.9', isPrimary: true },
          ],
        }),
      );

    expect(response.status).toBe(422);
  });

  it('refuses a blank chief complaint', async () => {
    const doctor = await seedDoctor('blank');
    const patientId = await seedPatient(doctor.token);

    const response = await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send(recordBody(patientId, { chiefComplaint: '   ' }));

    expect(response.status).toBe(422);
  });

  it('names a department the clinic runs, matched without regard to case', async () => {
    const doctor = await seedDoctor('dept-known');
    const patientId = await seedPatient(doctor.token);

    const response = await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send(recordBody(patientId, { department: 'cardiology' }));

    expect(response.status).toBe(201);
    expect(dataOf<RecordView>(response).department).toBe('Cardiology');
  });

  it('refuses a department the clinic does not run, and writes nothing', async () => {
    const doctor = await seedDoctor('dept-unknown');
    const patientId = await seedPatient(doctor.token);

    const response = await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send(recordBody(patientId, { department: 'Astrology' }));

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['department']).toBeDefined();
    expect(
      await harness.prisma.medicalRecord.count({ where: { patient: { publicId: patientId } } }),
    ).toBe(0);
  });

  it('refuses a department that has been closed', async () => {
    const doctor = await seedDoctor('dept-closed');
    const patientId = await seedPatient(doctor.token);
    const closed = await harness.prisma.department.create({
      data: { name: 'Mrec Closed Ward', status: 'INACTIVE' },
    });

    try {
      const response = await request(harness.server)
        .post(RECORDS)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send(recordBody(patientId, { department: closed.name }));

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['department']).toBeDefined();
    } finally {
      await harness.prisma.department.delete({ where: { id: closed.id } });
    }
  });

  it('refuses a record for a patient outside the caller’s care', async () => {
    const mine = await seedDoctor('scope-mine');
    const theirs = await seedDoctor('scope-theirs');
    const patientId = await seedPatient(theirs.token);

    const response = await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${mine.token}`)
      .send(recordBody(patientId));

    expect(response.status).toBe(404);
  });

  describe('linking the visit that produced the record (appointmentId)', () => {
    it('links an appointment from the caller’s book for the same patient', async () => {
      const doctor = await seedDoctor('link-own');
      const patientId = await seedPatient(doctor.token);
      const appointment = await seedAppointment(doctor, patientId);

      const reference = await createRecord(doctor.token, patientId, { appointmentId: appointment });

      const row = await harness.prisma.medicalRecord.findUniqueOrThrow({
        where: { publicId: reference },
        select: { appointment: { select: { publicId: true } } },
      });
      expect(row.appointment?.publicId).toBe(appointment);
    });

    it('refuses an appointment the caller had with a different patient, and writes nothing', async () => {
      const doctor = await seedDoctor('link-other-patient');
      const patientId = await seedPatient(doctor.token, 'Layla Morsi');
      const otherPatient = await seedPatient(doctor.token, 'Omar Haddad');
      const otherVisit = await seedAppointment(doctor, otherPatient);

      // Both charts are the caller's, so care scope does not refuse this.
      // The record would claim a visit with someone else as its source.
      const response = await request(harness.server)
        .post(RECORDS)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send(recordBody(patientId, { appointmentId: otherVisit }));

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['appointmentId']).toBeDefined();
      expect(
        await harness.prisma.medicalRecord.count({ where: { patient: { publicId: patientId } } }),
      ).toBe(0);
    });

    it('refuses an appointment from another doctor’s book', async () => {
      const mine = await seedDoctor('link-mine');
      const theirs = await seedDoctor('link-theirs');
      const patientId = await seedPatient(mine.token);
      const theirVisit = await seedAppointment(theirs, patientId);

      const response = await request(harness.server)
        .post(RECORDS)
        .set('Authorization', `Bearer ${mine.token}`)
        .send(recordBody(patientId, { appointmentId: theirVisit }));

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['appointmentId']).toBeDefined();
    });

    it('refuses an appointment reference that does not exist', async () => {
      const doctor = await seedDoctor('link-unknown');
      const patientId = await seedPatient(doctor.token);

      const response = await request(harness.server)
        .post(RECORDS)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send(recordBody(patientId, { appointmentId: 'APT-NOSUCH' }));

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['appointmentId']).toBeDefined();
    });
  });
});

describe('GET /medical-records (§6.1, §6.2)', () => {
  it('lists only records for patients the caller is on, and the detail agrees', async () => {
    const mine = await seedDoctor('list-mine');
    const theirs = await seedDoctor('list-theirs');
    const minePatient = await seedPatient(mine.token);
    const theirsPatient = await seedPatient(theirs.token);

    const own = await createRecord(mine.token, minePatient);
    const foreign = await createRecord(theirs.token, theirsPatient);

    const page = dataOf<Page<RecordView>>(
      await request(harness.server).get(RECORDS).set('Authorization', `Bearer ${mine.token}`),
    );

    expect(page.items.map((item) => item.id)).toEqual([own]);

    const outOfScope = await detail(mine.token, foreign);
    const missing = await detail(mine.token, 'MR-99999999');

    expect(outOfScope.status).toBe(404);
    expect(missing.status).toBe(404);
    // Byte-identical: a caller who could tell the two apart could walk
    // `MR-10001`, `MR-10002`, … and learn the clinic's caseload volume.
    expect(outOfScope.body).toEqual(missing.body);
  });

  it('filters by status and by diagnosis code', async () => {
    const doctor = await seedDoctor('filters');
    const patientId = await seedPatient(doctor.token);
    await createRecord(doctor.token, patientId, {
      diagnoses: [{ code: 'J45.909', isPrimary: true }],
    });

    const byStatus = dataOf<Page<RecordView>>(
      await request(harness.server)
        .get(`${RECORDS}?status=draft&patientId=${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    const byOtherStatus = dataOf<Page<RecordView>>(
      await request(harness.server)
        .get(`${RECORDS}?status=archived&patientId=${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    const byCode = dataOf<Page<RecordView>>(
      await request(harness.server)
        .get(`${RECORDS}?diagnosisCode=J45.909&patientId=${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    const byOtherCode = dataOf<Page<RecordView>>(
      await request(harness.server)
        .get(`${RECORDS}?diagnosisCode=I10&patientId=${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(byStatus.totalItems).toBe(1);
    expect(byOtherStatus.totalItems).toBe(0);
    expect(byCode.totalItems).toBe(1);
    expect(byOtherCode.totalItems).toBe(0);
  });

  it('serves null vitals rather than a zeroed reading', async () => {
    const doctor = await seedDoctor('vitals');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const document = dataOf<RecordDetailView>(await detail(doctor.token, reference));

    // `0/0 mmHg` with a BMI of 0 is a clinical falsehood, not a missing
    // value.
    expect(document.vitals).toBeNull();
  });

  it('does not shadow the summary route', async () => {
    const doctor = await seedDoctor('summary-route');

    const response = await request(harness.server)
      .get(`${RECORDS}/summary`)
      .set('Authorization', `Bearer ${doctor.token}`);

    expect(response.status).toBe(200);
    expect(dataOf<{ open: number }>(response).open).toBeTypeOf('number');
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(harness.server).get(RECORDS)).status).toBe(401);
  });
});

describe('PATCH /medical-records/{id} (§6.4) and the version trail (§6.8)', () => {
  it('writes one version row carrying the before and after of what changed', async () => {
    const doctor = await seedDoctor('version');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await patch(doctor.token, reference, {
      chiefComplaint: 'Headache, now with photophobia',
    });

    expect(response.status).toBe(200);

    const versions = dataOf<VersionView[]>(
      await request(harness.server)
        .get(`${RECORDS}/${reference}/versions`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
    expect(versions[0]?.changes['chiefComplaint']).toEqual({
      before: 'Persistent headache for two weeks',
      after: 'Headache, now with photophobia',
    });
  });

  it('numbers versions densely across several updates', async () => {
    const doctor = await seedDoctor('version-dense');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    await patch(doctor.token, reference, { priority: 'high' });
    await patch(doctor.token, reference, { physicalExamination: 'Mild neck stiffness noted.' });
    await patch(doctor.token, reference, { visitType: 'Follow-up' });

    const versions = dataOf<VersionView[]>(
      await request(harness.server)
        .get(`${RECORDS}/${reference}/versions`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(versions.map((version) => version.version)).toEqual([3, 2, 1]);
  });

  it('refuses an update that changes nothing rather than recording it', async () => {
    const doctor = await seedDoctor('noop');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await patch(doctor.token, reference, {
      chiefComplaint: 'Persistent headache for two weeks',
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('no_effective_change');

    const versions = dataOf<VersionView[]>(
      await request(harness.server)
        .get(`${RECORDS}/${reference}/versions`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    expect(versions).toHaveLength(0);
  });

  it('refuses an empty body', async () => {
    const doctor = await seedDoctor('empty-patch');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    expect((await patch(doctor.token, reference, {})).status).toBe(422);
  });

  it('replaces a child collection rather than merging it', async () => {
    const doctor = await seedDoctor('children');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId, {
      treatmentPlan: ['One', 'Two', 'Three'],
    });

    await patch(doctor.token, reference, { treatmentPlan: ['Only this'] });

    const document = dataOf<RecordDetailView>(await detail(doctor.token, reference));
    // "The items you did not mention keep what they had" silently
    // preserves a line the doctor believes they deleted.
    expect(document.treatmentPlan).toEqual(['Only this']);
  });

  /**
   * RM M12.6's verify step: "DELETE endpoint does not exist (404 route
   * test)".
   *
   * API §6 states records are "never hard-deleted; fully versioned", and
   * the strongest form of that at this layer is that there is no verb to
   * call. Asserted as a route test rather than trusted from reading the
   * controller, because a `@Delete` added later would pass review far
   * more easily than it would pass this.
   */
  it('exposes no delete verb on a record', async () => {
    const doctor = await seedDoctor('no-delete');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await request(harness.server)
      .delete(`${RECORDS}/${reference}`)
      .set('Authorization', `Bearer ${doctor.token}`);

    expect(response.status).toBe(404);

    // And the record is still there.
    expect((await detail(doctor.token, reference)).status).toBe(200);
  });

  it('names the replaced collections in the version row', async () => {
    const doctor = await seedDoctor('children-version');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    await patch(doctor.token, reference, { treatmentPlan: ['Rest and fluids'] });

    const versions = dataOf<VersionView[]>(
      await request(harness.server)
        .get(`${RECORDS}/${reference}/versions`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(versions[0]?.changes['children']).toEqual(['treatmentPlan']);
  });

  it('enforces one primary diagnosis on update', async () => {
    const doctor = await seedDoctor('primary-update');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await patch(doctor.token, reference, {
      diagnoses: [
        { code: 'I10', isPrimary: true },
        { code: 'K21.9', isPrimary: true },
      ],
    });

    expect(response.status).toBe(422);
  });

  /**
   * BR-DEC-004 (DEC-004): the record's author edits it.
   *
   * The colleague shares the patient and reads the record first, so the
   * refusal under test is authorship rather than care scope.
   */
  it('refuses an edit by a colleague on the care team, and writes no version', async () => {
    const author = await seedDoctor('edit-author');
    const colleague = await seedDoctor('edit-colleague');
    const patientId = await seedPatient(author.token);
    const reference = await createRecord(author.token, patientId);

    const patient = await harness.prisma.patient.findUniqueOrThrow({
      where: { publicId: patientId },
      select: { id: true },
    });
    const colleagueDoctor = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: colleague.email } },
      select: { id: true },
    });
    await harness.prisma.patientDoctorAssignment.create({
      data: { patientId: patient.id, doctorId: colleagueDoctor.id },
    });

    expect((await detail(colleague.token, reference)).status).toBe(200);

    const response = await patch(colleague.token, reference, {
      chiefComplaint: 'Rewritten by a colleague',
      reason: 'I disagree with the history',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(errorBody(response).code).toBe('not_record_author');

    const document = dataOf<RecordDetailView>(await detail(author.token, reference));
    expect(document.chiefComplaint).toBe('Persistent headache for two weeks');

    const versions = dataOf<VersionView[]>(
      await request(harness.server)
        .get(`${RECORDS}/${reference}/versions`)
        .set('Authorization', `Bearer ${author.token}`),
    );
    expect(versions).toHaveLength(0);
  });

  it('persists the editor’s reason on the version and serves it back', async () => {
    const doctor = await seedDoctor('edit-reason');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    expect(
      (
        await patch(doctor.token, reference, {
          chiefComplaint: 'Headache with visual aura',
          reason: 'Patient recalled the aura at follow-up',
        })
      ).status,
    ).toBe(200);
    expect((await patch(doctor.token, reference, { visitType: 'Follow-up' })).status).toBe(200);

    const versions = dataOf<(VersionView & { reason: string | null })[]>(
      await request(harness.server)
        .get(`${RECORDS}/${reference}/versions`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    // Newest first: the edit without a reason, then the one with it.
    expect(versions.map((version) => version.reason)).toEqual([
      null,
      'Patient recalled the aura at follow-up',
    ]);
  });

  it('refuses a reason sent with nothing to change', async () => {
    const doctor = await seedDoctor('edit-reason-only');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await patch(doctor.token, reference, { reason: 'Just because' });

    expect(response.status).toBe(422);
  });

  async function versionsOf(token: string, reference: string): Promise<VersionView[]> {
    return dataOf<VersionView[]>(
      await request(harness.server)
        .get(`${RECORDS}/${reference}/versions`)
        .set('Authorization', `Bearer ${token}`),
    );
  }

  it('records priority, visit date and follow-up date in their wire form', async () => {
    const doctor = await seedDoctor('edit-dates');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId, {
      followUpDate: '2026-09-24',
    });

    const response = await patch(doctor.token, reference, {
      priority: 'high',
      visitDate: '2026-09-11T10:30:00.000Z',
      followUpDate: '2026-10-01',
    });
    expect(response.status).toBe(200);

    const [version] = await versionsOf(doctor.token, reference);
    // The wire spellings a reviewer reads, not the database's: `normal`
    // rather than `NORMAL`, and the follow-up as the date it is.
    expect(version?.changes['priority']).toEqual({ before: 'normal', after: 'high' });
    expect(version?.changes['visitDate']).toEqual({
      before: '2026-09-10T09:00:00.000Z',
      after: '2026-09-11T10:30:00.000Z',
    });
    expect(version?.changes['followUpDate']).toEqual({ before: '2026-09-24', after: '2026-10-01' });
    expect(version?.summary).toBe('Changed 3 sections: priority, visitDate, followUpDate');
  });

  it('records a cleared follow-up date as null', async () => {
    const doctor = await seedDoctor('edit-followup-clear');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId, {
      followUpDate: '2026-09-24',
    });

    const response = await patch(doctor.token, reference, { followUpDate: null });
    expect(response.status).toBe(200);
    expect(dataOf<RecordDetailView>(response).followUpDate).toBeNull();

    const [version] = await versionsOf(doctor.token, reference);
    expect(version?.changes['followUpDate']).toEqual({ before: '2026-09-24', after: null });
    expect(version?.summary).toBe('Changed followUpDate');
  });

  it('treats a re-sent priority, visit date and follow-up date as no change', async () => {
    const doctor = await seedDoctor('edit-dates-echo');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId, {
      followUpDate: '2026-09-24',
    });

    // A form echoing its state: the same instant written another way,
    // and the same follow-up day.
    const response = await patch(doctor.token, reference, {
      priority: 'normal',
      visitDate: '2026-09-10T11:00:00.000+02:00',
      followUpDate: '2026-09-24',
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('no_effective_change');
    expect(await versionsOf(doctor.token, reference)).toHaveLength(0);
  });
});

describe('POST /medical-records/{id}/status (§6.5)', () => {
  function move(token: string, reference: string, status: string) {
    return request(harness.server)
      .post(`${RECORDS}/${reference}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status });
  }

  it('walks draft → active → completed → archived', async () => {
    const doctor = await seedDoctor('lifecycle');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    for (const status of ['active', 'completed', 'archived']) {
      const response = await move(doctor.token, reference, status);
      expect(response.status).toBe(200);
      expect(dataOf<RecordDetailView>(response).status).toBe(status);
    }
  });

  it('refuses skipping a step', async () => {
    const doctor = await seedDoctor('lifecycle-skip');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await move(doctor.token, reference, 'completed');

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('invalid_status_transition');
    expect(errorBody(response).detail).toContain('active');
  });

  it('refuses going backwards', async () => {
    const doctor = await seedDoctor('lifecycle-back');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    await move(doctor.token, reference, 'active');
    const response = await move(doctor.token, reference, 'draft');

    // A clinical document that could be un-finalised is one whose
    // "completed" means nothing.
    expect(response.status).toBe(409);
  });

  it('refuses edits once the record is completed', async () => {
    const doctor = await seedDoctor('lifecycle-frozen');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    await move(doctor.token, reference, 'active');
    await move(doctor.token, reference, 'completed');

    const response = await patch(doctor.token, reference, { chiefComplaint: 'Something else' });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('record_not_editable');
  });

  it('records the transition on the timeline', async () => {
    const doctor = await seedDoctor('lifecycle-timeline');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await move(doctor.token, reference, 'active');

    const timeline = dataOf<RecordDetailView>(response).timeline;
    expect(timeline.some((event) => event.kind === 'status-changed')).toBe(true);
  });

  describe('two transitions racing', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Both requests read `draft` and pass the machine; only one
     * compare-and-set can still find `draft`. Staged rather than hoped
     * for: the spy runs the same transition once on the other request's
     * behalf, then lets this request's own compare-and-set run, which
     * finds the status already moved.
     */
    it('answers the loser 409 stale_write and records the transition once', async () => {
      const doctor = await seedDoctor('lifecycle-race');
      const patientId = await seedPatient(doctor.token);
      const reference = await createRecord(doctor.token, patientId);

      const records = harness.app.get(RecordRepository);
      const transition = records.transitionStatus.bind(records);
      vi.spyOn(records, 'transitionStatus').mockImplementationOnce(async (input) => {
        if (!(await transition(input))) throw new Error('fixture: the other request should win');
        return transition(input);
      });

      const response = await move(doctor.token, reference, 'active');

      expect(response.status).toBe(409);
      expect(errorBody(response).code).toBe('stale_write');

      const row = await harness.prisma.medicalRecord.findUniqueOrThrow({
        where: { publicId: reference },
        select: { status: true, timeline: { where: { kind: 'STATUS_CHANGED' } } },
      });
      expect(row.status).toBe('ACTIVE');
      expect(row.timeline).toHaveLength(1);
    });
  });
});

/**
 * Finalisation racing an edit (§6.4, §6.5, §6.6).
 *
 * The interleaving that matters is the one a sequential test cannot
 * produce: the edit reads the record as `active`, a finalisation commits
 * `completed`, and only then does the edit write. Each test forces it by
 * completing the record in a transaction of its own, starting the edit,
 * and committing only once PostgreSQL reports the edit's backend waiting
 * on that transaction — or once the edit has answered without waiting,
 * which is the defect, and the assertions then say so with its status.
 */
describe('finalisation racing an edit (§6.4, §6.5, §6.6)', () => {
  function move(token: string, reference: string, status: string) {
    return request(harness.server)
      .post(`${RECORDS}/${reference}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status });
  }

  function addNote(token: string, reference: string, body: Record<string, unknown>) {
    return request(harness.server)
      .post(`${RECORDS}/${reference}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  /** Waits until a backend is blocked by `pid`, or until `settled()` says the write answered. */
  async function untilBlockedBy(pid: number, settled: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      if (settled()) return;

      const rows = await harness.prisma.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
      if (Number(rows[0]?.waiting ?? 0) > 0) return;

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error('The edit neither blocked on the finalisation nor answered');
  }

  /** Runs `write` while a finalisation of `reference` is in flight, then commits it. */
  async function completeDuring(
    reference: string,
    write: () => PromiseLike<request.Response>,
  ): Promise<request.Response> {
    let pending: Promise<request.Response> | undefined;

    await harness.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          UPDATE medical_records SET status = 'completed'::record_status
          WHERE public_id = ${reference}`;

        const [self] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid`;

        let settled = false;
        pending = Promise.resolve(write()).finally(() => {
          settled = true;
        });

        await untilBlockedBy(Number(self?.pid), () => settled);
      },
      { timeout: 20_000 },
    );

    if (pending === undefined) throw new Error('The edit never started');

    return pending;
  }

  async function activeRecord(local: string): Promise<{ doctor: Doctor; reference: string }> {
    const doctor = await seedDoctor(local);
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    expect((await move(doctor.token, reference, 'active')).status).toBe(200);

    return { doctor, reference };
  }

  it('refuses an update that read the record before it was completed, and writes nothing', async () => {
    const { doctor, reference } = await activeRecord('race-update');

    const response = await completeDuring(reference, () =>
      patch(doctor.token, reference, { chiefComplaint: 'Edited during finalisation' }),
    );

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('record_not_editable');

    const after = dataOf<RecordDetailView>(await detail(doctor.token, reference));
    expect(after.status).toBe('completed');
    expect(after.chiefComplaint).toBe('Persistent headache for two weeks');

    const versions = dataOf<VersionView[]>(
      await request(harness.server)
        .get(`${RECORDS}/${reference}/versions`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    expect(versions).toHaveLength(0);
  });

  it('refuses a note that read the record before it was completed, and writes nothing', async () => {
    const { doctor, reference } = await activeRecord('race-note');

    const response = await completeDuring(reference, () =>
      addNote(doctor.token, reference, {
        title: 'Late note',
        body: 'Written while the record was being finalised.',
      }),
    );

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('record_not_editable');

    const after = dataOf<RecordDetailView>(await detail(doctor.token, reference));
    expect(after.status).toBe('completed');
    expect(after.notes).toHaveLength(0);
    expect(after.timeline.some((event) => event.kind === 'note-added')).toBe(false);
  });

  it('lets a finalisation that waited behind an edit see the edit', async () => {
    const { doctor, reference } = await activeRecord('race-order');

    // The other order: the edit holds the row, the status change queues
    // behind it and then succeeds. Completing is still allowed — the
    // edit landed while the record was active — and the history has it.
    let pending: Promise<request.Response> | undefined;

    await harness.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM medical_records WHERE public_id = ${reference}
          FOR NO KEY UPDATE`;
        await tx.$executeRaw`
          UPDATE medical_records SET chief_complaint = 'Edited first'
          WHERE public_id = ${reference}`;

        const [self] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid`;

        let settled = false;
        pending = Promise.resolve(move(doctor.token, reference, 'completed')).finally(() => {
          settled = true;
        });

        await untilBlockedBy(Number(self?.pid), () => settled);
      },
      { timeout: 20_000 },
    );

    if (pending === undefined) throw new Error('The status change never started');

    const response = await pending;
    expect(response.status).toBe(200);

    const after = dataOf<RecordDetailView>(response);
    expect(after.status).toBe('completed');
    expect(after.chiefComplaint).toBe('Edited first');
  });
});

describe('notes (§6.6)', () => {
  function addNote(token: string, reference: string, body: Record<string, unknown>) {
    return request(harness.server)
      .post(`${RECORDS}/${reference}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('adds a note and puts it on the timeline', async () => {
    const doctor = await seedDoctor('note');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await addNote(doctor.token, reference, {
      title: 'Progress note',
      body: 'Symptoms improving on the current regimen.',
    });

    expect(response.status).toBe(201);

    const document = dataOf<RecordDetailView>(response);
    expect(document.notes).toHaveLength(1);
    expect(document.notes[0]?.signed).toBe(false);
    expect(document.timeline.some((event) => event.kind === 'note-added')).toBe(true);
  });

  it('persists the aiAssisted provenance through signing', async () => {
    const doctor = await seedDoctor('note-ai');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const created = dataOf<RecordDetailView>(
      await addNote(doctor.token, reference, {
        title: 'AI-assisted summary',
        body: 'Drafted from the consultation transcript.',
        aiAssisted: true,
      }),
    );

    const noteId = created.notes[0]?.id ?? '';

    const signed = dataOf<RecordDetailView>(
      await request(harness.server)
        .post(`${RECORDS}/${reference}/notes/${noteId}/sign`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({}),
    );

    // M16.6: the only path from an assistant's output into the clinical
    // record is a note a doctor signed, and the flag is what makes that
    // reviewable afterwards.
    expect(signed.notes[0]?.signed).toBe(true);
    expect(signed.notes[0]?.aiAssisted).toBe(true);
    expect(signed.notes[0]?.signedAt).not.toBeNull();
  });

  it('refuses a second signature on the same note', async () => {
    const doctor = await seedDoctor('note-twice');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const created = dataOf<RecordDetailView>(
      await addNote(doctor.token, reference, { title: 'Note', body: 'Body' }),
    );
    const noteId = created.notes[0]?.id ?? '';

    const sign = () =>
      request(harness.server)
        .post(`${RECORDS}/${reference}/notes/${noteId}/sign`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({});

    expect((await sign()).status).toBe(200);

    const second = await sign();
    expect(second.status).toBe(409);
    expect(errorBody(second).code).toBe('note_already_signed');
  });

  it('refuses a colleague signing someone else’s note', async () => {
    const author = await seedDoctor('note-author');
    const colleague = await seedDoctor('note-colleague');
    const patientId = await seedPatient(author.token);
    const reference = await createRecord(author.token, patientId);

    const created = dataOf<RecordDetailView>(
      await addNote(author.token, reference, { title: 'Note', body: 'Body' }),
    );
    const noteId = created.notes[0]?.id ?? '';

    // Share the patient so the colleague can reach the record at all —
    // the refusal under test is authorship, not care scope.
    const patient = await harness.prisma.patient.findUniqueOrThrow({
      where: { publicId: patientId },
      select: { id: true },
    });
    const colleagueDoctor = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: colleague.email } },
      select: { id: true },
    });
    await harness.prisma.patientDoctorAssignment.create({
      data: { patientId: patient.id, doctorId: colleagueDoctor.id },
    });

    expect((await detail(colleague.token, reference)).status).toBe(200);

    const response = await request(harness.server)
      .post(`${RECORDS}/${reference}/notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${colleague.token}`)
      .send({});

    // A signature a colleague can apply is a signature that means
    // nothing. 403 rather than 404: the note is not hidden from them.
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('not_note_author');
  });

  it('counts unsigned notes in the summary', async () => {
    const doctor = await seedDoctor('note-summary');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    await addNote(doctor.token, reference, { title: 'Unsigned', body: 'Pending review' });

    const summary = dataOf<{ open: number; unsignedNotes: number }>(
      await request(harness.server)
        .get(`${RECORDS}/summary`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(summary.open).toBe(1);
    expect(summary.unsignedNotes).toBe(1);
  });
});

describe('POST /medical-records/{id}/report-issue (§6.9)', () => {
  it('opens an issue against a record the caller can read', async () => {
    const doctor = await seedDoctor('issue');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await request(harness.server)
      .post(`${RECORDS}/${reference}/report-issue`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ description: 'The visit date is a day out.' });

    expect(response.status).toBe(201);
    expect(dataOf<{ status: string }>(response).status).toBe('open');
  });

  it('refuses an empty description', async () => {
    const doctor = await seedDoctor('issue-blank');
    const patientId = await seedPatient(doctor.token);
    const reference = await createRecord(doctor.token, patientId);

    const response = await request(harness.server)
      .post(`${RECORDS}/${reference}/report-issue`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ description: '  ' });

    expect(response.status).toBe(422);
  });
});
