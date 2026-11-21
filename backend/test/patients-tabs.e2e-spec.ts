import request from 'supertest';
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
 * The chart's tabs and their child CRUD (RM M10.3, M10.6 — API §4.5–4.6).
 *
 * Three properties carry this file:
 *
 *  · **Every tab is care-scoped.** A doctor with no care relationship is
 *    refused each one with the 404 a missing chart produces — the same
 *    rule `patients-clinical.e2e-spec.ts` proves for the aggregate,
 *    re-checked here because these are a second controller and a second
 *    chance to get it wrong.
 *  · **A signed note is frozen.** The edit answers 409 rather than
 *    quietly succeeding, and the stored body is asserted unchanged.
 *  · **Blood pressure stays two numbers**, and `bmi` comes from the
 *    database's generated column rather than from a client value.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface Page<T> {
  items: T[];
  totalItems: number;
}

interface NoteView {
  id: string;
  title: string;
  body: string;
  author: string;
  signed: boolean;
  signedAt: string | null;
  aiAssisted: boolean;
}

interface VitalsView {
  id: string;
  systolic: number;
  diastolic: number;
  bmi: number | null;
  recordedBy: string | null;
}

interface ContactView {
  id: string;
  name: string;
  isPrimary: boolean;
}

interface HistoryView {
  id: string;
  kind: string;
  title: string;
  occurredOn: string;
  recordedBy: string | null;
}

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<SessionPayload>(response).accessToken;
}

async function createPatient(token: string): Promise<string> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Tabbed Patient',
      dateOfBirth: '1979-09-09',
      gender: 'female',
      bloodType: 'B+',
      phone: '+20 100 321 7654',
      allergies: [],
      chronicConditions: [],
    });

  expect(response.status).toBe(201);

  const publicId = dataOf<{ id: string }>(response).id;
  createdCharts.push(publicId);

  return publicId;
}

beforeAll(async () => {
  harness = await createAuthHarness('patients-tabs');
}, 60_000);

/**
 * The charts **this suite** created, deleted by id rather than by prefix.
 *
 * Both patient suites allocate `PT-…` handles from one shared sequence,
 * so a prefix sweep deletes the other file's fixtures mid-run — and
 * Vitest runs spec files in parallel, which makes that a failure that
 * appears only in a full-suite run and never when the file is run alone.
 * Tracking the ids is the only cleanup that is actually this suite's.
 *
 * Charts go **before** accounts: several child tables reference `users`
 * with `onDelete: Restrict` (`patient_notes.author_id` among them), so
 * deleting a doctor while their clinical rows exist violates the
 * constraint. `harness.reset()` cannot know that — it deletes accounts
 * by email suffix, and a patient has no account to be found by.
 */
const createdCharts: string[] = [];

async function clearCharts(): Promise<void> {
  // Guarded: `beforeAll` can fail before the harness exists, and an
  // `afterAll` that then threw would replace the real failure with a
  // `TypeError` and hide it.
  if (harness === undefined || createdCharts.length === 0) return;

  await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  createdCharts.length = 0;
}

afterAll(async () => {
  await clearCharts();
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await clearCharts();
  await harness.reset();
});

describe('care scoping across every tab (§4.5)', () => {
  it('refuses each tab to a doctor with no care relationship', async () => {
    const owner = await seedDoctor('tabowner');
    const stranger = await seedDoctor('tabstranger');
    const patientId = await createPatient(owner);

    for (const tab of [
      'history',
      'emergency-contacts',
      'notes',
      'vitals',
      'medications',
      'documents',
      'studies',
      'appointments',
    ]) {
      const response = await request(harness.server)
        .get(`${PATIENTS}/${patientId}/${tab}`)
        .set('Authorization', `Bearer ${stranger}`);

      // The same 404 a missing chart produces (ADR-022): a 403 would
      // confirm the chart exists.
      expect(response.status).toBe(404);
    }
  });

  it('serves every tab to the assigned doctor', async () => {
    const token = await seedDoctor('tabreader');
    const patientId = await createPatient(token);

    for (const tab of [
      'history',
      'emergency-contacts',
      'notes',
      'vitals',
      'medications',
      'documents',
      'studies',
      'appointments',
    ]) {
      const response = await request(harness.server)
        .get(`${PATIENTS}/${patientId}/${tab}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    }
  });
});

describe('history (§4.5, §4.6)', () => {
  it('records an event and attributes it', async () => {
    const token = await seedDoctor('historian');
    const patientId = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'surgery',
        title: 'Appendectomy',
        occurredOn: '2019-06-02',
        facility: 'Cairo General',
      });

    expect(created.status).toBe(201);
    expect(dataOf<HistoryView>(created).kind).toBe('surgery');
    expect(dataOf<HistoryView>(created).occurredOn).toBe('2019-06-02');
    expect(dataOf<HistoryView>(created).recordedBy).toMatch(/^usr_/);

    const listed = await request(harness.server)
      .get(`${PATIENTS}/${patientId}/history`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<Page<HistoryView>>(listed).totalItems).toBe(1);

    const removed = await request(harness.server)
      .delete(`${PATIENTS}/${patientId}/history/${dataOf<HistoryView>(created).id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Entered on the wrong chart' });
    expect(removed.status).toBe(204);
  });

  it('refuses a history event dated in the future', async () => {
    const token = await seedDoctor('futurehistory');
    const patientId = await createPatient(token);

    const response = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'surgery', title: 'Not yet', occurredOn: '2999-01-01' });

    // A surgery scheduled for next week is an appointment; recording it
    // as history would put it on the timeline as something that happened.
    expect(response.status).toBe(422);
  });
});

describe('emergency contacts (§4.6)', () => {
  it('keeps exactly one primary contact', async () => {
    const token = await seedDoctor('contacts');
    const patientId = await createPatient(token);

    await request(harness.server)
      .post(`${PATIENTS}/${patientId}/emergency-contacts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'First Contact', relationship: 'Sister', phone: '+20 100 111 0001', isPrimary: true });

    await request(harness.server)
      .post(`${PATIENTS}/${patientId}/emergency-contacts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second Contact', relationship: 'Son', phone: '+20 100 111 0002', isPrimary: true });

    const listed = await request(harness.server)
      .get(`${PATIENTS}/${patientId}/emergency-contacts`)
      .set('Authorization', `Bearer ${token}`);

    const contacts = dataOf<ContactView[]>(listed);
    expect(contacts).toHaveLength(2);
    // The schema has a partial unique index on "one primary per
    // patient"; demoting the old one is better than an insert that fails
    // on something the user has just told us they meant.
    expect(contacts.filter((contact) => contact.isPrimary)).toHaveLength(1);
    expect(contacts.find((contact) => contact.isPrimary)?.name).toBe('Second Contact');
  });

  it('removes a contact softly', async () => {
    const token = await seedDoctor('contactremove');
    const patientId = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/emergency-contacts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Temporary', relationship: 'Neighbour', phone: '+20 100 111 0003' });

    const removed = await request(harness.server)
      .delete(`${PATIENTS}/${patientId}/emergency-contacts/${dataOf<ContactView>(created).id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(removed.status).toBe(204);

    const row = await harness.prisma.patientEmergencyContact.findUnique({
      where: { id: dataOf<ContactView>(created).id },
      select: { deletedAt: true, removalReason: true },
    });
    expect(row?.deletedAt).not.toBeNull();
    // No body, as the client sends today: still a 204, and no reason.
    expect(row?.removalReason).toBeNull();
  });
});

/**
 * BR-DEC-003 (DEC-003, accepted 2026-10-21) — the reason for a removal is
 * persisted with the row, not only in a log line.
 *
 * History removal requires one ("each with a **mandatory reason**"); contact
 * removal takes one when given. What this does **not** build is listed in
 * `FRONTEND_DECISION_REQUIREMENTS.md`: the versioned correction route and
 * the read of removed entries both wait on who-may rules no decision sets.
 */
describe('BR-DEC-003 — removal reasons', () => {
  async function addHistory(token: string, patientId: string): Promise<string> {
    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'surgery', title: 'Appendectomy', occurredOn: '2019-06-02' });
    expect(created.status).toBe(201);
    return dataOf<HistoryView>(created).id;
  }

  function removeHistory(token: string, patientId: string, eventId: string, body?: object) {
    const call = request(harness.server)
      .delete(`${PATIENTS}/${patientId}/history/${eventId}`)
      .set('Authorization', `Bearer ${token}`);
    return body === undefined ? call : call.send(body);
  }

  function historyRow(eventId: string) {
    return harness.prisma.patientMedicalHistory.findUniqueOrThrow({
      where: { id: eventId },
      select: { deletedAt: true, removalReason: true },
    });
  }

  it.each([
    ['no body', undefined],
    ['no reason', {}],
    ['a blank reason', { reason: '   ' }],
    ['a reason over 300 characters', { reason: 'x'.repeat(301) }],
  ])('refuses a history removal with %s, and removes nothing', async (label, body) => {
    const token = await seedDoctor(`reasonless-${label.replace(/\W+/g, '-')}`);
    const patientId = await createPatient(token);
    const eventId = await addHistory(token, patientId);

    const response = await removeHistory(token, patientId, eventId, body);

    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(errorBody(response).fieldErrors).toHaveProperty('reason');
    expect(await historyRow(eventId)).toEqual({ deletedAt: null, removalReason: null });
  });

  it('removes a history event with its reason, trimmed, and keeps the row', async () => {
    const token = await seedDoctor('reasoned-history');
    const patientId = await createPatient(token);
    const eventId = await addHistory(token, patientId);

    const response = await removeHistory(token, patientId, eventId, {
      reason: '  Recorded against the wrong patient  ',
    });
    expect(response.status).toBe(204);

    const row = await historyRow(eventId);
    expect(row.deletedAt).not.toBeNull();
    expect(row.removalReason).toBe('Recorded against the wrong patient');

    // Gone from the timeline, as before.
    const listed = await request(harness.server)
      .get(`${PATIENTS}/${patientId}/history`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<Page<HistoryView>>(listed).totalItems).toBe(0);
  });

  it('audits that a reason was given, and never its text', async () => {
    const token = await seedDoctor('audited-history');
    const patientId = await createPatient(token);
    const eventId = await addHistory(token, patientId);

    const removed = await removeHistory(token, patientId, eventId, {
      reason: 'Duplicate of an earlier entry',
    });
    expect(removed.status).toBe(204);

    const rows = await harness.prisma.auditEvent.findMany({
      where: { eventType: 'patient.history_remove', target: `patient:${patientId}` },
      select: { payload: true },
    });
    expect(rows).toHaveLength(1);

    const payload = JSON.stringify(rows[0]?.payload);
    expect(payload).toContain('"reasonGiven":true');
    expect(payload).not.toContain('Duplicate of an earlier entry');
  });

  it('answers a doctor outside the care relationship with 404, reason or not', async () => {
    const owner = await seedDoctor('history-owner');
    const stranger = await seedDoctor('history-stranger');
    const patientId = await createPatient(owner);
    const eventId = await addHistory(owner, patientId);

    const response = await removeHistory(stranger, patientId, eventId, {
      reason: 'Trying to remove it',
    });

    expect(response.status).toBe(404);
    expect(await historyRow(eventId)).toEqual({ deletedAt: null, removalReason: null });
  });

  it('persists the reason for removing a contact when one is given', async () => {
    const token = await seedDoctor('reasoned-contact');
    const patientId = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/emergency-contacts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Old Number', relationship: 'Brother', phone: '+20 100 111 0004' });
    const contactId = dataOf<ContactView>(created).id;

    const removed = await request(harness.server)
      .delete(`${PATIENTS}/${patientId}/emergency-contacts/${contactId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Patient asked for this contact to be removed' });
    expect(removed.status).toBe(204);

    const row = await harness.prisma.patientEmergencyContact.findUniqueOrThrow({
      where: { id: contactId },
      select: { deletedAt: true, removalReason: true },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.removalReason).toBe('Patient asked for this contact to be removed');
  });

  it('refuses a blank contact-removal reason rather than storing it', async () => {
    const token = await seedDoctor('blank-contact');
    const patientId = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/emergency-contacts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kept', relationship: 'Aunt', phone: '+20 100 111 0005' });

    const response = await request(harness.server)
      .delete(`${PATIENTS}/${patientId}/emergency-contacts/${dataOf<ContactView>(created).id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: '  ' });

    expect(response.status).toBe(422);
  });
});

describe('notes (§4.6)', () => {
  it('freezes a note once it is signed', async () => {
    const token = await seedDoctor('notary');
    const patientId = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Consultation', body: 'Original body', aiAssisted: true });

    expect(created.status).toBe(201);
    const note = dataOf<NoteView>(created);
    expect(note.signed).toBe(false);
    expect(note.author).toMatch(/^usr_/);
    // Provenance belongs to the draft — "AI-assisted, reviewed by …".
    expect(note.aiAssisted).toBe(true);

    const edited = await request(harness.server)
      .patch(`${PATIENTS}/${patientId}/notes/${note.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Edited before signing' });
    expect(edited.status).toBe(200);

    const signed = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/notes/${note.id}/sign`)
      .set('Authorization', `Bearer ${token}`);
    expect(signed.status).toBe(200);
    expect(dataOf<NoteView>(signed).signed).toBe(true);
    expect(dataOf<NoteView>(signed).signedAt).not.toBeNull();

    const afterSigning = await request(harness.server)
      .patch(`${PATIENTS}/${patientId}/notes/${note.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Sneaking a change in' });

    // 409 and not 404: the caller has already proved they may reach this
    // chart, so hiding the note buys nothing, and "this note is signed"
    // is what the client should render.
    expect(afterSigning.status).toBe(409);
    expect(errorBody(afterSigning).code).toBe('invalid_status_transition');

    const stored = await harness.prisma.patientNote.findUniqueOrThrow({
      where: { id: note.id },
      select: { body: true },
    });
    expect(stored.body).toBe('Edited before signing');
  });

  it('refuses a second signature rather than moving the timestamp', async () => {
    const token = await seedDoctor('doublesign');
    const patientId = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Once', body: 'Signed once' });
    const noteId = dataOf<NoteView>(created).id;

    const first = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${token}`);
    const signedAt = dataOf<NoteView>(first).signedAt;

    const second = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${token}`);

    expect(second.status).toBe(409);

    const stored = await harness.prisma.patientNote.findUniqueOrThrow({
      where: { id: noteId },
      select: { signedAt: true },
    });
    expect(stored.signedAt?.toISOString()).toBe(signedAt);
  });

  /**
   * BR-DEC-001 (DEC-001): only a chart note's author may edit or sign it,
   * for a direct API call and not only in the client.
   *
   * The colleague is put on the care team first, and the spec proves they
   * can read the note — so the refusal under test is authorship, not care
   * scope. A colleague who could not reach the chart would be refused with
   * a 404 for a different reason and the test would pass for nothing.
   */
  it('refuses edit and sign by a colleague on the care team, and changes nothing', async () => {
    const author = await seedDoctor('note-author');
    const colleague = await seedDoctor('note-colleague');
    const patientId = await createPatient(author);

    const patient = await harness.prisma.patient.findUniqueOrThrow({
      where: { publicId: patientId },
      select: { id: true },
    });
    const colleagueDoctor = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: testEmail('note-colleague') } },
      select: { id: true },
    });
    await harness.prisma.patientDoctorAssignment.create({
      data: { patientId: patient.id, doctorId: colleagueDoctor.id },
    });

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/notes`)
      .set('Authorization', `Bearer ${author}`)
      .send({ title: 'Assessment', body: 'Written by the author' });
    const noteId = dataOf<NoteView>(created).id;

    const visible = await request(harness.server)
      .get(`${PATIENTS}/${patientId}/notes`)
      .set('Authorization', `Bearer ${colleague}`);
    expect(visible.status).toBe(200);
    expect(JSON.stringify(visible.body)).toContain(noteId);

    const before = await harness.prisma.patientNote.findUniqueOrThrow({ where: { id: noteId } });

    const edit = await request(harness.server)
      .patch(`${PATIENTS}/${patientId}/notes/${noteId}`)
      .set('Authorization', `Bearer ${colleague}`)
      .send({ body: 'Rewritten by a colleague' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(403);
    expect(errorBody(edit).code).toBe('not_note_author');

    const sign = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${colleague}`);
    expect(sign.status, JSON.stringify(sign.body)).toBe(403);
    expect(errorBody(sign).code).toBe('not_note_author');

    // Unchanged in every column the two writes touch, including the
    // `updatedBy` that records who last changed it.
    expect(
      await harness.prisma.patientNote.findUniqueOrThrow({ where: { id: noteId } }),
    ).toEqual(before);

    // The author can still do both.
    const ownEdit = await request(harness.server)
      .patch(`${PATIENTS}/${patientId}/notes/${noteId}`)
      .set('Authorization', `Bearer ${author}`)
      .send({ body: 'Revised by the author' });
    expect(ownEdit.status).toBe(200);

    const ownSign = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${author}`);
    expect(ownSign.status).toBe(200);

    // Authorship is checked before state: a colleague editing the author's
    // signed note is told it is not theirs, not that it is signed.
    const afterSigning = await request(harness.server)
      .patch(`${PATIENTS}/${patientId}/notes/${noteId}`)
      .set('Authorization', `Bearer ${colleague}`)
      .send({ body: 'Too late, and not mine' });
    expect(afterSigning.status).toBe(403);
    expect(errorBody(afterSigning).code).toBe('not_note_author');

    await harness.prisma.patientDoctorAssignment.deleteMany({
      where: { patientId: patient.id, doctorId: colleagueDoctor.id },
    });
  });

  it("answers 404 for a note on another patient's chart", async () => {
    const token = await seedDoctor('crossnote');
    const firstId = await createPatient(token);
    const secondId = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${firstId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Belongs to the first', body: 'Body' });

    expect(created.status).toBe(201);

    const response = await request(harness.server)
      .patch(`${PATIENTS}/${secondId}/notes/${dataOf<NoteView>(created).id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Wrong chart' });

    expect(response.status).toBe(404);
  });
});

describe('vitals (§4.6)', () => {
  it('records a reading and lets the database compute the BMI', async () => {
    const token = await seedDoctor('vitals');
    const patientId = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patientId}/vitals`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        systolic: 128,
        diastolic: 82,
        heartRate: 74,
        temperatureC: 36.8,
        respiratoryRate: 16,
        oxygenSaturation: 98,
        weightKg: 72.5,
        heightCm: 168,
        // Deliberately supplied and deliberately ignored: `bmi` is a
        // stored generated column, and a client value could disagree
        // with its own inputs.
        bmi: 1,
      });

    expect(created.status).toBe(201);

    const view = dataOf<VitalsView>(created);
    expect(view.systolic).toBe(128);
    expect(view.diastolic).toBe(82);
    expect(view.recordedBy).toMatch(/^usr_/);
    // 72.5 / 1.68² ≈ 25.7 — Postgres's answer, not the body's 1.
    expect(view.bmi).toBeGreaterThan(25);
    expect(view.bmi).toBeLessThan(26);

    // And it reaches the profile bundle's latest-vitals slot.
    const profile = await request(harness.server)
      .get(`${PATIENTS}/${patientId}/profile`)
      .set('Authorization', `Bearer ${token}`);

    expect(dataOf<{ latestVitals: { systolic: number } }>(profile).latestVitals.systolic).toBe(128);
  });

  it('refuses implausible readings and an inverted blood pressure', async () => {
    const token = await seedDoctor('badvitals');
    const patientId = await createPatient(token);

    const base = {
      systolic: 120,
      diastolic: 80,
      heartRate: 70,
      temperatureC: 36.6,
      respiratoryRate: 16,
      oxygenSaturation: 98,
      weightKg: 70,
      heightCm: 170,
    };

    for (const override of [
      { systolic: 1200 },
      { oxygenSaturation: 140 },
      { temperatureC: 90 },
      // Diastolic above systolic is a transposition, and it is the one a
      // range check alone would let through.
      { systolic: 80, diastolic: 120 },
    ]) {
      const response = await request(harness.server)
        .post(`${PATIENTS}/${patientId}/vitals`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ...base, ...override });

      expect(response.status).toBe(422);
    }
  });
});
