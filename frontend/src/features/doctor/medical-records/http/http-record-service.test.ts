import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import {
  emptyDraft,
  isDraftComplete,
  withDiagnosisAdded,
  type CompleteRecordDraft,
} from '../model/authoring';
import { assessNoteSignability } from '../model/record-lifecycle';
import {
  RECORD_NO_CHANGE,
  RECORD_NOT_AUTHOR,
  RECORD_NOT_EDITABLE,
  RECORD_NOT_FOUND,
  RECORD_NOTE_NOT_SAVED,
} from '../model/record-service';

import { __resetHttpRecordDrafts, httpRecordService, toRecord } from './http-record-service';

/**
 * Medical records over HTTP (FE-10.5), against `MedicalRecordView` and
 * `MedicalRecordDetailView` bodies captured from the API on a seeded
 * database (`MR-10001`, created, noted and signed through the API).
 */

beforeEach(() => {
  __resetHttpRecordDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SUMMARY = {
  id: 'MR-10001',
  patient: {
    id: 'PT-1003',
    name: 'Amira Saleh',
    mrn: '4468-12',
    age: 34,
    gender: 'female',
    bloodType: 'B+',
    phone: '+20 122 574 9911',
  },
  visitDate: '2026-10-04T00:00:00.000Z',
  visitType: 'Consultation',
  department: 'General Medicine',
  doctorId: '545e8b20-0997-4fcb-860e-5b37042be266',
  doctor: 'Dr. Amelia Chen',
  status: 'draft',
  priority: 'normal',
  diagnoses: [{ code: 'R51.9', label: 'Headache, unspecified', isPrimary: true }],
  chiefComplaint: 'Headache for three days',
  followUpDate: null,
  createdAt: '2026-10-04T17:04:24.507Z',
  updatedAt: '2026-10-04T17:04:24.507Z',
};

const NOTE = {
  id: '2be2bea8-04b5-493e-b554-ad4e41d44c67',
  author: 'Dr. Amelia Chen',
  authoredAt: '2026-10-04T17:04:28.979Z',
  title: 'Assessment',
  body: 'Tension-type headache likely.',
  signed: false,
  signedAt: null,
  aiAssisted: false,
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...SUMMARY,
    historyOfPresentIllness: 'Gradual onset frontal headache.',
    physicalExamination: 'Alert, no focal deficit.',
    vitals: null,
    treatmentPlan: [],
    medications: [],
    allergies: [],
    notes: [NOTE],
    attachments: [],
    timeline: [
      {
        id: 'bc9551c9-17a5-45e1-8cc9-b31552344970',
        kind: 'created',
        at: '2026-10-04T17:04:24.512Z',
        actor: 'Dr. Amelia Chen',
        detail: 'Record created',
      },
    ],
    ...overrides,
  };
}

function completeDraft(): CompleteRecordDraft {
  const draft = {
    ...emptyDraft('draft-1', '2026-10-04T09:00:00.000Z'),
    patient: {
      id: 'PT-1003',
      name: 'Amira Saleh',
      mrn: '4468-12',
      age: 34,
      gender: 'female' as const,
      bloodType: 'B+' as const,
      phone: '+20 122 574 9911',
    },
    visit: { visitDate: '2026-10-04', visitType: 'Consultation', department: 'General Medicine' },
    chiefComplaint: '  Headache for three days ',
    historyOfPresentIllness: 'Gradual onset frontal headache.',
    physicalExamination: 'Alert, no focal deficit.',
    diagnoses: withDiagnosisAdded([], 'R51.9'),
    note: { title: 'Assessment', body: 'Tension-type headache likely.' },
  };
  if (!isDraftComplete(draft)) throw new Error('fixture is not a complete draft');
  return draft;
}

describe('toRecord', () => {
  it('maps the detail view field for field, keeping absent vitals null', () => {
    const record = toRecord(detail());
    expect(record).toMatchObject({
      id: 'MR-10001',
      patient: { id: 'PT-1003', gender: 'female', bloodType: 'B+' },
      status: 'draft',
      diagnoses: [{ code: 'R51.9', label: 'Headache, unspecified', isPrimary: true }],
      historyOfPresentIllness: 'Gradual onset frontal headache.',
      // A day, read as local midnight so it is the 4th in every timezone.
      visitDate: '2026-10-04T00:00:00',
      vitals: null,
      notes: [{ id: NOTE.id, author: 'Dr. Amelia Chen', signed: false }],
    });
  });

  it('shows a missing department as a dash rather than guessing one', () => {
    expect(toRecord(detail({ department: null })).department).toBe('—');
  });

  it('reads vitals when they exist', () => {
    const record = toRecord(
      detail({
        vitals: {
          recordedAt: '2026-10-04T09:00:00.000Z',
          bloodPressure: '128/82',
          heartRateBpm: 72,
          temperatureC: 36.8,
          respiratoryRate: 16,
          oxygenSaturation: 98,
          weightKg: 80,
          heightCm: 175,
          bmi: 26.1,
        },
      }),
    );
    expect(record.vitals).toMatchObject({ bloodPressure: '128/82', bmi: 26.1 });
  });

  it('refuses a status outside the vocabulary rather than rendering it', () => {
    let thrown: unknown = null;
    try {
      toRecord(detail({ status: 'pending-review' }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'malformed_response', ref: 'record.status' });
  });
});

describe('reads', () => {
  it('lists every page, newest visit first, as summaries', async () => {
    const { requests } = stubApi({ 'GET /medical-records': () => json(pageOf([SUMMARY])) });

    const records = await httpRecordService.listRecords();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 'MR-10001', chiefComplaint: 'Headache for three days' });
    expect(requests[0]?.query.get('sort')).toBe('visitDate:desc');
    expect(requests[0]?.query.get('pageSize')).toBe('100');
    expect(requests[0]?.query.has('patientId')).toBe(false);
  });

  it('narrows the list to one patient on the server', async () => {
    const { requests } = stubApi({ 'GET /medical-records': () => json(pageOf([])) });

    await expect(httpRecordService.listRecords({ patientId: 'PT-1003' })).resolves.toEqual([]);
    expect(requests[0]?.query.get('patientId')).toBe('PT-1003');
  });

  it('turns a 404 into the port’s not-found contract', async () => {
    stubApi({
      'GET /medical-records/MR-99999': () =>
        json({ message: 'Medical record not found', code: 'not_found' }, 404),
    });

    await expect(httpRecordService.getRecord('MR-99999')).rejects.toThrow(RECORD_NOT_FOUND);
  });

  it('surfaces a server failure as an error, never as an empty list', async () => {
    stubApi({ 'GET /medical-records': () => json({ message: 'Internal' }, 500) });

    await expect(httpRecordService.listRecords()).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('createRecord', () => {
  it('sends the encounter, then the note, and returns the full document', async () => {
    const { requests } = stubApi({
      'POST /medical-records': () => json(envelope(SUMMARY), 201),
      'POST /medical-records/MR-10001/notes': () => json(envelope(detail()), 201),
    });

    const created = await httpRecordService.createRecord(completeDraft(), 'Dr. Amelia Chen');

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /medical-records',
      'POST /medical-records/MR-10001/notes',
    ]);
    expect(requests[0]?.body).toEqual({
      patientId: 'PT-1003',
      visitDate: '2026-10-04',
      visitType: 'Consultation',
      department: 'General Medicine',
      chiefComplaint: 'Headache for three days',
      historyOfPresentIllness: 'Gradual onset frontal headache.',
      physicalExamination: 'Alert, no focal deficit.',
      diagnoses: [{ code: 'R51.9', isPrimary: true }],
    });
    expect(requests[1]?.body).toEqual({
      title: 'Assessment',
      body: 'Tension-type headache likely.',
    });
    expect(created.notes[0]?.signed).toBe(false);
  });

  it('names the record when the note fails after it was created', async () => {
    stubApi({
      'POST /medical-records': () => json(envelope(SUMMARY), 201),
      'POST /medical-records/MR-10001/notes': () => json({ message: 'Internal' }, 500),
    });

    await expect(
      httpRecordService.createRecord(completeDraft(), 'Dr. Amelia Chen'),
    ).rejects.toMatchObject({ message: RECORD_NOTE_NOT_SAVED, recordId: 'MR-10001' });
  });

  it('creates nothing on a refusal, and passes the server’s field errors through', async () => {
    const { requests } = stubApi({
      'POST /medical-records': () =>
        json(
          {
            message: 'Validation failed',
            code: 'validation_failed',
            fieldErrors: { physicalExamination: ['Required'] },
          },
          422,
        ),
    });

    await expect(
      httpRecordService.createRecord(completeDraft(), 'Dr. Amelia Chen'),
    ).rejects.toMatchObject({
      kind: 'validation',
      fieldErrors: { physicalExamination: ['Required'] },
    });
    expect(requests).toHaveLength(1);
  });
});

describe('lifecycle writes', () => {
  it('signs through the sign endpoint and returns the server’s record', async () => {
    const { requests } = stubApi({
      [`POST /medical-records/MR-10001/notes/${NOTE.id}/sign`]: () =>
        envelope(detail({ notes: [{ ...NOTE, signed: true }] })),
    });
    const outcome = assessNoteSignability({
      record: toRecord(detail()),
      noteId: NOTE.id,
      signedBy: 'Dr. Amelia Chen',
    });
    if (outcome.signable === null) throw new Error('fixture note is not signable');

    const signed = await httpRecordService.signNote(outcome.signable);

    expect(requests).toHaveLength(1);
    expect(signed.notes[0]?.signed).toBe(true);
  });

  it('reports an already-signed note as the server’s conflict', async () => {
    stubApi({
      [`POST /medical-records/MR-10001/notes/${NOTE.id}/sign`]: () =>
        json(
          {
            message: 'Conflict',
            code: 'note_already_signed',
            detail: 'The note is already signed',
          },
          409,
        ),
    });
    const outcome = assessNoteSignability({
      record: toRecord(detail()),
      noteId: NOTE.id,
      signedBy: 'Dr. Amelia Chen',
    });
    if (outcome.signable === null) throw new Error('fixture note is not signable');

    await expect(httpRecordService.signNote(outcome.signable)).rejects.toMatchObject({
      kind: 'conflict',
      detail: 'The note is already signed',
    });
  });

  it('adds an addendum as a new note', async () => {
    const { requests } = stubApi({
      'POST /medical-records/MR-10001/notes': () => json(envelope(detail()), 201),
    });

    await httpRecordService.amendRecord({
      recordId: 'MR-10001',
      title: ' Addendum ',
      body: 'Correction.',
      author: 'Dr. Amelia Chen',
    });

    expect(requests[0]?.body).toEqual({ title: 'Addendum', body: 'Correction.' });
  });

  it('moves the status through the guarded endpoint, and reports a refusal as given', async () => {
    const { requests } = stubApi({
      'POST /medical-records/MR-10001/status': () =>
        json(
          {
            message: 'Conflict',
            code: 'invalid_status_transition',
            detail: 'Medical record cannot move from draft to archived; allowed: active',
          },
          409,
        ),
    });

    await expect(
      httpRecordService.setStatus({ recordId: 'MR-10001', status: 'archived', actor: 'x' }),
    ).rejects.toMatchObject({
      kind: 'conflict',
      detail: 'Medical record cannot move from draft to archived; allowed: active',
    });
    expect(requests[0]?.body).toEqual({ status: 'archived' });
  });
});

describe('reporting an issue (API §6.9)', () => {
  it('posts the trimmed description and nothing else', async () => {
    const { requests } = stubApi({
      'POST /medical-records/MR-10001/report-issue': () =>
        json(envelope({ id: '0d6f1c2e-6c0b-4c5e-9d55-2f6a8b0c1e11', status: 'open' }), 201),
    });

    await httpRecordService.reportIssue({
      recordId: 'MR-10001',
      description: '  Laterality is wrong — the imaging says right.  ',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.body).toEqual({
      description: 'Laterality is wrong — the imaging says right.',
    });
  });

  it('reads a 404 as a record outside the caller’s scope', async () => {
    stubApi({
      'POST /medical-records/MR-99999/report-issue': () =>
        json({ message: 'Medical record not found' }, 404),
    });

    await expect(
      httpRecordService.reportIssue({ recordId: 'MR-99999', description: 'Wrong patient.' }),
    ).rejects.toThrow(RECORD_NOT_FOUND);
  });

  it('passes the server’s validation refusal through untouched', async () => {
    stubApi({
      'POST /medical-records/MR-10001/report-issue': () =>
        json(
          {
            message: 'Validation failed',
            code: 'validation_failed',
            errors: [{ field: 'description', message: 'Required' }],
          },
          422,
        ),
    });

    await expect(
      httpRecordService.reportIssue({ recordId: 'MR-10001', description: 'x' }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('drafts', () => {
  it('are held for this tab and never sent anywhere', async () => {
    const { requests } = stubApi({});

    const saved = await httpRecordService.saveDraft(completeDraft());
    expect(await httpRecordService.listDrafts()).toEqual([saved]);
    await httpRecordService.discardDraft(saved.id);
    expect(await httpRecordService.listDrafts()).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('says vitals are not attached and records are persisted', () => {
    expect(httpRecordService.capabilities).toEqual({
      attachesVitals: false,
      persistsRecords: true,
    });
  });
});

describe('editing a draft (DEC-004)', () => {
  it('sends only the changed fields, diagnoses as code and primary flag', async () => {
    const { requests } = stubApi({
      'PATCH /medical-records/MR-10001': () => json(envelope(detail())),
    });

    await httpRecordService.updateRecord({
      recordId: 'MR-10001',
      changes: {
        chiefComplaint: '  Headache for four days  ',
        diagnoses: [{ code: 'R51.9', label: 'Headache, unspecified', isPrimary: true }],
      },
      actor: 'ignored by the server',
      reason: '',
    });

    expect(requests[0]?.method).toBe('PATCH');
    // No reason given → none sent: the schema refuses an empty one.
    expect(requests[0]?.body).toEqual({
      chiefComplaint: 'Headache for four days',
      diagnoses: [{ code: 'R51.9', isPrimary: true }],
    });
  });

  it('sends the edit’s reason, trimmed, beside the changed fields (BR-DEC-004)', async () => {
    const { requests } = stubApi({
      'PATCH /medical-records/MR-10001': () => json(envelope(detail())),
    });

    await httpRecordService.updateRecord({
      recordId: 'MR-10001',
      changes: { visitType: 'Follow-up' },
      actor: 'ignored by the server',
      reason: '  Booked under the wrong visit type  ',
    });

    expect(requests[0]?.body).toEqual({
      visitType: 'Follow-up',
      reason: 'Booked under the wrong visit type',
    });
  });

  it('sends the treatment plan trimmed and in order, and the follow-up as a day', async () => {
    const { requests } = stubApi({
      'PATCH /medical-records/MR-10001': () => json(envelope(detail())),
    });

    await httpRecordService.updateRecord({
      recordId: 'MR-10001',
      changes: {
        treatmentPlan: ['  Recheck in 2 weeks ', 'Start lisinopril 10 mg daily'],
        followUpDate: '2026-10-18',
      },
      actor: 'ignored by the server',
      reason: '',
    });

    expect(requests[0]?.body).toEqual({
      treatmentPlan: ['Recheck in 2 weeks', 'Start lisinopril 10 mg daily'],
      followUpDate: '2026-10-18',
    });
  });

  it('clears the follow-up with null, which the schema accepts for that field', async () => {
    const { requests } = stubApi({
      'PATCH /medical-records/MR-10001': () => json(envelope(detail())),
    });

    await httpRecordService.updateRecord({
      recordId: 'MR-10001',
      changes: { followUpDate: null },
      actor: 'ignored by the server',
      reason: '',
    });

    expect(requests[0]?.body).toEqual({ followUpDate: null });
  });

  it('names the server’s refusal of an edit by anyone but the author (BR-DEC-004)', async () => {
    stubApi({
      'PATCH /medical-records/MR-10001': () =>
        json({ message: 'Only the record’s author may edit it', code: 'not_record_author' }, 403),
    });

    await expect(
      httpRecordService.updateRecord({
        recordId: 'MR-10001',
        changes: { visitType: 'X' },
        actor: '',
        reason: '',
      }),
    ).rejects.toThrow(RECORD_NOT_AUTHOR);
  });

  it('names the server’s two refusals of an edit', async () => {
    stubApi({
      'PATCH /medical-records/MR-10001': () =>
        json({ message: 'Conflict', code: 'no_effective_change', detail: 'same' }, 409),
      'PATCH /medical-records/MR-10002': () =>
        json({ message: 'Conflict', code: 'record_not_editable', detail: 'completed' }, 409),
    });

    await expect(
      httpRecordService.updateRecord({ recordId: 'MR-10001', changes: { visitType: 'X' }, actor: '', reason: '' }),
    ).rejects.toThrow(RECORD_NO_CHANGE);
    await expect(
      httpRecordService.updateRecord({ recordId: 'MR-10002', changes: { visitType: 'X' }, actor: '', reason: '' }),
    ).rejects.toThrow(RECORD_NOT_EDITABLE);
  });

  it('reads the version history newest first, with the server’s before/after untouched', async () => {
    stubApi({
      'GET /medical-records/MR-10001/versions': () =>
        json(
          envelope([
            {
              version: 1,
              changedAt: '2026-10-04T17:10:00.000Z',
              actor: 'Dr. Amelia Chen',
              summary: 'Edited chiefComplaint',
              changes: { chiefComplaint: { before: 'Headache', after: 'Headache for four days' } },
            },
            {
              version: 2,
              changedAt: '2026-10-04T17:20:00.000Z',
              actor: 'Dr. Amelia Chen',
              summary: null,
              reason: 'Booked under the wrong visit type',
              changes: { visitType: { before: 'Consultation', after: 'Follow-up' } },
            },
          ]),
        ),
    });

    const versions = await httpRecordService.listVersions('MR-10001');

    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    // BR-DEC-004's reason, where given; a version from before it has none.
    expect(versions.map((version) => version.reason)).toEqual([
      'Booked under the wrong visit type',
      null,
    ]);
    expect(versions[1]?.changes).toEqual({
      chiefComplaint: { before: 'Headache', after: 'Headache for four days' },
    });
  });
});
