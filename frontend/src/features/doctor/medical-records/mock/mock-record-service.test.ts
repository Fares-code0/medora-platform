import { beforeEach, describe, expect, it } from 'vitest';

import type { CompleteRecordDraft } from '../model/authoring';
import { emptyDraft, isDraftComplete, withDiagnosisAdded } from '../model/authoring';
import { NotSignableNoteError, assessNoteSignability, type SignableNote } from '../model/record-lifecycle';
import {
  ILLEGAL_TRANSITION,
  RECORD_EDIT_REASON_MAX,
  RECORD_ISSUE_INVALID,
  RECORD_ISSUE_MAX,
  RECORD_NO_CHANGE,
  RECORD_NOT_EDITABLE,
  RECORD_NOT_FOUND,
  RECORD_PLAN_STEP_MAX,
  RECORD_PLAN_STEPS_MAX,
} from '../model/record-service';

import {
  __mockRecordIssueReports,
  __resetRecordsStore,
  mockRecordService,
} from './mock-record-service';

/**
 * The adapter's own guarantees, independent of any screen: a record is
 * created unsigned, a signature is attributed and refused without the private
 * symbol, an addendum appends rather than replaces, and an illegal status
 * transition is refused at the boundary that owns the data.
 */

const AUTHOR = 'Dr. Amelia Chen';

function completeDraft(): CompleteRecordDraft {
  const draft = {
    ...emptyDraft('draft-1', '2026-08-01T09:00:00.000Z'),
    patient: {
      id: 'PT-1001',
      name: 'Khaled Nassar',
      mrn: 'MRN-1',
      age: 52,
      gender: 'male' as const,
      bloodType: 'O+' as const,
      phone: '01000000000',
    },
    visit: {
      visitDate: '2026-08-01',
      visitType: 'Follow-up',
      department: 'General Medicine',
    },
    chiefComplaint: 'Routine review',
    historyOfPresentIllness: 'Stable since the last visit.',
    physicalExamination: 'No new findings.',
    diagnoses: withDiagnosisAdded([], 'I10'),
    note: { title: 'Consultation note', body: 'Reviewed; plan unchanged.' },
    vitals: {
      bloodPressure: '128/82',
      heartRateBpm: 72,
      temperatureC: 36.8,
      respiratoryRate: 16,
      oxygenSaturation: 98,
      weightKg: 80,
      heightCm: 175,
    },
  };
  if (!isDraftComplete(draft)) throw new Error('fixture is not a complete draft');
  return draft;
}

beforeEach(() => {
  __resetRecordsStore();
});

describe('createRecord', () => {
  it('creates a DRAFT record whose first note is UNSIGNED', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);

    expect(created.status).toBe('draft');
    expect(created.notes).toHaveLength(1);
    expect(created.notes[0]?.signed).toBe(false);
    expect(created.notes[0]?.author).toBe(AUTHOR);
    expect(created.doctor).toBe(AUTHOR);
  });

  it('derives the BMI rather than storing a typed one', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    // 80kg at 1.75m.
    expect(created.vitals?.bmi).toBe(26.1);
  });

  it('records no vitals, rather than zeroes, when none were measured', async () => {
    const created = await mockRecordService.createRecord(
      {
        ...completeDraft(),
        vitals: {
          bloodPressure: '',
          heartRateBpm: null,
          temperatureC: null,
          respiratoryRate: null,
          oxygenSaturation: null,
          weightKg: null,
          heightCm: null,
        },
      },
      AUTHOR,
    );
    expect(created.vitals).toBeNull();
  });

  it('carries the allergies from the roster, not from the form', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    for (const allergy of created.allergies) {
      expect(allergy.allergen.length).toBeGreaterThan(0);
    }
  });

  it('stores the history and examination it was given', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    expect(created.historyOfPresentIllness).toBe('Stable since the last visit.');
    expect(created.physicalExamination).toBe('No new findings.');
  });

  it('leaves the fields the flow does not collect empty rather than inventing them', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    expect(created.treatmentPlan).toEqual([]);
    expect(created.medications).toEqual([]);
  });

  it('says in the timeline that nothing was filed anywhere', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    expect(created.timeline[0]?.detail).toMatch(/no records system is connected/i);
  });

  it('is retrievable afterwards and appears in the list', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    await expect(mockRecordService.getRecord(created.id)).resolves.toEqual(created);
    expect((await mockRecordService.listRecords()).some((r) => r.id === created.id)).toBe(true);
  });

  it('lists one patient’s records when asked', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    const theirs = await mockRecordService.listRecords({ patientId: 'PT-1001' });
    expect(theirs.some((record) => record.id === created.id)).toBe(true);
    expect(theirs.every((record) => record.patient.id === 'PT-1001')).toBe(true);
  });
});

describe('signNote', () => {
  async function created() {
    return mockRecordService.createRecord(completeDraft(), AUTHOR);
  }

  async function signableFor(recordId: string, noteId: string, signer = AUTHOR) {
    const record = await mockRecordService.getRecord(recordId);
    const outcome = assessNoteSignability({ record, noteId, signedBy: signer });
    if (outcome.signable === null) throw new Error(`Not signable: ${outcome.blockedBy}`);
    return outcome.signable;
  }

  it('signs the note and moves the encounter from draft to active', async () => {
    const record = await created();
    const signed = await mockRecordService.signNote(
      await signableFor(record.id, record.notes[0]!.id),
    );

    expect(signed.notes[0]?.signed).toBe(true);
    expect(signed.status).toBe('active');
    expect(signed.timeline.at(-1)?.actor).toBe(AUTHOR);
    expect(signed.timeline.at(-1)?.detail).toMatch(/no records system is connected/i);
  });

  it('does not re-sign — the first signer keeps the attribution', async () => {
    const record = await created();
    const signable = await signableFor(record.id, record.notes[0]!.id);
    const first = await mockRecordService.signNote(signable);
    const second = await mockRecordService.signNote(signable);
    expect(second.timeline).toHaveLength(first.timeline.length);
  });

  it('refuses a forged value at runtime and writes nothing', async () => {
    const record = await created();
    const forged = {
      recordId: record.id,
      noteId: record.notes[0]!.id,
      signedBy: AUTHOR,
    } as unknown as SignableNote;

    await expect(mockRecordService.signNote(forged)).rejects.toThrow(NotSignableNoteError);
    const after = await mockRecordService.getRecord(record.id);
    expect(after.notes[0]?.signed).toBe(false);
    expect(after.status).toBe('draft');
  });
});

describe('amendRecord', () => {
  it('appends an unsigned addendum and leaves every existing note untouched', async () => {
    const record = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    const before = record.notes[0]!;

    const amended = await mockRecordService.amendRecord({
      recordId: record.id,
      title: 'Correction — laterality',
      body: 'Left, not right.',
      author: AUTHOR,
    });

    expect(amended.notes).toHaveLength(2);
    // The original is returned byte-for-byte identical, by construction.
    expect(amended.notes[0]).toEqual(before);
    expect(amended.notes[1]?.signed).toBe(false);
    expect(amended.notes[1]?.title).toBe('Correction — laterality');
  });
});

describe('setStatus', () => {
  it('walks the map forward', async () => {
    const record = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    const signable = assessNoteSignability({
      record,
      noteId: record.notes[0]!.id,
      signedBy: AUTHOR,
    }).signable!;
    const active = await mockRecordService.signNote(signable);
    expect(active.status).toBe('active');

    const completed = await mockRecordService.setStatus({
      recordId: record.id,
      status: 'completed',
      actor: AUTHOR,
    });
    expect(completed.status).toBe('completed');
    expect(completed.timeline.at(-1)?.detail).toMatch(/active to completed/);
  });

  it('refuses an illegal transition at the service, not just in the control', async () => {
    const record = await mockRecordService.createRecord(completeDraft(), AUTHOR);
    await expect(
      mockRecordService.setStatus({ recordId: record.id, status: 'archived', actor: AUTHOR }),
    ).rejects.toThrow(ILLEGAL_TRANSITION);
    await expect(mockRecordService.getRecord(record.id)).resolves.toHaveProperty('status', 'draft');
  });

  it('rejects an unknown record with the error contract the port declares', async () => {
    await expect(
      mockRecordService.setStatus({ recordId: 'MR-nope', status: 'active', actor: AUTHOR }),
    ).rejects.toThrow(RECORD_NOT_FOUND);
  });
});

describe('drafts', () => {
  it('saves, lists and discards', async () => {
    const draft = completeDraft();
    await mockRecordService.saveDraft(draft);
    expect((await mockRecordService.listDrafts()).map((entry) => entry.id)).toEqual([draft.id]);

    await mockRecordService.discardDraft(draft.id);
    expect(await mockRecordService.listDrafts()).toEqual([]);
  });

  it('clears the draft once it becomes a record', async () => {
    const draft = completeDraft();
    await mockRecordService.saveDraft(draft);
    await mockRecordService.createRecord(draft, AUTHOR);
    expect(await mockRecordService.listDrafts()).toEqual([]);
  });
});

describe('reportIssue', () => {
  it('keeps the report and leaves the record exactly as it was', async () => {
    const before = await mockRecordService.getRecord('MR-10001');

    await mockRecordService.reportIssue({ recordId: 'MR-10001', description: '  Wrong side.  ' });

    expect(__mockRecordIssueReports()).toEqual([
      expect.objectContaining({ recordId: 'MR-10001', description: 'Wrong side.' }),
    ]);
    expect(await mockRecordService.getRecord('MR-10001')).toEqual(before);
  });

  it('refuses what the API refuses, and keeps nothing', async () => {
    await expect(
      mockRecordService.reportIssue({ recordId: 'MR-10001', description: '   ' }),
    ).rejects.toThrow(RECORD_ISSUE_INVALID);
    await expect(
      mockRecordService.reportIssue({
        recordId: 'MR-10001',
        description: 'x'.repeat(RECORD_ISSUE_MAX + 1),
      }),
    ).rejects.toThrow(RECORD_ISSUE_INVALID);
    await expect(
      mockRecordService.reportIssue({ recordId: 'MR-00000', description: 'Wrong side.' }),
    ).rejects.toThrow(RECORD_NOT_FOUND);

    expect(__mockRecordIssueReports()).toEqual([]);
  });
});

describe('updateRecord and listVersions — DEC-004', () => {
  it('writes a version row with who, and the before and after of what changed', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);

    await mockRecordService.updateRecord({
      recordId: created.id,
      changes: { chiefComplaint: 'Routine review, plus new cough' },
      actor: AUTHOR,
      reason: ' Patient added a symptom at check-out ',
    });

    const [latest] = await mockRecordService.listVersions(created.id);
    expect(latest).toMatchObject({
      version: 1,
      actor: AUTHOR,
      reason: 'Patient added a symptom at check-out',
      changes: {
        chiefComplaint: { before: 'Routine review', after: 'Routine review, plus new cough' },
      },
    });
    expect((await mockRecordService.getRecord(created.id)).chiefComplaint).toBe(
      'Routine review, plus new cough',
    );
  });

  it('refuses an edit that changes nothing, and writes no version for it', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);

    await expect(
      mockRecordService.updateRecord({
        recordId: created.id,
        changes: { chiefComplaint: created.chiefComplaint },
        actor: AUTHOR,
        reason: '',
      }),
    ).rejects.toThrow(RECORD_NO_CHANGE);
    expect(await mockRecordService.listVersions(created.id)).toEqual([]);
  });

  it('refuses a completed record, as the server does', async () => {
    const all = await mockRecordService.listRecords();
    const completed = all.find((record) => record.status === 'completed');
    if (completed === undefined) throw new Error('no seeded completed record');

    await expect(
      mockRecordService.updateRecord({
        recordId: completed.id,
        changes: { visitType: 'Follow-up' },
        actor: AUTHOR,
        reason: '',
      }),
    ).rejects.toThrow(RECORD_NOT_EDITABLE);
  });

  it('keeps no reason when none is given, and refuses one over the server’s ceiling', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);

    await mockRecordService.updateRecord({
      recordId: created.id,
      changes: { chiefComplaint: 'Routine review, plus new cough' },
      actor: AUTHOR,
      reason: '   ',
    });
    const [latest] = await mockRecordService.listVersions(created.id);
    expect(latest?.reason).toBeNull();

    await expect(
      mockRecordService.updateRecord({
        recordId: created.id,
        changes: { chiefComplaint: 'Changed again' },
        actor: AUTHOR,
        reason: 'x'.repeat(RECORD_EDIT_REASON_MAX + 1),
      }),
    ).rejects.toMatchObject({ kind: 'validation' });
    expect(await mockRecordService.listVersions(created.id)).toHaveLength(1);
  });

  it('replaces the treatment plan and sets, then clears, the follow-up as days', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);

    await mockRecordService.updateRecord({
      recordId: created.id,
      changes: {
        treatmentPlan: [' Start lisinopril 10 mg daily ', 'Recheck in 2 weeks'],
        followUpDate: '2026-08-15',
      },
      actor: AUTHOR,
      reason: '',
    });
    const planned = await mockRecordService.getRecord(created.id);
    expect(planned.treatmentPlan).toEqual(['Start lisinopril 10 mg daily', 'Recheck in 2 weeks']);
    // Local midnight, as the HTTP adapter reads a day — the 15th everywhere.
    expect(planned.followUpDate).toBe('2026-08-15T00:00:00');

    await mockRecordService.updateRecord({
      recordId: created.id,
      changes: { followUpDate: null },
      actor: AUTHOR,
      reason: '',
    });
    expect((await mockRecordService.getRecord(created.id)).followUpDate).toBeNull();

    const [cleared, first] = await mockRecordService.listVersions(created.id);
    expect(first?.changes).toEqual({
      treatmentPlan: { before: [], after: ['Start lisinopril 10 mg daily', 'Recheck in 2 weeks'] },
      followUpDate: { before: null, after: '2026-08-15' },
    });
    expect(cleared?.changes).toEqual({ followUpDate: { before: '2026-08-15', after: null } });
  });

  it('refuses a plan the server would refuse, and writes nothing', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);

    for (const treatmentPlan of [
      ['   '],
      ['x'.repeat(RECORD_PLAN_STEP_MAX + 1)],
      Array.from({ length: RECORD_PLAN_STEPS_MAX + 1 }, () => 'Step'),
    ]) {
      await expect(
        mockRecordService.updateRecord({
          recordId: created.id,
          changes: { treatmentPlan },
          actor: AUTHOR,
          reason: '',
        }),
      ).rejects.toMatchObject({ kind: 'validation' });
    }
    expect(await mockRecordService.listVersions(created.id)).toEqual([]);
    expect((await mockRecordService.getRecord(created.id)).treatmentPlan).toEqual([]);
  });

  it('treats a re-sent visit day as no change, and stores a new one as that day', async () => {
    const created = await mockRecordService.createRecord(completeDraft(), AUTHOR);

    await expect(
      mockRecordService.updateRecord({
        recordId: created.id,
        changes: { visitDate: '2026-08-01' },
        actor: AUTHOR,
        reason: '',
      }),
    ).rejects.toThrow(RECORD_NO_CHANGE);

    await mockRecordService.updateRecord({
      recordId: created.id,
      changes: { visitDate: '2026-08-02' },
      actor: AUTHOR,
      reason: '',
    });
    expect((await mockRecordService.getRecord(created.id)).visitDate).toBe('2026-08-02T00:00:00');
  });
});
