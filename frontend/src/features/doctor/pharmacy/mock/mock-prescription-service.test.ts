import { beforeEach, describe, expect, it } from 'vitest';

import { completeDraft, emptyDraft, type PrescriptionDraft } from '../model/authoring';
import { MEDICATION_CATALOGUE } from '../model/catalogue';
import {
  CURRENT_PRESCRIPTION_STATUSES,
  PRESCRIPTION_NOT_DRAFT,
  PRESCRIPTION_NOT_FOUND,
} from '../model/prescription-service';
import {
  NotSignableError,
  assessSignability,
  screenPrescription,
  subjectFromDraft,
  subjectKey,
  type SignablePrescription,
} from '../model/safety-check';
import type { PrescriptionPatientSnapshot, PrescriptionStatus } from '../model/types';

import {
  __putMockPrescription,
  __resetPharmacyStore,
  mockPrescriptionService,
} from './mock-prescription-service';

/**
 * The lifecycle actions D-19 asks for — renew, cancel with a reason, save as
 * draft, sign & send — against the adapter that performs them.
 */

const PATIENT: PrescriptionPatientSnapshot = {
  id: 'PT-1001',
  name: 'Khaled Nassar',
  mrn: '4411-27',
  age: 52,
  gender: 'male',
  bloodType: 'O+',
  phone: '+20 100 214 3387',
  allergies: [],
  hasSevereAllergy: false,
};

function draft(): PrescriptionDraft {
  return {
    ...emptyDraft('draft-test-1', '2026-08-30T09:00:00.000Z'),
    patient: PATIENT,
    medication: { genericName: 'Metformin', strength: '500 mg' },
    dosage: {
      frequency: 'Twice daily',
      durationDays: 30,
      quantity: 60,
      refillsAllowed: 2,
      instructions: 'Take 500 mg twice daily by mouth.',
    },
  };
}

function signableFor(source = draft()): SignablePrescription {
  const complete = completeDraft(source, MEDICATION_CATALOGUE);
  if (complete === null) throw new Error('fixture is not a complete draft');
  const subject = subjectFromDraft(complete, []);
  const warnings = screenPrescription(subject);
  const { signable } = assessSignability({
    draft: complete,
    subject,
    verdict: {
      status: 'completed',
      id: 'chk-test',
      subjectKey: subjectKey(subject),
      checkedAt: '2026-08-30T09:00:00.000Z',
      source: 'demo-formulary',
      warnings,
    },
    acknowledgment: null,
  });
  if (signable === null) throw new Error('fixture should be signable');
  return signable;
}

beforeEach(() => {
  __resetPharmacyStore();
});

describe('drafts (save as draft)', () => {
  it('saves a draft and lists it back', async () => {
    expect(await mockPrescriptionService.listDrafts()).toHaveLength(0);

    const saved = await mockPrescriptionService.saveDraft(draft());
    expect(saved.id).toBe('draft-test-1');

    const drafts = await mockPrescriptionService.listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.medication).toEqual({ genericName: 'Metformin', strength: '500 mg' });
  });

  it('stamps updatedAt so a resumed draft is the latest edit', async () => {
    const saved = await mockPrescriptionService.saveDraft(draft());
    expect(saved.updatedAt).not.toBe('2026-08-30T09:00:00.000Z');
  });

  it('overwrites rather than duplicating on a second save', async () => {
    await mockPrescriptionService.saveDraft(draft());
    await mockPrescriptionService.saveDraft({
      ...draft(),
      dosage: { ...draft().dosage, quantity: 90 },
    });

    const drafts = await mockPrescriptionService.listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.dosage.quantity).toBe(90);
  });

  it('discards a draft', async () => {
    await mockPrescriptionService.saveDraft(draft());
    await mockPrescriptionService.discardDraft('draft-test-1');
    expect(await mockPrescriptionService.listDrafts()).toHaveLength(0);
  });
});

describe('sign & send', () => {
  it('issues an active prescription and puts it in the list', async () => {
    const before = await mockPrescriptionService.listPrescriptions();
    const signed = await mockPrescriptionService.sign(signableFor());

    expect(signed.status).toBe('active');
    expect(signed.medication.genericName).toBe('Metformin');
    expect(signed.quantity).toBe(60);
    expect(signed.refillsRemaining).toBe(2);

    const after = await mockPrescriptionService.listPrescriptions();
    expect(after).toHaveLength(before.length + 1);
    expect(after.some((prescription) => prescription.id === signed.id)).toBe(true);
  });

  it('claims no transmission it did not perform', async () => {
    const signed = await mockPrescriptionService.sign(signableFor());
    const prescribed = signed.timeline.find((event) => event.kind === 'prescribed');

    expect(prescribed?.detail).toContain('not transmitted');
    expect(prescribed?.detail).not.toMatch(/sent to the pharmacy/i);
  });

  it('clears the draft it was signed from', async () => {
    await mockPrescriptionService.saveDraft(draft());
    await mockPrescriptionService.sign(signableFor());
    expect(await mockPrescriptionService.listDrafts()).toHaveLength(0);
  });

  it('refuses a forged signable at runtime, not only at compile time', async () => {
    const forged = {
      draft: completeDraft(draft(), MEDICATION_CATALOGUE),
      verdict: null,
    } as unknown as SignablePrescription;
    await expect(mockPrescriptionService.sign(forged)).rejects.toThrow(NotSignableError);
  });
});

describe('renew', () => {
  it('opens a draft pre-filled from the source prescription', async () => {
    const [source] = await mockPrescriptionService.listPrescriptions();
    if (!source) throw new Error('seed dataset is empty');

    const renewal = await mockPrescriptionService.renew(source.id);

    expect(renewal.origin).toBe('renewal');
    expect(renewal.renewedFrom).toBe(source.id);
    expect(renewal.patient?.id).toBe(source.patient.id);
    expect(renewal.medication?.genericName).toBe(source.medication.genericName);
    expect(renewal.dosage.durationDays).toBe(source.durationDays);
  });

  it('lands the renewal in the draft list so the flow can resume it', async () => {
    const [source] = await mockPrescriptionService.listPrescriptions();
    if (!source) throw new Error('seed dataset is empty');

    const renewal = await mockPrescriptionService.renew(source.id);
    const drafts = await mockPrescriptionService.listDrafts();
    expect(drafts.map((entry) => entry.id)).toContain(renewal.id);
  });

  it('does not itself issue anything — a renewal is re-screened before signing', async () => {
    const before = await mockPrescriptionService.listPrescriptions();
    const [source] = before;
    if (!source) throw new Error('seed dataset is empty');

    await mockPrescriptionService.renew(source.id);
    expect(await mockPrescriptionService.listPrescriptions()).toHaveLength(before.length);
  });

  it('rejects an unknown prescription', async () => {
    await expect(mockPrescriptionService.renew('RX-000000')).rejects.toThrow(
      'PRESCRIPTION_NOT_FOUND',
    );
  });
});

describe('notes', () => {
  it('appends a note under its author and keeps it for subsequent reads', async () => {
    const [first] = await mockPrescriptionService.listPrescriptions();
    if (!first) throw new Error('seed dataset is empty');
    const before = (await mockPrescriptionService.getPrescription(first.id)).notes.length;

    const updated = await mockPrescriptionService.addNote({
      prescriptionId: first.id,
      body: '  Patient reports better sleep.  ',
      author: 'Dr. Amelia Chen',
    });

    expect(updated.notes).toHaveLength(before + 1);
    expect(updated.notes.at(-1)).toMatchObject({
      author: 'Dr. Amelia Chen',
      body: 'Patient reports better sleep.',
    });
    expect((await mockPrescriptionService.getPrescription(first.id)).notes).toHaveLength(
      before + 1,
    );
  });

  it('refuses an empty note, as the API does', async () => {
    const [first] = await mockPrescriptionService.listPrescriptions();
    if (!first) throw new Error('seed dataset is empty');
    await expect(
      mockPrescriptionService.addNote({ prescriptionId: first.id, body: '   ', author: 'Dr. A' }),
    ).rejects.toThrow(/1 to 4,000/);
  });
});

/**
 * A prescription in the given status: a seeded one where the demo has it, or
 * an active one placed back in the store in that status where it cannot
 * reach it on its own (`pending-approval`, `draft`).
 */
async function seeded(status: PrescriptionStatus) {
  const all = await mockPrescriptionService.listPrescriptions();
  const found = all.find((prescription) => prescription.status === status);
  if (found) return found;
  const active = all.find((prescription) => prescription.status === 'active');
  if (!active) throw new Error('seed dataset has no active prescription');
  const placed = { ...(await mockPrescriptionService.getPrescription(active.id)), status };
  __putMockPrescription(placed);
  return placed;
}

const END = { details: '', actor: 'Dr. Amelia Chen' } as const;

describe('ending a prescription (DEC-002)', () => {
  it('discontinues an active therapy and records the act and the reason on its timeline', async () => {
    const active = await seeded('active');

    const ended = await mockPrescriptionService.discontinue({
      prescriptionId: active.id,
      reason: 'Adverse reaction',
      details: 'Persistent nausea.',
      actor: 'Dr. Amelia Chen',
    });

    expect(ended.status).toBe('discontinued');
    expect(ended.refillStatus).toBe('none');
    expect(ended.refillsRemaining).toBe(0);

    const event = ended.timeline.at(-1);
    expect(event?.kind).toBe('discontinued');
    expect(event?.actor).toBe('Dr. Amelia Chen');
    // The server's own wording: `${act}: ${reason}` (prescription.repository.ts).
    expect(event?.detail).toBe('discontinue: Adverse reaction — Persistent nausea.');
  });

  it('cancels one awaiting approval, recorded as a cancellation', async () => {
    const pending = await seeded('pending-approval');

    const ended = await mockPrescriptionService.cancel({
      prescriptionId: pending.id,
      reason: 'Prescribed in error',
      ...END,
    });

    expect(ended.status).toBe('discontinued');
    expect(ended.timeline.at(-1)?.detail).toBe('cancel: Prescribed in error');
  });

  it('records the reason alone when no details were given', async () => {
    const active = await seeded('active');
    const ended = await mockPrescriptionService.discontinue({
      prescriptionId: active.id,
      reason: 'Patient request',
      details: '   ',
      actor: 'Dr. Amelia Chen',
    });
    expect(ended.timeline.at(-1)?.detail).toBe('discontinue: Patient request');
  });

  it('persists the change for subsequent reads', async () => {
    const active = await seeded('active');
    await mockPrescriptionService.discontinue({
      prescriptionId: active.id,
      reason: 'Prescribed in error',
      ...END,
    });
    expect((await mockPrescriptionService.getPrescription(active.id)).status).toBe('discontinued');
  });

  it.each(['cancel', 'discontinue'] as const)(
    'refuses to %s an unsigned draft, as the server does, and changes nothing',
    async (act) => {
      const draftRx = await seeded('draft');
      await expect(
        mockPrescriptionService[act]({
          prescriptionId: draftRx.id,
          reason: 'Patient request',
          ...END,
        }),
      ).rejects.toMatchObject({ kind: 'conflict', code: 'draft_not_discontinuable' });
      expect((await mockPrescriptionService.getPrescription(draftRx.id)).status).toBe('draft');
    },
  );

  it('refuses one that has already ended', async () => {
    const expired = await seeded('expired');
    await expect(
      mockPrescriptionService.discontinue({
        prescriptionId: expired.id,
        reason: 'Patient request',
        ...END,
      }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'invalid_status_transition' });
  });

  it('rejects an unknown prescription', async () => {
    await expect(
      mockPrescriptionService.cancel({
        prescriptionId: 'RX-000000',
        reason: 'Patient request',
        ...END,
      }),
    ).rejects.toThrow('PRESCRIPTION_NOT_FOUND');
  });
});

describe('the safety check the adapter exposes', () => {
  it('screens against the demo formulary and labels every finding as such', async () => {
    const complete = completeDraft(
      {
        ...draft(),
        patient: { ...PATIENT, allergies: ['Penicillin'], hasSevereAllergy: true },
        medication: { genericName: 'Amoxicillin', strength: '500 mg' },
        dosage: { ...draft().dosage, frequency: 'Twice daily', durationDays: 7 },
      },
      MEDICATION_CATALOGUE,
    );
    if (complete === null) throw new Error('fixture is not complete');

    const result = await mockPrescriptionService.checkSafety(
      subjectFromDraft(complete, []),
      new AbortController().signal,
    );

    expect(Array.isArray(result)).toBe(true);
    const warnings = result as ReturnType<typeof screenPrescription>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe('allergy');
    expect(warnings[0]?.source).toBe('demo-formulary');
  });
});

describe('listCurrentMedications', () => {
  it('is exactly the running courses the demo safety engine screens, for that patient only', async () => {
    const all = await mockPrescriptionService.listPrescriptions();
    const patientId = all[0]?.patient.id ?? '';
    const expected = all
      .filter(
        (prescription) =>
          prescription.patient.id === patientId &&
          CURRENT_PRESCRIPTION_STATUSES.has(prescription.status),
      )
      .map((prescription) => prescription.id);

    const current = await mockPrescriptionService.listCurrentMedications(patientId);

    expect(current.map((medication) => medication.id)).toEqual(expected);
    expect(current.every((medication) => medication.prescriptionId === medication.id)).toBe(true);
  });

  it('answers an empty list for a patient with nothing running', async () => {
    expect(await mockPrescriptionService.listCurrentMedications('PT-NOBODY')).toEqual([]);
  });
});

describe('discarding an unsigned draft (BR-DEC-002)', () => {
  it('removes the draft from every list and read, as the server does', async () => {
    const draft = await seeded('draft');

    await mockPrescriptionService.discardPrescriptionDraft(draft.id);

    const all = await mockPrescriptionService.listPrescriptions();
    expect(all.map((prescription) => prescription.id)).not.toContain(draft.id);
    await expect(mockPrescriptionService.getPrescription(draft.id)).rejects.toThrow(
      PRESCRIPTION_NOT_FOUND,
    );
    await expect(mockPrescriptionService.discardPrescriptionDraft(draft.id)).rejects.toThrow(
      PRESCRIPTION_NOT_FOUND,
    );
  });

  it.each(['pending-approval', 'active', 'dispensed'] as const)(
    'refuses a %s prescription and leaves it unchanged',
    async (status) => {
      const signed = await seeded(status);

      await expect(mockPrescriptionService.discardPrescriptionDraft(signed.id)).rejects.toThrow(
        PRESCRIPTION_NOT_DRAFT,
      );
      expect((await mockPrescriptionService.getPrescription(signed.id)).status).toBe(status);
    },
  );
});
