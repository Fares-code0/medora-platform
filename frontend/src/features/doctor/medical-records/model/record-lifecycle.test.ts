import { describe, expect, it } from 'vitest';

import {
  NOTE_SIGN_BLOCKED_META,
  NotSignableNoteError,
  RECORD_STATUS_TRANSITIONS,
  allowedTransitions,
  assertSignableNote,
  assessNoteSignability,
  canAmend,
  canTransition,
  hasSignedNote,
  unsignedNotes,
  type SignableNote,
  canEditRecord,
} from './record-lifecycle';
import type { MedicalRecord, MedicalRecordStatus, RecordClinicalNote } from './types';

/**
 * The lifecycle rules the Phase-6 module declared and never enforced.
 *
 * The load-bearing assertions are negatives, and they assert the *absence of
 * a value* rather than a disabled control: `assessNoteSignability` is the only
 * producer of `SignableNote`, so a note that must not be signed simply cannot
 * be handed to the service.
 */

const AUTHOR = 'Dr. Amelia Chen';

function note(overrides: Partial<RecordClinicalNote> = {}): RecordClinicalNote {
  return {
    id: 'MR-1-note-1',
    author: AUTHOR,
    authoredAt: '2026-08-01T10:00:00.000Z',
    title: 'Consultation note',
    body: 'Patient reviewed; plan unchanged.',
    signed: false,
    ...overrides,
  };
}

function record(overrides: Partial<MedicalRecord> = {}): MedicalRecord {
  return {
    id: 'MR-1',
    patient: {
      id: 'PT-1001',
      name: 'Khaled Nassar',
      mrn: 'MRN-1',
      age: 52,
      gender: 'male',
      bloodType: 'O+',
      phone: '01000000000',
    },
    visitDate: '2026-08-01T09:00:00.000Z',
    visitType: 'Follow-up',
    department: 'General Medicine',
    doctor: AUTHOR,
    status: 'draft',
    priority: 'normal',
    diagnoses: [{ code: 'I10', label: 'Essential hypertension', isPrimary: true }],
    chiefComplaint: 'Routine review',
    historyOfPresentIllness: '',
    physicalExamination: '',
    vitals: {
      recordedAt: '2026-08-01T09:10:00.000Z',
      bloodPressure: '128/82',
      heartRateBpm: 72,
      temperatureC: 36.8,
      respiratoryRate: 16,
      oxygenSaturation: 98,
      weightKg: 80,
      heightCm: 175,
      bmi: 26.1,
    },
    treatmentPlan: [],
    medications: [],
    allergies: [],
    notes: [note()],
    attachments: [],
    timeline: [],
    followUpDate: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('status transitions', () => {
  it('moves forward only, and never back to draft', () => {
    expect(canTransition('draft', 'active')).toBe(true);
    expect(canTransition('active', 'completed')).toBe(true);
    expect(canTransition('completed', 'archived')).toBe(true);

    expect(canTransition('active', 'draft')).toBe(false);
    expect(canTransition('completed', 'active')).toBe(false);
    expect(canTransition('draft', 'completed')).toBe(false);
  });

  it('leaves archived terminal', () => {
    expect(RECORD_STATUS_TRANSITIONS.archived).toEqual([]);
    const statuses: readonly MedicalRecordStatus[] = ['draft', 'active', 'completed', 'archived'];
    for (const status of statuses) {
      expect(canTransition('archived', status)).toBe(false);
    }
  });

  it('offers no transition out of a draft whose every note is unsigned', () => {
    // "Active encounter" would otherwise describe a record on which nothing
    // has been attested — which is what `draft` already says.
    expect(allowedTransitions(record())).toEqual([]);
    expect(allowedTransitions(record({ notes: [note({ signed: true })] }))).toEqual(['active']);
  });
});

describe('notes', () => {
  it('reports signed state and lists what is still outstanding', () => {
    const mixed = record({
      notes: [note({ id: 'a', signed: true }), note({ id: 'b', signed: false })],
    });
    expect(hasSignedNote(mixed)).toBe(true);
    expect(unsignedNotes(mixed).map((entry) => entry.id)).toEqual(['b']);
  });

  it('accepts an addendum only once something is signed, and never when archived', () => {
    expect(canAmend(record())).toBe(false);
    expect(canAmend(record({ notes: [note({ signed: true })] }))).toBe(true);
    expect(canAmend(record({ status: 'archived', notes: [note({ signed: true })] }))).toBe(false);
  });

  it('accepts a first note on a record created without one, unless archived', () => {
    expect(canAmend(record({ notes: [] }))).toBe(true);
    expect(canAmend(record({ status: 'archived', notes: [] }))).toBe(false);
  });
});

describe('assessNoteSignability — the fail-closed gate', () => {
  it('produces a signable value for an unsigned note of the signer’s own', () => {
    const outcome = assessNoteSignability({
      record: record(),
      noteId: 'MR-1-note-1',
      signedBy: AUTHOR,
    });
    expect(outcome.blockedBy).toBeNull();
    expect(outcome.signable).not.toBeNull();
  });

  it('produces NOTHING for a note that is already signed', () => {
    const outcome = assessNoteSignability({
      record: record({ notes: [note({ signed: true })] }),
      noteId: 'MR-1-note-1',
      signedBy: AUTHOR,
    });
    expect(outcome.signable).toBeNull();
    expect(outcome.blockedBy).toBe('already-signed');
  });

  it('refuses an empty note — a signature attests to content', () => {
    const outcome = assessNoteSignability({
      record: record({ notes: [note({ body: '   ' })] }),
      noteId: 'MR-1-note-1',
      signedBy: AUTHOR,
    });
    expect(outcome.signable).toBeNull();
    expect(outcome.blockedBy).toBe('empty-body');
  });

  it('refuses to let one clinician sign another’s note', () => {
    const outcome = assessNoteSignability({
      record: record(),
      noteId: 'MR-1-note-1',
      signedBy: 'Dr. Hassan Fouad',
    });
    expect(outcome.signable).toBeNull();
    expect(outcome.blockedBy).toBe('not-the-author');
  });

  it('refuses an unknown note, an archived record, and an unnamed signer', () => {
    expect(
      assessNoteSignability({ record: record(), noteId: 'nope', signedBy: AUTHOR }).blockedBy,
    ).toBe('not-found');
    expect(
      assessNoteSignability({
        record: record({ status: 'archived' }),
        noteId: 'MR-1-note-1',
        signedBy: AUTHOR,
      }).blockedBy,
    ).toBe('record-archived');
    expect(
      assessNoteSignability({ record: record(), noteId: 'MR-1-note-1', signedBy: '  ' }).blockedBy,
    ).toBe('no-signer');
  });

  it('names every blocked reason in words', () => {
    for (const message of Object.values(NOTE_SIGN_BLOCKED_META)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('assertSignableNote — the runtime half', () => {
  it('refuses a hand-built object that satisfies the type by cast', () => {
    const forged = {
      recordId: 'MR-1',
      noteId: 'MR-1-note-1',
      signedBy: AUTHOR,
    } as unknown as SignableNote;
    expect(() => {
      assertSignableNote(forged);
    }).toThrow(NotSignableNoteError);
  });

  it('accepts the value its own producer made', () => {
    const outcome = assessNoteSignability({
      record: record(),
      noteId: 'MR-1-note-1',
      signedBy: AUTHOR,
    });
    expect(() => {
      assertSignableNote(outcome.signable!);
    }).not.toThrow();
  });
});

describe('canEditRecord — DEC-004', () => {
  it('allows editing only a draft with nothing signed', () => {
    expect(canEditRecord(record({ status: 'draft', notes: [note({ signed: false })] }))).toBe(true);
    expect(canEditRecord(record({ status: 'draft', notes: [] }))).toBe(true);
  });

  it('refuses once anything is signed, and in every later status', () => {
    expect(canEditRecord(record({ status: 'draft', notes: [note({ signed: true })] }))).toBe(false);
    for (const status of ['active', 'completed', 'archived'] as const) {
      expect(canEditRecord(record({ status, notes: [note({ signed: false })] }))).toBe(false);
    }
  });
});
