import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { completeDraft, emptyDraft, type PrescriptionDraft } from '../model/authoring';
import type { Formulary } from '../model/catalogue';
import { PRESCRIPTION_NOT_DRAFT, PRESCRIPTION_NOT_FOUND } from '../model/prescription-service';
import {
  assessSignability,
  runSafetyCheck,
  subjectFromDraft,
  type SafetyAcknowledgment,
  type SignablePrescription,
} from '../model/safety-check';

import {
  __resetHttpPharmacyState,
  httpPrescriptionService,
  toMedicationSpec,
  toPrescription,
  toSafetyWarnings,
} from './http-prescription-service';

/**
 * Prescribing over HTTP (FE-10.6), against bodies captured from API §7 on a
 * seeded database: `GET /medications`, `POST /prescriptions`, `…/sign` and
 * `POST /prescriptions/safety-check` (Warfarin for a patient on Lipitor).
 */

beforeEach(() => {
  __resetHttpPharmacyState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const LIPITOR_ID = '3ca58a3e-f95f-4d9b-aa1a-2b240ad06aaf';

const LIPITOR = {
  id: LIPITOR_ID,
  name: 'Lipitor',
  genericName: 'Atorvastatin',
  category: 'Lipid-lowering',
  strengths: ['10 mg', '20 mg', '40 mg', '80 mg'],
  form: 'Tablet',
  route: 'Oral',
  manufacturer: 'Pfizer',
  isControlled: false,
  isHighRisk: false,
  interactionNote: 'Myopathy risk with macrolides and fibrates.',
  allergyClass: null,
  frequencies: ['Once daily at night'],
  durationsDays: [30, 60, 90],
};

function prescriptionView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'RX-200000',
    patient: {
      id: 'PT-1004',
      name: 'Omar Farouk',
      mrn: '4472-90',
      age: 60,
      gender: 'male',
      // As the projection serves it today — the Prisma member, not `AB+`.
      bloodType: 'AB_POSITIVE',
      phone: '+20 101 662 7408',
      allergies: ['Iodine contrast'],
      hasSevereAllergy: true,
    },
    medication: {
      id: LIPITOR_ID,
      name: 'Lipitor',
      genericName: 'Atorvastatin',
      category: 'Lipid-lowering',
      strength: '20 mg',
      form: 'Tablet',
      route: 'Oral',
      manufacturer: 'Pfizer',
      isControlled: false,
      isHighRisk: false,
      interactionNote: 'Myopathy risk with macrolides and fibrates.',
      allergyClass: null,
    },
    dosage: '20 mg',
    frequency: 'Once daily at night',
    route: 'Oral',
    duration: '30 days',
    durationDays: 30,
    quantity: 30,
    instructions: 'Take one tablet at night.',
    prescribingDoctor: 'Dr. Amelia Chen',
    department: 'Internal Medicine',
    status: 'draft',
    startDate: '2026-10-04',
    endDate: '2026-11-03',
    refillsAllowed: 0,
    refillsRemaining: 0,
    refillStatus: 'none',
    warnings: [],
    createdAt: '2026-10-04T17:42:08.092Z',
    updatedAt: '2026-10-04T17:42:08.092Z',
    signedAt: null,
    discontinuedReason: null,
    recordId: null,
    notes: [],
    history: [],
    timeline: [],
    ...overrides,
  };
}

const INTERACTION = {
  id: `safety-interaction-${LIPITOR_ID}`,
  kind: 'interaction',
  severity: 'warning',
  title: 'Atorvastatin × Warfarin',
  detail: 'Reported INR elevation on co-administration.',
  against: ['Lipitor (Atorvastatin)'],
  blocking: false,
};

async function formulary(): Promise<Formulary> {
  stubApi({ 'GET /medications': () => pageOf([LIPITOR]) });
  return httpPrescriptionService.listMedications();
}

function draftFor(overrides: Partial<PrescriptionDraft> = {}): PrescriptionDraft {
  return {
    ...emptyDraft('draft-1', '2026-10-04T09:00:00.000Z'),
    patient: {
      id: 'PT-1004',
      name: 'Omar Farouk',
      mrn: '4472-90',
      age: 60,
      gender: 'male',
      bloodType: 'AB+',
      phone: '+20 101 662 7408',
      allergies: ['Iodine contrast'],
      hasSevereAllergy: true,
    },
    medication: { genericName: 'Atorvastatin', strength: '20 mg' },
    dosage: {
      frequency: 'Once daily at night',
      durationDays: 30,
      quantity: 30,
      refillsAllowed: 0,
      instructions: 'Take one tablet at night.',
    },
    ...overrides,
  };
}

/** A signable value, produced the only way one can be: a completed verdict. */
async function signableFor(
  spec: Formulary,
  draft: PrescriptionDraft,
  warnings: readonly unknown[] = [],
  acknowledge?: (verdictId: string) => SafetyAcknowledgment,
): Promise<SignablePrescription> {
  const complete = completeDraft(draft, spec);
  if (complete === null) throw new Error('fixture draft is not complete');
  const subject = subjectFromDraft(complete, []);
  const verdict = await runSafetyCheck(subject, {
    run: () => Promise.resolve(toSafetyWarnings(envelope({ warnings }))),
    source: 'clinical-service',
  });
  const result = assessSignability({
    draft: complete,
    verdict,
    subject,
    acknowledgment: acknowledge === undefined ? null : acknowledge(verdict.id),
  });
  if (result.signable === null) throw new Error(`fixture is not signable: ${result.blockedBy}`);
  return result.signable;
}

describe('reads', () => {
  it('reads the formulary with the server’s ids', async () => {
    const spec = await formulary();
    expect(spec[0]).toMatchObject({ id: LIPITOR_ID, genericName: 'Atorvastatin' });
  });

  it('maps the detail view, reading days as local days and the Prisma blood type', () => {
    const prescription = toPrescription(prescriptionView());
    expect(prescription).toMatchObject({
      id: 'RX-200000',
      status: 'draft',
      startDate: '2026-10-04T00:00:00',
      patient: { bloodType: 'AB+' },
      medication: { genericName: 'Atorvastatin', strength: '20 mg' },
    });
  });

  it('still refuses a blood type in neither spelling', () => {
    let thrown: unknown = null;
    try {
      toPrescription(
        prescriptionView({ patient: { ...prescriptionView().patient, bloodType: 'Z+' } }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'malformed_response' });
  });

  it('turns a 404 into the port’s not-found contract', async () => {
    stubApi({
      'GET /prescriptions/RX-1': () =>
        json({ message: 'Prescription not found', code: 'not_found' }, 404),
    });
    await expect(httpPrescriptionService.getPrescription('RX-1')).rejects.toThrow(
      PRESCRIPTION_NOT_FOUND,
    );
  });

  it('surfaces a failed list as an error, never as no prescriptions', async () => {
    stubApi({ 'GET /prescriptions': () => json({ message: 'Internal' }, 500) });
    await expect(httpPrescriptionService.listPrescriptions()).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

/**
 * The prescribing strip's "current medications". `GET /prescriptions` is the
 * caller's own list (API §7.3), so it would show nothing another clinician
 * prescribed; the patient's medication tab holds every source.
 */
describe('listCurrentMedications', () => {
  const entry = (overrides: Record<string, unknown>) => ({
    id: 'med-1',
    name: 'Warfarin',
    dosage: '5 mg',
    frequency: 'Once daily',
    status: 'active',
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: null,
    prescriptionId: 'RX-20419',
    ...overrides,
  });

  it('reads the patient’s medication tab, not the prescriber’s list, and keeps only active entries', async () => {
    const { requests } = stubApi({
      'GET /patients/PT-1001/medications': () =>
        json(
          pageOf([
            entry({}),
            entry({ id: 'med-2', name: 'Vitamin D', prescriptionId: null }),
            entry({ id: 'med-3', name: 'Amoxicillin', status: 'completed' }),
            entry({ id: 'med-4', name: 'Atenolol', status: 'discontinued' }),
          ]),
        ),
    });

    const medications = await httpPrescriptionService.listCurrentMedications('PT-1001');

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /patients/PT-1001/medications',
    ]);
    expect(medications).toEqual([
      {
        id: 'med-1',
        name: 'Warfarin',
        dosage: '5 mg',
        frequency: 'Once daily',
        prescriptionId: 'RX-20419',
        isHighRisk: null,
      },
      {
        id: 'med-2',
        name: 'Vitamin D',
        dosage: '5 mg',
        frequency: 'Once daily',
        prescriptionId: null,
        isHighRisk: null,
      },
    ]);
  });

  it('surfaces a failed read as an error, never as nothing on record', async () => {
    stubApi({ 'GET /patients/PT-1001/medications': () => json({ message: 'Internal' }, 500) });
    await expect(httpPrescriptionService.listCurrentMedications('PT-1001')).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('checkSafety — the server’s screen, not a second one', () => {
  it('posts the patient and the medication, and returns the server’s warnings as the clinical service’s', async () => {
    const spec = await formulary();
    const complete = completeDraft(draftFor(), spec);
    if (complete === null) throw new Error('fixture');
    const { requests } = stubApi({
      'POST /prescriptions/safety-check': () =>
        envelope({
          warnings: [INTERACTION],
          blocking: false,
          requiresAcknowledgment: [INTERACTION.id],
        }),
    });

    const result = await httpPrescriptionService.checkSafety(
      subjectFromDraft(complete, []),
      new AbortController().signal,
    );

    expect(requests[0]?.body).toEqual({ patientId: 'PT-1004', medicationId: LIPITOR_ID });
    expect(result).toEqual([{ ...INTERACTION, source: 'clinical-service' }]);
  });

  it('returns null for a body it cannot read — a failed verdict, never a clear one', async () => {
    expect(toSafetyWarnings(envelope({ warnings: [{ id: 'x' }] }))).toBeNull();
    expect(toSafetyWarnings(envelope({}))).toBeNull();

    const spec = await formulary();
    const complete = completeDraft(draftFor(), spec);
    if (complete === null) throw new Error('fixture');
    const verdict = await runSafetyCheck(subjectFromDraft(complete, []), {
      run: () => Promise.resolve(toSafetyWarnings({ data: 'nonsense' })),
      source: 'clinical-service',
    });
    expect(verdict.status).toBe('failed');
  });
});

describe('sign', () => {
  it('creates the draft, then signs it, sending the acknowledgment and its reason', async () => {
    const spec = await formulary();
    const signable = await signableFor(spec, draftFor(), [INTERACTION], (verdictId) => ({
      verdictId,
      warningIds: [INTERACTION.id],
      reason: 'INR monitoring arranged.',
      acknowledgedAt: '2026-10-04T09:01:00.000Z',
    }));
    const { requests } = stubApi({
      'POST /prescriptions': () => json(envelope(prescriptionView()), 201),
      'POST /prescriptions/RX-200000/sign': () =>
        envelope(prescriptionView({ status: 'active', signedAt: '2026-10-04T09:02:00.000Z' })),
    });

    const signed = await httpPrescriptionService.sign(signable);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /prescriptions',
      'POST /prescriptions/RX-200000/sign',
    ]);
    expect(requests[0]?.body).toEqual({
      patientId: 'PT-1004',
      medicationId: LIPITOR_ID,
      strength: '20 mg',
      dosage: '20 mg',
      frequency: 'Once daily at night',
      durationDays: 30,
      quantity: 30,
      refillsAllowed: 0,
      instructions: 'Take one tablet at night.',
    });
    expect(requests[1]?.body).toEqual({
      acknowledgedWarningIds: [INTERACTION.id],
      reason: 'INR monitoring arranged.',
    });
    expect(signed.status).toBe('active');
  });

  it('reports the server’s refusal, and signs the same draft again on a retry', async () => {
    const spec = await formulary();
    const signable = await signableFor(spec, draftFor());
    let attempts = 0;
    const { requests } = stubApi({
      'POST /prescriptions': () => json(envelope(prescriptionView()), 201),
      'POST /prescriptions/RX-200000/sign': () => {
        attempts += 1;
        return attempts === 1
          ? json(
              {
                message: 'Conflict',
                code: 'safety_check_unavailable',
                detail: 'The interaction source could not be reached',
              },
              409,
            )
          : envelope(prescriptionView({ status: 'active' }));
      },
    });

    await expect(httpPrescriptionService.sign(signable)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'safety_check_unavailable',
    });
    await expect(httpPrescriptionService.sign(signable)).resolves.toMatchObject({
      status: 'active',
    });

    expect(requests.filter((request) => request.path === '/prescriptions')).toHaveLength(1);
  });

  it('retries a lost response under the same Idempotency-Key, so the server replays it (M39.3)', async () => {
    const spec = await formulary();
    const signable = await signableFor(spec, draftFor());
    let creates = 0;
    let signs = 0;
    const { requests } = stubApi({
      // The first create executes on the server but its answer is lost.
      'POST /prescriptions': () => {
        creates += 1;
        if (creates === 1) throw new TypeError('Failed to fetch');
        return json(envelope(prescriptionView()), 201);
      },
      'POST /prescriptions/RX-200000/sign': () => {
        signs += 1;
        if (signs === 1) throw new TypeError('Failed to fetch');
        return envelope(prescriptionView({ status: 'active' }));
      },
    });

    await expect(httpPrescriptionService.sign(signable)).rejects.toMatchObject({ kind: 'network' });
    await expect(httpPrescriptionService.sign(signable)).rejects.toMatchObject({ kind: 'network' });
    await expect(httpPrescriptionService.sign(signable)).resolves.toMatchObject({
      status: 'active',
    });

    const keyOf = (index: number) => requests[index]?.headers['Idempotency-Key'];
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /prescriptions',
      'POST /prescriptions',
      'POST /prescriptions/RX-200000/sign',
      'POST /prescriptions/RX-200000/sign',
    ]);
    // The same intent, retried: the same key each time.
    expect(keyOf(0)).toMatch(/^[\x21-\x7E]{1,128}$/);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(keyOf(3)).toBe(keyOf(2));
    // Creating and signing are different requests, so different keys.
    expect(keyOf(2)).not.toBe(keyOf(0));
  });

  it('gives a new prescription new keys once the last one is signed', async () => {
    const spec = await formulary();
    const { requests } = stubApi({
      'POST /prescriptions': () => json(envelope(prescriptionView()), 201),
      'POST /prescriptions/RX-200000/sign': () => envelope(prescriptionView({ status: 'active' })),
    });

    await httpPrescriptionService.sign(await signableFor(spec, draftFor()));
    await httpPrescriptionService.sign(await signableFor(spec, draftFor()));

    const creates = requests.filter((request) => request.path === '/prescriptions');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.headers['Idempotency-Key']).not.toBe(creates[0]?.headers['Idempotency-Key']);
  });

  it('refuses a forged value before sending anything', async () => {
    const { requests } = stubApi({});
    const forged = { draft: null, verdict: null } as unknown as SignablePrescription;
    await expect(httpPrescriptionService.sign(forged)).rejects.toThrow(/completed safety verdict/);
    expect(requests).toHaveLength(0);
  });
});

describe('renew', () => {
  it('pre-fills a local draft and, with the therapy unchanged, signs it as a renewal', async () => {
    stubApi({
      'GET /medications': () => pageOf([LIPITOR]),
      'GET /prescriptions/RX-200000': () => envelope(prescriptionView({ status: 'active' })),
    });
    const draft = await httpPrescriptionService.renew('RX-200000');
    expect(draft).toMatchObject({
      origin: 'renewal',
      renewedFrom: 'RX-200000',
      medication: { genericName: 'Atorvastatin', strength: '20 mg' },
    });

    const spec = await httpPrescriptionService.listMedications();
    const signable = await signableFor(spec, {
      ...draft,
      dosage: { ...draft.dosage, durationDays: 60, quantity: 60 },
    });
    const { requests } = stubApi({
      'POST /prescriptions/RX-200000/renew': () =>
        json(envelope(prescriptionView({ id: 'RX-200001' })), 201),
      'POST /prescriptions/RX-200001/sign': () =>
        envelope(prescriptionView({ id: 'RX-200001', status: 'active' })),
    });

    await httpPrescriptionService.sign(signable);

    expect(requests[0]?.body).toEqual({
      durationDays: 60,
      quantity: 60,
      refillsAllowed: 0,
      instructions: 'Take one tablet at night.',
    });
  });

  it('creates a new prescription when the renewal changed the therapy', async () => {
    stubApi({
      'GET /medications': () => pageOf([LIPITOR]),
      'GET /prescriptions/RX-200000': () => envelope(prescriptionView({ status: 'active' })),
    });
    const draft = await httpPrescriptionService.renew('RX-200000');
    const spec = await httpPrescriptionService.listMedications();
    const signable = await signableFor(spec, {
      ...draft,
      medication: { genericName: 'Atorvastatin', strength: '40 mg' },
    });
    const { requests } = stubApi({
      'POST /prescriptions': () => json(envelope(prescriptionView({ id: 'RX-200002' })), 201),
      'POST /prescriptions/RX-200002/sign': () =>
        envelope(prescriptionView({ id: 'RX-200002', status: 'active' })),
    });

    await httpPrescriptionService.sign(signable);

    expect(requests[0]?.path).toBe('/prescriptions');
    expect(requests[0]?.body).toMatchObject({ strength: '40 mg' });
  });
});

describe('cancel', () => {
  it('sends the reason and the details as one stated reason', async () => {
    const { requests } = stubApi({
      'POST /prescriptions/RX-200000/cancel': () =>
        envelope(prescriptionView({ status: 'discontinued' })),
    });

    const cancelled = await httpPrescriptionService.cancel({
      prescriptionId: 'RX-200000',
      reason: 'Adverse reaction',
      details: ' Myalgia ',
      actor: 'Dr. Amelia Chen',
    });

    expect(requests[0]?.body).toEqual({ reason: 'Adverse reaction — Myalgia' });
    expect(cancelled.status).toBe('discontinued');
  });
});

describe('discontinue (DEC-002)', () => {
  it('posts to /discontinue — not /cancel — with the same stated reason', async () => {
    const { requests, unmatched } = stubApi({
      'POST /prescriptions/RX-200000/discontinue': () =>
        envelope(prescriptionView({ status: 'discontinued' })),
    });

    const ended = await httpPrescriptionService.discontinue({
      prescriptionId: 'RX-200000',
      reason: 'Adverse reaction',
      details: '',
      actor: 'Dr. Amelia Chen',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('/prescriptions/RX-200000/discontinue');
    expect(requests[0]?.body).toEqual({ reason: 'Adverse reaction' });
    expect(unmatched).toEqual([]);
    expect(ended.status).toBe('discontinued');
  });

  it('surfaces the server refusing a draft as a conflict', async () => {
    stubApi({
      'POST /prescriptions/RX-200000/discontinue': () =>
        json({ code: 'draft_not_discontinuable', message: 'A draft cannot be discontinued' }, 409),
    });

    await expect(
      httpPrescriptionService.discontinue({
        prescriptionId: 'RX-200000',
        reason: 'Patient request',
        details: '',
        actor: 'Dr. Amelia Chen',
      }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'draft_not_discontinuable' });
  });
});

describe('addNote', () => {
  it('posts the trimmed note and reads the document the server answers with', async () => {
    const { requests } = stubApi({
      'POST /prescriptions/RX-200000/notes': () =>
        json(
          envelope(
            prescriptionView({
              notes: [
                {
                  id: 'note-1',
                  author: 'Dr. Amelia Chen',
                  authoredAt: '2026-10-04T09:00:00.000Z',
                  body: 'Check renal function in 2 weeks.',
                },
              ],
            }),
          ),
          201,
        ),
    });

    const updated = await httpPrescriptionService.addNote({
      prescriptionId: 'RX-200000',
      body: '  Check renal function in 2 weeks.  ',
      author: 'ignored by the server',
    });

    expect(requests[0]?.body).toEqual({ body: 'Check renal function in 2 weeks.' });
    expect(updated.notes.map((note) => note.body)).toEqual(['Check renal function in 2 weeks.']);
  });
});

describe('getMonograph', () => {
  const monographView = {
    medicationId: 'med-uuid-1',
    name: 'Glucophage',
    genericName: 'Metformin',
    indications: 'Type 2 diabetes mellitus.',
    contraindications: null,
    standardDosing: '500 mg twice daily with meals.',
    pregnancyCategory: 'B',
    warnings: null,
    sideEffects: 'Gastrointestinal upset.',
  };

  it('reads the formulary entry’s monograph, keeping unrecorded sections null', async () => {
    const { requests } = stubApi({
      'GET /medications/med-uuid-1/monograph': () => envelope(monographView),
    });

    await expect(httpPrescriptionService.getMonograph('med-uuid-1')).resolves.toEqual(
      monographView,
    );
    expect(requests).toHaveLength(1);
  });

  it('answers a 404 as "no monograph", not as a failure', async () => {
    stubApi({
      'GET /medications/med-uuid-2/monograph': () =>
        json({ message: 'No monograph for this medication' }, 404),
    });

    await expect(httpPrescriptionService.getMonograph('med-uuid-2')).resolves.toBeNull();
  });

  it('keeps a server failure a failure', async () => {
    stubApi({ 'GET /medications/med-uuid-3/monograph': () => json({ message: 'boom' }, 500) });

    await expect(httpPrescriptionService.getMonograph('med-uuid-3')).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('capabilities', () => {
  it('declares a clinical safety source, a transmitting service and served monographs', () => {
    expect(httpPrescriptionService.capabilities).toEqual({
      safetySource: 'clinical-service',
      transmits: true,
      monographs: true,
    });
  });
});

describe('discardPrescriptionDraft (BR-DEC-002)', () => {
  it('sends DELETE on the prescription and nothing else', async () => {
    const { requests } = stubApi({
      'DELETE /prescriptions/RX-200000': () => new Response(null, { status: 204 }),
    });

    await httpPrescriptionService.discardPrescriptionDraft('RX-200000');

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'DELETE /prescriptions/RX-200000',
    ]);
    expect(requests[0]?.body).toBeUndefined();
  });

  it('names the server’s two refusals: not a draft (409), not found (404)', async () => {
    stubApi({
      'DELETE /prescriptions/RX-200001': () =>
        json({ message: 'Conflict', code: 'prescription_not_draft', detail: 'signed' }, 409),
      'DELETE /prescriptions/RX-200002': () => json({ message: 'Prescription not found' }, 404),
    });

    await expect(httpPrescriptionService.discardPrescriptionDraft('RX-200001')).rejects.toThrow(
      PRESCRIPTION_NOT_DRAFT,
    );
    await expect(httpPrescriptionService.discardPrescriptionDraft('RX-200002')).rejects.toThrow(
      PRESCRIPTION_NOT_FOUND,
    );
  });

  it('forgets a refused signature’s draft once it is discarded, so a retry creates a new one', async () => {
    const spec = await formulary();
    const signable = await signableFor(spec, draftFor());
    let created = 0;
    const { requests } = stubApi({
      'POST /prescriptions': () => {
        created += 1;
        return json(envelope(prescriptionView({ id: `RX-20000${String(created - 1)}` })), 201);
      },
      'POST /prescriptions/RX-200000/sign': () =>
        json({ message: 'Conflict', code: 'safety_check_unavailable', detail: 'down' }, 409),
      'DELETE /prescriptions/RX-200000': () => new Response(null, { status: 204 }),
      'POST /prescriptions/RX-200001/sign': () => envelope(prescriptionView({ status: 'active' })),
    });

    await expect(httpPrescriptionService.sign(signable)).rejects.toMatchObject({
      code: 'safety_check_unavailable',
    });
    await httpPrescriptionService.discardPrescriptionDraft('RX-200000');
    await httpPrescriptionService.sign(signable);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /prescriptions',
      'POST /prescriptions/RX-200000/sign',
      'DELETE /prescriptions/RX-200000',
      'POST /prescriptions',
      'POST /prescriptions/RX-200001/sign',
    ]);
  });
});

describe('medication search (D-18, API §7.1 `q`)', () => {
  it('asks the server for one page of matches, by the trimmed term', async () => {
    const { requests } = stubApi({ 'GET /medications': () => pageOf([LIPITOR]) });

    const matches = await httpPrescriptionService.searchMedications('  lipi ');

    expect(requests[0]?.query.get('q')).toBe('lipi');
    expect(requests[0]?.query.get('page')).toBe('1');
    expect(requests[0]?.query.get('pageSize')).toBe('20');
    expect(matches).toEqual([toMedicationSpec(LIPITOR)]);
  });

  it('answers no matches as an empty list, not a failure', async () => {
    stubApi({ 'GET /medications': () => pageOf([]) });
    await expect(httpPrescriptionService.searchMedications('zz')).resolves.toEqual([]);
  });

  it('passes a server failure through for the step to report', async () => {
    stubApi({ 'GET /medications': () => json({ message: 'Internal' }, 500) });
    await expect(httpPrescriptionService.searchMedications('lipi')).rejects.toMatchObject({
      kind: 'server',
    });
  });
});
